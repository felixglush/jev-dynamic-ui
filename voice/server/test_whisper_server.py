"""Tests for the Whisper server's own logic, using a stand-in transcriber so no model is needed. They prove the HTTP
side (what the app's OpenAiCompatibleStt sends is accepted, bad input is refused, engine errors don't leak): how well
the real model hears is measured by voice/bench/run_whisper.py.

    python -m unittest voice/server/test_whisper_server.py   (from the repo root, in the server's virtualenv)
"""
import sys
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))
import whisper_server  # noqa: E402


class FakeTranscriber:
    def __init__(self, text="send 50 dollars to sam", error=None):
        self.text, self.error, self.calls = text, error, []

    def transcribe(self, audio, language):
        if self.error:
            raise self.error
        self.calls.append((audio.read(), language))
        return self.text


SPECS = {
    "a": whisper_server.ModelSpec("stub", "model-a", "Model A", aliases=("legacy/a",)),
    "b": whisper_server.ModelSpec("stub", "model-b", "Model B"),
    "c": whisper_server.ModelSpec("stub", "model-c", "Model C"),
    "needs-missing": whisper_server.ModelSpec("stub", "x", "Needs a package", needs="no_such_package_xyz"),
}


def pool_of(*fakes, keep=2):
    """A pool of stand-in models: each load takes the next fake and records which model it was made for."""
    made, queue = [], list(fakes)
    pool = whisper_server.ModelPool("a", 1, keep, SPECS, make=lambda engine, model, threads: (made.append(model), queue.pop(0))[1])
    pool.made = made
    return pool


def app_with(fake):
    return whisper_server.create_app(pool_of(fake))


def post(client, audio=b"RIFFfake", **form):
    # The same multipart fields OpenAiCompatibleStt sends: file, model, language, response_format.
    data = {"model": "a", "language": "en", "response_format": "json", **form}
    return client.post("/v1/audio/transcriptions", files={"file": ("audio.wav", audio, "audio/wav")}, data=data)


class TranscriptionsTest(unittest.TestCase):
    def test_returns_the_text_in_the_shape_the_app_reads(self):
        fake = FakeTranscriber()
        response = post(TestClient(app_with(fake)), audio=b"clip bytes")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "send 50 dollars to sam"})
        self.assertEqual(fake.calls, [(b"clip bytes", "en")])

    def test_passes_the_language_on(self):
        fake = FakeTranscriber()
        post(TestClient(app_with(fake)), language="fr")
        self.assertEqual(fake.calls[0][1], "fr")

    def test_refuses_an_empty_clip(self):
        response = post(TestClient(app_with(FakeTranscriber())), audio=b"")
        self.assertEqual(response.status_code, 400)

    def test_refuses_an_oversize_clip(self):
        response = post(TestClient(app_with(FakeTranscriber())), audio=b"x" * (whisper_server.MAX_AUDIO_BYTES + 1))
        self.assertEqual(response.status_code, 413)

    def test_an_engine_error_is_a_500_that_keeps_the_detail_to_itself(self):
        client = TestClient(app_with(FakeTranscriber(error=RuntimeError("secret path /home/x"))))
        with self.assertLogs("whisper_server", level="ERROR"):
            response = post(client)
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("secret", response.text)


class ModelChoiceTest(unittest.TestCase):
    def test_a_request_names_the_model_and_no_name_means_the_default(self):
        a, b = FakeTranscriber("from a"), FakeTranscriber("from b")
        client = TestClient(whisper_server.create_app(pool_of(b, a)))  # fakes are handed out in load order: b loads first
        self.assertEqual(post(client, model="b").json(), {"text": "from b"})
        self.assertEqual(post(client, model="").json(), {"text": "from a"})
        self.assertEqual(len(b.calls), 1)

    def test_an_alias_means_the_same_model(self):
        pool = pool_of(FakeTranscriber())
        self.assertEqual(pool.resolve("legacy/a"), "a")

    def test_an_unknown_model_is_a_400_that_lists_the_choices(self):
        response = post(TestClient(whisper_server.create_app(pool_of(FakeTranscriber()))), model="nope")
        self.assertEqual(response.status_code, 400)
        self.assertIn("a, b, c", response.json()["detail"])

    def test_a_model_whose_package_is_missing_is_a_400(self):
        response = post(TestClient(whisper_server.create_app(pool_of(FakeTranscriber()))), model="needs-missing")
        self.assertEqual(response.status_code, 400)
        self.assertIn("isn't available", response.json()["detail"])

    def test_a_model_loads_once_and_the_least_recently_used_one_is_dropped(self):
        pool = pool_of(FakeTranscriber(), FakeTranscriber(), FakeTranscriber(), FakeTranscriber(), keep=2)
        for name in ["a", "b", "a", "c", "a", "b"]:
            pool.get(name)
        # a, b load; a is reused; c evicts b; a is reused; b loads again (and evicts c).
        self.assertEqual(pool.made, ["model-a", "model-b", "model-c", "model-b"])

    def test_the_listing_says_what_is_loaded_and_what_is_available(self):
        pool = pool_of(FakeTranscriber())
        pool.get("a")
        rows = {row["id"]: row for row in pool.listing()}
        self.assertTrue(rows["a"]["loaded"] and rows["a"]["available"])
        self.assertFalse(rows["b"]["loaded"])
        self.assertFalse(rows["needs-missing"]["available"])
        response = TestClient(whisper_server.create_app(pool)).get("/v1/models")
        self.assertEqual(response.json()["default"], "a")
        self.assertEqual([row["label"] for row in response.json()["data"]][:2], ["Model A", "Model B"])

    def test_the_real_catalog_is_consistent(self):
        for model_id, spec in whisper_server.MODELS.items():
            self.assertIn(spec.engine, whisper_server.ENGINES, model_id)


class LlamaCppAudioTest(unittest.TestCase):
    def test_it_streams_a_wav_to_the_server_and_joins_the_pieces(self):
        import http.server
        import json
        import threading

        import numpy as np

        seen = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                self.send_response(200)
                self.end_headers()
                for piece in ["send ", "fifty", None]:
                    self.wfile.write(b"data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}).encode() + b"\n\n")
                self.wfile.write(b"data: [DONE]\n\n")

            def log_message(self, *args):
                pass

        server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            adapter = whisper_server.LlamaCppAudio(f"http://127.0.0.1:{server.server_port}", 1)
            text = adapter.transcribe(np.zeros(1600, dtype=np.float32), "en")
        finally:
            server.shutdown()
        self.assertEqual(text, "send fifty")
        part = seen["body"]["messages"][1]["content"][0]["input_audio"]
        self.assertEqual(part["format"], "wav")
        self.assertTrue(part["data"])


class EngineChoiceTest(unittest.TestCase):
    def test_an_engine_is_picked_by_name_and_gets_the_model_and_threads(self):
        made = []

        class Stub:
            def __init__(self, model, threads):
                made.append((model, threads))

            def transcribe(self, audio, language):
                return "stub"

        whisper_server.ENGINES["stub"] = Stub
        try:
            transcriber = whisper_server.create_transcriber("stub", "tiny.en", 2)
        finally:
            del whisper_server.ENGINES["stub"]
        self.assertIsInstance(transcriber, Stub)
        self.assertEqual(made, [("tiny.en", 2)])

    def test_an_unknown_engine_names_the_choices(self):
        with self.assertRaisesRegex(ValueError, "faster-whisper"):
            whisper_server.create_transcriber("nope", "small.en", 4)


if __name__ == "__main__":
    unittest.main()
