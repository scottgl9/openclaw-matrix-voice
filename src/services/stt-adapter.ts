/**
 * STT (Speech-to-Text) Adapter Interface
 * 
 * Provides a pluggable interface for different STT providers.
 * This allows swapping between Whisper, Vosk, Google Cloud STT, etc.
 * 
 * Architecture:
 *   Audio Pipeline → STT Adapter → Text → OpenClaw → TTS → Audio Egress
 */

import { AudioFrame } from './audio-pipeline.js';

/**
 * STT result
 */
export interface STTResult {
  /** Transcribed text */
  text: string;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Language detected */
  language?: string;
  
  /** Duration of speech in ms */
  durationMs?: number;
  
  /** Turn ID if associated with a turn */
  turnId?: string;
}

/**
 * STT adapter interface
 * Implement this interface to add support for different STT providers
 */
export interface STTAdapter {
  /**
   * Initialize the STT adapter
   * Called when the adapter is first created
   */
  initialize(): Promise<void>;
  
  /**
   * Shutdown the STT adapter
   * Cleanup resources
   */
  shutdown(): Promise<void>;
  
  /**
   * Transcribe a single audio frame
   * For streaming STT, this accumulates context
   */
  transcribeFrame(frame: AudioFrame): Promise<STTResult | null>;
  
  /**
   * Finalize transcription and get complete result
   * Call this when speech ends to get the full transcription
   */
  finalize(): Promise<STTResult>;
  
  /**
   * Reset the adapter state
   * Call this when starting a new turn
   */
  reset(): void;
  
  /**
   * Check if the adapter is ready
   */
  isReady(): boolean;
  
  /**
   * Get adapter name/identifier
   */
  getName(): string;
}

/**
 * Mock STT adapter for testing
 * Returns pre-configured text instead of actual transcription
 */
export class MockSTTAdapter implements STTAdapter {
  private isReadyFlag: boolean = false;
  private accumulatedText: string = '';
  private mockResponses: string[] = [];
  private responseIndex: number = 0;

  constructor(mockResponses?: string[]) {
    this.mockResponses = mockResponses || ['Hello', 'Test transcription', 'Mock response'];
  }

  async initialize(): Promise<void> {
    console.log('[STT/Mock] Initializing mock STT adapter...');
    // Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 100));
    this.isReadyFlag = true;
    console.log('[STT/Mock] Mock STT adapter initialized');
  }

  async shutdown(): Promise<void> {
    console.log('[STT/Mock] Shutting down mock STT adapter...');
    this.isReadyFlag = false;
    this.reset();
  }

  async transcribeFrame(frame: AudioFrame): Promise<STTResult | null> {
    if (!this.isReadyFlag) {
      throw new Error('STT adapter not initialized');
    }
    
    // For mock, we just accumulate frames and return partial results
    // In a real implementation, this would process the audio
    return null; // No partial results for mock
  }

  async finalize(): Promise<STTResult> {
    if (!this.isReadyFlag) {
      throw new Error('STT adapter not initialized');
    }

    // Get next mock response
    const text = this.mockResponses[this.responseIndex % this.mockResponses.length];
    this.responseIndex++;
    
    const result: STTResult = {
      text,
      confidence: 0.95,
      language: 'en',
      turnId: undefined,
    };

    console.log(`[STT/Mock] Finalized: "${text}" (confidence: 0.95)`);
    return result;
  }

  reset(): void {
    this.accumulatedText = '';
    this.responseIndex = 0;
    console.log('[STT/Mock] Mock STT adapter reset');
  }

  isReady(): boolean {
    return this.isReadyFlag;
  }

  getName(): string {
    return 'MockSTT';
  }

  /**
   * Set mock responses for testing
   */
  setMockResponses(responses: string[]): void {
    this.mockResponses = responses;
    this.responseIndex = 0;
  }
}

/**
 * STT Service - Manages STT adapter and transcription flow
 */
export class STTService {
  private adapter: STTAdapter;
  private isRunning: boolean = false;
  private currentTurnId: string | null = null;

  constructor(adapter: STTAdapter) {
    this.adapter = adapter;
  }

  /**
   * Initialize the STT service
   */
  async initialize(): Promise<void> {
    console.log('[STT] Initializing STT service...');
    await this.adapter.initialize();
    this.isRunning = true;
    console.log(`[STT] STT service initialized using ${this.adapter.getName()}`);
  }

  /**
   * Shutdown the STT service
   */
  async shutdown(): Promise<void> {
    console.log('[STT] Shutting down STT service...');
    this.isRunning = false;
    await this.adapter.shutdown();
  }

  /**
   * Start a new transcription turn
   */
  startTurn(turnId: string): void {
    console.log(`[STT] Starting turn: ${turnId}`);
    this.adapter.reset();
    this.currentTurnId = turnId;
  }

  /**
   * Process an audio frame through STT
   */
  async processFrame(frame: AudioFrame): Promise<STTResult | null> {
    if (!this.isRunning) {
      throw new Error('STT service not running');
    }

    return this.adapter.transcribeFrame(frame);
  }

  /**
   * Finalize transcription and get result
   */
  async finalizeTurn(): Promise<STTResult> {
    if (!this.isRunning) {
      throw new Error('STT service not running');
    }

    const result = await this.adapter.finalize();
    
    // Associate with current turn
    if (this.currentTurnId) {
      result.turnId = this.currentTurnId;
    }

    console.log(`[STT] Turn ${result.turnId} transcribed: "${result.text}"`);
    return result;
  }

  /**
   * Check if service is running
   */
  isRunningFlag(): boolean {
    return this.isRunning;
  }

  /**
   * Get current turn ID
   */
  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  /**
   * Get adapter name
   */
  getAdapterName(): string {
    return this.adapter.getName();
  }
}

/**
 * Default STT service with mock adapter
 */
export const mockSTTService = new STTService(new MockSTTAdapter());
