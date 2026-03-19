import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatrixCallMediaService, CallSession } from '../src/services/matrix-call-media-service.js';

describe('MatrixCallMediaService', () => {
  let service: MatrixCallMediaService;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      sendEvent: vi.fn().mockResolvedValue({}),
      uploadContent: vi.fn().mockResolvedValue('mxc://test.example/file'),
      getUserId: vi.fn().mockReturnValue('@bot:matrix.org'),
      on: vi.fn(),
    };

    service = new MatrixCallMediaService(mockClient);
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
      // Simulate a session
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });
      
      expect(service.getAllCallSessions().size).toBe(1);
      
      service.stop();
      expect(service.getAllCallSessions().size).toBe(0);
    });
  });

  describe('call session management', () => {
    it('should get call session by room ID', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      
      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });

      const session = service.getCallSessionByRoom(roomId);
      expect(session).toBeDefined();
      expect(session?.callId).toBe(callId);
    });

    it('should return undefined for non-existent session', () => {
      const session = service.getCallSessionByRoom('!nonexistent:matrix.org');
      expect(session).toBeUndefined();
    });

    it('should get all call sessions', async () => {
      await (service as any).handleCallInvite('!room1:matrix.org', {
        content: { call_id: 'call1' },
        sender: '@user1:matrix.org',
      });
      
      await (service as any).handleCallInvite('!room2:matrix.org', {
        content: { call_id: 'call2' },
        sender: '@user2:matrix.org',
      });

      const sessions = service.getAllCallSessions();
      expect(sessions.size).toBe(2);
    });
  });

  describe('handleCallInvite', () => {
    it('should handle call invite and create session', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      const sender = '@user:matrix.org';

      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender,
      });

      const session = service.getCallSessionByRoom(roomId);
      expect(session).toBeDefined();
      expect(session?.callId).toBe(callId);
      expect(session?.state).toBe('connecting');
      expect(session?.peerUserId).toBe(sender);
      
      // Should have sent answer
      expect(mockClient.sendEvent).toHaveBeenCalledWith(
        roomId,
        'm.call.answer',
        expect.objectContaining({ call_id: callId })
      );
    });

    it('should emit call.invited event', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      const listener = vi.fn();
      
      service.on('call.invited', listener);

      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.session.callId).toBe(callId);
    });

    it('should skip invite without call_id', async () => {
      const roomId = '!test:matrix.org';
      await (service as any).handleCallInvite(roomId, {
        content: {},
        sender: '@user:matrix.org',
      });

      expect(service.getCallSessionByRoom(roomId)).toBeUndefined();
    });
  });

  describe('handleCallMedia', () => {
    it('should handle inbound audio media', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      
      // First create a session
      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });

      const listener = vi.fn();
      service.on('media.inbound', listener);

      await (service as any).handleCallMedia(roomId, {
        content: {
          call_id: callId,
          media_type: 'audio',
          sample_rate: 16000,
          channels: 1,
          duration: 1000,
        },
      });

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.mediaEvent.type).toBe('audio');
      expect(event.mediaEvent.direction).toBe('inbound');
    });

    it('should handle video media', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      
      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });

      await (service as any).handleCallMedia(roomId, {
        content: {
          call_id: callId,
          media_type: 'video',
        },
      });

      const sessions = service.getAllCallSessions();
      expect(sessions.size).toBe(1);
    });

    it('should skip media for unknown call', async () => {
      const roomId = '!test:matrix.org';
      await (service as any).handleCallMedia(roomId, {
        content: { call_id: 'unknown_call' },
      });

      expect(service.getCallSessionByRoom(roomId)).toBeUndefined();
    });
  });

  describe('handleCallHangup', () => {
    it('should handle call hangup', async () => {
      const roomId = '!test:matrix.org';
      const callId = 'test_call';
      
      await (service as any).handleCallInvite(roomId, {
        content: { call_id: callId },
        sender: '@user:matrix.org',
      });

      const listener = vi.fn();
      service.on('call.ended', listener);

      await (service as any).handleCallHangup(roomId, {
        content: { call_id: callId, reason: 'User ended' },
      });

      const session = service.getCallSessionByRoom(roomId);
      expect(session?.state).toBe('ended');
      expect(session?.endedAt).toBeDefined();
      expect(listener).toHaveBeenCalled();
    });

    it('should handle hangup for non-existent call gracefully', async () => {
      const roomId = '!test:matrix.org';
      await (service as any).handleCallHangup(roomId, {
        content: { call_id: 'unknown' },
      });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('startCall (outbound)', () => {
    it('should start outbound call', async () => {
      const roomId = '!test:matrix.org';
      
      const callId = await service.startCall(roomId);

      expect(callId).toBeDefined();
      expect(callId).toContain('call_');
      
      const session = service.getCallSessionByRoom(roomId);
      expect(session).toBeDefined();
      expect(session?.callId).toBe(callId);
      expect(session?.state).toBe('connecting');
      
      expect(mockClient.sendEvent).toHaveBeenCalledWith(
        roomId,
        'm.call.invite',
        expect.objectContaining({ call_id: callId })
      );
    });

    it('should emit call.initiated event', async () => {
      const roomId = '!test:matrix.org';
      const listener = vi.fn();
      
      service.on('call.initiated', listener);

      await service.startCall(roomId);

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('endCall', () => {
    it('should end active call', async () => {
      const roomId = '!test:matrix.org';
      await service.startCall(roomId);

      const listener = vi.fn();
      service.on('call.hangup', listener);

      await service.endCall(roomId, 'User ended');

      const session = service.getCallSessionByRoom(roomId);
      expect(session?.state).toBe('disconnected');
      expect(session?.endedAt).toBeDefined();
      
      expect(mockClient.sendEvent).toHaveBeenCalledWith(
        roomId,
        'm.call.hangup',
        expect.objectContaining({
          call_id: session?.callId,
          reason: 'User ended',
        })
      );
    });

    it('should handle ending non-existent call gracefully', async () => {
      const roomId = '!nonexistent:matrix.org';
      await service.endCall(roomId);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('sendAudio', () => {
    it('should handle outbound audio', async () => {
      const roomId = '!test:matrix.org';
      await service.startCall(roomId);

      const listener = vi.fn();
      service.on('media.outbound', listener);

      const audioData = Buffer.from('test-audio-data');
      await service.sendAudio(roomId, audioData, 'audio/pcm');

      expect(listener).toHaveBeenCalled();
      const event = listener.mock.calls[0][0];
      expect(event.audioData).toEqual(audioData);
      expect(event.mediaEvent.direction).toBe('outbound');
    });

    it('should skip audio for non-existent call', async () => {
      const roomId = '!nonexistent:matrix.org';
      const audioData = Buffer.from('test-audio');
      
      await service.sendAudio(roomId, audioData, 'audio/pcm');
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('uploadAudio', () => {
    it('should upload audio to media repository', async () => {
      const roomId = '!test:matrix.org';
      const audioData = Buffer.from('test-audio-data');
      
      await service.uploadAudio(roomId, audioData, 'audio/wav');

      expect(mockClient.uploadContent).toHaveBeenCalledWith(audioData, 'audio/wav');
      expect(mockClient.sendEvent).toHaveBeenCalledWith(
        roomId,
        'm.room.message',
        expect.objectContaining({
          msgtype: 'm.audio',
          body: 'Voice message',
        })
      );
    });

    it('should throw on upload error', async () => {
      const roomId = '!test:matrix.org';
      const audioData = Buffer.from('test-audio');
      
      mockClient.uploadContent.mockRejectedValueOnce(new Error('Upload failed'));
      
      await expect(service.uploadAudio(roomId, audioData, 'audio/wav'))
        .rejects.toThrow('Upload failed');
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await service.start();
      
      // Create some sessions
      await service.startCall('!room1:matrix.org');
      await service.startCall('!room2:matrix.org');
      
      // Manually set one to connected (both start as 'connecting')
      const sessions = service.getAllCallSessions();
      const session1 = sessions.get('!room1:matrix.org');
      if (session1) {
        session1.state = 'connected';
        service['callSessions'].set('!room1:matrix.org', session1);
      }

      const stats = service.getStats();
      expect(stats.totalCalls).toBe(2);
      // Both are either 'connecting' or 'connected', so both count as active
      expect(stats.activeCalls).toBe(2);
      expect(stats.running).toBe(true);
    });
  });
});
