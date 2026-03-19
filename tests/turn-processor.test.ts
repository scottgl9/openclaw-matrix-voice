import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TurnProcessorService, TurnProcessingState } from '../src/services/turn-processor.js';
import { TurnCompletionEvent, AudioFrame } from '../src/services/audio-pipeline.js';
import { OpenClawService } from '../src/services/openclaw-service.js';
import { ChatterboxTTSService } from '../src/services/chatterbox-tts-service.js';
import { STTService, MockSTTAdapter } from '../src/services/stt-adapter.js';

describe('TurnProcessorService', () => {
  let processor: TurnProcessorService;
  let mockOpenClaw: OpenClawService;
  let mockTTS: ChatterboxTTSService;
  let sttService: STTService;

  function makeFrame(): AudioFrame {
    return {
      data: Buffer.alloc(640),
      sampleRate: 16000,
      channels: 1,
      format: 'pcm16',
      timestamp: Date.now(),
      durationMs: 20,
    };
  }

  function makeTurnEvent(turnId: string = 'turn-1', numFrames: number = 5): TurnCompletionEvent {
    return {
      turnId,
      frames: Array.from({ length: numFrames }, makeFrame),
      durationMs: numFrames * 20,
      timestamp: Date.now(),
    };
  }

  beforeEach(async () => {
    mockOpenClaw = {
      processText: vi.fn().mockResolvedValue({
        success: true,
        response: 'AI response',
      }),
    } as unknown as OpenClawService;

    mockTTS = {
      textToSpeechCached: vi.fn().mockResolvedValue({
        success: true,
        audioData: Buffer.from('tts-audio'),
        mimeType: 'audio/wav',
      }),
    } as unknown as ChatterboxTTSService;

    const adapter = new MockSTTAdapter(['Hello from STT']);
    sttService = new STTService(adapter);

    processor = new TurnProcessorService(mockOpenClaw, mockTTS, sttService);
    await processor.initialize();
  });

  describe('initialization', () => {
    it('should start in IDLE state', () => {
      expect(processor.getState()).toBe(TurnProcessingState.IDLE);
    });

    it('should not be processing initially', () => {
      expect(processor.isProcessing()).toBe(false);
    });
  });

  describe('handleTurnCompletion', () => {
    it('should process a complete turn: STT -> OpenClaw -> TTS', async () => {
      const ttsAudioListener = vi.fn();
      processor.on('tts.audio', ttsAudioListener);

      await processor.handleTurnCompletion(makeTurnEvent());

      // STT was called (via MockSTTAdapter)
      expect(mockOpenClaw.processText).toHaveBeenCalledWith('Hello from STT');
      expect(mockTTS.textToSpeechCached).toHaveBeenCalledWith('AI response');

      // TTS audio event should have been emitted
      expect(ttsAudioListener).toHaveBeenCalledWith(
        expect.objectContaining({
          turnId: 'turn-1',
          audioData: expect.any(Buffer),
          mimeType: 'audio/wav',
        })
      );

      // Should return to IDLE
      expect(processor.getState()).toBe(TurnProcessingState.IDLE);
    });

    it('should emit state.change events during processing', async () => {
      const stateChanges: string[] = [];
      processor.on('state.change', (event: any) => {
        stateChanges.push(event.state);
      });

      await processor.handleTurnCompletion(makeTurnEvent());

      expect(stateChanges).toContain(TurnProcessingState.TRANSCRIBING);
      expect(stateChanges).toContain(TurnProcessingState.PROCESSING);
      expect(stateChanges).toContain(TurnProcessingState.RESPONDING);
    });

    it('should emit error when OpenClaw fails', async () => {
      vi.mocked(mockOpenClaw.processText).mockResolvedValueOnce({
        success: false,
        error: 'API down',
      });

      const errorListener = vi.fn();
      processor.on('error', errorListener);

      await processor.handleTurnCompletion(makeTurnEvent());

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          state: TurnProcessingState.ERROR,
        })
      );

      // Should return to IDLE after error
      expect(processor.getState()).toBe(TurnProcessingState.IDLE);
    });

    it('should emit error when TTS fails', async () => {
      vi.mocked(mockTTS.textToSpeechCached).mockResolvedValueOnce({
        success: false,
        error: 'TTS error',
      });

      const errorListener = vi.fn();
      processor.on('error', errorListener);

      await processor.handleTurnCompletion(makeTurnEvent());

      expect(errorListener).toHaveBeenCalled();
    });

    it('should ignore concurrent turn completions', async () => {
      // Make OpenClaw slow
      vi.mocked(mockOpenClaw.processText).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ success: true, response: 'ok' }), 100))
      );

      const promise1 = processor.handleTurnCompletion(makeTurnEvent('turn-1'));

      // This should be ignored since turn-1 is still processing
      await processor.handleTurnCompletion(makeTurnEvent('turn-2'));

      await promise1;

      // Only the first turn should have been processed
      expect(mockOpenClaw.processText).toHaveBeenCalledTimes(1);
    });
  });

  describe('shutdown', () => {
    it('should return to IDLE on shutdown', async () => {
      await processor.shutdown();
      expect(processor.getState()).toBe(TurnProcessingState.IDLE);
      expect(processor.getCurrentTurnId()).toBeNull();
    });
  });

  describe('without STT service', () => {
    it('should emit error when no STT service is available', async () => {
      const noSTTProcessor = new TurnProcessorService(mockOpenClaw, mockTTS);
      await noSTTProcessor.initialize();

      const errorListener = vi.fn();
      noSTTProcessor.on('error', errorListener);

      await noSTTProcessor.handleTurnCompletion(makeTurnEvent());

      expect(errorListener).toHaveBeenCalled();
    });
  });
});
