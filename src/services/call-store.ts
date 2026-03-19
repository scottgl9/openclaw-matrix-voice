/**
 * Call Session Store
 *
 * Persists call state to a JSON file for recovery after restarts.
 * Uses a simple file-based approach (no external DB dependency).
 *
 * The store saves minimal call metadata — enough to know which rooms
 * had active calls so the bot can attempt to rejoin on startup.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CallStore');

export interface StoredCallSession {
  roomId: string;
  isLiveKitCall: boolean;
  livekitUrl?: string;
  livekitAlias?: string;
  startedAt: string; // ISO timestamp
}

export class CallStore {
  private filePath: string;
  private sessions: Map<string, StoredCallSession> = new Map();

  constructor(filePath: string = './data/call-sessions.json') {
    this.filePath = filePath;
  }

  /**
   * Load sessions from disk. Safe to call if file doesn't exist.
   */
  async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, 'utf-8');
      const parsed: StoredCallSession[] = JSON.parse(data);
      this.sessions.clear();
      for (const session of parsed) {
        this.sessions.set(session.roomId, session);
      }
      log.info(`Loaded ${this.sessions.size} stored call sessions`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        log.debug('No stored sessions file found, starting fresh');
      } else {
        log.warn('Error loading stored sessions', { error: error.message });
      }
    }
  }

  /**
   * Save current sessions to disk.
   */
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const data = JSON.stringify(Array.from(this.sessions.values()), null, 2);
      await writeFile(this.filePath, data, 'utf-8');
    } catch (error: any) {
      log.error('Error saving sessions', { error: error.message });
    }
  }

  /**
   * Record that a call started in a room.
   */
  async addSession(session: StoredCallSession): Promise<void> {
    this.sessions.set(session.roomId, session);
    await this.save();
  }

  /**
   * Record that a call ended.
   */
  async removeSession(roomId: string): Promise<void> {
    this.sessions.delete(roomId);
    await this.save();
  }

  /**
   * Get all stored sessions (for recovery on startup).
   */
  getSessions(): StoredCallSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get a specific session.
   */
  getSession(roomId: string): StoredCallSession | undefined {
    return this.sessions.get(roomId);
  }

  /**
   * Clear all stored sessions.
   */
  async clear(): Promise<void> {
    this.sessions.clear();
    await this.save();
  }
}
