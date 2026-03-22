import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VadService, defaultVadConfig, VadState, VadEventType } from '../src/services/vad-service.js';
import { AudioFrame } from '../src/services/audio-pipeline.js';

function createTestFrame(size: number): AudioFrame {
  return {
    data: Buffer.alloc(size),
    sampleRate: 16000,
    channels: 1,
    format: 'pcm16',
    timestamp: Date.now(),
    durationMs: (size / (16000 * 2)) * 1000,
  };
}

function createSpeechFrame(size: number = 160): AudioFrame {
  const frame = createTestFrame(size);
  for (let i = 0; i < size; i += 2) {
    frame.data.writeInt16LE(15000, i);
  }
  return frame;
}

function createSilentFrame(size: number = 160): AudioFrame {
  const frame = createTestFrame(size);
  frame.data.fill(0);
  return frame;
}

describe('VadService — suppress/unsuppress (echo cancellation)', () => {
  let vad: VadService;

  beforeEach(() => {
    vad = new VadService({ debug: false });
    vad.start();
  });

  afterEach(() => {
    if (vad.isActive()) vad.stop();
  });

  it('should not be suppressed by default', () => {
    expect(vad.isSuppressed()).toBe(false);
  });

  it('should suppress and unsuppress', () => {
    vad.suppress();
    expect(vad.isSuppressed()).toBe(true);

    vad.unsuppress();
    expect(vad.isSuppressed()).toBe(false);
  });

  it('should not process frames while suppressed', () => {
    const vadFrameListener = vi.fn();
    vad.on('vad.frame', vadFrameListener);

    vad.suppress();

    // Process speech frames — should be ignored
    for (let i = 0; i < 20; i++) {
      vad.processFrame(createSpeechFrame());
    }

    expect(vadFrameListener).not.toHaveBeenCalled();
    expect(vad.getState()).toBe(VadState.IDLE);
  });

  it('should not detect speech while suppressed', () => {
    const speechStartListener = vi.fn();
    vad.on(VadEventType.SPEECH_START, speechStartListener);

    vad.suppress();

    for (let i = 0; i < 20; i++) {
      vad.processFrame(createSpeechFrame());
    }

    expect(speechStartListener).not.toHaveBeenCalled();
  });

  it('should resume processing after unsuppress', () => {
    const speechStartListener = vi.fn();
    vad.on(VadEventType.SPEECH_START, speechStartListener);

    vad.suppress();
    for (let i = 0; i < 20; i++) {
      vad.processFrame(createSpeechFrame());
    }
    expect(speechStartListener).not.toHaveBeenCalled();

    vad.unsuppress();
    for (let i = 0; i < 20; i++) {
      vad.processFrame(createSpeechFrame());
    }
    expect(speechStartListener).toHaveBeenCalled();
  });

  it('should not increment frame counter while suppressed', () => {
    for (let i = 0; i < 5; i++) {
      vad.processFrame(createSpeechFrame());
    }
    const countBefore = vad.getStats().frameCounter;

    vad.suppress();
    for (let i = 0; i < 10; i++) {
      vad.processFrame(createSpeechFrame());
    }
    const countDuring = vad.getStats().frameCounter;

    expect(countDuring).toBe(countBefore);
  });
});

describe('VadService — debounce', () => {
  let vad: VadService;

  function triggerTurn(vadInstance: VadService): void {
    // Speech (15 frames = 300ms)
    for (let i = 0; i < 15; i++) {
      vadInstance.processFrame(createSpeechFrame());
    }
    // Silence (10 frames = 200ms, enough with 100ms threshold)
    for (let i = 0; i < 10; i++) {
      vadInstance.processFrame(createSilentFrame());
    }
  }

  it('should debounce rapid turn.end events', () => {
    vad = new VadService({
      ...defaultVadConfig,
      silenceThresholdMs: 100,
      minSpeechDurationMs: 50,
      debounceIntervalMs: 5000, // 5 seconds — second turn will be within debounce
      minUtteranceDurationMs: 0,
      debug: false,
    });
    vad.start();

    const turnEndListener = vi.fn();
    vad.on(VadEventType.TURN_END, turnEndListener);

    // First turn — should fire
    triggerTurn(vad);
    expect(turnEndListener).toHaveBeenCalledTimes(1);

    // Second turn immediately — should be debounced
    triggerTurn(vad);
    expect(turnEndListener).toHaveBeenCalledTimes(1); // Still 1
  });

  it('should allow turn.end after debounce interval passes', async () => {
    vad = new VadService({
      ...defaultVadConfig,
      silenceThresholdMs: 100,
      minSpeechDurationMs: 50,
      debounceIntervalMs: 50, // Very short for testing
      minUtteranceDurationMs: 0,
      debug: false,
    });
    vad.start();

    const turnEndListener = vi.fn();
    vad.on(VadEventType.TURN_END, turnEndListener);

    triggerTurn(vad);
    expect(turnEndListener).toHaveBeenCalledTimes(1);

    // Wait for debounce to expire
    await new Promise(resolve => setTimeout(resolve, 60));

    triggerTurn(vad);
    expect(turnEndListener).toHaveBeenCalledTimes(2);
  });

  it('should not debounce when debounceIntervalMs is 0', () => {
    vad = new VadService({
      ...defaultVadConfig,
      silenceThresholdMs: 100,
      minSpeechDurationMs: 50,
      debounceIntervalMs: 0,
      minUtteranceDurationMs: 0,
      debug: false,
    });
    vad.start();

    const turnEndListener = vi.fn();
    vad.on(VadEventType.TURN_END, turnEndListener);

    triggerTurn(vad);
    triggerTurn(vad);

    expect(turnEndListener).toHaveBeenCalledTimes(2);
  });
});

describe('VadService — minimum utterance duration', () => {
  it('should skip utterances shorter than minUtteranceDurationMs', () => {
    const vad = new VadService({
      ...defaultVadConfig,
      silenceThresholdMs: 100,
      minSpeechDurationMs: 20, // Very low so we can get to SPEECH_ACTIVE
      minUtteranceDurationMs: 500, // High — 25 frames needed
      debounceIntervalMs: 0,
      debug: false,
    });
    vad.start();

    const turnEndListener = vi.fn();
    vad.on(VadEventType.TURN_END, turnEndListener);

    // Very short speech (5 frames = 100ms < 500ms minUtterance)
    for (let i = 0; i < 5; i++) {
      vad.processFrame(createSpeechFrame());
    }

    // Silence to end turn
    for (let i = 0; i < 10; i++) {
      vad.processFrame(createSilentFrame());
    }

    // Should NOT have emitted turn.end because utterance was too short
    expect(turnEndListener).not.toHaveBeenCalled();
    expect(vad.getState()).toBe(VadState.IDLE);
    vad.stop();
  });

  it('should allow utterances >= minUtteranceDurationMs', () => {
    const vad = new VadService({
      ...defaultVadConfig,
      silenceThresholdMs: 100,
      minSpeechDurationMs: 50,
      minUtteranceDurationMs: 200, // 10 frames at 20ms
      debounceIntervalMs: 0,
      debug: false,
    });
    vad.start();

    const turnEndListener = vi.fn();
    vad.on(VadEventType.TURN_END, turnEndListener);

    // Sufficient speech (15 frames = 300ms > 200ms)
    for (let i = 0; i < 15; i++) {
      vad.processFrame(createSpeechFrame());
    }

    // Silence
    for (let i = 0; i < 10; i++) {
      vad.processFrame(createSilentFrame());
    }

    expect(turnEndListener).toHaveBeenCalledTimes(1);
    vad.stop();
  });
});
