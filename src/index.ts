import { config, validateConfig } from './config/index.js';
import { OpenClawService } from './services/openclaw-service.js';
import { ChatterboxTTSService } from './services/chatterbox-tts-service.js';
import { createMatrixClientService, MatrixClientService } from './services/matrix-client-service.js';
import { STTService, MockSTTAdapter } from './services/stt-adapter.js';
import { WhisperSTTAdapter } from './services/whisper-stt-adapter.js';
import { HealthServer } from './services/health-server.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('Main');

async function main(): Promise<void> {
  log.info('OpenClaw Matrix Voice Call Service starting');

  // Validate configuration
  try {
    validateConfig();
    log.info('Configuration validated');
  } catch (error: any) {
    log.error('Configuration error', { error: error.message });
    process.exit(1);
  }

  // Initialize services
  log.info('Initializing services');

  const openClawService = new OpenClawService();
  log.info('OpenClaw API configured', { url: config.openclaw.apiUrl });

  const ttsService = new ChatterboxTTSService();
  log.info('Chatterbox TTS configured', { url: config.chatterbox.ttsUrl });

  // Initialize STT
  let sttService: STTService;
  if (config.whisper.url) {
    const whisperAdapter = new WhisperSTTAdapter({
      url: config.whisper.url,
      model: config.whisper.model,
      language: config.whisper.language,
    });
    sttService = new STTService(whisperAdapter);
    log.info('STT: Whisper', { url: config.whisper.url });
  } else {
    sttService = new STTService(new MockSTTAdapter(['Hello', 'Test transcription', 'Mock response']));
    log.info('STT: Mock (set WHISPER_URL to enable Whisper)');
  }
  await sttService.initialize();

  // Create Matrix client
  log.info('Connecting to Matrix');
  const matrixService = createMatrixClientService(openClawService, ttsService);

  try {
    await matrixService.start();
    log.info('Matrix client connected');

    const voiceCallHandler = matrixService.getVoiceCallHandler();
    voiceCallHandler.setSTTService(sttService);
    log.info('STT service wired to voice call handler');

    // Attempt to recover calls from previous run
    await voiceCallHandler.recoverSessions();
  } catch (error: any) {
    log.error('Failed to connect to Matrix', { error: error.message });
    process.exit(1);
  }

  // Start health check server
  const healthServer = new HealthServer(() => ({
    matrixConnected: matrixService.isRunningStatus(),
    livekitEnabled: config.livekit.enabled,
    sttReady: sttService.isRunningFlag(),
    activeCalls: matrixService.getVoiceCallHandler().getActiveCallCount(),
    uptime: Math.floor(process.uptime()),
  }));
  await healthServer.start(config.server.port, config.server.host);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`${signal} received, shutting down gracefully`);
    try {
      await healthServer.stop();
      await matrixService.stop();
      await sttService.shutdown();
    } catch (error: any) {
      log.error('Error during shutdown', { error: error.message });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info('Service is running', {
    healthEndpoint: `http://${config.server.host}:${config.server.port}/healthz`,
    livekitEnabled: config.livekit.enabled,
    stt: config.whisper.url ? 'Whisper' : 'Mock',
    audioSampleRate: config.audio.sampleRate,
  });
  console.log('\nCommands:');
  console.log('  /call start         - Start a text-simulated voice call');
  console.log('  /call start livekit - Start a LiveKit voice call');
  console.log('  /call end           - End a voice call');
  console.log('  /call status        - Show call status');
}

main().catch((error) => {
  log.error('Fatal error', { error: error.message });
  process.exit(1);
});
