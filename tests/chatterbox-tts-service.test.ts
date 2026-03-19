import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ChatterboxTTSService } from '../src/services/chatterbox-tts-service.js';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('ChatterboxTTSService', () => {
  let service: ChatterboxTTSService;
  const mockTtsUrl = 'http://test-tts:8000/tts';
  const mockApiKey = 'test-api-key';

  beforeEach(() => {
    service = new ChatterboxTTSService(mockTtsUrl, mockApiKey);
    vi.clearAllMocks();
  });

  describe('textToSpeech', () => {
    it('should successfully convert text to speech', async () => {
      const mockAudioData = Buffer.from('fake-wav-data');
      const mockResponse = {
        data: mockAudioData,
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await service.textToSpeech('Hello world');

      expect(result.success).toBe(true);
      expect(result.audioData).toEqual(mockAudioData);
      expect(result.mimeType).toBe('audio/wav');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockTtsUrl,
        {
          text: 'Hello world',
          format: 'wav',
          sampleRate: 16000,
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
          }),
          responseType: 'arraybuffer',
          timeout: 30000,
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      const mockError = new Error('TTS Service Unavailable');
      mockedAxios.post.mockRejectedValue(mockError);

      const result = await service.textToSpeech('Hello world');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should work without API key', async () => {
      const serviceNoKey = new ChatterboxTTSService(mockTtsUrl);
      const mockAudioData = Buffer.from('fake-wav-data');
      const mockResponse = {
        data: mockAudioData,
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await serviceNoKey.textToSpeech('Hello world');

      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockTtsUrl,
        expect.any(Object),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });
  });

  describe('textToSpeechCached', () => {
    it('should cache results and return cached data on second call', async () => {
      const mockAudioData = Buffer.from('cached-wav-data');
      const mockResponse = {
        data: mockAudioData,
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      // First call - should hit API
      const result1 = await service.textToSpeechCached('Hello');
      expect(result1.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      // Second call with same text - should use cache
      mockedAxios.post.mockClear();
      const result2 = await service.textToSpeechCached('Hello');
      expect(result2.success).toBe(true);
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result2.audioData).toEqual(result1.audioData);
    });

    it('should cache with case-insensitive keys', async () => {
      const mockAudioData = Buffer.from('cached-data');
      const mockResponse = {
        data: mockAudioData,
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      await service.textToSpeechCached('Hello World');
      mockedAxios.post.mockClear();
      
      await service.textToSpeechCached('hello world');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});
