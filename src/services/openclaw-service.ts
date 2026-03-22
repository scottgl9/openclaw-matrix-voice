import axios, { AxiosError } from 'axios';
import { config } from '../config/index.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('OpenClaw');

export interface OpenClawResponse {
  success: boolean;
  response?: string;
  silent?: boolean;  // true when agent chose to stay silent (NO_REPLY)
  error?: string;
}

// Strings the gateway emits when an agent intentionally returns NO_REPLY
const SILENT_RESPONSES = new Set([
  'NO_REPLY',
  'No response from OpenClaw.',
]);

// Key phrase the agent can return to explicitly stay silent
const SILENT_TOKEN = '[SILENT]';

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
  /** Per-agent conversation histories keyed by agentId */
  private agentHistories: Map<string, ChatCompletionMessage[]> = new Map();
  private maxHistory: number;
  /** Currently active agent ID (set when a call starts, used as default) */
  private activeAgentId: string;

  constructor(baseUrl?: string, token?: string) {
    this.baseUrl = baseUrl || config.openclaw.apiUrl;
    this.token = token || config.openclaw.apiToken;
    this.maxHistory = config.openclaw.maxConversationHistory;
    this.activeAgentId = config.voiceAgents.defaultAgentId;
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

  /**
   * Set the active agent for the current call.
   * Clears conversation history when switching agents.
   */
  setActiveAgent(agentId: string): void {
    if (agentId !== this.activeAgentId) {
      log.info(`Switching voice agent: ${this.activeAgentId} → ${agentId}`);
      this.activeAgentId = agentId;
    }
  }

  /**
   * Resolve agent ID for a given Matrix room.
   */
  static resolveAgentForRoom(roomId: string): string {
    return config.voiceAgents.roomMap[roomId] || config.voiceAgents.defaultAgentId;
  }

  getActiveAgentId(): string {
    return this.activeAgentId;
  }

  private getHistory(agentId: string): ChatCompletionMessage[] {
    if (!this.agentHistories.has(agentId)) {
      this.agentHistories.set(agentId, []);
    }
    return this.agentHistories.get(agentId)!;
  }

  private trimAgentHistory(agentId: string): void {
    const history = this.getHistory(agentId);
    if (history.length > this.maxHistory) {
      const trimmed = history.slice(-this.maxHistory);
      this.agentHistories.set(agentId, trimmed);
    }
  }

  async processText(text: string, agentId?: string): Promise<OpenClawResponse> {
    await this.rateLimiter.acquire();

    const resolvedAgent = agentId || this.activeAgentId;
    const history = this.getHistory(resolvedAgent);
    history.push({ role: 'user', content: text });
    this.trimAgentHistory(resolvedAgent);

    const makeRequest = async () => {
      // Build per-agent system prompt:
      // 1. Use explicit prompt from VOICE_AGENT_PROMPTS if configured
      // 2. Otherwise use default prompt with agent name injected from VOICE_AGENT_NAMES
      const agentPromptText = config.voiceAgents.agentPrompts[resolvedAgent];
      const agentName = config.voiceAgents.agentNames[resolvedAgent];
      let systemMsg: ChatCompletionMessage;
      if (agentPromptText) {
        systemMsg = { role: 'system', content: agentPromptText };
      } else if (agentName) {
        systemMsg = {
          role: 'system',
          content: `${this.systemMessage.content} Your name is ${agentName}.`,
        };
      } else {
        systemMsg = this.systemMessage;
      }

      return axios.post<ChatCompletionResponse>(
        `${this.baseUrl}/v1/chat/completions`,
        {
          model: `openclaw:${resolvedAgent}`,
          messages: [systemMsg, ...this.getHistory(resolvedAgent)],
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
    };

    try {
      const response = await makeRequest();
      let assistantMessage = response.data.choices?.[0]?.message?.content || '';

      // Retry once if empty response (gateway may rate-limit rapid requests)
      if (!assistantMessage) {
        console.warn(`[OpenClaw] Empty response from ${resolvedAgent}, retrying once...`);
        await new Promise(resolve => setTimeout(resolve, 500));
        const retry = await makeRequest();
        assistantMessage = retry.data.choices?.[0]?.message?.content || '';
      }

      if (assistantMessage) {
        history.push({ role: 'assistant', content: assistantMessage });
        this.trimAgentHistory(resolvedAgent);
      }

      // Agent chose to stay silent — either NO_REPLY (stripped by gateway) or explicit [SILENT] token
      const trimmed = assistantMessage.trim();
      if (!trimmed || SILENT_RESPONSES.has(trimmed) || trimmed === SILENT_TOKEN) {
        return { success: true, silent: true };
      }

      return {
        success: true,
        response: assistantMessage,
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

  /**
   * Clear conversation history for a specific agent, or the active agent if not specified.
   */
  clearHistory(agentId?: string): void {
    const target = agentId || this.activeAgentId;
    this.agentHistories.delete(target);
    log.info(`Cleared conversation history for agent: ${target}`);
  }

  /**
   * Clear all agent histories.
   */
  clearAllHistory(): void {
    this.agentHistories.clear();
  }
}
