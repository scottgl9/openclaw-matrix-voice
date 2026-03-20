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
import { CallStore, StoredCallSession } from '../services/call-store.js';

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
  livekitAlias?: string;
  botSpeaking?: boolean;
  ttsPlaybackTimer?: NodeJS.Timeout;
}

export class VoiceCallHandler {
  private matrixService: MatrixClientService;
  private client: MatrixClient;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private activeCalls: Map<string, CallState> = new Map();

  private sttService: STTService | null = null;
  private callStore: CallStore;

  constructor(
    matrixService: MatrixClientService,
    openClawService: OpenClawService,
    ttsService: ChatterboxTTSService
  ) {
    this.matrixService = matrixService;
    this.client = matrixService.getClient();
    this.openClawService = openClawService;
    this.ttsService = ttsService;
    this.callStore = new CallStore();
  }

  /**
   * Set the STT service to use for new calls.
   */
  setSTTService(sttService: STTService): void {
    this.sttService = sttService;
    console.log('[VoiceCallHandler] STT service set');
  }

  /**
   * Load stored sessions and attempt to recover LiveKit calls from a previous run.
   */
  async recoverSessions(): Promise<void> {
    await this.callStore.load();
    const sessions = this.callStore.getSessions();

    if (sessions.length === 0) return;

    console.log(`[VoiceCallHandler] Recovering ${sessions.length} stored call sessions`);

    for (const session of sessions) {
      if (session.isLiveKitCall && session.livekitUrl && session.livekitAlias) {
        try {
          await this.startLiveKitCall(session.roomId, session.livekitUrl, session.livekitAlias);
          console.log(`[VoiceCallHandler] Recovered LiveKit call in ${session.roomId}`);
        } catch (error: any) {
          console.warn(`[VoiceCallHandler] Failed to recover call in ${session.roomId}:`, error.message);
          await this.callStore.removeSession(session.roomId);
        }
      } else {
        // Non-LiveKit calls can't be recovered — just clean up
        await this.callStore.removeSession(session.roomId);
      }
    }
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

    // Handle MatrixRTC m.call.member state events (stable + unstable MSC3401 prefix)
    if (type === 'm.call.member' || type === 'org.matrix.msc3401.call.member') {
      await this.handleMatrixRTCEvent(roomId, event);
      return;
    }

    // Handle legacy WebRTC call signalling (Element's native call button)
    if (type === 'm.call.invite') {
      await this.handleCallInvite(roomId, event);
      return;
    }
    if (type === 'm.call.hangup') {
      await this.handleCallHangup(roomId, event);
      return;
    }

    // Handle call control events and text-simulated voice input
    if (type === 'm.room.message') {
      const content = event['content'] || {};
      const sender = event['sender'];

      // Ignore our own messages
      const botUserId = await this.client.getUserId();
      if (sender === botUserId) return;

      if (content['body']) {
        const body = content['body'];
        const bodyLower = body.toLowerCase();

        if (bodyLower.includes('/call start') || bodyLower.includes('/voice start')) {
          const useLiveKit = bodyLower.includes('livekit') || bodyLower.includes('real');
          await this.startCall(roomId, useLiveKit);
        } else if (bodyLower.includes('/call end') || bodyLower.includes('/voice end')) {
          await this.endCall(roomId);
        } else if (bodyLower.includes('/call status') || bodyLower.includes('/voice status')) {
          await this.sendStatus(roomId);
        } else {
          // Process as voice input if there's an active call in this room
          const callState = this.activeCalls.get(roomId);
          if (callState?.isActive && !callState.isLiveKitCall) {
            await this.processVoiceInput(roomId, event);
          }
        }
      }
    }
  }

  /**
   * Handle MatrixRTC call member state events.
   * Supports both stable (m.call.member) and unstable (org.matrix.msc3401.call.member) formats.
   * Auto-joins LiveKit calls when detected.
   */
  async handleMatrixRTCEvent(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const stateKey = event['state_key'] || event['sender'] || '';
    const eventType = event['type'] || '';

    // Ignore our own events
    const botUserId = await this.client.getUserId();
    if (stateKey === botUserId || stateKey.startsWith(`_${botUserId}_`)) {
      return;
    }

    console.log(`[VoiceCallHandler] ${eventType} from ${stateKey} in ${roomId}`);

    // Extract LiveKit focus from either format:
    // Stable: content.memberships[].foci_active[].{type, livekit_service_url, livekit_alias}
    // MSC3401: content.foci_preferred[].{type, livekit_service_url, livekit_alias}
    const foci: any[] = [];

    // Stable format
    const memberships = content['memberships'] || [];
    for (const membership of memberships) {
      const fociActive = membership['foci_active'] || [];
      foci.push(...fociActive);
    }

    // MSC3401 unstable format
    const fociPreferred = content['foci_preferred'] || [];
    foci.push(...fociPreferred);

    for (const focus of foci) {
      if (focus['type'] === 'livekit') {
        const livekitServiceUrl = focus['livekit_service_url'];
        const livekitAlias = focus['livekit_alias'] || roomId;

        console.log(`[VoiceCallHandler] MatrixRTC LiveKit call detected in ${roomId}`);
        console.log(`[VoiceCallHandler] LiveKit service URL: ${livekitServiceUrl}, alias: ${livekitAlias}`);

        const existing = this.activeCalls.get(roomId);
        if (existing?.isActive && existing?.isLiveKitCall) {
          const existingAlias = existing.livekitAlias;
          if (existingAlias === livekitAlias) {
            console.log('[VoiceCallHandler] Already in this LiveKit call, skipping');
            return;
          }
          console.log(`[VoiceCallHandler] Switching to caller's LiveKit room: ${livekitAlias}`);
          await this.endCall(roomId);
        }

        await this.startLiveKitCall(roomId, livekitServiceUrl, livekitAlias);
        return;
      }
    }

    // Empty content means this user/device left the call — don't tear down
    // the bot's persistent call based on other users leaving
    if (Object.keys(content).length === 0) {
      console.log(`[VoiceCallHandler] ${stateKey} left the call (empty content), bot stays active`);
    }
  }

  /**
   * Handle legacy m.call.invite (Element native call button / WebRTC signalling).
   * Responds with m.call.answer to accept the call, then starts a text-simulated session.
   */
  async handleCallInvite(roomId: string, event: any): Promise<void> {
    const sender = event['sender'];
    const botUserId = await this.client.getUserId();
    if (sender === botUserId) return;

    const content = event['content'] || {};
    const callId = content['call_id'];

    console.log(`[VoiceCallHandler] Legacy m.call.invite from ${sender}, call_id=${callId} — redirecting to LiveKit`);

    // Decline the legacy WebRTC call (bot can't do peer-to-peer WebRTC)
    await this.client.sendEvent(roomId, 'm.call.hangup', {
      call_id: callId,
      party_id: 'BOT',
      version: '1',
      reason: 'user_hangup',
    });

    // If already in a LiveKit call, tell user to use the native Join Call button
    if (this.activeCalls.get(roomId)?.isActive) {
      console.log('[VoiceCallHandler] Already in LiveKit call');
      await this.matrixService.sendMessage(roomId, 'Voice call is already active. Click **Join Call** above to connect.');
      return;
    }

    const liveKitService = this.matrixService.getLiveKitService();
    if (!liveKitService) {
      await this.matrixService.sendMessage(roomId, '⚠️ LiveKit not available. Use /call start to begin a text call.');
      return;
    }

    try {
      // Create LiveKit room and bot joins it
      const livekitRoomName = `matrix-voice-${roomId.replace(/[^a-zA-Z0-9]/g, '-')}`;
      const room = await liveKitService.createRoom(livekitRoomName);
      const token = await liveKitService.generateToken(room.name, `${botUserId}:VOICE_BOT`, true, true);

      const agent = new LiveKitAgentService(liveKitService);
      await agent.joinRoom(liveKitService.getUrl(), token);

      const callState: CallState = {
        isActive: true,
        roomId,
        lastActivity: new Date(),
        isLiveKitCall: true,
        livekitAgent: agent,
      };

      await this.initializeAudioPipeline(roomId, callState);
      this.activeCalls.set(roomId, callState);

      // Publish call member events so Element shows "Join Call" button
      // Use Matrix room ID as alias — lk-jwt-service hashes it to match the actual LiveKit room name
      const livekitServiceUrl = config.livekit.jwtServiceUrl || liveKitService.getUrl().replace('ws://', 'http://').replace('wss://', 'https://');
      await this.publishCallMemberEvents(roomId, livekitServiceUrl, roomId, 3600);
      await this.matrixService.sendMessage(roomId, '📞 Voice call ready! Click **Join Call** above to connect. I\'m listening with Whisper and will respond with Chatterbox TTS.');
    } catch (error: any) {
      console.error('[VoiceCallHandler] Error setting up LiveKit call:', error.message);
      await this.matrixService.sendMessage(roomId, `❌ Failed to start voice call: ${error.message}`);
    }
  }

  /**
   * Handle legacy m.call.hangup.
   */
  async handleCallHangup(roomId: string, event: any): Promise<void> {
    const sender = event['sender'];
    const botUserId = await this.client.getUserId();
    if (sender === botUserId) return;

    const callId = event['content']?.['call_id'];
    console.log(`[VoiceCallHandler] Legacy m.call.hangup from ${sender}, call_id=${callId}`);

    const existing = this.activeCalls.get(roomId);
    if (existing?.isActive && !existing?.isLiveKitCall) {
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
      // Hash the alias to match lk-jwt-service's room naming
      const hashedAlias = liveKitService.hashRoomName(livekitAlias);
      console.log(`[VoiceCallHandler] Joining hashed LiveKit room: ${livekitAlias} -> ${hashedAlias}`);
      const token = await liveKitService.generateToken(hashedAlias, `${botUserId}:VOICE_BOT`, true, true);

      const agent = new LiveKitAgentService(liveKitService);
      // Always use the bot's configured LiveKit WS URL (livekitUrl param may be a JWT service URL)
      const wsUrl = liveKitService.getUrl();
      await agent.joinRoom(wsUrl, token);

      const callState: CallState = {
        isActive: true,
        roomId,
        lastActivity: new Date(),
        isLiveKitCall: true,
        livekitAgent: agent,
        livekitAlias,
      };

      await this.initializeAudioPipeline(roomId, callState);

      this.activeCalls.set(roomId, callState);

      // Persist session for recovery
      await this.callStore.addSession({
        roomId,
        isLiveKitCall: true,
        livekitUrl: wsUrl,
        livekitAlias: livekitAlias,
        startedAt: new Date().toISOString(),
      });

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
          const token = await liveKitService.generateToken(room.name, `${botUserId}:VOICE_BOT`, true, true);

          const agent = new LiveKitAgentService(liveKitService);
          await agent.joinRoom(liveKitService.getUrl(), token);

          callState.isLiveKitCall = true;
          callState.livekitAgent = agent;
          callState.livekitAlias = roomId; // Store unhashed alias to match MSC3401 events

          await this.initializeAudioPipeline(roomId, callState);

          // Post call member events so Element shows "Join Call" button automatically
          const livekitServiceUrl = config.livekit.jwtServiceUrl || liveKitService.getUrl().replace('ws://', 'http://').replace('wss://', 'https://');
          await this.publishCallMemberEvents(roomId, livekitServiceUrl, roomId, 86400);

          await this.callStore.addSession({
            roomId,
            isLiveKitCall: true,
            livekitUrl: liveKitService.getUrl(),
            livekitAlias: room.name,
            startedAt: new Date().toISOString(),
          });

          console.log(`[VoiceCallHandler] LiveKit call started in ${roomId}`);
        } catch (error: any) {
          console.error('[VoiceCallHandler] Error starting LiveKit call:', error.message);
          callState.isLiveKitCall = false;
        }
      }
    }

    this.activeCalls.set(roomId, callState);

    const message = callState.isLiveKitCall
      ? 'Voice call ready! Click **Join Call** above to connect.'
      : 'Voice call started. Send messages and I\'ll respond.';

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
      // If bot is speaking, check if this is a real barge-in or just echo
      if (callState.botSpeaking) {
        // Require minimum 400ms of speech to count as intentional barge-in
        // (echo/noise produces very short turns)
        if (event.durationMs >= 400) {
          console.log(`[VoiceCallHandler] Barge-in: ${event.durationMs}ms speech while bot speaking`);
          callState.livekitAgent?.stopPublishing();
          callState.turnProcessor?.cancel();
          if (callState.ttsPlaybackTimer) clearTimeout(callState.ttsPlaybackTimer);
          callState.botSpeaking = false;
          // Process this turn as the new user input
        } else {
          console.log(`[VoiceCallHandler] Ignoring short turn (${event.durationMs}ms) while bot speaking (echo suppression)`);
          return;
        }
      }

      console.log('[VoiceCallHandler] Turn complete event, processing...');

      // Release active speaker lock in the mux so next person can speak
      if (callState.livekitAgent) {
        const ingress = pipeline.getIngress();
        if (ingress && 'turnCompleted' in ingress) {
          (ingress as LiveKitAudioIngress).turnCompleted();
        }
      }

      await turnProcessor.handleTurnCompletion(event);
    });

    // Route TTS audio to LiveKit or Matrix
    turnProcessor.on('tts.audio', async (event: any) => {
      console.log('[VoiceCallHandler] TTS audio ready');
      try {
        if (callState.livekitAgent && callState.livekitAgent.isConnected()) {
          // Read actual sample rate from WAV header (bytes 24-27, little-endian uint32)
          const wavSampleRate = event.audioData.readUInt32LE(24);
          // Strip WAV header (44 bytes) to get raw PCM
          const pcmData = event.audioData.slice(44);
          console.log(`[VoiceCallHandler] TTS WAV: ${wavSampleRate}Hz, ${pcmData.length} PCM bytes`);

          // Track bot speaking state for barge-in and echo suppression
          callState.botSpeaking = true;
          if (callState.ttsPlaybackTimer) clearTimeout(callState.ttsPlaybackTimer);

          await callState.livekitAgent.publishAudioBuffer(pcmData, wavSampleRate);

          // Keep botSpeaking true briefly after publishing to suppress
          // echo from speakers → mic feedback loop
          callState.ttsPlaybackTimer = setTimeout(() => {
            callState.botSpeaking = false;
          }, 1500);
        } else {
          await this.matrixService.sendAudio(roomId, event.audioData, event.mimeType);
        }
      } catch (error: any) {
        callState.botSpeaking = false;
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

    // Prevent unhandled error crashes from pipeline (e.g. LiveKit InvalidState)
    pipeline.on('error', (error: any) => {
      console.error('[VoiceCallHandler] Audio pipeline error (non-fatal):', error.message);
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
      if (callState.ttsPlaybackTimer) clearTimeout(callState.ttsPlaybackTimer);

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
      await this.callStore.removeSession(roomId);
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

  /**
   * Publish call member state events in both stable and MSC3401 formats
   * so that all Element clients can see the bot in the call.
   */
  private async publishCallMemberEvents(roomId: string, livekitServiceUrl: string, livekitAlias: string, expiresSeconds: number): Promise<void> {
    const botUserId = await this.client.getUserId();

    // Stable format (m.call.member)
    await this.client.sendStateEvent(roomId, 'm.call.member', botUserId, {
      memberships: [{
        call_id: '',
        scope: 'm.room',
        application: 'm.call',
        device_id: 'VOICE_BOT',
        expires: Math.floor(Date.now() / 1000) + expiresSeconds,
        foci_active: [{
          type: 'livekit',
          livekit_service_url: livekitServiceUrl,
          livekit_alias: livekitAlias,
        }],
      }],
    });

    // MSC3401 unstable format (org.matrix.msc3401.call.member)
    const msc3401StateKey = `_${botUserId}_VOICE_BOT_m.call`;
    await this.client.sendStateEvent(roomId, 'org.matrix.msc3401.call.member', msc3401StateKey, {
      application: 'm.call',
      call_id: '',
      scope: 'm.room',
      device_id: 'VOICE_BOT',
      expires: expiresSeconds * 1000,
      focus_active: {
        type: 'livekit',
        focus_selection: 'oldest_membership',
      },
      foci_preferred: [{
        type: 'livekit',
        livekit_service_url: livekitServiceUrl,
        livekit_alias: livekitAlias,
      }],
    });

    console.log(`[VoiceCallHandler] Published call member events (stable + MSC3401), LiveKit alias: ${livekitAlias}`);
  }

  getActiveCall(roomId: string): CallState | undefined {
    return this.activeCalls.get(roomId);
  }

  getActiveCallCount(): number {
    return Array.from(this.activeCalls.values()).filter(c => c.isActive).length;
  }

  getAllCallStates(): Map<string, CallState> {
    return new Map(this.activeCalls);
  }
}
