import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceCallHandler, CallState } from '../src/handlers/voice-call-handler.js';
import { OpenClawService } from '../src/services/openclaw-service.js';
import { ChatterboxTTSService } from '../src/services/chatterbox-tts-service.js';
import { MatrixClientService } from '../src/services/matrix-client-service.js';

describe('VoiceCallHandler', () => {
  let handler: VoiceCallHandler;
  let mockMatrixService: MatrixClientService;
  let mockClient: any;
  let mockOpenClawService: OpenClawService;
  let mockTTSService: ChatterboxTTSService;

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

    mockMatrixService = {
      getClient: vi.fn().mockReturnValue(mockClient),
      sendMessage: vi.fn().mockResolvedValue({}),
      sendAudio: vi.fn().mockResolvedValue({}),
      getLiveKitService: vi.fn().mockReturnValue(null),
    } as unknown as MatrixClientService;

    handler = new VoiceCallHandler(
      mockMatrixService,
      mockOpenClawService,
      mockTTSService
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

    it('should start text-simulated call when useLiveKit is false', async () => {
      const roomId = '!test:matrix.org';

      await handler.startCall(roomId, false);

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState?.isLiveKitCall).toBe(false);
    });

    it('should not start LiveKit call when LiveKit service is unavailable', async () => {
      const roomId = '!test:matrix.org';

      await handler.startCall(roomId, true);

      const callState = handler.getAllCallStates().get(roomId);
      // Falls back to non-LiveKit since service returns null
      expect(callState?.isLiveKitCall).toBe(false);
    });
  });

  describe('endCall', () => {
    it('should end an active call', async () => {
      const roomId = '!test:matrix.org';

      await handler.startCall(roomId);
      await handler.endCall(roomId);

      // endCall removes the call from the map
      const callState = handler.getAllCallStates().get(roomId);
      expect(callState).toBeUndefined();
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

  describe('handleEvent', () => {
    it('should start call on /call start command', async () => {
      const roomId = '!test:matrix.org';
      await handler.handleEvent(roomId, {
        type: 'm.room.message',
        content: { body: '/call start' },
      });

      expect(handler.getActiveCallCount()).toBe(1);
    });

    it('should end call on /call end command', async () => {
      const roomId = '!test:matrix.org';
      await handler.startCall(roomId);
      await handler.handleEvent(roomId, {
        type: 'm.room.message',
        content: { body: '/call end' },
      });

      const callState = handler.getAllCallStates().get(roomId);
      expect(callState).toBeUndefined();
    });

    it('should handle MatrixRTC m.call.member events', async () => {
      const roomId = '!test:matrix.org';

      // No LiveKit service - should log warning but not crash
      await handler.handleEvent(roomId, {
        type: 'm.call.member',
        content: {
          memberships: [{
            foci_active: [{
              type: 'livekit',
              livekit_service_url: 'wss://livekit.example.com',
              livekit_alias: 'room-123',
            }],
          }],
        },
      });

      // Should not crash, just log warning since no LiveKit service
      expect(handler.getActiveCallCount()).toBe(0);
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
