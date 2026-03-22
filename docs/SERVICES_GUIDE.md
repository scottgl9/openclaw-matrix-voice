# Services Setup Guide

Complete guide to getting all services running for OpenClaw Matrix Voice.

## Architecture overview

```
Matrix Client (Element) <-> Matrix Homeserver <-> Bot (this project)
                                                    |
                              OpenClaw Gateway ─────┘──── Whisper STT
                                                    |          |
                                              LiveKit Server   TTS Service
```

---

## 1. Matrix Homeserver + Bot Account

You need a Matrix homeserver and a dedicated bot account.

### Create the bot account

Using Synapse admin API or `register_new_matrix_user`:

```bash
register_new_matrix_user -c /etc/synapse/homeserver.yaml http://localhost:8008
# Username: voice-bot
# Make admin: no
```

### Get an access token

```bash
curl -X POST https://your-homeserver.example.com/_matrix/client/v3/login \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"voice-bot","password":"YOUR_PASSWORD"}'
```

Save the `access_token` from the response.

### Env config

```bash
MATRIX_HOMESERVER=https://your-homeserver.example.com
MATRIX_USER_ID=@voice-bot:your-homeserver.example.com
MATRIX_ACCESS_TOKEN=syt_...
```

---

## 2. OpenClaw Gateway

The bot uses OpenClaw's OpenAI-compatible `/v1/chat/completions` endpoint.

### Enable chat completions

Edit `~/.openclaw/openclaw.json`:

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

### Start the gateway

```bash
openclaw gateway start
```

### Verify

```bash
curl http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"stream":false}'
```

### Env config

```bash
OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_TOKEN=your-gateway-token
```

---

## 3. Whisper STT (Local faster-whisper)

A bundled faster-whisper HTTP server provides speech-to-text.

### Setup

```bash
python3 -m venv ~/.local/share/whisper-venv
~/.local/share/whisper-venv/bin/pip install faster-whisper flask
```

### Run

```bash
WHISPER_MODEL_SIZE=tiny WHISPER_PORT=8090 \
  ~/.local/share/whisper-venv/bin/python3 infra/whisper-server/server.py
```

Models (speed vs accuracy): `tiny` > `base` > `small` > `medium` > `large-v3`

### Verify

```bash
curl -X POST http://localhost:8090/v1/audio/transcriptions \
  -F "file=@test.wav" -F "model=tiny"
```

### Env config

```bash
WHISPER_URL=http://localhost:8090
WHISPER_MODEL=tiny
WHISPER_LANGUAGE=en
```

---

## 4. TTS Service

See [TTS_SETUP.md](TTS_SETUP.md) for detailed setup of Chatterbox, Piper, or Edge TTS.

### Quick start (Chatterbox)

```bash
python3 -m venv ~/.local/share/chatterbox-venv
~/.local/share/chatterbox-venv/bin/pip install chatterbox-tts flask
# Run server (see TTS_SETUP.md for server.py)
```

### Env config

```bash
CHATTERBOX_TTS_URL=http://localhost:8000/tts
```

---

## 5. LiveKit Server (Optional — for real-time voice)

See [LIVEKIT_SETUP.md](LIVEKIT_SETUP.md) for full setup with Docker Compose.

### Quick start

```bash
cd infra/livekit
docker compose up -d
```

### Env config

```bash
LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
```

---

## 6. Voice-Optimized Agent Configuration

The bot includes a default system prompt optimized for voice:

> "You are a helpful voice assistant. Keep responses brief and conversational — 1-2 sentences max. Avoid markdown, bullet points, or formatted text. Speak naturally as if in a phone call."

### Customize

Override via environment variable:

```bash
OPENCLAW_SYSTEM_PROMPT="You are a friendly customer support agent. Keep answers short and clear."
```

### History limits

Control how many messages the bot remembers per conversation:

```bash
MAX_CONVERSATION_HISTORY=20   # default: 20 messages (user + assistant)
```

---

## 7. Is everything running?

### Checklist

| Service | Check command | Expected |
|---------|--------------|----------|
| Matrix homeserver | `curl https://your-homeserver/_matrix/client/versions` | JSON with versions |
| OpenClaw gateway | `curl http://localhost:18789/v1/models` | Model list or 200 |
| Whisper STT | `curl http://localhost:8090/health` | `{"status":"ok"}` or 200 |
| TTS service | `curl -X POST http://localhost:8000/tts -H 'Content-Type: application/json' -d '{"text":"test"}'` | WAV audio data |
| LiveKit | `curl http://localhost:7880/` | Response (may be empty 200) |
| Bot health | `curl http://localhost:3002/health` | `{"status":"ok"}` |

### Start the bot

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

### Test a call

1. Invite the bot to a Matrix room
2. Send `/call start` to begin a text-simulated call
3. Send any message — bot should respond via OpenClaw
4. Send `/call end` to stop

### Full voice call (requires LiveKit + STT + TTS)

1. Set `LIVEKIT_ENABLED=true` in `.env`
2. Start all services (LiveKit, Whisper, TTS)
3. Open Element Web (recommended), start a voice call in the room
4. Bot auto-joins via MatrixRTC and processes audio in real-time

> **Client compatibility:** Element X on macOS only supports Jitsi (`m.call` protocol) — it cannot connect to MatrixRTC/LiveKit bots. Use **Element Web** or **Element Desktop** (Electron) for full compatibility. Element X on Android may also work.

---

## 8. Troubleshooting Element Call Visibility

### Bot not showing as a participant tile

Element Call requires specific fields in the bot's `org.matrix.msc3401.call.member` state event. Missing any of these causes the bot to be silently invisible:

- **`m.call.intent: "video"`** — the most critical field; Element Call will not render participants without it
- **`session_id`** — required for participant identity matching
- **`membershipID`** — required in newer Element Call versions to map LiveKit participant → Matrix user
- **`feeds`** — declares what media the participant is publishing

### Bot not audible (but visible)

1. Check the browser's audio output device (Element Call sometimes defaults to wrong device)
2. Verify bot is publishing audio to LiveKit: check service logs for `TTS WAV: ...Hz, ...PCM bytes`
3. A dummy video track is required — Element Call will not subscribe to audio from participants with no video track

### Transcriptions returning empty string (`""`)

If the TypeScript VAD is already pre-gating audio before sending to Whisper, **do not** also enable `vad_filter=True` in faster-whisper. The double VAD causes Whisper to classify pre-gated speech clips as non-speech and discard them silently.

Check `whisper-server.py` on the STT host — ensure `vad_filter=False` (or omit the parameter).

### Bot hearing itself / echo loop

VAD echo suppression suppresses the microphone during bot TTS playback. If you're still getting echoes:
- Increase `VAD_ECHO_BUFFER_MS` (default: 300ms added to TTS playout duration)
- Check that `suppress()`/`unsuppress()` are being called around `publishAudioBuffer()`
