import { MatrixClient } from 'matrix-bot-sdk';
import { OpenClawService } from '../services/openclaw-service.js';
import { ChatterboxTTSService } from '../services/chatterbox-tts-service.js';
import { MatrixClientService } from '../services/matrix-client-service.js';
import { AudioPipelineService } from '../services/audio-pipeline.js';
import { TurnProcessorService } from '../services/turn-processor.js';
import { VadService } from '../services/vad-service.js';
import { LiveKitAgentService } from '../services/livekit-agent-service.js';
import { LiveKitAudioIngress, LiveKitAudioEgress } from '../services/livekit-audio-transport.js';

export interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  transcription?: string;
  // Phase 5: VAD and turn processing
  audioPipeline?: AudioPipelineService;
  turnProcessor?: TurnProcessorService;
  vadService?: VadService;
  // LiveKit agent for real media calls
  livekitAgent?: LiveKitAgentService;
  isLiveKitCall?: boolean;
}

export class VoiceCallHandler {
  private matrixService: MatrixClientService;
  private client: MatrixClient;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private activeCalls: Map<string, CallState> = new Map();

  // Phase 5: Turn processor for end-to-end processing
  private turnProcessor: TurnProcessorService | null = null;

  constructor(
    matrixService: MatrixClientService,
    openClawService: OpenClawService,
    ttsService: ChatterboxTTSService
  ) {
    this.matrixService = matrixService;
    this.client = matrixService.getClient();
    this.openClawService = openClawService;
    this.ttsService = ttsService;
  }

  /**
   * Set turn processor for Phase 5 integration
   */
  setTurnProcessor(turnProcessor: TurnProcessorService): void {
    this.turnProcessor = turnProcessor;
    console.log('[VoiceCallHandler] Turn processor attached');
  }

  /**
   * Handle reference events (replies to messages)
   */
  async handleReference(roomId: string, event: any): Promise<void> {
    const relatesTo = event['m.relates_to'];
    if (!relatesTo || relatesTo.rel_type !== 'm.reference') {
      return;
    }

    const eventId = relatesTo.event_id;
    console.log(`Received reference to ${eventId} in ${roomId}`);

    // Check if this is a voice call related reference
    if (eventId.includes('voice-call') || eventId.includes('call')) {
      await this.handleVoiceCallReference(roomId, eventId, event);
    }
  }

  /**
   * Handle reply events
   */
  async handleReply(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const replyTo = content['m.reply_to'] || content['reply_to'];

    if (!replyTo) {
      return;
    }

    console.log(`Received reply in ${roomId}`);

    // Process as voice call if in active call room
    const callState = this.activeCalls.get(roomId);
    if (!callState || !callState.isActive) {
      await this.matrixService.sendMessage(roomId, 'Voice call is not active. Use /call start to begin.');
      return;
    }

    await this.processVoiceInput(roomId, event);
  }

  /**
   * Handle room events
   */
  async handleEvent(roomId: string, event: any): Promise<void> {
    const type = event['type'];

    // Handle MatrixRTC m.call.member state events
    if (type === 'm.call.member') {
      await this.handleMatrixRTCEvent(roomId, event);
      return;
    }

    // Handle call control events
    if (type === 'm.room.message') {
      const content = event['content'] || {};

      // Check for voice call commands
      if (content['body']) {
        const body = content['body'].toLowerCase();

        if (body.includes('/call start') || body.includes('/voice start')) {
          const useLiveKit = body.includes('livekit') || body.includes('real');
          await this.startCall(roomId, useLiveKit);
        } else if (body.includes('/call end') || body.includes('/voice end')) {
          await this.endCall(roomId);
        } else if (body.includes('/call status') || body.includes('/voice status')) {
          await this.sendStatus(roomId);
        }
      }
    }
  }

  /**
   * Handle MatrixRTC m.call.member state events
   * When a user starts a voice call in Element, it sends m.call.member with foci_active pointing to LiveKit
   */
  async handleMatrixRTCEvent(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const memberships = content['memberships'] || [];

    // Check if there are active memberships with LiveKit focus
    for (const membership of memberships) {
      const fociActive = membership['foci_active'] || [];
      for (const focus of fociActive) {
        if (focus['type'] === 'livekit') {
          const livekitUrl = focus['livekit_service_url'];
          const livekitAlias = focus['livekit_alias'] || roomId;

          console.log(`[VoiceCallHandler] MatrixRTC LiveKit call detected in ${roomId}`);
          console.log(`[VoiceCallHandler] LiveKit URL: ${livekitUrl}, alias: ${livekitAlias}`);

          // Check if we're already in this call
          const existing = this.activeCalls.get(roomId);
          if (existing?.isActive && existing?.isLiveKitCall) {
            console.log('[VoiceCallHandler] Already in this LiveKit call, skipping');
            return;
          }

          // Auto-join the call
          await this.startLiveKitCall(roomId, livekitUrl, livekitAlias);
          return;
        }
      }
    }

    // No active LiveKit focus - call may have ended
    const existing = this.activeCalls.get(roomId);
    if (existing?.isActive && existing?.isLiveKitCall) {
      console.log('[VoiceCallHandler] MatrixRTC call ended, cleaning up');
      await this.endCall(roomId);
    }
  }

  /**
   * Start a LiveKit call by joining an existing room
   */
  private async startLiveKitCall(roomId: string, livekitUrl: string, livekitAlias: string): Promise<void> {
    const liveKitService = this.matrixService.getLiveKitService();
    if (!liveKitService) {
      console.warn('[VoiceCallHandler] LiveKit service not available');
      return;
    }

    try {
      // Generate a token for the bot to join
      const botUserId = await this.client.getUserId();
      const token = await liveKitService.generateToken(livekitAlias, botUserId, true, true);

      // Create agent service and join
      const agent = new LiveKitAgentService(liveKitService);
      await agent.joinRoom(livekitUrl, token);

      const callState: CallState = {
        isActive: true,
        roomId,
        lastActivity: new Date(),
        isLiveKitCall: true,
        livekitAgent: agent,
      };

      // Initialize audio pipeline with LiveKit transport
      await this.initializeAudioPipeline(roomId, callState);

      this.activeCalls.set(roomId, callState);
      console.log(`[VoiceCallHandler] Joined LiveKit call in ${roomId}`);
    } catch (error: any) {
      console.error('[VoiceCallHandler] Error joining LiveKit call:', error.message);
    }
  }

  /**
   * Start a voice call in a room
   */
  async startCall(roomId: string, useLiveKit = false): Promise<void> {
    console.log(`Starting voice call in ${roomId} (livekit: ${useLiveKit})`);

    const callState: CallState = {
      isActive: true,
      roomId,
      lastActivity: new Date(),
      isLiveKitCall: false,
    };

    if (useLiveKit) {
      const liveKitService = this.matrixService.getLiveKitService();

      if (liveKitService) {
        try {
          // Create a LiveKit room and join it
          const room = await liveKitService.createRoom(roomId);
          const botUserId = await this.client.getUserId();
          const token = await liveKitService.generateToken(room.name, botUserId, true, true);

          const agent = new LiveKitAgentService(liveKitService);
          await agent.joinRoom(liveKitService.getUrl(), token);

          callState.isLiveKitCall = true;
          callState.livekitAgent = agent;

          // Initialize audio pipeline with LiveKit transport
          await this.initializeAudioPipeline(roomId, callState);

          console.log(`[VoiceCallHandler] LiveKit call started in ${roomId}`);
        } catch (error: any) {
          console.error('[VoiceCallHandler] Error starting LiveKit call:', error.message);
          callState.isLiveKitCall = false;
        }
      }
    }

    this.activeCalls.set(roomId, callState);

    let message = 'Voice call started. Send messages and I\'ll respond.';
    if (callState.isLiveKitCall) {
      message = 'LiveKit voice call started (VAD-driven). I\'m listening...';
    }

    await this.matrixService.sendMessage(roomId, message);
  }

  /**
   * Initialize audio pipeline with VAD and turn processor
   */
  private async initializeAudioPipeline(roomId: string, callState: CallState): Promise<void> {
    console.log('[VoiceCallHandler] Initializing audio pipeline for', roomId);

    // Create audio pipeline
    const pipeline = new AudioPipelineService({
      sampleRate: 16000,
      channels: 1,
      format: 'pcm16',
      frameDurationMs: 20,
      loopbackEnabled: false,
      vadEnabled: true,
    });

    // Create VAD service
    const vadService = new VadService({
      energyThreshold: 0.3,
      silenceThresholdMs: 800,
      minSpeechDurationMs: 200,
      preRollMs: 100,
      postRollMs: 300,
      frameDurationMs: 20,
      debug: false,
    });

    // Create turn processor
    let turnProcessor: TurnProcessorService | null = null;
    if (this.turnProcessor) {
      turnProcessor = this.turnProcessor;
    }

    // Initialize pipeline
    await pipeline.initialize();

    // If we have a LiveKit agent, set up LiveKit transport
    if (callState.livekitAgent) {
      const ingress = new LiveKitAudioIngress(callState.livekitAgent);
      const egress = new LiveKitAudioEgress(callState.livekitAgent);
      pipeline.setIngress(ingress);
      pipeline.setEgress(egress);
    }

    await pipeline.start();

    // Attach VAD to pipeline
    pipeline.setVadService(vadService);
    vadService.start();

    // Set up turn completion handler
    if (turnProcessor) {
      await turnProcessor.initialize();

      pipeline.on('turn.complete', async (event: any) => {
        console.log('[VoiceCallHandler] Turn complete event, processing...');
        await turnProcessor!.handleTurnCompletion(event);
      });

      // Set up TTS audio handler
      turnProcessor.on('tts.audio', async (event: any) => {
        console.log('[VoiceCallHandler] TTS audio ready');
        try {
          if (callState.livekitAgent && callState.livekitAgent.isConnected()) {
            // Send TTS audio through LiveKit for real-time playback
            await callState.livekitAgent.publishAudioBuffer(event.audioData, 16000);
          } else {
            // Fallback: send as Matrix audio message
            await this.matrixService.sendAudio(roomId, event.audioData, event.mimeType);
          }
        } catch (error: any) {
          console.error('[VoiceCallHandler] Error sending TTS audio:', error.message);
          await this.matrixService.sendMessage(roomId, `[TTS error: ${event.responseText}]`);
        }
      });

      // Set up error handler
      turnProcessor.on('error', async (event: any) => {
        console.error('[VoiceCallHandler] Turn processing error:', event.error);
        await this.matrixService.sendMessage(roomId, `Processing error: ${event.error}`);
      });
    }

    callState.audioPipeline = pipeline;
    callState.vadService = vadService;
    callState.turnProcessor = turnProcessor || undefined;

    console.log('[VoiceCallHandler] Audio pipeline initialized with VAD and turn processor');
  }

  /**
   * End a voice call in a room
   */
  async endCall(roomId: string): Promise<void> {
    console.log(`Ending voice call in ${roomId}`);

    const callState = this.activeCalls.get(roomId);
    if (callState) {
      callState.isActive = false;

      // Stop audio pipeline, VAD, and turn processor
      if (callState.audioPipeline) {
        try {
          await callState.audioPipeline.stop();
        } catch (error) {
          console.error('[VoiceCallHandler] Error stopping audio pipeline:', error);
        }
      }

      if (callState.vadService) {
        callState.vadService.stop();
      }

      if (callState.turnProcessor) {
        try {
          await callState.turnProcessor.shutdown();
        } catch (error) {
          console.error('[VoiceCallHandler] Error shutting down turn processor:', error);
        }
      }

      // Leave LiveKit room if connected
      if (callState.livekitAgent) {
        try {
          await callState.livekitAgent.leaveRoom();
        } catch (error) {
          console.error('[VoiceCallHandler] Error leaving LiveKit room:', error);
        }
      }

      this.activeCalls.set(roomId, callState);
    }

    await this.matrixService.sendMessage(roomId, 'Voice call ended.');
  }

  /**
   * Send call status
   */
  async sendStatus(roomId: string): Promise<void> {
    const callState = this.activeCalls.get(roomId);
    const status = callState?.isActive ? 'Active' : 'Inactive';
    const mode = callState?.isLiveKitCall ? ' (LiveKit)' : '';
    const duration = callState?.lastActivity
      ? `${Math.floor((Date.now() - callState.lastActivity.getTime()) / 1000)}s`
      : 'N/A';

    await this.matrixService.sendMessage(roomId, `Call status: ${status}${mode}\nDuration: ${duration}`);
  }

  /**
   * Handle voice call reference (stub for MVP)
   */
  private async handleVoiceCallReference(roomId: string, eventId: string, event: any): Promise<void> {
    console.log(`Handling voice call reference: ${eventId}`);

    const content = event['content'] || {};
    const body = content['body'] || '';

    if (body.startsWith('voice:') || body.startsWith('speech:')) {
      const text = body.replace(/^(voice|speech):/, '').trim();
      await this.processVoiceInput(roomId, { ...event, content: { body: text } });
    }
  }

  /**
   * Process voice input (text simulation for MVP)
   */
  private async processVoiceInput(roomId: string, event: any): Promise<void> {
    const callState = this.activeCalls.get(roomId);
    if (!callState || !callState.isActive) {
      await this.matrixService.sendMessage(roomId, 'Voice call is not active. Use /call start to begin.');
      return;
    }

    const content = event['content'] || {};
    const body = content['body'] || '';

    if (!body) {
      return;
    }

    console.log(`Processing voice input: ${body}`);

    // Update last activity
    callState.lastActivity = new Date();
    this.activeCalls.set(roomId, callState);

    // Get response from OpenClaw
    const response = await this.openClawService.processText(body);

    if (response.success && response.response) {
      // Convert response to speech
      const ttsResult = await this.ttsService.textToSpeechCached(response.response);

      if (ttsResult.success && ttsResult.audioData) {
        // Send audio back to room
        try {
          await this.matrixService.sendAudio(roomId, ttsResult.audioData, ttsResult.mimeType || 'audio/wav');
        } catch (error) {
          console.error('Error sending audio:', error);
          await this.matrixService.sendMessage(roomId, response.response);
        }
      } else {
        await this.matrixService.sendMessage(roomId, response.response);
      }
    } else {
      await this.matrixService.sendMessage(roomId, `Error: ${response.error || 'Unknown error'}`);
    }
  }

  /**
   * Get active call count
   */
  getActiveCallCount(): number {
    return Array.from(this.activeCalls.values()).filter(c => c.isActive).length;
  }

  /**
   * Get all call states
   */
  getAllCallStates(): Map<string, CallState> {
    return new Map(this.activeCalls);
  }
}
