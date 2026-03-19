/**
 * LiveKit Agent Service
 *
 * Connects the bot as a real-time participant in a LiveKit room using @livekit/rtc-node.
 * Handles subscribing to remote audio tracks and publishing bot audio.
 * Includes auto-reconnection with exponential backoff.
 */

import { EventEmitter } from 'events';
import { LiveKitService } from './livekit-service.js';
import { resample, int16ArrayToBuffer, bufferToInt16Array } from './audio-resampler.js';

let rtcNode: any = null;

async function loadRtcNode(): Promise<any> {
  if (!rtcNode) {
    try {
      rtcNode = await import('@livekit/rtc-node');
    } catch {
      console.warn('[LiveKitAgent] @livekit/rtc-node not available - LiveKit agent features disabled');
      return null;
    }
  }
  return rtcNode;
}

const LIVEKIT_SAMPLE_RATE = 48000;
const PIPELINE_SAMPLE_RATE = 16000;

const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 1000;

export class LiveKitAgentService extends EventEmitter {
  private livekitService: LiveKitService;
  private room: any = null;
  private audioSource: any = null;
  private localAudioTrack: any = null;
  private connected: boolean = false;

  // Reconnection state
  private reconnectAttempts: number = 0;
  private reconnecting: boolean = false;
  private intentionalDisconnect: boolean = false;
  private lastUrl: string = '';
  private lastToken: string = '';

  constructor(livekitService: LiveKitService) {
    super();
    this.livekitService = livekitService;
  }

  /**
   * Join a LiveKit room as a participant
   */
  async joinRoom(url: string, token: string): Promise<void> {
    const sdk = await loadRtcNode();
    if (!sdk) {
      throw new Error('@livekit/rtc-node SDK not available');
    }

    console.log('[LiveKitAgent] Joining LiveKit room...');

    this.lastUrl = url;
    this.lastToken = token;
    this.intentionalDisconnect = false;
    this.reconnectAttempts = 0;

    this.room = new sdk.Room();

    this.room.on('trackSubscribed', (track: any, publication: any, participant: any) => {
      this.handleTrackSubscribed(sdk, track, participant);
    });

    this.room.on('disconnected', () => {
      console.log('[LiveKitAgent] Disconnected from room');
      this.connected = false;
      this.emit('disconnected');

      // Auto-reconnect unless intentionally disconnected
      if (!this.intentionalDisconnect) {
        this.attemptReconnect();
      }
    });

    await this.room.connect(url, token);
    this.connected = true;

    this.audioSource = new sdk.AudioSource(LIVEKIT_SAMPLE_RATE, 1);
    this.localAudioTrack = sdk.LocalAudioTrack.createAudioTrack('bot-audio', this.audioSource);

    await this.room.localParticipant.publishTrack(this.localAudioTrack);

    console.log('[LiveKitAgent] Joined room and published audio track');
  }

  /**
   * Leave the LiveKit room intentionally
   */
  async leaveRoom(): Promise<void> {
    this.intentionalDisconnect = true;

    if (this.room) {
      console.log('[LiveKitAgent] Leaving room...');
      await this.room.disconnect();
      this.room = null;
      this.audioSource = null;
      this.localAudioTrack = null;
      this.connected = false;
      console.log('[LiveKitAgent] Left room');
    }
  }

  /**
   * Publish a single audio frame to the room
   */
  async publishAudioFrame(frame: any): Promise<void> {
    if (!this.audioSource || !this.connected) {
      throw new Error('Not connected to LiveKit room');
    }

    await this.audioSource.captureFrame(frame);
  }

  /**
   * Publish a Buffer of PCM16 audio to the room.
   * Handles resampling from pipeline rate to LiveKit rate (48kHz).
   */
  async publishAudioBuffer(audioData: Buffer, sampleRate: number): Promise<void> {
    if (!this.audioSource || !this.connected) {
      throw new Error('Not connected to LiveKit room');
    }

    const sdk = await loadRtcNode();
    if (!sdk) return;

    let pcmData = audioData;
    if (sampleRate !== LIVEKIT_SAMPLE_RATE) {
      pcmData = resample(audioData, sampleRate, LIVEKIT_SAMPLE_RATE, 1);
    }

    const samples = bufferToInt16Array(pcmData);

    const frame = new sdk.AudioFrame(
      samples,
      LIVEKIT_SAMPLE_RATE,
      1,
      samples.length
    );

    await this.audioSource.captureFrame(frame);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalDisconnect) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[LiveKitAgent] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
      this.emit('reconnect.failed');
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delay = INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[LiveKitAgent] Reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    if (this.intentionalDisconnect) {
      this.reconnecting = false;
      return;
    }

    try {
      // Clean up old room
      this.room = null;
      this.audioSource = null;
      this.localAudioTrack = null;

      await this.joinRoom(this.lastUrl, this.lastToken);
      console.log('[LiveKitAgent] Reconnected successfully');
      this.reconnectAttempts = 0;
      this.emit('reconnected');
    } catch (error: any) {
      console.error(`[LiveKitAgent] Reconnect attempt ${this.reconnectAttempts} failed:`, error.message);
      this.emit('reconnect.error', error);
    }

    this.reconnecting = false;
  }

  private async handleTrackSubscribed(sdk: any, track: any, participant: any): Promise<void> {
    if (track.kind !== sdk.TrackKind.KIND_AUDIO) {
      return;
    }

    console.log(`[LiveKitAgent] Subscribed to audio track from ${participant.identity}`);

    const stream = new sdk.AudioStream(track, LIVEKIT_SAMPLE_RATE, 1);

    try {
      for await (const audioFrame of stream) {
        if (!this.connected) break;

        const rawPcm = int16ArrayToBuffer(audioFrame.data);
        const resampled = resample(rawPcm, LIVEKIT_SAMPLE_RATE, PIPELINE_SAMPLE_RATE, 1);

        this.emit('audio.frame', {
          data: resampled,
          sampleRate: PIPELINE_SAMPLE_RATE,
          channels: 1,
          format: 'pcm16',
          timestamp: Date.now(),
          durationMs: (resampled.length / (PIPELINE_SAMPLE_RATE * 2)) * 1000,
          participantIdentity: participant.identity,
        });
      }
    } catch (error: any) {
      if (this.connected) {
        console.error('[LiveKitAgent] Error processing audio stream:', error.message);
        this.emit('error', error);
      }
    }
  }
}
