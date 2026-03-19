# OpenClaw Matrix Voice

Matrix bot with voice call support using the Matrix SDK and LiveKit.

## Status: Phase 5 - Turn Processing Pipeline (In Progress)

This project is implementing real Matrix voice call support in phases:

### Phase 2 (Completed ✓)
- **Call Event Plumbing**: Full handling of Matrix call events (`m.call.invite`, `m.call.media`, `m.call.hangup`)
- **Call Session Management**: Track call state (invited, connecting, connected, ended)
- **Inbound Call Handling**: Auto-accept incoming calls with `m.call.answer`
- **Outbound Call Initiation**: Send `m.call.invite` to start calls
- **Call Media Routing**: Route audio events to processing pipeline
- **Text-Simulated Fallback**: Preserve existing text-based voice call flow
- **Unit Tests**: 50 tests covering all functionality

### Phase 3 (Completed ✓)
- **LiveKit Service**: Room management and token generation for LiveKit server
- **Matrix-LiveKit Adapter**: Bridge between Matrix calls and LiveKit rooms
- **Async Method Fixes**: Resolved adapter/service method signature mismatches
- **Unit Tests**: 94 tests covering all functionality (including LiveKit)
- **Build & Test Pipeline**: TypeScript compilation and test suite passing

### Phase 4 (Completed ✓)
- **Voice Activity Detection (VAD)**: Speech start/end detection and turn segmentation
- **Turn Detection**: Automatic turn-based conversation management
- **Energy-Based VAD**: RMS energy calculation for speech/silence decision
- **Configurable Thresholds**: Energy threshold, silence duration, min speech duration
- **Turn ID Tracking**: Unique turn IDs for conversation tracking
- **Statistics**: Frame counter, speech duration, turns completed
- **Audio Pipeline**: Frame-based audio processing with loopback testing
- **Unit Tests**: 144 tests passing (31 VAD + 19 audio pipeline + 94 existing)

### Phase 5 (Current - In Progress)
- **STT Adapter Interface**: Pluggable STT provider interface (MockSTT implemented)
- **STT Service**: Manages STT adapter and transcription flow
- **Turn Processor Service**: Orchestrates complete turn processing flow (VAD → STT → OpenClaw → TTS)
- **Integration Points**: AudioPipeline → TurnProcessor → STT → OpenClaw → TTS → Audio Egress
- **TurnCompletionEvent**: Bridges VAD turn completion to processing pipeline
- **TTSAudioEvent**: Emits TTS audio for playback
- **Unit Tests**: New STT/turn processor tests pending
- **Build & Test Pipeline**: TypeScript compilation passing, 144 tests passing

---

## What's Functional Now (Phase 5 - In Progress)

### Turn Processing Pipeline (Phase 5 - Partial)
- ✓ STTAdapter interface: Pluggable STT provider abstraction
- ✓ MockSTTAdapter: Mock implementation for testing
- ✓ STTService: Manages STT adapter lifecycle and transcription flow
- ✓ TurnProcessorService: Orchestrates VAD → STT → OpenClaw → TTS flow
- ✓ TurnCompletionEvent: Bridges VAD turn completion to processing
- ✓ TTSAudioEvent: Emits TTS audio for playback
- ✓ Integration hooks in VoiceCallHandler for audio pipeline

### VAD & Audio Pipeline (Phase 4 - Full)
- ✓ VadService: Energy-based speech detection with state machine
- ✓ AudioPipelineService: Frame-based audio processing
- ✓ Turn ID tracking and statistics
- ✓ Configurable thresholds (energy, silence, min speech duration)
- ✓ 31 VAD tests + 19 audio pipeline tests passing

### LiveKit Integration Layer (Full)
- ✓ LiveKitService: Room creation, deletion, listing, and participant tracking
- ✓ LiveKit token generation with JWT authentication
- ✓ MatrixLiveKitAdapter: Bridge between Matrix rooms and LiveKit rooms
- ✓ Adapter initialization with connectivity verification
- ✓ Fallback mode when LiveKit is unavailable
- ✓ Event emission for call lifecycle (started, ended)
- ✓ Connection state tracking and statistics

### Matrix Call Plumbing (Full)
- ✓ Matrix call event handling (invite, media, hangup)
- ✓ Call session state management
- ✓ Auto-accept incoming calls
- ✓ Send call invites for outbound calls
- ✓ Audio event routing infrastructure
- ✓ Audio pipeline service for frame processing

### Text-Simulated Path (Full)
- ✓ `/call start` command to begin text-simulated call
- ✓ `/call end` command to end call
- ✓ Reply-to-message voice input simulation
- ✓ OpenClaw API integration for text processing
- ✓ Chatterbox TTS for text-to-speech responses
- ✓ Audio file upload to Matrix media repository

### Current Limitations
- ✗ WebRTC peer connection not yet established
- ✗ Real audio capture/playback not yet implemented
- ✗ Real STT integration pending (MockSTT only)
- ✗ LiveKit server connection requires configuration
- ✗ End-to-end turn processing integration pending

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Voice Call Handler                      │
│  ┌─────────────────┐  ┌───────────────────────────────────┐  │
│  │ Text-Simulated  │  │    Real Media Call (Phase 2+)     │  │
│  │ Call Flow       │  │  ┌─────────────────────────────┐  │  │
│  │                 │  │  │ MatrixCallMediaService      │  │  │
│  │ /call start     │  │  │ - Call event handling       │  │  │
│  │ ↓               │  │  │ - Session management        │  │  │
│  │ Receive reply   │  │  │ - Audio routing (stub)      │  │  │
│  │ ↓               │  │  └─────────────────────────────┘  │  │
│  │ Process text    │  │                                   │  │
│  │ ↓               │  │  Phase 3+:                        │  │
│  │ TTS             │  │  - WebRTC peer connection         │  │
│  │ ↓               │  │  - Audio capture/playback         │  │
│  │ Send audio      │  │  - STT integration                │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
                  ┌──────────────────┐
                  │ Matrix Client    │
                  │ Event Handlers   │
                  └──────────────────┘
```

## Usage

### Start a Text-Simulated Call
```
/call start
```
Then reply to the bot's message with your voice input (simulated via text).

### Start a Real Media Call (Phase 2+)
```
/call start real
```
This will attempt to initiate a WebRTC-based call. Currently, the call event is sent but WebRTC connection is not yet established.

### End a Call
```
/call end
```

### Check Call Status
```
/call status
```

## Project Structure

```
src/
├── handlers/
│   └── voice-call-handler.ts    # Main call flow handler
├── services/
│   ├── matrix-client-service.ts  # Matrix client wrapper
│   ├── matrix-call-media-service.ts # Call media plumbing (Phase 2)
│   ├── livekit-service.ts        # LiveKit room/token management (Phase 3)
│   ├── matrix-livekit-adapter.ts # Matrix-LiveKit bridge (Phase 3)
│   ├── audio-pipeline.ts         # Audio frame processing pipeline (Phase 4)
│   ├── vad-service.ts            # Voice Activity Detection (Phase 4)
│   ├── openclaw-service.ts       # OpenClaw API integration
│   └── chatterbox-tts-service.ts # TTS service
├── config/
│   └── index.ts                  # Configuration
└── index.ts                      # Entry point

tests/
├── voice-call-handler.test.ts    # Handler tests
├── matrix-call-media-service.test.ts # Call media tests (Phase 2)
├── livekit-service.test.ts       # LiveKit service tests (Phase 3)
├── matrix-livekit-adapter.test.ts # Adapter tests (Phase 3)
├── audio-pipeline.test.ts        # Audio pipeline tests (Phase 4)
├── vad-service.test.ts           # VAD service tests (Phase 4)
├── openclaw-service.test.ts      # OpenClaw service tests
└── chatterbox-tts-service.test.ts # TTS service tests
```

## Development

### Prerequisites
- Node.js 18+
- Matrix account with access token
- OpenClaw API access
- Chatterbox TTS access

### Setup
```bash
npm install
cp .env.example .env  # Fill in your credentials
```

### Build & Test
```bash
npm run build   # TypeScript compilation
npm test        # Run tests with Vitest
```

### Run
```bash
npm start
```

## Current Limitations (Phase 5)

1. **No Real-Time Audio**: Audio capture and playback are not yet implemented
2. **No WebRTC**: Peer connections are not established
3. **No STT**: Speech-to-text requires manual integration
4. **Text Placeholder**: Real audio responses are sent as text placeholders

## Roadmap

### Phase 3 (Completed ✓)
- [x] LiveKit service integration (room management, token generation)
- [x] Matrix-LiveKit adapter with event emission
- [x] Async method signature fixes across adapter/service
- [x] Unit tests for LiveKit components (94 total tests passing)
- [ ] WebRTC peer connection establishment
- [ ] Audio stream capture (microphone)
- [ ] Audio stream playback (speaker)
- [ ] STT service integration (Whisper/Vosk)
- [ ] TTS audio response via WebRTC

### Phase 4 (Completed ✓)
- [x] Voice Activity Detection (VAD) service with energy-based speech detection
- [x] Turn detection with unique turn ID tracking
- [x] Audio pipeline service for frame processing
- [x] Frame-based timing for reliable testability
- [x] Configurable thresholds (energy, silence, min speech duration)
- [x] Turn statistics (frame counter, speech duration, turns completed)
- [x] 144 unit tests passing (31 VAD + 19 audio pipeline + 94 existing)
- [ ] Echo cancellation
- [ ] Noise suppression
- [ ] Adaptive bitrate
- [ ] Call recording
- [ ] Multi-party call support

### Phase 5 (Current - In Progress)
- [x] STT adapter interface (pluggable provider abstraction)
- [x] MockSTTAdapter for testing
- [x] STTService for transcription flow management
- [x] TurnProcessorService for end-to-end turn processing
- [x] TurnCompletionEvent and TTSAudioEvent bridges
- [ ] Real STT adapter implementation (Whisper/Vosk)
- [ ] End-to-end integration: VAD → STT → OpenClaw → TTS
- [ ] TurnProcessor integration with VoiceCallHandler
- [ ] Unit tests for STT and TurnProcessor services

### Future Phases
- [ ] WebRTC peer connection establishment
- [ ] Real audio capture/playback
- [ ] TTS audio response via WebRTC data channel
- [ ] Multi-party call support

## Version History

- **v0.5.0** (Current): Phase 5 - Turn Processing Pipeline (In Progress)
  - STT adapter interface (pluggable STT provider abstraction)
  - MockSTTAdapter for testing and development
  - STTService for transcription flow management
  - TurnProcessorService for end-to-end turn processing (VAD → STT → OpenClaw → TTS)
  - TurnCompletionEvent and TTSAudioEvent for pipeline bridging
  - Integration hooks in VoiceCallHandler for audio pipeline
  - 144 unit tests passing (31 VAD + 19 audio pipeline + 94 existing)
  - Build pipeline passing

- **v0.4.0**: Phase 4 - VAD Integration (completed)
  - Audio pipeline service for frame processing
  - Voice Activity Detection (VAD) service with energy-based speech detection
  - Turn detection with unique turn IDs and state machine
  - Frame-based timing for reliable testability
  - Configurable VAD thresholds (energy, silence, min speech duration)
  - VAD statistics (frame counter, speech duration, turns completed)
  - 144 unit tests passing (31 VAD + 19 audio pipeline + 94 existing)
  - Build pipeline passing

- **v0.3.0**: Phase 3 - LiveKit Integration (completed)
  - LiveKit service for room/token management
  - Matrix-LiveKit adapter bridge
  - Async method signature fixes (generateToken, getUserId)
  - Unit tests (94 passing)
  - Build pipeline passing

- **v0.2.0**: Phase 2 - Call media plumbing
  - Matrix call event handling
  - Call session management
  - Text-simulated voice calls
  - Unit tests (50 passing)

- **v0.1.0**: Initial MVP
  - Text-based voice simulation
  - OpenClaw API integration
  - Chatterbox TTS

## License

MIT
