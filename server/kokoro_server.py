"""
Kokoro TTS Server
=================
A FastAPI server that wraps Kokoro-82M and exposes a simple /tts endpoint
compatible with the existing ChatterboxTTSService in openclaw-matrix-voice.

Drop-in replacement for Chatterbox — same request/response shape.

Usage:
    pip install -r server/requirements-kokoro.txt
    uvicorn server.kokoro_server:app --host 0.0.0.0 --port 8002

    # Or run directly:
    python server/kokoro_server.py

Environment variables:
    KOKORO_VOICE    Voice name (default: af_heart — warm female)
    KOKORO_LANG     Language code (default: a = American English)
    KOKORO_PORT     Server port (default: 8002)
    KOKORO_HOST     Server host (default: 0.0.0.0)
    KOKORO_SPEED    Speech speed multiplier (default: 1.0)

Available voices (American English):
    af_heart    Warm, friendly female (recommended for assistant)
    af_bella    Expressive female
    af_nova     Clear, neutral female
    am_adam     Male
    am_echo     Male, deeper

British English voices (lang=b):
    bf_emma, bf_isabella, bm_george, bm_lewis
"""

import io
import os
import logging
import time
import struct
import wave
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("kokoro_server")

VOICE = os.environ.get("KOKORO_VOICE", "af_heart")
LANG = os.environ.get("KOKORO_LANG", "a")
PORT = int(os.environ.get("KOKORO_PORT", "8002"))
HOST = os.environ.get("KOKORO_HOST", "0.0.0.0")
SPEED = float(os.environ.get("KOKORO_SPEED", "1.0"))

# Global pipeline reference (loaded at startup)
kokoro_pipeline = None
SAMPLE_RATE = 24000  # Kokoro native output rate


def load_model():
    global kokoro_pipeline
    log.info(f"Loading Kokoro pipeline (voice={VOICE}, lang={LANG})...")
    start = time.time()
    try:
        from kokoro import KPipeline
        kokoro_pipeline = KPipeline(lang_code=LANG)
        log.info(f"Kokoro pipeline ready in {time.time()-start:.1f}s")
    except ImportError:
        log.error("kokoro not installed. Run: pip install kokoro>=0.9.4 soundfile")
        raise
    except Exception as e:
        log.error(f"Failed to load Kokoro: {e}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    log.info(f"Kokoro TTS server ready on {HOST}:{PORT}")
    yield
    log.info("Kokoro server shutting down")


app = FastAPI(
    title="Kokoro TTS Server",
    description="Fast local TTS using Kokoro-82M, compatible with ChatterboxTTSService",
    version="1.0.0",
    lifespan=lifespan,
)


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = None
    format: str = "wav"
    sampleRate: int = 24000
    # Ignored Chatterbox-compat fields:
    exaggeration: float | None = None
    cfg_weight: float | None = None


def pcm_to_wav(pcm_samples, sample_rate: int) -> bytes:
    """Convert raw float32 numpy array to WAV bytes."""
    import numpy as np
    # Clamp and convert to int16
    pcm_int16 = np.clip(pcm_samples, -1.0, 1.0)
    pcm_int16 = (pcm_int16 * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_int16.tobytes())
    return buf.getvalue()


@app.get("/health")
def health():
    return {
        "status": "ok" if kokoro_pipeline is not None else "loading",
        "voice": VOICE,
        "sample_rate": SAMPLE_RATE,
    }


@app.post("/tts")
async def tts(req: TTSRequest):
    """
    Generate speech from text. Returns WAV audio.
    Drop-in compatible with ChatterboxTTSService.
    """
    if kokoro_pipeline is None:
        return JSONResponse(status_code=503, content={"error": "Model not loaded"})

    text = req.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "Empty text"})

    voice = req.voice or VOICE
    speed = req.speed or SPEED

    start = time.time()
    try:
        import numpy as np
        log.info(f'Synthesizing ({len(text)} chars): "{text[:60]}{"..." if len(text) > 60 else ""}"')

        # Collect all audio chunks
        audio_chunks = []
        generator = kokoro_pipeline(text, voice=voice, speed=speed)
        for _, _, audio in generator:
            if audio is not None:
                audio_chunks.append(audio)

        if not audio_chunks:
            return JSONResponse(status_code=500, content={"error": "No audio generated"})

        # Concatenate all chunks
        full_audio = np.concatenate(audio_chunks) if len(audio_chunks) > 1 else audio_chunks[0]
        wav_bytes = pcm_to_wav(full_audio, SAMPLE_RATE)

        elapsed = time.time() - start
        rtf = elapsed / (len(full_audio) / SAMPLE_RATE)
        log.info(f"Generated {len(wav_bytes)} bytes in {elapsed:.2f}s (RTF={rtf:.2f}x)")

        return Response(content=wav_bytes, media_type="audio/wav")

    except Exception as e:
        log.error(f"TTS synthesis failed: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    uvicorn.run(
        "server.kokoro_server:app",
        host=HOST,
        port=PORT,
        log_level="info",
        reload=False,
    )
