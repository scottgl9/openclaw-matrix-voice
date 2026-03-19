/**
 * LiveKit Agent Service
 *
 * Connects the bot as a real-time participant in a LiveKit room using @livekit/rtc-node.
 * Handles subscribing to remote audio tracks and publishing bot audio.
 *
 * Audio flow:
 *   Remote participant audio -> TrackSubscribed -> AudioStream -> resample 48kHz->16kHz -> emit 'audio.frame'
 *   Bot TTS audio -> resample to 48kHz -> AudioSource -> LocalAudioTrack -> published to room
 */

import { EventEmitter } from 'events';
import { LiveKitService } from './livekit-service.js';
import { resample, int16ArrayToBuffer, bufferToInt16Array } from './audio-resampler.js';

// LiveKit RTC Node SDK types - dynamically imported to allow graceful degradation
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

export class LiveKitAgentService extends EventEmitter {
  private livekitService: LiveKitService;
  private room: any = null;
  private audioSource: any = null;
  private localAudioTrack: any = null;
  private connected: boolean = false;

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

    this.room = new sdk.Room();

    // Set up event handlers before connecting
    this.room.on('trackSubscribed', (track: any, publication: any, participant: any) => {
      this.handleTrackSubscribed(sdk, track, participant);
    });

    this.room.on('disconnected', () => {
      console.log('[LiveKitAgent] Disconnected from room');
      this.connected = false;
      this.emit('disconnected');
    });

    // Connect to the room
    await this.room.connect(url, token);
    this.connected = true;

    // Create audio source for publishing bot audio
    this.audioSource = new sdk.AudioSource(LIVEKIT_SAMPLE_RATE, 1);
    this.localAudioTrack = sdk.LocalAudioTrack.createAudioTrack('bot-audio', this.audioSource);

    // Publish our audio track
    await this.room.localParticipant.publishTrack(this.localAudioTrack);

    console.log('[LiveKitAgent] Joined room and published audio track');
  }

  /**
   * Leave the LiveKit room
   */
  async leaveRoom(): Promise<void> {
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

    // Resample to LiveKit's expected rate
    let pcmData = audioData;
    if (sampleRate !== LIVEKIT_SAMPLE_RATE) {
      pcmData = resample(audioData, sampleRate, LIVEKIT_SAMPLE_RATE, 1);
    }

    // Convert to Int16Array for LiveKit AudioFrame
    const samples = bufferToInt16Array(pcmData);

    // Create AudioFrame and publish
    const frame = new sdk.AudioFrame(
      samples,
      LIVEKIT_SAMPLE_RATE,
      1,
      samples.length
    );

    await this.audioSource.captureFrame(frame);
  }

  /**
   * Check if connected to a LiveKit room
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle a subscribed remote audio track
   */
  private async handleTrackSubscribed(sdk: any, track: any, participant: any): Promise<void> {
    if (track.kind !== sdk.TrackKind.KIND_AUDIO) {
      return;
    }

    console.log(`[LiveKitAgent] Subscribed to audio track from ${participant.identity}`);

    // Create AudioStream from the track (async iterable of AudioFrames)
    const stream = new sdk.AudioStream(track, LIVEKIT_SAMPLE_RATE, 1);

    // Process audio frames from the stream
    try {
      for await (const audioFrame of stream) {
        if (!this.connected) break;

        // Convert LiveKit AudioFrame (Int16Array @ 48kHz) to pipeline AudioFrame (Buffer @ 16kHz)
        const rawPcm = int16ArrayToBuffer(audioFrame.data);
        const resampled = resample(rawPcm, LIVEKIT_SAMPLE_RATE, PIPELINE_SAMPLE_RATE, 1);

        this.emit('audio.frame', {
          data: resampled,
          sampleRate: PIPELINE_SAMPLE_RATE,
          channels: 1,
          format: 'pcm16',
          timestamp: Date.now(),
          durationMs: (resampled.length / (PIPELINE_SAMPLE_RATE * 2)) * 1000,
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
