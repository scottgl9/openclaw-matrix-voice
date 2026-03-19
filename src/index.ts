import { config, validateConfig } from './config/index.js';
import { OpenClawService } from './services/openclaw-service.js';
import { ChatterboxTTSService } from './services/chatterbox-tts-service.js';
import { createMatrixClientService } from './services/matrix-client-service.js';
import { STTService, MockSTTAdapter } from './services/stt-adapter.js';
import { TurnProcessorService } from './services/turn-processor.js';

async function main(): Promise<void> {
  console.log('🎙️  OpenClaw Matrix Voice Call Service');
  console.log('======================================\n');

  // Validate configuration
  try {
    validateConfig();
    console.log('✅ Configuration validated');
  } catch (error: any) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
  }

  // Initialize services
  console.log('\n📡 Initializing services...');
  
  const openClawService = new OpenClawService();
  console.log('  - OpenClaw API:', config.openclaw.apiUrl);
  
  const ttsService = new ChatterboxTTSService();
  console.log('  - Chatterbox TTS:', config.chatterbox.ttsUrl);

  // Phase 5: Initialize STT and Turn Processor
  console.log('\n🎙️  Initializing Phase 5 components...');
  
  const sttService = new STTService(new MockSTTAdapter(['Hello', 'Test transcription', 'Mock response']));
  await sttService.initialize();
  console.log('  - STT Service:', sttService.getAdapterName());
  
  const turnProcessor = new TurnProcessorService(openClawService, ttsService, sttService);
  await turnProcessor.initialize();
  console.log('  - Turn Processor: Ready');

  // Create Matrix client
  console.log('\n🔐 Connecting to Matrix...');
  const matrixService = createMatrixClientService(openClawService, ttsService);
  
  try {
    await matrixService.start();
    console.log('✅ Matrix client connected\n');
    
    // Wire turn processor to voice call handler
    const voiceCallHandler = matrixService.getVoiceCallHandler();
    voiceCallHandler.setTurnProcessor(turnProcessor);
    console.log('  - Turn processor wired to voice call handler\n');
  } catch (error: any) {
    console.error('❌ Failed to connect to Matrix:', error.message);
    process.exit(1);
  }

  // Set up graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    matrixService.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n\n🛑 Shutting down...');
    matrixService.stop();
    process.exit(0);
  });

  console.log('Service is running. Press Ctrl+C to stop.\n');
  console.log('Commands:');
  console.log('  /call start    - Start a voice call');
  console.log('  /call end      - End a voice call');
  console.log('  /call status   - Show call status');
  console.log('\nVoice input format (text simulation for MVP):');
  console.log('  voice: <your message>');
  console.log('  speech: <your message>');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
