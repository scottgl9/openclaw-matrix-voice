import { MatrixClient, AutojoinRoomsMixin, SimpleFsStorageProvider } from 'matrix-bot-sdk';
import { config } from '../config/index.js';
import { OpenClawService } from './openclaw-service.js';
import { ChatterboxTTSService } from './chatterbox-tts-service.js';
import { VoiceCallHandler } from '../handlers/voice-call-handler.js';

export class MatrixClientService {
  private client: MatrixClient;
  private voiceCallHandler: VoiceCallHandler;
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
    // Create handler after client is initialized
    this.voiceCallHandler = new VoiceCallHandler(this, openClawService, ttsService);
  }

  /**
   * Start the Matrix client and begin listening for events
   */
  async start(): Promise<void> {
    console.log('Starting Matrix client...');
    
    // Enable auto-join for invited rooms
    AutojoinRoomsMixin.setupOnClient(this.client);

    // Set up event handlers
    this.setupEventHandlers();

    // Start syncing
    await this.client.start();
    this.isRunning = true;

    console.log('Matrix client started successfully');
    console.log(`Listening for events as: ${this.client.getUserId()}`);
  }

  /**
   * Stop the Matrix client
   */
  stop(): void {
    console.log('Stopping Matrix client...');
    this.client.stop();
    this.isRunning = false;
  }

  /**
   * Check if client is running
   */
  isRunningStatus(): boolean {
    return this.isRunning;
  }

  /**
   * Get the Matrix client instance
   */
  getClient(): MatrixClient {
    return this.client;
  }

  /**
   * Set up event handlers for voice calls
   */
  private setupEventHandlers(): void {
    // Handle room messages
    this.client.on('room.message', async (roomId, event) => {
      try {
        // Check if this is a voice call related message
        if (event['m.relates_to']?.rel_type === 'm.reference') {
          await this.voiceCallHandler.handleReference(roomId, event);
        } else if (event['content']?.['m.reply_to']) {
          await this.voiceCallHandler.handleReply(roomId, event);
        }
      } catch (error) {
        console.error('Error handling room message:', error);
      }
    });

    // Handle room events (for call control)
    this.client.on('room.event', async (roomId, event) => {
      try {
        await this.voiceCallHandler.handleEvent(roomId, event);
      } catch (error) {
        console.error('Error handling room event:', error);
      }
    });

    // Handle encryption errors
    this.client.on('room.encryptionError', async (roomId, event) => {
      console.error('Encryption error in room:', roomId, event);
    });
  }

  /**
   * Join a specific room
   */
  async joinRoom(roomIdOrAlias: string): Promise<string> {
    return this.client.joinRoom(roomIdOrAlias);
  }

  /**
   * Send a text message to a room
   */
  async sendMessage(roomId: string, text: string): Promise<void> {
    await this.client.sendText(roomId, text);
  }

  /**
   * Send an audio message (voice note) to a room
   */
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
