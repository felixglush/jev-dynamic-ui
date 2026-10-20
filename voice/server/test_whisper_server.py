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


def post(client, audio=b"RIFFfake", **form):
    # The same multipart fields OpenAiCompatibleStt sends: file, model, language, response_format.
    data = {"model": "Systran/faster-whisper-small.en", "language": "en", "response_format": "json", **form}
    return client.post("/v1/audio/transcriptions", files={"file": ("audio.wav", audio, "audio/wav")}, data=data)


class TranscriptionsTest(unittest.TestCase):
    def test_returns_the_text_in_the_shape_the_app_reads(self):
        fake = FakeTranscriber()
        response = post(TestClient(whisper_server.create_app(fake)), audio=b"clip bytes")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "send 50 dollars to sam"})
        self.assertEqual(fake.calls, [(b"clip bytes", "en")])

    def test_passes_the_language_on(self):
        fake = FakeTranscriber()
        post(TestClient(whisper_server.create_app(fake)), language="fr")
        self.assertEqual(fake.calls[0][1], "fr")

    def test_refuses_an_empty_clip(self):
        response = post(TestClient(whisper_server.create_app(FakeTranscriber())), audio=b"")
        self.assertEqual(response.status_code, 400)

    def test_refuses_an_oversize_clip(self):
        response = post(TestClient(whisper_server.create_app(FakeTranscriber())), audio=b"x" * (whisper_server.MAX_AUDIO_BYTES + 1))
        self.assertEqual(response.status_code, 413)

    def test_an_engine_error_is_a_500_that_keeps_the_detail_to_itself(self):
        client = TestClient(whisper_server.create_app(FakeTranscriber(error=RuntimeError("secret path /home/x"))))
        with self.assertLogs("whisper_server", level="ERROR"):
            response = post(client)
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("secret", response.text)




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
