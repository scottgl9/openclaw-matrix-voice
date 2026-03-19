import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { OpenClawService } from '../src/services/openclaw-service.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

function chatResponse(content: string) {
  return {
    data: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: Date.now(),
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
    },
  };
}

describe('OpenClawService', () => {
  let service: OpenClawService;
  const mockBaseUrl = 'http://test-api:18789';
  const mockToken = 'test-token-123';

  beforeEach(() => {
    service = new OpenClawService(mockBaseUrl, mockToken);
    vi.clearAllMocks();
  });

  describe('processText', () => {
    it('should send chat completions request with system prompt', async () => {
      mockedAxios.post.mockResolvedValue(chatResponse('Hello, how can I help you?'));

      const result = await service.processText('Hello');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Hello, how can I help you?');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${mockBaseUrl}/v1/chat/completions`,
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            { role: 'user', content: 'Hello' },
          ]),
          stream: false,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
          timeout: 60000,
        })
      );
    });

    it('should maintain conversation history across calls', async () => {
      mockedAxios.post
        .mockResolvedValueOnce(chatResponse('Hi there!'))
        .mockResolvedValueOnce(chatResponse('I can help with that.'));

      await service.processText('Hello');
      await service.processText('Can you help?');

      const secondCall = mockedAxios.post.mock.calls[1];
      const messages = secondCall[1].messages;

      // system + user "Hello" + assistant "Hi there!" + user "Can you help?"
      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe('system');
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(messages[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
      expect(messages[3]).toEqual({ role: 'user', content: 'Can you help?' });
    });

    it('should handle API errors gracefully', async () => {
      const mockError = new Error('Network Error');
      (mockError as any).code = 'ECONNREFUSED';
      mockedAxios.post.mockRejectedValue(mockError);

      const result = await service.processText('Hello');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network Error');
    });

    it('should handle timeout errors', async () => {
      const mockError = new Error('Timeout');
      (mockError as any).code = 'ECONNABORTED';
      mockedAxios.post.mockRejectedValue(mockError);

      const result = await service.processText('Hello');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('conversation history limits', () => {
    it('should trim history beyond max limit', async () => {
      // Default max is 20; send 12 messages (each produces user+assistant = 24 entries)
      for (let i = 0; i < 12; i++) {
        mockedAxios.post.mockResolvedValueOnce(chatResponse(`Response ${i}`));
        await service.processText(`Message ${i}`);
      }

      const lastCall = mockedAxios.post.mock.calls[11];
      const messages = lastCall[1].messages;
      // system prompt + last 20 history entries (trimmed)
      expect(messages[0].role).toBe('system');
      // History should be capped at 20 (not 24)
      expect(messages.length).toBeLessThanOrEqual(21); // system + 20
    });
  });

  describe('clearHistory', () => {
    it('should clear conversation history', async () => {
      mockedAxios.post.mockResolvedValue(chatResponse('Hi!'));
      await service.processText('Hello');

      service.clearHistory();

      mockedAxios.post.mockResolvedValue(chatResponse('Fresh start'));
      await service.processText('New conversation');

      const lastCall = mockedAxios.post.mock.calls[1];
      const messages = lastCall[1].messages;
      // system + just the new user message
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe('system');
      expect(messages[1]).toEqual({ role: 'user', content: 'New conversation' });
    });
  });
});
