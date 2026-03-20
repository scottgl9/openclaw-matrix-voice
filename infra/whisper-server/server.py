#!/usr/bin/env python3
"""
Local Whisper STT server with OpenAI-compatible /v1/audio/transcriptions endpoint.
Uses faster-whisper (CTranslate2) for CPU-optimized inference.
"""

import io
import os
import sys
import tempfile
import logging

from flask import Flask, request, jsonify

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("whisper-server")

app = Flask(__name__)

# Lazy-load model on first request
_model = None
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "tiny")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        log.info(f"Loading Whisper model: {MODEL_SIZE} (device={DEVICE}, compute={COMPUTE_TYPE})")
        _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("Model loaded successfully")
    return _model


@app.route("/v1/audio/transcriptions", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    audio_file = request.files["file"]
    language = request.form.get("language", "en")
    prompt = request.form.get("prompt", None)

    # Write to temp file (faster-whisper needs a file path)
    suffix = os.path.splitext(audio_file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    try:
        model = get_model()
        segments, info = model.transcribe(
            tmp_path,
            language=language if language else None,
            initial_prompt=prompt,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(
                min_speech_duration_ms=250,
                min_silence_duration_ms=200,
                speech_pad_ms=100,
            ),
            no_speech_threshold=0.6,
            log_prob_threshold=-1.0,
            condition_on_previous_text=False,
        )

        text = " ".join(segment.text.strip() for segment in segments)
        log.info(f"Transcribed ({info.language}, {info.duration:.1f}s): {text[:100]}")

        return jsonify({"text": text})
    except Exception as e:
        log.error(f"Transcription error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp_path)


@app.route("/v1/models", methods=["GET"])
def list_models():
    return jsonify({
        "data": [{"id": MODEL_SIZE, "object": "model", "owned_by": "local"}]
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": MODEL_SIZE})


if __name__ == "__main__":
    port = int(os.environ.get("WHISPER_PORT", "8090"))
    host = os.environ.get("WHISPER_HOST", "127.0.0.1")

    # Pre-load model at startup
    log.info(f"Starting Whisper server on {host}:{port}")
    get_model()

    app.run(host=host, port=port, threaded=True)
