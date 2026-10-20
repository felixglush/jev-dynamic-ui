"""A small speech-to-text server for the app's batch engine: the record-then-transcribe mode and the optional second
pass (STT_REFINE=on). It serves the shape OpenAI's API has, which the app's OpenAiCompatibleStt speaks:

    POST /v1/audio/transcriptions   multipart: file, model (optional), language
    GET  /v1/models                 the models this server can run, so the app can offer them in a dropdown

    uv venv && source .venv/bin/activate
    uv pip install -r voice/server/requirements-whisper.txt   # add requirements-qwen.txt for Qwen3-ASR
    python voice/server/whisper_server.py --port 8000

The model is chosen per request by the `model` field, so the app can swap models without restarting this server. A
model loads the first time it is asked for and stays loaded until more than --keep-loaded others have been used since
(the least recently used one is dropped), so memory stays bounded. --model (or WHISPER_MODEL) is the default, used
when a request names no model. The first use of a model downloads it from Hugging Face.

Two layers make a model swappable by config: MODELS maps an id the app can ask for to an engine and that engine's own
model name, and ENGINES maps an engine name to the adapter class that runs it. To add a model of a kind that exists,
add one line to MODELS; to add a new kind, write a class with the `Transcriber` shape and add one line to ENGINES.
"""
import argparse
import collections
import importlib.util
import io
import json
import logging
import os
import threading
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Protocol

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

log = logging.getLogger("whisper_server")

# The app sends at most about 1 MB (20 s of audio); anything far bigger is not from the app.
MAX_AUDIO_BYTES = 5_000_000


class Transcriber(Protocol):
    """What the HTTP side needs from a speech model. Adapters implement this; nothing else knows which model runs."""

    def transcribe(self, audio: Any, language: str) -> str:
        """Text for one clip: a file-like object holding any audio file, or a float32 array of 16 kHz samples."""


class FasterWhisper:
    """faster-whisper on CPU with 8-bit weights and greedy decoding, the settings the benchmark in voice/bench used."""

    def __init__(self, model: str, threads: int):
        from faster_whisper import WhisperModel

        self._model = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=threads)
        self._lock = threading.Lock()  # one clip at a time: two at once would only slow each other down

    def transcribe(self, audio: Any, language: str) -> str:
        with self._lock:
            segments, _ = self._model.transcribe(audio, beam_size=1, language=language)
            return " ".join(segment.text.strip() for segment in segments).strip()  # a generator: read it inside the lock


def decode(audio: Any):
    """A float32 array of 16 kHz mono samples from any audio file (what the browser records is Opus in WebM)."""
    if not hasattr(audio, "read"):
        return audio
    from faster_whisper.audio import decode_audio

    return decode_audio(audio, sampling_rate=16_000)


class Qwen3Asr:
    """Qwen3-ASR in-process with transformers on CPU (float32). Needs voice/server/requirements-qwen.txt."""

    def __init__(self, model: str, threads: int):
        import torch
        from qwen_asr import Qwen3ASRModel

        torch.set_num_threads(threads)
        self._model = Qwen3ASRModel.from_pretrained(model, dtype=torch.float32, device_map="cpu")
        self._lock = threading.Lock()

    def transcribe(self, audio: Any, language: str) -> str:
        with self._lock:
            return self._model.transcribe(audio=(decode(audio), 16_000))[0].text.strip()


class LlamaCppAudio:
    """LFM2.5-Audio through Liquid's llama.cpp server (`llama-liquid-audio-server`, see voice/bench/run_lfm_audio.py),
    which this adapter calls over HTTP. The model name is the server's address, set with LFM_AUDIO_URL; the server
    only answers streamed chat requests, so the audio goes in whole as a WAV and the text streams back."""

    def __init__(self, model: str, threads: int):
        self._url = model.rstrip("/") + "/v1/chat/completions"

    def transcribe(self, audio: Any, language: str) -> str:
        import base64
        import wave

        samples = (decode(audio).clip(-1, 1) * 32767).astype("<i2")
        wav = io.BytesIO()
        with wave.open(wav, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(16_000)
            out.writeframes(samples.tobytes())
        body = {
            "messages": [
                {"role": "system", "content": "Perform ASR."},
                {"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": base64.b64encode(wav.getvalue()).decode(), "format": "wav"}}]},
            ],
            "max_tokens": 256,
            "stream": True,
        }
        request = urllib.request.Request(self._url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        text = ""
        for line in urllib.request.urlopen(request, timeout=120):
            line = line.decode().strip()
            if line.startswith("data:") and not line.endswith("[DONE]"):
                text += json.loads(line[5:])["choices"][0]["delta"].get("content") or ""
        return text.strip()


# Engine name -> adapter constructor `(model, threads) -> Transcriber`. Add a line here for a new kind of model.
ENGINES: dict[str, Callable[[str, int], Transcriber]] = {
    "faster-whisper": FasterWhisper,
    "qwen3-asr": Qwen3Asr,
    "llama-cpp-audio": LlamaCppAudio,
}


@dataclass(frozen=True)
class ModelSpec:
    engine: str
    model: str  # what the engine loads: a Hugging Face name, or for llama-cpp-audio the server's address
    label: str  # shown in the app's dropdown
    needs: str | None = None  # a Python module the engine imports, or None
    aliases: tuple[str, ...] = ()  # other ids the app may send for the same model


# Model id (what the app asks for) -> how to run it. Add a line here for a new model of an existing kind.
MODELS: dict[str, ModelSpec] = {
    "whisper-tiny.en": ModelSpec("faster-whisper", "tiny.en", "Whisper tiny.en"),
    "whisper-base.en": ModelSpec("faster-whisper", "base.en", "Whisper base.en"),
    "whisper-small.en": ModelSpec("faster-whisper", "small.en", "Whisper small.en", aliases=("Systran/faster-whisper-small.en",)),
    "whisper-medium.en": ModelSpec("faster-whisper", "medium.en", "Whisper medium.en"),
    "distil-small.en": ModelSpec("faster-whisper", "distil-small.en", "Distil-Whisper small.en"),
    "distil-medium.en": ModelSpec("faster-whisper", "distil-medium.en", "Distil-Whisper medium.en"),
    "qwen3-asr-0.6b": ModelSpec("qwen3-asr", "Qwen/Qwen3-ASR-0.6B", "Qwen3-ASR 0.6B", needs="qwen_asr"),
    "lfm2.5-audio": ModelSpec("llama-cpp-audio", os.environ.get("LFM_AUDIO_URL", ""), "LFM2.5-Audio 1.5B (llama.cpp)"),
}


def unavailable_reason(spec: ModelSpec) -> str | None:
    """Why this model can't run here (a missing package or server address), or None if it can."""
    if spec.needs and importlib.util.find_spec(spec.needs) is None:
        return f"install {spec.needs} (voice/server/requirements-qwen.txt)"
    if spec.engine == "llama-cpp-audio" and not spec.model:
        return "set LFM_AUDIO_URL to a running llama-liquid-audio-server"
    return None


def create_transcriber(engine: str, model: str, threads: int) -> Transcriber:
    if engine not in ENGINES:
        raise ValueError(f"Unknown engine {engine!r}; choose one of: {', '.join(sorted(ENGINES))}")
    return ENGINES[engine](model, threads)


class UnknownModel(ValueError):
    pass


class ModelPool:
    """Loads models on first use and keeps the `keep` most recently used, so a swap costs one load but memory stays bounded."""

    def __init__(self, default: str, threads: int, keep: int = 2, specs: dict[str, ModelSpec] | None = None,
                 make: Callable[[str, str, int], Transcriber] = create_transcriber):
        self._specs = MODELS if specs is None else specs
        if default not in self._specs:
            raise UnknownModel(f"Unknown model {default!r}; choose one of: {', '.join(self._specs)}")
        self.default, self._threads, self._keep, self._make = default, threads, max(1, keep), make
        self._loaded: collections.OrderedDict[str, Transcriber] = collections.OrderedDict()
        self._lock = threading.Lock()  # one load at a time: two at once would only fight over the CPU and memory

    def resolve(self, name: str | None) -> str:
        """The catalog id for what a request named: nothing means the default; an id or an alias means that model."""
        if not name:
            return self.default
        for model_id, spec in self._specs.items():
            if name == model_id or name in spec.aliases:
                return model_id
        raise UnknownModel(f"Unknown model {name!r}; choose one of: {', '.join(self._specs)}")

    def get(self, name: str | None) -> Transcriber:
        model_id = self.resolve(name)
        with self._lock:
            if model_id in self._loaded:
                self._loaded.move_to_end(model_id)
                return self._loaded[model_id]
            spec = self._specs[model_id]
            if reason := unavailable_reason(spec):
                raise UnknownModel(f"{model_id} isn't available on this server: {reason}")
            transcriber = self._make(spec.engine, spec.model, self._threads)
            self._loaded[model_id] = transcriber
            while len(self._loaded) > self._keep:
                self._loaded.popitem(last=False)
            return transcriber

    def listing(self) -> list[dict[str, Any]]:
        return [
            {"id": model_id, "label": spec.label, "engine": spec.engine, "loaded": model_id in self._loaded,
             "available": unavailable_reason(spec) is None}
            for model_id, spec in self._specs.items()
        ]


def create_app(pool: ModelPool) -> FastAPI:
    app = FastAPI(title="speech-to-text server")

    @app.get("/v1/models")
    def models() -> dict[str, Any]:
        return {"default": pool.default, "data": pool.listing()}

    # A plain `def`: FastAPI runs it on a worker thread, so a slow clip doesn't block other requests.
    @app.post("/v1/audio/transcriptions")
    def transcriptions(file: UploadFile = File(...), language: str = Form("en"), model: str | None = Form(None)) -> dict[str, str]:
        data = file.file.read(MAX_AUDIO_BYTES + 1)
        if not data:
            raise HTTPException(status_code=400, detail="No audio was received.")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="That recording is too large.")
        try:
            transcriber = pool.get(model)
        except UnknownModel as error:
            raise HTTPException(status_code=400, detail=str(error))
        except Exception:
            log.exception("loading the model failed")
            raise HTTPException(status_code=500, detail="Transcription failed.")
        try:
            return {"text": transcriber.transcribe(io.BytesIO(data), language)}
        except Exception:
            log.exception("transcription failed")
            raise HTTPException(status_code=500, detail="Transcription failed.")  # detail stays in the log

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "whisper-small.en"), choices=list(MODELS),
                        help="the default model id, used when a request names none (env WHISPER_MODEL)")
    parser.add_argument("--keep-loaded", type=int, default=2, help="how many models to keep in memory at once")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--threads", type=int, default=4, help="CPU threads for a model")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)

    pool = ModelPool(args.model, args.threads, args.keep_loaded)
    # One second of silence, so the first real clip doesn't pay for the default model's start-up work.
    import numpy as np

    pool.get(None).transcribe(np.zeros(16_000, dtype=np.float32), "en")
    print(f"speech server (default {args.model}) listening on http://{args.host}:{args.port}", flush=True)
    uvicorn.run(create_app(pool), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
