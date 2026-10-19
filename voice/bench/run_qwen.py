"""Time Qwen3-ASR-0.6B (CPU, transformers) on the same clips as run_whisper.py.
usage: run_qwen.py CLIPS_TXT WAV_DIR"""
import glob, json, re, statistics, sys, time
import jiwer, soundfile as sf, torch
from qwen_asr import Qwen3ASRModel

clips, wavdir = sys.argv[1], sys.argv[2]
refs = [l.strip() for l in open(clips) if l.strip()]
wavs = sorted(glob.glob(f"{wavdir}/*.wav"))
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()
t = time.perf_counter()
m = Qwen3ASRModel.from_pretrained("Qwen/Qwen3-ASR-0.6B", dtype=torch.float32, device_map="cpu")
print(f"load {time.perf_counter()-t:.1f}s", flush=True)
audio = lambda p: (lambda a: (a[0], a[1]))(sf.read(p, dtype="float32"))
m.transcribe(audio=audio(wavs[0]))  # warm up
hyps, times = [], []
for w in wavs:
    t = time.perf_counter()
    r = m.transcribe(audio=audio(w))
    hyps.append(r[0].text.strip())
    times.append(time.perf_counter() - t)
wer = jiwer.wer([norm(r) for r in refs], [norm(h) for h in hyps])
print(f"qwen3-asr-0.6b: median {statistics.median(times):.2f}s max {max(times):.2f}s WER {wer:.1%}")
json.dump({"qwen3-asr-0.6b": {"median_s": statistics.median(times), "max_s": max(times), "wer": wer, "hyps": hyps}}, open("qwen-results.json", "w"), indent=1)
