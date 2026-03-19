import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { OpenClawService } from '../src/services/openclaw-service.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('OpenClawService', () => {
  let service: OpenClawService;
  const mockBaseUrl = 'http://test-api:18789';
  const mockToken = 'test-token-123';

  beforeEach(() => {
    service = new OpenClawService(mockBaseUrl, mockToken);
    vi.clearAllMocks();
  });

  describe('processText', () => {
    it('should successfully process text and return response', async () => {
      const mockResponse = {
        data: {
          response: 'Hello, how can I help you?',
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await service.processText('Hello');

      expect(result.success).toBe(true);
      expect(result.response).toBe('Hello, how can I help you?');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${mockBaseUrl}/gateway`,
        {
          type: 'text',
          content: 'Hello',
          channel: 'matrix',
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
          timeout: 30000,
        })
      );
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
});
