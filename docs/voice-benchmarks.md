# Voice benchmark log

Running log of speech-to-text experiments for voice mode. One entry per run, newest last. Add an entry whenever an engine, setting or clip set changes, so every number can be traced to a setup. The how-to for the older Whisper, Qwen and sherpa scripts is in `voice/bench/README.md`; this file holds the comparison.

## How a run is scored

All engines transcribe the same 20 banking sentences (`voice/bench/clips.jsonl`, spoken by one synthetic Piper voice, 16 kHz, 2 to 4 s each). Each transcript goes through `normalizeSpoken`, the same clean-up the app applies before Jev and the extractor, and is then compared with the written form in `clips.jsonl`. That makes an engine that writes digits (Whisper, LFM2.5-Audio) comparable with one that writes words (the streaming Zipformer).

| Column | Meaning |
| --- | --- |
| WER (written) | Word error rate against the written form ("send $50 to sam"). Lower is better. Secondary: it punishes harmless differences like "$2,000" against "2 grand". |
| Entities found | Share of the 42 values the extractor needs (amounts, names, emails, phone and account numbers, key words) that appear in the transcript. Higher is better. This is the number that matters for the app. |
| Clips fully right | Clips where every value was found. |
| Time per clip | Median / max seconds from sending a clip to having its text. For streaming engines it is the wait after the customer stops speaking, which is not comparable with the others (they see the whole clip first). |

```bash
node voice/bench/score.mts voice/bench/whisper-results.json voice/bench/qwen-results.json \
  voice/bench/lfm-audio-results.json voice/bench/sherpa-hotwords-results.json   # add --misses to list what was missed
```

Setup for every row: 4-core CPU, no GPU, one clip at a time, warm model. Limits: 20 clips, one synthetic voice, no noise, no accents. Treat differences of one or two entities as noise (42 values in total).

## Run 1 (2026-10-18): Whisper, Qwen3-ASR and sherpa Zipformer

Scripts: `run_whisper.py`, `run_qwen.py`, `run_sherpa.py` (details and transcripts in `voice/bench/README.md` and the `*-results.json` files). Qwen3-ASR ran unoptimized (transformers, fp32), so its time is an upper bound.

## Run 2 (2026-10-19): LFM2.5-Audio-1.5B added, everything re-scored on the common metric

New engine: `LiquidAI/LFM2.5-Audio-1.5B` Q8_0 GGUF (1.2 GB, plus 0.3 GB audio encoder) through Liquid's `llama-liquid-audio-server` (llama.cpp runner for Linux x64), asked to "Perform ASR." Script: `run_lfm_audio.py`. Streaming Zipformer re-run with hotwords on and the corrected real-time pacing (`stream_bench.py`).

| Engine | WER (written) | Entities found | Clips fully right | Time per clip (median / max) |
| --- | --- | --- | --- | --- |
| faster-whisper tiny.en (int8) | 21.2% | 66.7% (28/42) | 10/20 | 0.38 s / 0.53 s |
| faster-whisper base.en (int8) | 14.6% | 78.6% (33/42) | 13/20 | 0.55 s / 0.68 s |
| faster-whisper small.en (int8) | 14.6% | 83.3% (35/42) | 13/20 | 1.37 s / 1.65 s |
| Qwen3-ASR-0.6B (transformers, fp32) | 18.5% | 76.2% (32/42) | 13/20 | 1.81 s / 2.80 s |
| LFM2.5-Audio-1.5B (Q8_0, llama.cpp) | 17.2% | 73.8% (31/42) | 12/20 | 1.08 s / 1.99 s |
| Zipformer streaming, hotwords (sherpa-onnx) | 34.4% | 61.9% (26/42) | 7/20 | 0.18 s / 0.38 s after stop |

Qwen3-ASR against LFM2.5-Audio, the comparison that started this log:
- **Accuracy is a tie within noise** (76.2% against 73.8% of values, one value apart in 42; WER 18.5% against 17.2%).
- **LFM2.5-Audio is faster**: 1.08 s median against 1.81 s, even though it has 1.5B parameters against 0.6B. Text starts appearing after about 0.73 s, because the server streams its output.
- **Different mistakes.** LFM got "FHSA" right (Qwen did too; the streaming Zipformer did not), writes digits and punctuation, and kept "Best Buy" and "Acme Corp". It dropped the end of "request money from jordan.k@example.com two hundred dollars" (stopped after "Jordan"), wrote "1199" and "999" for 11.99 and 9.99, and wrote "4165550199" for a phone number. Qwen spelled email addresses wrongly ("alex@akmi.com") but did not drop words.
- **Neither streams its input.** Both need the whole clip, so text can't appear while the customer speaks the way it does with the Zipformer. They fit as a second pass after the customer stops.
- **Whisper small.en still has the best values** (83.3%) at a similar speed to Qwen.

Misses shared by every engine, which are the app's problem more than the engines':
- "checking" for "chequing" (clips 3, 9, 20). The clean-up could map it, if the Canadian spelling matters to the extractor.
- "priya.k at example.com" and "alex at acme.com" are not joined into an email when the engine already wrote part of the address. The clean-up only joins the fully spoken form.
- "e-transfer" loses its "e" in "cancel the e-transfer" for all engines.

Licence and setup notes:
- LFM Open License v1.0: commercial use is allowed only while annual revenue is under US$10 million (section 5 of the licence text in the model repo). Check it with whoever owns the legal side before shipping.
- LFM2.5-Audio's llama.cpp audio support is described by Liquid as experimental, and the server only answers streamed requests (`"stream": true`).
- English only.

## Next experiments

1. A harder clip set: many voices and accents (open TTS voices, then a few real recordings), noise, phone-line compression. This is the test that shows whether accents are a real problem.
2. Add LFM2.5-Audio Q4_0 (smaller, faster) and a GPU run of Qwen3-ASR through vLLM.
3. Clean-up fixes the misses above, then re-score everything.
4. LFM2.5-Audio as the second pass behind the streaming Zipformer: show streaming text, replace it with the second pass when the customer stops. Measure the extra wait.
5. Turn detection to replace the 1 s silence timer.
