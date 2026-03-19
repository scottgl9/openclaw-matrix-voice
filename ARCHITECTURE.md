# Architecture Notes

## System Overview

OpenClaw Matrix Voice Call MVP integrates three core systems:
1. **Matrix Protocol** - Decentralized messaging for call signaling
2. **OpenClaw API** - AI agent for text response generation
3. **Chatterbox TTS** - Text-to-speech for audio response generation

## Design Decisions

### Why Matrix Bot SDK?

The Matrix Bot SDK (`matrix-bot-sdk`) was chosen because:
- Mature, well-documented SDK for Matrix bot development
- Built-in support for room joining, message sending, and event handling
- Active community and regular updates
- Simplifies Matrix protocol complexity

**Trade-off**: For full WebRTC call support, we'd need `matrix-sdk-js` with media handling capabilities. The MVP uses text simulation as a pragmatic first step.

### Why HTTP API for OpenClaw?

Initially considered WebSocket gateway protocol, but chose HTTP API because:
- Simpler to implement and debug
- Stateless request/response model fits MVP scope
- Easier to test with unit tests
- Can be upgraded to WebSocket later without major changes

### Why Chatterbox TTS?

Chatterbox provides:
- High-quality neural TTS
- Local deployment option (service mode)
- API mode for cloud deployment
- WAV/PCM output suitable for telephony

## Component Interactions

### Message Flow

```
User (Matrix Room)
    │
    ├─ Sends: /call start
    │
    ▼
Voice Call Handler
    │
    ├─ Creates: CallState { isActive: true, roomId, timestamp }
    │
    ▼
User (Matrix Room)
    │
    ├─ Sends: voice: "Hello"
    │
    ▼
Voice Call Handler
    │
    ├─ Validates: Call is active
    ├─ Extracts: Text from message
    │
    ▼
OpenClaw Service
    │
    ├─ POST /gateway { type: 'text', content: 'Hello', channel: 'matrix' }
    │
    ▼
OpenClaw API
    │
    ├─ Routes to agent
    ├─ Generates response
    │
    ▼
OpenClaw Service
    │
    ├─ Returns: { success: true, response: "How can I help?" }
    │
    ▼
Chatterbox TTS Service
    │
    ├─ POST /tts { text: "How can I help?", format: 'wav' }
    │
    ▼
Chatterbox TTS
    │
    ├─ Generates: WAV audio buffer
    │
    ▼
Chatterbox TTS Service
    │
    ├─ Returns: { success: true, audioData: Buffer, mimeType: 'audio/wav' }
    │
    ▼
Matrix Client Service
    │
    ├─ Uploads: Audio to media repository
    ├─ Sends: m.room.message with m.audio
    │
    ▼
User (Matrix Room)
    │
    └─ Receives: Audio message (voice response)
```

### State Management

Call state is stored in-memory using a `Map<string, CallState>`:
- Key: Room ID
- Value: CallState object with active status, timestamps, metadata

**Limitation**: In-memory storage doesn't survive restarts. Future versions should use persistent storage (SQLite, Redis).

## Security Considerations

### Authentication

- Matrix: Access token authentication (stored in `.env`)
- OpenClaw: Bearer token authentication
- Chatterbox: Optional API key authentication

### Data Protection

- No sensitive data logged
- Audio data handled in-memory only
- Credentials stored in environment variables (not committed)

### Future Security Enhancements

1. **E2EE Support**: Matrix encryption for private calls
2. **Webhook Security**: Signature verification for external TTS APIs
3. **Rate Limiting**: Prevent abuse of TTS service
4. **Audit Logging**: Track call activity for compliance

## Performance Considerations

### Current Limitations

1. **Sequential Processing**: One call at a time per room
2. **In-memory Caching**: TTS cache lost on restart
3. **No Audio Compression**: WAV files are large (16-bit, 16kHz = 320KB/sec)

### Optimization Opportunities

1. **Concurrent Calls**: Use Promise.all for parallel processing
2. **Persistent Cache**: Redis or file-based TTS cache
3. **Audio Compression**: Opus or MP3 for smaller payloads
4. **Connection Pooling**: Reuse HTTP connections to OpenClaw/TTS

## Error Handling Strategy

### Retry Logic

- OpenClaw API: No retry (user waits for response)
- TTS Service: No retry (fallback to text)
- Matrix: SDK handles reconnection

### Fallback Mechanisms

1. **TTS Failure**: Send text response instead of audio
2. **OpenClaw Failure**: Send error message to user
3. **Matrix Disconnection**: Graceful shutdown with cleanup

### Error Categories

| Category | Handling |
|----------|----------|
| Network errors | Log and return error response |
| Authentication errors | Stop service, require credential update |
| API errors | Return error to user, log details |
| TTS errors | Fallback to text response |

## Testing Strategy

### Unit Tests

- **OpenClawService**: Mock axios, test API calls and error handling
- **ChatterboxTTSService**: Mock axios, test TTS generation and caching
- **VoiceCallHandler**: Mock services, test call state transitions

### Test Coverage Goals

- Core services: 80%+ coverage
- Error paths: All major error scenarios tested
- Edge cases: Empty inputs, null values, timeouts

### Future Testing

- Integration tests with real Matrix server (test server)
- End-to-end tests with Docker Compose
- Load testing for concurrent calls

## Integration Points

### OpenClaw API Integration

**Endpoint**: `POST /gateway`
**Payload**:
```json
{
  "type": "text",
  "content": "user message",
  "channel": "matrix"
}
```

**Response**:
```json
{
  "response": "agent response"
}
```

### Chatterbox TTS Integration

**Endpoint**: `POST /tts`
**Payload**:
```json
{
  "text": "text to convert",
  "format": "wav",
  "sampleRate": 16000
}
```

**Response**: `audio/wav` (binary)

### Matrix Bot SDK Integration

**Events**:
- `room.message`: Incoming messages
- `room.event`: All room events
- `room.encryptionError`: E2EE errors

**Methods**:
- `sendText(roomId, text)`: Send text message
- `sendAudio(roomId, buffer, mimeType)`: Send audio
- `joinRoom(roomId)`: Join a room

## Deployment Considerations

### Environment Requirements

- **Node.js**: 18+ or 20+
- **Memory**: 512MB minimum (TTS caching)
- **CPU**: 1+ cores (audio processing)
- **Network**: Outbound to Matrix, OpenClaw, TTS services

### Scaling Strategy

1. **Vertical**: Increase resources for more concurrent calls
2. **Horizontal**: Multiple instances with load balancer (requires session affinity)

### Monitoring

**Metrics to Track**:
- Active call count
- Response latency (OpenClaw + TTS)
- Error rate
- TTS cache hit rate

**Logging**:
- INFO: Call start/end, errors
- DEBUG: API requests/responses (development only)

## Migration Path to Full Voice Calls

### Phase 1: Current MVP (Text Simulation)
- ✅ Text input with TTS output
- ✅ Basic call state management
- ✅ OpenClaw integration

### Phase 2: Matrix Call v1 Integration
- Implement `m.call.invite` handling
- Add WebRTC peer connection
- Capture audio from Matrix stream
- Integrate STT (Whisper/Vosk)

### Phase 3: Matrix Call v2 (MSC3407+)
- Support call v2 protocol
- Improved signaling and ICE handling
- Better multi-party support

### Phase 4: Production Hardening
- E2EE support
- Persistent state
- Monitoring and alerting
- Docker/Kubernetes deployment

## References

- [Matrix Bot SDK Documentation](https://github.com/matrix-org/matrix-bot-sdk)
- [OpenClaw Documentation](/home/clawmander/sandbox/personal/OPENCLAW_DOCS)
- [Matrix Call Specification](https://spec.matrix.org/v1.8/rooms/v9/#event-types)
- [Chatterbox TTS API](https://github.com/clawmander/chatterbox)

## Change Log

### 0.1.0 (2026-03-18)
- Initial MVP implementation
- Text-based voice simulation
- OpenClaw API integration
- Chatterbox TTS integration
- Unit tests for core services
- Basic call state management

---

**Document Owner**: OpenClaw Team
**Last Updated**: 2026-03-18
**Version**: 0.1.0
