import { MatrixClient } from 'matrix-bot-sdk';
import { OpenClawService } from '../services/openclaw-service.js';
import { ChatterboxTTSService } from '../services/chatterbox-tts-service.js';
import { MatrixClientService } from '../services/matrix-client-service.js';

export interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  transcription?: string;
}

export class VoiceCallHandler {
  private matrixService: MatrixClientService;
  private client: MatrixClient;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private activeCalls: Map<string, CallState> = new Map();

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
    
    // Handle call control events
    if (type === 'm.room.message') {
      const content = event['content'] || {};
      const msgtype = content['msgtype'];
      
      // Check for voice call commands
      if (content['body']) {
        const body = content['body'].toLowerCase();
        
        if (body.includes('/call start') || body.includes('/voice start')) {
          await this.startCall(roomId);
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
   */
  async startCall(roomId: string): Promise<void> {
    console.log(`Starting voice call in ${roomId}`);
    
    this.activeCalls.set(roomId, {
      isActive: true,
      roomId,
      lastActivity: new Date(),
    });

    await this.matrixService.sendMessage(roomId, '🎤 Voice call started. Speak clearly and I\'ll respond.');
  }

  /**
   * End a voice call in a room
   */
  async endCall(roomId: string): Promise<void> {
    console.log(`Ending voice call in ${roomId}`);
    
    const callState = this.activeCalls.get(roomId);
    if (callState) {
      callState.isActive = false;
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
}
