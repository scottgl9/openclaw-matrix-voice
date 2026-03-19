/**
 * Turn Processor Service
 * 
 * Phase 5: Orchestrates the complete turn processing flow:
 *   VAD Turn Completion → STT → OpenClaw → TTS → Audio Output
 * 
 * This service bridges the gap between voice activity detection and the
 * OpenClaw/TTS pipeline, enabling end-to-end voice call processing.
 * 
 * Architecture:
 * 
 * 1. VAD detects turn completion (speech.end → turn.end)
 * 2. TurnProcessor receives turn.end event
 * 3. TurnProcessor sends audio frames to STT adapter
 * 4. STT returns transcribed text
 * 5. TurnProcessor sends text to OpenClaw service
 * 6. OpenClaw returns AI response
 * 7. TurnProcessor sends response to TTS service
 * 8. TTS returns audio data
 * 9. TurnProcessor emits TTS audio for playback
 */

import { EventEmitter } from 'events';
import { AudioPipelineService, TurnCompletionEvent } from './audio-pipeline.js';
import { STTService, STTResult } from './stt-adapter.js';
import { OpenClawService, OpenClawResponse } from './openclaw-service.js';
import { ChatterboxTTSService, TTSResponse } from './chatterbox-tts-service.js';

/**
 * Turn processing state
 */
export enum TurnProcessingState {
  IDLE = 'idle',
  TRANSCRIBING = 'transcribing',
  PROCESSING = 'processing',
  RESPONDING = 'responding',
  ERROR = 'error',
}

/**
 * Turn processing event data
 */
export interface TurnProcessingEvent {
  turnId: string;
  state: TurnProcessingState;
  text?: string;
  response?: string;
  error?: string;
  timestamp: number;
}

/**
 * TTS audio event data
 */
export interface TTSAudioEvent {
  turnId: string;
  audioData: Buffer;
  mimeType: string;
  responseText: string;
}

/**
 * Turn Processor Service
 * 
 * Handles the complete flow from turn completion to TTS audio output.
 */
export class TurnProcessorService extends EventEmitter {
  private state: TurnProcessingState = TurnProcessingState.IDLE;
  private sttService: STTService | null = null;
  private openClawService: OpenClawService;
  private ttsService: ChatterboxTTSService;
  private currentTurnId: string | null = null;

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

  /**
   * Initialize the turn processor
   */
  async initialize(): Promise<void> {
    console.log('[TurnProcessor] Initializing turn processor...');
    
    if (this.sttService) {
      await this.sttService.initialize();
    }

    this.state = TurnProcessingState.IDLE;
    console.log('[TurnProcessor] Turn processor initialized');
  }

  /**
   * Shutdown the turn processor
   */
  async shutdown(): Promise<void> {
    console.log('[TurnProcessor] Shutting down turn processor...');
    
    if (this.sttService) {
      await this.sttService.shutdown();
    }

    this.state = TurnProcessingState.IDLE;
    this.currentTurnId = null;
    console.log('[TurnProcessor] Turn processor shutdown');
  }

  /**
   * Set STT service for transcription
   */
  setSTTService(sttService: STTService): void {
    this.sttService = sttService;
    console.log('[TurnProcessor] STT service attached');
  }

  /**
   * Handle turn completion event from VAD/AudioPipeline
   * This is the main entry point for processing a completed speech turn
   */
  async handleTurnCompletion(event: TurnCompletionEvent): Promise<void> {
    const { turnId, frames, durationMs } = event;
    
    console.log(`[TurnProcessor] Handling turn completion: ${turnId} (${durationMs}ms, ${frames.length} frames)`);
    
    if (this.state !== TurnProcessingState.IDLE) {
      console.warn(`[TurnProcessor] Already processing turn ${this.currentTurnId}, ignoring ${turnId}`);
      return;
    }

    this.currentTurnId = turnId;
    this.setState(TurnProcessingState.TRANSCRIBING);

    try {
      // Step 1: Transcribe audio using STT
      const sttResult = await this.transcribeTurn(turnId, frames);
      
      if (!sttResult.success) {
        throw new Error(sttResult.error || 'STT transcription failed');
      }

      // Step 2: Process text through OpenClaw
      const openClawResult = await this.processText(sttResult.text!);
      
      if (!openClawResult.success) {
        throw new Error(openClawResult.error || 'OpenClaw processing failed');
      }

      // Step 3: Convert response to speech using TTS
      const ttsResult = await this.generateTTS(openClawResult.response!);
      
      if (!ttsResult.success) {
        throw new Error(ttsResult.error || 'TTS generation failed');
      }

      // Step 4: Emit TTS audio for playback
      this.emitTTSAudio(turnId, ttsResult);

      this.setState(TurnProcessingState.IDLE);
      this.currentTurnId = null;

    } catch (error: any) {
      console.error(`[TurnProcessor] Error processing turn ${turnId}:`, error.message);
      this.emitError(turnId, error.message);
      this.setState(TurnProcessingState.IDLE);
      this.currentTurnId = null;
    }
  }

  /**
   * Transcribe a turn using STT
   */
  private async transcribeTurn(turnId: string, frames: any[]): Promise<{ success: boolean; text?: string; error?: string }> {
    console.log(`[TurnProcessor] Transcribing turn ${turnId}...`);
    this.setState(TurnProcessingState.TRANSCRIBING);

    if (!this.sttService || !this.sttService.isRunningFlag()) {
      // No STT service available - return error
      return {
        success: false,
        error: 'STT service not available',
      };
    }

    try {
      // Start transcription turn
      this.sttService.startTurn(turnId);

      // Process each frame through STT
      for (const frame of frames) {
        await this.sttService.processFrame(frame);
      }

      // Finalize and get transcription
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

  /**
   * Process text through OpenClaw
   */
  private async processText(text: string): Promise<OpenClawResponse> {
    console.log(`[TurnProcessor] Processing text through OpenClaw: "${text}"`);
    this.setState(TurnProcessingState.PROCESSING);

    try {
      const result = await this.openClawService.processText(text);
      
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

  /**
   * Generate TTS audio from response text
   */
  private async generateTTS(text: string): Promise<TTSResponse> {
    console.log(`[TurnProcessor] Generating TTS for: "${text}"`);
    this.setState(TurnProcessingState.RESPONDING);

    try {
      const result = await this.ttsService.textToSpeechCached(text);
      
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

  /**
   * Emit TTS audio for playback
   */
  private emitTTSAudio(turnId: string, ttsResult: TTSResponse): void {
    if (!ttsResult.success || !ttsResult.audioData) {
      return;
    }

    const event: TTSAudioEvent = {
      turnId,
      audioData: ttsResult.audioData,
      mimeType: ttsResult.mimeType || 'audio/wav',
      responseText: ttsResult.success ? (this as any).lastResponseText || '' : '',
    };

    console.log(`[TurnProcessor] Emitting TTS audio for turn ${turnId}`);
    this.emit('tts.audio', event);
  }

  /**
   * Emit error event
   */
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

  /**
   * Update processing state
   */
  private setState(state: TurnProcessingState): void {
    const oldState = this.state;
    this.state = state;
    
    console.log(`[TurnProcessor] State change: ${oldState} → ${state}`);
    
    if (this.currentTurnId) {
      this.emit('state.change', {
        turnId: this.currentTurnId,
        state,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Get current processing state
   */
  getState(): TurnProcessingState {
    return this.state;
  }

  /**
   * Get current turn ID (if processing)
   */
  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /**
   * Check if currently processing a turn
   */
  isProcessing(): boolean {
    return this.state !== TurnProcessingState.IDLE;
  }
}

/**
 * Default turn processor with mock STT
 * Note: This is a placeholder - actual instantiation should happen in the main app
 * to avoid circular dependencies and allow proper configuration.
 */
export function createDefaultTurnProcessor(): TurnProcessorService {
  // Import dynamically to avoid circular dependencies
  const { OpenClawService } = require('./openclaw-service.js');
  const { ChatterboxTTSService } = require('./chatterbox-tts-service.js');
  const { STTService, MockSTTAdapter } = require('./stt-adapter.js');
  
  return new TurnProcessorService(
    new OpenClawService(),
    new ChatterboxTTSService(),
    new STTService(new MockSTTAdapter())
  );
}
