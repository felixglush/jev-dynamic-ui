# jev-dynamic-ui

A chat UI that picks a prebuilt UI component to carry out a banking action, filling it with context from the chat. Component selection uses [TypeSafe AI's](https://typesafe.ai) Jev decision model.

Type "Send $50 to Sam for dinner" and the app opens the e-Transfer form with the recipient and amount already filled in. It handles 14 actions: e-Transfers (send, request, cancel, contacts, Autodeposit), credit card and bill payments, payees, transfers between your accounts, opening accounts, card lock and replace, balances and transactions, disputes, and contact info changes. Payments can be scheduled ("every month on the 1st"). Anything the message doesn't say is left blank and flagged, and anything Jev is unsure about is marked "Please check".

## Run it

Needs Node 22 or newer.

```bash
npm install
cp .env.example .env.local   # then put your TypeSafe API key in .env.local
npm run dev                  # http://localhost:3000
```

`.env.local` is gitignored. The key is only ever read on the server; never give it a `NEXT_PUBLIC_` prefix.

## How it works

```
browser                          server (Next.js)                         TypeSafe
Chat (client component)  --->  classifyMessage (server action)  --->  Jev: one request per message
                                  lib/jev/classify.ts                   "which action?" + every param
ActionPanel picks a form  <---  typed result (action + params)  <---
```

- `src/lib/jev/catalog.ts` is the single source of truth: each action and its parameters. Adding an action here is how you extend the app.
- `src/lib/jev/classify.ts` sends **one** request per message with a question for the action plus a question for every parameter of every action. Code keeps only the chosen action's answers (TypeSafe's function-calling pattern).
- Jev picks, it never writes text. For amounts, emails, phones and names, code first finds candidates in the message (`candidates.ts`) and Jev chooses which one fills each parameter, or "none". Choice parameters (account type and so on) pick from the options in the catalog.
- `src/lib/jev/types.ts` derives the result types from the catalog. `ActionPanel` switches on `call.action`; TypeScript narrows the params in each case and fails the build if an action has no component.
- `src/components/ui/` is shadcn/ui style components (Tailwind + Radix). `src/components/forms/` holds one form per banking action. `src/app/actions.ts` is the Next.js *Server Action* (server code the browser can call); it's unrelated to the banking "actions".
- Server and client split: `page.tsx`, `layout.tsx` and `not-found.tsx` are Server Components. Only what needs state or events is a Client Component (`"use client"`): `chat.tsx`, `forms/action-form.tsx`, the `annotate/` components and `app/error.tsx`. The Jev call and the API key live only in `lib/jev/classify.ts` (`server-only`).

### Who fills which parameter

| Kind of parameter | Examples | Filled by |
| --- | --- | --- |
| Free text: the value comes from what the customer typed | names, emails, phones, amounts, dates, biller account numbers | the extractor model (`src/lib/extract/`), which copies it from the message or leaves it empty |
| Choice: the answer is one of the catalog's fixed options | which account to pay from or move money to, credit card payment option (minimum, statement balance, current balance, custom), account type to open, frequency, card, dispute reason | Jev, picking from the options in `catalog.ts` |

The rule is `param.type === "choice"`. `freeTextParams()` in `src/lib/extract/prompt.ts` returns everything that isn't a choice, and that list is the extractor's output fields and its fine-tuning answers. A new choice parameter needs no training data: add it to the catalog with its options. Jev also picks the action itself. For the free-text parameters Jev still chooses among code-found candidates (`candidates.ts`), and the extractor's values are a separate proposal for the same fields.

## Tests

```bash
npm test          # integration tests: real classifier + real SDK over HTTP to a local fake Jev
npm run test:e2e  # browser tests: the built app in Chromium against the same fake Jev
npm run typecheck
npm run lint
```

The fake Jev (`e2e/fake-jev.mts`) is a crude rule-based stand-in. These tests check the wiring (questions built, candidates offered, answers turned into forms) but say nothing about how accurate the real model is. First run of the browser tests needs a Chromium: `npx playwright install chromium`, or set `PW_CHROMIUM_PATH` to one you already have.

## Extracting values with a local model (experimental)

`src/lib/extract/` asks a small local model, [LiquidAI's LFM2.5-230M](https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF) running in [Ollama](https://ollama.com), for the free-text values of one action (names, emails, phones, amounts, dates, account numbers; choices stay with Jev). Set `EXTRACTOR=ollama` (the default model is `lfm25-350m-sft`, the fine-tuned LFM2.5-350M, registered by `scripts/ollama/use-tuned.sh`; set `OLLAMA_MODEL` to use another) to let it fill the free-text fields of the form the chat opens; Jev still picks the action and the choices. Without it the chat uses Jev's values only.

```bash
scripts/ollama/setup.sh                     # downloads the Q8_0 GGUF (~235 MB) and runs `ollama create lfm25-230m`
npm run extract:eval                        # data/sample-messages.txt -> extractions.csv, one row per field
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

Runs every message through the real classifier (needs `TYPESAFE_API_KEY` in the environment) and writes a CSV with the predicted action, its confidence, the extracted parameters (each with its confidence), and which required parameters are missing. The empty `expected_action` column is for you to fill in, by hand in a spreadsheet or with the annotation page below. `data/sample-messages.txt` has about 240 messages: clear requests for each of the 14 actions, vaguer "ambiguous" ones for each action (the group name says which action was meant), scheduled payments, messages that mix actions, requests the app has no form for, and tricky values.

### Annotating them

Open [`/annotate`](http://localhost:3000/annotate) (`npm run dev`). It shows `predictions.csv` one message at a time: what Jev picked and what the LiquidFM extractor read, field by field, each row tinted and badged **Jev** (it picked the action and the choices), **LiquidFM** (it read names, emails, amounts and dates through Ollama; a value Jev disagreed with is shown as "Jev said …"), or **Blank** (neither found one), and the real form the customer would get. If Ollama isn't running the card says so and shows Jev's values. The summary still scores Jev's own values. Press **Y** if Jev got it right, or **N** to fix the expected action and values, then **Enter**. Squares at the top show each message's status (green right, amber wrong values, red wrong action) and jump to it. **Summary** shows action accuracy, value accuracy, accuracy by confidence, and the list of mistakes.

Every answer is saved as you go, in two places. The browser keeps it in localStorage, and the server applies each change to `data/annotations.csv` (a server action in `src/app/annotate/actions.ts`; set `ANNOTATIONS_FILE` to use another path). The page shows `Saved to data/annotations.csv` beside the progress count. Open the page in a different browser and it restores the answers from that file; answers for messages whose text has since changed are ignored. If the file can't be read (say, a hand edit left an unknown action), autosave stays off and the page tells you, so nothing is overwritten. This needs a writable local filesystem and has no login yet, so don't deploy it as is. A CSV you **Import** is kept in the browser only and never touches the file.

**Download CSV** writes the predictions with `expected_action`, `expected_params` and `annotator_note` filled in; **Import CSV** loads any predictions CSV, including one downloaded earlier, so you can pick up where you left off. `predictions.csv` covers the whole dataset (the original 100 messages plus every fine-tuning example, filled by `npm run predict:examples`). The **Split** menu filters to train, val, test or pending, **Kind** to the kind of example, and **Reviewer** to rows you reviewed yourself versus rows Claude approved (`meta.reviewedBy`; the first 62 human reviews were recovered from git history before training). Approving a prediction whose message is already in the fine-tuning file puts the review on that row; any other message is added as a train-only row, so val and test never change. The page reads `predictions.csv` (override with `PREDICTIONS_FILE`) at build time: restart `npm run dev` after re-running `npm run predict`, or import the new file.

**Who filled each field.** On the Jev predictions view, the action and every field row carry a badge: **Jev** (the action and the choice fields), **LiquidFM** (the typed-in values, read by the fine-tuned extractor) or **Blank** (neither found it). The badges always show; if Ollama is down the card says so and every value is Jev's.

**Fine-tuning data.** The **Fine-tuning data** switch above the progress opens `data/sft/examples.jsonl` (sample and generated rows; `SFT_REVIEW_FILE` to use another path): Y approves a row, N corrects it, action `none` rejects it, and every answer is written into the row in the file for `npm run sft:build` to train on. Import also takes the JSONL files from `docs/sft-dataset.md` (`data/sft/*.jsonl`, or model output from `npm run extract:eval -- data/sample-messages.txt out.jsonl`). The **Full / Fields only** switch next to Summary changes the card: Full is the whole picture, Fields only shows just the extractor model's fields for the action, blanks marked, and a fix-it form without the choice fields. Pressing Y or saving a fix on the Jev predictions view also adds the answer to `data/sft/examples.jsonl` as an approved, train-only row, with the **Kind of example** you picked (typo, accented name, worded number, date...); `npm run sft:kind` backfills kinds on older rows. **Download labels** writes the reviewed answers as `message => field=value` lines, the batch format `npm run sft:add` reads.

- `src/app/annotate/page.tsx` is a Server Component that reads the file (`lib/annotate/load.ts`, `"use cache"`) and passes the rows to `components/annotate/annotator.tsx`, the client component that does the rest.
- `src/lib/annotate/combine.ts` merges Jev's and LiquidFM's fields and records who filled each; `extractMessageFields` in `app/annotate/actions.ts` is the server action that calls Ollama (`OLLAMA_URL`). Browser tests use `e2e/fake-ollama.mts`.
- `src/lib/annotate/` holds the plain functions: CSV reading and writing (`dataset.ts`, `csv.ts`) and the scoring (`summary.ts`). Values are compared loosely: `50` matches `50.00`, phone numbers by digits, names ignoring case.
- `npm run annotate:preview` (after `npm run build`) bundles the same component into one HTML file with the predictions embedded, for sharing where the server can't run, such as a Claude Artifact.

## Dependency notes

- TypeScript 7 (the native compiler) runs `npm run typecheck`. `typescript-eslint`, which `eslint-config-next` uses, doesn't support TS 7 yet, so `typescript` in `package.json` is aliased to Microsoft's `@typescript/typescript6` compatibility package for the tools that import it (ESLint, Next), as the TS 7 announcement recommends, and `@typescript/native` provides `tsc`. Once typescript-eslint supports TS 7, replace both with a plain `typescript@7`.
- `@types/node` stays on 22 to match the Node 22 runtime; newer majors describe APIs Node 22 doesn't have.
- shadcn/ui components are copied into `src/components/ui/` (not a dependency), so they only change when you re-run `npx shadcn add <name> --overwrite`.
- `npm audit` reports a `braces` advisory in the ESLint toolchain (dev only, nothing ships). There is no patched `braces` release yet.

## Before deploying

The server action is a public endpoint. Add authentication (and rate limiting, since each call spends TypeSafe credits) before exposing it. The forms don't call a banking API yet; submitting shows a demo notice.
