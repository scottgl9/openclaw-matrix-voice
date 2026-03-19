/**
 * LiveKit Audio Transport
 *
 * Implements AudioIngress and AudioEgress interfaces backed by LiveKitAgentService.
 * Bridges the AudioPipelineService with real LiveKit room audio.
 */

import { EventEmitter } from 'events';
import { AudioFrame, AudioIngress, AudioEgress } from './audio-pipeline.js';
import { LiveKitAgentService } from './livekit-agent-service.js';
import { resample } from './audio-resampler.js';

const LIVEKIT_SAMPLE_RATE = 48000;
const PIPELINE_SAMPLE_RATE = 16000;

/**
 * LiveKit Audio Ingress
 * Receives audio frames from LiveKitAgentService and emits them as pipeline AudioFrames.
 */
export class LiveKitAudioIngress extends EventEmitter implements AudioIngress {
  private agent: LiveKitAgentService;
  private active: boolean = false;
  private frameHandler: ((frame: AudioFrame) => void) | null = null;

  constructor(agent: LiveKitAgentService) {
    super();
    this.agent = agent;
  }

  async start(): Promise<void> {
    this.active = true;

    // Listen for audio frames from the agent
    this.frameHandler = (frame: AudioFrame) => {
      if (this.active) {
        this.emit('frame', frame);
      }
    };
    this.agent.on('audio.frame', this.frameHandler);

    this.emit('start');
    console.log('[LiveKitIngress] Started');
  }

  async stop(): Promise<void> {
    this.active = false;

    if (this.frameHandler) {
      this.agent.removeListener('audio.frame', this.frameHandler);
      this.frameHandler = null;
    }

    this.emit('stop');
    console.log('[LiveKitIngress] Stopped');
  }

  isActive(): boolean {
    return this.active;
  }

  async getFrame(): Promise<AudioFrame | null> {
    // Push-based only - frames come via events
    return null;
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
    console.log('[LiveKitEgress] Started');
  }

  async stop(): Promise<void> {
    this.active = false;
    this.emit('stop');
    console.log('[LiveKitEgress] Stopped');
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

    // Publish the audio buffer - the agent handles resampling to 48kHz
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
