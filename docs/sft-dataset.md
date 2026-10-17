# Fine-tuning dataset for the field extractor

Goal: teach LFM2.5-230M to fill each action's free-text fields from a banking message, and to leave a field **empty** when the message doesn't state it, so the UI highlights it for the customer. The base model fills every field and invents values (emails, dates, amounts). There is no run-time check against the message (Felix removed the grounding filter), so the model itself has to say "not stated": that is what fine-tuning is for.

SFT = supervised fine-tuning: show the model many (input, correct answer) pairs and nudge it to produce the correct answer.

## 1. Record format

One JSON object per line (JSONL), chat style:

```json
{"messages": [
  {"role": "system",    "content": "Extract these fields from the user's banking message: recipient, recipient_email, amount, date. Only copy information ... Never invent names, emails, phone numbers or dates."},
  {"role": "user",      "content": "transfer $300 to priya.k@example.com"},
  {"role": "assistant", "content": "{\"recipient\":\"\",\"recipient_email\":\"priya.k@example.com\",\"amount\":300,\"date\":\"\"}"}],
 "meta": {"id": "smp-006", "action": "send_etransfer", "vague": false, "present": ["recipient_email", "amount"]}}
```

Why this shape:

- **Same conversation the extractor sends.** The system prompt comes from `systemPromptFor()` in `src/lib/extract/ollama.ts` (I split it out of `extractFields` so both use one function). If training and run time word the prompt differently, the tuning helps less. A test pins this.
- **The schema is not in the text.** Ollama forces the output to match the JSON schema while decoding (`format`), so the model only needs to learn the values, not the JSON syntax. Training text stays short, which matters for a 230M model.
- **The answer has every field, in schema order**, with `""` for absent text and `0` for absent amounts. That is exactly the "required but may be empty" contract in `schemaFor()`, and the extractor already treats `""`/`0` as blank.
- **Each action has its own system prompt and field list**, so the model learns per-action groups (Felix's requirement). Choice fields (which account, which card, how much of a card balance to pay) stay with Jev, which picks from the supported options in the catalog, and are not in the answer.
- `meta` is for humans and the split script. Train on the `messages` column only.

### Per-action system prompt and schema

The prompt and the schema both depend on the action. The prompt wording is the same for every action; only the field list in its first sentence changes:

> Extract these fields from the user's banking message: **\<fields\>**. Only copy information that is actually written in the message. If a field is not stated, leave it empty. Never invent names, emails, phone numbers or dates.

The schema (`schemaFor(action)` in `src/lib/extract/ollama.ts`) is an object with exactly the action's fields, in this order, all required, `additionalProperties: false`. Amounts are `number` (`0` = not stated); every other field is `string` (`""` = not stated). The model never picks the action: Jev does, and passes it in as the field list and schema. Scoring builds the same schema from each record's label (`answer_schema` in `training/modal_train.py`).

| Action | Fields (in schema order; `$` = number, rest string) |
| --- | --- |
| `send_etransfer` | `recipient`, `recipient_email`, `amount`$, `date` |
| `request_etransfer` | `from_person`, `from_email`, `amount`$ |
| `cancel_etransfer` | `recipient`, `amount`$ |
| `add_etransfer_contact` | `name`, `email`, `phone` |
| `setup_autodeposit` | `email`, `phone` |
| `pay_bill` | `payee`, `amount`$, `date` |
| `add_payee` | `biller`, `account_number` |
| `pay_credit_card` | `amount`$ |
| `open_account` | `initial_deposit`$ |
| `transfer_between_accounts` | `amount`$, `date` |
| `dispute_transaction` | `merchant`, `amount`$, `date` |
| `update_contact_info` | `new_email`, `new_phone` |

`manage_card` and `view_account` have no free-text fields, so they have no schema and no training rows. Choice fields (which account, which card, how much of a card balance) are not in any schema; see the "detour to avoid" note below.

## 2. Labeling rules

These decide what "correct" means, so they matter more than the example count.

1. **Copy, never infer.** A text value must appear literally in the message (case and accents as written); amounts are the number the message states, converted (`2k` → 2000). Nothing in code enforces this any more, so it is checked in review. `sft:build` only checks structure: the field belongs to the action, amounts are positive, no empty strings.
2. **Absent means empty.** An email in the message is not a name: `transfer $300 to priya.k@example.com` has `recipient: ""`. Do not derive a name from an email address.
3. **Names.** Use the person's name if given (`my sister Priya` → `Priya`). A relationship alone (`mom`, `my landlord`, `my roommate`) is **blank**: the UI highlights it. A name with no email or phone (`send to Priya`) still fills the name; the app is meant to look up the email later, once there is a database. Companies are only company names: `my phone bill` has no payee, `Rogers` does. Titles stay (`Ms. Chen`).
4. **Amounts are plain numbers**: `$1,850` → 1850, `2k` → 2000, `$1.5k` → 1500, `two hundred dollars` → 200, `one hundred and twenty five dollars` → 125, `two grand` → 2000, `a grand` → 1000, `fifteen hundred` → 1500, `75.50` → 75.5. Only a number the customer wrote is converted: arithmetic (`half of 200`), `a couple hundred` and `a few bucks` leave the amount blank (v5). A number that isn't money (`a 1 year GIC`, `the 15th`, a phone number) is never the amount. When two amounts appear, take the one for this action (`charged $11.99 but my plan is $9.99` → 11.99).
5. **Dates are copied as written** (`tomorrow`, `the 1st`, `December 24`, `2026-11-05`, `03/04`). No converting to ISO, no checking validity (`February 30` stays; the form validates). Keep the day only: `the 1st of every month` → `the 1st`; "every week/month" is the frequency choice, not a date. A past event used as a reason (`dinner last night`) is not a schedule date, and neither is a time of day (`at 4pm`) or an urgency word (`asap`, `right now`). Drop a leading `on` or `at` (`at the end of the month` → `the end of the month`), but keep `in 2 days` and `next friday` as written; `tomorrow at 4pm` → `tomorrow` (v5). For `dispute_transaction` the date is the charge date.
6. **Phones and account numbers as written**, minus trailing words (`416 555 0123 ext 2` → `416 555 0123`, and an `x123` extension likewise).
7. **Several people, addresses or payees in one message** (`send 50 to Sam and 30 to Priya`, `add Sam and Pat as contacts`, `autodeposit for a@x.com and b@y.com`) are blank in every field, because the UI handles one transfer at a time and picking the first would be a guess. Until v4 these messages were left out of the data; v5 adds them as all-blank rows (proposed to Felix on 2026-10-17 as part of the v5 plan; he has not objected, and can reverse it).
8. **Vague messages stay in.** `send it to Jordan` still has a name; `pay my bills` has nothing. Mostly-empty answers are the lesson, so they are kept on purpose (rows with `meta.vague`).

## 3. Coverage targets

The 187 sample rows (from `data/sample-messages.txt`) plus 458 generated rows are the starting point, not the finish, and **none of it counts until a person approves it on `/annotate`**: all labels so far were written by Claude. Targets for the final set, counted per field in the **train** split (the "written so far" column counts all rows, approved or not) (`npm run sft:build` prints this table once rows are approved):

| What | Target | Written so far (not yet approved) |
| --- | --- | --- |
| Examples per action | 150 to 250 (about 2,000 total) | 39 to 103 |
| Per field: value stated | at least 40 each | 13 to 91 (thinnest: `transfer_between_accounts.date`, `setup_autodeposit.phone`, `pay_bill.date`) |
| Per field: field blank | at least 40 each, and 30 to 40% of all answers | at least 9 each |
| Fully empty answers | 10 to 15% | 22% |
| Phrasing | typos, lowercase, no punctuation, slang (`bucks`, `interac`), spelled-out numbers, accented and hyphenated names, two or three word names | covered in the first batch |
| Look-alikes | field A present but B absent (email without name, name without email, amount in the message but no date) | covered in the first batch |

Run `npm run sft:build` after a review session to see the real counts. Why a few thousand and not tens of thousands: this is one narrow, mechanical task and 230M parameters. Label quality and covering the "absent" cases matter more than volume.

## 4. Workflow

Everything lives in one file, `data/sft/examples.jsonl`. Each row is a training record plus review fields in `meta`: `source` (`sample` or `synthetic`), `status` (`pending`, `approved`, `rejected`), `original` (what Claude wrote, kept once you change it) and `note`.

1. **Sample rows.** 187 messages from `sample-messages.txt` (the same text the base model was evaluated on, so base-model numbers stay comparable), labeled by Claude using the rules above.
2. **Synthetic rows.** Claude Sonnet 5.5 wrote 458 more messages, aimed at the thin fields (an email with no name, a date with no amount, "relationship only" blanks, typos, spelled-out numbers, accented names) and some fully empty answers. They were written in a Claude Code session, not through the API, because that environment has no `ANTHROPIC_API_KEY`. To add a batch, write lines like `message => field=value; field=value` (with `# <action>` headers) and run `npm run sft:add -- batch.txt` (or `--source sample` for real messages). It adds **pending** rows, skips messages already in the file and never touches reviewed rows.
3. **Automatic filter.** `sft:add` checks structure only (known field, positive amount, no duplicates). There is no text-match check, so review matters: look first at any label whose text isn't a substring of its message.
4. **Human review on `/annotate`.** Switch to **Fine-tuning data**. It opens `data/sft/examples.jsonl` on the **Fields only** view (the model's fields with blanks marked); use the **Group** menu to work through one group at a time (it shows reviewed/total); **Full** shows the whole card. Press **Y** to approve a row, **N** to correct it (change values, or pick another action), or choose action `none` to reject it. Every answer is written straight into the row in the file:
   - `meta.status` becomes `approved` or `rejected`, and the row's answer and system prompt are rewritten if you corrected it;
   - `meta.original` keeps what Claude wrote the first time you change a row, and **Clear all** (or taking an answer back) restores it, so the Summary shows how often Claude's labels were wrong;
   - there is no browser-only copy for this file; the file is the source of truth.
   Other JSONL files (`train.jsonl`, or model output from `extract:eval`) still open with **Import file**, browser-only.
5. **Build.** `npm run sft:build` writes `train.jsonl`, `val.jsonl` and `test.jsonl` from the **approved** rows only, so they stay empty until you approve something. Pending and rejected rows are ignored.
6. **Check against the base model.** `training/modal_train.py` scores the base model and the tuned one on val and test (section 6).

### Where rows come from

- **Suggested by Claude:** `npm run sft:add` writes pending rows, which you approve on the **Fine-tuning data** view.
- **Approved on the real predictions page:** pressing Y (or saving a fix) on a message there also adds it to `data/sft/examples.jsonl` as an approved row with the **Kind of example** you picked. These rows are `trainOnly`, so they never land in val or test and scored sets stay comparable. A message already in the file is not added twice, and "none" answers are not added. Clearing the answer later does not remove the row; reject it on the Fine-tuning data view.
- On the Fine-tuning data view, the **Kind** menu walks one kind at a time and the **Kind of example** menu on each card changes it.

## 5. Split

`src/lib/sft/split.ts`: **group-stratified**. A group is an action, plus "(vague)" for messages that don't say enough: the same label the `/annotate` Group menu shows. Each group is split on its own: its approved rows are ordered by a hash of their id, the first 15% go to **test**, the next 15% to **val**, the rest to **train**. So every group appears in all three files in about the same proportions, instead of one action missing from val by bad luck. A group with fewer than 4 approved rows stays all train.

Sample and synthetic rows are treated the same: both are AI-written and both need your review, so nothing about a row's source decides its split.

Rules that keep the test honest:

- **No message in two splits.** A train row that repeats a val/test message is dropped (`sft:build` lists them), so a paraphrase-free copy of a test message can never be trained on (checked in `dataset.test.ts`).
- **Test is sealed**: its errors are never read (the report prints counts only), val is the dev set. Every row also has a `meta.kind`, the kind of example it is (typo, accented name, unusual name, worded number, amount format, date, multiple numbers, distractor, email or phone, missing info, plain; list in `src/lib/sft/kinds.ts`). It is separate from `meta.pattern`, which stays frozen for evaluation, so a reviewer can change a kind freely. `npm run sft:kind` gives a first guess to rows without one, and `sft:add` accepts `--kind` and `# kind:` lines. Rows can be pinned to a split with `meta.split` (`sft:add --split`), tagged with `meta.pattern`, and versioned with `meta.version`; see [sft-experiments.md](sft-experiments.md), "Fair evaluation v2".
- The counts come from each group's size, so the split shifts slightly as rows are approved. Build the files once review is done, and change `SPLIT_SALT` only on purpose (it reshuffles the held-out sets).
- Everything is AI-generated so far, so val and test are not yet real user messages. Treat the scores as a check on the pipeline; add real messages with `sft:add -- batch.txt --source sample` before trusting small differences between models.

## 6. Training (LoRA on Modal)

LoRA trains small add-on matrices next to the frozen model instead of changing all 230M weights. It is cheap, hard to overfit on a small set, and the add-on is a few MB.

`training/modal_train.py` does the whole run on a Modal GPU (an L4): `modal run training/modal_train.py`.

1. **Baseline.** Scores the untouched `LiquidAI/LFM2.5-230M` on val and test, so there is something to compare with.
2. **Train.** LoRA with rank 16, alpha 32, dropout 0.05, learning rate 2e-4, 3 epochs, batch 16. It targets every linear layer type the model has, which I read from the model's safetensors header: attention `q_proj k_proj v_proj out_proj`, the convolution blocks' `in_proj out_proj`, and the feed-forward `w1 w2 w3`. The records are given as prompt (system + user) and completion (the assistant JSON), so the loss is counted on the answer only. The best epoch by validation loss is kept.
3. **Score.** The merged model answers every val and test message with greedy decoding, and the script reports per field: *fabricated* (label blank, model filled it in), *missed*, *wrong*, plus exact-record match and invalid JSON. Fabrication rate is the number to watch. The misses are saved to `training/out/*.json` to read.
4. **GGUF.** Converts the merged model to Q8_0 with llama.cpp. Fetch it with `modal volume get jev-sft <run>/<base model>-SFT-Q8_0.gguf scripts/ollama/models/` (e.g. `LFM2.5-350M-SFT-Q8_0.gguf`; runs converted before 2026-10-17 are all named `LFM2.5-230M-SFT-Q8_0.gguf`, whatever the base), run `scripts/ollama/use-tuned.sh`, and the extractor uses it by default (`lfm25-350m-sft`).

You need a Modal account and `modal setup` once (the token stays on your machine). The scoring code has tests (`python3 -m pytest training`); the Modal run itself hasn't been run yet, so expect a library-version tweak on the first try (the image installs the latest `transformers`, `trl` and `peft`; the model was exported with transformers 5.2).

## What review found in the first iteration

Felix's first pass on `/annotate` (62 sample rows approved, 10 of them with a note) showed the first batch of labels was not ready to train on. Nothing was wrong with the copying rules; the problem was **which fields the data asked the model for**.

- **Account and payment fields were missing from the data (notes on `smp-003`, `-008`, `-049`, `-050`, `-051`, `-062`, `-068`, `-070`, `-086`).** Messages like `etransfer 40 to my roommate Dana from savings` or `move $500 from chequing to savings` state which account, and `pay the minimum` states how much of the card to pay, but the first answers had no field for it, so that information was thrown away. These are the "pick from a set of choices" parameters, which belong to Jev, not the extractor (see the README, "Who fills which parameter"). The fix is that the catalog gives Jev those choices (`from_account` on `open_account` was added so the opening deposit has a source), and the training data stays free text only.
- **Detour to avoid.** The first attempt at a fix added `from_account`, `to_account`, `payment_option` and `account_type` to the extractor's answers as copied text, and relabeled about 300 rows. Felix rejected that: choices are classified against the supported options, not copied. It was reverted, and the 62 approvals were restored. Don't add choice parameters to the training answers.
- **`cancel_etransfer` rows can't be fully labeled yet (note on `smp-141`, applying to all of them).** `cancel the e-transfer I sent yesterday` names no recipient or amount, because the real work is looking up which e-transfer is meant, and that retrieval step does not exist yet. The rows stay as they are (blank when the message is silent), but treat that group as provisional until the lookup is built.

## Decisions (Felix, 2026-10-16)

1. Multi-recipient messages stay out of the data.
2. Relationship-only names are blank.
3. Claude generates the synthetic messages; Felix reviews them on the `/annotate` page.
