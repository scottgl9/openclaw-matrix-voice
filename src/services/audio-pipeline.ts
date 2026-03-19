/**
 * Audio Pipeline Service
 * 
 * Provides the core audio processing pipeline for real-time voice calls.
 * This is the Phase 4 implementation that bridges STT/TTS with LiveKit/Matrix media.
 * 
 * Phase 4 Goals:
 * - Define audio ingress/egress abstractions for media frame handling
 * - Implement a minimal loopback/bridge path for audio frame flow
 * - Integrate with existing call lifecycle and fallback logic
 * - Prepare for STT -> OpenClaw -> TTS live call path
 * 
 * Architecture:
 * 
 * Ingress Path (User -> Bot):
 *   LiveKit Track → AudioIngress → STT (future) → Text → OpenClaw
 * 
 * Egress Path (Bot -> User):
 *   OpenClaw → TTS → AudioEgress → LiveKit Track
 * 
 * Loopback Path (for testing/plumbing):
 *   AudioIngress → AudioEgress (direct pass-through)
 */

import { EventEmitter } from 'events';

/**
 * Audio frame representation
 * PCM audio data with metadata for processing
 */
export interface AudioFrame {
  /** Raw PCM audio data (16-bit linear PCM) */
  data: Buffer;
  
  /** Sample rate in Hz (typically 16000 or 48000) */
  sampleRate: number;
  
  /** Number of audio channels (1=mono, 2=stereo) */
  channels: number;
  
  /** Sample format (pcm16, float32, etc.) */
  format: string;
  
  /** Timestamp in milliseconds since epoch */
  timestamp: number;
  
  /** Duration of this frame in milliseconds */
  durationMs: number;
  
  /** Optional sequence number for ordering */
  sequenceNumber?: number;
}

/**
 * Audio ingress interface
 * Receives audio from external sources (LiveKit, WebRTC, etc.)
 */
export interface AudioIngress {
  /** Start receiving audio */
  start(): Promise<void>;
  
  /** Stop receiving audio */
  stop(): Promise<void>;
  
  /** Check if ingress is active */
  isActive(): boolean;
  
  /** Get the current audio frame (for pull-based systems) */
  getFrame(): Promise<AudioFrame | null>;
  
  /** Event: New audio frame received */
  on(event: 'frame', listener: (frame: AudioFrame) => void): this;
  
  /** Event: Ingress started */
  on(event: 'start', listener: () => void): this;
  
  /** Event: Ingress stopped */
  on(event: 'stop', listener: () => void): this;
  
  /** Event: Error occurred */
  on(event: 'error', listener: (error: Error) => void): this;
}

/**
 * Audio egress interface
 * Sends audio to external destinations (LiveKit, WebRTC, etc.)
 */
export interface AudioEgress {
  /** Start sending audio */
  start(): Promise<void>;
  
  /** Stop sending audio */
  stop(): Promise<void>;
  
  /** Check if egress is active */
  isActive(): boolean;
  
  /** Send an audio frame */
  sendFrame(frame: AudioFrame): Promise<void>;
  
  /** Send raw audio data (convenience method) */
  sendAudio(data: Buffer, sampleRate: number, channels: number): Promise<void>;
  
  /** Event: Egress started */
  on(event: 'start', listener: () => void): this;
  
  /** Event: Egress stopped */
  on(event: 'stop', listener: () => void): this;
  
  /** Event: Error occurred */
  on(event: 'error', listener: (error: Error) => void): this;
  
  /** Event: Frame sent */
  on(event: 'frame.sent', listener: (frame: AudioFrame) => void): this;
}

/**
 * Audio pipeline configuration
 */
export interface AudioPipelineConfig {
  /** Sample rate for audio processing */
  sampleRate: number;
  
  /** Number of channels */
  channels: number;
  
  /** Audio format */
  format: string;
  
  /** Frame duration in milliseconds */
  frameDurationMs: number;
  
  /** Enable loopback mode (for testing) */
  loopbackEnabled: boolean;
}

/**
 * Default audio pipeline configuration
 */
export const defaultAudioPipelineConfig: AudioPipelineConfig = {
  sampleRate: 16000,
  channels: 1,
  format: 'pcm16',
  frameDurationMs: 20, // 20ms frames (typical for VoIP)
  loopbackEnabled: false,
};

/**
 * Loopback audio ingress
 * For testing - simply echoes back what it receives
 */
class LoopbackIngress extends EventEmitter implements AudioIngress {
  private isActiveFlag: boolean = false;
  private frameQueue: AudioFrame[] = [];
  private config: AudioPipelineConfig;

  constructor(config: AudioPipelineConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('[AudioPipeline] Loopback ingress starting...');
    this.isActiveFlag = true;
    this.emit('start');
  }

  async stop(): Promise<void> {
    console.log('[AudioPipeline] Loopback ingress stopping...');
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

  /** Inject a frame into the loopback (for testing) */
  injectFrame(frame: AudioFrame): void {
    if (this.isActiveFlag) {
      this.frameQueue.push(frame);
      this.emit('frame', frame);
    }
  }
}

/**
 * Loopback audio egress
 * For testing - captures what it receives for verification
 */
class LoopbackEgress extends EventEmitter implements AudioEgress {
  private isActiveFlag: boolean = false;
  private sentFrames: AudioFrame[] = [];
  private config: AudioPipelineConfig;

  constructor(config: AudioPipelineConfig) {
    super();
    this.config = config;
  }

  async start(): Promise<void> {
    console.log('[AudioPipeline] Loopback egress starting...');
    this.isActiveFlag = true;
    this.emit('start');
  }

  async stop(): Promise<void> {
    console.log('[AudioPipeline] Loopback egress stopping...');
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
      durationMs: (data.length / (sampleRate * 2)) * 1000, // Assuming 16-bit
    };
    await this.sendFrame(frame);
  }

  /** Get captured frames for verification */
  getSentFrames(): AudioFrame[] {
    return [...this.sentFrames];
  }

  /** Clear captured frames */
  clearSentFrames(): void {
    this.sentFrames = [];
  }
}

/**
 * Audio Pipeline Service
 * 
 * Orchestrates audio ingress and egress for voice calls.
 * Provides a loopback path for testing and future STT/TTS integration points.
 */
export class AudioPipelineService extends EventEmitter {
  private config: AudioPipelineConfig;
  private ingress: AudioIngress | null = null;
  private egress: AudioEgress | null = null;
  private isRunning: boolean = false;
  private frameCounter: number = 0;

  constructor(config?: Partial<AudioPipelineConfig>) {
    super();
    this.config = { ...defaultAudioPipelineConfig, ...config };
  }

  /**
   * Initialize the audio pipeline
   */
  async initialize(): Promise<void> {
    console.log('[AudioPipeline] Initializing audio pipeline...');
    
    // Create loopback ingress/egress for testing
    this.ingress = new LoopbackIngress(this.config);
    this.egress = new LoopbackEgress(this.config);
    
    // Set up loopback path: ingress frames go to egress
    this.ingress.on('frame', async (frame) => {
      this.frameCounter++;
      console.log(`[AudioPipeline] Loopback frame ${this.frameCounter}: ${frame.data.length} bytes`);
      
      if (this.egress?.isActive()) {
        try {
          await this.egress.sendFrame(frame);
        } catch (error: any) {
          console.error('[AudioPipeline] Error sending loopback frame:', error.message);
          this.emit('error', error);
        }
      }
    });
    
    // Forward egress events
    this.egress.on('frame.sent', (frame) => {
      this.emit('frame.sent', frame);
    });
    
    this.egress.on('error', (error) => {
      this.emit('error', error);
    });

    console.log('[AudioPipeline] Audio pipeline initialized (loopback mode)');
  }

  /**
   * Start the audio pipeline
   */
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

  /**
   * Stop the audio pipeline
   */
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

  /**
   * Check if pipeline is running
   */
  isRunningFlag(): boolean {
    return this.isRunning;
  }

  /**
   * Get ingress interface
   */
  getIngress(): AudioIngress | null {
    return this.ingress;
  }

  /**
   * Get egress interface
   */
  getEgress(): AudioEgress | null {
    return this.egress;
  }

  /**
   * Inject audio into the pipeline (for testing)
   * This simulates inbound audio from LiveKit/WebRTC
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

    // Cast to LoopbackIngress to access injectFrame (for testing)
    (this.ingress as LoopbackIngress).injectFrame(frame);
  }

  /**
   * Send audio through the pipeline
   * This sends audio to the egress (for LiveKit/WebRTC output)
   */
  async sendOutboundAudio(data: Buffer, sampleRate?: number, channels?: number): Promise<void> {
    if (!this.egress?.isActive()) {
      const error = new Error('Egress not active');
      this.emit('error', error);
      throw error;
    }

    await this.egress.sendAudio(data, sampleRate || this.config.sampleRate, channels || this.config.channels);
  }

  /**
   * Get pipeline statistics
   */
  getStats(): {
    running: boolean;
    frameCounter: number;
    ingressActive: boolean;
    egressActive: boolean;
    loopbackEnabled: boolean;
  } {
    return {
      running: this.isRunning,
      frameCounter: this.frameCounter,
      ingressActive: this.ingress?.isActive() || false,
      egressActive: this.egress?.isActive() || false,
      loopbackEnabled: true, // Currently always loopback
    };
  }
}
