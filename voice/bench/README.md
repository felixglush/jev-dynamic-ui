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
