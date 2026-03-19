import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParticipantAudioMux, ParticipantFrame } from '../src/services/participant-audio-mux.js';

function makeFrame(identity: string = 'user-1'): ParticipantFrame {
  return {
    data: Buffer.alloc(640),
    sampleRate: 16000,
    channels: 1,
    format: 'pcm16',
    timestamp: Date.now(),
    durationMs: 20,
    participantIdentity: identity,
  };
}

describe('ParticipantAudioMux', () => {
  describe('mix mode', () => {
    let mux: ParticipantAudioMux;

    beforeEach(() => {
      mux = new ParticipantAudioMux('mix');
    });

    it('should forward all frames from all participants', () => {
      const listener = vi.fn();
      mux.on('frame', listener);

      mux.processFrame(makeFrame('user-1'));
      mux.processFrame(makeFrame('user-2'));
      mux.processFrame(makeFrame('user-1'));

      expect(listener).toHaveBeenCalledTimes(3);
    });

    it('should track participants', () => {
      mux.processFrame(makeFrame('user-1'));
      mux.processFrame(makeFrame('user-2'));

      expect(mux.getParticipants()).toEqual(['user-1', 'user-2']);
    });

    it('should emit participant.joined for new participants', () => {
      const listener = vi.fn();
      mux.on('participant.joined', listener);

      mux.processFrame(makeFrame('user-1'));
      mux.processFrame(makeFrame('user-1')); // duplicate - should not re-emit
      mux.processFrame(makeFrame('user-2'));

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith('user-1');
      expect(listener).toHaveBeenCalledWith('user-2');
    });
  });

  describe('separate mode', () => {
    let mux: ParticipantAudioMux;

    beforeEach(() => {
      mux = new ParticipantAudioMux('separate');
    });

    it('should forward frames only from the first speaker', () => {
      const listener = vi.fn();
      mux.on('frame', listener);

      mux.processFrame(makeFrame('user-1'));
      mux.processFrame(makeFrame('user-2')); // should be dropped
      mux.processFrame(makeFrame('user-1'));

      expect(listener).toHaveBeenCalledTimes(2);
      expect(mux.getActiveParticipant()).toBe('user-1');
    });

    it('should release lock on turnCompleted', () => {
      const listener = vi.fn();
      mux.on('frame', listener);

      mux.processFrame(makeFrame('user-1'));
      expect(mux.getActiveParticipant()).toBe('user-1');

      mux.turnCompleted();
      expect(mux.getActiveParticipant()).toBeNull();

      // Now user-2 can speak
      mux.processFrame(makeFrame('user-2'));
      expect(mux.getActiveParticipant()).toBe('user-2');
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should not have active participant initially', () => {
      expect(mux.getActiveParticipant()).toBeNull();
    });
  });

  describe('removeParticipant', () => {
    it('should remove participant and release lock if active', () => {
      const mux = new ParticipantAudioMux('separate');
      mux.processFrame(makeFrame('user-1'));
      expect(mux.getActiveParticipant()).toBe('user-1');

      mux.removeParticipant('user-1');
      expect(mux.getActiveParticipant()).toBeNull();
      expect(mux.getParticipants()).toEqual([]);
    });
  });

  describe('pruneStale', () => {
    it('should remove participants with no recent frames', async () => {
      const mux = new ParticipantAudioMux('mix');
      mux.processFrame(makeFrame('user-1'));

      // Wait a tiny bit then prune with a very short timeout
      await new Promise(r => setTimeout(r, 20));
      mux.pruneStale(10);

      expect(mux.getParticipants()).toEqual([]);
    });
  });
});
