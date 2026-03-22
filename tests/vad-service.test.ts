import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VadService, VadConfig, defaultVadConfig, VadState, VadEventType } from '../src/services/vad-service.js';
import { AudioFrame } from '../src/services/audio-pipeline.js';

describe('VadService', () => {
  let vad: VadService;
  
  beforeEach(() => {
    vad = new VadService({ debug: true });
  });

  afterEach(() => {
    if (vad.isActive()) {
      vad.stop();
    }
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      expect(vad.isActive()).toBe(false);
      expect(vad.getState()).toBe(VadState.IDLE);
    });

    it('should initialize with custom config', () => {
      const customVad = new VadService({
        energyThreshold: 0.5,
        silenceThresholdMs: 1000,
        debug: false,
      });
      
      expect(customVad.isActive()).toBe(false);
      customVad.start();
      expect(customVad.isActive()).toBe(true);
      customVad.stop();
    });
  });

  describe('start/stop', () => {
    it('should start the service', () => {
      vad.start();
      expect(vad.isActive()).toBe(true);
      expect(vad.getState()).toBe(VadState.IDLE);
    });

    it('should stop the service', () => {
      vad.start();
      vad.stop();
      expect(vad.isActive()).toBe(false);
    });

    it('should emit start event', () => {
      const listener = vi.fn();
      vad.on('start', listener);
      
      vad.start();
      
      expect(listener).toHaveBeenCalled();
    });

    it('should emit stop event', () => {
      vad.start();
      const listener = vi.fn();
      vad.on('stop', listener);
      
      vad.stop();
      
      expect(listener).toHaveBeenCalled();
    });

    it('should not process frames when stopped', () => {
      // Don't start - just try to process
      const frame = createTestFrame(160); // 160 bytes = 5ms @ 16kHz
      vad.processFrame(frame);
      
      expect(vad.getState()).toBe(VadState.IDLE);
    });
  });

  describe('energy calculation', () => {
    it('should calculate zero energy for silent frame', () => {
      vad.start();
      
      // Create silent frame (all zeros)
      const silentFrame = createTestFrame(160);
      silentFrame.data.fill(0);
      
      // Process frame and check energy via event
      let energy = 0;
      vad.on('vad.frame', (event: any) => {
        energy = event.energy;
      });
      
      vad.processFrame(silentFrame);
      
      expect(energy).toBe(0);
    });

    it('should calculate non-zero energy for audio', () => {
      vad.start();
      
      // Create frame with some audio (non-zero samples)
      const audioFrame = createTestFrame(160);
      // Set some samples to non-zero values
      for (let i = 0; i < 160; i += 2) {
        audioFrame.data.writeInt16LE(1000, i); // Small amplitude
      }
      
      let energy = 0;
      vad.on('vad.frame', (event: any) => {
        energy = event.energy;
      });
      
      vad.processFrame(audioFrame);
      
      expect(energy).toBeGreaterThan(0);
    });

    it('should calculate higher energy for louder audio', () => {
      vad.start();
      
      // Quiet frame
      const quietFrame = createTestFrame(160);
      for (let i = 0; i < 160; i += 2) {
        quietFrame.data.writeInt16LE(1000, i);
      }
      
      // Loud frame
      const loudFrame = createTestFrame(160);
      for (let i = 0; i < 160; i += 2) {
        loudFrame.data.writeInt16LE(20000, i); // Much louder
      }
      
      let quietEnergy = 0;
      let loudEnergy = 0;
      
      vad.on('vad.frame', (event: any) => {
        if (event.frame === quietFrame) {
          quietEnergy = event.energy;
        } else if (event.frame === loudFrame) {
          loudEnergy = event.energy;
        }
      });
      
      vad.processFrame(quietFrame);
      vad.processFrame(loudFrame);
      
      expect(loudEnergy).toBeGreaterThan(quietEnergy);
    });
  });

  describe('speech detection', () => {
    it('should detect speech start', () => {
      vad.start();
      
      const speechStartListener = vi.fn();
      vad.on(VadEventType.SPEECH_START, speechStartListener);
      
      // Process frames above threshold
      for (let i = 0; i < 20; i++) {
        const frame = createTestFrame(160);
        // Set samples to create high energy
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j); // High amplitude
        }
        vad.processFrame(frame);
      }
      
      expect(speechStartListener).toHaveBeenCalled();
    });

    it('should not trigger on brief noise (minSpeechDuration)', () => {
      vad.start();
      
      const speechStartListener = vi.fn();
      vad.on(VadEventType.SPEECH_START, speechStartListener);
      
      // Process only a few frames (below minSpeechDuration)
      for (let i = 0; i < 5; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      // Should not have triggered yet (need 200ms = ~10 frames)
      expect(speechStartListener).not.toHaveBeenCalled();
    });

    it('should emit vad.frame event for each processed frame', () => {
      vad.start();
      
      const vadFrameListener = vi.fn();
      vad.on('vad.frame', vadFrameListener);
      
      const frame = createTestFrame(160);
      vad.processFrame(frame);
      
      expect(vadFrameListener).toHaveBeenCalled();
      const event = vadFrameListener.mock.calls[0][0];
      expect(event.frame).toBe(frame);
      expect(event.energy).toBeDefined();
      expect(event.isSpeech).toBeDefined();
      expect(event.state).toBeDefined();
    });
  });

  describe('turn detection', () => {
    it('should detect turn end after silence', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100, // Short silence for testing
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      const turnEndListener = vi.fn();
      vad.on(VadEventType.TURN_END, turnEndListener);
      
      // Generate speech frames
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
        // Small delay to accumulate time
        const start = Date.now();
        while (Date.now() - start < 10) {} // 10ms delay
      }
      
      // Generate silence frames
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0); // Silent
        vad.processFrame(frame);
        const start = Date.now();
        while (Date.now() - start < 10) {} // 10ms delay
      }
      
      // Should have detected turn end
      expect(turnEndListener).toHaveBeenCalled();
    });

    it('should generate unique turn IDs', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100, // Short silence for testing (100ms = 5 frames)
        minSpeechDurationMs: 50,
        debug: false,
      });
      vad.start();
      
      const turnIds: string[] = [];
      vad.on(VadEventType.SPEECH_START, (event: any) => {
        if (event.turnId) {
          turnIds.push(event.turnId);
        }
      });
      
      // Trigger multiple turns
      for (let turn = 0; turn < 3; turn++) {
        // Speech (15 frames = 300ms >= minSpeechDurationMs)
        for (let i = 0; i < 15; i++) {
          const frame = createTestFrame(160);
          for (let j = 0; j < 160; j += 2) {
            frame.data.writeInt16LE(15000, j);
          }
          vad.processFrame(frame);
        }
        
        // Silence (10 frames = 200ms >= silenceThresholdMs)
        for (let i = 0; i < 10; i++) {
          const frame = createTestFrame(160);
          frame.data.fill(0);
          vad.processFrame(frame);
        }
      }
      
      // Should have 3 unique turn IDs
      expect(turnIds.length).toBe(3);
      expect(new Set(turnIds).size).toBe(3); // All unique
    });

    it('should track turns completed in stats', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100,
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      // Trigger a turn
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }
      
      const stats = vad.getStats();
      expect(stats.turnsCompleted).toBe(1);
    });
  });

  describe('state transitions', () => {
    it('should transition IDLE -> SPEECH_START -> SPEECH_ACTIVE', () => {
      vad.start();
      expect(vad.getState()).toBe(VadState.IDLE);
      
      // Trigger speech start
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      // Should be in SPEECH_ACTIVE
      expect(vad.getState()).toBe(VadState.SPEECH_ACTIVE);
    });

    it('should transition SPEECH_ACTIVE -> SILENCE -> IDLE', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100,
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      // Trigger speech
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      expect(vad.getState()).toBe(VadState.SPEECH_ACTIVE);
      
      // Trigger silence
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }
      
      expect(vad.getState()).toBe(VadState.IDLE);
    });

    it('should handle speech resumption during silence', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 500, // Long silence threshold
        minSpeechDurationMs: 50,
        hangoverFrames: 3, // Low hangover so we can reach SILENCE state
        debug: true,
      });
      vad.start();

      // Start speech
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }

      expect(vad.getState()).toBe(VadState.SPEECH_ACTIVE);

      // Brief silence (exceeds hangover of 3, but not enough to end turn at 500ms)
      for (let i = 0; i < 8; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }

      // Should be in SILENCE state (past hangover but below silenceThresholdMs)
      expect(vad.getState()).toBe(VadState.SILENCE);

      // Speech resumes
      for (let i = 0; i < 5; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }

      // Should be back to SPEECH_ACTIVE
      expect(vad.getState()).toBe(VadState.SPEECH_ACTIVE);
    });
  });

  describe('statistics', () => {
    it('should track frame counter', () => {
      vad.start();
      
      for (let i = 0; i < 10; i++) {
        vad.processFrame(createTestFrame(160));
      }
      
      const stats = vad.getStats();
      expect(stats.frameCounter).toBe(10);
    });

    it('should track speech duration', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100,
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      // Generate speech
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      // Generate silence
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }
      
      const stats = vad.getStats();
      expect(stats.totalSpeechDurationMs).toBeGreaterThan(0);
    });

    it('should reset stats on resetStats()', () => {
      vad.start();
      
      for (let i = 0; i < 10; i++) {
        vad.processFrame(createTestFrame(160));
      }
      
      vad.resetStats();
      
      const stats = vad.getStats();
      expect(stats.frameCounter).toBe(0);
      expect(stats.turnsCompleted).toBe(0);
    });
  });

  describe('current turn tracking', () => {
    it('should return null when no active turn', () => {
      vad.start();
      expect(vad.getCurrentTurnId()).toBeNull();
    });

    it('should return turn ID during speech', () => {
      vad.start();
      
      // Trigger speech start
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      const turnId = vad.getCurrentTurnId();
      expect(turnId).not.toBeNull();
      expect(turnId).toContain('turn_');
    });

    it('should return null after turn ends', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100,
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      // Trigger speech and silence
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }
      
      expect(vad.getCurrentTurnId()).toBeNull();
    });
  });

  describe('speech frames collection', () => {
    it('should collect speech frames', () => {
      vad.start();
      
      // Trigger speech
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      const frames = vad.getCurrentSpeechFrames();
      expect(frames.length).toBeGreaterThan(0);
    });

    it('should clear speech frames on turn end', () => {
      vad = new VadService({
        ...defaultVadConfig,
        silenceThresholdMs: 100,
        minSpeechDurationMs: 50,
        debug: true,
      });
      vad.start();
      
      // Trigger speech
      for (let i = 0; i < 15; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      expect(vad.getCurrentSpeechFrames().length).toBeGreaterThan(0);
      
      // Trigger silence
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        frame.data.fill(0);
        vad.processFrame(frame);
      }
      
      expect(vad.getCurrentSpeechFrames().length).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty audio frame', () => {
      vad.start();
      
      const emptyFrame: AudioFrame = {
        data: Buffer.alloc(0),
        sampleRate: 16000,
        channels: 1,
        format: 'pcm16',
        timestamp: Date.now(),
        durationMs: 0,
      };
      
      expect(() => vad.processFrame(emptyFrame)).not.toThrow();
    });

    it('should handle stop during speech', () => {
      vad.start();
      
      // Start speech
      for (let i = 0; i < 10; i++) {
        const frame = createTestFrame(160);
        for (let j = 0; j < 160; j += 2) {
          frame.data.writeInt16LE(15000, j);
        }
        vad.processFrame(frame);
      }
      
      const speechEndListener = vi.fn();
      vad.on(VadEventType.SPEECH_END, speechEndListener);
      
      vad.stop();
      
      // Should emit speech end
      expect(speechEndListener).toHaveBeenCalled();
    });

    it('should be idempotent on multiple start() calls', () => {
      vad.start();
      vad.start(); // Should not cause issues
      
      expect(vad.isActive()).toBe(true);
    });

    it('should be idempotent on multiple stop() calls', () => {
      vad.start();
      vad.stop();
      vad.stop(); // Should not cause issues
      
      expect(vad.isActive()).toBe(false);
    });
  });
});

/**
 * Helper function to create test audio frames
 */
function createTestFrame(size: number): AudioFrame {
  return {
    data: Buffer.alloc(size),
    sampleRate: 16000,
    channels: 1,
    format: 'pcm16',
    timestamp: Date.now(),
    durationMs: (size / (16000 * 2)) * 1000, // size in bytes, 16-bit = 2 bytes/sample
  };
}
