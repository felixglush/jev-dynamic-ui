<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

Developer and agent notes: how the app is built, how to test it, and how the annotation and fine-tuning tools work. The README is the short public overview (demo, actions, who does what, final result); everything detailed lives here and in `docs/`.

Quick start: Node 22 or newer; `npm install`; `cp .env.example .env.local` and set `TYPESAFE_API_KEY` (never given a `NEXT_PUBLIC_` prefix, read only on the server); `npm run dev` serves http://localhost:3000. The extractor needs Ollama running (see below). Run `npx next typegen` before `npm run typecheck`.

## How it works

```
browser                          server (Next.js)                         TypeSafe
Chat (client component)  --->  classifyMessage (server action)  --->  Jev: one request per message
                                  lib/jev/classify.ts                   "which action?" + every param
ActionPanel picks a form  <---  typed result (action + params)  <---
```

- `src/lib/jev/catalog.ts` is the single source of truth: each action and its parameters. Adding an action here is how you extend the app.
- `src/lib/jev/classify.ts` sends **one** request per message with a question for the action plus a question for every parameter of every action. Code keeps only the chosen action's answers (TypeSafe's function-calling pattern).
- Jev picks, it never writes text. It reads the whole message and answers only the action question and the choice parameters (account type and so on), each picked from the options in the catalog. Free-text parameters (names, emails, phones, amounts, dates) are not asked of Jev; the extractor fills them. There are no regex candidate lists.
- `src/lib/jev/types.ts` derives the result types from the catalog. `ActionPanel` switches on `call.action`; TypeScript narrows the params in each case and fails the build if an action has no component.
- `src/components/ui/` is shadcn/ui style components (Tailwind + Radix). `src/components/forms/` holds one form per banking action. `src/app/actions.ts` is the Next.js *Server Action* (server code the browser can call); it's unrelated to the banking "actions".
- Server and client split: `page.tsx`, `layout.tsx` and `not-found.tsx` are Server Components. Only what needs state or events is a Client Component (`"use client"`): `chat.tsx`, `forms/action-form.tsx`, the `annotate/` components and `app/error.tsx`. The Jev call and the API key live only in `lib/jev/classify.ts` (`server-only`).

### Who fills which parameter

| Kind of parameter | Examples | Filled by |
| --- | --- | --- |
| Free text: the value comes from what the customer typed | names, emails, phones, amounts, dates, biller account numbers | the extractor model (`src/lib/extract/`), which copies it from the message or leaves it empty |
| Choice: the answer is one of the catalog's fixed options | which account to pay from or move money to, credit card payment option (minimum, statement balance, current balance, custom), account type to open, frequency, card, dispute reason | Jev, picking from the options in `catalog.ts` |

The rule is `param.type === "choice"`. `freeTextParams()` in `src/lib/extract/prompt.ts` returns everything that isn't a choice, and that list is the extractor's output fields and its fine-tuning answers. A new choice parameter needs no training data: add it to the catalog with its options. Jev also picks the action itself. Jev is not asked about the free-text parameters at all.

## Tests

```bash
npm test          # integration tests: real classifier + real SDK over HTTP to a local fake Jev
npm run test:e2e  # browser tests: the built app in Chromium against the same fake Jev
npm run typecheck
npm run lint
```

The fake Jev (`e2e/fake-jev.mts`) is a crude rule-based stand-in. These tests check the wiring (questions built, answers turned into forms) but say nothing about how accurate the real model is. First run of the browser tests needs a Chromium: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH` to one you already have.

## Extracting values with a local model (experimental)

`src/lib/extract/` asks a small local model, the fine-tuned [LFM2.5-350M](https://huggingface.co/felixglush156/LFM2.5-350M-banking-extractor-GGUF) (a LiquidAI base model) running in [Ollama](https://ollama.com), for the free-text values of one action (names, emails, phones, amounts, dates, account numbers; choices stay with Jev). The extractor is required (the default model is `lfm25-350m-sft`, the fine-tuned LFM2.5-350M, downloaded and registered by `scripts/ollama/use-tuned.sh`; set `OLLAMA_MODEL` to use another) and fills the free-text fields of the form the chat opens; Jev still picks the action and the choices. If Ollama isn't running the chat says the assistant is down; there is no fallback to Jev's own values.

```bash
scripts/ollama/use-tuned.sh                 # downloads the fine-tuned Q8_0 GGUF (~380 MB) and runs `ollama create lfm25-350m-sft`
scripts/ollama/setup.sh                     # alternative: the untuned base LFM2.5-230M as `lfm25-230m` (much less accurate)
npm run extract:eval                        # data/sample-messages.txt -> extractions.csv, one row per field
npm run latency                             # times Jev, the extractor and both together (needs TYPESAFE_API_KEY); prints the README's latency table
```

The setup script downloads from huggingface.co directly because `ollama run hf.co/...` needs the `hf.co` host. Ollama's installer needs `zstd`. `OLLAMA_URL` and `OLLAMA_MODEL` override the defaults.

Zero-shot, this model fills every field whether or not the message states it (invented emails, "John Doe", a constant date). The extractor passes the model's values on as they are (there is no run-time check against the message), so fine-tuning (see `docs/sft-dataset.md`) is what teaches the model to leave absent fields empty. Empty fields stay blank for the customer to fill in.

## Validating Jev's predictions

```bash
npm run predict                                  # data/sample-messages.txt -> predictions.csv
npm run predict:examples                         # Jev on every fine-tuning example message not yet in predictions.csv (resumable)
npm run sft:check                                # fails if a message is in train and also in val/test
npm run predict -- my-messages.txt out.csv       # your own messages: one per line, `# group` lines label sections
```

Runs every message through the real classifier and the extractor (needs `TYPESAFE_API_KEY` in the environment and Ollama running) and writes a CSV with the predicted action, its confidence, the extracted parameters (each with its confidence), and which required parameters are missing. The empty `expected_action` column is for you to fill in, by hand in a spreadsheet or with the annotation page below. `data/sample-messages.txt` has about 240 messages: clear requests for each of the 14 actions, vaguer "ambiguous" ones for each action (the group name says which action was meant), scheduled payments, messages that mix actions, requests the app has no form for, and tricky values.

### Annotating them

Open [`/annotate`](http://localhost:3000/annotate) (`npm run dev`). It shows `predictions.csv` one message at a time: what Jev picked and what the LiquidFM extractor read, field by field, each row tinted and badged **Jev** (it picked the action and the choices), **LiquidFM** (it read names, emails, amounts and dates through Ollama; a value Jev disagreed with is shown as "Jev said …"), or **Blank** (neither found one), and the real form the customer would get. If Ollama isn't running the card says so and shows Jev's values. The summary still scores Jev's own values. Press **Y** if Jev got it right, or **N** to fix the expected action and values, then **Enter**. Squares at the top show each message's status (green right, amber wrong values, red wrong action) and jump to it. **Summary** shows action accuracy, value accuracy, accuracy by confidence, and the list of mistakes.

Every answer is saved as you go, in two places. The browser keeps it in localStorage, and the server applies each change to `data/annotations.csv` (a server action in `src/app/annotate/actions.ts`; set `ANNOTATIONS_FILE` to use another path). The page shows `Saved to data/annotations.csv` beside the progress count. Open the page in a different browser and it restores the answers from that file; answers for messages whose text has since changed are ignored. If the file can't be read (say, a hand edit left an unknown action), autosave stays off and the page tells you, so nothing is overwritten. This needs a writable local filesystem and has no login yet, so don't deploy it as is. A CSV you **Import** is kept in the browser only and never touches the file.

**Download CSV** writes the predictions with `expected_action`, `expected_params` and `annotator_note` filled in; **Import CSV** loads any predictions CSV, including one downloaded earlier, so you can pick up where you left off. `predictions.csv` starts empty and holds live traffic: every message sent in the chat is appended with what Jev said (`PREDICTIONS_LOG_FILE` redirects the log). The synthetic examples are reviewed on the Fine-tuning tab and are not run through Jev; `npm run predict:examples` can still do that on purpose. The **Split** menu filters to train, val, test or pending, **Kind** to the kind of example, and **Reviewer** to rows you reviewed yourself versus rows Claude approved (`meta.reviewedBy`; the first 62 human reviews were recovered from git history before training). Approving a prediction whose message is already in the fine-tuning file puts the review on that row; any other message is added as a train-only row, so val and test never change. The page reads `predictions.csv` (override with `PREDICTIONS_FILE`) on every request: restart `npm run dev` after re-running `npm run predict`, or import the new file.

**Who filled each field.** On the Jev predictions view, the action and every field row carry a badge: **Jev** (the action and the choice fields), **LiquidFM** (the typed-in values, read by the fine-tuned extractor) or **Blank** (neither found it). The badges always show; if Ollama is down the card says so and every value is Jev's.

**Fine-tuning data.** The **Fine-tuning data** switch above the progress opens `data/sft/examples.jsonl` (sample and generated rows; `SFT_REVIEW_FILE` to use another path): Y approves a row, N corrects it, action `none` rejects it, and every answer is written into the row in the file for `npm run sft:build` to train on. Import also takes the JSONL files from `docs/sft-dataset.md` (`data/sft/*.jsonl`, or model output from `npm run extract:eval -- data/sample-messages.txt out.jsonl`). The **Full / Fields only** switch next to Summary changes the card: Full is the whole picture, Fields only shows just the extractor model's fields for the action, blanks marked, and a fix-it form without the choice fields. Pressing Y or saving a fix on the Jev predictions view also adds the answer to `data/sft/examples.jsonl` as an approved, train-only row, with the **Kind of example** you picked (typo, accented name, worded number, date...); `npm run sft:kind` backfills kinds on older rows. **Download labels** writes the reviewed answers as `message => field=value` lines, the batch format `npm run sft:add` reads.

- `src/app/annotate/page.tsx` is a Server Component that reads the file (`lib/annotate/load.ts`, `"use cache"`) and passes the rows to `components/annotate/annotator.tsx`, the client component that does the rest.
- `src/lib/annotate/combine.ts` merges Jev's and LiquidFM's fields and records who filled each; `extractMessageFields` in `app/annotate/actions.ts` is the server action that calls Ollama (`OLLAMA_URL`). Browser tests use `e2e/fake-ollama.mts`.
- `src/lib/annotate/` holds the plain functions: CSV reading and writing (`dataset.ts`, `csv.ts`) and the scoring (`summary.ts`). Values are compared loosely: `50` matches `50.00`, phone numbers by digits, names ignoring case.
- `npm run annotate:preview` (after `npm run build`) bundles the same component into one HTML file with the predictions embedded, for sharing where the server can't run, such as a Claude Artifact.

## Voice mode (experimental)

The mic button in the chat bar records up to 20 s. About once a second the audio so far is sent to a Server Action (`app/voice-actions.ts`) and transcribed again, so the text appears in the bar while you speak and each version goes through the normal live-prediction path (`ask()` in `chat.tsx`, which drops answers about older text); when you press stop the final transcription replaces the partials. Only one partial request is in flight at a time and only the newest audio waits behind it, so a slow engine lags instead of piling up (this re-sends the whole clip each time, so a bigger model gets slower as the clip grows; a true streaming engine would replace it behind the same interface). The form opens for review, like a clicked example, and is never confirmed by voice. The text then goes through the same Jev and extractor flow as typing.

Speech-to-text is a strategy plus a small factory in `src/lib/stt/`, split by responsibility: `types.ts` (the one-method `SttProvider` interface), `openai-compatible.ts` (the only provider so far), `index.ts` (`createStt()` reads `STT_PROVIDER`, `STT_URL`, `STT_MODEL` and builds the provider), `transcribe.ts` (`transcribeClip(clip, provider)`: validates the upload and hides engine errors; the provider is passed in, so it never knows which model it is using) and `limits.ts` (shared by browser and server). Browser side: `components/use-recorder.ts` only records, `components/mic-button.tsx` only talks to the server, and `chat.tsx` decides what the text does. To add an engine, write a class that implements `SttProvider` and add one line to the table in `index.ts`.

**Live streaming mode.** If `STT_STREAM_URL` is set (a `ws://` address, read by the server when the page loads via `getSpeechConfig` in `app/voice-actions.ts`), the mic button streams instead: `components/streaming-mic-button.tsx` -> `use-streaming-speech.ts` joins `lib/stt/stream/capture.ts` (microphone -> AudioWorklet in `public/pcm-worklet.js` -> `PcmResampler` -> 16-bit 16 kHz PCM) to a `StreamingTranscriber` (`stream/transcriber.ts`, WebSocket). The wire format in `stream/protocol.ts` is the boundary: any server that speaks it can be plugged in (a gateway in front of a cloud service would too), the browser connects to it directly. Browser tests run the built app twice (`e2e/start-apps.mts`): without `STT_STREAM_URL` (record then transcribe) and with it, against `e2e/fake-stt-stream.mts`.

**Streaming server.** `voice/server/sherpa_server.py` (Python, sherpa-onnx streaming Zipformer) implements the streaming protocol: setup in `voice/bench/README.md`, `python -m unittest voice/server/test_sherpa_server.py` runs its tests with a stand-in recognizer (no model needed), `voice/bench/stream_bench.py` times the real model at real-time pace, and `voice/bench/browser_check.mjs` plays a speech clip through Chromium's fake microphone into the app. Run it with `STT_STREAM_URL=ws://127.0.0.1:8765` set for `npm run dev`/`start`.

**Text clean-up.** Streaming engines write capitals and words for everything, so `StreamingMicButton` runs the text through `normalizeSpoken` (`src/lib/stt/normalize.ts`, pure and English only) before it reaches Jev and the extractor: spelled-out amounts become digits ("two hundred and fifty" -> 250, "eleven ninety nine" -> 11.99), digit-by-digit runs become account or phone numbers, "alex at acme dot com" becomes an email, and ordinals next to a month become dates ("march fourth" -> "march 4th"). It leaves ambiguous words alone ("one of my accounts", "my first account"). A capitals-only engine gives no clue what is a name, so names come out lowercase.

`OpenAiCompatibleStt` speaks OpenAI's `/v1/audio/transcriptions`, so Whisper (faster-whisper-server, whisper.cpp) and Qwen3-ASR (vLLM) are a change of `STT_URL` and `STT_MODEL`. Tests use stand-ins (`e2e/fake-stt.mts`, Chromium's fake microphone), so they prove the wiring, not speech accuracy, and nothing has been tried against a real Whisper server yet. Model timings are in `voice/bench/README.md`.

## Dependency notes

- TypeScript 7 (the native compiler) runs `npm run typecheck`. `typescript-eslint`, which `eslint-config-next` uses, doesn't support TS 7 yet, so `typescript` in `package.json` is aliased to Microsoft's `@typescript/typescript6` compatibility package for the tools that import it (ESLint, Next), as the TS 7 announcement recommends, and `@typescript/native` provides `tsc`. Once typescript-eslint supports TS 7, replace both with a plain `typescript@7`.
- `@types/node` stays on 22 to match the Node 22 runtime; newer majors describe APIs Node 22 doesn't have.
- shadcn/ui components are copied into `src/components/ui/` (not a dependency), so they only change when you re-run `npx shadcn add <name> --overwrite`.
- `npm audit` reports a `braces` advisory in the ESLint toolchain (dev only, nothing ships). There is no patched `braces` release yet.

## Before deploying

The server action is a public endpoint. Add authentication (and rate limiting, since each call spends TypeSafe credits) before exposing it. The forms don't call a banking API yet; submitting shows a demo notice.
