import { describe, it, expect, afterEach } from 'vitest';
import { HealthServer } from '../src/services/health-server.js';

describe('HealthServer', () => {
  let server: HealthServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should respond to /healthz with 200', async () => {
    server = new HealthServer(() => ({
      matrixConnected: true,
      livekitEnabled: false,
      sttReady: true,
      activeCalls: 0,
      uptime: 1,
    }));
    await server.start(0, '127.0.0.1'); // port 0 = random available port

    // Use internal server to get assigned port
    const addr = (server as any).server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('should respond to /readyz with 200 when ready', async () => {
    server = new HealthServer(() => ({
      matrixConnected: true,
      livekitEnabled: true,
      sttReady: true,
      activeCalls: 2,
      uptime: 100,
    }));
    await server.start(0, '127.0.0.1');

    const addr = (server as any).server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/readyz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ready');
    expect(data.activeCalls).toBe(2);
  });

  it('should respond to /readyz with 503 when not ready', async () => {
    server = new HealthServer(() => ({
      matrixConnected: false,
      livekitEnabled: false,
      sttReady: false,
      activeCalls: 0,
      uptime: 0,
    }));
    await server.start(0, '127.0.0.1');

    const addr = (server as any).server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/readyz`);
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('not ready');
  });

  it('should respond to /status with full details', async () => {
    server = new HealthServer(() => ({
      matrixConnected: true,
      livekitEnabled: true,
      sttReady: true,
      activeCalls: 1,
      uptime: 42,
    }));
    await server.start(0, '127.0.0.1');

    const addr = (server as any).server.address();
    const res = await fetch(`http://127.0.0.1:${addr.port}/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.matrixConnected).toBe(true);
    expect(data.livekitEnabled).toBe(true);
    expect(data.activeCalls).toBe(1);
  });
});
