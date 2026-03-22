"""
Parakeet STT Server
===================
A FastAPI server that wraps NVIDIA Parakeet ASR models and exposes an
OpenAI-compatible /v1/audio/transcriptions endpoint.

Compatible with whisper-stt-adapter.ts — no TypeScript changes needed.
Just set WHISPER_URL=http://localhost:8001 in your .env.

Usage:
    pip install -r server/requirements-parakeet.txt
    uvicorn server.parakeet_server:app --host 0.0.0.0 --port 8001

    # Or run directly:
    python server/parakeet_server.py

Environment variables:
    PARAKEET_MODEL   Model name (default: nvidia/parakeet-tdt-0.6b-v3)
    PARAKEET_PORT    Server port (default: 8001)
    PARAKEET_HOST    Server host (default: 0.0.0.0)
    PARAKEET_DEVICE  Device hint: auto, cuda, cpu (default: auto)

Model options:
    nvidia/parakeet-tdt-0.6b-v3    25 langs, punctuation, timestamps, ~2GB VRAM (recommended)
    nvidia/parakeet-tdt-0.6b-v2    English-only, fastest, ~2GB VRAM
    nvidia/parakeet-tdt-1.1b       Higher accuracy, ~5GB VRAM
    nvidia/parakeet-tdt_ctc-110m   Fast, lower accuracy — good for weaker GPU
    nvidia/canary-1b-v2            Multilingual 25 langs + translation
"""

import io
import os
import logging
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("parakeet_server")

MODEL_NAME = os.environ.get("PARAKEET_MODEL", "nvidia/parakeet-tdt-0.6b-v3")
PORT = int(os.environ.get("PARAKEET_PORT", "8001"))
HOST = os.environ.get("PARAKEET_HOST", "0.0.0.0")
DEVICE = os.environ.get("PARAKEET_DEVICE", "auto")

# Global model reference (loaded at startup)
asr_model = None


def load_model():
    global asr_model
    log.info(f"Loading Parakeet model: {MODEL_NAME}")
    start = time.time()
    try:
        import nemo.collections.asr as nemo_asr
        asr_model = nemo_asr.models.ASRModel.from_pretrained(MODEL_NAME)
        asr_model.eval()

        # Move to GPU if available and not forced to CPU
        if DEVICE != "cpu":
            try:
                import torch
                if torch.cuda.is_available():
                    asr_model = asr_model.cuda()
                    log.info(f"Model loaded on CUDA in {time.time()-start:.1f}s")
                else:
                    log.info(f"Model loaded on CPU (no CUDA) in {time.time()-start:.1f}s")
            except Exception as e:
                log.warning(f"Could not move model to GPU: {e}")
        else:
            log.info(f"Model loaded on CPU (forced) in {time.time()-start:.1f}s")

    except ImportError:
        log.error("nemo_toolkit not installed. Run: pip install nemo_toolkit[asr]")
        raise
    except Exception as e:
        log.error(f"Failed to load model {MODEL_NAME}: {e}")
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    log.info(f"Parakeet server ready on {HOST}:{PORT}")
    yield
    log.info("Parakeet server shutting down")


app = FastAPI(
    title="Parakeet STT Server",
    description="OpenAI-compatible speech-to-text API using NVIDIA Parakeet",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    return {
        "status": "ok" if asr_model is not None else "loading",
        "model": MODEL_NAME,
    }


@app.get("/v1/models")
def list_models():
    """OpenAI-compatible models endpoint."""
    return {
        "object": "list",
        "data": [
            {
                "id": MODEL_NAME,
                "object": "model",
                "created": 1700000000,
                "owned_by": "nvidia",
            }
        ],
    }


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form(default=None),
    language: str = Form(default="en"),
    response_format: str = Form(default="json"),
    temperature: float = Form(default=0.0),
    prompt: str = Form(default=None),
):
    """
    OpenAI-compatible transcription endpoint.
    Accepts audio/wav (16kHz mono PCM recommended — whisper-stt-adapter.ts sends this).
    """
    if asr_model is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Model not loaded yet, try again shortly"},
        )

    start = time.time()

    # Read uploaded audio into a temp file
    audio_bytes = await file.read()
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        log.info(f"Transcribing {len(audio_bytes)} bytes ({suffix})...")
        transcriptions = asr_model.transcribe([tmp_path])
        text = transcriptions[0] if transcriptions else ""
        elapsed = time.time() - start
        log.info(f'Transcribed in {elapsed:.2f}s: "{text[:80]}{"..." if len(text) > 80 else ""}"')
    except Exception as e:
        log.error(f"Transcription failed: {e}")
        return JSONResponse(
            status_code=500,
            content={"error": f"Transcription failed: {str(e)}"},
        )
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    if response_format == "text":
        return text

    if response_format == "verbose_json":
        return JSONResponse({
            "task": "transcribe",
            "language": language,
            "duration": elapsed,
            "text": text,
            "segments": [],
            "words": [],
        })

    # Default: json
    return JSONResponse({"text": text})


if __name__ == "__main__":
    uvicorn.run(
        "server.parakeet_server:app",
        host=HOST,
        port=PORT,
        log_level="info",
        reload=False,
    )
