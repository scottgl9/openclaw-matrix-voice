# OpenClaw Matrix Voice

Matrix bot with voice call support using Matrix SDK, LiveKit, Whisper STT, and Chatterbox TTS.

## Status: Phase 6 - LiveKit Agent + Whisper STT (Complete)

This project implements real Matrix voice call support in phases:

### Phase 2 (Completed)
- Matrix call event handling (`m.call.invite`, `m.call.media`, `m.call.hangup`)
- Call session management and text-simulated fallback

### Phase 3 (Completed)
- LiveKit service: Room management and token generation
- Build & test pipeline passing

### Phase 4 (Completed)
- Voice Activity Detection (VAD): Energy-based speech detection, turn segmentation
- Audio pipeline service with loopback testing
- Configurable thresholds (energy, silence, min speech duration)

### Phase 5 (Completed)
- STT adapter interface (pluggable provider abstraction)
- Turn processor: VAD -> STT -> OpenClaw -> TTS pipeline
- MockSTTAdapter for testing

### Phase 6 (Current - Complete)
- **Whisper STT adapter**: Real transcription via faster-whisper-server / whisper.cpp
- **LiveKit agent service**: Bot joins LiveKit rooms as a real-time participant via `@livekit/rtc-node`
- **Pluggable audio transport**: LiveKit ingress/egress replace loopback for real calls
- **MatrixRTC event detection**: Auto-join calls when `m.call.member` state events are received
- **Audio resampler**: PCM16 linear interpolation (48kHz <-> 16kHz <-> 22050Hz)
- **VAD improvements**: Adaptive threshold calibration and hangover smoothing
- **Removed legacy code**: `MatrixCallMediaService`, `MatrixLiveKitAdapter` (replaced by LiveKit agent)
- **144 unit tests passing** across 11 test files

---

## What's Functional Now

### End-to-End Voice Pipeline
```
User speaks in LiveKit room
  -> LiveKitAgentService receives audio frames (48kHz)
  -> Resample to 16kHz -> AudioPipeline ingress
  -> VAD detects speech turns
  -> TurnProcessor: Whisper STT -> OpenClaw LLM -> Chatterbox TTS
  -> Resample TTS output to 48kHz -> LiveKit publish
  -> User hears bot response in real time
```

### Text-Simulated Path (Fallback)
- `/call start` - Begin text-simulated call
- Reply to bot messages with text
- OpenClaw processes -> TTS generates audio -> uploaded to Matrix room

### MatrixRTC Auto-Join
- Bot detects `m.call.member` state events with LiveKit focus
- Automatically generates token and joins the LiveKit room
- Processes audio through the full pipeline

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Voice Call Handler                         │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ Text-Simulated   │  │    LiveKit Real-Time Path         │  │
│  │ (Fallback)       │  │                                   │  │
│  │ /call start      │  │  MatrixRTC m.call.member event   │  │
│  │ text -> OpenClaw  │  │  or /call start livekit          │  │
│  │ -> TTS -> Matrix  │  │  -> LiveKitAgentService          │  │
│  └──────────────────┘  │  -> AudioPipeline (LiveKit I/O)   │  │
│                         │  -> VAD -> STT -> OpenClaw -> TTS │  │
│                         │  -> LiveKit publish               │  │
│                         └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### Start a Text-Simulated Call
```
/call start
```
Then reply to the bot's message with your voice input (simulated via text).

### Start a LiveKit Voice Call
```
/call start livekit
```
Or join a voice call in Element - the bot auto-joins via MatrixRTC.

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
│   └── voice-call-handler.ts      # Main call flow handler + MatrixRTC
├── services/
│   ├── matrix-client-service.ts    # Matrix client wrapper
│   ├── livekit-service.ts          # LiveKit room/token management
│   ├── livekit-agent-service.ts    # Bot as LiveKit room participant
│   ├── livekit-audio-transport.ts  # AudioIngress/Egress for LiveKit
│   ├── audio-pipeline.ts           # Pluggable audio frame pipeline
│   ├── audio-resampler.ts          # PCM16 sample rate conversion
│   ├── vad-service.ts              # Voice Activity Detection
│   ├── stt-adapter.ts              # STT interface + MockSTTAdapter
│   ├── whisper-stt-adapter.ts      # Whisper STT via HTTP API
│   ├── turn-processor.ts           # VAD -> STT -> OpenClaw -> TTS
│   ├── openclaw-service.ts         # OpenClaw LLM API
│   └── chatterbox-tts-service.ts   # Chatterbox TTS API
├── config/
│   └── index.ts                    # Configuration
└── index.ts                        # Entry point

tests/
├── voice-call-handler.test.ts
├── livekit-service.test.ts
├── livekit-agent-service.test.ts
├── audio-pipeline.test.ts
├── audio-resampler.test.ts
├── vad-service.test.ts
├── stt-adapter.test.ts
├── whisper-stt-adapter.test.ts
├── turn-processor.test.ts
├── openclaw-service.test.ts
└── chatterbox-tts-service.test.ts
```

## Development

### Prerequisites
- Node.js 18+
- Matrix account with access token
- OpenClaw API access
- Chatterbox TTS server
- (Optional) faster-whisper-server or whisper.cpp for real STT
- (Optional) LiveKit server for real-time voice

### Setup
```bash
npm install
cp .env.example .env  # Fill in your credentials
```

### Environment Variables
```bash
# Required
MATRIX_USER_ID=@bot:matrix.org
MATRIX_ACCESS_TOKEN=syt_...
OPENCLAW_API_TOKEN=...

# TTS
CHATTERBOX_TTS_URL=http://localhost:8000/tts

# LiveKit (optional - for real-time voice)
LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# Whisper STT (optional - for real transcription)
WHISPER_URL=http://localhost:8080
WHISPER_MODEL=whisper-1
WHISPER_LANGUAGE=en
```

### Build & Test
```bash
npm run build   # TypeScript compilation
npm test        # Run 144 tests with Vitest
```

### Run
```bash
npm start       # Production
npm run dev     # Development with tsx
```

## Dependencies

- `matrix-bot-sdk` - Matrix protocol client
- `livekit-server-sdk` - LiveKit room/token management
- `@livekit/rtc-node` - LiveKit real-time participant SDK
- `axios` - HTTP client
- `wavefile` - WAV file creation for Whisper API
- `dotenv` - Environment configuration

## License

MIT
