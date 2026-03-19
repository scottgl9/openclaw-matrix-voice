/**
 * Whisper STT Adapter
 *
 * Implements the STTAdapter interface for faster-whisper-server or whisper.cpp
 * HTTP servers exposing an OpenAI-compatible /v1/audio/transcriptions endpoint.
 */

import axios from 'axios';
import { WaveFile } from 'wavefile';
import { STTAdapter, STTResult } from './stt-adapter.js';
import { AudioFrame } from './audio-pipeline.js';
import { withRetry } from '../utils/retry.js';

export interface WhisperConfig {
  url: string;
  model?: string;
  language?: string;
}

export class WhisperSTTAdapter implements STTAdapter {
  private config: WhisperConfig;
  private isReadyFlag: boolean = false;
  private frameBuffer: AudioFrame[] = [];

  constructor(config: WhisperConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log(`[STT/Whisper] Initializing Whisper adapter at ${this.config.url}`);

    // Health check
    try {
      await axios.get(`${this.config.url}/health`, { timeout: 5000 });
    } catch {
      try {
        await axios.get(`${this.config.url}/v1/models`, { timeout: 5000 });
      } catch {
        console.warn('[STT/Whisper] Health check failed - server may not be running yet');
      }
    }

    this.isReadyFlag = true;
    console.log('[STT/Whisper] Whisper adapter initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[STT/Whisper] Shutting down Whisper adapter');
    this.isReadyFlag = false;
    this.frameBuffer = [];
  }

  async transcribeFrame(frame: AudioFrame): Promise<STTResult | null> {
    if (!this.isReadyFlag) {
      throw new Error('Whisper adapter not initialized');
    }

    this.frameBuffer.push(frame);
    return null;
  }

  async finalize(): Promise<STTResult> {
    if (!this.isReadyFlag) {
      throw new Error('Whisper adapter not initialized');
    }

    if (this.frameBuffer.length === 0) {
      return { text: '', confidence: 0 };
    }

    // Concatenate frames into a single PCM buffer
    const totalLength = this.frameBuffer.reduce((sum, f) => sum + f.data.length, 0);
    const pcmData = Buffer.alloc(totalLength);
    let offset = 0;
    for (const frame of this.frameBuffer) {
      frame.data.copy(pcmData, offset);
      offset += frame.data.length;
    }

    const sampleRate = this.frameBuffer[0].sampleRate;
    const channels = this.frameBuffer[0].channels;

    const wavBuffer = this.pcmToWav(pcmData, sampleRate, channels);

    // POST to Whisper API with retry
    const result = await withRetry(
      async () => {
        const formData = new FormData();
        formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
        formData.append('model', this.config.model || 'whisper-1');
        if (this.config.language) {
          formData.append('language', this.config.language);
        }
        formData.append('response_format', 'json');

        const response = await axios.post(
          `${this.config.url}/v1/audio/transcriptions`,
          formData,
          { timeout: 30000 }
        );

        return response.data;
      },
      { maxAttempts: 2, label: 'Whisper STT', timeoutMs: 30000 }
    );

    const text = result.text || '';
    console.log(`[STT/Whisper] Transcribed: "${text}"`);

    return {
      text: text.trim(),
      confidence: 0.9,
      language: this.config.language || result.language || 'en',
      durationMs: (pcmData.length / (sampleRate * 2 * channels)) * 1000,
    };
  }

  reset(): void {
    this.frameBuffer = [];
  }

  isReady(): boolean {
    return this.isReadyFlag;
  }

  getName(): string {
    return 'Whisper';
  }

  private pcmToWav(pcmData: Buffer, sampleRate: number, channels: number): Buffer {
    const wav = new WaveFile();

    const samples = new Int16Array(pcmData.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = pcmData.readInt16LE(i * 2);
    }

    wav.fromScratch(channels, sampleRate, '16', Array.from(samples));
    return Buffer.from(wav.toBuffer());
  }
}
