# Full Setup Guide — openclaw-matrix-voice

Complete guide to deploying the OpenClaw Matrix Voice Bot with LiveKit, Whisper STT, and Chatterbox TTS.

## Overview

The voice bot bridges Matrix voice calls to OpenClaw agents:

```
Element Call → LiveKit → Voice Bot → Whisper STT → OpenClaw Agent → Chatterbox TTS → LiveKit → Element Call
```

### Features
- Real-time voice conversations with OpenClaw agents
- Multi-agent support — route different Matrix rooms to different agents
- VAD (Voice Activity Detection) with barge-in support
- LiveKit-based audio transport (Element Call compatible)
- Whisper STT (local or remote)
- Chatterbox TTS (local)
- Systemd service for production deployment

---

## Prerequisites

- **Node.js** 20+ (recommended: via Homebrew/nvm)
- **OpenClaw** instance running with gateway API enabled
- **Matrix homeserver** (Synapse or Conduit) with admin access
- **LiveKit server** (see [LIVEKIT_SETUP.md](LIVEKIT_SETUP.md))
- **Whisper STT server** (OpenAI-compatible endpoint)
- **Chatterbox TTS server** (see [TTS_SETUP.md](TTS_SETUP.md))

---

## 1. Clone and Install

```bash
git clone https://github.com/scottgl9/openclaw-matrix-voice.git
cd openclaw-matrix-voice
npm install
npm run build
```

---

## 2. Create the Matrix Bot User

On your Matrix homeserver (Synapse admin API example):

```bash
HOMESERVER="https://your-homeserver.example.com"
ADMIN_TOKEN="your_admin_access_token"

# Create bot user
curl -X PUT "$HOMESERVER/_synapse/admin/v2/users/@voice-bot:your-homeserver.example.com" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password": "SecurePassword123", "admin": false, "displayname": "Voice Bot"}'

# Get access token via login
curl -X POST "$HOMESERVER/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{"type": "m.login.password", "user": "@voice-bot:your-homeserver.example.com", "password": "SecurePassword123"}'
```

Save the `access_token` from the login response.

---

## 3. Create Voice Call Rooms

Create a room for each voice agent you want:

```bash
TOKEN="bot_access_token"
HOMESERVER="https://your-homeserver.example.com"

# Create a voice room
curl -X POST "$HOMESERVER/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Personal Voice Bot",
    "topic": "Voice calls with Echo (personal-voice-agent)",
    "preset": "private_chat",
    "invite": ["@your-user:your-homeserver.example.com"],
    "creation_content": {"m.federate": false}
  }'
```

Save the `room_id` from the response.

### Configure Room for Element Call

Set power levels so all users can publish call state:

```bash
ROOM_ID="!your-room-id:your-homeserver.example.com"

curl -X PUT "$HOMESERVER/_matrix/client/v3/rooms/$ROOM_ID/state/m.room.power_levels/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "users": {
      "@your-user:server": 100,
      "@voice-bot:server": 100
    },
    "users_default": 0,
    "events": {
      "m.room.name": 50,
      "m.room.power_levels": 100,
      "org.matrix.msc3401.call.member": 0,
      "m.call.member": 0,
      "im.vector.modular.widgets": 0
    },
    "events_default": 0,
    "state_default": 50
  }'
```

Set the call configuration state:

```bash
curl -X PUT "$HOMESERVER/_matrix/client/v3/rooms/$ROOM_ID/state/org.matrix.msc3401.call/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"m.intent":"m.room","m.type":"m.voice","m.name":"Voice Call"}'
```

Publish the Element Call widget:

```bash
curl -X PUT "$HOMESERVER/_matrix/client/v3/rooms/$ROOM_ID/state/im.vector.modular.widgets/element-call" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "m.custom",
    "url": "https://your-homeserver.example.com/call/#/?roomId=$matrix_room_id&userId=$matrix_user_id&deviceId=$org.matrix.msc3819.matrix_device_id&baseUrl=$org.matrix.msc4location.homeserver_base_url&liveKitUrl=wss://your-homeserver.example.com/livekit/sfu/",
    "name": "Element Call",
    "id": "element-call",
    "creatorUserId": "@voice-bot:your-homeserver.example.com"
  }'
```

---

## 4. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Required Settings

```env
# Matrix
MATRIX_HOMESERVER=https://your-homeserver.example.com
MATRIX_USER_ID=@voice-bot:your-homeserver.example.com
MATRIX_ACCESS_TOKEN=syt_your_access_token

# OpenClaw
OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_TOKEN=your_gateway_token
OPENCLAW_AGENT_ID=personal-voice-agent

# TTS
CHATTERBOX_TTS_URL=http://localhost:8000/tts

# LiveKit
LIVEKIT_ENABLED=true
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_JWT_SERVICE_URL=https://your-homeserver.example.com/livekit/jwt

# STT
WHISPER_URL=http://localhost:8095
WHISPER_MODEL=turbo
```

### Multi-Agent Voice Routing

To route different Matrix rooms to different OpenClaw agents:

```env
# Default agent when room is not in the map
VOICE_AGENT_DEFAULT=personal-voice-agent

# JSON map: Matrix room ID → OpenClaw agent ID
VOICE_AGENT_MAP={"!workRoom:server":"work-voice-agent","!personalRoom:server":"personal-voice-agent"}
```

When a call starts in a room, the bot resolves the agent from this map. Each agent gets its own conversation history. Only one call is active at a time — ending a call clears that agent's history.

### VAD Tuning

```env
VAD_ENERGY_THRESHOLD=0.5      # 0-1, higher = less sensitive
VAD_SILENCE_THRESHOLD_MS=600  # ms of silence before utterance ends
VAD_ADAPTIVE_THRESHOLD=true   # adapt to background noise
VAD_MIN_SPEECH_MS=500         # minimum speech duration
BARGE_IN_ENABLED=true         # allow interrupting bot speech
BARGE_IN_MIN_DURATION_MS=300  # minimum speech to trigger barge-in
```

---

## 5. Run

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Systemd Service (recommended)

Create `~/.config/systemd/user/openclaw-matrix-voice.service`:

```ini
[Unit]
Description=OpenClaw Matrix Voice Bot
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/openclaw-matrix-voice
EnvironmentFile=/path/to/openclaw-matrix-voice/.env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable openclaw-matrix-voice
systemctl --user start openclaw-matrix-voice
```

Check status:

```bash
systemctl --user status openclaw-matrix-voice
journalctl --user -u openclaw-matrix-voice -f
```

---

## 6. Test

1. Open Element desktop
2. Navigate to your voice room
3. Click the call button — Element Call should show "Join"
4. Join the call — the bot should connect
5. Speak — you should hear the bot respond

### Troubleshooting

**Bot doesn't join the call:**
- Check logs: `journalctl --user -u openclaw-matrix-voice -n 50`
- Verify `m.call.member` state events are published in the room
- Verify the bot is in the room: check room member list

**Element shows legacy call instead of Element Call:**
- Room needs `im.vector.modular.widgets/element-call` state event (see step 3)
- Room needs `org.matrix.msc3401.call` state event
- Power levels must allow `m.call.member` and `org.matrix.msc3401.call.member` at level 0
- Refresh Element (Ctrl+R)

**No audio from bot:**
- Check Chatterbox TTS is running: `curl http://localhost:8000/tts -X POST -d '{"text":"hello"}'`
- Check Whisper STT is running: verify `WHISPER_URL` is reachable
- Check LiveKit: verify `LIVEKIT_URL` is reachable

**Wrong agent responds:**
- Check `VOICE_AGENT_MAP` in `.env` — room IDs must match exactly
- Check logs for `Switching voice agent:` messages
- Verify agent is registered in OpenClaw config

**"Already in LiveKit call" error:**
- Bot is in a call in another room. End that call first, or restart the service.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  Element     │────▶│   LiveKit     │────▶│  Voice Bot   │
│  Desktop     │◀────│   Server     │◀────│              │
└─────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                                    ┌────────────┼────────────┐
                                    ▼            ▼            ▼
                              ┌──────────┐ ┌──────────┐ ┌──────────┐
                              │ Whisper  │ │ OpenClaw │ │Chatterbox│
                              │   STT   │ │ Gateway  │ │   TTS    │
                              └──────────┘ └──────────┘ └──────────┘
```

### Audio Pipeline

1. **LiveKit ingress** — receives audio frames from Element Call
2. **VAD** — detects speech boundaries (start/end of utterance)
3. **Whisper STT** — transcribes speech to text
4. **OpenClaw** — processes text through the resolved agent (routes by room)
5. **Chatterbox TTS** — converts response to speech audio
6. **LiveKit egress** — sends audio back to Element Call

### Multi-Agent Routing

```
Matrix Room A ──▶ VOICE_AGENT_MAP ──▶ work-voice-agent (Nova)
Matrix Room B ──▶ VOICE_AGENT_MAP ──▶ personal-voice-agent (Echo)
Unknown Room  ──▶ VOICE_AGENT_DEFAULT ──▶ personal-voice-agent
```

Each agent has its own:
- Conversation history (cleared on call end)
- OpenClaw agent config (model, tools, personality)
- Workspace and memory access

---

## Related Docs

- [LiveKit Setup](LIVEKIT_SETUP.md) — self-hosted LiveKit server
- [TTS Setup](TTS_SETUP.md) — Chatterbox TTS server
- [Services Guide](SERVICES_GUIDE.md) — all supporting services
