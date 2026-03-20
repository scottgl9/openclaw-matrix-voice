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

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
}

export class OpenClawService {
  private baseUrl: string;
  private token: string;
  private rateLimiter: RateLimiter;
  private systemMessage: ChatCompletionMessage;
  private conversationHistory: ChatCompletionMessage[] = [];
  private maxHistory: number;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || config.openclaw.apiUrl;
    this.token = token || config.openclaw.apiToken;
    this.maxHistory = config.openclaw.maxConversationHistory;
    this.systemMessage = {
      role: 'system',
      content: config.openclaw.systemPrompt,
    };
    this.rateLimiter = new RateLimiter({
      maxTokens: 10,
      refillRate: 5,
      label: 'OpenClaw',
    });
  }

  async processText(text: string): Promise<OpenClawResponse> {
    await this.rateLimiter.acquire();

    this.conversationHistory.push({ role: 'user', content: text });
    this.trimHistory();

    try {
      const response = await axios.post<ChatCompletionResponse>(
        `${this.baseUrl}/v1/chat/completions`,
        {
          model: `openclaw:${config.openclaw.agentId}`,
          messages: [this.systemMessage, ...this.conversationHistory],
          stream: false,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
          },
          timeout: 60000,
        }
      );

      const assistantMessage = response.data.choices?.[0]?.message?.content || '';
      if (assistantMessage) {
        this.conversationHistory.push({ role: 'assistant', content: assistantMessage });
        this.trimHistory();
      }

      return {
        success: true,
        response: assistantMessage || 'No response generated',
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      log.error('API error', { error: axiosError.message, status: axiosError.response?.status });
      return {
        success: false,
        error: axiosError.message,
      };
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  private trimHistory(): void {
    if (this.conversationHistory.length > this.maxHistory) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
    }
  }
}
