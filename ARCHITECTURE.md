# Architecture - OpenClaw Matrix Voice

## Overview

OpenClaw Matrix Voice is a Matrix bot that provides voice call functionality via LiveKit. The system supports:
- Text-simulated voice calls (fallback)
- Real-time LiveKit-based voice calls with the bot as a room participant
- MatrixRTC auto-join via `m.call.member` state events
- Full pipeline: VAD -> Whisper STT -> OpenClaw LLM -> Chatterbox TTS

## System Components

### 1. VoiceCallHandler

**Location**: `src/handlers/voice-call-handler.ts`

**Responsibility**: Orchestrates voice call flow, routes events, manages call lifecycle.

**Key Features**:
- Manages active call sessions per room
- Handles `/call start`, `/call end`, `/call status` commands
- Detects MatrixRTC `m.call.member` state events and auto-joins LiveKit calls
- Creates and wires AudioPipeline with LiveKit transport or loopback
- Routes TTS audio output to LiveKit (real-time) or Matrix (file upload)

**CallState**:
```typescript
interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  audioPipeline?: AudioPipelineService;
  turnProcessor?: TurnProcessorService;
  vadService?: VadService;
  livekitAgent?: LiveKitAgentService;
  isLiveKitCall?: boolean;
}
```

### 2. LiveKitAgentService

**Location**: `src/services/livekit-agent-service.ts`

**Responsibility**: Connects the bot as a real-time participant in LiveKit rooms.

**Key Features**:
- Uses `@livekit/rtc-node` to join rooms via `Room.connect(url, token)`
- Subscribes to remote audio tracks (`TrackSubscribed` event)
- Creates `AudioStream` from subscribed tracks (async iterable)
- Resamples audio: 48kHz (LiveKit) <-> 16kHz (pipeline)
- Publishes bot audio via `AudioSource` + `LocalAudioTrack`
- Emits `audio.frame` events for pipeline consumption

**Audio Flow**:
```
Inbound:  Remote participant -> TrackSubscribed -> AudioStream -> resample 48->16kHz -> emit 'audio.frame'
Outbound: TTS Buffer -> resample to 48kHz -> AudioSource.captureFrame() -> published to room
```

### 3. LiveKit Audio Transport

**Location**: `src/services/livekit-audio-transport.ts`

**Responsibility**: Implements `AudioIngress`/`AudioEgress` interfaces for LiveKit.

- `LiveKitAudioIngress`: Wraps `LiveKitAgentService` `audio.frame` events
- `LiveKitAudioEgress`: Wraps `LiveKitAgentService.publishAudioBuffer()`

### 4. AudioPipelineService

**Location**: `src/services/audio-pipeline.ts`

**Responsibility**: Core audio frame processing with pluggable transport.

**Key Features**:
- `setIngress(ingress)` / `setEgress(egress)` for pluggable transport
- Falls back to `LoopbackIngress`/`LoopbackEgress` when no custom transport is set
- VAD integration via `setVadService()`
- Emits `turn.complete` events when VAD detects speech turns
- Frame counting and statistics

**AudioFrame**:
```typescript
interface AudioFrame {
  data: Buffer;        // PCM16 LE audio data
  sampleRate: number;  // Hz (16000, 48000, etc.)
  channels: number;    // 1 = mono
  format: string;      // 'pcm16'
  timestamp: number;   // Unix ms
  durationMs: number;
}
```

### 5. Audio Resampler

**Location**: `src/services/audio-resampler.ts`

**Responsibility**: PCM16 sample rate conversion using linear interpolation.

- `resample(input, fromRate, toRate, channels)` - Core resampling function
- `int16ArrayToBuffer(samples)` - Convert LiveKit AudioFrame data to Buffer
- `bufferToInt16Array(buf)` - Convert Buffer to Int16Array for LiveKit

### 6. VadService

**Location**: `src/services/vad-service.ts`

**Responsibility**: Speech detection and turn segmentation.

**Key Features**:
- RMS energy-based speech detection
- **Adaptive threshold**: Calibrates to ambient noise during first ~1s of frames
- **Hangover smoothing**: Tolerates N consecutive silent frames during speech
- State machine: IDLE -> SPEECH_START -> SPEECH_ACTIVE -> SILENCE -> IDLE
- Emits: `speech.start`, `speech.end`, `turn.end`, `vad.frame`

**VadConfig**:
```typescript
interface VadConfig {
  energyThreshold: number;           // 0-1, default 0.3
  silenceThresholdMs: number;        // default 800
  minSpeechDurationMs: number;       // default 200
  adaptiveThreshold: boolean;        // enable noise floor calibration
  adaptiveMultiplier: number;        // threshold = noiseFloor * multiplier (default 3)
  adaptiveCalibrationFrames: number; // frames for calibration (default 50)
  hangoverFrames: number;            // silent frames tolerated during speech (default 0)
}
```

### 7. WhisperSTTAdapter

**Location**: `src/services/whisper-stt-adapter.ts`

**Responsibility**: Real STT via Whisper HTTP API (OpenAI-compatible endpoint).

**Key Features**:
- Implements `STTAdapter` interface
- Accumulates PCM frames -> concatenates -> converts to WAV via `wavefile`
- POSTs WAV to `/v1/audio/transcriptions` (faster-whisper-server compatible)
- Returns transcribed text with confidence

### 8. STTAdapter & STTService

**Location**: `src/services/stt-adapter.ts`

**Responsibility**: Pluggable STT provider interface.

- `STTAdapter` interface: `initialize()`, `transcribeFrame()`, `finalize()`, `reset()`
- `MockSTTAdapter`: Returns pre-configured responses for testing
- `STTService`: Manages adapter lifecycle and turn-based transcription

### 9. TurnProcessorService

**Location**: `src/services/turn-processor.ts`

**Responsibility**: Orchestrates VAD -> STT -> OpenClaw -> TTS pipeline.

**Processing Flow**:
```
TurnCompletionEvent (from AudioPipeline/VAD)
  -> transcribeTurn(): STTService.finalizeTurn() -> text
  -> processText(): OpenClawService.processText(text) -> response
  -> generateTTS(): ChatterboxTTSService.textToSpeechCached(response) -> audioData
  -> emit 'tts.audio' event -> VoiceCallHandler routes to LiveKit or Matrix
```

### 10. MatrixClientService

**Location**: `src/services/matrix-client-service.ts`

**Responsibility**: Matrix client lifecycle and event routing.

- Wraps `matrix-bot-sdk` MatrixClient
- Creates VoiceCallHandler, AudioPipelineService, LiveKitService
- Routes `room.message`, `room.event` to VoiceCallHandler
- Provides `sendMessage()`, `sendAudio()` for Matrix room output

### 11. LiveKitService

**Location**: `src/services/livekit-service.ts`

**Responsibility**: LiveKit server management (room creation, token generation).

- Uses `livekit-server-sdk` `RoomServiceClient`
- Creates/deletes rooms, generates JWT tokens with grants
- Tracks room-to-Matrix-room mappings

### 12. OpenClawService & ChatterboxTTSService

- `OpenClawService`: HTTP POST to OpenClaw gateway for LLM responses
- `ChatterboxTTSService`: HTTP POST to Chatterbox TTS for speech synthesis, with caching

## Data Flow

### LiveKit Real-Time Call

```
User joins voice call in Element (MatrixRTC)
  -> Element sends m.call.member state event with foci_active: [{type: 'livekit', ...}]
  -> MatrixClientService receives room.event
  -> VoiceCallHandler.handleMatrixRTCEvent()
  -> Generate bot token via LiveKitService.generateToken()
  -> LiveKitAgentService.joinRoom(url, token)
  -> Subscribe to remote audio tracks
  -> AudioStream yields frames at 48kHz
  -> Resample 48kHz -> 16kHz
  -> LiveKitAudioIngress emits 'frame'
  -> AudioPipelineService processes frame through VAD
  -> VAD detects turn end -> emit turn.complete
  -> TurnProcessor: Whisper STT -> OpenClaw -> Chatterbox TTS
  -> TTS audio -> LiveKitAgentService.publishAudioBuffer()
  -> Resample 16kHz -> 48kHz -> AudioSource.captureFrame()
  -> User hears bot response in LiveKit room
```

### Text-Simulated Call (Fallback)

```
User: /call start
  -> VoiceCallHandler.startCall()
  -> User replies to bot message with text
  -> VoiceCallHandler.processVoiceInput()
  -> OpenClawService.processText(text) -> AI response
  -> ChatterboxTTSService.textToSpeechCached(response) -> WAV
  -> MatrixClientService.sendAudio() -> uploaded to Matrix room
```

## Testing

### Test Files (144 tests across 11 files)
- `voice-call-handler.test.ts` - Call lifecycle, commands, MatrixRTC events
- `livekit-agent-service.test.ts` - Room connection, audio publishing (mocked SDK)
- `audio-pipeline.test.ts` - Loopback path, pluggable transport, VAD integration
- `audio-resampler.test.ts` - Resampling correctness, edge cases
- `vad-service.test.ts` - State machine, adaptive threshold, hangover
- `stt-adapter.test.ts` - MockSTTAdapter, STTService turn management
- `whisper-stt-adapter.test.ts` - WAV creation, HTTP mocking
- `turn-processor.test.ts` - Full pipeline: STT -> OpenClaw -> TTS
- `livekit-service.test.ts` - Room/token management
- `openclaw-service.test.ts` - API integration
- `chatterbox-tts-service.test.ts` - TTS + caching

## Dependencies

- `matrix-bot-sdk` - Matrix protocol
- `livekit-server-sdk` - LiveKit room/token management
- `@livekit/rtc-node` - LiveKit real-time participant SDK
- `axios` - HTTP client
- `wavefile` - WAV file creation
- `dotenv` - Environment config
