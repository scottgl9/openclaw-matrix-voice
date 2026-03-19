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
  };
  chatterbox: {
    ttsUrl: string;
    apiKey?: string;
  };
  server: {
    port: number;
    host: string;
  };
  audio: {
    sampleRate: number;
    format: string;
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
  },
  chatterbox: {
    ttsUrl: process.env.CHATTERBOX_TTS_URL || 'http://localhost:8000/tts',
    apiKey: process.env.CHATTERBOX_TTS_API_KEY,
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000', 10),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },
  audio: {
    sampleRate: parseInt(process.env.SAMPLE_RATE || '16000', 10),
    format: process.env.AUDIO_FORMAT || 'pcm16',
  },
};

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

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
