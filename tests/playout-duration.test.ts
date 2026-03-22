import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveKitAgentService } from '../src/services/livekit-agent-service.js';
import { LiveKitService } from '../src/services/livekit-service.js';

// Mock @livekit/rtc-node since it requires native bindings
vi.mock('@livekit/rtc-node', () => {
  class MockAudioSource {
    sampleRate: number;
    channels: number;
    captureFrame = vi.fn().mockResolvedValue(undefined);

    constructor(sampleRate: number, channels: number) {
      this.sampleRate = sampleRate;
      this.channels = channels;
    }
  }

  class MockLocalAudioTrack {
    name: string;
    source: MockAudioSource;

    constructor(name: string, source: MockAudioSource) {
      this.name = name;
      this.source = source;
    }

    static createAudioTrack(name: string, source: MockAudioSource) {
      return new MockLocalAudioTrack(name, source);
    }
  }

  class MockRoom {
    private handlers = new Map<string, Function[]>();
    localParticipant = {
      publishTrack: vi.fn().mockResolvedValue(undefined),
      unpublishTrack: vi.fn().mockResolvedValue(undefined),
    };

    on(event: string, handler: Function) {
      const handlers = this.handlers.get(event) || [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
  }

  class MockAudioFrame {
    data: Int16Array;
    sampleRate: number;
    channels: number;
    samplesPerChannel: number;

    constructor(data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) {
      this.data = data;
      this.sampleRate = sampleRate;
      this.channels = channels;
      this.samplesPerChannel = samplesPerChannel;
    }
  }

  return {
    Room: MockRoom,
    AudioSource: MockAudioSource,
    LocalAudioTrack: MockLocalAudioTrack,
    AudioFrame: MockAudioFrame,
    AudioStream: vi.fn(),
    TrackKind: { KIND_AUDIO: 1, KIND_VIDEO: 2 },
    TrackSource: { SOURCE_MICROPHONE: 1 },
    TrackPublishOptions: vi.fn().mockImplementation(() => ({ source: null })),
  };
});

describe('LiveKitAgentService — publishAudioBuffer returns duration', () => {
  let agent: LiveKitAgentService;

  beforeEach(async () => {
    const mockLiveKitService = {
      getUrl: vi.fn().mockReturnValue('ws://localhost:7880'),
      generateToken: vi.fn().mockResolvedValue('mock-token'),
    } as unknown as LiveKitService;

    agent = new LiveKitAgentService(mockLiveKitService);
    await agent.joinRoom('ws://localhost:7880', 'test-token');
  });

  it('should return correct duration for 16kHz audio', async () => {
    // 16000 samples at 16kHz = 1 second, 2 bytes per sample = 32000 bytes
    const audioData = Buffer.alloc(32000);
    const result = await agent.publishAudioBuffer(audioData, 16000);

    expect(result.durationMs).toBe(1000);
  });

  it('should return correct duration for 24kHz audio', async () => {
    // 24000 samples at 24kHz = 1 second, 2 bytes per sample = 48000 bytes
    const audioData = Buffer.alloc(48000);
    const result = await agent.publishAudioBuffer(audioData, 24000);

    expect(result.durationMs).toBe(1000);
  });

  it('should return correct duration for short audio', async () => {
    // 160 samples at 16kHz = 10ms, 2 bytes per sample = 320 bytes
    const audioData = Buffer.alloc(320);
    const result = await agent.publishAudioBuffer(audioData, 16000);

    expect(result.durationMs).toBe(10);
  });

  it('should return correct duration for 48kHz audio (no resample)', async () => {
    // 48000 samples at 48kHz = 1 second, 2 bytes per sample = 96000 bytes
    const audioData = Buffer.alloc(96000);
    const result = await agent.publishAudioBuffer(audioData, 48000);

    expect(result.durationMs).toBe(1000);
  });
});
