# OpenClaw Matrix Voice Call MVP

A functional MVP for Matrix voice calls integrated with OpenClaw API and Chatterbox TTS service.

## Overview

This project implements a voice call system for Matrix that:
- Connects to a Matrix homeserver using the Matrix Bot SDK
- Processes voice inputs (text-simulated for MVP) through OpenClaw API
- Generates speech responses using Chatterbox TTS service
- Sends audio responses back to Matrix rooms

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│   Matrix    │────▶│  Voice Call  │────▶│  OpenClaw    │────▶│  LLM Agent  │
│   Room      │     │   Handler    │     │   API        │     │             │
└─────────────┘     └──────────────┘     └──────────────┘     └─────────────┘
      ▲                   │
      │                   ▼
      │           ┌──────────────┐
      └───────────│  Chatterbox  │
                  │  TTS Service │
                  └──────────────┘
```

### Components

1. **Matrix Client Service**: Handles Matrix connection and event listening
2. **Voice Call Handler**: Manages call state and processes voice inputs
3. **OpenClaw Service**: Communicates with OpenClaw API for text responses
4. **Chatterbox TTS Service**: Converts text responses to speech audio

## Prerequisites

- Node.js 18+ or 20+
- A Matrix account (can be created on matrix.org or self-hosted homeserver)
- OpenClaw gateway running (default: `http://localhost:18789`)
- Chatterbox TTS service running (default: `http://localhost:8000/tts`)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd openclaw-matrix-voice
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` with your credentials:
```env
MATRIX_HOMESERVER=https://matrix.org
MATRIX_USER_ID=@your-bot:matrix.org
MATRIX_ACCESS_TOKEN=your_matrix_access_token

OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_TOKEN=your_openclaw_token

CHATTERBOX_TTS_URL=http://localhost:8000/tts

SERVER_PORT=3000
```

## Configuration

### Matrix Setup

1. **Create a Matrix bot account** (if you don't have one):
   - Use Element or another Matrix client to create an account
   - Or use a script to register programmatically

2. **Get your access token**:
```bash
curl --request POST \
  --url https://matrix.example.org/_matrix/client/v3/login \
  --header 'Content-Type: application/json' \
  --data '{
    "type": "m.login.password",
    "identifier": {
      "type": "m.id.user",
      "user": "your-bot-username"
    },
    "password": "your-password"
  }'
```

3. **Invite the bot to a room** or start a DM with it

### OpenClaw Setup

Ensure your OpenClaw gateway is running and configured to accept connections from this service. The service will connect via the HTTP API.

### Chatterbox TTS Setup

The service supports two modes:

**Service Mode (Local):**
```env
CHATTERBOX_TTS_URL=http://localhost:8000/tts
```

**API Mode (Remote):**
```env
CHATTERBOX_TTS_API_KEY=your_api_key
CHATTERBOX_TTS_API_URL=https://chatterbox-api.example.com/tts
```

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

### With Docker (future)

```bash
docker build -t openclaw-matrix-voice .
docker run --env-file .env openclaw-matrix-voice
```

## Usage

### Starting a Voice Call

In a Matrix room where the bot is present, send:
```
/call start
```

The bot will respond with confirmation.

### Sending Voice Input (MVP - Text Simulation)

For the MVP, voice input is simulated via text. Send a message with the bot mentioned or in reply format:
```
voice: Hello, can you help me?
```
or
```
speech: What's the weather like?
```

The bot will:
1. Process the text through OpenClaw API
2. Get an AI-generated response
3. Convert the response to speech using Chatterbox TTS
4. Send the audio back to the room

### Ending a Call

```
/call end
```

### Checking Call Status

```
/call status
```

## MVP Limitations

This is a Minimum Viable Product with the following limitations:

### Current Scope

✅ **Implemented:**
- Matrix bot connection and event handling
- Text-based voice input simulation
- OpenClaw API integration for text responses
- Chatterbox TTS integration for audio generation
- Basic call state management
- Unit tests for core services

❌ **Not Implemented (Future Work):**
- **Real audio streaming**: MVP uses text simulation. Full implementation requires:
  - WebRTC integration for real-time audio capture
  - Matrix call v1/v2 support (m.call.invite, m.call.media)
  - Audio stream processing and buffering
  - Real-time STT (Speech-to-Text) integration

- **Advanced call features**:
  - Multi-party calls
  - Call transfer/forwarding
  - Call recording
  - Noise cancellation
  - Echo cancellation

- **Production readiness**:
  - Error recovery and reconnection logic
  - Comprehensive logging and monitoring
  - Rate limiting and throttling
  - Security hardening (E2EE support)
  - Performance optimization

### Technical Debt

- Matrix Bot SDK integration is basic; full WebRTC requires matrix-sdk-js with media handling
- TTS caching is in-memory only; should be persistent for production
- No audio format negotiation (assumes WAV/PCM16)
- Single-threaded processing; concurrent calls not optimized

## Testing

### Run All Tests

```bash
npm test
```

### Run Tests in Watch Mode

```bash
npm run test:watch
```

### Test Coverage

```bash
npm test -- --coverage
```

### Test Results

The test suite covers:
- OpenClawService: API communication and error handling
- ChatterboxTTSService: TTS generation and caching
- VoiceCallHandler: Call state management and message processing

## Project Structure

```
openclaw-matrix-voice/
├── src/
│   ├── config/
│   │   └── index.ts          # Configuration management
│   ├── services/
│   │   ├── openclaw-service.ts    # OpenClaw API client
│   │   ├── chatterbox-tts-service.ts # TTS service client
│   │   └── matrix-client-service.ts # Matrix bot client
│   ├── handlers/
│   │   └── voice-call-handler.ts  # Voice call logic
│   └── index.ts              # Application entry point
├── tests/
│   ├── openclaw-service.test.ts
│   ├── chatterbox-tts-service.test.ts
│   └── voice-call-handler.test.ts
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Development

### Adding New Features

1. Create a new feature branch:
```bash
git checkout -b feature/your-feature
```

2. Make changes and add tests
3. Ensure all tests pass:
```bash
npm test
```
4. Build to check for TypeScript errors:
```bash
npm run build
```
5. Commit with clear message:
```bash
git commit -m "feat: add your feature description"
```

### Code Style

- TypeScript strict mode enabled
- ES Modules (import/export)
- Async/await for all I/O operations
- Error handling with try/catch
- Comprehensive logging

## Troubleshooting

### Common Issues

**Matrix connection fails:**
- Verify access token is valid
- Check homeserver URL is correct
- Ensure bot account exists

**OpenClaw API errors:**
- Verify OpenClaw gateway is running
- Check API token is valid
- Review OpenClaw logs for details

**TTS service errors:**
- Ensure Chatterbox service is running
- Check TTS URL is accessible
- Verify audio format compatibility

**Audio not playing:**
- Check Matrix client supports audio messages
- Verify audio format is supported (WAV/PCM16)
- Review Matrix room permissions

## Future Roadmap

### Phase 2: Real Audio Support
- Matrix call v1/v2 integration
- WebRTC media streams
- Real-time STT (Whisper, Vosk)
- Audio format negotiation

### Phase 3: Production Features
- E2EE support for encrypted rooms
- Multi-party call support
- Call recording and playback
- Monitoring and alerting
- Docker containerization

### Phase 4: Advanced Features
- Call transfer and forwarding
- Voice commands and intents
- Multi-language support
- Custom voice models

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting PRs.

## Support

For issues and questions:
- Open a GitHub issue
- Check existing documentation
- Review troubleshooting section

---

**Status**: MVP - Functional but limited scope
**Version**: 0.1.0
**Last Updated**: 2026-03-18
