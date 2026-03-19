# Architecture - OpenClaw Matrix Voice

## Overview

OpenClaw Matrix Voice is a Matrix bot that provides voice call functionality. The system supports:
- Text-simulated voice calls (MVP)
- Real-time WebRTC-based voice calls (Phase 2+)
- LiveKit integration for scalable media (Phase 3)
- Voice Activity Detection (VAD) for turn-based conversation (Phase 4)
- Turn processing pipeline: VAD → STT → OpenClaw → TTS (Phase 5 - Current)

## System Components

### 1. VoiceCallHandler

**Location**: `src/handlers/voice-call-handler.ts`

**Responsibility**: Orchestrates voice call flow and routes events to appropriate processors.

**Key Features**:
- Manages active call sessions per room
- Routes events to text-simulated, real media, or LiveKit paths
- Handles call control commands (`/call start`, `/call end`, `/call status`)
- Processes voice input (text simulation or real audio)

**Phase 2 Changes**:
- Added `isRealMediaCall` flag to distinguish call types
- Added `callId` tracking for Matrix call events
- Added `processRealTimeAudio()` method for WebRTC audio streams
- Integrated with `MatrixCallMediaService`

**Phase 3 Changes**:
- Added `getLiveKitAdapter()` method to access LiveKit bridge
- Await `getUserId()` call (async method signature fix)

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
- Provides access to voice call handler, call media service, and LiveKit adapter
- Auto-joins invited rooms

**Phase 2 Changes**:
- Instantiates `MatrixCallMediaService` on construction
- Starts call media service in `start()` method
- Provides `getCallMediaService()` getter

**Phase 3 Changes**:
- Added `getLiveKitAdapter()` getter for LiveKit bridge access

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

### 6. LiveKitService

**Location**: `src/services/livekit-service.ts`

**Responsibility**: Manages LiveKit server connections, rooms, and tokens.

**Key Features**:
- Connects to LiveKit server via WebSocket
- Creates/deletes/list rooms for Matrix calls
- Generates JWT access tokens for participants
- Tracks room-to-Matrix-room mappings
- Provides statistics and room retrieval

**Phase 3 Implementation**:
- ✓ Room creation with auto-generated names
- ✓ Room deletion and cleanup
- ✓ Room listing
- ✓ Participant tracking (add/remove)
- ✓ JWT token generation with `livekit-server-sdk`
- ✓ Service lifecycle (start/stop)
- ✓ Statistics tracking

**Async Methods**:
- `createRoom(matrixRoomId: string): Promise<LiveKitRoom>`
- `deleteRoom(matrixRoomId: string): Promise<void>`
- `listRooms(): Promise<LiveKitRoom[]>`
- `generateToken(roomName, identity, canPublish, canSubscribe): Promise<string>`

**Integration**: Used by MatrixLiveKitAdapter for room management and token generation.

### 7. MatrixLiveKitAdapter

**Location**: `src/services/matrix-livekit-adapter.ts`

**Responsibility**: Bridges Matrix calls with LiveKit rooms.

### 8. AudioPipelineService

**Location**: `src/services/audio-pipeline.ts`

**Responsibility**: Processes audio frames through the audio processing pipeline.

**Key Features**:
- Audio frame buffering and chunking
- Frame duration calculation based on sample rate and format
- Frame size calculation (16-bit PCM = 2 bytes/sample)
- Pipeline start/stop lifecycle management
- Frame processing hooks for VAD and STT integration

**Phase 4 Implementation**:
- ✓ Audio frame structure definition
- ✓ Frame duration calculation
- ✓ Frame size calculation for 16-bit PCM
- ✓ Pipeline state management
- ✓ Frame processing interface

**Frame Format**:
```typescript
interface AudioFrame {
  data: Buffer;           // PCM audio data
  sampleRate: number;     // e.g., 16000 Hz
  channels: number;       // e.g., 1 (mono)
  format: 'pcm16';        // 16-bit signed PCM
  timestamp: number;      // Unix timestamp in ms
  durationMs: number;     // Frame duration in ms
}
```

### 9. VadService (Voice Activity Detection)

**Location**: `src/services/vad-service.ts`

**Responsibility**: Detects speech activity and segments conversation turns.

### 10. STTAdapter & STTService

**Location**: `src/services/stt-adapter.ts`

**Responsibility**: Provides pluggable STT provider interface and transcription flow management.

**Key Features**:
- STTAdapter interface for provider abstraction (Whisper, Vosk, Google Cloud STT, etc.)
- MockSTTAdapter for testing and development
- STTService manages adapter lifecycle and transcription turns
- Frame-based transcription with turn completion
- Turn ID association with transcription results

**Phase 5 Implementation**:
- ✓ STTAdapter interface definition
- ✓ MockSTTAdapter with configurable mock responses
- ✓ STTService with startTurn, processFrame, finalizeTurn methods
- ✓ STTResult interface (text, confidence, language, duration, turnId)
- ✓ 0 unit tests (pending - new component)

**Integration**: Used by TurnProcessorService for transcription.

### 11. TurnProcessorService

**Location**: `src/services/turn-processor.ts`

**Responsibility**: Orchestrates complete turn processing flow from VAD to TTS output.

**Key Features**:
- End-to-end turn processing: VAD turn completion → STT → OpenClaw → TTS → Audio output
- State machine: IDLE → TRANSCRIBING → PROCESSING → RESPONDING → ERROR
- Event emission for turn processing state changes
- TTS audio emission for playback
- Error handling and recovery

**Phase 5 Implementation**:
- ✓ TurnProcessorService with state machine
- ✓ handleTurnCompletion() entry point
- ✓ Internal methods: transcribeTurn(), processText(), generateTTS(), emitTTSAudio()
- ✓ TurnProcessingState enum and TurnProcessingEvent interface
- ✓ TTSAudioEvent for TTS audio output
- ✓ 0 unit tests (pending - new component)

**Integration**: Bridges VAD/AudioPipeline to OpenClaw/TTS pipeline.

**Turn Processing Flow**:
```
VAD Turn Completion (turn.end event)
  ↓
TurnProcessor.handleTurnCompletion(event)
  ↓
Step 1: transcribeTurn() → STTService → STTResult (text)
  ↓
Step 2: processText() → OpenClawService → OpenClawResponse (response)
  ↓
Step 3: generateTTS() → ChatterboxTTSService → TTSResponse (audioData)
  ↓
Step 4: emitTTSAudio() → 'tts.audio' event → Audio playback
```

**Key Features**:
- Energy-based speech detection using RMS calculation
- State machine: IDLE → SPEECH_START → SPEECH_ACTIVE → SILENCE → IDLE
- Turn detection with unique turn IDs
- Configurable thresholds (energy, silence, min speech duration)
- Frame-based timing for testability
- Statistics tracking (frames, speech duration, turns completed)

**Phase 4 Implementation**:
- ✓ RMS energy calculation for 16-bit PCM frames
- ✓ Speech start detection (min speech duration)
- ✓ Speech end detection (silence threshold)
- ✓ Turn ID generation and tracking
- ✓ State machine implementation
- ✓ Event emission (speech.start, speech.end, turn.end, vad.frame)
- ✓ Statistics API (getStats, resetStats)
- ✓ 31 unit tests passing

**VAD Configuration**:
```typescript
interface VadConfig {
  energyThreshold: number;      // 0-1, default 0.3 (30% RMS)
  silenceThresholdMs: number;   // ms silence before turn end, default 800
  minSpeechDurationMs: number;  // ms minimum speech to confirm, default 200
  preRollMs: number;            // audio before speech, default 100
  postRollMs: number;           // audio after speech, default 300
  frameDurationMs: number;      // frame size, default 20
  debug: boolean;               // enable debug logging
}
```

**Detection Algorithm**:
1. **Frame Processing**: Calculate RMS energy for each audio frame
2. **Speech Start**: When energy > threshold for minSpeechDurationMs
3. **Speech Active**: Continue processing frames while energy > threshold
4. **Silence Detection**: When energy < threshold, start silence timer
5. **Turn End**: When silence duration > silenceThresholdMs

**Turn Detection Flow**:
```
IDLE --(energy > threshold)--> SPEECH_START --(duration >= min)--> SPEECH_ACTIVE
SPEECH_ACTIVE --(energy < threshold)--> SILENCE --(silence >= threshold)--> IDLE
```

**Events**:
- `speech.start`: Speech detected, turn started (includes turnId)
- `speech.end`: Speech ended, turn completing (includes duration)
- `turn.end`: Turn completed (includes turnId)
- `vad.frame`: Every frame processed (includes energy, isSpeech, state)

**Statistics**:
- `frameCounter`: Total frames processed
- `turnsCompleted`: Number of complete turns
- `totalSpeechDurationMs`: Cumulative speech time
- `totalSilenceDurationMs`: Cumulative silence time
- `currentTurnId`: Active turn ID (null if idle)

**Key Features**:
- Initializes and verifies LiveKit connectivity
- Starts calls by creating LiveKit rooms
- Ends calls by deleting LiveKit rooms
- Generates participant tokens
- Tracks active connections and durations
- Emits events for call lifecycle
- Falls back to text mode when LiveKit unavailable

**Phase 3 Implementation**:
- ✓ Adapter initialization with connectivity check
- ✓ Call start via LiveKit room creation
- ✓ Call end via LiveKit room deletion
- ✓ Token generation for participants
- ✓ Connection state tracking
- ✓ Event emission (call.started, call.ended, media.inbound, media.outbound)
- ✓ Fallback mode when LiveKit disabled/unavailable
- ✓ Statistics and connection retrieval

**Async Methods**:
- `initialize(): Promise<void>`
- `startCall(matrixRoomId, userId): Promise<CallResult>`
- `endCall(matrixRoomId): Promise<void>`
- `handleOutboundAudio(matrixRoomId, audioData, mimeType): Promise<void>`

**Integration**: Used by VoiceCallHandler for LiveKit-based calls.

## Data Flow

### Phase 5 Turn Processing Flow (Current - In Progress)

```
VAD detects turn completion (speech.end → turn.end event)
  ↓
AudioPipeline emits turn.end event with frames
  ↓
TurnProcessor.handleTurnCompletion(event)
  ↓
Step 1: transcribeTurn()
  - STTService.startTurn(turnId)
  - STTService.processFrame(frame) for each frame
  - STTService.finalizeTurn() → STTResult { text, confidence }
  ↓
Step 2: processText(text)
  - OpenClawService.processText(text) → OpenClawResponse { response }
  ↓
Step 3: generateTTS(response)
  - ChatterboxTTSService.textToSpeechCached(response) → TTSResponse { audioData }
  ↓
Step 4: emitTTSAudio(turnId, audioData)
  - TurnProcessor emits 'tts.audio' event
  ↓
Audio playback / WebRTC send / Matrix upload
```

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
  - LiveKit adapter integration

- **LiveKitService**: 22 tests
  - Service lifecycle (start/stop)
  - Room creation with auto-generated names
  - Room deletion and cleanup
  - Room listing
  - Participant tracking
  - JWT token generation
  - Statistics tracking

- **MatrixLiveKitAdapter**: 22 tests
  - Adapter initialization
  - LiveKit connectivity verification
  - Call start/end via LiveKit
  - Event emission
  - Fallback mode
  - Connection state tracking
  - Statistics

- **OpenClawService**: 3 tests
  - Text processing
  - Error handling
  - Timeout handling

- **ChatterboxTTSService**: 5 tests
  - TTS generation
  - Caching
  - Error handling

### Test Coverage
- All 144 tests passing (94 existing + 31 VAD + 19 audio pipeline)
  - VAD Service: 31 tests
  - Audio Pipeline: 19 tests
  - LiveKit Service: 22 tests
  - MatrixLiveKitAdapter: 22 tests
  - VoiceCallHandler: 19 tests
  - MatrixCallMediaService: 23 tests
  - OpenClawService: 3 tests
  - ChatterboxTTSService: 5 tests
- Build: `npm run build` passes
- Tests: `npm test` passes
- Pending: STT and TurnProcessor tests (Phase 5)

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

- **v0.5.0** (Current): Phase 5 - Turn Processing Pipeline (In Progress)
  - STT adapter interface (pluggable STT provider abstraction)
  - MockSTTAdapter for testing and development
  - STTService for transcription flow management
  - TurnProcessorService for end-to-end turn processing (VAD → STT → OpenClaw → TTS)
  - TurnCompletionEvent and TTSAudioEvent for pipeline bridging
  - Integration hooks in VoiceCallHandler for audio pipeline
  - 144 unit tests passing (31 VAD + 19 audio pipeline + 94 existing)
  - Build pipeline passing

- **v0.4.0**: Phase 4 - VAD Integration (completed)
  - Audio pipeline service for frame processing
  - Voice Activity Detection (VAD) service with energy-based speech detection
  - Turn detection with unique turn IDs and state machine
  - Frame-based timing for reliable testability
  - Configurable VAD thresholds (energy, silence, min speech duration)
  - VAD statistics (frame counter, speech duration, turns completed)
  - 144 unit tests passing (31 VAD + 19 audio pipeline + 94 existing)
  - Build pipeline passing

- **v0.3.0**: Phase 3 - LiveKit Integration (completed)
  - LiveKit service for room/token management
  - Matrix-LiveKit adapter bridge
  - Async method signature fixes (generateToken, getUserId)
  - Unit tests (94 passing)
  - Build pipeline passing

- **v0.2.0**: Phase 2 - Call media plumbing
  - Matrix call event handling
  - Call session management
  - Text-simulated voice calls
  - Unit tests (50 passing)

- **v0.1.0**: Initial MVP
  - Text-based voice simulation
  - OpenClaw API integration
  - Chatterbox TTS
