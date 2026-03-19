/**
 * Participant Audio Multiplexer
 *
 * Routes audio frames from multiple LiveKit participants into separate
 * per-participant VAD/turn pipelines, or mixes them into a single stream.
 *
 * Modes:
 *   - 'mix': All participants mixed into one pipeline (default, current behavior)
 *   - 'separate': Each participant gets isolated VAD → the first speaker to
 *     complete a turn gets processed. Prevents cross-talk from merging turns.
 */

import { EventEmitter } from 'events';
import { AudioFrame } from './audio-pipeline.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AudioMux');

export type MuxMode = 'mix' | 'separate';

export interface ParticipantFrame extends AudioFrame {
  participantIdentity?: string;
}

interface ParticipantState {
  identity: string;
  lastFrameTime: number;
  frameCount: number;
}

export class ParticipantAudioMux extends EventEmitter {
  private mode: MuxMode;
  private participants: Map<string, ParticipantState> = new Map();
  private activeParticipant: string | null = null;

  constructor(mode: MuxMode = 'mix') {
    super();
    this.mode = mode;
  }

  /**
   * Process an incoming audio frame tagged with participant identity.
   * Emits 'frame' with the frame to pass to the pipeline.
   */
  processFrame(frame: ParticipantFrame): void {
    const identity = frame.participantIdentity || 'unknown';

    // Track participant
    if (!this.participants.has(identity)) {
      this.participants.set(identity, {
        identity,
        lastFrameTime: Date.now(),
        frameCount: 0,
      });
      log.info('New participant detected', { identity });
      this.emit('participant.joined', identity);
    }

    const state = this.participants.get(identity)!;
    state.lastFrameTime = Date.now();
    state.frameCount++;

    if (this.mode === 'mix') {
      // Pass all frames through — VAD handles turn detection
      this.emit('frame', frame);
      return;
    }

    // Separate mode: only forward frames from the active speaker
    if (this.activeParticipant === null) {
      // No one active — first person to speak wins
      this.activeParticipant = identity;
      log.debug('Active speaker set', { identity });
    }

    if (identity === this.activeParticipant) {
      this.emit('frame', frame);
    }
    // Frames from other participants are dropped while someone is active
  }

  /**
   * Called when a turn completes — resets active speaker lock so
   * the next person to speak gets processed.
   */
  turnCompleted(): void {
    if (this.mode === 'separate' && this.activeParticipant) {
      log.debug('Turn completed, releasing active speaker lock', {
        identity: this.activeParticipant,
      });
      this.activeParticipant = null;
    }
  }

  /**
   * Remove a participant (e.g., they left the room).
   */
  removeParticipant(identity: string): void {
    this.participants.delete(identity);
    if (this.activeParticipant === identity) {
      this.activeParticipant = null;
    }
    this.emit('participant.left', identity);
  }

  /**
   * Get current active speaker identity (separate mode only).
   */
  getActiveParticipant(): string | null {
    return this.activeParticipant;
  }

  /**
   * Get all tracked participants.
   */
  getParticipants(): string[] {
    return Array.from(this.participants.keys());
  }

  /**
   * Prune participants that haven't sent a frame in the given timeout.
   */
  pruneStale(timeoutMs: number = 30000): void {
    const now = Date.now();
    for (const [identity, state] of this.participants) {
      if (now - state.lastFrameTime > timeoutMs) {
        this.removeParticipant(identity);
        log.info('Pruned stale participant', { identity });
      }
    }
  }

  getMode(): MuxMode {
    return this.mode;
  }
}
