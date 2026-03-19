import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CallStore } from '../src/services/call-store.js';
import { unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const TEST_FILE = './test-data/test-sessions.json';

describe('CallStore', () => {
  let store: CallStore;

  beforeEach(async () => {
    store = new CallStore(TEST_FILE);
    await mkdir('./test-data', { recursive: true });
  });

  afterEach(async () => {
    try {
      if (existsSync(TEST_FILE)) {
        await unlink(TEST_FILE);
      }
    } catch {}
  });

  it('should load gracefully when file does not exist', async () => {
    await store.load();
    expect(store.getSessions()).toEqual([]);
  });

  it('should save and load sessions', async () => {
    await store.addSession({
      roomId: '!room1:matrix.org',
      isLiveKitCall: true,
      livekitUrl: 'ws://localhost:7880',
      livekitAlias: 'room-1',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    await store.addSession({
      roomId: '!room2:matrix.org',
      isLiveKitCall: false,
      startedAt: '2026-01-01T01:00:00.000Z',
    });

    // Reload from disk
    const store2 = new CallStore(TEST_FILE);
    await store2.load();

    expect(store2.getSessions()).toHaveLength(2);
    expect(store2.getSession('!room1:matrix.org')?.livekitUrl).toBe('ws://localhost:7880');
    expect(store2.getSession('!room2:matrix.org')?.isLiveKitCall).toBe(false);
  });

  it('should remove sessions', async () => {
    await store.addSession({
      roomId: '!room1:matrix.org',
      isLiveKitCall: true,
      startedAt: new Date().toISOString(),
    });

    await store.removeSession('!room1:matrix.org');
    expect(store.getSessions()).toHaveLength(0);

    // Verify persisted
    const store2 = new CallStore(TEST_FILE);
    await store2.load();
    expect(store2.getSessions()).toHaveLength(0);
  });

  it('should clear all sessions', async () => {
    await store.addSession({
      roomId: '!room1:matrix.org',
      isLiveKitCall: true,
      startedAt: new Date().toISOString(),
    });
    await store.addSession({
      roomId: '!room2:matrix.org',
      isLiveKitCall: false,
      startedAt: new Date().toISOString(),
    });

    await store.clear();
    expect(store.getSessions()).toHaveLength(0);
  });

  it('should overwrite existing session for same room', async () => {
    await store.addSession({
      roomId: '!room1:matrix.org',
      isLiveKitCall: true,
      livekitUrl: 'ws://old:7880',
      startedAt: '2026-01-01T00:00:00.000Z',
    });

    await store.addSession({
      roomId: '!room1:matrix.org',
      isLiveKitCall: true,
      livekitUrl: 'ws://new:7880',
      startedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(store.getSessions()).toHaveLength(1);
    expect(store.getSession('!room1:matrix.org')?.livekitUrl).toBe('ws://new:7880');
  });
});
