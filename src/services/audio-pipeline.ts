/**
 * Audio Pipeline Service
 *
 * Provides the core audio processing pipeline for real-time voice calls.
 * Supports pluggable ingress/egress transport (LiveKit, loopback for testing).
 *
 * Architecture:
 *
 * Ingress Path (User -> Bot):
 *   LiveKit Track -> AudioIngress -> VAD -> STT -> Text -> OpenClaw
 *
 * Egress Path (Bot -> User):
 *   OpenClaw -> TTS -> AudioEgress -> LiveKit Track
 *
 * Loopback Path (for testing):
 *   AudioIngress -> AudioEgress (direct pass-through)
 */

import { EventEmitter } from 'events';

/**
 * Audio frame representation
 */
export interface AudioFrame {
  data: Buffer;
  sampleRate: number;
  channels: number;
  format: string;
  timestamp: number;
  durationMs: number;
  sequenceNumber?: number;
}

/**
 * Audio ingress interface
 */
export interface AudioIngress {
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
  getFrame(): Promise<AudioFrame | null>;
  on(event: 'frame', listener: (frame: AudioFrame) => void): this;
  on(event: 'start', listener: () => void): this;
  on(event: 'stop', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Audio egress interface
 */
export interface AudioEgress {
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): boolean;
  sendFrame(frame: AudioFrame): Promise<void>;
  sendAudio(data: Buffer, sampleRate: number, channels: number): Promise<void>;
  on(event: 'start', listener: () => void): this;
  on(event: 'stop', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'frame.sent', listener: (frame: AudioFrame) => void): this;
}

/**
 * Turn completion event data
 */
export interface TurnCompletionEvent {
  turnId: string;
  frames: AudioFrame[];
  durationMs: number;
  timestamp: number;
}

/**
 * Audio pipeline configuration
 */
export interface AudioPipelineConfig {
  sampleRate: number;
  channels: number;
  format: string;
  frameDurationMs: number;
  loopbackEnabled: boolean;
  vadEnabled: boolean;
}

export const defaultAudioPipelineConfig: AudioPipelineConfig = {
  sampleRate: 16000,
  channels: 1,
  format: 'pcm16',
  frameDurationMs: 20,
  loopbackEnabled: false,
  vadEnabled: true,
};

/**
 * Loopback audio ingress (for testing)
 */
export class LoopbackIngress extends EventEmitter implements AudioIngress {
  private isActiveFlag: boolean = false;
  private frameQueue: AudioFrame[] = [];
  private config: AudioPipelineConfig;

  constructor(config: AudioPipelineConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    this.isActiveFlag = true;
    this.emit('start');
  }

  async stop(): Promise<void> {
    this.isActiveFlag = false;
    this.frameQueue = [];
    this.emit('stop');
  }

  isActive(): boolean {
    return this.isActiveFlag;
  }

  async getFrame(): Promise<AudioFrame | null> {
    if (this.frameQueue.length > 0) {
      return this.frameQueue.shift()!;
    }
    return null;
  }

  injectFrame(frame: AudioFrame): void {
    if (this.isActiveFlag) {
      this.frameQueue.push(frame);
      this.emit('frame', frame);
    }
  }
}

/**
 * Loopback audio egress (for testing)
 */
export class LoopbackEgress extends EventEmitter implements AudioEgress {
  private isActiveFlag: boolean = false;
  private sentFrames: AudioFrame[] = [];
  private config: AudioPipelineConfig;

  constructor(config: AudioPipelineConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    this.isActiveFlag = true;
    this.emit('start');
  }

  async stop(): Promise<void> {
    this.isActiveFlag = false;
    this.emit('stop');
  }

  isActive(): boolean {
    return this.isActiveFlag;
  }

  async sendFrame(frame: AudioFrame): Promise<void> {
    if (!this.isActiveFlag) {
      throw new Error('Egress not active');
    }
    this.sentFrames.push(frame);
    this.emit('frame.sent', frame);
  }

  async sendAudio(data: Buffer, sampleRate: number, channels: number): Promise<void> {
    const frame: AudioFrame = {
      data,
      sampleRate,
      channels,
      format: this.config.format,
      timestamp: Date.now(),
      durationMs: (data.length / (sampleRate * 2)) * 1000,
    };
    await this.sendFrame(frame);
  }

  getSentFrames(): AudioFrame[] {
    return [...this.sentFrames];
  }

  clearSentFrames(): void {
    this.sentFrames = [];
  }
}

/**
 * Audio Pipeline Service
 *
 * Orchestrates audio ingress and egress for voice calls.
 * Supports pluggable transport (LiveKit, loopback) and VAD integration.
 */
export class AudioPipelineService extends EventEmitter {
  private config: AudioPipelineConfig;
  private ingress: AudioIngress | null = null;
  private egress: AudioEgress | null = null;
  private isRunning: boolean = false;
  private frameCounter: number = 0;

  // VAD integration
  private vadService: any = null;
  private currentTurnFrames: AudioFrame[] = [];
  private currentTurnId: string | null = null;

  constructor(config?: Partial<AudioPipelineConfig>) {
    super();
    this.config = { ...defaultAudioPipelineConfig, ...config };
  }

  /**
   * Set a custom ingress (e.g., LiveKitAudioIngress)
   * Must be called before start() to override loopback default.
   */
  setIngress(ingress: AudioIngress): void {
    this.ingress = ingress;
    this.wireIngress();
    console.log('[AudioPipeline] Custom ingress set');
  }

  /**
   * Set a custom egress (e.g., LiveKitAudioEgress)
   * Must be called before start() to override loopback default.
   */
  setEgress(egress: AudioEgress): void {
    this.egress = egress;
    this.wireEgress();
    console.log('[AudioPipeline] Custom egress set');
  }

  /**
   * Initialize the audio pipeline.
   * Creates loopback ingress/egress only if no custom transport has been set.
   */
  async initialize(): Promise<void> {
    console.log('[AudioPipeline] Initializing audio pipeline...');

    // Only create loopback if no custom transport was injected
    if (!this.ingress) {
      this.ingress = new LoopbackIngress(this.config);
      this.wireIngress();
    }
    if (!this.egress) {
      this.egress = new LoopbackEgress(this.config);
      this.wireEgress();
    }

    console.log('[AudioPipeline] Audio pipeline initialized');
  }

  /**
   * Wire ingress frame events to the pipeline processing chain
   */
  private wireIngress(): void {
    if (!this.ingress) return;

    this.ingress.on('frame', async (frame) => {
      this.frameCounter++;

      // Process frame through VAD if enabled
      if (this.config.vadEnabled && this.vadService) {
        this.processFrameThroughVAD(frame);
      }

      // Forward to egress (loopback path)
      if (this.egress?.isActive()) {
        try {
          await this.egress.sendFrame(frame);
        } catch (error: any) {
          console.error('[AudioPipeline] Error sending frame to egress:', error.message);
          this.emit('error', error);
        }
      }
    });
  }

  /**
   * Wire egress events
   */
  private wireEgress(): void {
    if (!this.egress) return;

    this.egress.on('frame.sent', (frame) => {
      this.emit('frame.sent', frame);
    });

    this.egress.on('error', (error) => {
      this.emit('error', error);
    });
  }

  async start(): Promise<void> {
    console.log('[AudioPipeline] Starting audio pipeline...');

    if (!this.ingress || !this.egress) {
      throw new Error('Audio pipeline not initialized. Call initialize() first.');
    }

    await this.ingress.start();
    await this.egress.start();

    this.isRunning = true;
    this.emit('start');

    console.log('[AudioPipeline] Audio pipeline started');
  }

  async stop(): Promise<void> {
    console.log('[AudioPipeline] Stopping audio pipeline...');

    this.isRunning = false;

    if (this.ingress) {
      await this.ingress.stop();
    }
    if (this.egress) {
      await this.egress.stop();
    }

    this.emit('stop');
    console.log('[AudioPipeline] Audio pipeline stopped');
  }

  isRunningFlag(): boolean {
    return this.isRunning;
  }

  getIngress(): AudioIngress | null {
    return this.ingress;
  }

  getEgress(): AudioEgress | null {
    return this.egress;
  }

  /**
   * Inject audio into the pipeline (for testing via loopback ingress)
   */
  async injectInboundAudio(data: Buffer, sampleRate?: number, channels?: number): Promise<void> {
    if (!this.ingress?.isActive()) {
      throw new Error('Ingress not active');
    }

    const frame: AudioFrame = {
      data,
      sampleRate: sampleRate || this.config.sampleRate,
      channels: channels || this.config.channels,
      format: this.config.format,
      timestamp: Date.now(),
      durationMs: (data.length / ((sampleRate || this.config.sampleRate) * 2)) * 1000,
      sequenceNumber: this.frameCounter,
    };

    (this.ingress as LoopbackIngress).injectFrame(frame);
  }

  /**
   * Send audio through the egress
   */
  async sendOutboundAudio(data: Buffer, sampleRate?: number, channels?: number): Promise<void> {
    if (!this.egress?.isActive()) {
      const error = new Error('Egress not active');
      this.emit('error', error);
      throw error;
    }

    await this.egress.sendAudio(data, sampleRate || this.config.sampleRate, channels || this.config.channels);
  }

  getStats(): {
    running: boolean;
    frameCounter: number;
    ingressActive: boolean;
    egressActive: boolean;
    loopbackEnabled: boolean;
    vadEnabled: boolean;
    currentTurnId: string | null;
  } {
    return {
      running: this.isRunning,
      frameCounter: this.frameCounter,
      ingressActive: this.ingress?.isActive() || false,
      egressActive: this.egress?.isActive() || false,
      loopbackEnabled: this.ingress instanceof LoopbackIngress,
      vadEnabled: this.config.vadEnabled,
      currentTurnId: this.currentTurnId,
    };
  }

  // ========================================================================
  // VAD Integration
  // ========================================================================

  setVadService(vadService: any): void {
    this.vadService = vadService;
    console.log('[AudioPipeline] VAD service attached');

    if (this.vadService) {
      this.vadService.on('speech.start', (event: any) => {
        console.log(`[AudioPipeline] Speech started: ${event.turnId}`);
        this.currentTurnId = event.turnId;
        this.currentTurnFrames = [];
      });

      this.vadService.on('vad.frame', (event: any) => {
        if (this.currentTurnId && event.isSpeech) {
          this.currentTurnFrames.push(event.frame);
        }
      });

      this.vadService.on('turn.end', async (event: any) => {
        console.log(`[AudioPipeline] Turn completed: ${event.turnId}`);
        await this.emitTurnCompletion(event.turnId);
      });
    }
  }

  private processFrameThroughVAD(frame: AudioFrame): void {
    if (!this.vadService || !this.vadService.isActive()) {
      return;
    }

    this.vadService.processFrame(frame);
  }

  private async emitTurnCompletion(turnId: string): Promise<void> {
    const durationMs = this.currentTurnFrames.length * this.config.frameDurationMs;

    const turnEvent: TurnCompletionEvent = {
      turnId,
      frames: [...this.currentTurnFrames],
      durationMs,
      timestamp: Date.now(),
    };

    this.currentTurnId = null;
    this.currentTurnFrames = [];

    console.log(`[AudioPipeline] Emitting turn completion: ${turnId} (${durationMs}ms, ${turnEvent.frames.length} frames)`);
    this.emit('turn.complete', turnEvent);
  }

  getVadService(): any {
    return this.vadService;
  }

  isVadIntegrated(): boolean {
    return this.config.vadEnabled && this.vadService !== null;
  }
}
