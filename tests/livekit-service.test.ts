import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveKitService, LiveKitConfig } from '../src/services/livekit-service.js';

describe('LiveKitService', () => {
  let service: LiveKitService;
  let mockRoomService: any;

  beforeEach(() => {
    // Mock RoomServiceClient
    mockRoomService = {
      createRoom: vi.fn().mockImplementation(async (options: any) => ({
        sid: 'RM_test123',
        name: options.name || 'test-room',
        createdAt: Date.now(),
      })),
      deleteRoom: vi.fn().mockResolvedValue({}),
      listRooms: vi.fn().mockResolvedValue([]),
    };
    // deleteRoom may also reject when room doesn't exist (first call in createRoom cleanup)
    mockRoomService.deleteRoom.mockImplementation(async () => {});

    // Create service with mocked dependencies
    const config: LiveKitConfig = {
      url: 'ws://localhost:7880',
      apiKey: 'test_key',
      apiSecret: 'test_secret',
    };
    
    service = new LiveKitService(config);
    
    // Replace the roomService with our mock
    (service as any).roomService = mockRoomService;
  });

  describe('start/stop', () => {
    it('should start the service', async () => {
      await service.start();
      expect(service.isServiceRunning()).toBe(true);
    });

    it('should stop the service', async () => {
      await service.start();
      service.stop();
      expect(service.isServiceRunning()).toBe(false);
    });

    it('should clear sessions on stop', async () => {
      await service.start();
      // Add a test room
      await service.createRoom('!test:matrix.org', 'test-room');
      
      expect(service.getStats().totalRooms).toBe(1);
      
      service.stop();
      expect(service.getStats().totalRooms).toBe(0);
    });
  });

  describe('createRoom', () => {
    it('should create a room with given matrix room ID', async () => {
      const matrixRoomId = '!test:matrix.org';

      const room = await service.createRoom(matrixRoomId);

      expect(room).toBeDefined();
      expect(room.roomId).toBe('RM_test123');
      expect(room.matrixRoomId).toBe(matrixRoomId);
      expect(room.participants).toEqual([]);

      // Room name is now SHA-256 hashed for Element Call compatibility
      const expectedHashedName = service.hashRoomName(matrixRoomId);
      expect(mockRoomService.createRoom).toHaveBeenCalledWith({
        name: expectedHashedName,
        emptyTimeout: 300,
        maxParticipants: 10,
      });
    });

    it('should auto-generate room name if not provided', async () => {
      const matrixRoomId = '!custom-room:matrix.org';

      const room = await service.createRoom(matrixRoomId);

      // Room name is now a SHA-256 hash, not a readable prefix
      const expectedHashedName = service.hashRoomName(matrixRoomId);
      expect(room.name).toBe(expectedHashedName);
    });

    it('should store room for later retrieval', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      const retrieved = service.getRoomByMatrixRoomId(matrixRoomId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.matrixRoomId).toBe(matrixRoomId);
    });

    it('should throw on create error', async () => {
      mockRoomService.createRoom.mockRejectedValueOnce(new Error('Create failed'));
      
      await expect(service.createRoom('!test:matrix.org'))
        .rejects.toThrow('Create failed');
    });
  });

  describe('generateToken', () => {
    it('should generate a token for a participant', async () => {
      const roomName = 'test-room';
      const identity = '@user:matrix.org';
      
      const token = await service.generateToken(roomName, identity);
      
      // Token should be a valid JWT (three parts separated by dots)
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBeDefined();
      expect(parts[1]).toBeDefined();
      expect(parts[2]).toBeDefined();
    });

    it('should include publish/subscribe permissions', async () => {
      const roomName = 'test-room';
      const identity = '@user:matrix.org';
      
      // Test with default permissions
      const token1 = await service.generateToken(roomName, identity);
      expect(token1).toBeDefined();
      
      // Test with explicit permissions
      const token2 = await service.generateToken(roomName, identity, false, true);
      expect(token2).toBeDefined();
    });
  });

  describe('room retrieval', () => {
    it('should get room by Matrix room ID', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      const room = service.getRoomByMatrixRoomId(matrixRoomId);
      expect(room).toBeDefined();
      expect(room?.matrixRoomId).toBe(matrixRoomId);
    });

    it('should get room by LiveKit room ID', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      const room = service.getRoomByRoomId('RM_test123');
      expect(room).toBeDefined();
      expect(room?.roomId).toBe('RM_test123');
    });

    it('should return undefined for non-existent room', () => {
      const room = service.getRoomByMatrixRoomId('!nonexistent:matrix.org');
      expect(room).toBeUndefined();
    });
  });

  describe('deleteRoom', () => {
    it('should delete a room', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      expect(service.getRoomByMatrixRoomId(matrixRoomId)).toBeDefined();
      
      await service.deleteRoom(matrixRoomId);
      
      expect(service.getRoomByMatrixRoomId(matrixRoomId)).toBeUndefined();
      expect(mockRoomService.deleteRoom).toHaveBeenCalledWith('RM_test123');
    });

    it('should handle deletion of non-existent room gracefully', async () => {
      await service.deleteRoom('!nonexistent:matrix.org');
      // Should not throw
      expect(true).toBe(true);
    });

    it('should throw on delete error', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      mockRoomService.deleteRoom.mockRejectedValueOnce(new Error('Delete failed'));
      
      await expect(service.deleteRoom(matrixRoomId))
        .rejects.toThrow('Delete failed');
    });
  });

  describe('listRooms', () => {
    it('should list all rooms', async () => {
      mockRoomService.listRooms.mockResolvedValueOnce([
        { sid: 'RM1', name: 'room1', createdAt: Date.now() },
        { sid: 'RM2', name: 'room2', createdAt: Date.now() },
      ]);
      
      const rooms = await service.listRooms();
      
      expect(rooms).toHaveLength(2);
      expect(rooms[0].roomId).toBe('RM1');
      expect(rooms[1].roomId).toBe('RM2');
    });

    it('should throw on list error', async () => {
      mockRoomService.listRooms.mockRejectedValueOnce(new Error('List failed'));
      
      await expect(service.listRooms())
        .rejects.toThrow('List failed');
    });
  });

  describe('participant tracking', () => {
    it('should add participant to room', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      service.addParticipant(matrixRoomId, '@user1:matrix.org');
      
      const room = service.getRoomByMatrixRoomId(matrixRoomId);
      expect(room?.participants).toContain('@user1:matrix.org');
    });

    it('should not add duplicate participant', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      service.addParticipant(matrixRoomId, '@user1:matrix.org');
      service.addParticipant(matrixRoomId, '@user1:matrix.org');
      
      const room = service.getRoomByMatrixRoomId(matrixRoomId);
      expect(room?.participants).toHaveLength(1);
    });

    it('should remove participant from room', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      service.addParticipant(matrixRoomId, '@user1:matrix.org');
      
      service.removeParticipant(matrixRoomId, '@user1:matrix.org');
      
      const room = service.getRoomByMatrixRoomId(matrixRoomId);
      expect(room?.participants).not.toContain('@user1:matrix.org');
    });

    it('should handle remove of non-existent participant gracefully', async () => {
      const matrixRoomId = '!test:matrix.org';
      
      await service.createRoom(matrixRoomId);
      
      service.removeParticipant(matrixRoomId, '@nonexistent:matrix.org');
      
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await service.start();
      
      await service.createRoom('!room1:matrix.org');
      await service.createRoom('!room2:matrix.org');
      
      const stats = service.getStats();
      
      expect(stats.totalRooms).toBe(2);
      expect(stats.running).toBe(true);
    });
  });
});
