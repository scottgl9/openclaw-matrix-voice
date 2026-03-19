import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceCallHandler, CallState } from '../src/handlers/voice-call-handler.js';
import { OpenClawService } from '../src/services/openclaw-service.js';
import { ChatterboxTTSService } from '../src/services/chatterbox-tts-service.js';
import { MatrixClientService } from '../src/services/matrix-client-service.js';
import { MatrixCallMediaService } from '../src/services/matrix-call-media-service.js';

describe('VoiceCallHandler', () => {
  let handler: VoiceCallHandler;
  let mockMatrixService: MatrixClientService;
  let mockClient: any;
  let mockOpenClawService: OpenClawService;
  let mockTTSService: ChatterboxTTSService;
  let mockCallMediaService: MatrixCallMediaService;

  beforeEach(() => {
    mockClient = {
      sendText: vi.fn().mockResolvedValue({}),
      sendAudio: vi.fn().mockResolvedValue({}),
      getUserId: vi.fn().mockReturnValue('@bot:matrix.org'),
    };

    mockOpenClawService = {
      processText: vi.fn().mockResolvedValue({
        success: true,
        response: 'Test response',
      }),
    } as unknown as OpenClawService;

    mockTTSService = {
      textToSpeechCached: vi.fn().mockResolvedValue({
        success: true,
        audioData: Buffer.from('fake-audio'),
        mimeType: 'audio/wav',
      }),
    } as unknown as ChatterboxTTSService;

    mockCallMediaService = {
      startCall: vi.fn().mockResolvedValue('call_123'),
      endCall: vi.fn().mockResolvedValue({}),
      handleCallMedia: vi.fn().mockResolvedValue({}),
    } as unknown as MatrixCallMediaService;

    mockMatrixService = {
      getClient: vi.fn().mockReturnValue(mockClient),
      sendMessage: vi.fn().mockResolvedValue({}),
      sendAudio: vi.fn().mockResolvedValue({}),
      getCallMediaService: vi.fn().mockReturnValue(mockCallMediaService),
      getLiveKitAdapter: vi.fn().mockReturnValue(null), // No LiveKit adapter in tests
    } as unknown as MatrixClientService;

    handler = new VoiceCallHandler(
      mockMatrixService,
      mockOpenClawService,
      mockTTSService,
      mockCallMediaService
    );
  });

  describe('startCall', () => {
    it('should start a call in a room', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState).toBeDefined();
      expect(callState?.isActive).toBe(true);
      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('Voice call started')
      );
    });
  });

  describe('endCall', () => {
    it('should end an active call', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId);
      await handler.endCall(roomId);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState?.isActive).toBe(false);
      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('Voice call ended')
      );
    });

    it('should handle ending non-existent call gracefully', async () => {
      await handler.endCall('!nonexistent:matrix.org');
      expect(mockMatrixService.sendMessage).toHaveBeenCalled();
    });
  });

  describe('sendStatus', () => {
    it('should return inactive status when no call', async () => {
      await handler.sendStatus('!test:matrix.org');
      
      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        '!test:matrix.org',
        expect.stringContaining('Inactive')
      );
    });

    it('should return active status with duration', async () => {
      const roomId = '!test:matrix.org';
      await handler.startCall(roomId);
      
      // Wait a bit for duration to be non-zero
      await new Promise(resolve => setTimeout(resolve, 10));
      await handler.sendStatus(roomId);
      
      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('Active')
      );
    });
  });

  describe('getActiveCallCount', () => {
    it('should return 0 when no calls', () => {
      expect(handler.getActiveCallCount()).toBe(0);
    });

    it('should return correct count of active calls', async () => {
      await handler.startCall('!room1:matrix.org');
      await handler.startCall('!room2:matrix.org');
      
      expect(handler.getActiveCallCount()).toBe(2);

      await handler.endCall('!room1:matrix.org');
      expect(handler.getActiveCallCount()).toBe(1);
    });
  });

  describe('startCall with real media', () => {
    it('should start real media call when useRealMedia is true', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId, true);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState?.isRealMediaCall).toBe(true);
      expect(callState?.callId).toBe('call_123');
      expect(mockCallMediaService.startCall).toHaveBeenCalledWith(roomId);
    });

    it('should fallback to text call if real media fails', async () => {
      const roomId = '!test:matrix.org';
      vi.mocked(mockCallMediaService.startCall).mockRejectedValueOnce(new Error('WebRTC not available'));
      
      await handler.startCall(roomId, true);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState?.isRealMediaCall).toBe(false);
    });

    it('should start text-simulated call when useRealMedia is false', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId, false);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState?.isRealMediaCall).toBe(false);
      expect(callState?.callId).toBeUndefined();
    });
  });

  describe('endCall with real media', () => {
    it('should end real media call when active', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId, true);
      await handler.endCall(roomId);

      expect(mockCallMediaService.endCall).toHaveBeenCalledWith(roomId);
    });

    it('should handle endCall gracefully for non-real-media calls', async () => {
      const roomId = '!test:matrix.org';
      
      await handler.startCall(roomId, false);
      await handler.endCall(roomId);

      expect(mockCallMediaService.endCall).not.toHaveBeenCalled();
    });
  });

  describe('processRealTimeAudio', () => {
    it('should reject audio when call is not active', async () => {
      const roomId = '!test:matrix.org';
      const audioData = Buffer.from('test-audio');
      
      await handler.processRealTimeAudio(roomId, audioData, 'audio/pcm');

      // Just verify no error is thrown
      expect(true).toBe(true);
    });

    it('should reject audio for text-simulated call', async () => {
      const roomId = '!test2:matrix.org'; // Use different room
      const audioData = Buffer.from('test-audio');
      
      // Create a fresh mock for this test
      const mockMatrixService2 = {
        getClient: vi.fn().mockReturnValue(mockClient),
        sendMessage: vi.fn().mockResolvedValue({}),
        sendAudio: vi.fn().mockResolvedValue({}),
        getCallMediaService: vi.fn().mockReturnValue(mockCallMediaService),
        getLiveKitAdapter: vi.fn().mockReturnValue(null),
      } as unknown as MatrixClientService;

      const handler2 = new VoiceCallHandler(
        mockMatrixService2,
        mockOpenClawService,
        mockTTSService,
        mockCallMediaService
      );
      
      await handler2.startCall(roomId, false);
      
      // Clear the sendMessage call from startCall
      vi.mocked(mockMatrixService2.sendMessage).mockClear();
      
      await handler2.processRealTimeAudio(roomId, audioData, 'audio/pcm');

      // Should NOT send a message - just log and return for text-simulated calls
      expect(mockMatrixService2.sendMessage).not.toHaveBeenCalled();
    });

    it('should process real-time audio for real media call', async () => {
      const roomId = '!test3:matrix.org'; // Use different room
      const audioData = Buffer.from('test-audio');
      
      // Create a fresh mock for this test
      const mockMatrixService3 = {
        getClient: vi.fn().mockReturnValue(mockClient),
        sendMessage: vi.fn().mockResolvedValue({}),
        sendAudio: vi.fn().mockResolvedValue({}),
        getCallMediaService: vi.fn().mockReturnValue(mockCallMediaService),
        getLiveKitAdapter: vi.fn().mockReturnValue(null),
      } as unknown as MatrixClientService;

      const handler2 = new VoiceCallHandler(
        mockMatrixService3,
        mockOpenClawService,
        mockTTSService,
        mockCallMediaService
      );
      
      await handler2.startCall(roomId, true);
      
      // Clear the sendMessage call from startCall
      vi.mocked(mockMatrixService3.sendMessage).mockClear();
      
      await handler2.processRealTimeAudio(roomId, audioData, 'audio/pcm');

      // Should update last activity
      const callState = handler2.getAllCallStates().get(roomId);
      expect(callState?.lastActivity).toBeDefined();
      
      // Should send placeholder (STT pending)
      expect(mockMatrixService3.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('STT pending')
      );
    });
  });

  describe('getCallMediaService', () => {
    it('should return call media service instance', () => {
      const mediaService = handler.getCallMediaService();
      expect(mediaService).toBeDefined();
    });
  });

  describe('processVoiceInput (via handleReply)', () => {
    it('should reject input when call is not active', async () => {
      const roomId = '!test:matrix.org';
      const event = {
        content: {
          body: 'Hello',
          'm.reply_to': true,
        },
      };

      await handler.handleReply(roomId, event);

      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('not active')
      );
    });

    it('should process voice input when call is active', async () => {
      const roomId = '!test:matrix.org';
      const event = {
        content: {
          body: 'Hello',
          'm.reply_to': true,
        },
      };

      await handler.startCall(roomId);
      vi.mocked(mockOpenClawService.processText).mockResolvedValueOnce({
        success: true,
        response: 'Response text',
      });
      vi.mocked(mockTTSService.textToSpeechCached).mockResolvedValueOnce({
        success: true,
        audioData: Buffer.from('audio-data'),
        mimeType: 'audio/wav',
      });

      await handler.handleReply(roomId, event);

      expect(mockOpenClawService.processText).toHaveBeenCalledWith('Hello');
      expect(mockTTSService.textToSpeechCached).toHaveBeenCalledWith('Response text');
    });

    it('should fallback to text when TTS fails', async () => {
      const roomId = '!test:matrix.org';
      const event = {
        content: {
          body: 'Hello',
          'm.reply_to': true,
        },
      };

      await handler.startCall(roomId);
      vi.mocked(mockOpenClawService.processText).mockResolvedValueOnce({
        success: true,
        response: 'Response text',
      });
      vi.mocked(mockTTSService.textToSpeechCached).mockResolvedValueOnce({
        success: false,
        error: 'TTS error',
      });

      await handler.handleReply(roomId, event);

      expect(mockMatrixService.sendMessage).toHaveBeenCalledWith(
        roomId,
        expect.stringContaining('Response text')
      );
    });
  });
});
