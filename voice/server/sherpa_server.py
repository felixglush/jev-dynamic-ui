"""Streaming speech-to-text server: sherpa-onnx's streaming Zipformer behind the WebSocket protocol in
src/lib/stt/stream/protocol.ts (that file is the contract; this is one implementation of it).

    python voice/server/sherpa_server.py --model-dir voice/models/sherpa-onnx-streaming-zipformer-en-2023-06-26

One recognizer is loaded once and shared; each connection gets its own stream. Text is sent as the engine
produces it, so a partial goes out whenever the words so far change.
"""
import argparse
import asyncio
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import sherpa_onnx
import websockets

SAMPLE_RATE = 16_000
# Silence appended when the customer stops, so the engine finishes the last word before the final text is read.
TAIL_SILENCE_S = 1.0
# Silence put in front of the audio: the engine drops the first word if speech starts the instant the stream does.
LEAD_SILENCE_S = 0.5
# How long a pause ends the customer's turn: after they said something, and when they said nothing at all.
ENDPOINT_SILENCE_S = 1.0
ENDPOINT_EMPTY_S = 4.0
MAX_UTTERANCE_S = 30.0
# The chunk-16 model from the sherpa-onnx release; the int8 files are the quantized ones.
MODEL_SUFFIX = "chunk-16-left-128.int8.onnx"

log = logging.getLogger("sherpa_server")


def load_recognizer(
    model_dir: Path, threads: int, hotwords_file: Path | None = None, hotwords_score: float = 1.5
) -> sherpa_onnx.OnlineRecognizer:
    # Hotwords need beam search; without them greedy search is a little faster.
    biasing = {}
    if hotwords_file:
        biasing = dict(
            decoding_method="modified_beam_search",
            hotwords_file=str(hotwords_file),
            hotwords_score=hotwords_score,
            modeling_unit="bpe",
            bpe_vocab=str(model_dir / "bpe.vocab"),
        )
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(model_dir / "tokens.txt"),
        encoder=str(model_dir / f"encoder-epoch-99-avg-1-{MODEL_SUFFIX}"),
        decoder=str(model_dir / f"decoder-epoch-99-avg-1-{MODEL_SUFFIX}"),
        joiner=str(model_dir / f"joiner-epoch-99-avg-1-{MODEL_SUFFIX}"),
        num_threads=threads,
        # Silence after speech that means the customer is done (any text), or a long pause with no text at all.
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=ENDPOINT_EMPTY_S,
        rule2_min_trailing_silence=ENDPOINT_SILENCE_S,
        rule3_min_utterance_length=MAX_UTTERANCE_S,
        sample_rate=SAMPLE_RATE,
        feature_dim=80,
        **{"decoding_method": "greedy_search", **biasing},
    )


class Session:
    """One customer's speech: audio in, text out. Knows nothing about WebSockets."""

    def __init__(self, recognizer: sherpa_onnx.OnlineRecognizer):
        self.recognizer = recognizer
        self.stream = recognizer.create_stream()
        self.last_text = ""
        self.ended = False
        self.feed(np.zeros(int(LEAD_SILENCE_S * SAMPLE_RATE), dtype=np.float32))

    def feed(self, samples: np.ndarray) -> None:
        self.stream.accept_waveform(SAMPLE_RATE, samples)
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)

    def push_pcm16(self, frame: bytes) -> str | None:
        """Add a frame of 16-bit PCM. Returns the text so far if it changed, else None."""
        self.feed(np.frombuffer(frame, dtype="<i2").astype(np.float32) / 32768.0)
        text = self.text()
        if text and text != self.last_text:
            self.last_text = text
            return text
        return None

    def at_endpoint(self) -> bool:
        """True once, when the customer has said something and then paused long enough to be done."""
        if self.ended or not self.last_text or not self.recognizer.is_endpoint(self.stream):
            return False
        self.ended = True
        return True

    def finish(self) -> str:
        self.feed(np.zeros(int(TAIL_SILENCE_S * SAMPLE_RATE), dtype=np.float32))
        self.stream.input_finished()
        while self.recognizer.is_ready(self.stream):
            self.recognizer.decode_stream(self.stream)
        return self.text()

    def text(self) -> str:
        return self.recognizer.get_result(self.stream).strip()


async def handle(connection, recognizer: sherpa_onnx.OnlineRecognizer, pool: ThreadPoolExecutor) -> None:
    loop = asyncio.get_running_loop()
    session = Session(recognizer)
    started = False
    # Decoding is CPU work, so it runs on a thread; frames from one connection are handled in order.
    async for message in connection:
        if isinstance(message, bytes):
            if not started:
                continue
            text = await loop.run_in_executor(pool, session.push_pcm16, message)
            if text is not None:
                await connection.send(json.dumps({"type": "partial", "text": text}))
            if session.at_endpoint():
                await connection.send(json.dumps({"type": "endpoint"}))
            continue
        try:
            kind = json.loads(message).get("type")
        except (ValueError, AttributeError):
            continue
        if kind == "start":
            started = True
        elif kind == "stop":
            text = await loop.run_in_executor(pool, session.finish)
            await connection.send(json.dumps({"type": "final", "text": text}))
            await connection.close()
            return


async def serve(host: str, port: int, recognizer: sherpa_onnx.OnlineRecognizer, workers: int) -> None:
    pool = ThreadPoolExecutor(max_workers=workers)

    async def on_connection(connection):
        try:
            await handle(connection, recognizer, pool)
        except websockets.ConnectionClosed:
            pass

    async with websockets.serve(on_connection, host, port, max_size=1 << 20):
        log.info("listening on ws://%s:%d", host, port)
        print(f"sherpa server listening on ws://{host}:{port}", flush=True)
        await asyncio.get_running_loop().create_future()  # run until cancelled


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--threads", type=int, default=4, help="CPU threads for the model")
    parser.add_argument("--workers", type=int, default=2, help="connections decoded at the same time")
    parser.add_argument("--hotwords-file", type=Path, help="words to favour, prepared with prepare_hotwords.py")
    parser.add_argument("--hotwords-score", type=float, default=1.5, help="how strongly to favour them")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    recognizer = load_recognizer(args.model_dir, args.threads, args.hotwords_file, args.hotwords_score)
    asyncio.run(serve(args.host, args.port, recognizer, args.workers))


if __name__ == "__main__":
    main()
