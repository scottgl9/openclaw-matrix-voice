import { MatrixClient } from 'matrix-bot-sdk';
import { OpenClawService } from '../services/openclaw-service.js';
import { ChatterboxTTSService } from '../services/chatterbox-tts-service.js';
import { MatrixClientService } from '../services/matrix-client-service.js';
import { MatrixCallMediaService } from '../services/matrix-call-media-service.js';
import { AudioPipelineService } from '../services/audio-pipeline.js';
import { TurnProcessorService } from '../services/turn-processor.js';
import { VadService } from '../services/vad-service.js';

export interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  transcription?: string;
  // Phase 2: Real call media support
  callId?: string;
  isRealMediaCall?: boolean;
  // Phase 5: VAD and turn processing
  audioPipeline?: AudioPipelineService;
  turnProcessor?: TurnProcessorService;
  vadService?: VadService;
}

export class VoiceCallHandler {
  private matrixService: MatrixClientService;
  private client: MatrixClient;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private callMediaService: MatrixCallMediaService;
  private activeCalls: Map<string, CallState> = new Map();
  
  // Phase 5: Turn processor for end-to-end processing
  private turnProcessor: TurnProcessorService | null = null;

  constructor(
    matrixService: MatrixClientService,
    openClawService: OpenClawService,
    ttsService: ChatterboxTTSService,
    callMediaService?: MatrixCallMediaService
  ) {
    this.matrixService = matrixService;
    this.client = matrixService.getClient();
    this.openClawService = openClawService;
    this.ttsService = ttsService;
    // Use provided call media service or create a new one
    this.callMediaService = callMediaService || new MatrixCallMediaService(this.client);
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
      await this.matrixService.sendMessage(roomId, '⚠️ Voice call is not active. Use /call start to begin.');
      return;
    }
    
    await this.processVoiceInput(roomId, event);
  }

  /**
   * Handle room events
   */
  async handleEvent(roomId: string, event: any): Promise<void> {
    const type = event['type'];
    
    // Phase 2: Handle real media call events
    const callState = this.activeCalls.get(roomId);
    if (callState?.isRealMediaCall) {
      // Route call media events to call media service
      if (type === 'm.call.media') {
        await this.callMediaService.handleCallMedia(roomId, event);
        return;
      }
    }
    
    // Handle call control events
    if (type === 'm.room.message') {
      const content = event['content'] || {};
      const msgtype = content['msgtype'];
      
      // Check for voice call commands
      if (content['body']) {
        const body = content['body'].toLowerCase();
        
        if (body.includes('/call start') || body.includes('/voice start')) {
          // Phase 2: Support /call start real flag for WebRTC calls
          const useRealMedia = body.includes('real') || body.includes('webrtc');
          await this.startCall(roomId, useRealMedia);
        } else if (body.includes('/call end') || body.includes('/voice end')) {
          await this.endCall(roomId);
        } else if (body.includes('/call status') || body.includes('/voice status')) {
          await this.sendStatus(roomId);
        }
      }
    }
  }

  /**
   * Start a voice call in a room
   * Phase 2/3/5: Support text-simulated, WebRTC, LiveKit, and VAD-driven calls
   */
  async startCall(roomId: string, useRealMedia = false): Promise<void> {
    console.log(`Starting voice call in ${roomId} (real media: ${useRealMedia})`);
    
    const callState: CallState = {
      isActive: true,
      roomId,
      lastActivity: new Date(),
      isRealMediaCall: useRealMedia,
    };

    if (useRealMedia) {
      // Phase 5: Initialize VAD-driven audio pipeline
      try {
        await this.initializeAudioPipeline(roomId, callState);
      } catch (error: any) {
        console.error('[VoiceCallHandler] Error initializing audio pipeline:', error.message);
        // Continue without pipeline - will fall back to text mode
        callState.isRealMediaCall = false;
      }

      // Phase 3: Try LiveKit first, fall back to WebRTC/Matrix call
      const liveKitAdapter = this.matrixService.getLiveKitAdapter();
      
      if (liveKitAdapter && liveKitAdapter.isLiveKitAvailable()) {
        try {
          // Use LiveKit for real media call
          const userId = await this.matrixService.getClient().getUserId();
          const result = await liveKitAdapter.startCall(roomId, userId);
          
          if (result.success) {
            callState.callId = `livekit_${Date.now()}`;
            console.log(`[VoiceCallHandler] LiveKit call started in ${roomId}`);
          } else {
            console.warn('[VoiceCallHandler] LiveKit start failed:', result.error);
            // Fall through to Matrix call fallback
          }
        } catch (error: any) {
          console.error('[VoiceCallHandler] Error starting LiveKit call:', error.message);
          // Fall through to Matrix call fallback
        }
      }

      // Fallback: Use call media service for WebRTC-based calls
      if (!callState.callId) {
        try {
          const callId = await this.callMediaService.startCall(roomId);
          callState.callId = callId;
          console.log(`[VoiceCallHandler] Matrix call started: ${callId}`);
        } catch (error) {
          console.error('[VoiceCallHandler] Error starting real media call:', error);
          // Fallback to text-simulated call
          callState.isRealMediaCall = false;
        }
      }
    }

    this.activeCalls.set(roomId, callState);

    let message = '🎤 Voice call started. Speak clearly and I\'ll respond.';
    if (useRealMedia) {
      if (callState.callId?.startsWith('livekit_')) {
        message = '🎤 LiveKit voice call started (VAD-driven). I\'m listening...';
      } else {
        message = '🎤 Real voice call started (Matrix/WebRTC). I\'m listening...';
      }
    }
    
    await this.matrixService.sendMessage(roomId, message);
  }

  /**
   * Initialize audio pipeline with VAD and turn processor (Phase 5)
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
        console.log('[VoiceCallHandler] TTS audio ready, sending to room...');
        try {
          await this.matrixService.sendAudio(roomId, event.audioData, event.mimeType);
        } catch (error: any) {
          console.error('[VoiceCallHandler] Error sending TTS audio:', error.message);
          // Fallback to text
          await this.matrixService.sendMessage(roomId, `🤖 [TTS error: ${event.responseText}]`);
        }
      });

      // Set up error handler
      turnProcessor.on('error', async (event: any) => {
        console.error('[VoiceCallHandler] Turn processing error:', event.error);
        await this.matrixService.sendMessage(roomId, `❌ Processing error: ${event.error}`);
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
      
      // Phase 5: Stop audio pipeline, VAD, and turn processor
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

      // Phase 3: End LiveKit call if active
      if (callState.isRealMediaCall && callState.callId?.startsWith('livekit_')) {
        const liveKitAdapter = this.matrixService.getLiveKitAdapter();
        if (liveKitAdapter) {
          try {
            await liveKitAdapter.endCall(roomId);
          } catch (error) {
            console.error('[VoiceCallHandler] Error ending LiveKit call:', error);
          }
        }
      }
      
      // Phase 2: End Matrix/WebRTC call if active
      if (callState.isRealMediaCall && !callState.callId?.startsWith('livekit_')) {
        try {
          await this.callMediaService.endCall(roomId);
        } catch (error) {
          console.error('[VoiceCallHandler] Error ending real media call:', error);
        }
      }
      
      this.activeCalls.set(roomId, callState);
    }

    await this.matrixService.sendMessage(roomId, '🔇 Voice call ended.');
  }

  /**
   * Send call status
   */
  async sendStatus(roomId: string): Promise<void> {
    const callState = this.activeCalls.get(roomId);
    const status = callState?.isActive ? 'Active' : 'Inactive';
    const duration = callState?.lastActivity 
      ? `${Math.floor((Date.now() - callState.lastActivity.getTime()) / 1000)}s` 
      : 'N/A';

    await this.matrixService.sendMessage(roomId, `📞 Call status: ${status}\nDuration: ${duration}`);
  }

  /**
   * Handle voice call reference (stub for MVP)
   */
  private async handleVoiceCallReference(roomId: string, eventId: string, event: any): Promise<void> {
    console.log(`Handling voice call reference: ${eventId}`);
    
    // For MVP, we'll process text-based voice simulation
    // In a full implementation, this would handle actual audio streams
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
      await this.matrixService.sendMessage(roomId, '⚠️ Voice call is not active. Use /call start to begin.');
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
          // Fallback to text
          await this.matrixService.sendMessage(roomId, `🤖 ${response.response}`);
        }
      } else {
        // Fallback to text
        await this.matrixService.sendMessage(roomId, `🤖 ${response.response}`);
      }
    } else {
      await this.matrixService.sendMessage(roomId, `❌ Error: ${response.error || 'Unknown error'}`);
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

  /**
   * Process real-time audio input (Phase 2: stub for STT integration)
   * This method will be called when real audio streams are received
   */
  async processRealTimeAudio(roomId: string, audioData: Buffer, mimeType: string): Promise<void> {
    const callState = this.activeCalls.get(roomId);
    if (!callState || !callState.isActive) {
      console.warn('[VoiceCallHandler] No active call for audio processing in', roomId);
      return;
    }

    if (!callState.isRealMediaCall) {
      console.warn('[VoiceCallHandler] Real-time audio received but call is text-simulated');
      return;
    }

    console.log(`[VoiceCallHandler] Processing real-time audio: ${audioData.length} bytes`);

    // Update last activity
    callState.lastActivity = new Date();
    this.activeCalls.set(roomId, callState);

    // Phase 2: Stub - In production, this would:
    // 1. Pass audio to STT service (Whisper/Vosk)
    // 2. Get transcription
    // 3. Process transcription through OpenClaw
    // 4. Convert response to speech via TTS
    // 5. Send audio back via WebRTC
    
    // For now, just log and send a placeholder response
    console.log('[VoiceCallHandler] STT integration pending - audio received but not transcribed');
    
    // Send acknowledgment (Phase 2: text placeholder)
    // Phase 3+: Send actual audio response via WebRTC
    await this.matrixService.sendMessage(roomId, '🎙️ [Real audio received - STT pending]');
  }

  /**
   * Get call media service instance
   */
  getCallMediaService(): MatrixCallMediaService {
    return this.callMediaService;
  }
}
