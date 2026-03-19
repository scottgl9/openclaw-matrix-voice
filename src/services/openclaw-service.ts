import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpenClaw');

export interface OpenClawResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export class OpenClawService {
  private baseUrl: string;
  private token: string;
  private rateLimiter: RateLimiter;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || config.openclaw.apiUrl;
    this.token = token || config.openclaw.apiToken;
    this.rateLimiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      label: 'OpenClaw',
    });
  }

  async processText(text: string): Promise<OpenClawResponse> {
    await this.rateLimiter.acquire();

    try {
      const response = await axios.post(
        `${this.baseUrl}/gateway`,
        {
          type: 'text',
          content: text,
          channel: 'matrix',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          timeout: 30000,
        }
      );

      return {
        success: true,
        response: response.data.response || response.data.text || 'No response generated',
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
}
