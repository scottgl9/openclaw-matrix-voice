# OpenClaw Matrix Voice

Matrix bot with voice call support using Matrix SDK, LiveKit, Whisper STT, and Chatterbox TTS.
Integrates with the [OpenClaw](https://openclaw.ai) gateway for LLM responses via the OpenAI-compatible chat completions API.

## Status: Phase 7 - Live Gateway Integration

### Recent (Phase 7)
- **OpenClaw gateway integration**: Uses `/v1/chat/completions` endpoint with conversation history
- **Local Whisper STT**: Bundled `faster-whisper` server for CPU-based speech-to-text
- **Text-simulated voice calls**: Send messages in Matrix during active calls, bot responds via OpenClaw
- **Matrix bot registered**: Dedicated `@voice-bot` account for voice call handling

### Phase 6 (Complete)
- Whisper STT adapter, LiveKit agent service, pluggable audio transport
- MatrixRTC auto-join, audio resampler, VAD improvements
- 144 unit tests passing

### Earlier Phases
- Matrix call event handling, call session management
- LiveKit room/token management
- VAD with energy-based speech detection and turn segmentation
- STT adapter interface, turn processor pipeline

---

## Quick Start

### Prerequisites
- Node.js 18+
- Matrix homeserver with a bot account
- OpenClaw gateway running (default: `http://localhost:18789`)
- (Optional) LiveKit server for real-time voice calls
- (Optional) TTS service for audio responses

### Setup
```bash
npm install
cp .env.example .env  # Or create .env manually (see below)
npm run build
```

### Environment Variables
```bash
# OpenClaw Gateway (required)
OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_TOKEN=your-gateway-token

# Matrix (required)
MATRIX_HOMESERVER=https://your-homeserver.example.com
MATRIX_USER_ID=@voice-bot:your-homeserver.example.com
MATRIX_ACCESS_TOKEN=syt_...

# Whisper STT (optional - local faster-whisper server)
WHISPER_URL=http://localhost:8090
WHISPER_MODEL=tiny
WHISPER_LANGUAGE=en

# TTS (optional)
CHATTERBOX_TTS_URL=http://localhost:8000/tts

# LiveKit (optional - for real-time voice)
LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret

# Server
SERVER_PORT=3002
SERVER_HOST=0.0.0.0
```

### Run
```bash
npm run dev     # Development with tsx
npm start       # Production (compiled)
```

### Local Whisper STT Server
A bundled faster-whisper server is included for local speech-to-text:

```bash
# Create venv and install dependencies
python3 -m venv ~/.local/share/whisper-venv
~/.local/share/whisper-venv/bin/pip install faster-whisper flask

# Run (downloads tiny model on first start)
WHISPER_MODEL_SIZE=tiny WHISPER_PORT=8090 \
  ~/.local/share/whisper-venv/bin/python3 infra/whisper-server/server.py
```

Models: `tiny` (fast, less accurate), `base`, `small`, `medium`, `large-v3` (slow, most accurate).

### OpenClaw Gateway Setup
The bot uses OpenClaw's `/v1/chat/completions` endpoint. Enable it in `~/.openclaw/openclaw.json`:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

Then restart the gateway: `openclaw gateway start`

## How It Works

### Text-Simulated Call Flow
```
User sends "/call start" in Matrix room
  -> Bot activates call session
  -> User sends text messages
  -> OpenClaw gateway /v1/chat/completions -> LLM response
  -> (If TTS available) Chatterbox TTS -> audio uploaded to Matrix
  -> (If TTS unavailable) Text response sent to Matrix
```

### Real-Time Voice Call Flow (LiveKit)
```
User joins voice call in Element (MatrixRTC)
  -> Bot detects m.call.member state event
  -> LiveKitAgentService joins room as participant
  -> Audio frames (48kHz) -> resample to 16kHz
  -> VAD detects speech turns
  -> Whisper STT -> text
  -> OpenClaw gateway -> LLM response
  -> Chatterbox TTS -> audio
  -> Resample to 48kHz -> LiveKit publish
  -> User hears bot response
```

## Matrix Commands
- `/call start` - Start a text-simulated voice call
- `/call start livekit` - Start a LiveKit voice call
- `/call end` - End a voice call
- `/call status` - Show call status

## Project Structure

```
src/
├── handlers/
│   └── voice-call-handler.ts      # Call lifecycle + MatrixRTC
├── services/
│   ├── matrix-client-service.ts    # Matrix client wrapper
│   ├── openclaw-service.ts         # OpenClaw chat completions client
│   ├── livekit-service.ts          # LiveKit room/token management
│   ├── livekit-agent-service.ts    # Bot as LiveKit participant
│   ├── livekit-audio-transport.ts  # AudioIngress/Egress for LiveKit
│   ├── audio-pipeline.ts           # Pluggable audio frame pipeline
│   ├── audio-resampler.ts          # PCM16 sample rate conversion
│   ├── vad-service.ts              # Voice Activity Detection
│   ├── stt-adapter.ts              # STT interface + MockSTTAdapter
│   ├── whisper-stt-adapter.ts      # Whisper STT via HTTP API
│   ├── turn-processor.ts           # VAD -> STT -> LLM -> TTS
│   ├── chatterbox-tts-service.ts   # Chatterbox TTS API
│   ├── health-server.ts            # Health check endpoint
│   └── call-store.ts               # Call session persistence
├── config/
│   └── index.ts                    # Environment config + validation
├── utils/
│   ├── logger.ts                   # Structured logging
│   ├── rate-limiter.ts             # Token bucket rate limiter
│   └── retry.ts                    # Retry with backoff
└── index.ts                        # Entry point

infra/
├── whisper-server/
│   └── server.py                   # Local faster-whisper HTTP server
└── mock-whisper/
    └── server.mjs                  # Mock Whisper for testing
```

## Development

```bash
npm run build       # TypeScript compilation
npm test            # Run tests with Vitest
npm run test:watch  # Watch mode
```

## License

MIT
