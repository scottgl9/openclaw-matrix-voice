import { MatrixClient } from 'matrix-bot-sdk';
import { config } from '../config/index.js';
import { OpenClawService } from '../services/openclaw-service.js';
import { ChatterboxTTSService } from '../services/chatterbox-tts-service.js';
import { MatrixClientService } from '../services/matrix-client-service.js';
import { AudioPipelineService } from '../services/audio-pipeline.js';
import { TurnProcessorService } from '../services/turn-processor.js';
import { VadService } from '../services/vad-service.js';
import { STTService } from '../services/stt-adapter.js';
import { LiveKitAgentService } from '../services/livekit-agent-service.js';
import { LiveKitAudioIngress, LiveKitAudioEgress } from '../services/livekit-audio-transport.js';

export interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  transcription?: string;
  audioPipeline?: AudioPipelineService;
  turnProcessor?: TurnProcessorService;
  vadService?: VadService;
  livekitAgent?: LiveKitAgentService;
  isLiveKitCall?: boolean;
}

export class VoiceCallHandler {
  private matrixService: MatrixClientService;
  private client: MatrixClient;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private activeCalls: Map<string, CallState> = new Map();

  // STT service factory - each call gets its own TurnProcessor but shares STT adapter type
  private sttService: STTService | null = null;

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
   * Set the STT service to use for new calls.
   */
  setSTTService(sttService: STTService): void {
    this.sttService = sttService;
    console.log('[VoiceCallHandler] STT service set');
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
   * Handle MatrixRTC m.call.member state events.
   * Auto-joins LiveKit calls when detected.
   */
  async handleMatrixRTCEvent(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const memberships = content['memberships'] || [];

    for (const membership of memberships) {
      const fociActive = membership['foci_active'] || [];
      for (const focus of fociActive) {
        if (focus['type'] === 'livekit') {
          const livekitUrl = focus['livekit_service_url'];
          const livekitAlias = focus['livekit_alias'] || roomId;

          console.log(`[VoiceCallHandler] MatrixRTC LiveKit call detected in ${roomId}`);
          console.log(`[VoiceCallHandler] LiveKit URL: ${livekitUrl}, alias: ${livekitAlias}`);

          const existing = this.activeCalls.get(roomId);
          if (existing?.isActive && existing?.isLiveKitCall) {
            console.log('[VoiceCallHandler] Already in this LiveKit call, skipping');
            return;
          }

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
      const botUserId = await this.client.getUserId();
      const token = await liveKitService.generateToken(livekitAlias, botUserId, true, true);

      const agent = new LiveKitAgentService(liveKitService);
      await agent.joinRoom(livekitUrl, token);

      const callState: CallState = {
        isActive: true,
        roomId,
        lastActivity: new Date(),
        isLiveKitCall: true,
        livekitAgent: agent,
      };

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
          const room = await liveKitService.createRoom(roomId);
          const botUserId = await this.client.getUserId();
          const token = await liveKitService.generateToken(room.name, botUserId, true, true);

          const agent = new LiveKitAgentService(liveKitService);
          await agent.joinRoom(liveKitService.getUrl(), token);

          callState.isLiveKitCall = true;
          callState.livekitAgent = agent;

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
   * Initialize audio pipeline with VAD and a per-call TurnProcessor.
   */
  private async initializeAudioPipeline(roomId: string, callState: CallState): Promise<void> {
    console.log('[VoiceCallHandler] Initializing audio pipeline for', roomId);

    const pipeline = new AudioPipelineService({
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels,
      format: config.audio.format,
      frameDurationMs: config.audio.frameDurationMs,
      loopbackEnabled: false,
      vadEnabled: true,
    });

    const vadService = new VadService({
      energyThreshold: config.vad.energyThreshold,
      silenceThresholdMs: config.vad.silenceThresholdMs,
      minSpeechDurationMs: config.vad.minSpeechDurationMs,
      preRollMs: config.vad.preRollMs,
      postRollMs: config.vad.postRollMs,
      frameDurationMs: config.audio.frameDurationMs,
      debug: config.vad.debug,
      adaptiveThreshold: config.vad.adaptiveThreshold,
      adaptiveMultiplier: config.vad.adaptiveMultiplier,
      hangoverFrames: config.vad.hangoverFrames,
    });

    // Create a per-call TurnProcessor to avoid race conditions between rooms
    const turnProcessor = new TurnProcessorService(
      this.openClawService,
      this.ttsService,
      this.sttService || undefined
    );

    await pipeline.initialize();

    // Set up LiveKit transport if available
    if (callState.livekitAgent) {
      const ingress = new LiveKitAudioIngress(callState.livekitAgent);
      const egress = new LiveKitAudioEgress(callState.livekitAgent);
      pipeline.setIngress(ingress);
      pipeline.setEgress(egress);

      // Handle LiveKit disconnection - notify user
      callState.livekitAgent.on('disconnected', async () => {
        console.warn(`[VoiceCallHandler] LiveKit disconnected for room ${roomId}`);
        if (callState.isActive) {
          await this.matrixService.sendMessage(roomId, 'LiveKit connection lost. Call ended.').catch(() => {});
          await this.endCall(roomId);
        }
      });
    }

    await pipeline.start();

    // Attach VAD
    pipeline.setVadService(vadService);
    vadService.start();

    // Wire turn completion -> turn processor
    await turnProcessor.initialize();

    pipeline.on('turn.complete', async (event: any) => {
      console.log('[VoiceCallHandler] Turn complete event, processing...');
      await turnProcessor.handleTurnCompletion(event);
    });

    // Route TTS audio to LiveKit or Matrix
    turnProcessor.on('tts.audio', async (event: any) => {
      console.log('[VoiceCallHandler] TTS audio ready');
      try {
        if (callState.livekitAgent && callState.livekitAgent.isConnected()) {
          await callState.livekitAgent.publishAudioBuffer(event.audioData, config.audio.sampleRate);
        } else {
          await this.matrixService.sendAudio(roomId, event.audioData, event.mimeType);
        }
      } catch (error: any) {
        console.error('[VoiceCallHandler] Error sending TTS audio:', error.message);
        // Always send error feedback to user
        await this.matrixService.sendMessage(roomId, `Could not send audio response: ${event.responseText}`).catch(() => {});
      }
    });

    // Route errors to user via Matrix message
    turnProcessor.on('error', async (event: any) => {
      console.error('[VoiceCallHandler] Turn processing error:', event.error);
      await this.matrixService.sendMessage(roomId, `Processing error: ${event.error}`).catch(() => {});
    });

    callState.audioPipeline = pipeline;
    callState.vadService = vadService;
    callState.turnProcessor = turnProcessor;

    console.log('[VoiceCallHandler] Audio pipeline initialized with VAD and per-call turn processor');
  }

  /**
   * End a voice call in a room.
   * Returns a promise that resolves when all cleanup is done.
   */
  async endCall(roomId: string): Promise<void> {
    console.log(`Ending voice call in ${roomId}`);

    const callState = this.activeCalls.get(roomId);
    if (callState) {
      callState.isActive = false;

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

      if (callState.livekitAgent) {
        try {
          await callState.livekitAgent.leaveRoom();
        } catch (error) {
          console.error('[VoiceCallHandler] Error leaving LiveKit room:', error);
        }
      }

      this.activeCalls.delete(roomId);
    }

    await this.matrixService.sendMessage(roomId, 'Voice call ended.');
  }

  /**
   * End all active calls. Used during graceful shutdown.
   */
  async endAllCalls(): Promise<void> {
    const roomIds = Array.from(this.activeCalls.keys());
    await Promise.allSettled(
      roomIds.map(roomId => this.endCall(roomId))
    );
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

  private async handleVoiceCallReference(roomId: string, eventId: string, event: any): Promise<void> {
    console.log(`Handling voice call reference: ${eventId}`);

    const content = event['content'] || {};
    const body = content['body'] || '';

    if (body.startsWith('voice:') || body.startsWith('speech:')) {
      const text = body.replace(/^(voice|speech):/, '').trim();
      await this.processVoiceInput(roomId, { ...event, content: { body: text } });
    }
  }

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

    callState.lastActivity = new Date();

    const response = await this.openClawService.processText(body);

    if (response.success && response.response) {
      const ttsResult = await this.ttsService.textToSpeechCached(response.response);

      if (ttsResult.success && ttsResult.audioData) {
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

  getActiveCallCount(): number {
    return Array.from(this.activeCalls.values()).filter(c => c.isActive).length;
  }

  getAllCallStates(): Map<string, CallState> {
    return new Map(this.activeCalls);
  }
}
