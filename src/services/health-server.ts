/**
 * Health Check HTTP Server
 *
 * Provides /healthz (liveness) and /readyz (readiness) endpoints
 * for Kubernetes probes or any monitoring system.
 */

import express from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('HealthServer');

export interface HealthStatus {
  matrixConnected: boolean;
  livekitEnabled: boolean;
  sttReady: boolean;
  activeCalls: number;
  uptime: number;
}

type StatusProvider = () => HealthStatus;

export class HealthServer {
  private app: express.Express;
  private server: any = null;
  private statusProvider: StatusProvider;
  private startTime: number;

  constructor(statusProvider: StatusProvider) {
    this.app = express();
    this.statusProvider = statusProvider;
    this.startTime = Date.now();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Liveness: is the process alive?
    this.app.get('/healthz', (_req, res) => {
      res.status(200).json({ status: 'ok', uptime: Math.floor((Date.now() - this.startTime) / 1000) });
    });

    // Readiness: can the service handle requests?
    this.app.get('/readyz', (_req, res) => {
      const status = this.statusProvider();

      if (!status.matrixConnected) {
        res.status(503).json({ status: 'not ready', reason: 'Matrix not connected', ...status });
        return;
      }

      res.status(200).json({ status: 'ready', ...status });
    });

    // Detailed status
    this.app.get('/status', (_req, res) => {
      const status = this.statusProvider();
      res.status(200).json({
        ...status,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
      });
    });
  }

  async start(port: number, host: string): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(port, host, () => {
        log.info(`Health server listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          log.info('Health server stopped');
          resolve();
        });
      });
    }
  }
}
