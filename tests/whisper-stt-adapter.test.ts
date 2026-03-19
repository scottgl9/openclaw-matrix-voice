import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhisperSTTAdapter } from '../src/services/whisper-stt-adapter.js';
import { AudioFrame } from '../src/services/audio-pipeline.js';
import axios from 'axios';

vi.mock('axios');

describe('WhisperSTTAdapter', () => {
  let adapter: WhisperSTTAdapter;

  beforeEach(() => {
    adapter = new WhisperSTTAdapter({
      url: 'http://localhost:8080',
      model: 'whisper-1',
      language: 'en',
    });

    // Mock health check
    vi.mocked(axios.get).mockResolvedValue({ status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeFrame(durationMs: number = 20, sampleRate: number = 16000): AudioFrame {
    const numSamples = Math.floor(sampleRate * durationMs / 1000);
    const data = Buffer.alloc(numSamples * 2);
    // Fill with a simple sine wave
    for (let i = 0; i < numSamples; i++) {
      data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 10000), i * 2);
    }
    return {
      data,
      sampleRate,
      channels: 1,
      format: 'pcm16',
      timestamp: Date.now(),
      durationMs,
    };
  }

  describe('initialize', () => {
    it('should initialize and mark as ready', async () => {
      await adapter.initialize();
      expect(adapter.isReady()).toBe(true);
    });

    it('should handle health check failure gracefully', async () => {
      vi.mocked(axios.get).mockRejectedValue(new Error('connection refused'));
      await adapter.initialize();
      // Should still be ready - health check failure is non-fatal
      expect(adapter.isReady()).toBe(true);
    });
  });

  describe('getName', () => {
    it('should return Whisper', () => {
      expect(adapter.getName()).toBe('Whisper');
    });
  });

  describe('transcribeFrame', () => {
    it('should accumulate frames and return null', async () => {
      await adapter.initialize();
      const frame = makeFrame();
      const result = await adapter.transcribeFrame(frame);
      expect(result).toBeNull();
    });

    it('should throw if not initialized', async () => {
      const frame = makeFrame();
      await expect(adapter.transcribeFrame(frame)).rejects.toThrow('not initialized');
    });
  });

  describe('finalize', () => {
    it('should return empty text when no frames accumulated', async () => {
      await adapter.initialize();
      const result = await adapter.finalize();
      expect(result.text).toBe('');
      expect(result.confidence).toBe(0);
    });

    it('should send WAV to Whisper API and return transcription', async () => {
      await adapter.initialize();

      // Accumulate some frames
      await adapter.transcribeFrame(makeFrame(20));
      await adapter.transcribeFrame(makeFrame(20));
      await adapter.transcribeFrame(makeFrame(20));

      // Mock the transcription API
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: { text: 'Hello world' },
      });

      const result = await adapter.finalize();

      expect(result.text).toBe('Hello world');
      expect(result.confidence).toBe(0.9);
      expect(result.language).toBe('en');
      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8080/v1/audio/transcriptions',
        expect.any(FormData),
        expect.objectContaining({ timeout: 30000 })
      );
    });

    it('should throw on API error', async () => {
      await adapter.initialize();
      await adapter.transcribeFrame(makeFrame());

      vi.mocked(axios.post).mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(adapter.finalize()).rejects.toThrow('Whisper transcription failed');
    });
  });

  describe('reset', () => {
    it('should clear frame buffer', async () => {
      await adapter.initialize();
      await adapter.transcribeFrame(makeFrame());
      await adapter.transcribeFrame(makeFrame());

      adapter.reset();

      // After reset, finalize should return empty
      const result = await adapter.finalize();
      expect(result.text).toBe('');
    });
  });

  describe('shutdown', () => {
    it('should mark as not ready', async () => {
      await adapter.initialize();
      expect(adapter.isReady()).toBe(true);

      await adapter.shutdown();
      expect(adapter.isReady()).toBe(false);
    });
  });
});
