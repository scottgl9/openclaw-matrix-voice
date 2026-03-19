import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';

export interface OpenClawResponse {
  success: boolean;
  response?: string;
  error?: string;
}

export class OpenClawService {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || config.openclaw.apiUrl;
    this.token = token || config.openclaw.apiToken;
  }

  /**
   * Send text to OpenClaw agent and get response
   * Uses the gateway HTTP API for text processing
   */
  async processText(text: string): Promise<OpenClawResponse> {
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
      console.error('OpenClaw API error:', axiosError.message);
      return {
        success: false,
        error: axiosError.message,
      };
    }
  }

  /**
   * Alternative: Use WebSocket gateway protocol for more interactive communication
   */
  async processTextWebSocket(text: string): Promise<OpenClawResponse> {
    // This would be implemented for WebSocket-based communication
    // For MVP, we'll use HTTP API
    return this.processText(text);
  }
}

export const openClawService = new OpenClawService();
