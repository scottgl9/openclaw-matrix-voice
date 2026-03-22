"""
Orpheus TTS Server
==================
A FastAPI server wrapping Orpheus-3B-0.1-ft via llama.cpp for expressive,
emotionally-rich TTS on a local GPU.

Compatible with ChatterboxTTSService — same /tts endpoint and WAV response.

Setup:
    # 1. Download the GGUF model (choose one):
    #    Q4_K_M (recommended — best quality/size tradeoff, ~2GB):
    huggingface-cli download isaiahbjork/orpheus-3b-0.1-ft-Q4_K_M-GGUF \
        orpheus-3b-0.1-ft-q4_k_m.gguf --local-dir /home/scottgl/.local/share/orpheus/

    # 2. Install llama-cpp-python with CUDA:
    CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python --upgrade

    # 3. Install other deps:
    pip install -r server/requirements-orpheus.txt

    # 4. Run:
    uvicorn orpheus_server:app --host 0.0.0.0 --port 8003

Environment variables:
    ORPHEUS_MODEL_PATH   Path to GGUF file
    ORPHEUS_PORT         Server port (default: 8003)
    ORPHEUS_HOST         Server host (default: 0.0.0.0)
    ORPHEUS_VOICE        Voice preset (default: tara) — see below
    ORPHEUS_GPU_LAYERS   Layers to offload to GPU (default: -1 = all)

Available voices:
    tara    Warm, natural female (recommended)
    leah    Clear female
    jess    Upbeat female
    leo     Natural male
    dan     Deeper male
    mia     Soft female
    zac     Energetic male
    zoe     Expressive female

Emotion tags (inject into text):
    <laugh>  <chuckle>  <sigh>  <cough>  <sniffle>  <groan>  <yawn>  <gasp>
"""

import io
import os
import logging
import struct
import time
import wave
from contextlib import asynccontextmanager

import numpy as np
import uvicorn
from fastapi import FastAPI
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(name)s: %(message)s")
log = logging.getLogger("orpheus_server")

MODEL_PATH = os.environ.get(
    "ORPHEUS_MODEL_PATH",
    "/home/scottgl/.local/share/orpheus/orpheus-3b-0.1-ft-q4_k_m.gguf",
)
PORT = int(os.environ.get("ORPHEUS_PORT", "8003"))
HOST = os.environ.get("ORPHEUS_HOST", "0.0.0.0")
VOICE = os.environ.get("ORPHEUS_VOICE", "tara")
GPU_LAYERS = int(os.environ.get("ORPHEUS_GPU_LAYERS", "-1"))

SAMPLE_RATE = 24000  # Orpheus native output rate

# Special tokens for Orpheus token-to-audio decoding
ORPHEUS_START_TOKEN = 128259
ORPHEUS_END_TOKENS = {128009, 128260, 128261, 128262}
CUSTOM_TOKEN_PREFIX = 128263  # audio tokens start here

llm = None


def load_model():
    global llm
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Orpheus model not found at {MODEL_PATH}\n"
            f"Download with:\n"
            f"  huggingface-cli download isaiahbjork/orpheus-3b-0.1-ft-Q4_K_M-GGUF "
            f"orpheus-3b-0.1-ft-q4_k_m.gguf --local-dir /home/scottgl/.local/share/orpheus/"
        )

    log.info(f"Loading Orpheus model: {MODEL_PATH} (gpu_layers={GPU_LAYERS})")
    start = time.time()

    try:
        from llama_cpp import Llama
        llm = Llama(
            model_path=MODEL_PATH,
            n_gpu_layers=GPU_LAYERS,
            n_ctx=8192,
            verbose=False,
        )
        log.info(f"Orpheus model loaded in {time.time()-start:.1f}s")
    except ImportError:
        log.error(
            "llama-cpp-python not installed.\n"
            "Install with CUDA: CMAKE_ARGS='-DGGML_CUDA=on' pip install llama-cpp-python"
        )
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_model()
    log.info(f"Orpheus TTS server ready on {HOST}:{PORT}")
    yield
    log.info("Orpheus server shutting down")


app = FastAPI(
    title="Orpheus TTS Server",
    description="Expressive TTS using Orpheus-3B via llama.cpp",
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


def build_prompt(text: str, voice: str) -> str:
    """Build Orpheus prompt with voice token."""
    return f"<|audio|>{voice}: {text}<|eot_id|>"


def tokens_to_audio(token_ids: list[int]) -> np.ndarray:
    """
    Convert Orpheus output token IDs to audio samples.
    Orpheus encodes audio as groups of 7 custom tokens mapped to SNAC codec.
    """
    try:
        import snac
    except ImportError:
        raise ImportError(
            "snac not installed. Run: pip install snac"
        )

    # Extract audio tokens (those above CUSTOM_TOKEN_PREFIX)
    audio_tokens = []
    in_audio = False
    for tok in token_ids:
        if tok == ORPHEUS_START_TOKEN:
            in_audio = True
            continue
        if tok in ORPHEUS_END_TOKENS:
            break
        if in_audio and tok >= CUSTOM_TOKEN_PREFIX:
            audio_tokens.append(tok - CUSTOM_TOKEN_PREFIX)

    if not audio_tokens:
        return np.zeros(0, dtype=np.float32)

    # Orpheus uses SNAC 24kHz — tokens come in groups of 7
    # Group into frames
    frames = []
    for i in range(0, len(audio_tokens) - 6, 7):
        frames.append(audio_tokens[i:i+7])

    if not frames:
        return np.zeros(0, dtype=np.float32)

    # Decode with SNAC
    snac_model = snac.SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()

    import torch
    codes = [
        torch.tensor([f[0] for f in frames], dtype=torch.long).unsqueeze(0),
        torch.tensor([tok for f in frames for tok in f[1:3]], dtype=torch.long).unsqueeze(0),
        torch.tensor([tok for f in frames for tok in f[3:7]], dtype=torch.long).unsqueeze(0),
    ]

    with torch.no_grad():
        audio = snac_model.decode(codes)

    return audio.squeeze().numpy()


def pcm_to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    pcm_int16 = np.clip(samples, -1.0, 1.0)
    pcm_int16 = (pcm_int16 * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_int16.tobytes())
    return buf.getvalue()


@app.get("/health")
def health():
    return {
        "status": "ok" if llm is not None else "loading",
        "voice": VOICE,
        "sample_rate": SAMPLE_RATE,
        "model": os.path.basename(MODEL_PATH),
    }


@app.post("/tts")
async def tts(req: TTSRequest):
    """Generate speech. Returns WAV audio — drop-in for ChatterboxTTSService."""
    if llm is None:
        return JSONResponse(status_code=503, content={"error": "Model not loaded"})

    text = req.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "Empty text"})

    voice = req.voice or VOICE
    start = time.time()

    try:
        log.info(f'Synthesizing with voice={voice}: "{text[:60]}{"..." if len(text) > 60 else ""}"')

        prompt = build_prompt(text, voice)

        output = llm(
            prompt,
            max_tokens=1200,
            temperature=0.6,
            top_p=0.95,
            repeat_penalty=1.1,
            echo=False,
        )

        token_ids = output["choices"][0].get("logprobs", {}).get("token_ids", [])

        # Fallback: re-tokenize to get IDs if logprobs unavailable
        if not token_ids:
            raw_tokens = output["choices"][0]["text"]
            token_ids = llm.tokenize(raw_tokens.encode(), add_bos=False)

        audio_samples = tokens_to_audio(token_ids)

        if len(audio_samples) == 0:
            return JSONResponse(status_code=500, content={"error": "No audio decoded from tokens"})

        wav_bytes = pcm_to_wav(audio_samples, SAMPLE_RATE)
        elapsed = time.time() - start
        rtf = elapsed / (len(audio_samples) / SAMPLE_RATE)
        log.info(f"Synthesized {len(wav_bytes)} bytes in {elapsed:.2f}s (RTF={rtf:.2f}x)")

        return Response(content=wav_bytes, media_type="audio/wav")

    except Exception as e:
        log.error(f"TTS failed: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    uvicorn.run(
        "orpheus_server:app",
        host=HOST,
        port=PORT,
        log_level="info",
        reload=False,
    )
