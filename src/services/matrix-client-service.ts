import { MatrixClient, AutojoinRoomsMixin, SimpleFsStorageProvider } from 'matrix-bot-sdk';
import { config } from '../config/index.js';
import { OpenClawService } from './openclaw-service.js';
import { ChatterboxTTSService } from './chatterbox-tts-service.js';
import { VoiceCallHandler } from '../handlers/voice-call-handler.js';
import { LiveKitService } from './livekit-service.js';

export class MatrixClientService {
  private client: MatrixClient;
  private voiceCallHandler: VoiceCallHandler;
  private liveKitService: LiveKitService | null;
  private isRunning = false;

  constructor(
    homeserver: string,
    accessToken: string,
    userId: string,
    openClawService: OpenClawService,
    ttsService: ChatterboxTTSService
  ) {
    const storage = new SimpleFsStorageProvider('./bot-storage.json');
    this.client = new MatrixClient(homeserver, accessToken, storage);

    // Initialize LiveKit service if enabled
    this.liveKitService = null;

    if (config.livekit.enabled) {
      this.liveKitService = new LiveKitService({
        url: config.livekit.url,
        apiKey: config.livekit.apiKey,
        apiSecret: config.livekit.apiSecret,
      });
    }

    // Create handler after client is initialized
    this.voiceCallHandler = new VoiceCallHandler(this, openClawService, ttsService);
  }

  /**
   * Start the Matrix client and begin listening for events
   */
  async start(): Promise<void> {
    console.log('Starting Matrix client...');

    AutojoinRoomsMixin.setupOnClient(this.client);

    this.setupEventHandlers();

    // Start LiveKit service if enabled
    if (this.liveKitService) {
      await this.liveKitService.start();
      console.log('LiveKit service started');
    }

    // Start syncing
    await this.client.start();
    this.isRunning = true;

    console.log('Matrix client started successfully');
    const userId = await this.client.getUserId();
    console.log(`Listening for events as: ${userId}`);

    // Poll room state for m.call.member (matrix-bot-sdk doesn't emit state events from sync)
    this.startCallMemberPoller();

    // Auto-start LiveKit call in configured room so Element sees it immediately
    if (config.matrix.voiceCallRoomId) {
      setTimeout(() => this.autoStartVoiceRoom(config.matrix.voiceCallRoomId!), 2000);
    }
  }

  private async autoStartVoiceRoom(roomId: string): Promise<void> {
    console.log(`[MatrixClientService] Auto-starting persistent voice room: ${roomId}`);
    try {
      const existing = this.voiceCallHandler.getActiveCall(roomId);
      if (existing?.isActive) {
        console.log('[MatrixClientService] Voice room already active, skipping auto-start');
        return;
      }
      await this.voiceCallHandler.startCall(roomId, true);
    } catch (err: any) {
      console.error('[MatrixClientService] Auto-start voice room error:', err.message);
    }
  }

  /**
   * Stop the Matrix client. Drains active calls first.
   */
  async stop(): Promise<void> {
    console.log('Stopping Matrix client...');

    // Drain active calls before shutting down
    try {
      await this.voiceCallHandler.endAllCalls();
    } catch (error) {
      console.error('Error draining active calls:', error);
    }

    // Stop LiveKit service if running
    if (this.liveKitService) {
      this.liveKitService.stop();
    }

    this.client.stop();
    this.isRunning = false;
  }

  isRunningStatus(): boolean {
    return this.isRunning;
  }

  getClient(): MatrixClient {
    return this.client;
  }

  getVoiceCallHandler(): VoiceCallHandler {
    return this.voiceCallHandler;
  }

  getLiveKitService(): LiveKitService | null {
    return this.liveKitService;
  }

  private callMemberPollInterval: ReturnType<typeof setInterval> | null = null;
  private lastCallMemberContent: Map<string, string> = new Map();

  private startCallMemberPoller(): void {
    this.callMemberPollInterval = setInterval(async () => {
      try {
        const rooms = await this.client.getJoinedRooms();
        for (const roomId of rooms) {
          try {
            const stateEvents = await this.client.getRoomState(roomId);
            for (const event of stateEvents) {
              if (event['type'] === 'm.call.member' || event['type'] === 'org.matrix.msc3401.call.member') {
                const key = `${roomId}:${event['state_key']}`;
                const serialized = JSON.stringify(event['content']);
                if (this.lastCallMemberContent.get(key) !== serialized) {
                  this.lastCallMemberContent.set(key, serialized);
                  console.log(`[MatrixClientService] Detected m.call.member state change in ${roomId}`);
                  await this.voiceCallHandler.handleEvent(roomId, event);
                }
              }
            }
          } catch (_) { /* room may not be accessible */ }
        }
      } catch (err) {
        console.error('[MatrixClientService] Call member poller error:', err);
      }
    }, 2000);
    console.log('[MatrixClientService] m.call.member state poller started (2s interval)');
  }

  private setupEventHandlers(): void {
    this.client.on('room.message', async (roomId, event) => {
      try {
        if (event['m.relates_to']?.rel_type === 'm.reference') {
          await this.voiceCallHandler.handleReference(roomId, event);
        } else if (event['content']?.['m.reply_to']) {
          await this.voiceCallHandler.handleReply(roomId, event);
        }
      } catch (error) {
        console.error('Error handling room message:', error);
      }
    });

    this.client.on('room.event', async (roomId, event) => {
      try {
        await this.voiceCallHandler.handleEvent(roomId, event);
      } catch (error) {
        console.error('Error handling room event:', error);
      }
    });

    // Handle state events (m.call.member for MatrixRTC/Element Call)
    this.client.on('room.state.updated', async (roomId: string, event: any) => {
      try {
        await this.voiceCallHandler.handleEvent(roomId, event);
      } catch (error) {
        console.error('Error handling room state event:', error);
      }
    });

    this.client.on('room.encryptionError', async (roomId, event) => {
      console.error('Encryption error in room:', roomId, event);
    });
  }

  async joinRoom(roomIdOrAlias: string): Promise<string> {
    return this.client.joinRoom(roomIdOrAlias);
  }

  async sendMessage(roomId: string, text: string): Promise<void> {
    await this.client.sendText(roomId, text);
  }

  async sendAudio(roomId: string, audioData: Buffer, mimeType: string): Promise<void> {
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
  }
}

export function createMatrixClientService(
  openClawService: OpenClawService,
  ttsService: ChatterboxTTSService
): MatrixClientService {
  return new MatrixClientService(
    config.matrix.homeserver,
    config.matrix.accessToken,
    config.matrix.userId,
    openClawService,
    ttsService
  );
}
