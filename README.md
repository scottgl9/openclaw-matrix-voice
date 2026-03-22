# openclaw-matrix-voice

A Matrix voice bot that joins Element Call rooms, listens via speech-to-text, routes through the [OpenClaw](https://openclaw.ai) AI gateway, and responds with synthesized speech.

---

## Features

- **Real-time voice calls** — joins MatrixRTC/LiveKit rooms as a participant; speaks and listens
- **Speech-to-text** — pluggable STT adapter; ships with a Whisper HTTP adapter (compatible with faster-whisper servers)
- **Text-to-speech** — Chatterbox TTS and Kokoro TTS supported out of the box
- **OpenClaw agent routing** — routes turns through any configured OpenClaw agent via the standard `/v1/chat/completions` endpoint
- **Voice Activity Detection** — energy-based VAD with echo suppression (suppresses VAD during TTS playback to prevent the bot hearing itself)
- **Silent response control** — agent returns `[SILENT]` to stay quiet; gateway `NO_REPLY` fallback also suppressed
- **Conversation history** — sliding window context window per call session
- **Element Call visibility** — publishes a dummy video track and correct `org.matrix.msc3401.call.member` state events so the bot appears as a participant tile
- **Latency profiling** — STT / LLM / TTS / Total ms logged per turn with grade (EXCELLENT / GOOD / ACCEPTABLE / SLOW)
- **Health endpoint** — `GET /health` for service monitoring

---

## Requirements

- Node.js 18+
- Matrix homeserver with a dedicated bot account
- OpenClaw gateway running locally
- LiveKit server (e.g. `lk` CLI or self-hosted)
- Whisper-compatible STT server (faster-whisper, whisper.cpp, etc.)
- TTS server (Chatterbox or Kokoro)

---

## Quick Start

```bash
git clone <repo>
cd openclaw-matrix-voice
npm install
cp .env.example .env   # edit with your values
npm run build
npm start
```

---

## Configuration

All configuration is via environment variables (`.env` file or shell).

### Required

| Variable | Description |
|---|---|
| `MATRIX_HOMESERVER` | Matrix homeserver URL, e.g. `https://matrix.example.com` |
| `MATRIX_USER_ID` | Bot's Matrix user ID, e.g. `@crowbar:matrix.example.com` |
| `MATRIX_ACCESS_TOKEN` | Bot's Matrix access token |
| `OPENCLAW_API_URL` | OpenClaw gateway URL, e.g. `http://localhost:18789` |
| `OPENCLAW_API_TOKEN` | OpenClaw gateway auth token |

### Voice Agent

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_AGENT_ID` | `main` | OpenClaw agent ID to route voice turns through |
| `OPENCLAW_SYSTEM_PROMPT` | _(none)_ | System prompt injected at the start of every turn |
| `MAX_CONVERSATION_HISTORY` | `20` | Max messages kept in conversation context per call |

### STT (Whisper)

| Variable | Default | Description |
|---|---|---|
| `WHISPER_URL` | `http://localhost:8090` | Whisper-compatible STT server URL |
| `WHISPER_MODEL` | `turbo` | Model name sent in the request |
| `WHISPER_LANGUAGE` | `en` | Language hint |

### TTS

| Variable | Default | Description |
|---|---|---|
| `CHATTERBOX_TTS_URL` | `http://localhost:8000/tts` | Chatterbox TTS endpoint |
| `KOKORO_TTS_URL` | _(unset)_ | Kokoro TTS endpoint (takes precedence over Chatterbox when set) |
| `KOKORO_VOICE` | `af_bella` | Kokoro voice name |

### LiveKit

| Variable | Default | Description |
|---|---|---|
| `LIVEKIT_ENABLED` | `true` | Enable LiveKit / MatrixRTC voice support |
| `LIVEKIT_URL` | `ws://localhost:7880` | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | `devkey` | LiveKit API key |
| `LIVEKIT_API_SECRET` | `devsecret` | LiveKit API secret |

### Server

| Variable | Default | Description |
|---|---|---|
| `SERVER_PORT` | `3002` | Health server port |
| `SERVER_HOST` | `0.0.0.0` | Health server bind address |

---

## How It Works

```
User joins Element Call room (MatrixRTC/LiveKit)
  → Bot detects org.matrix.msc3401.call.member state event
  → Bot joins LiveKit room as a participant
  → Audio frames (48kHz) resampled to 16kHz
  → VAD detects speech turns; echo suppression active during TTS playback
  → Whisper STT transcribes the turn
  → OpenClaw gateway /v1/chat/completions → agent response
      → [SILENT] or NO_REPLY  → skip TTS, bot stays quiet
      → Normal response        → TTS synthesis → resample to 48kHz → LiveKit publish
  → User hears the response
```

---

## Silent Responses

The agent can choose to stay silent instead of speaking. Return exactly `[SILENT]` as the full response and the bot will skip TTS and play no audio.

The gateway's empty-response fallback (`"No response from OpenClaw."`) is also treated as silent and never spoken aloud.

This is useful for:
- Garbled or unintelligible transcriptions
- Ambient noise picked up by VAD
- Multi-speaker situations where the bot wasn't addressed

---

## Project Structure

```
src/
├── handlers/
│   └── voice-call-handler.ts       # Call lifecycle + MatrixRTC events
├── services/
│   ├── matrix-client-service.ts    # Matrix SDK wrapper
│   ├── openclaw-service.ts         # OpenClaw chat completions + silence detection
│   ├── livekit-service.ts          # LiveKit room/token management
│   ├── livekit-agent-service.ts    # Bot as LiveKit participant (audio in/out)
│   ├── livekit-audio-transport.ts  # AudioIngress/Egress for LiveKit
│   ├── audio-pipeline.ts           # Pluggable audio frame pipeline
│   ├── audio-resampler.ts          # PCM16 sample rate conversion
│   ├── vad-service.ts              # Voice Activity Detection
│   ├── stt-adapter.ts              # STT interface
│   ├── whisper-stt-adapter.ts      # Whisper STT via HTTP
│   ├── turn-processor.ts           # VAD → STT → LLM → TTS pipeline
│   ├── chatterbox-tts-service.ts   # Chatterbox TTS
│   ├── health-server.ts            # Health check endpoint
│   └── call-store.ts               # Call session persistence
├── config/
│   └── index.ts                    # Env config + validation
├── utils/
│   ├── logger.ts
│   ├── rate-limiter.ts
│   └── retry.ts
└── index.ts
server/
├── whisper_server.py               # faster-whisper HTTP server
├── kokoro_server.py                # Kokoro TTS HTTP server
└── parakeet_server.py              # NVIDIA Parakeet STT server (optional)
```

---

## Development

```bash
npm run build       # TypeScript compile
npm run dev         # Run with tsx (no compile step)
npm test            # Vitest
npm run test:watch  # Watch mode
```

---

## Further Reading

- [LiveKit Setup](LIVEKIT_SETUP.md)
- [TTS Setup](TTS_SETUP.md)
- [Services Guide](SERVICES_GUIDE.md)

---

## License

MIT
