/**
 * Voice Activity Detection (VAD) Service
 * 
 * Provides speech start/end detection and turn segmentation for real-time voice calls.
 * This is a Phase 4 module that integrates with the audio pipeline for turn-based conversation.
 * 
 * Architecture:
 * 
 * VAD Detection Path:
 *   Audio Frame → Energy Calculation → Threshold Comparison → Speech/Silence Decision
 * 
 * Turn Detection:
 *   Speech Start → Speech Active → Silence Period → Speech End (Turn Complete)
 * 
 * Configuration:
 *   - Energy threshold for speech detection
 *   - Silence duration before turn ends
 *   - Minimum speech duration to avoid false positives
 *   - Pre-roll and post-roll buffering
 */

import { EventEmitter } from 'events';
import { AudioFrame } from './audio-pipeline.js';

/**
 * VAD event types
 */
export enum VadEventType {
  SPEECH_START = 'speech.start',
  SPEECH_END = 'speech.end',
  TURN_END = 'turn.end',
  VAD_FRAME = 'vad.frame',
  ERROR = 'error',
}

/**
 * VAD event data
 */
export interface VadEvent {
  type: VadEventType;
  timestamp: number;
  confidence?: number;
  durationMs?: number;
  turnId?: string;
}

/**
 * VAD configuration
 */
export interface VadConfig {
  /** Energy threshold for speech detection (0-1) */
  energyThreshold: number;
  
  /** Silence duration in ms before considering speech ended */
  silenceThresholdMs: number;
  
  /** Minimum speech duration in ms to avoid false positives */
  minSpeechDurationMs: number;
  
  /** Pre-roll buffer duration in ms (audio before speech start) */
  preRollMs: number;
  
  /** Post-roll buffer duration in ms (audio after speech end) */
  postRollMs: number;
  
  /** Frame duration in ms (should match audio pipeline frame size) */
  frameDurationMs: number;
  
  /** Enable debug logging */
  debug: boolean;
}

/**
 * Default VAD configuration
 */
export const defaultVadConfig: VadConfig = {
  energyThreshold: 0.3,      // 30% energy threshold
  silenceThresholdMs: 800,   // 800ms silence before turn end
  minSpeechDurationMs: 200,  // 200ms minimum speech
  preRollMs: 100,            // 100ms pre-roll
  postRollMs: 300,           // 300ms post-roll
  frameDurationMs: 20,       // 20ms frames
  debug: false,
};

/**
 * VAD State
 */
export enum VadState {
  IDLE = 'idle',
  SPEECH_START = 'speech_start',
  SPEECH_ACTIVE = 'speech_active',
  SILENCE = 'silence',
}

/**
 * Voice Activity Detection Service
 * 
 * Analyzes audio frames to detect speech activity and segment turns.
 * Emits events for speech start, speech end, and turn completion.
 */
export class VadService extends EventEmitter {
  private config: VadConfig;
  private state: VadState = VadState.IDLE;
  private isRunning: boolean = false;
  
  // State tracking
  private currentTurnId: string | null = null;
  private speechStartTime: number = 0;
  private speechEndTime: number = 0;
  private silenceStartTime: number = 0;
  private frameCounter: number = 0;
  private speechStartFrameCounter: number = 0;
  private silenceStartFrameCounter: number = 0;
  
  // Buffering
  private preRollBuffer: AudioFrame[] = [];
  private postRollBuffer: AudioFrame[] = [];
  private currentSpeechFrames: AudioFrame[] = [];
  
  // Statistics
  private totalSpeechDurationMs: number = 0;
  private totalSilenceDurationMs: number = 0;
  private turnsCompleted: number = 0;

  constructor(config?: Partial<VadConfig>) {
    super();
    this.config = { ...defaultVadConfig, ...config };
  }

  /**
   * Start the VAD service
   */
  start(): void {
    if (this.isRunning) {
      this.log('VAD already running');
      return;
    }
    
    this.log('VAD service starting...');
    this.isRunning = true;
    this.state = VadState.IDLE;
    this.emit('start');
    this.log('VAD service started');
  }

  /**
   * Stop the VAD service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }
    
    this.log('VAD service stopping...');
    this.isRunning = false;
    
    // If we were in speech, emit speech end
    if (this.state === VadState.SPEECH_ACTIVE || this.state === VadState.SPEECH_START) {
      this.emitSpeechEnd();
    }
    
    this.clearBuffers();
    this.state = VadState.IDLE;
    this.emit('stop');
    this.log('VAD service stopped');
  }

  /**
   * Check if VAD is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Process an audio frame through VAD
   * This is the main entry point for audio frames from the pipeline
   */
  processFrame(frame: AudioFrame): void {
    if (!this.isRunning) {
      return;
    }

    this.frameCounter++;
    const timestamp = frame.timestamp;
    
    // Calculate energy for this frame
    const energy = this.calculateEnergy(frame);
    const isSpeech = energy > this.config.energyThreshold;
    
    this.log(`Frame ${this.frameCounter}: energy=${energy.toFixed(3)}, isSpeech=${isSpeech}, state=${this.state}`);
    
    // Emit VAD frame event
    this.emit('vad.frame', {
      frame,
      energy,
      isSpeech,
      state: this.state,
      timestamp,
    });
    
    // State machine
    switch (this.state) {
      case VadState.IDLE:
        this.handleIdleState(frame, isSpeech, energy);
        break;
        
      case VadState.SPEECH_START:
        this.handleSpeechStartState(frame, isSpeech, energy);
        break;
        
      case VadState.SPEECH_ACTIVE:
        this.handleSpeechActiveState(frame, isSpeech, energy);
        break;
        
      case VadState.SILENCE:
        this.handleSilenceState(frame, isSpeech, energy, timestamp);
        break;
    }
  }

  /**
   * Calculate energy of an audio frame
   * Uses RMS (Root Mean Square) of PCM samples
   */
  private calculateEnergy(frame: AudioFrame): number {
    const data = frame.data;
    if (data.length === 0) {
      return 0;
    }
    
    // Assuming 16-bit PCM (signed)
    let sum = 0;
    for (let i = 0; i < data.length; i += 2) {
      // Read signed 16-bit integer (little-endian)
      const sample = data.readInt16LE(i);
      // Normalize to -1.0 to 1.0
      const normalized = sample / 32768;
      sum += normalized * normalized;
    }
    
    const rms = Math.sqrt(sum / (data.length / 2));
    return rms;
  }

  /**
   * Handle IDLE state
   */
  private handleIdleState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      // Start pre-roll buffering
      this.preRollBuffer.push(frame);
      
      // Keep only the last preRollMs of frames
      const maxPreRollFrames = Math.ceil(this.config.preRollMs / this.config.frameDurationMs);
      if (this.preRollBuffer.length > maxPreRollFrames) {
        this.preRollBuffer.shift();
      }
      
      // Transition to SPEECH_START
      this.state = VadState.SPEECH_START;
      this.speechStartTime = Date.now();
      this.speechStartFrameCounter = this.frameCounter;
      this.log(`Transitioned to SPEECH_START (energy=${energy.toFixed(3)})`);
    }
  }

  /**
   * Handle SPEECH_START state
   */
  private handleSpeechStartState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      // Add to speech frames
      this.currentSpeechFrames.push(frame);
      
      // Check if we've accumulated enough speech based on frame count
      // Include current frame in the count (framesSinceStart includes current frame)
      const framesSinceStart = this.frameCounter - this.speechStartFrameCounter + 1;
      const speechDurationMs = framesSinceStart * this.config.frameDurationMs;
      
      if (speechDurationMs >= this.config.minSpeechDurationMs) {
        // Confirmed speech start
        this.emitSpeechStart();
        this.state = VadState.SPEECH_ACTIVE;
        this.log(`Transitioned to SPEECH_ACTIVE (duration=${speechDurationMs}ms, frames=${framesSinceStart})`);
      }
    } else {
      // Silence during potential speech start - stay in SPEECH_START, keep pre-roll
      // Don't reset - wait for more speech to confirm
      this.log('Silence during SPEECH_START, waiting for confirmation');
    }
  }

  /**
   * Handle SPEECH_ACTIVE state
   */
  private handleSpeechActiveState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      // Continue accumulating speech
      this.currentSpeechFrames.push(frame);
      this.silenceStartTime = 0; // Reset silence timer
      this.silenceStartFrameCounter = 0;
    } else {
      // Silence detected - start silence timer using frame counter
      if (this.silenceStartFrameCounter === 0) {
        this.silenceStartFrameCounter = this.frameCounter;
        this.state = VadState.SILENCE;
        this.log('Transitioned to SILENCE');
      }
    }
  }

  /**
   * Handle SILENCE state
   */
  private handleSilenceState(frame: AudioFrame, isSpeech: boolean, energy: number, timestamp: number): void {
    if (isSpeech) {
      // Speech resumed during silence - go back to active
      this.state = VadState.SPEECH_ACTIVE;
      this.silenceStartTime = 0;
      this.silenceStartFrameCounter = this.frameCounter;
      this.log('Speech resumed during silence');
    } else {
      // Continue silence - use frame-based timing for testability
      // Calculate silence duration based on frames (more reliable for tests)
      const silenceFrames = this.frameCounter - this.silenceStartFrameCounter;
      const silenceDuration = silenceFrames * this.config.frameDurationMs;
      
      if (silenceDuration >= this.config.silenceThresholdMs) {
        // Silence threshold exceeded - end turn
        this.emitSpeechEnd();
        this.emitTurnEnd();
        this.state = VadState.IDLE;
        this.log(`Turn ended (silence=${silenceDuration}ms)`);
      }
    }
  }

  /**
   * Emit speech start event
   */
  private emitSpeechStart(): void {
    this.currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    // Record actual speech start time for duration calculation
    this.speechStartTime = Date.now();
    
    // Emit speech start event with pre-roll
    const event: VadEvent = {
      type: VadEventType.SPEECH_START,
      timestamp: Date.now(),
      turnId: this.currentTurnId,
    };
    
    this.emit('speech.start', event);
    this.log(`Speech started: ${this.currentTurnId}`);
  }

  /**
   * Emit speech end event
   */
  private emitSpeechEnd(): void {
    if (this.speechStartTime === 0 || this.currentTurnId === null) {
      return;
    }
    
    // Calculate speech duration based on frame count for testability
    // This is more reliable than wall-clock time for tests
    const speechFrames = this.frameCounter - this.speechStartFrameCounter + 1;
    const speechDuration = speechFrames * this.config.frameDurationMs;
    this.totalSpeechDurationMs += speechDuration;
    
    // Emit speech end event
    const event: VadEvent = {
      type: VadEventType.SPEECH_END,
      timestamp: Date.now(),
      durationMs: speechDuration,
      turnId: this.currentTurnId,
    };
    
    this.emit('speech.end', event);
    this.log(`Speech ended: ${this.currentTurnId} (duration=${speechDuration}ms)`);
    
    // Reset speech tracking (turn-related reset is done in emitTurnEnd)
    this.speechStartTime = 0;
    this.speechEndTime = Date.now();
    this.currentSpeechFrames = [];
    this.preRollBuffer = [];
  }

  /**
   * Emit turn end event
   */
  private emitTurnEnd(): void {
    if (this.currentTurnId === null) {
      return;
    }
    
    const turnId = this.currentTurnId;
    this.turnsCompleted++;
    this.currentTurnId = null;
    
    // Reset all turn-related tracking
    this.speechStartTime = 0;
    this.speechStartFrameCounter = 0;
    this.silenceStartTime = 0;
    this.silenceStartFrameCounter = 0;
    this.currentSpeechFrames = [];
    this.preRollBuffer = [];
    
    // Emit turn end event
    const event: VadEvent = {
      type: VadEventType.TURN_END,
      timestamp: Date.now(),
      turnId,
    };
    
    this.emit('turn.end', event);
    this.log(`Turn completed: ${turnId}`);
  }

  /**
   * Clear all buffers
   */
  private clearBuffers(): void {
    this.preRollBuffer = [];
    this.postRollBuffer = [];
    this.currentSpeechFrames = [];
  }

  /**
   * Get current VAD state
   */
  getState(): VadState {
    return this.state;
  }

  /**
   * Get VAD statistics
   */
  getStats(): {
    running: boolean;
    state: VadState;
    frameCounter: number;
    turnsCompleted: number;
    totalSpeechDurationMs: number;
    totalSilenceDurationMs: number;
    currentTurnId: string | null;
  } {
    return {
      running: this.isRunning,
      state: this.state,
      frameCounter: this.frameCounter,
      turnsCompleted: this.turnsCompleted,
      totalSpeechDurationMs: this.totalSpeechDurationMs,
      totalSilenceDurationMs: this.totalSilenceDurationMs,
      currentTurnId: this.currentTurnId,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.frameCounter = 0;
    this.turnsCompleted = 0;
    this.totalSpeechDurationMs = 0;
    this.totalSilenceDurationMs = 0;
  }

  /**
   * Get current turn ID (if any)
   */
  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /**
   * Get collected speech frames for current turn
   */
  getCurrentSpeechFrames(): AudioFrame[] {
    return [...this.currentSpeechFrames];
  }

  /**
   * Debug logging
   */
  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[VAD] ${message}`);
    }
  }
}

/**
 * VAD Turn Detector Interface
 * 
 * Higher-level interface for turn-based conversation management.
 * Integrates with VAD service to manage conversation turns.
 */
export interface TurnDetector {
  /** Start turn detection */
  start(): void;
  
  /** Stop turn detection */
  stop(): void;
  
  /** Check if currently detecting speech */
  isSpeaking(): boolean;
  
  /** Get current turn ID */
  getCurrentTurnId(): string | null;
  
  /** Get turn statistics */
  getStats(): any;
  
  /** Event: Speech started */
  on(event: 'speech.start', listener: (event: VadEvent) => void): this;
  
  /** Event: Speech ended */
  on(event: 'speech.end', listener: (event: VadEvent) => void): this;
  
  /** Event: Turn completed */
  on(event: 'turn.end', listener: (event: VadEvent) => void): this;
}
