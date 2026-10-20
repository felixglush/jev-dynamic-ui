"""Time LFM2.5-Audio-1.5B (speech recognition mode, CPU, llama.cpp server) on the same clips as run_whisper.py.
usage: run_lfm_audio.py WAV_DIR [OUT_JSON] [SERVER_URL] [NAME]

Start the server first (from the Hugging Face repo LiquidAI/LFM2.5-Audio-1.5B-GGUF: its runners/ folder and the Q8_0
files):
  llama-liquid-audio-server -m LFM2.5-Audio-1.5B-Q8_0.gguf --mmproj mmproj-LFM2.5-Audio-1.5B-Q8_0.gguf \\
    -mv vocoder-LFM2.5-Audio-1.5B-Q8_0.gguf --tts-speaker-file tokenizer-LFM2.5-Audio-1.5B-Q8_0.gguf -t 4 --port 8791
The server only answers streamed chat requests, so the audio goes in whole and the text streams out. Score the result
with `node voice/bench/score.mts`."""
import base64, glob, json, statistics, sys, time, urllib.request

wavdir = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else "lfm-audio-results.json"
url = (sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8791") + "/v1/chat/completions"
name = sys.argv[4] if len(sys.argv) > 4 else "lfm2.5-audio-1.5b-q8_0"


def transcribe(path):
    audio = base64.b64encode(open(path, "rb").read()).decode()
    body = {
        "messages": [
            {"role": "system", "content": "Perform ASR."},
            {"role": "user", "content": [{"type": "input_audio", "input_audio": {"data": audio, "format": "wav"}}]},
        ],
        "max_tokens": 256,
        "stream": True,
    }
    start, first, text = time.perf_counter(), None, ""
    request = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
    for line in urllib.request.urlopen(request, timeout=300):
        line = line.decode().strip()
        if not line.startswith("data:") or line.endswith("[DONE]"):
            continue
        piece = json.loads(line[5:])["choices"][0]["delta"].get("content")
        if piece:
            first = first if first is not None else time.perf_counter() - start
            text += piece
    return text.strip(), first or 0.0, time.perf_counter() - start


wavs = sorted(glob.glob(f"{wavdir}/*.wav"))
transcribe(wavs[0])  # warm up
hyps, firsts, totals = [], [], []
for wav in wavs:
    text, first, total = transcribe(wav)
    hyps.append(text)
    firsts.append(first)
    totals.append(total)
result = {name: {"median_s": statistics.median(totals), "max_s": max(totals), "first_token_median_s": statistics.median(firsts), "hyps": hyps}}
json.dump(result, open(out, "w"), indent=1)
print(f"{name}: median {statistics.median(totals):.2f}s max {max(totals):.2f}s, first text {statistics.median(firsts):.2f}s")
