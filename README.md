# OpenClaw Matrix Voice

Matrix bot with voice call support using the Matrix SDK and LiveKit.

## Status: Phase 3 - LiveKit Integration (In Progress)

This project is implementing real Matrix voice call support in phases:

### Phase 2 (Completed ✓)
- **Call Event Plumbing**: Full handling of Matrix call events (`m.call.invite`, `m.call.media`, `m.call.hangup`)
- **Call Session Management**: Track call state (invited, connecting, connected, ended)
- **Inbound Call Handling**: Auto-accept incoming calls with `m.call.answer`
- **Outbound Call Initiation**: Send `m.call.invite` to start calls
- **Call Media Routing**: Route audio events to processing pipeline
- **Text-Simulated Fallback**: Preserve existing text-based voice call flow
- **Unit Tests**: 50 tests covering all functionality

### Phase 3 (Current - In Progress)
- **LiveKit Service**: Room management and token generation for LiveKit server
- **Matrix-LiveKit Adapter**: Bridge between Matrix calls and LiveKit rooms
- **Async Method Fixes**: Resolved adapter/service method signature mismatches
- **Unit Tests**: 94 tests covering all functionality (including LiveKit)
- **Build & Test Pipeline**: TypeScript compilation and test suite passing

### Phase 3 (Remaining)
- **WebRTC Peer Connection**: Establish RTCPeerConnection for real-time media
- **Audio Capture**: Capture microphone audio via WebRTC MediaStream
- **Audio Playback**: Play remote audio through WebRTC remote stream
- **STT Integration**: Connect Whisper/Vosk for speech-to-text
- **TTS Audio Response**: Send TTS audio back via WebRTC data channel

### Phase 4 (Future)
- **Echo Cancellation**: AEC for full-duplex conversation
- **Noise Suppression**: NS for cleaner audio
- **Adaptive Bitrate**: Dynamic quality adjustment
- **Call Recording**: Optional call recording with user consent

---

## What's Functional Now (Phase 3 - In Progress)

### LiveKit Integration Layer (Partial)
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
- ✗ STT integration pending
- ✗ LiveKit server connection requires configuration

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

## Current Limitations (Phase 2)

1. **No Real-Time Audio**: Audio capture and playback are not yet implemented
2. **No WebRTC**: Peer connections are not established
3. **No STT**: Speech-to-text requires manual integration
4. **Text Placeholder**: Real audio responses are sent as text placeholders

## Roadmap

### Phase 3 (Current - In Progress)
- [x] LiveKit service integration (room management, token generation)
- [x] Matrix-LiveKit adapter with event emission
- [x] Async method signature fixes across adapter/service
- [x] Unit tests for LiveKit components (94 total tests passing)
- [ ] WebRTC peer connection establishment
- [ ] Audio stream capture (microphone)
- [ ] Audio stream playback (speaker)
- [ ] STT service integration (Whisper/Vosk)
- [ ] TTS audio response via WebRTC

### Phase 4 (Future)
- [ ] Echo cancellation
- [ ] Noise suppression
- [ ] Adaptive bitrate
- [ ] Call recording
- [ ] Multi-party call support

## License

MIT
