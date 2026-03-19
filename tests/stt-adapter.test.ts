import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockSTTAdapter, STTService } from '../src/services/stt-adapter.js';
import { AudioFrame } from '../src/services/audio-pipeline.js';

describe('MockSTTAdapter', () => {
  let adapter: MockSTTAdapter;

  beforeEach(() => {
    adapter = new MockSTTAdapter(['Hello', 'World', 'Test']);
  });

  describe('initialize/shutdown', () => {
    it('should initialize and mark as ready', async () => {
      await adapter.initialize();
      expect(adapter.isReady()).toBe(true);
    });

    it('should shutdown and mark as not ready', async () => {
      await adapter.initialize();
      await adapter.shutdown();
      expect(adapter.isReady()).toBe(false);
    });
  });

  describe('getName', () => {
    it('should return MockSTT', () => {
      expect(adapter.getName()).toBe('MockSTT');
    });
  });

  describe('transcribeFrame', () => {
    it('should return null (no partial results)', async () => {
      await adapter.initialize();
      const frame: AudioFrame = {
        data: Buffer.alloc(640),
        sampleRate: 16000,
        channels: 1,
        format: 'pcm16',
        timestamp: Date.now(),
        durationMs: 20,
      };
      const result = await adapter.transcribeFrame(frame);
      expect(result).toBeNull();
    });
  });

  describe('finalize', () => {
    it('should cycle through mock responses', async () => {
      await adapter.initialize();

      const r1 = await adapter.finalize();
      expect(r1.text).toBe('Hello');
      expect(r1.confidence).toBe(0.95);

      const r2 = await adapter.finalize();
      expect(r2.text).toBe('World');

      const r3 = await adapter.finalize();
      expect(r3.text).toBe('Test');

      // Should wrap around
      const r4 = await adapter.finalize();
      expect(r4.text).toBe('Hello');
    });

    it('should throw if not initialized', async () => {
      await expect(adapter.finalize()).rejects.toThrow('not initialized');
    });
  });

  describe('reset', () => {
    it('should reset response index', async () => {
      await adapter.initialize();
      await adapter.finalize(); // Hello
      await adapter.finalize(); // World

      adapter.reset();

      const result = await adapter.finalize();
      expect(result.text).toBe('Hello'); // Back to first
    });
  });

  describe('setMockResponses', () => {
    it('should update responses and reset index', async () => {
      await adapter.initialize();
      adapter.setMockResponses(['New response']);

      const result = await adapter.finalize();
      expect(result.text).toBe('New response');
    });
  });
});

describe('STTService', () => {
  let service: STTService;
  let adapter: MockSTTAdapter;

  beforeEach(async () => {
    adapter = new MockSTTAdapter(['Transcribed text']);
    service = new STTService(adapter);
  });

  describe('initialize/shutdown', () => {
    it('should initialize the service', async () => {
      await service.initialize();
      expect(service.isRunningFlag()).toBe(true);
    });

    it('should shutdown the service', async () => {
      await service.initialize();
      await service.shutdown();
      expect(service.isRunningFlag()).toBe(false);
    });
  });

  describe('turn processing', () => {
    it('should start and finalize a turn', async () => {
      await service.initialize();

      service.startTurn('turn-123');
      expect(service.getCurrentTurnId()).toBe('turn-123');

      const result = await service.finalizeTurn();
      expect(result.text).toBe('Transcribed text');
      expect(result.turnId).toBe('turn-123');
    });

    it('should throw if not running', async () => {
      await expect(service.finalizeTurn()).rejects.toThrow('not running');
    });
  });

  describe('getAdapterName', () => {
    it('should return the adapter name', () => {
      expect(service.getAdapterName()).toBe('MockSTT');
    });
  });
});
