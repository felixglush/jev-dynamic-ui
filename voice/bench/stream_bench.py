"""Times a streaming speech server the way a live microphone would: each clip is sent in 100 ms frames at real-time
pace, and we note when the first text comes back and how long the final text takes after the last frame.
usage: stream_bench.py CLIPS_TXT WAV16_DIR [WS_URL]   (default ws://127.0.0.1:8765)"""
import asyncio, glob, json, re, statistics, sys, time
import jiwer, numpy as np, soundfile as sf, websockets

clips, wavdir = sys.argv[1:3]
url = sys.argv[3] if len(sys.argv) > 3 else "ws://127.0.0.1:8765"
refs = [l.strip() for l in open(clips) if l.strip()]
wavs = sorted(glob.glob(f"{wavdir}/*.wav"))
norm = lambda s: re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " ")).strip()
FRAME = 1600  # 100 ms


async def run_clip(path):
    samples = (sf.read(path, dtype="float32")[0] * 32767).astype("<i2")
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"type": "start", "sampleRate": 16000}))
        t0 = time.perf_counter()
        first = None
        partials = []

        async def listen():
            nonlocal first
            async for message in ws:
                data = json.loads(message)
                if data["type"] == "partial":
                    first = first if first is not None else time.perf_counter() - t0
                    partials.append((time.perf_counter() - t0, data["text"]))
                elif data["type"] == "final":
                    return data["text"]

        listener = asyncio.create_task(listen())
        for i in range(0, len(samples), FRAME):
            frame = samples[i : i + FRAME]
            # A microphone hands over a frame only once it has been spoken: wait for the frame's capture deadline.
            await asyncio.sleep(max(0.0, t0 + (i + len(frame)) / 16000 - time.perf_counter()))
            await ws.send(frame.tobytes())
        sent_all = time.perf_counter()
        await ws.send(json.dumps({"type": "stop"}))
        final = await listener
        return final, first, time.perf_counter() - sent_all, len(samples) / 16000


async def main():
    hyps, firsts, finals = [], [], []
    for w in wavs:
        final, first, after_stop, seconds = await run_clip(w)
        hyps.append(final)
        firsts.append(first if first is not None else seconds)
        finals.append(after_stop)
    wer = jiwer.wer([norm(r) for r in refs], [norm(h) for h in hyps])
    out = {"after_stop_median_s": statistics.median(finals), "after_stop_max_s": max(finals),
           "first_text_median_s": statistics.median(firsts), "wer": wer, "hyps": hyps}
    print(f"{url}: first text {out['first_text_median_s']:.2f}s after speech starts; "
          f"final text {out['after_stop_median_s']*1000:.0f} ms median / {out['after_stop_max_s']*1000:.0f} ms max after stop; WER {wer:.1%}")
    json.dump(out, open("stream-results.json", "w"), indent=1)


asyncio.run(main())
