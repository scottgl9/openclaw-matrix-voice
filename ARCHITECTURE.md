# Architecture - OpenClaw Matrix Voice

## Overview

OpenClaw Matrix Voice is a Matrix bot that provides voice call functionality. The system is designed to support both text-simulated voice calls (current MVP) and real-time WebRTC-based voice calls (Phase 2+).

## System Components

### 1. VoiceCallHandler

**Location**: `src/handlers/voice-call-handler.ts`

**Responsibility**: Orchestrates voice call flow and routes events to appropriate processors.

**Key Features**:
- Manages active call sessions per room
- Routes events to text-simulated or real media paths
- Handles call control commands (`/call start`, `/call end`, `/call status`)
- Processes voice input (text simulation or real audio)

**Phase 2 Changes**:
- Added `isRealMediaCall` flag to distinguish call types
- Added `callId` tracking for Matrix call events
- Added `processRealTimeAudio()` method for WebRTC audio streams
- Integrated with `MatrixCallMediaService`

### 2. MatrixCallMediaService

**Location**: `src/services/matrix-call-media-service.ts`

**Responsibility**: Handles Matrix call protocol events and manages call session state.

**Key Features**:
- Listens for `m.call.invite`, `m.call.media`, `m.call.hangup` events
- Maintains call session state machine (invited → connecting → connected → ended)
- Auto-accepts incoming calls with `m.call.answer`
- Initiates outbound calls with `m.call.invite`
- Provides audio routing stubs for WebRTC integration

**Phase 2 Implementation**:
- ✓ Call event handling and routing
- ✓ Session state management
- ✓ Call answer/invite/hangup event sending
- ✓ Event emitter for call lifecycle hooks
- ✗ WebRTC peer connection (Phase 3)
- ✗ Real audio stream processing (Phase 3)

**Call Flow**:
```
Incoming Call:
  m.call.invite → handleCallInvite() → send m.call.answer → session.state = 'connecting'
  
  m.call.media → handleCallMedia() → emit 'media.inbound' → (Phase 3: STT)
  
  m.call.hangup → handleCallHangup() → session.state = 'ended'

Outgoing Call:
  startCall() → send m.call.invite → session.state = 'connecting'
  
  sendAudio() → emit 'media.outbound' → (Phase 3: WebRTC send)
  
  endCall() → send m.call.hangup → session.state = 'disconnected'
```

### 3. MatrixClientService

**Location**: `src/services/matrix-client-service.ts`

**Responsibility**: Wraps Matrix SDK client with bot-specific functionality.

**Key Features**:
- Manages Matrix client lifecycle (start/stop)
- Sets up event handlers for room messages and references
- Provides access to voice call handler and call media service
- Auto-joins invited rooms

**Phase 2 Changes**:
- Instantiates `MatrixCallMediaService` on construction
- Starts call media service in `start()` method
- Provides `getCallMediaService()` getter

### 4. OpenClawService

**Location**: `src/services/openclaw-service.ts`

**Responsibility**: Communicates with OpenClaw API for text processing.

**Key Features**:
- Sends text to OpenClaw API
- Receives AI-generated responses
- Handles API errors and timeouts

**Integration**: Used by VoiceCallHandler for text-simulated voice calls.

### 5. ChatterboxTTSService

**Location**: `src/services/chatterbox-tts-service.ts`

**Responsibility**: Converts text to speech audio.

**Key Features**:
- Sends text to Chatterbox TTS API
- Receives audio data (WAV/OGG)
- Caches responses to reduce API calls
- Handles API errors gracefully

**Integration**: Used by VoiceCallHandler to generate audio responses.

## Data Flow

### Text-Simulated Call (Current - Full)

```
User: /call start
  ↓
VoiceCallHandler.startCall()
  ↓
VoiceCallHandler.sendMessage("🎤 Voice call started...")
  ↓
User replies to bot message
  ↓
VoiceCallHandler.handleReply()
  ↓
VoiceCallHandler.processVoiceInput()
  ↓
OpenClawService.processText(text)
  ↓
OpenClaw API → AI response
  ↓
ChatterboxTTSService.textToSpeechCached(response)
  ↓
VoiceCallHandler.sendAudio()
  ↓
MatrixClientService.sendAudio()
  ↓
Matrix room: Audio file
```

### Real Media Call (Phase 2 - Partial)

```
User: /call start real
  ↓
VoiceCallHandler.startCall(roomId, true)
  ↓
MatrixCallMediaService.startCall(roomId)
  ↓
MatrixClient.sendEvent(m.call.invite)
  ↓
[Phase 3: WebRTC peer connection established]
  ↓
User speaks → microphone audio
  ↓
[Phase 3: WebRTC capture → STT]
  ↓
VoiceCallHandler.processRealTimeAudio(audioData)
  ↓
[Phase 3: STT → text → OpenClaw → TTS]
  ↓
[Phase 3: TTS audio → WebRTC send]
```

## State Management

### CallSession (MatrixCallMediaService)
```typescript
interface CallSession {
  callId: string;           // Unique call identifier
  roomId: string;           // Matrix room ID
  state: 'invited' | 'connecting' | 'connected' | 'disconnected' | 'ended';
  createdAt: Date;
  endedAt?: Date;
  peerUserId?: string;      // Remote user ID
  // Phase 3+
  peerConnection?: any;     // RTCPeerConnection
  localStream?: any;        // MediaStream
  remoteStream?: any;       // MediaStream
}
```

### CallState (VoiceCallHandler)
```typescript
interface CallState {
  isActive: boolean;
  roomId: string;
  lastActivity: Date;
  transcription?: string;
  callId?: string;          // Phase 2: Matrix call ID
  isRealMediaCall?: boolean; // Phase 2: WebRTC vs text-simulated
}
```

## Event Handling

### MatrixCallMediaService Events
- `call.invited`: Incoming call received
- `call.connecting`: Call answer sent
- `call.initiated`: Outbound call started
- `call.ended`: Call terminated
- `call.hangup`: Local hangup sent
- `media.inbound`: Audio/video received
- `media.outbound`: Audio/video sent

### VoiceCallHandler Events
- `room.event`: General room events
- `room.message`: Text messages
- `room.reference`: Reply references

## Matrix Protocol Support

### Supported Events (Phase 2)
- `m.call.invite` - Call initiation
- `m.call.answer` - Call acceptance
- `m.call.media` - Media stream data
- `m.call.hangup` - Call termination

### Pending Events (Phase 3+)
- `m.call.sdp.stream` - WebRTC SDP negotiation
- `m.call.candidates` - ICE candidates
- `m.call.select` - Media stream selection

## Testing Strategy

### Unit Tests
- **MatrixCallMediaService**: 23 tests
  - Service lifecycle (start/stop)
  - Call session management
  - Event handling (invite, media, hangup)
  - Outbound call flow
  - Audio send/receive stubs
  - Statistics tracking

- **VoiceCallHandler**: 19 tests
  - Call start/end
  - Real media vs text-simulated paths
  - Event routing
  - Audio processing
  - Status reporting

- **OpenClawService**: 3 tests
  - Text processing
  - Error handling
  - Timeout handling

- **ChatterboxTTSService**: 5 tests
  - TTS generation
  - Caching
  - Error handling

### Test Coverage
- All 50 tests passing
- Build: `npm run build` passes
- Tests: `npm test` passes

## Future Architecture (Phase 3+)

### WebRTC Integration
```
┌──────────────────────────────────────────────────────────┐
│                    WebRTC Layer                           │
│  ┌─────────────────┐  ┌────────────────────────────────┐  │
│  │ RTCPeerConnection│  │ MediaStream API                │  │
│  │ - SDP exchange   │  │ - getUserMedia (mic/camera)   │  │
│  │ - ICE candidates │  │ - AudioTracks/VideoTracks     │  │
│  │ - DTLS/SRTP      │  │ - Track endpoints             │  │
│  └─────────────────┘  └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────┐
│                    Audio Processing                       │
│  ┌─────────────────┐  ┌────────────────────────────────┐  │
│  │ STT Engine      │  │ TTS Engine                     │  │
│  │ - Whisper       │  │ - Chatterbox                   │  │
│  │ - Vosk          │  │ - Custom voices                │  │
│  │ - Real-time     │  │ - Streaming                    │  │
│  └─────────────────┘  └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## Security Considerations

- **Encryption**: Calls use Matrix end-to-end encryption (E2EE)
- **Access Tokens**: Stored securely in environment variables
- **Audio Data**: Processed in-memory, not persisted
- **User Consent**: Call recording requires explicit consent (Phase 4)

## Performance Considerations

- **TTS Caching**: Responses cached to reduce API calls
- **Event Filtering**: Only process relevant events
- **Session Cleanup**: Expired sessions removed on stop
- **Audio Buffering**: Chunked audio processing (Phase 3)

## Dependencies

- `matrix-bot-sdk`: Matrix protocol client
- `vitest`: Testing framework
- `typescript`: Type-safe JavaScript
- `axios`: HTTP client (OpenClaw API)

## Version History

- **v0.1.0** (Current): Phase 2 - Call media plumbing
  - Matrix call event handling
  - Call session management
  - Text-simulated voice calls
  - Unit tests (50 passing)

- **v0.0.1**: Initial MVP
  - Text-based voice simulation
  - OpenClaw API integration
  - Chatterbox TTS
