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
    };

    on(event: string, handler: Function) {
      const handlers = this.handlers.get(event) || [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }

    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);

    emit(event: string, ...args: any[]) {
      const handlers = this.handlers.get(event) || [];
      handlers.forEach(h => h(...args));
    }
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
  };
});

describe('LiveKitAgentService', () => {
  let agent: LiveKitAgentService;
  let mockLiveKitService: LiveKitService;

  beforeEach(() => {
    mockLiveKitService = {
      getUrl: vi.fn().mockReturnValue('ws://localhost:7880'),
      generateToken: vi.fn().mockResolvedValue('mock-token'),
    } as unknown as LiveKitService;

    agent = new LiveKitAgentService(mockLiveKitService);
  });

  describe('joinRoom', () => {
    it('should connect to room and publish audio track', async () => {
      await agent.joinRoom('ws://localhost:7880', 'test-token');

      expect(agent.isConnected()).toBe(true);
    });

    it('should set connected to false after leaving', async () => {
      await agent.joinRoom('ws://localhost:7880', 'test-token');
      await agent.leaveRoom();

      expect(agent.isConnected()).toBe(false);
    });
  });

  describe('publishAudioBuffer', () => {
    it('should publish audio buffer after resampling', async () => {
      await agent.joinRoom('ws://localhost:7880', 'test-token');

      // 160 samples at 16kHz = 10ms
      const audioData = Buffer.alloc(160 * 2);
      for (let i = 0; i < 160; i++) {
        audioData.writeInt16LE(1000, i * 2);
      }

      await agent.publishAudioBuffer(audioData, 16000);

      // Should not throw
      expect(agent.isConnected()).toBe(true);
    });

    it('should throw if not connected', async () => {
      const audioData = Buffer.alloc(320);
      await expect(agent.publishAudioBuffer(audioData, 16000)).rejects.toThrow('Not connected');
    });
  });

  describe('leaveRoom', () => {
    it('should be a no-op if not connected', async () => {
      await agent.leaveRoom();
      expect(agent.isConnected()).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      expect(agent.isConnected()).toBe(false);
    });
  });
});
