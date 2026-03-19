/**
 * Audio Resampler Utility
 *
 * Resamples PCM16 audio between different sample rates using linear interpolation.
 * Supports the common rates needed by the pipeline:
 *   - LiveKit: 48000 Hz
 *   - Whisper STT: 16000 Hz
 *   - Chatterbox TTS: ~22050 Hz
 */

/**
 * Resample PCM16 audio from one sample rate to another using linear interpolation.
 *
 * @param input - Buffer of signed 16-bit little-endian PCM samples
 * @param fromRate - Source sample rate in Hz
 * @param toRate - Target sample rate in Hz
 * @param channels - Number of audio channels (default 1)
 * @returns Resampled PCM16 buffer
 */
export function resample(input: Buffer, fromRate: number, toRate: number, channels: number = 1): Buffer {
  if (fromRate === toRate) {
    return Buffer.from(input);
  }

  const bytesPerSample = 2; // 16-bit
  const frameSize = bytesPerSample * channels;
  const inputFrameCount = Math.floor(input.length / frameSize);

  if (inputFrameCount === 0) {
    return Buffer.alloc(0);
  }

  const ratio = fromRate / toRate;
  const outputFrameCount = Math.ceil(inputFrameCount / ratio);
  const output = Buffer.alloc(outputFrameCount * frameSize);

  for (let outIdx = 0; outIdx < outputFrameCount; outIdx++) {
    const srcPos = outIdx * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;

    for (let ch = 0; ch < channels; ch++) {
      const offset = ch * bytesPerSample;

      // Read current sample
      const idx0 = srcIdx * frameSize + offset;
      const sample0 = idx0 + 1 < input.length ? input.readInt16LE(idx0) : 0;

      // Read next sample for interpolation
      const idx1 = (srcIdx + 1) * frameSize + offset;
      const sample1 = idx1 + 1 < input.length ? input.readInt16LE(idx1) : sample0;

      // Linear interpolation
      const interpolated = Math.round(sample0 + frac * (sample1 - sample0));

      // Clamp to Int16 range
      const clamped = Math.max(-32768, Math.min(32767, interpolated));

      const outOffset = outIdx * frameSize + offset;
      output.writeInt16LE(clamped, outOffset);
    }
  }

  return output;
}

/**
 * Convert an Int16Array (as from @livekit/rtc-node AudioFrame) to a Buffer of PCM16 LE bytes.
 */
export function int16ArrayToBuffer(samples: Int16Array): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], i * 2);
  }
  return buf;
}

/**
 * Convert a PCM16 LE Buffer to an Int16Array.
 */
export function bufferToInt16Array(buf: Buffer): Int16Array {
  const samples = new Int16Array(Math.floor(buf.length / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(i * 2);
  }
  return samples;
}
