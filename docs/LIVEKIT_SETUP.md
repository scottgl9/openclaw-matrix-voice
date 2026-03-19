# LiveKit Server Setup (for `openclaw-matrix-voice`)

This guide sets up a self-hosted LiveKit instance for local/dev use with the Matrix voice bridge.

## 1) Prerequisites

- Docker + Docker Compose plugin
- Publicly reachable hostname (for remote clients) or local host for dev
- Open ports:
  - `7880` (HTTP/WebSocket signaling)
  - `7881/udp` (WebRTC UDP media)

## 2) Generate API credentials

Choose values and store safely:

- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

Example (dev only):

```bash
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=devsecret
```

## 3) Create LiveKit config

Create `infra/livekit/livekit.yaml`:

```yaml
port: 7880
bind_addresses:
  - "0.0.0.0"
rtc:
  udp_port: 7881
keys:
  devkey: devsecret
logging:
  level: info
```

> Replace `devkey/devsecret` with your real values.

## 4) Docker Compose (minimal)

Create `infra/livekit/docker-compose.yml`:

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "7880:7880"
      - "7881:7881/udp"
    restart: unless-stopped
```

Start it:

```bash
cd infra/livekit
docker compose up -d
```

## 5) Verify server health

```bash
curl -sSf http://localhost:7880/ || true
```

You can also check logs:

```bash
docker compose logs -f livekit
```

## 6) Configure this project

In `.env` for `openclaw-matrix-voice`:

```dotenv
# LiveKit signaling URL
LIVEKIT_URL=ws://localhost:7880

# Must match livekit.yaml keys
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
```

If your LiveKit is remote/TLS:

```dotenv
LIVEKIT_URL=wss://your-livekit-hostname:7880
```

## 7) Optional: TLS + reverse proxy

For production, put LiveKit behind TLS (Nginx/Caddy/Traefik):

- expose `wss://voice.example.com`
- proxy to `livekit:7880`
- ensure UDP media path is still reachable (TURN may be required for strict NAT)

## 8) NAT/TURN notes (production)

If clients are behind restrictive NAT/firewalls, add TURN support.
LiveKit docs cover TURN deployment and ICE configuration.

## 9) Common issues

- **Cannot connect to room**: key/secret mismatch with server config
- **No audio**: UDP port blocked (`7881/udp`) or TURN missing
- **Works local, fails remote**: missing TLS/WSS or NAT traversal path

## 10) Quick checklist

- [ ] LiveKit container running
- [ ] `7880/tcp` reachable
- [ ] `7881/udp` reachable
- [ ] API key/secret match between server + `.env`
- [ ] `LIVEKIT_URL` correct (`ws://` local, `wss://` remote)

---

When this is up, `openclaw-matrix-voice` can use LiveKit room/token APIs via the configured env vars.
