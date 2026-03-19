import { describe, it, expect } from 'vitest';
import { resample, int16ArrayToBuffer, bufferToInt16Array } from '../src/services/audio-resampler.js';

describe('AudioResampler', () => {
  describe('resample', () => {
    it('should return a copy when rates are equal', () => {
      const input = Buffer.alloc(640);
      for (let i = 0; i < 320; i++) {
        input.writeInt16LE(Math.round(Math.sin(i / 10) * 10000), i * 2);
      }

      const output = resample(input, 16000, 16000, 1);
      expect(output).toEqual(input);
      // Ensure it's a copy, not the same reference
      expect(output).not.toBe(input);
    });

    it('should downsample 48kHz to 16kHz (3:1 ratio)', () => {
      // 480 samples at 48kHz = 10ms
      const input = Buffer.alloc(480 * 2);
      for (let i = 0; i < 480; i++) {
        input.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 48000) * 10000), i * 2);
      }

      const output = resample(input, 48000, 16000, 1);

      // 480 / 3 = 160 samples at 16kHz = 10ms
      expect(output.length).toBe(160 * 2);
    });

    it('should upsample 16kHz to 48kHz (1:3 ratio)', () => {
      // 160 samples at 16kHz = 10ms
      const input = Buffer.alloc(160 * 2);
      for (let i = 0; i < 160; i++) {
        input.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 10000), i * 2);
      }

      const output = resample(input, 16000, 48000, 1);

      // 160 * 3 = 480 samples at 48kHz = 10ms
      expect(output.length).toBe(480 * 2);
    });

    it('should handle empty input', () => {
      const output = resample(Buffer.alloc(0), 48000, 16000, 1);
      expect(output.length).toBe(0);
    });

    it('should handle 22050Hz to 16000Hz (TTS to pipeline)', () => {
      const input = Buffer.alloc(441 * 2); // ~20ms at 22050Hz
      for (let i = 0; i < 441; i++) {
        input.writeInt16LE(1000, i * 2);
      }

      const output = resample(input, 22050, 16000, 1);

      // Should produce ~320 samples (20ms at 16kHz)
      const expectedSamples = Math.ceil(441 / (22050 / 16000));
      expect(output.length / 2).toBe(expectedSamples);
    });

    it('should preserve DC signal (constant value)', () => {
      const input = Buffer.alloc(100 * 2);
      for (let i = 0; i < 100; i++) {
        input.writeInt16LE(5000, i * 2);
      }

      const output = resample(input, 16000, 48000, 1);

      // All samples should be ~5000 (DC signal preserved through interpolation)
      for (let i = 0; i < output.length / 2; i++) {
        expect(output.readInt16LE(i * 2)).toBe(5000);
      }
    });

    it('should clamp to Int16 range', () => {
      const input = Buffer.alloc(4);
      input.writeInt16LE(32767, 0); // Max value
      input.writeInt16LE(-32768, 2); // Min value

      const output = resample(input, 16000, 48000, 1);

      // Should not exceed Int16 range
      for (let i = 0; i < output.length / 2; i++) {
        const sample = output.readInt16LE(i * 2);
        expect(sample).toBeGreaterThanOrEqual(-32768);
        expect(sample).toBeLessThanOrEqual(32767);
      }
    });
  });

  describe('int16ArrayToBuffer', () => {
    it('should convert Int16Array to Buffer', () => {
      const samples = new Int16Array([100, -200, 32767, -32768]);
      const buf = int16ArrayToBuffer(samples);

      expect(buf.length).toBe(8);
      expect(buf.readInt16LE(0)).toBe(100);
      expect(buf.readInt16LE(2)).toBe(-200);
      expect(buf.readInt16LE(4)).toBe(32767);
      expect(buf.readInt16LE(6)).toBe(-32768);
    });

    it('should handle empty array', () => {
      const buf = int16ArrayToBuffer(new Int16Array(0));
      expect(buf.length).toBe(0);
    });
  });

  describe('bufferToInt16Array', () => {
    it('should convert Buffer to Int16Array', () => {
      const buf = Buffer.alloc(8);
      buf.writeInt16LE(100, 0);
      buf.writeInt16LE(-200, 2);
      buf.writeInt16LE(32767, 4);
      buf.writeInt16LE(-32768, 6);

      const samples = bufferToInt16Array(buf);

      expect(samples.length).toBe(4);
      expect(samples[0]).toBe(100);
      expect(samples[1]).toBe(-200);
      expect(samples[2]).toBe(32767);
      expect(samples[3]).toBe(-32768);
    });

    it('should round-trip with int16ArrayToBuffer', () => {
      const original = new Int16Array([1, -1, 1000, -1000, 32767, -32768]);
      const buf = int16ArrayToBuffer(original);
      const result = bufferToInt16Array(buf);

      expect(result).toEqual(original);
    });
  });
});
