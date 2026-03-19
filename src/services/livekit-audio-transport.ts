/**
 * LiveKit Audio Transport
 *
 * Implements AudioIngress and AudioEgress interfaces backed by LiveKitAgentService.
 * Includes per-participant audio multiplexing via ParticipantAudioMux.
 */

import { EventEmitter } from 'events';
import { AudioFrame, AudioIngress, AudioEgress } from './audio-pipeline.js';
import { LiveKitAgentService } from './livekit-agent-service.js';
import { ParticipantAudioMux, MuxMode, ParticipantFrame } from './participant-audio-mux.js';

/**
 * LiveKit Audio Ingress
 * Receives audio frames from LiveKitAgentService, routes through participant
 * mux, and emits pipeline-ready AudioFrames.
 */
export class LiveKitAudioIngress extends EventEmitter implements AudioIngress {
  private agent: LiveKitAgentService;
  private active: boolean = false;
  private frameHandler: ((frame: ParticipantFrame) => void) | null = null;
  private mux: ParticipantAudioMux;

  constructor(agent: LiveKitAgentService, muxMode: MuxMode = 'mix') {
    super();
    this.agent = agent;
    this.mux = new ParticipantAudioMux(muxMode);

    // Forward mux output to pipeline
    this.mux.on('frame', (frame: AudioFrame) => {
      if (this.active) {
        this.emit('frame', frame);
      }
    });
  }

  async start(): Promise<void> {
    this.active = true;

    this.frameHandler = (frame: ParticipantFrame) => {
      if (this.active) {
        this.mux.processFrame(frame);
      }
    };
    this.agent.on('audio.frame', this.frameHandler);

    this.emit('start');
  }

  async stop(): Promise<void> {
    this.active = false;

    if (this.frameHandler) {
      this.agent.removeListener('audio.frame', this.frameHandler);
      this.frameHandler = null;
    }

    this.emit('stop');
  }

  isActive(): boolean {
    return this.active;
  }

  async getFrame(): Promise<AudioFrame | null> {
    return null;
  }

  /**
   * Notify the mux that a turn completed (releases active speaker lock in 'separate' mode).
   */
  turnCompleted(): void {
    this.mux.turnCompleted();
  }

  /**
   * Get the underlying participant mux for inspection/control.
   */
  getMux(): ParticipantAudioMux {
    return this.mux;
  }
}

/**
 * LiveKit Audio Egress
 * Sends audio frames to LiveKitAgentService for publishing to the room.
 */
export class LiveKitAudioEgress extends EventEmitter implements AudioEgress {
  private agent: LiveKitAgentService;
  private active: boolean = false;

  constructor(agent: LiveKitAgentService) {
    super();
    this.agent = agent;
  }

  async start(): Promise<void> {
    this.active = true;
    this.emit('start');
  }

  async stop(): Promise<void> {
    this.active = false;
    this.emit('stop');
  }

  isActive(): boolean {
    return this.active;
  }

  async sendFrame(frame: AudioFrame): Promise<void> {
    if (!this.active) {
      throw new Error('LiveKit egress not active');
    }

    if (!this.agent.isConnected()) {
      throw new Error('LiveKit agent not connected');
    }

    await this.agent.publishAudioBuffer(frame.data, frame.sampleRate);
    this.emit('frame.sent', frame);
  }

  async sendAudio(data: Buffer, sampleRate: number, channels: number): Promise<void> {
    const frame: AudioFrame = {
      data,
      sampleRate,
      channels,
      format: 'pcm16',
      timestamp: Date.now(),
      durationMs: (data.length / (sampleRate * 2 * channels)) * 1000,
    };
    await this.sendFrame(frame);
  }
}
