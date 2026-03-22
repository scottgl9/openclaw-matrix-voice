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
  private silenceInterval: NodeJS.Timeout | null = null;

  // Publishing interruption (barge-in)
  private publishingAborted: boolean = false;

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

    this.room.on('participantConnected', (participant: any) => {
      console.log(`[LiveKitAgent] Participant joined: ${participant.identity}`);
      // Don't republish here — publishAudioBuffer handles InvalidState with retry
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

    const publishOptions = new sdk.TrackPublishOptions();
    publishOptions.source = sdk.TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(this.localAudioTrack, publishOptions);

    console.log('[LiveKitAgent] Joined room and published audio track');
    this.startSilenceHeartbeat();
  }

  /** Unpublish stale track and publish a fresh AudioSource — call when InvalidState or on peer join */
  private async republishAudioTrack(sdk: any): Promise<void> {
    this.stopSilenceHeartbeat();
    try {
      if (this.localAudioTrack && this.room?.localParticipant) {
        await this.room.localParticipant.unpublishTrack(this.localAudioTrack);
      }
    } catch { /* ignore unpublish errors */ }

    this.audioSource = new sdk.AudioSource(LIVEKIT_SAMPLE_RATE, 1);
    this.localAudioTrack = sdk.LocalAudioTrack.createAudioTrack('bot-audio', this.audioSource);
    const publishOptions = new sdk.TrackPublishOptions();
    publishOptions.source = sdk.TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant.publishTrack(this.localAudioTrack, publishOptions);
    console.log('[LiveKitAgent] Republished audio track with fresh AudioSource');
    this.startSilenceHeartbeat();
  }

  /** Send silent frames every 200ms to keep the AudioSource alive */
  private startSilenceHeartbeat(): void {
    this.stopSilenceHeartbeat();
    const framesPerInterval = Math.floor(LIVEKIT_SAMPLE_RATE * 0.2); // 200ms of frames
    const silence = new Int16Array(framesPerInterval); // all zeros
    this.silenceInterval = setInterval(async () => {
      if (!this.connected || !this.audioSource) return;
      try {
        const sdk = await loadRtcNode();
        if (!sdk) return;
        const frame = new sdk.AudioFrame(silence, LIVEKIT_SAMPLE_RATE, 1, framesPerInterval);
        await this.audioSource.captureFrame(frame);
      } catch {
        // ignore — real error handling is in publishAudioBuffer
      }
    }, 200);
  }

  private stopSilenceHeartbeat(): void {
    if (this.silenceInterval) {
      clearInterval(this.silenceInterval);
      this.silenceInterval = null;
    }
  }

  /**
   * Leave the LiveKit room intentionally
   */
  async leaveRoom(): Promise<void> {
    this.intentionalDisconnect = true;
    this.stopSilenceHeartbeat();

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
   * Stop any in-progress audio publishing (barge-in interruption).
   */
  stopPublishing(): void {
    this.publishingAborted = true;
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
   * Audio is published in ~20ms chunks to allow mid-stream interruption (barge-in).
   */
  async publishAudioBuffer(audioData: Buffer, sampleRate: number): Promise<{ durationMs: number }> {
    if (!this.audioSource || !this.connected) {
      throw new Error('Not connected to LiveKit room');
    }

    const sdk = await loadRtcNode();
    if (!sdk) return { durationMs: 0 };

    this.publishingAborted = false;
    this.stopSilenceHeartbeat(); // Pause heartbeat during TTS to avoid AudioSource conflicts

    let pcmData = audioData;
    if (sampleRate !== LIVEKIT_SAMPLE_RATE) {
      pcmData = resample(audioData, sampleRate, LIVEKIT_SAMPLE_RATE, 1);
    }

    const samples = bufferToInt16Array(pcmData);

    // Publish in ~20ms chunks (960 samples at 48kHz) for barge-in support
    const chunkSize = Math.floor(LIVEKIT_SAMPLE_RATE * 0.02); // 960 samples = 20ms
    for (let offset = 0; offset < samples.length; offset += chunkSize) {
      if (this.publishingAborted) {
        console.log(`[LiveKitAgent] Publishing aborted (barge-in) at ${Math.round(offset / samples.length * 100)}%`);
        return { durationMs: Math.round(offset / LIVEKIT_SAMPLE_RATE * 1000) };
      }

      const end = Math.min(offset + chunkSize, samples.length);
      const chunk = samples.slice(offset, end);

      const frame = new sdk.AudioFrame(
        chunk,
        LIVEKIT_SAMPLE_RATE,
        1,
        chunk.length
      );

      try {
        await this.audioSource.captureFrame(frame);
      } catch (error: any) {
        if (error.message?.includes('InvalidState')) {
          console.warn('[LiveKitAgent] AudioSource InvalidState — republishing track and retrying chunk');
          try {
            await this.republishAudioTrack(sdk);
            // Retry the chunk with the fresh AudioSource
            const retryFrame = new sdk.AudioFrame(chunk, LIVEKIT_SAMPLE_RATE, 1, chunk.length);
            await this.audioSource.captureFrame(retryFrame);
            continue;
          } catch (retryError: any) {
            console.error('[LiveKitAgent] Retry after republish failed:', retryError.message);
            this.startSilenceHeartbeat();
            throw retryError;
          }
        }
        this.startSilenceHeartbeat();
        throw error;
      }
    }
    this.startSilenceHeartbeat(); // Resume heartbeat after TTS

    // Compute actual audio duration from PCM data
    const totalSamples = audioData.length / 2; // 16-bit = 2 bytes per sample
    const durationMs = (totalSamples / sampleRate) * 1000;
    return { durationMs };
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
