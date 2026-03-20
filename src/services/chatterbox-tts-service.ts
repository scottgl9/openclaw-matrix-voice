import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TTS');

export interface TTSResponse {
  success: boolean;
  audioData?: Buffer;
  mimeType?: string;
  error?: string;
}

export class ChatterboxTTSService {
  private ttsUrl: string;
  private apiKey?: string;
  private ttsCache = new Map<string, Buffer>();
  private rateLimiter: RateLimiter;

  constructor(ttsUrl?: string, apiKey?: string) {
    this.ttsUrl = ttsUrl || config.chatterbox.ttsUrl;
    this.apiKey = apiKey || config.chatterbox.apiKey;
    this.rateLimiter = new RateLimiter({
      maxTokens: 5,
      refillRate: 3,
      label: 'TTS',
    });
  }

  async textToSpeech(text: string): Promise<TTSResponse> {
    await this.rateLimiter.acquire();

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await axios.post(
        this.ttsUrl,
        {
          text,
          format: 'wav',
          sampleRate: 24000, // Chatterbox native rate; pipeline resamples to 16kHz
          exaggeration: 0.5,
          cfg_weight: 0.3,
        },
        {
          headers,
          responseType: 'arraybuffer',
          timeout: 90000,
        }
      );

      return {
        success: true,
        audioData: Buffer.from(response.data),
        mimeType: 'audio/wav',
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      log.error('API error', { error: axiosError.message });
      return {
        success: false,
        error: axiosError.message,
      };
    }
  }

  async textToSpeechCached(text: string): Promise<TTSResponse> {
    const cacheKey = text.trim().toLowerCase();

    if (this.ttsCache.has(cacheKey)) {
      const cached = this.ttsCache.get(cacheKey)!;
      return {
        success: true,
        audioData: cached,
        mimeType: 'audio/wav',
      };
    }

    const result = await this.textToSpeech(text);

    if (result.success && result.audioData) {
      this.ttsCache.set(cacheKey, result.audioData);
    }

    return result;
  }
}
