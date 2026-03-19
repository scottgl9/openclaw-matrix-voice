/**
 * Matrix-LiveKit Adapter
 * 
 * Bridges Matrix call events with LiveKit room media streams.
 * This adapter allows the existing Matrix call handling path to work
 * with LiveKit as the media backend while preserving fallback behavior.
 * 
 * Phase 3 Implementation:
 * - Maps Matrix rooms to LiveKit rooms
 * - Routes call events to LiveKit operations
 * - Provides media stream interface for STT/TTS integration
 * - Falls back to text-simulated calls if LiveKit is unavailable
 */

import { EventEmitter } from 'events';
import { LiveKitService, LiveKitRoom } from './livekit-service.js';
import { MatrixClient } from 'matrix-bot-sdk';

export interface MatrixLiveKitAdapterConfig {
  liveKitEnabled: boolean;
  liveKitService?: LiveKitService;
  fallbackToText: boolean;
}

export interface CallMediaStream {
  roomId: string;
  streamId: string;
  type: 'audio' | 'video';
  direction: 'inbound' | 'outbound';
  data: Buffer;
}

export class MatrixLiveKitAdapter extends EventEmitter {
  private liveKitService: LiveKitService | null;
  private matrixClient: MatrixClient;
  private config: MatrixLiveKitAdapterConfig;
  private activeConnections: Map<string, { 
    matrixRoomId: string;
    liveKitRoom?: LiveKitRoom;
    connectedAt: Date;
  }>;

  constructor(
    matrixClient: MatrixClient,
    config: MatrixLiveKitAdapterConfig
  ) {
    super();
    this.matrixClient = matrixClient;
    this.config = config;
    this.liveKitService = config.liveKitService || null;
    this.activeConnections = new Map();
  }

  /**
   * Initialize the adapter
   */
  async initialize(): Promise<void> {
    console.log('[Matrix-LiveKit] Initializing adapter...');
    
    if (this.config.liveKitEnabled && this.liveKitService) {
      // Verify LiveKit connectivity
      try {
        const rooms = await this.liveKitService.listRooms();
        console.log(`[Matrix-LiveKit] LiveKit connected, ${rooms.length} rooms available`);
      } catch (error: any) {
        console.warn('[Matrix-LiveKit] LiveKit connection warning:', error.message);
        if (!this.config.fallbackToText) {
          throw new Error('LiveKit not available and fallback disabled');
        }
      }
    } else {
      console.log('[Matrix-LiveKit] LiveKit disabled, using fallback mode');
    }

    console.log('[Matrix-LiveKit] Adapter initialized');
  }

  /**
   * Start a call in a Matrix room
   * Returns true if LiveKit was used, false if fallback
   */
  async startCall(
    matrixRoomId: string,
    userId: string
  ): Promise<{ success: boolean; useLiveKit: boolean; error?: string }> {
    console.log(`[Matrix-LiveKit] Starting call in ${matrixRoomId}`);

    // Check if LiveKit is available
    if (this.config.liveKitEnabled && this.liveKitService?.isServiceRunning()) {
      try {
        // Create LiveKit room
        const liveKitRoom = await this.liveKitService.createRoom(matrixRoomId);
        
        // Generate token for user
        const token = await this.liveKitService.generateToken(
          liveKitRoom.name,
          userId
        );

        // Track connection
        this.activeConnections.set(matrixRoomId, {
          matrixRoomId,
          liveKitRoom,
          connectedAt: new Date(),
        });

        console.log(`[Matrix-LiveKit] Call started via LiveKit: ${liveKitRoom.name}`);
        
        this.emit('call.started', {
          matrixRoomId,
          liveKitRoom,
          token,
        });

        return { success: true, useLiveKit: true };
      } catch (error: any) {
        console.error('[Matrix-LiveKit] LiveKit call start failed:', error.message);
        
        if (this.config.fallbackToText) {
          console.log('[Matrix-LiveKit] Falling back to text-simulated call');
          return { success: false, useLiveKit: false, error: error.message };
        }
        
        return { success: false, useLiveKit: false, error: error.message };
      }
    }

    // Fallback: No LiveKit available
    console.log('[Matrix-LiveKit] LiveKit not available, using fallback');
    return { success: false, useLiveKit: false };
  }

  /**
   * End a call in a Matrix room
   */
  async endCall(matrixRoomId: string): Promise<void> {
    console.log(`[Matrix-LiveKit] Ending call in ${matrixRoomId}`);

    const connection = this.activeConnections.get(matrixRoomId);
    if (connection?.liveKitRoom) {
      try {
        await this.liveKitService?.deleteRoom(matrixRoomId);
      } catch (error: any) {
        console.error('[Matrix-LiveKit] Error deleting LiveKit room:', error.message);
      }
    }

    this.activeConnections.delete(matrixRoomId);
    this.emit('call.ended', { matrixRoomId });
  }

  /**
   * Handle inbound audio from LiveKit
   * This is where STT integration would happen
   */
  handleInboundAudio(matrixRoomId: string, stream: CallMediaStream): void {
    console.log(`[Matrix-LiveKit] Inbound audio from ${stream.streamId}: ${stream.data.length} bytes`);
    
    // Emit for processing (STT integration point)
    this.emit('media.inbound', {
      matrixRoomId,
      stream,
    });
  }

  /**
   * Send outbound audio to LiveKit
   * This is where TTS audio would be sent
   */
  async handleOutboundAudio(
    matrixRoomId: string,
    audioData: Buffer,
    mimeType: string
  ): Promise<void> {
    console.log(`[Matrix-LiveKit] Outbound audio: ${audioData.length} bytes`);

    const connection = this.activeConnections.get(matrixRoomId);
    if (!connection) {
      console.warn('[Matrix-LiveKit] No active connection for outbound audio');
      return;
    }

    // In a full implementation, this would send audio via LiveKit data channel
    // or encode and send through the media stream
    // For now, just emit the event for tracking
    
    const stream: CallMediaStream = {
      roomId: matrixRoomId,
      streamId: `audio-${Date.now()}`,
      type: 'audio',
      direction: 'outbound',
      data: audioData,
    };

    this.emit('media.outbound', {
      matrixRoomId,
      stream,
      mimeType,
    });
  }

  /**
   * Get connection info for a Matrix room
   */
  getConnection(matrixRoomId: string): {
    matrixRoomId: string;
    liveKitRoom?: LiveKitRoom;
    connectedAt: Date;
    duration: number;
  } | undefined {
    const connection = this.activeConnections.get(matrixRoomId);
    if (!connection) {
      return undefined;
    }

    return {
      ...connection,
      duration: Date.now() - connection.connectedAt.getTime(),
    };
  }

  /**
   * Check if LiveKit is available for a call
   */
  isLiveKitAvailable(): boolean {
    return !!(
      this.config.liveKitEnabled &&
      this.liveKitService?.isServiceRunning()
    );
  }

  /**
   * Get adapter statistics
   */
  getStats(): {
    activeConnections: number;
    liveKitEnabled: boolean;
    liveKitConnected: boolean;
  } {
    return {
      activeConnections: this.activeConnections.size,
      liveKitEnabled: this.config.liveKitEnabled,
      liveKitConnected: this.isLiveKitAvailable(),
    };
  }
}
