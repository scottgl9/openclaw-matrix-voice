/**
 * Turn Processor Service
 *
 * Orchestrates the complete turn processing flow:
 *   VAD Turn Completion -> STT -> OpenClaw -> TTS -> Audio Output
 */

import { EventEmitter } from 'events';
import { TurnCompletionEvent } from './audio-pipeline.js';
import { STTService, STTResult } from './stt-adapter.js';
import { OpenClawService, OpenClawResponse } from './openclaw-service.js';
import { ChatterboxTTSService, TTSResponse } from './chatterbox-tts-service.js';
import { withRetry } from '../utils/retry.js';

export enum TurnProcessingState {
  IDLE = 'idle',
  TRANSCRIBING = 'transcribing',
  PROCESSING = 'processing',
  RESPONDING = 'responding',
  ERROR = 'error',
}

export interface TurnProcessingEvent {
  turnId: string;
  state: TurnProcessingState;
  text?: string;
  response?: string;
  error?: string;
  timestamp: number;
}

export interface TTSAudioEvent {
  turnId: string;
  audioData: Buffer;
  mimeType: string;
  responseText: string;
}

export class TurnProcessorService extends EventEmitter {
  private state: TurnProcessingState = TurnProcessingState.IDLE;
  private sttService: STTService | null = null;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private currentTurnId: string | null = null;
  private cancelled: boolean = false;

  constructor(
    openClawService: OpenClawService,
    ttsService: ChatterboxTTSService,
    sttService?: STTService
  ) {
    super();
    this.openClawService = openClawService;
    this.ttsService = ttsService;
    this.sttService = sttService || null;
  }

  async initialize(): Promise<void> {
    console.log('[TurnProcessor] Initializing turn processor...');

    if (this.sttService) {
      await this.sttService.initialize();
    }

    this.state = TurnProcessingState.IDLE;
    console.log('[TurnProcessor] Turn processor initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[TurnProcessor] Shutting down turn processor...');

    if (this.sttService) {
      await this.sttService.shutdown();
    }

    this.state = TurnProcessingState.IDLE;
    this.currentTurnId = null;
    console.log('[TurnProcessor] Turn processor shutdown');
  }

  setSTTService(sttService: STTService): void {
    this.sttService = sttService;
    console.log('[TurnProcessor] STT service attached');
  }

  /**
   * Cancel the current turn processing (used for barge-in interruption).
   */
  cancel(): void {
    if (this.state !== TurnProcessingState.IDLE) {
      console.log(`[TurnProcessor] Cancelling turn ${this.currentTurnId}`);
      this.cancelled = true;
      this.state = TurnProcessingState.IDLE;
      this.currentTurnId = null;
    }
  }

  /**
   * Handle turn completion event from VAD/AudioPipeline.
   * This is the main entry point for processing a completed speech turn.
   */
  async handleTurnCompletion(event: TurnCompletionEvent): Promise<void> {
    const { turnId, frames, durationMs } = event;

    console.log(`[TurnProcessor] Handling turn completion: ${turnId} (${durationMs}ms, ${frames.length} frames)`);

    if (this.state !== TurnProcessingState.IDLE) {
      console.warn(`[TurnProcessor] Already processing turn ${this.currentTurnId}, ignoring ${turnId}`);
      return;
    }

    this.currentTurnId = turnId;
    this.cancelled = false;
    this.setState(TurnProcessingState.TRANSCRIBING);

    const turnStartMs = Date.now();

    try {
      // Step 1: Transcribe audio using STT
      const sttStartMs = Date.now();
      const sttResult = await this.transcribeTurn(turnId, frames);
      const sttMs = Date.now() - sttStartMs;

      if (this.cancelled) {
        console.log(`[TurnProcessor] Turn ${turnId} cancelled after STT`);
        return;
      }

      if (!sttResult.success) {
        throw new Error(sttResult.error || 'STT transcription failed');
      }

      // Skip empty transcriptions (noise, silence, garbled audio)
      const transcribedText = (sttResult.text || '').trim();
      if (!transcribedText) {
        console.log('[TurnProcessor] Empty transcription, skipping');
        this.setState(TurnProcessingState.IDLE);
        return;
      }

      // Step 2: Process text through OpenClaw (with retry)
      const llmStartMs = Date.now();
      const openClawResult = await this.processText(transcribedText);
      const llmMs = Date.now() - llmStartMs;

      if (this.cancelled) {
        console.log(`[TurnProcessor] Turn ${turnId} cancelled after LLM`);
        return;
      }

      if (!openClawResult.success) {
        throw new Error(openClawResult.error || 'OpenClaw processing failed');
      }

      // Agent chose to stay silent — skip TTS entirely
      if (openClawResult.silent) {
        console.log(`[TurnProcessor] Agent silent (NO_REPLY), skipping TTS for turn ${turnId}`);
        this.setState(TurnProcessingState.IDLE);
        this.currentTurnId = null;
        return;
      }

      const responseText = openClawResult.response!;

      // Step 3: Convert response to speech using TTS (with retry)
      const ttsStartMs = Date.now();
      const ttsResult = await this.generateTTS(responseText);
      const ttsMs = Date.now() - ttsStartMs;

      if (this.cancelled) {
        console.log(`[TurnProcessor] Turn ${turnId} cancelled after TTS`);
        return;
      }

      if (!ttsResult.success) {
        throw new Error(ttsResult.error || 'TTS generation failed');
      }

      // Latency profiling
      const totalMs = Date.now() - turnStartMs;
      const grade = gradeLatency(totalMs);
      console.log(`[Latency] STT=${sttMs}ms LLM=${llmMs}ms TTS=${ttsMs}ms Total=${totalMs}ms [${grade}]`);

      // Step 4: Emit TTS audio for playback
      this.emitTTSAudio(turnId, responseText, ttsResult);

      this.setState(TurnProcessingState.IDLE);
      this.currentTurnId = null;

    } catch (error: any) {
      if (this.cancelled) {
        console.log(`[TurnProcessor] Turn ${turnId} cancelled during error recovery`);
        return;
      }
      console.error(`[TurnProcessor] Error processing turn ${turnId}:`, error.message);
      this.emitError(turnId, error.message);
      this.setState(TurnProcessingState.IDLE);
      this.currentTurnId = null;
    }
  }

  private async transcribeTurn(turnId: string, frames: any[]): Promise<{ success: boolean; text?: string; error?: string }> {
    console.log(`[TurnProcessor] Transcribing turn ${turnId}...`);
    this.setState(TurnProcessingState.TRANSCRIBING);

    if (!this.sttService || !this.sttService.isRunningFlag()) {
      return {
        success: false,
        error: 'STT service not available',
      };
    }

    try {
      this.sttService.startTurn(turnId);

      for (const frame of frames) {
        await this.sttService.processFrame(frame);
      }

      const result: STTResult = await this.sttService.finalizeTurn();

      console.log(`[TurnProcessor] Transcription complete: "${result.text}"`);
      return {
        success: true,
        text: result.text,
      };
    } catch (error: any) {
      console.error('[TurnProcessor] STT transcription error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async processText(text: string): Promise<OpenClawResponse> {
    console.log(`[TurnProcessor] Processing text through OpenClaw: "${text}"`);
    this.setState(TurnProcessingState.PROCESSING);

    try {
      const result = await withRetry(
        () => this.openClawService.processText(text),
        { maxAttempts: 2, label: 'OpenClaw', timeoutMs: 30000 }
      );

      if (result.success) {
        console.log(`[TurnProcessor] OpenClaw response: "${result.response}"`);
      }

      return result;
    } catch (error: any) {
      console.error('[TurnProcessor] OpenClaw processing error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async generateTTS(text: string): Promise<TTSResponse> {
    // Strip markdown and truncate for voice — long responses cause TTS timeouts
    const voiceText = stripMarkdown(text);
    console.log(`[TurnProcessor] Generating TTS for: "${voiceText}"`);
    this.setState(TurnProcessingState.RESPONDING);

    try {
      const result = await withRetry(
        () => this.ttsService.textToSpeechCached(voiceText),
        { maxAttempts: 2, label: 'TTS', timeoutMs: 90000 }
      );

      if (result.success) {
        console.log(`[TurnProcessor] TTS audio generated: ${result.audioData?.length} bytes`);
      }

      return result;
    } catch (error: any) {
      console.error('[TurnProcessor] TTS generation error:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private emitTTSAudio(turnId: string, responseText: string, ttsResult: TTSResponse): void {
    if (!ttsResult.success || !ttsResult.audioData) {
      return;
    }

    const event: TTSAudioEvent = {
      turnId,
      audioData: ttsResult.audioData,
      mimeType: ttsResult.mimeType || 'audio/wav',
      responseText,
    };

    console.log(`[TurnProcessor] Emitting TTS audio for turn ${turnId}`);
    this.emit('tts.audio', event);
  }

  private emitError(turnId: string, errorMessage: string): void {
    const event: TurnProcessingEvent = {
      turnId,
      state: TurnProcessingState.ERROR,
      error: errorMessage,
      timestamp: Date.now(),
    };

    console.error(`[TurnProcessor] Error event for turn ${turnId}: ${errorMessage}`);
    this.emit('error', event);
  }

  private setState(state: TurnProcessingState): void {
    const oldState = this.state;
    this.state = state;

    console.log(`[TurnProcessor] State change: ${oldState} -> ${state}`);

    if (this.currentTurnId) {
      this.emit('state.change', {
        turnId: this.currentTurnId,
        state,
        timestamp: Date.now(),
      });
    }
  }

  getState(): TurnProcessingState {
    return this.state;
  }

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  isProcessing(): boolean {
    return this.state !== TurnProcessingState.IDLE;
  }
}

/**
 * Strip markdown formatting for natural TTS output.
 * Removes bold, italic, code, strikethrough, links, headers, lists, quotes, and bare URLs.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')              // code blocks
    .replace(/`([^`]+)`/g, '$1')                 // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // bold
    .replace(/\*([^*]+)\*/g, '$1')               // italic
    .replace(/__([^_]+)__/g, '$1')               // underline bold
    .replace(/_([^_]+)_/g, '$1')                 // underline italic
    .replace(/~~([^~]+)~~/g, '$1')               // strikethrough
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')     // links
    .replace(/^#{1,6}\s+/gm, '')                 // headers
    .replace(/^\d+\.\s+/gm, '')                  // numbered lists
    .replace(/^[-*+]\s+/gm, '')                  // bullet lists
    .replace(/^>\s+/gm, '')                      // block quotes
    .replace(/^---+$/gm, '')                     // horizontal rules
    .replace(/https?:\/\/\S+/g, '')              // bare URLs
    .replace(/\n+/g, ' ')                        // newlines
    .replace(/\s{2,}/g, ' ')                     // collapse whitespace
    .trim()
    .slice(0, 400);
}

/**
 * Grade end-to-end latency for voice turn processing.
 */
export function gradeLatency(totalMs: number): string {
  if (totalMs < 10000) return 'EXCELLENT';
  if (totalMs < 15000) return 'GOOD';
  if (totalMs < 20000) return 'ACCEPTABLE';
  return 'SLOW';
}
