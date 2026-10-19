"""Streaming speech-to-text with sherpa-onnx (CPU): feed each clip in 100 ms chunks and time it.
usage: run_sherpa.py CLIPS_TXT WAV16_DIR MODEL_DIR [LEAD_SILENCE_S] [TAIL_SILENCE_S]

Reports, per clip set: the delay after the last chunk until the final text is ready (what the customer waits for
after they stop), the audio position at which the first partial text appeared, and total compute vs audio length."""
import glob, json, re, statistics, sys, time
import jiwer, numpy as np, sherpa_onnx, soundfile as sf

clips, wavdir, model = sys.argv[1:4]
lead = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
tail = float(sys.argv[5]) if len(sys.argv) > 5 else 0.66
refs = [l.strip() for l in open(clips) if l.strip()]
wavs = sorted(glob.glob(f"{wavdir}/*.wav"))
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()
suffix = "chunk-16-left-128.int8.onnx"
rec = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=f"{model}/tokens.txt",
    encoder=f"{model}/encoder-epoch-99-avg-1-{suffix}",
    decoder=f"{model}/decoder-epoch-99-avg-1-{suffix}",
    joiner=f"{model}/joiner-epoch-99-avg-1-{suffix}",
    num_threads=4, sample_rate=16000, feature_dim=80, decoding_method="greedy_search",
)
CHUNK = 1600  # 100 ms
hyps, final_delay, first_partial, compute, audio_len = [], [], [], 0.0, 0.0
for w in wavs:
    samples = np.concatenate([np.zeros(int(lead * 16000), dtype=np.float32), sf.read(w, dtype="float32")[0]])
    stream, first = rec.create_stream(), None
    for start in range(0, len(samples), CHUNK):
        chunk = samples[start : start + CHUNK]
        t = time.perf_counter()
        stream.accept_waveform(16000, chunk)
        while rec.is_ready(stream):
            rec.decode_stream(stream)
        compute += time.perf_counter() - t
        if first is None and rec.get_result(stream).strip():
            first = (start + len(chunk)) / 16000
    t = time.perf_counter()  # the customer stops talking: flush with a little silence
    stream.accept_waveform(16000, np.zeros(int(tail * 16000), dtype=np.float32))
    stream.input_finished()
    while rec.is_ready(stream):
        rec.decode_stream(stream)
    delay = time.perf_counter() - t
    compute += delay
    final_delay.append(delay)
    first_partial.append(first if first is not None else len(samples) / 16000)
    audio_len += len(samples) / 16000
    hyps.append(rec.get_result(stream).strip())
wer = jiwer.wer([norm(r) for r in refs], [norm(h) for h in hyps])
out = {"final_delay_median_s": statistics.median(final_delay), "final_delay_max_s": max(final_delay),
       "first_partial_median_audio_s": statistics.median(first_partial), "rtf": compute / audio_len, "wer": wer, "hyps": hyps}
print(f"sherpa zipformer: after-stop delay median {out['final_delay_median_s']*1000:.0f} ms max {out['final_delay_max_s']*1000:.0f} ms; "
      f"first text at {out['first_partial_median_audio_s']:.1f}s of audio; real-time factor {out['rtf']:.3f}; WER {wer:.1%}")
json.dump({"sherpa-zipformer-en-2023-06-26-int8": out}, open("sherpa-results.json", "w"), indent=1)
