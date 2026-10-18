# Speech-to-text benchmark (CPU)

20 banking messages, spoken in a synthetic voice (Piper `en_US-lessac-medium`), 16 kHz mono, 2-4 s each. Script is in `clips.txt` (numbers and emails written the way they are spoken). 4-core CPU, no GPU, batch size 1, warm model.

| Model | Median / max per clip | Word error rate* |
| --- | --- | --- |
| faster-whisper tiny.en (int8) | 0.38 s / 0.53 s | 38.5% |
| faster-whisper base.en (int8) | 0.55 s / 0.68 s | 39.4% |
| faster-whisper small.en (int8) | 1.37 s / 1.65 s | 38.9% |
| Qwen3-ASR-0.6B (transformers, fp32) | 1.81 s / 2.80 s | 26.0% |

*Scored against the spoken-form script, so it counts "$50" vs "fifty dollars" as errors. Whisper writes digits and symbols ("Send $50 ...", "416-555-0199", "priya.k at example.com"), which is closer to what the extractor trains on but looks bad in this metric. Read the transcripts in `whisper-results.json` and `qwen-results.json` rather than trusting the percentage.

What the transcripts show:
- Whisper small.en: digits, `$` and phone formats come out ready to use. Misses: "toward" became "to word", "block" became "If he's block", and "e-" was dropped once.
- Qwen3-ASR: spells numbers out ("two hundred and fifty dollars", "two zero one nine ...") but joins some digits ("4165550199"). Misses: "alex@akmi.com" for "alex at acme dot com", and "transfer" for "e-transfer" once.
- Both write "checking", not the Canadian "chequing".

Caveats: one synthetic voice, 20 clips, no noise, no accents. Real microphone audio will be worse. Qwen3-ASR ran unoptimized on CPU (no quantization or llama.cpp route is documented), so its time is an upper bound.

Run: `python run_whisper.py clips.txt WAV16_DIR tiny.en base.en small.en` and `python run_qwen.py clips.txt WAV16_DIR` (see the imports for packages).

## Streaming spike: sherpa-onnx (CPU)

`run_sherpa.py` feeds each clip to [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)'s streaming Zipformer (`sherpa-onnx-streaming-zipformer-en-2023-06-26`, int8, 4 threads) in 100 ms chunks, the way a live microphone would, and times it. Same 20 clips and 4-core CPU as above.

| Setup | Wait after you stop | First text appears | Compute vs audio length | Word error rate* |
| --- | --- | --- | --- | --- |
| Clip starts at once (0 s lead-in) | 76 ms median / 131 ms max | 0.8 s into the audio | 0.14x | 26.9% |
| 0.5 s of silence before speech, 1 s after | 118 ms median / 159 ms max | 1.2 s into the audio | 0.14x | 19.2% |

*Against the spoken-form script, as above. Compare Whisper small.en's 1.4 s wait after the clip ends, and re-reading the whole clip each second.

What it shows:
- Speed is far better than re-running Whisper: text arrives while you talk and the final text is ready about 0.1 s after you stop.
- It lost the first word when the clip started at once ("Send" dropped in 3 clips). A real mic that is open before you speak, or a short lead-in, avoids most of that, so the app should start the stream a moment before speech.
- It is weaker on names and emails than Whisper ("PREA", "ACHMEADCOMBE" for "Priya", "acme dot com") and on rare words ("FHSA" came out as "THORTON F H ESSAY").
- The output is UPPERCASE with numbers spelled out and emails as "at"/"dot" words, so it needs a normalising step before the extractor (the extractor is already trained on worded amounts like "two grand").
- Same caveats as above: 20 clips, one synthetic voice, no noise.

Run: `python run_sherpa.py clips.txt WAV16_DIR MODEL_DIR [LEAD_S] [TAIL_S]` (model from the sherpa-onnx `asr-models` release, ~310 MB download).

## Streaming server and the real-time test (`voice/server`)

`voice/server/sherpa_server.py` serves the same Zipformer over the WebSocket protocol in `src/lib/stt/stream/protocol.ts`. Setup: `pip install -r voice/server/requirements.txt`, `voice/server/download-model.sh`, then `python voice/server/sherpa_server.py --model-dir voice/models/sherpa-onnx-streaming-zipformer-en-2023-06-26`. The server puts 0.5 s of silence in front of the audio (the engine drops the first word otherwise) and 1 s after it when you stop.

`stream_bench.py` plays each clip into it at real-time pace, in 100 ms frames, like a live mic. Same 20 clips, same 4-core CPU:

| Measure | Result |
| --- | --- |
| First text after speech starts | 0.63 s median |
| Final text after the customer stops | 99 ms median / 171 ms max |
| Word error rate* | 18.8% |

*Against the spoken-form script as before: spelled-out numbers count as correct, UPPERCASE is ignored.

`browser_check.mjs` is the full chain by hand: a real speech clip goes through Chromium's fake microphone into the built app (`STT_STREAM_URL` set), and the message bar fills in as the clip plays: "SEND FIFTY DOLL" at 1.5 s, "SEND FIFTY DOLLARS TO SAM" at 2.1 s, the whole sentence at 3.4 s, and the form opened with To = SAM. The Amount field stayed empty: "FIFTY" is spelled out and UPPERCASE, which the stand-in extractor can't read. Cleaning that up before the extractor is the next branch.
