import { MatrixClient } from 'matrix-bot-sdk';
import { EventEmitter } from 'events';
import { AudioPipelineService, AudioFrame } from './audio-pipeline.js';

/**
 * Matrix Call Media Service
 * 
 * Provides the plumbing for inbound/outbound audio streams in Matrix voice calls.
 * This is Phase 2 implementation toward real voice call support.
 * 
 * Current Implementation (Phase 2):
 * - Matrix call event handling (m.call.invite, m.call.media, etc.)
 * - Call state management for WebRTC sessions
 * - Audio stream routing stubs (ready for STT/TTS integration)
 * - Media upload/download helpers
 * 
 * Phase 4 Integration:
 * - AudioPipelineService for real audio frame handling
 * - Loopback path for testing audio flow
 * - STT/TTS integration points
 * 
 * Limitations (to be addressed in Phase 3+):
 * - WebRTC peer connection not yet established (requires browser/worker environment)
 * - Real-time audio capture/playback not implemented
 * - STT integration pending (Whisper/Vosk)
 */

export interface CallSession {
  callId: string;
  roomId: string;
  state: 'invited' | 'connecting' | 'connected' | 'disconnected' | 'ended';
  createdAt: Date;
  endedAt?: Date;
  peerUserId?: string;
  // WebRTC placeholders (Phase 3+)
  peerConnection?: any; // RTCPeerConnection
  localStream?: any; // MediaStream
  remoteStream?: any; // MediaStream
}

export interface CallMediaEvent {
  type: 'audio' | 'video';
  direction: 'inbound' | 'outbound';
  timestamp: Date;
  // Audio data placeholders
  sampleRate?: number;
  channels?: number;
  duration?: number; // milliseconds
}

export class MatrixCallMediaService extends EventEmitter {
  private client: MatrixClient;
  private callSessions: Map<string, CallSession>;
  private isRunning: boolean;
  private audioPipeline: AudioPipelineService | null = null;

  constructor(client: MatrixClient, audioPipeline?: AudioPipelineService) {
    super();
    this.client = client;
    this.callSessions = new Map();
    this.isRunning = false;
    this.audioPipeline = audioPipeline || null;
  }

  /**
   * Start the call media service and listen for call events
   */
  async start(): Promise<void> {
    console.log('[CallMedia] Starting call media service...');
    
    this.setupCallEventHandlers();
    this.isRunning = true;
    
    console.log('[CallMedia] Call media service started');
  }

  /**
   * Stop the call media service
   */
  stop(): void {
    console.log('[CallMedia] Stopping call media service...');
    this.isRunning = false;
    this.callSessions.clear();
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get active call session by room ID
   */
  getCallSessionByRoom(roomId: string): CallSession | undefined {
    return this.callSessions.get(roomId);
  }

  /**
   * Get all active call sessions
   */
  getAllCallSessions(): Map<string, CallSession> {
    return new Map(this.callSessions);
  }

  /**
   * Handle incoming call invite (m.call.invite)
   * Phase 2: Log and accept call, store session state
 * Phase 3+: Establish WebRTC peer connection
   */
  async handleCallInvite(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const callId = content['call_id'];
    const sender = event['sender'];

    if (!callId) {
      console.warn('[CallMedia] Call invite without call_id in', roomId);
      return;
    }

    console.log(`[CallMedia] Received call invite ${callId} from ${sender} in ${roomId}`);

    // Create call session
    const session: CallSession = {
      callId,
      roomId,
      state: 'invited',
      createdAt: new Date(),
      peerUserId: sender,
    };

    this.callSessions.set(roomId, session);
    this.emit('call.invited', { session, event });

    // Phase 2: Auto-accept call (send m.call.answer)
    // Phase 3+: This would include SDP offer/answer exchange
    await this.acceptCall(roomId, callId);
  }

  /**
   * Accept a call and send answer
   * Phase 2: Send basic answer event
   * Phase 3+: Include SDP answer and ICE candidates
   */
  private async acceptCall(roomId: string, callId: string): Promise<void> {
    console.log(`[CallMedia] Accepting call ${callId} in ${roomId}`);

    const session = this.callSessions.get(roomId);
    if (session) {
      session.state = 'connecting';
    }

    // Send call answer event
    // Phase 2: Stub implementation
    // Phase 3+: Include SDP answer and media configuration
    await this.client.sendEvent(roomId, 'm.call.answer', {
      call_id: callId,
      // Phase 3+: Add SDP answer
      // answer: { ... }
    });

    console.log(`[CallMedia] Call answer sent for ${callId}`);
    this.emit('call.connecting', { roomId, callId });
  }

  /**
   * Handle call media events (m.call.media)
   * Phase 2: Log media events, store metadata
 * Phase 3+: Process actual audio streams
   */
  async handleCallMedia(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const callId = content['call_id'];
    const mediaType = content['media_type'] || 'audio';

    if (!callId) {
      return;
    }

    console.log(`[CallMedia] Received ${mediaType} media for call ${callId} in ${roomId}`);

    const session = this.callSessions.get(roomId);
    if (!session) {
      console.warn('[CallMedia] Media event for unknown call in', roomId);
      return;
    }

    // Create media event record
    const mediaEvent: CallMediaEvent = {
      type: mediaType as 'audio' | 'video',
      direction: 'inbound',
      timestamp: new Date(),
      sampleRate: content['sample_rate'] || 16000,
      channels: content['channels'] || 1,
      duration: content['duration'],
    };

    this.emit('media.inbound', { session, event, mediaEvent });

    // Phase 2: Log only
    // Phase 3+: Pass audio data to STT service
    if (mediaEvent.type === 'audio') {
      console.log(`[CallMedia] Inbound audio: ${mediaEvent.duration}ms @ ${mediaEvent.sampleRate}Hz`);
    }
  }

  /**
   * Handle call hangup events
   */
  async handleCallHangup(roomId: string, event: any): Promise<void> {
    const content = event['content'] || {};
    const callId = content['call_id'];
    const reason = content['reason'] || 'Unknown reason';

    console.log(`[CallMedia] Call ${callId} ended in ${roomId}: ${reason}`);

    const session = this.callSessions.get(roomId);
    if (session) {
      session.state = 'ended';
      session.endedAt = new Date();
      this.callSessions.set(roomId, session);
    }

    this.emit('call.ended', { roomId, callId, reason });
  }

  /**
   * Start an outbound call in a room
   * Phase 2: Send call invite event
   * Phase 3+: Include SDP offer and media capabilities
   */
  async startCall(roomId: string): Promise<string> {
    console.log(`[CallMedia] Starting outbound call in ${roomId}`);

    const callId = this.generateCallId();
    const session: CallSession = {
      callId,
      roomId,
      state: 'connecting',
      createdAt: new Date(),
    };

    this.callSessions.set(roomId, session);
    this.emit('call.initiated', { session });

    // Send call invite event
    // Phase 2: Basic invite without SDP
    // Phase 3+: Include SDP offer and ICE candidates
    await this.client.sendEvent(roomId, 'm.call.invite', {
      call_id: callId,
      // Phase 3+: Add SDP offer
      // offer: { ... }
      // Phase 3+: Add media capabilities
      // media: { ... }
    });

    console.log(`[CallMedia] Call invite sent: ${callId}`);
    return callId;
  }

  /**
   * End a call in a room
   */
  async endCall(roomId: string, reason = 'User ended call'): Promise<void> {
    console.log(`[CallMedia] Ending call in ${roomId}`);

    const session = this.callSessions.get(roomId);
    if (!session) {
      console.warn('[CallMedia] No call session to end in', roomId);
      return;
    }

    const callId = session.callId;

    // Send hangup event
    await this.client.sendEvent(roomId, 'm.call.hangup', {
      call_id: callId,
      reason,
    });

    session.state = 'disconnected';
    session.endedAt = new Date();
    this.callSessions.set(roomId, session);

    this.emit('call.hangup', { roomId, callId, reason });
  }

  /**
   * Send outbound audio to a call
   * Phase 2: Stub - log only
   * Phase 3+: Encode and send via WebRTC data channel or media stream
   * Phase 4: Use AudioPipeline for audio frame handling
   */
  async sendAudio(roomId: string, audioData: Buffer, mimeType: string): Promise<void> {
    const session = this.callSessions.get(roomId);
    if (!session) {
      console.warn('[CallMedia] No active call to send audio to in', roomId);
      return;
    }

    console.log(`[CallMedia] Sending ${audioData.length} bytes of outbound audio in ${roomId}`);

    // Phase 4: Use AudioPipeline if available
    if (this.audioPipeline?.isRunningFlag()) {
      try {
        await this.audioPipeline.sendOutboundAudio(audioData);
        console.log('[CallMedia] Audio sent via pipeline');
      } catch (error: any) {
        console.error('[CallMedia] Pipeline send error:', error.message);
      }
    }

    // Phase 2: Log only
    // Phase 3+: Send via WebRTC
    // - Encode audio to Opus
    // - Send through RTCPeerConnection
    // - Handle ICE/DTLS

    const mediaEvent: CallMediaEvent = {
      type: 'audio',
      direction: 'outbound',
      timestamp: new Date(),
      duration: audioData.length / 16000, // Rough estimate for 16kHz
    };

    this.emit('media.outbound', { session, audioData, mimeType, mediaEvent });
  }

  /**
   * Process inbound audio from audio pipeline
   * Phase 4: Bridge audio pipeline to call media service
   */
  async processInboundAudio(roomId: string, frame: AudioFrame): Promise<void> {
    const session = this.callSessions.get(roomId);
    if (!session) {
      console.warn('[CallMedia] No active call for inbound audio in', roomId);
      return;
    }

    console.log(`[CallMedia] Processing inbound audio frame: ${frame.data.length} bytes`);

    // Emit media event
    const mediaEvent: CallMediaEvent = {
      type: 'audio',
      direction: 'inbound',
      timestamp: new Date(),
      sampleRate: frame.sampleRate,
      channels: frame.channels,
      duration: frame.durationMs,
    };

    this.emit('media.inbound', { session, frame, mediaEvent });
  }

  /**
   * Set audio pipeline for audio frame handling
   * Phase 4: Connect audio pipeline to call media service
   */
  setAudioPipeline(pipeline: AudioPipelineService): void {
    this.audioPipeline = pipeline;
    console.log('[CallMedia] Audio pipeline attached');
  }

  /**
   * Get audio pipeline
   */
  getAudioPipeline(): AudioPipelineService | null {
    return this.audioPipeline;
  }

  /**
   * Upload audio file to Matrix media repository
   * Helper for sending audio messages (non-WebRTC)
   */
  async uploadAudio(roomId: string, audioData: Buffer, mimeType: string): Promise<void> {
    try {
      const mxcUri = await this.client.uploadContent(audioData, mimeType);

      await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.audio',
        body: 'Voice message',
        url: mxcUri,
        info: {
          mimetype: mimeType,
          size: audioData.length,
        },
      });

      console.log(`[CallMedia] Audio uploaded and sent to ${roomId}`);
    } catch (error) {
      console.error('[CallMedia] Error uploading audio:', error);
      throw error;
    }
  }

  /**
   * Set up event handlers for Matrix call events
   */
  private setupCallEventHandlers(): void {
    // Handle call invites
    this.client.on('room.event', async (roomId, event) => {
      try {
        const type = event['type'];

        if (type === 'm.call.invite') {
          await this.handleCallInvite(roomId, event);
        } else if (type === 'm.call.media') {
          await this.handleCallMedia(roomId, event);
        } else if (type === 'm.call.hangup') {
          await this.handleCallHangup(roomId, event);
        }
      } catch (error) {
        console.error('[CallMedia] Error handling call event:', error);
      }
    });

    // Handle encryption errors for call rooms
    this.client.on('room.encryptionError', (roomId, event) => {
      console.warn('[CallMedia] Encryption error in call room:', roomId, event);
    });
  }

  /**
   * Generate a unique call ID
   */
  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Get call statistics
   */
  getStats(): {
    activeCalls: number;
    totalCalls: number;
    running: boolean;
  } {
    const activeCalls = Array.from(this.callSessions.values()).filter(
      s => s.state === 'connected' || s.state === 'connecting'
    ).length;

    return {
      activeCalls,
      totalCalls: this.callSessions.size,
      running: this.isRunning,
    };
  }
}
