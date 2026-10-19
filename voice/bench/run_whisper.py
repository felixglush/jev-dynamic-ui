"""Time faster-whisper (CPU, int8) on spoken clips and score word error rate.
usage: run_whisper.py CLIPS_TXT WAV_DIR MODEL [MODEL...]"""
import glob, json, re, statistics, sys, time
import jiwer, soundfile as sf
from faster_whisper import WhisperModel

clips, wavdir, models = sys.argv[1], sys.argv[2], sys.argv[3:]
refs = [l.strip() for l in open(clips) if l.strip()]
wavs = [sf.read(f, dtype="float32")[0] for f in sorted(glob.glob(f"{wavdir}/*.wav"))]  # 16 kHz mono
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()
out = {}
for name in models:
    m = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=4)
    list(m.transcribe(wavs[0], beam_size=1)[0])  # warm up
    hyps, times = [], []
    for w in wavs:
        t = time.perf_counter()
        segs, _ = m.transcribe(w, beam_size=1, language="en")
        hyps.append(" ".join(s.text.strip() for s in segs))
        times.append(time.perf_counter() - t)
    wer = jiwer.wer([norm(r) for r in refs], [norm(h) for h in hyps])
    out[name] = {"median_s": statistics.median(times), "max_s": max(times), "wer": wer, "hyps": hyps}
    print(f"{name}: median {statistics.median(times):.2f}s max {max(times):.2f}s WER {wer:.1%}", flush=True)
json.dump(out, open("whisper-results.json", "w"), indent=1)
