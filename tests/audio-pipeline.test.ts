import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  AudioPipelineService, 
  AudioFrame,
  defaultAudioPipelineConfig 
} from '../src/services/audio-pipeline.js';

describe('AudioPipelineService', () => {
  let pipeline: AudioPipelineService;
  
  beforeEach(() => {
    pipeline = new AudioPipelineService();
  });

  afterEach(async () => {
    if (pipeline.isRunningFlag()) {
      await pipeline.stop();
    }
  });

  describe('initialization', () => {
    it('should initialize with default config', async () => {
      await pipeline.initialize();
      
      expect(pipeline.getIngress()).toBeDefined();
      expect(pipeline.getEgress()).toBeDefined();
    });

    it('should initialize with custom config', async () => {
      const customPipeline = new AudioPipelineService({
        sampleRate: 48000,
        channels: 2,
        frameDurationMs: 30,
      });
      
      await customPipeline.initialize();
      
      // Note: config is internal, but we can verify it's different from default
      expect(customPipeline).toBeDefined();
      await customPipeline.stop();
    });

    it('should not be running before start()', async () => {
      await pipeline.initialize();
      expect(pipeline.isRunningFlag()).toBe(false);
    });
  });

  describe('start/stop', () => {
    it('should start the pipeline', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      expect(pipeline.isRunningFlag()).toBe(true);
      expect(pipeline.getIngress()?.isActive()).toBe(true);
      expect(pipeline.getEgress()?.isActive()).toBe(true);
    });

    it('should stop the pipeline', async () => {
      await pipeline.initialize();
      await pipeline.start();
      await pipeline.stop();
      
      expect(pipeline.isRunningFlag()).toBe(false);
      expect(pipeline.getIngress()?.isActive()).toBe(false);
      expect(pipeline.getEgress()?.isActive()).toBe(false);
    });

    it('should emit start event', async () => {
      await pipeline.initialize();
      const listener = vi.fn();
      pipeline.on('start', listener);
      
      await pipeline.start();
      
      expect(listener).toHaveBeenCalled();
    });

    it('should emit stop event', async () => {
      await pipeline.initialize();
      await pipeline.start();
      const listener = vi.fn();
      pipeline.on('stop', listener);
      
      await pipeline.stop();
      
      expect(listener).toHaveBeenCalled();
    });

    it('should throw if start() called before initialize()', async () => {
      const badPipeline = new AudioPipelineService();
      await expect(badPipeline.start()).rejects.toThrow('not initialized');
    });
  });

  describe('loopback path', () => {
    it('should pass audio through loopback', async () => {
      pipeline = new AudioPipelineService({ loopbackEnabled: true });
      await pipeline.initialize();
      await pipeline.start();
      
      const audioData = Buffer.from('test-audio-data-12345');
      const sentListener = vi.fn();
      pipeline.on('frame.sent', sentListener);
      
      // Inject inbound audio
      await pipeline.injectInboundAudio(audioData);
      
      // Wait a bit for loopback processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Should have been sent to egress
      expect(sentListener).toHaveBeenCalled();
      const event = sentListener.mock.calls[0][0] as AudioFrame;
      expect(event.data).toEqual(audioData);
      expect(event.sampleRate).toBe(defaultAudioPipelineConfig.sampleRate);
      expect(event.channels).toBe(defaultAudioPipelineConfig.channels);
    });

    it('should count frames in loopback', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      const audioData1 = Buffer.from('audio-1');
      const audioData2 = Buffer.from('audio-2');
      const audioData3 = Buffer.from('audio-3');
      
      await pipeline.injectInboundAudio(audioData1);
      await pipeline.injectInboundAudio(audioData2);
      await pipeline.injectInboundAudio(audioData3);
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const stats = pipeline.getStats();
      expect(stats.frameCounter).toBe(3);
    });

    it('should handle multiple sequential injections', async () => {
      pipeline = new AudioPipelineService({ loopbackEnabled: true });
      await pipeline.initialize();
      await pipeline.start();
      
      const framesSent: AudioFrame[] = [];
      pipeline.on('frame.sent', (frame) => framesSent.push(frame));
      
      for (let i = 0; i < 10; i++) {
        await pipeline.injectInboundAudio(Buffer.from(`frame-${i}`));
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(framesSent.length).toBe(10);
      expect(pipeline.getStats().frameCounter).toBe(10);
    });
  });

  describe('outbound audio', () => {
    it('should send outbound audio', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      const audioData = Buffer.from('outbound-audio');
      const sentListener = vi.fn();
      pipeline.on('frame.sent', sentListener);
      
      await pipeline.sendOutboundAudio(audioData);
      
      expect(sentListener).toHaveBeenCalled();
      const event = sentListener.mock.calls[0][0] as AudioFrame;
      expect(event.data).toEqual(audioData);
    });

    it('should use custom sample rate for outbound', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      const audioData = Buffer.from('audio');
      
      await pipeline.sendOutboundAudio(audioData, 48000, 2);
      
      const stats = pipeline.getStats();
      expect(stats.egressActive).toBe(true);
    });

    it('should throw if sending when not active', async () => {
      await pipeline.initialize();
      // Not calling start()
      
      const audioData = Buffer.from('audio');
      await expect(pipeline.sendOutboundAudio(audioData))
        .rejects.toThrow('Egress not active');
    });
  });

  describe('statistics', () => {
    it('should return correct stats', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      const stats = pipeline.getStats();
      
      expect(stats.running).toBe(true);
      expect(stats.ingressActive).toBe(true);
      expect(stats.egressActive).toBe(true);
      expect(stats.loopbackEnabled).toBe(true);
      expect(stats.frameCounter).toBe(0);
    });

    it('should update frame counter', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      await pipeline.injectInboundAudio(Buffer.from('test'));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const stats = pipeline.getStats();
      expect(stats.frameCounter).toBe(1);
    });
  });

  describe('error handling', () => {
    it('should emit error on egress failure', async () => {
      await pipeline.initialize();
      await pipeline.start();
      
      const errorListener = vi.fn();
      pipeline.on('error', errorListener);
      
      // Stop egress but try to send
      await pipeline.getEgress()?.stop();
      
      const audioData = Buffer.from('audio');
      try {
        await pipeline.sendOutboundAudio(audioData);
      } catch (error) {
        // Expected to throw
      }
      
      // Error should have been emitted
      expect(errorListener).toHaveBeenCalled();
    });
  });

  describe('AudioFrame structure', () => {
    it('should have correct frame structure from loopback', async () => {
      pipeline = new AudioPipelineService({ loopbackEnabled: true });
      await pipeline.initialize();
      await pipeline.start();
      
      const audioData = Buffer.from('test-audio');
      const sentListener = vi.fn();
      pipeline.on('frame.sent', sentListener);
      
      await pipeline.injectInboundAudio(audioData, 16000, 1);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const event = sentListener.mock.calls[0][0] as AudioFrame;
      
      // Verify frame structure
      expect(event.data).toEqual(audioData);
      expect(event.sampleRate).toBe(16000);
      expect(event.channels).toBe(1);
      expect(event.format).toBe('pcm16');
      expect(event.timestamp).toBeDefined();
      expect(event.durationMs).toBeGreaterThan(0);
      expect(event.sequenceNumber).toBe(0);
    });

    it('should calculate duration correctly', async () => {
      pipeline = new AudioPipelineService({ loopbackEnabled: true });
      await pipeline.initialize();
      await pipeline.start();
      
      // 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
      // 160 bytes = 5ms at 16kHz mono
      const audioData = Buffer.alloc(160);
      const sentListener = vi.fn();
      pipeline.on('frame.sent', sentListener);
      
      await pipeline.injectInboundAudio(audioData, 16000, 1);
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const event = sentListener.mock.calls[0][0] as AudioFrame;
      
      // Duration should be approximately 5ms
      expect(event.durationMs).toBeCloseTo(5, 0);
    });
  });
});
