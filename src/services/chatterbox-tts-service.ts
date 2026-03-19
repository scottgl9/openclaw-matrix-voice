import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';

export interface TTSResponse {
  success: boolean;
  audioData?: Buffer;
  mimeType?: string;
  error?: string;
}

export class ChatterboxTTSService {
  private ttsUrl: string;
  private apiKey?: string;

  constructor(ttsUrl?: string, apiKey?: string) {
    this.ttsUrl = ttsUrl || config.chatterbox.ttsUrl;
    this.apiKey = apiKey || config.chatterbox.apiKey;
  }

  /**
   * Convert text to speech using Chatterbox TTS
   * Supports both service mode (local) and API mode (remote)
   */
  async textToSpeech(text: string): Promise<TTSResponse> {
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
          sampleRate: config.audio.sampleRate,
        },
        {
          headers,
          responseType: 'arraybuffer',
          timeout: 30000,
        }
      );

      return {
        success: true,
        audioData: Buffer.from(response.data),
        mimeType: 'audio/wav',
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error('Chatterbox TTS error:', axiosError.message);
      return {
        success: false,
        error: axiosError.message,
      };
    }
  }

  /**
   * Cache TTS results to avoid redundant generation
   */
  private ttsCache = new Map<string, Buffer>();

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

export const chatterboxTTSService = new ChatterboxTTSService();
