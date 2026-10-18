"""Tests for the streaming server's own logic, using a scripted stand-in for the recognizer so no model is needed.
They prove the protocol handling (partials when the text changes, a final after stop, frames in order), not how well
the real model hears: voice/bench/stream_bench.py measures that against the real model.

    python -m unittest voice/server/test_sherpa_server.py   (from the repo root, in the server's virtualenv)
"""
import asyncio
import json
import sys
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import websockets

sys.path.insert(0, str(Path(__file__).parent))
import sherpa_server  # noqa: E402


class FakeStream:
    def __init__(self):
        self.samples = 0
        self.finished = False


class FakeRecognizer:
    """Says the next scripted text after each 0.1 s of audio fed, and the last one once the stream is finished."""

    def __init__(self, texts):
        self.texts = texts

    def create_stream(self):
        return FakeStream()

    def is_ready(self, stream):
        return False

    def decode_stream(self, stream):
        pass

    def get_result(self, stream):
        if stream.finished:
            return self.texts[-1]
        spoken = max(0, stream.samples - int(sherpa_server.LEAD_SILENCE_S * sherpa_server.SAMPLE_RATE))
        return self.texts[min(spoken // 1600, len(self.texts) - 1)] if spoken else ""


def accept(self, rate, samples):
    self.samples += len(samples)


def finish(self):
    self.finished = True


FakeStream.accept_waveform = accept
FakeStream.input_finished = finish


def frame(milliseconds=100):
    return np.zeros(int(milliseconds * 16), dtype="<i2").tobytes()


class ServerTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.pool = ThreadPoolExecutor(max_workers=2)

    async def asyncTearDown(self):
        self.pool.shutdown()

    def serve(self, recognizer):
        async def on_connection(connection):
            try:
                await sherpa_server.handle(connection, recognizer, self.pool)
            except websockets.ConnectionClosed:
                pass

        return websockets.serve(on_connection, "127.0.0.1", 0)

    async def test_sends_a_partial_when_the_text_changes_and_a_final_after_stop(self):
        recognizer = FakeRecognizer(["", "send", "send", "send fifty", "send fifty dollars", "send fifty dollars to sam"])
        async with self.serve(recognizer) as server:
            port = next(iter(server.sockets)).getsockname()[1]
            async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
                await client.send(json.dumps({"type": "start", "sampleRate": 16000}))
                partials = []
                for _ in range(4):
                    await client.send(frame())
                    try:
                        message = json.loads(await asyncio.wait_for(client.recv(), 0.5))
                        partials.append(message["text"])
                    except asyncio.TimeoutError:
                        pass  # the text didn't change on this frame, so nothing is sent
                await client.send(json.dumps({"type": "stop"}))
                final = json.loads(await asyncio.wait_for(client.recv(), 2))
        self.assertEqual(partials, ["send", "send fifty", "send fifty dollars"])  # "send" is not sent twice
        self.assertEqual(final, {"type": "final", "text": "send fifty dollars to sam"})

    async def test_ignores_audio_before_start_and_junk_messages(self):
        recognizer = FakeRecognizer(["", "hello"])
        async with self.serve(recognizer) as server:
            port = next(iter(server.sockets)).getsockname()[1]
            async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
                await client.send(frame())  # no start yet
                await client.send("not json")
                await client.send(json.dumps({"type": "start", "sampleRate": 16000}))
                await client.send(json.dumps({"type": "stop"}))
                final = json.loads(await asyncio.wait_for(client.recv(), 2))
        self.assertEqual(final, {"type": "final", "text": "hello"})

    async def test_two_customers_do_not_hear_each_other(self):
        recognizer = FakeRecognizer(["", "one", "one two"])
        async with self.serve(recognizer) as server:
            port = next(iter(server.sockets)).getsockname()[1]
            url = f"ws://127.0.0.1:{port}"
            async with websockets.connect(url) as a, websockets.connect(url) as b:
                for client in (a, b):
                    await client.send(json.dumps({"type": "start", "sampleRate": 16000}))
                await a.send(frame())
                await a.send(frame())
                partial_a = json.loads(await asyncio.wait_for(a.recv(), 1))
                await b.send(frame())  # b has heard one frame; a has heard two
                partial_b = json.loads(await asyncio.wait_for(b.recv(), 1))
        self.assertEqual(partial_a["text"], "one")
        self.assertEqual(partial_b["text"], "one")


if __name__ == "__main__":
    unittest.main()
