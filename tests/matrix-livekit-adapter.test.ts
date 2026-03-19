import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatrixLiveKitAdapter, MatrixLiveKitAdapterConfig } from '../src/services/matrix-livekit-adapter.js';
import { LiveKitService } from '../src/services/livekit-service.js';

describe('MatrixLiveKitAdapter', () => {
  let adapter: MatrixLiveKitAdapter;
  let mockClient: any;
  let mockLiveKitService: any;

  beforeEach(() => {
    mockClient = {
      sendEvent: vi.fn().mockResolvedValue({}),
      getUserId: vi.fn().mockReturnValue('@bot:matrix.org'),
      on: vi.fn(),
    };

    mockLiveKitService = {
      isServiceRunning: vi.fn().mockReturnValue(true),
      createRoom: vi.fn().mockResolvedValue({
        roomId: 'RM_test123',
        name: 'test-room',
        matrixRoomId: '!test:matrix.org',
        createdAt: new Date(),
        participants: [],
      }),
      deleteRoom: vi.fn().mockResolvedValue({}),
      generateToken: vi.fn().mockResolvedValue('test_token_123'),
    };

    const config: MatrixLiveKitAdapterConfig = {
      liveKitEnabled: true,
      liveKitService: mockLiveKitService as unknown as LiveKitService,
      fallbackToText: true,
    };

    adapter = new MatrixLiveKitAdapter(mockClient, config);
  });

  describe('initialize', () => {
    it('should initialize the adapter', async () => {
      await adapter.initialize();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should verify LiveKit connectivity', async () => {
      mockLiveKitService.listRooms = vi.fn().mockResolvedValue([]);
      
      await adapter.initialize();
      
      expect(mockLiveKitService.listRooms).toHaveBeenCalled();
    });

    it('should handle LiveKit connection failure with fallback enabled', async () => {
      mockLiveKitService.listRooms = vi.fn().mockRejectedValue(new Error('Connection failed'));
      
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: true,
        liveKitService: mockLiveKitService as unknown as LiveKitService,
        fallbackToText: true,
      };
      
      const adapterWithFallback = new MatrixLiveKitAdapter(mockClient, config);
      
      // Should not throw when fallback is enabled
      await expect(adapterWithFallback.initialize()).resolves.not.toThrow();
    });

    it('should throw on LiveKit connection failure with fallback disabled', async () => {
      mockLiveKitService.listRooms = vi.fn().mockRejectedValue(new Error('Connection failed'));
      
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: true,
        liveKitService: mockLiveKitService as unknown as LiveKitService,
        fallbackToText: false,
      };
      
      const adapterNoFallback = new MatrixLiveKitAdapter(mockClient, config);
      
      await expect(adapterNoFallback.initialize()).rejects.toThrow('LiveKit not available');
    });

    it('should work with LiveKit disabled', async () => {
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: false,
        liveKitService: null,
        fallbackToText: true,
      };
      
      const adapterDisabled = new MatrixLiveKitAdapter(mockClient, config);
      
      await expect(adapterDisabled.initialize()).resolves.not.toThrow();
    });
  });

  describe('startCall', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should start a call via LiveKit', async () => {
      const matrixRoomId = '!test:matrix.org';
      const userId = '@user:matrix.org';
      
      const result = await adapter.startCall(matrixRoomId, userId);
      
      expect(result.success).toBe(true);
      expect(result.useLiveKit).toBe(true);
      
      expect(mockLiveKitService.createRoom).toHaveBeenCalledWith(matrixRoomId);
      expect(mockLiveKitService.generateToken).toHaveBeenCalled();
    });

    it('should emit call.started event', async () => {
      const matrixRoomId = '!test:matrix.org';
      const userId = '@user:matrix.org';
      
      const listener = vi.fn();
      adapter.on('call.started', listener);
      
      await adapter.startCall(matrixRoomId, userId);
      
      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.matrixRoomId).toBe(matrixRoomId);
      expect(event.token).toBe('test_token_123');
    });

    it('should fall back when LiveKit fails and fallback is enabled', async () => {
      mockLiveKitService.createRoom = vi.fn().mockRejectedValue(new Error('Create failed'));
      
      const matrixRoomId = '!test:matrix.org';
      const userId = '@user:matrix.org';
      
      const result = await adapter.startCall(matrixRoomId, userId);
      
      expect(result.success).toBe(false);
      expect(result.useLiveKit).toBe(false);
      expect(result.error).toBe('Create failed');
    });

    it('should not fall back when LiveKit fails and fallback is disabled', async () => {
      // Set up listRooms to succeed so initialize doesn't throw
      mockLiveKitService.listRooms = vi.fn().mockResolvedValue([]);
      
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: true,
        liveKitService: mockLiveKitService as unknown as LiveKitService,
        fallbackToText: false,
      };
      
      const adapterNoFallback = new MatrixLiveKitAdapter(mockClient, config);
      await adapterNoFallback.initialize();
      
      // Now make createRoom fail
      mockLiveKitService.createRoom = vi.fn().mockRejectedValue(new Error('Create failed'));
      
      const matrixRoomId = '!test:matrix.org';
      const userId = '@user:matrix.org';
      
      const result = await adapterNoFallback.startCall(matrixRoomId, userId);
      
      expect(result.success).toBe(false);
      expect(result.useLiveKit).toBe(false);
    });

    it('should return fallback result when LiveKit is disabled', async () => {
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: false,
        liveKitService: null,
        fallbackToText: true,
      };
      
      const adapterDisabled = new MatrixLiveKitAdapter(mockClient, config);
      
      const matrixRoomId = '!test:matrix.org';
      const userId = '@user:matrix.org';
      
      const result = await adapterDisabled.startCall(matrixRoomId, userId);
      
      expect(result.success).toBe(false);
      expect(result.useLiveKit).toBe(false);
    });
  });

  describe('endCall', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should end a call and delete LiveKit room', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      // First start a call
      await adapter.startCall(matrixRoomId, '@user:matrix.org');
      
      const listener = vi.fn();
      adapter.on('call.ended', listener);
      
      await adapter.endCall(matrixRoomId);
      
      expect(mockLiveKitService.deleteRoom).toHaveBeenCalledWith(matrixRoomId);
      expect(listener).toHaveBeenCalled();
    });

    it('should handle ending non-existent call gracefully', async () => {
      const matrixRoomId = '!nonexistent:matrix.org';
      
      // Should not throw
      await expect(adapter.endCall(matrixRoomId)).resolves.not.toThrow();
    });

    it('should emit call.ended event', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await adapter.startCall(matrixRoomId, '@user:matrix.org');
      
      const listener = vi.fn();
      adapter.on('call.ended', listener);
      
      await adapter.endCall(matrixRoomId);
      
      expect(listener).toHaveBeenCalledWith({ matrixRoomId });
    });
  });

  describe('handleInboundAudio', () => {
    it('should handle inbound audio and emit event', () => {
      const matrixRoomId = '!test:matrix.org';
      const stream = {
        roomId: matrixRoomId,
        streamId: 'audio-123',
        type: 'audio' as const,
        direction: 'inbound' as const,
        data: Buffer.from('test-audio'),
      };

      const listener = vi.fn();
      adapter.on('media.inbound', listener);

      adapter.handleInboundAudio(matrixRoomId, stream);

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.matrixRoomId).toBe(matrixRoomId);
      expect(event.stream).toBe(stream);
    });
  });

  describe('handleOutboundAudio', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should handle outbound audio and emit event', async () => {
      const matrixRoomId = '!test:matrix.org';
      const audioData = Buffer.from('test-audio-data');
      
      // First start a call
      await adapter.startCall(matrixRoomId, '@user:matrix.org');
      
      const listener = vi.fn();
      adapter.on('media.outbound', listener);
      
      await adapter.handleOutboundAudio(matrixRoomId, audioData, 'audio/pcm');
      
      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.matrixRoomId).toBe(matrixRoomId);
      expect(event.stream.data).toEqual(audioData);
      expect(event.mimeType).toBe('audio/pcm');
    });

    it('should warn when no active connection for outbound audio', async () => {
      const matrixRoomId = '!nonexistent:matrix.org';
      const audioData = Buffer.from('test-audio');
      
      // Should not throw
      await expect(adapter.handleOutboundAudio(matrixRoomId, audioData, 'audio/pcm'))
        .resolves.not.toThrow();
    });
  });

  describe('getConnection', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should get connection info for active call', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await adapter.startCall(matrixRoomId, '@user:matrix.org');
      
      const connection = adapter.getConnection(matrixRoomId);
      
      expect(connection).toBeDefined();
      expect(connection?.matrixRoomId).toBe(matrixRoomId);
      expect(connection?.liveKitRoom?.roomId).toBe('RM_test123');
      expect(connection?.duration).toBeGreaterThanOrEqual(0);
    });

    it('should return undefined for non-existent connection', () => {
      const connection = adapter.getConnection('!nonexistent:matrix.org');
      expect(connection).toBeUndefined();
    });
  });

  describe('isLiveKitAvailable', () => {
    it('should return true when LiveKit is enabled and running', () => {
      expect(adapter.isLiveKitAvailable()).toBe(true);
    });

    it('should return false when LiveKit is disabled', () => {
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: false,
        liveKitService: null,
        fallbackToText: true,
      };
      
      const adapterDisabled = new MatrixLiveKitAdapter(mockClient, config);
      
      expect(adapterDisabled.isLiveKitAvailable()).toBe(false);
    });

    it('should return false when LiveKit service is not running', () => {
      mockLiveKitService.isServiceRunning = vi.fn().mockReturnValue(false);
      
      const config: MatrixLiveKitAdapterConfig = {
        liveKitEnabled: true,
        liveKitService: mockLiveKitService as unknown as LiveKitService,
        fallbackToText: true,
      };
      
      const adapterStopped = new MatrixLiveKitAdapter(mockClient, config);
      
      expect(adapterStopped.isLiveKitAvailable()).toBe(false);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      await adapter.initialize();
    });

    it('should return correct statistics', async () => {
      await adapter.startCall('!room1:matrix.org', '@user1:matrix.org');
      await adapter.startCall('!room2:matrix.org', '@user2:matrix.org');
      
      const stats = adapter.getStats();
      
      expect(stats.activeConnections).toBe(2);
      expect(stats.liveKitEnabled).toBe(true);
      expect(stats.liveKitConnected).toBe(true);
    });
  });
});
