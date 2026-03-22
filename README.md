# openclaw-matrix-voice

A Matrix voice bot that joins Element Call rooms, listens via speech-to-text, routes through the [OpenClaw](https://openclaw.ai) AI gateway, and responds with synthesized speech.

---

## Features

- **Real-time voice calls** — joins MatrixRTC/LiveKit rooms as a participant; speaks and listens
- **Multi-agent routing** — route different Matrix rooms to different OpenClaw agents (e.g. work vs personal)
- **Per-agent identity** — configurable names and system prompts per agent
- **Speech-to-text** — pluggable STT adapter; ships with Whisper and NVIDIA Parakeet adapters
- **Text-to-speech** — Chatterbox TTS, Kokoro TTS, and Orpheus TTS supported
- **OpenClaw agent routing** — routes turns through any configured OpenClaw agent via the standard `/v1/chat/completions` endpoint
- **Voice Activity Detection** — energy-based VAD with echo suppression (suppresses VAD during TTS playback to prevent the bot hearing itself)
- **Silent response control** — agent returns `[SILENT]` to stay quiet; gateway `NO_REPLY` fallback also suppressed
- **Conversation history** — per-agent sliding window context per call session
- **Element Call visibility** — publishes a dummy video track and correct `org.matrix.msc3401.call.member` state events so the bot appears as a participant tile
- **Latency profiling** — STT / LLM / TTS / Total ms logged per turn with grade (EXCELLENT / GOOD / ACCEPTABLE / SLOW)
- **Health endpoint** — `GET /health` for service monitoring

---

## Requirements

- Node.js 20+
- Matrix homeserver with a dedicated bot account
- OpenClaw gateway running locally
- LiveKit server (self-hosted or cloud)
- Whisper-compatible STT server (faster-whisper, whisper.cpp, etc.) or NVIDIA Parakeet
- TTS server (Chatterbox, Kokoro, or Orpheus)

---

## Quick Start

```bash
git clone https://github.com/scottgl9/openclaw-matrix-voice.git
cd openclaw-matrix-voice
npm install
cp .env.example .env   # edit with your values
npm run build
npm start
```

For a detailed walkthrough including Matrix room setup, Element Call configuration, and systemd deployment, see [docs/SETUP.md](docs/SETUP.md).

---

## Configuration

All configuration is via environment variables (`.env` file or shell). See [.env.example](.env.example) for all options.

### Required

| Variable | Description |
|---|---|
| `MATRIX_HOMESERVER` | Matrix homeserver URL |
| `MATRIX_USER_ID` | Bot's Matrix user ID |
| `MATRIX_ACCESS_TOKEN` | Bot's Matrix access token |
| `OPENCLAW_API_URL` | OpenClaw gateway URL (default: `http://localhost:18789`) |
| `OPENCLAW_API_TOKEN` | OpenClaw gateway auth token |

### Multi-Agent Voice Routing

Route different Matrix rooms to different OpenClaw agents:

| Variable | Default | Description |
|---|---|---|
| `VOICE_AGENT_DEFAULT` | `OPENCLAW_AGENT_ID` | Default agent when room is not in the map |
| `VOICE_AGENT_MAP` | `{}` | JSON map: Matrix room ID → OpenClaw agent ID |
| `VOICE_AGENT_NAMES` | `{}` | JSON map: agent ID → display name (appended to system prompt) |
| `VOICE_AGENT_PROMPTS` | `{}` | JSON map: agent ID → full system prompt (overrides names) |

Example:
```env
VOICE_AGENT_DEFAULT=personal-voice-agent
VOICE_AGENT_MAP={"!workRoom:server":"work-voice-agent","!personalRoom:server":"personal-voice-agent"}
VOICE_AGENT_NAMES={"work-voice-agent":"Nova","personal-voice-agent":"Echo"}
```

### Voice Agent

| Variable | Default | Description |
|---|---|---|
| `OPENCLAW_AGENT_ID` | `personal-agent` | Fallback OpenClaw agent ID (used when `VOICE_AGENT_DEFAULT` not set) |
| `OPENCLAW_SYSTEM_PROMPT` | _(built-in)_ | Default system prompt (overridden by `VOICE_AGENT_PROMPTS` per agent) |
| `MAX_CONVERSATION_HISTORY` | `20` | Max messages kept in conversation context per agent per call |

### STT

| Variable | Default | Description |
|---|---|---|
| `WHISPER_URL` | _(unset)_ | Whisper-compatible STT server URL |
| `WHISPER_MODEL` | `turbo` | Model name sent in the request |
| `WHISPER_LANGUAGE` | `en` | Language hint |

### TTS

| Variable | Default | Description |
|---|---|---|
| `CHATTERBOX_TTS_URL` | `http://localhost:8000/tts` | Chatterbox TTS endpoint |
| `KOKORO_TTS_URL` | _(unset)_ | Kokoro TTS endpoint (takes precedence when set) |
| `KOKORO_VOICE` | `af_bella` | Kokoro voice name |

### LiveKit

| Variable | Default | Description |
|---|---|---|
| `LIVEKIT_ENABLED` | `true` | Enable LiveKit / MatrixRTC voice support |
| `LIVEKIT_URL` | `ws://localhost:7880` | LiveKit server WebSocket URL |
| `LIVEKIT_API_KEY` | _(required)_ | LiveKit API key |
| `LIVEKIT_API_SECRET` | _(required)_ | LiveKit API secret |
| `LIVEKIT_JWT_SERVICE_URL` | _(unset)_ | LiveKit JWT service URL for Element Call |

### VAD Tuning

| Variable | Default | Description |
|---|---|---|
| `VAD_ENERGY_THRESHOLD` | `0.3` | Energy threshold (0-1), higher = less sensitive |
| `VAD_SILENCE_THRESHOLD_MS` | `900` | Silence duration before utterance ends |
| `VAD_ADAPTIVE_THRESHOLD` | `false` | Adapt to background noise |
| `BARGE_IN_ENABLED` | `false` | Allow interrupting bot speech |

---

## How It Works

```
User joins Element Call room (MatrixRTC/LiveKit)
  → Bot detects org.matrix.msc3401.call.member state event
  → Bot resolves OpenClaw agent from room ID (via VOICE_AGENT_MAP)
  → Bot joins LiveKit room as a participant
  → Audio frames (48kHz) resampled to 16kHz
  → VAD detects speech turns; echo suppression active during TTS playback
  → Whisper/Parakeet STT transcribes the turn
  → OpenClaw gateway /v1/chat/completions → agent response
      → [SILENT] or NO_REPLY  → skip TTS, bot stays quiet
      → Normal response        → TTS synthesis → resample to 48kHz → LiveKit publish
  → User hears the response
```

---

## Multi-Agent Architecture

```
Matrix Room A ──▶ VOICE_AGENT_MAP ──▶ work-voice-agent (Nova)
Matrix Room B ──▶ VOICE_AGENT_MAP ──▶ personal-voice-agent (Echo)
Unknown Room  ──▶ VOICE_AGENT_DEFAULT ──▶ fallback agent
```

Each agent has its own:
- Conversation history (cleared on call end)
- System prompt (via `VOICE_AGENT_NAMES` or `VOICE_AGENT_PROMPTS`)
- OpenClaw agent config (model, tools, personality, workspace)

Only one call is active at a time. Ending a call and starting another in a different room switches agents cleanly.

---

## Systemd Services

Service files are in `server/`:

```bash
# Install (copy to user systemd dir)
cp server/openclaw-matrix-voice.service ~/.config/systemd/user/
cp server/parakeet-stt.service ~/.config/systemd/user/       # optional
cp server/kokoro-tts.service ~/.config/systemd/user/         # optional
cp server/orpheus-tts.service ~/.config/systemd/user/        # optional

# Enable and start
systemctl --user daemon-reload
systemctl --user enable --now openclaw-matrix-voice
```

---

## Project Structure

```
src/
├── handlers/
│   └── voice-call-handler.ts       # Call lifecycle, MatrixRTC events, agent routing
├── services/
│   ├── openclaw-service.ts         # Multi-agent chat completions + silence detection
│   ├── livekit-service.ts          # LiveKit room/token management
│   ├── livekit-agent-service.ts    # Bot as LiveKit participant (audio in/out)
│   ├── livekit-audio-transport.ts  # AudioIngress/Egress for LiveKit
│   ├── audio-pipeline.ts           # Pluggable audio frame pipeline
│   ├── audio-resampler.ts          # PCM16 sample rate conversion
│   ├── vad-service.ts              # Voice Activity Detection
│   ├── turn-processor.ts           # VAD → STT → LLM → TTS pipeline
│   ├── stt-adapter.ts              # STT interface
│   ├── whisper-stt-adapter.ts      # Whisper STT via HTTP
│   ├── chatterbox-tts-service.ts   # Chatterbox TTS
│   ├── matrix-client-service.ts    # Matrix SDK wrapper
│   ├── health-server.ts            # Health check endpoint
│   ├── participant-audio-mux.ts    # Multi-participant audio mixing
│   └── call-store.ts               # Call session persistence
├── config/
│   └── index.ts                    # Env config + validation
├── utils/
│   ├── logger.ts
│   ├── rate-limiter.ts
│   └── retry.ts
└── index.ts
server/
├── parakeet_server.py              # NVIDIA Parakeet STT server
├── kokoro_server.py                # Kokoro TTS server
├── orpheus_server.py               # Orpheus TTS server
├── openclaw-matrix-voice.service   # Main bot systemd service
├── parakeet-stt.service            # Parakeet STT systemd service
├── kokoro-tts.service              # Kokoro TTS systemd service
└── orpheus-tts.service             # Orpheus TTS systemd service
docs/
├── SETUP.md                        # Full setup guide
├── LIVEKIT_SETUP.md                # LiveKit server setup
├── TTS_SETUP.md                    # TTS server setup
└── SERVICES_GUIDE.md               # Supporting services guide
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

- [Full Setup Guide](docs/SETUP.md)
- [LiveKit Setup](docs/LIVEKIT_SETUP.md)
- [TTS Setup](docs/TTS_SETUP.md)
- [Services Guide](docs/SERVICES_GUIDE.md)

---

## License

MIT
