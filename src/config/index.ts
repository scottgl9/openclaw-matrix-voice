import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  matrix: {
    homeserver: string;
    userId: string;
    accessToken: string;
    voiceCallRoomId?: string;
  };
  openclaw: {
    apiUrl: string;
    apiToken: string;
    agentId: string;
    systemPrompt: string;
    maxConversationHistory: number;
  };
  chatterbox: {
    ttsUrl: string;
    apiKey?: string;
  };
  livekit: {
    enabled: boolean;
    url: string;
    apiKey: string;
    apiSecret: string;
    jwtServiceUrl: string;
  };
  whisper: {
    url: string;
    model?: string;
    language?: string;
  };
  server: {
    port: number;
    host: string;
  };
  audio: {
    sampleRate: number;
    format: string;
    frameDurationMs: number;
    channels: number;
  };
  vad: {
    energyThreshold: number;
    silenceThresholdMs: number;
    minSpeechDurationMs: number;
    preRollMs: number;
    postRollMs: number;
    adaptiveThreshold: boolean;
    adaptiveMultiplier: number;
    hangoverFrames: number;
    debug: boolean;
  };
  bargeIn: {
    enabled: boolean;
    minDurationMs: number;
  };
}

export const config: Config = {
  matrix: {
    homeserver: process.env.MATRIX_HOMESERVER || 'https://matrix.org',
    userId: process.env.MATRIX_USER_ID || '',
    accessToken: process.env.MATRIX_ACCESS_TOKEN || '',
    voiceCallRoomId: process.env.VOICE_CALL_ROOM_ID,
  },
  openclaw: {
    apiUrl: process.env.OPENCLAW_API_URL || 'http://localhost:18789',
    apiToken: process.env.OPENCLAW_API_TOKEN || '',
    agentId: process.env.OPENCLAW_AGENT_ID || 'personal-agent',
    systemPrompt: process.env.OPENCLAW_SYSTEM_PROMPT || 'You are a helpful voice assistant. Keep responses brief and conversational — 1-2 sentences max. Avoid markdown, bullet points, or formatted text. Speak naturally as if in a phone call.',
    maxConversationHistory: parseInt(process.env.MAX_CONVERSATION_HISTORY || '20', 10),
  },
  chatterbox: {
    ttsUrl: process.env.CHATTERBOX_TTS_URL || 'http://localhost:8000/tts',
    apiKey: process.env.CHATTERBOX_TTS_API_KEY,
  },
  livekit: {
    enabled: process.env.LIVEKIT_ENABLED === 'true',
    url: process.env.LIVEKIT_URL || 'ws://localhost:7880',
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
    jwtServiceUrl: process.env.LIVEKIT_JWT_SERVICE_URL || '',
  },
  whisper: {
    url: process.env.WHISPER_URL || '',
    model: process.env.WHISPER_MODEL || 'whisper-1',
    language: process.env.WHISPER_LANGUAGE || 'en',
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000', 10),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  audio: {
    sampleRate: parseInt(process.env.SAMPLE_RATE || '16000', 10),
    format: process.env.AUDIO_FORMAT || 'pcm16',
    frameDurationMs: parseInt(process.env.FRAME_DURATION_MS || '20', 10),
    channels: parseInt(process.env.AUDIO_CHANNELS || '1', 10),
  },
  vad: {
    energyThreshold: parseFloat(process.env.VAD_ENERGY_THRESHOLD || '0.3'),
    silenceThresholdMs: parseInt(process.env.VAD_SILENCE_THRESHOLD_MS || '1200', 10),
    minSpeechDurationMs: parseInt(process.env.VAD_MIN_SPEECH_MS || '200', 10),
    preRollMs: parseInt(process.env.VAD_PRE_ROLL_MS || '100', 10),
    postRollMs: parseInt(process.env.VAD_POST_ROLL_MS || '150', 10),
    adaptiveThreshold: process.env.VAD_ADAPTIVE_THRESHOLD === 'true',
    adaptiveMultiplier: parseFloat(process.env.VAD_ADAPTIVE_MULTIPLIER || '3.0'),
    hangoverFrames: parseInt(process.env.VAD_HANGOVER_FRAMES || '10', 10),
    debug: process.env.VAD_DEBUG === 'true',
  },
  bargeIn: {
    enabled: process.env.BARGE_IN_ENABLED === 'true',
    minDurationMs: parseInt(process.env.BARGE_IN_MIN_DURATION_MS || '800', 10),
  },
};

const VALID_SAMPLE_RATES = [8000, 16000, 22050, 44100, 48000];

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.matrix.userId) {
    errors.push('MATRIX_USER_ID is required');
  }
  if (!config.matrix.accessToken) {
    errors.push('MATRIX_ACCESS_TOKEN is required');
  }
  if (!config.openclaw.apiToken) {
    errors.push('OPENCLAW_API_TOKEN is required');
  }

  // Validate LiveKit config if enabled
  if (config.livekit.enabled) {
    if (!config.livekit.url) {
      errors.push('LIVEKIT_URL is required when LIVEKIT_ENABLED=true');
    }
    if (!config.livekit.apiKey) {
      errors.push('LIVEKIT_API_KEY is required when LIVEKIT_ENABLED=true');
    }
    if (!config.livekit.apiSecret) {
      errors.push('LIVEKIT_API_SECRET is required when LIVEKIT_ENABLED=true');
    }
  }

  // Validate audio format
  if (config.audio.format !== 'pcm16') {
    errors.push(`Unsupported audio format "${config.audio.format}" - only "pcm16" is supported`);
  }
  if (!VALID_SAMPLE_RATES.includes(config.audio.sampleRate)) {
    errors.push(`Invalid sample rate ${config.audio.sampleRate} - valid: ${VALID_SAMPLE_RATES.join(', ')}`);
  }
  if (config.audio.channels < 1 || config.audio.channels > 2) {
    errors.push(`Invalid channel count ${config.audio.channels} - must be 1 or 2`);
  }
  if (config.audio.frameDurationMs < 5 || config.audio.frameDurationMs > 100) {
    errors.push(`Invalid frame duration ${config.audio.frameDurationMs}ms - must be 5-100`);
  }

  // Validate VAD config
  if (config.vad.energyThreshold < 0 || config.vad.energyThreshold > 1) {
    errors.push(`VAD energy threshold ${config.vad.energyThreshold} must be 0-1`);
  }
  if (config.vad.silenceThresholdMs < 100) {
    errors.push(`VAD silence threshold ${config.vad.silenceThresholdMs}ms must be >= 100`);
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
