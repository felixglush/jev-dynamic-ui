"""A small Whisper server for the app's batch speech-to-text: the record-then-transcribe mode and the optional second
pass (STT_REFINE=on). It serves POST /v1/audio/transcriptions, the shape OpenAI's API has and the app's
OpenAiCompatibleStt speaks, with faster-whisper (CPU, int8) behind it.

    pip install -r voice/server/requirements-whisper.txt
    python voice/server/whisper_server.py --model small.en --port 8000

Then set STT_URL=http://127.0.0.1:8000 for the app. It runs the one model it was started with and ignores the
`model` field the app sends, so STT_MODEL can stay at its default. The first start downloads the model from
Hugging Face (small.en is about 460 MB).

The model is swappable by config: `--engine` (or WHISPER_ENGINE) picks an adapter from ENGINES, and `--model` (or
WHISPER_MODEL) is passed to it. To add a model, write a class with the `Transcriber` shape and add one line to ENGINES.
"""
import argparse
import io
import logging
import os
import threading
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


# Engine name -> adapter constructor `(model, threads) -> Transcriber`. Add a line here for a new model.
ENGINES: dict[str, Callable[[str, int], Transcriber]] = {
    "faster-whisper": FasterWhisper,
}


def create_transcriber(engine: str, model: str, threads: int) -> Transcriber:
    if engine not in ENGINES:
        raise ValueError(f"Unknown engine {engine!r}; choose one of: {', '.join(sorted(ENGINES))}")
    return ENGINES[engine](model, threads)


def create_app(transcriber: Transcriber) -> FastAPI:
    app = FastAPI(title="whisper server")

    # A plain `def`: FastAPI runs it on a worker thread, so a slow clip doesn't block other requests.
    @app.post("/v1/audio/transcriptions")
    def transcriptions(file: UploadFile = File(...), language: str = Form("en")) -> dict[str, str]:
        data = file.file.read(MAX_AUDIO_BYTES + 1)
        if not data:
            raise HTTPException(status_code=400, detail="No audio was received.")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="That recording is too large.")
        try:
            return {"text": transcriber.transcribe(io.BytesIO(data), language)}
        except Exception:
            log.exception("transcription failed")
            raise HTTPException(status_code=500, detail="Transcription failed.")  # detail stays in the log

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", default=os.environ.get("WHISPER_ENGINE", "faster-whisper"), choices=sorted(ENGINES),
                        help="which adapter runs the model (env WHISPER_ENGINE)")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "small.en"),
                        help="the engine's model name, e.g. tiny.en, base.en, small.en (env WHISPER_MODEL)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--threads", type=int, default=4, help="CPU threads for the model")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)

    transcriber = create_transcriber(args.engine, args.model, args.threads)
    # One second of silence, so the first real clip doesn't pay for the model's start-up work.
    import numpy as np

    transcriber.transcribe(np.zeros(16_000, dtype=np.float32), "en")
    print(f"whisper server ({args.engine}: {args.model}) listening on http://{args.host}:{args.port}", flush=True)
    uvicorn.run(create_app(transcriber), host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
