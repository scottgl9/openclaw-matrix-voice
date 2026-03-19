/**
 * Mock Whisper STT server for integration testing.
 * Exposes OpenAI-compatible /v1/audio/transcriptions endpoint.
 * Returns canned transcriptions based on audio length.
 */

import { createServer } from 'http';

const PORT = 8090;

const RESPONSES = [
  'Hello, how are you?',
  'Tell me about the weather',
  'What time is it?',
  'Thank you very much',
];

let requestCount = 0;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Models endpoint
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'whisper-1' }] }));
    return;
  }

  // Transcription endpoint
  if (url.pathname === '/v1/audio/transcriptions' && req.method === 'POST') {
    // Consume the body (multipart form data)
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }

    const text = RESPONSES[requestCount % RESPONSES.length];
    requestCount++;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      text,
      language: 'en',
    }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Mock Whisper server listening on port ${PORT}`);
});
