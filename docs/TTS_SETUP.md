# TTS Service Setup

The bot uses TTS to convert LLM text responses into audio. It expects `POST http://localhost:8000/tts` with `{text, format, sampleRate}` returning WAV audio.

## Option 1: Chatterbox TTS (Primary)

[Chatterbox](https://github.com/resemble-ai/chatterbox) is an open-source TTS model with natural-sounding output.

### Requirements
- Python 3.10+
- ~4GB disk (model weights)
- GPU recommended (CUDA), works on CPU (slower)

### Install

```bash
python3 -m venv ~/.local/share/chatterbox-venv
source ~/.local/share/chatterbox-venv/bin/activate
pip install chatterbox-tts flask
```

### Run the server

Create `infra/chatterbox-server/server.py` or use your own wrapper:

```python
from flask import Flask, request, Response
from chatterbox.tts import ChatterboxTTS
import torch, io, soundfile as sf

app = Flask(__name__)
model = ChatterboxTTS.from_pretrained(device="cuda" if torch.cuda.is_available() else "cpu")

@app.route("/tts", methods=["POST"])
def tts():
    data = request.json
    text = data.get("text", "")
    sample_rate = int(data.get("sampleRate", 16000))

    wav = model.generate(text)
    buf = io.BytesIO()
    sf.write(buf, wav.squeeze().cpu().numpy(), sample_rate, format="WAV")
    buf.seek(0)
    return Response(buf.read(), mimetype="audio/wav")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
```

```bash
~/.local/share/chatterbox-venv/bin/python3 infra/chatterbox-server/server.py
```

### Env config

```bash
CHATTERBOX_TTS_URL=http://localhost:8000/tts
CHATTERBOX_TTS_API_KEY=          # optional, if your server requires auth
```

---

## Option 2: Piper TTS (Lightweight, Fast)

[Piper](https://github.com/rhasspy/piper) runs on CPU with minimal latency. Great for low-resource setups.

### Docker

```bash
docker run -p 8000:8000 rhasspy/piper --voice en_US-lessac-medium
```

Piper's native HTTP API differs from the expected format. You'll need a thin wrapper that accepts `{text, format, sampleRate}` and calls Piper's `/api/tts` endpoint internally. Alternatively, adapt `ChatterboxTTSService` to Piper's API format.

### Binary install

```bash
# Download from https://github.com/rhasspy/piper/releases
# Download a voice model from https://huggingface.co/rhasspy/piper-voices
./piper --model en_US-lessac-medium.onnx --output_file - < input.txt > output.wav
```

---

## Option 3: Edge TTS (Free, No GPU)

[edge-tts](https://github.com/rany2/edge-tts) uses Microsoft Edge's online TTS service. Free, no GPU needed, but requires internet.

### Install

```bash
pip install edge-tts flask
```

### Wrapper server

```python
from flask import Flask, request, Response
import edge_tts, asyncio, io

app = Flask(__name__)

@app.route("/tts", methods=["POST"])
def tts():
    data = request.json
    text = data.get("text", "")

    async def generate():
        communicate = edge_tts.Communicate(text, "en-US-AriaNeural")
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    audio = asyncio.run(generate())
    return Response(audio, mimetype="audio/mp3")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
```

> Note: Edge TTS returns MP3 by default. You may need to convert to WAV or update `ChatterboxTTSService` to handle MP3.

---

## Testing

Verify TTS is responding:

```bash
curl -X POST http://localhost:8000/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world", "format": "wav", "sampleRate": 16000}' \
  --output test.wav

# Play it (Linux)
aplay test.wav
# or
ffplay test.wav
```

If you get a valid WAV file back, TTS is ready.

## Env config summary

```bash
# In your .env file:
CHATTERBOX_TTS_URL=http://localhost:8000/tts
CHATTERBOX_TTS_API_KEY=          # optional
```
