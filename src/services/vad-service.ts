/**
 * Voice Activity Detection (VAD) Service
 *
 * Provides speech start/end detection and turn segmentation for real-time voice calls.
 *
 * Features:
 * - RMS energy-based speech detection
 * - Adaptive threshold: calibrates to ambient noise during first ~1s
 * - Hangover smoothing: tolerates brief silent gaps during speech
 * - Pre-roll and post-roll buffering
 * - Frame-based timing for deterministic testing
 */

import { EventEmitter } from 'events';
import { AudioFrame } from './audio-pipeline.js';

export enum VadEventType {
  SPEECH_START = 'speech.start',
  SPEECH_END = 'speech.end',
  TURN_END = 'turn.end',
  VAD_FRAME = 'vad.frame',
  ERROR = 'error',
}

export interface VadEvent {
  type: VadEventType;
  timestamp: number;
  confidence?: number;
  durationMs?: number;
  turnId?: string;
}

export interface VadConfig {
  /** Energy threshold for speech detection (0-1) */
  energyThreshold: number;

  /** Silence duration in ms before considering speech ended */
  silenceThresholdMs: number;

  /** Minimum speech duration in ms to avoid false positives */
  minSpeechDurationMs: number;

  /** Pre-roll buffer duration in ms */
  preRollMs: number;

  /** Post-roll buffer duration in ms */
  postRollMs: number;

  /** Frame duration in ms */
  frameDurationMs: number;

  /** Enable debug logging */
  debug: boolean;

  /** Enable adaptive threshold calibration */
  adaptiveThreshold: boolean;

  /** Multiplier for adaptive threshold (threshold = noiseFloor * multiplier) */
  adaptiveMultiplier: number;

  /** Number of frames to use for noise floor calibration */
  adaptiveCalibrationFrames: number;

  /** Number of consecutive silent frames allowed during speech before transitioning to SILENCE */
  hangoverFrames: number;
}

export const defaultVadConfig: VadConfig = {
  energyThreshold: 0.3,
  silenceThresholdMs: 500,
  minSpeechDurationMs: 200,
  preRollMs: 100,
  postRollMs: 150,
  frameDurationMs: 20,
  debug: false,
  adaptiveThreshold: false,
  adaptiveMultiplier: 3.0,
  adaptiveCalibrationFrames: 50, // ~1 second at 20ms frames
  hangoverFrames: 2,
};

export enum VadState {
  IDLE = 'idle',
  SPEECH_START = 'speech_start',
  SPEECH_ACTIVE = 'speech_active',
  SILENCE = 'silence',
}

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

  // Hangover tracking
  private consecutiveSilentFrames: number = 0;

  // Adaptive threshold
  private calibrationEnergies: number[] = [];
  private calibrated: boolean = false;
  private effectiveThreshold: number;

  // Buffering
  private preRollBuffer: AudioFrame[] = [];
  private currentSpeechFrames: AudioFrame[] = [];

  // Statistics
  private totalSpeechDurationMs: number = 0;
  private totalSilenceDurationMs: number = 0;
  private turnsCompleted: number = 0;

  constructor(config?: Partial<VadConfig>) {
    super();
    this.config = { ...defaultVadConfig, ...config };
    this.effectiveThreshold = this.config.energyThreshold;
  }

  start(): void {
    if (this.isRunning) {
      this.log('VAD already running');
      return;
    }

    this.log('VAD service starting...');
    this.isRunning = true;
    this.state = VadState.IDLE;
    this.calibrationEnergies = [];
    this.calibrated = !this.config.adaptiveThreshold;
    this.effectiveThreshold = this.config.energyThreshold;
    this.consecutiveSilentFrames = 0;
    this.emit('start');
    this.log('VAD service started');
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.log('VAD service stopping...');
    this.isRunning = false;

    if (this.state === VadState.SPEECH_ACTIVE || this.state === VadState.SPEECH_START) {
      this.emitSpeechEnd();
    }

    this.clearBuffers();
    this.state = VadState.IDLE;
    this.emit('stop');
    this.log('VAD service stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  processFrame(frame: AudioFrame): void {
    if (!this.isRunning) {
      return;
    }

    this.frameCounter++;
    const timestamp = frame.timestamp;

    const energy = this.calculateEnergy(frame);

    // Adaptive threshold calibration
    if (this.config.adaptiveThreshold && !this.calibrated) {
      this.calibrationEnergies.push(energy);
      if (this.calibrationEnergies.length >= this.config.adaptiveCalibrationFrames) {
        const avgEnergy = this.calibrationEnergies.reduce((a, b) => a + b, 0) / this.calibrationEnergies.length;
        this.effectiveThreshold = avgEnergy * this.config.adaptiveMultiplier;
        // Ensure minimum threshold
        this.effectiveThreshold = Math.max(this.effectiveThreshold, 0.01);
        this.calibrated = true;
        this.log(`Adaptive threshold calibrated: noiseFloor=${avgEnergy.toFixed(4)}, threshold=${this.effectiveThreshold.toFixed(4)}`);
      }
    }

    const isSpeech = energy > this.effectiveThreshold;

    this.log(`Frame ${this.frameCounter}: energy=${energy.toFixed(3)}, isSpeech=${isSpeech}, state=${this.state}`);

    this.emit('vad.frame', {
      frame,
      energy,
      isSpeech,
      state: this.state,
      timestamp,
    });

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

  private calculateEnergy(frame: AudioFrame): number {
    const data = frame.data;
    if (data.length === 0) {
      return 0;
    }

    let sum = 0;
    for (let i = 0; i < data.length; i += 2) {
      const sample = data.readInt16LE(i);
      const normalized = sample / 32768;
      sum += normalized * normalized;
    }

    const rms = Math.sqrt(sum / (data.length / 2));
    return rms;
  }

  private handleIdleState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      this.preRollBuffer.push(frame);

      const maxPreRollFrames = Math.ceil(this.config.preRollMs / this.config.frameDurationMs);
      if (this.preRollBuffer.length > maxPreRollFrames) {
        this.preRollBuffer.shift();
      }

      this.state = VadState.SPEECH_START;
      this.speechStartTime = Date.now();
      this.speechStartFrameCounter = this.frameCounter;
      this.consecutiveSilentFrames = 0;
      this.log(`Transitioned to SPEECH_START (energy=${energy.toFixed(3)})`);
    }
  }

  private handleSpeechStartState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      this.currentSpeechFrames.push(frame);
      this.consecutiveSilentFrames = 0;

      const framesSinceStart = this.frameCounter - this.speechStartFrameCounter + 1;
      const speechDurationMs = framesSinceStart * this.config.frameDurationMs;

      if (speechDurationMs >= this.config.minSpeechDurationMs) {
        this.emitSpeechStart();
        this.state = VadState.SPEECH_ACTIVE;
        this.log(`Transitioned to SPEECH_ACTIVE (duration=${speechDurationMs}ms, frames=${framesSinceStart})`);
      }
    } else {
      this.log('Silence during SPEECH_START, waiting for confirmation');
    }
  }

  private handleSpeechActiveState(frame: AudioFrame, isSpeech: boolean, energy: number): void {
    if (isSpeech) {
      this.currentSpeechFrames.push(frame);
      this.silenceStartTime = 0;
      this.silenceStartFrameCounter = 0;
      this.consecutiveSilentFrames = 0;
    } else {
      this.consecutiveSilentFrames++;

      // Hangover: tolerate brief silence gaps
      if (this.config.hangoverFrames > 0 && this.consecutiveSilentFrames <= this.config.hangoverFrames) {
        // Still within hangover tolerance - stay in SPEECH_ACTIVE
        this.currentSpeechFrames.push(frame);
        this.log(`Hangover: ${this.consecutiveSilentFrames}/${this.config.hangoverFrames} silent frames`);
        return;
      }

      // Silence exceeded hangover - transition
      if (this.silenceStartFrameCounter === 0) {
        this.silenceStartFrameCounter = this.frameCounter - this.consecutiveSilentFrames;
        this.state = VadState.SILENCE;
        this.log('Transitioned to SILENCE');
      }
    }
  }

  private handleSilenceState(frame: AudioFrame, isSpeech: boolean, energy: number, timestamp: number): void {
    if (isSpeech) {
      this.state = VadState.SPEECH_ACTIVE;
      this.silenceStartTime = 0;
      this.silenceStartFrameCounter = this.frameCounter;
      this.consecutiveSilentFrames = 0;
      this.log('Speech resumed during silence');
    } else {
      const silenceFrames = this.frameCounter - this.silenceStartFrameCounter;
      const silenceDuration = silenceFrames * this.config.frameDurationMs;

      if (silenceDuration >= this.config.silenceThresholdMs) {
        this.emitSpeechEnd();
        this.emitTurnEnd();
        this.state = VadState.IDLE;
        this.log(`Turn ended (silence=${silenceDuration}ms)`);
      }
    }
  }

  private emitSpeechStart(): void {
    this.currentTurnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.speechStartTime = Date.now();

    const event: VadEvent = {
      type: VadEventType.SPEECH_START,
      timestamp: Date.now(),
      turnId: this.currentTurnId,
    };

    this.emit('speech.start', event);
    this.log(`Speech started: ${this.currentTurnId}`);
  }

  private emitSpeechEnd(): void {
    if (this.speechStartTime === 0 || this.currentTurnId === null) {
      return;
    }

    const speechFrames = this.frameCounter - this.speechStartFrameCounter + 1;
    const speechDuration = speechFrames * this.config.frameDurationMs;
    this.totalSpeechDurationMs += speechDuration;

    const event: VadEvent = {
      type: VadEventType.SPEECH_END,
      timestamp: Date.now(),
      durationMs: speechDuration,
      turnId: this.currentTurnId,
    };

    this.emit('speech.end', event);
    this.log(`Speech ended: ${this.currentTurnId} (duration=${speechDuration}ms)`);

    this.speechStartTime = 0;
    this.speechEndTime = Date.now();
    this.currentSpeechFrames = [];
    this.preRollBuffer = [];
  }

  private emitTurnEnd(): void {
    if (this.currentTurnId === null) {
      return;
    }

    const turnId = this.currentTurnId;
    this.turnsCompleted++;
    this.currentTurnId = null;

    this.speechStartTime = 0;
    this.speechStartFrameCounter = 0;
    this.silenceStartTime = 0;
    this.silenceStartFrameCounter = 0;
    this.consecutiveSilentFrames = 0;
    this.currentSpeechFrames = [];
    this.preRollBuffer = [];

    const event: VadEvent = {
      type: VadEventType.TURN_END,
      timestamp: Date.now(),
      turnId,
    };

    this.emit('turn.end', event);
    this.log(`Turn completed: ${turnId}`);
  }

  private clearBuffers(): void {
    this.preRollBuffer = [];
    this.currentSpeechFrames = [];
  }

  getState(): VadState {
    return this.state;
  }

  /**
   * Get the current effective energy threshold
   */
  getEffectiveThreshold(): number {
    return this.effectiveThreshold;
  }

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

  resetStats(): void {
    this.frameCounter = 0;
    this.turnsCompleted = 0;
    this.totalSpeechDurationMs = 0;
    this.totalSilenceDurationMs = 0;
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  getCurrentSpeechFrames(): AudioFrame[] {
    return [...this.currentSpeechFrames];
  }

  private log(message: string): void {
    if (this.config.debug) {
      console.log(`[VAD] ${message}`);
    }
  }
}

export interface TurnDetector {
  start(): void;
  stop(): void;
  isSpeaking(): boolean;
  getCurrentTurnId(): string | null;
  getStats(): any;
  on(event: 'speech.start', listener: (event: VadEvent) => void): this;
  on(event: 'speech.end', listener: (event: VadEvent) => void): this;
  on(event: 'turn.end', listener: (event: VadEvent) => void): this;
}
