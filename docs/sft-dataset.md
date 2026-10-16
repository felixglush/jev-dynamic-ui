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
 "meta": {"id": "seed-006", "action": "send_etransfer", "vague": false, "present": ["recipient_email", "amount"]}}
```

Why this shape:

- **Same conversation the extractor sends.** The system prompt comes from `systemPromptFor()` in `src/lib/extract/ollama.ts` (I split it out of `extractFields` so both use one function). If training and run time word the prompt differently, the tuning helps less. A test pins this.
- **The schema is not in the text.** Ollama forces the output to match the JSON schema while decoding (`format`), so the model only needs to learn the values, not the JSON syntax. Training text stays short, which matters for a 230M model.
- **The answer has every field, in schema order**, with `""` for absent text and `0` for absent amounts. That is exactly the "required but may be empty" contract in `schemaFor()`, and the extractor already treats `""`/`0` as blank.
- **Each action has its own system prompt and field list**, so the model learns per-action groups (Felix's requirement). Choice fields (which account, which card) stay with Jev and are not in the answer. `manage_card` and `view_account` have no free-text fields, so they have no training examples.
- `meta` is for humans and the split script. Train on the `messages` column only.

## 2. Labeling rules

These decide what "correct" means, so they matter more than the example count.

1. **Copy, never infer.** A text value must appear literally in the message (case and accents as written); amounts are the number the message states, converted (`2k` → 2000). Nothing in code enforces this any more, so it is checked in review. `sft:build` only checks structure: the field belongs to the action, amounts are positive, no empty strings.
2. **Absent means empty.** An email in the message is not a name: `transfer $300 to priya.k@example.com` has `recipient: ""`. Do not derive a name from an email address.
3. **Names.** Use the person's name if given (`my sister Priya` → `Priya`). A relationship alone (`mom`, `my landlord`, `my roommate`) is **blank**: the UI highlights it. A name with no email or phone (`send to Priya`) still fills the name; the app is meant to look up the email later, once there is a database. Companies are only company names: `my phone bill` has no payee, `Rogers` does. Titles stay (`Ms. Chen`).
4. **Amounts are plain numbers**: `$1,850` → 1850, `2k` → 2000, `$1.5k` → 1500, `two hundred dollars` → 200, `75.50` → 75.5. A number that isn't money (`a 1 year GIC`, `the 15th`, a phone number) is never the amount. When two amounts appear, take the one for this action (`charged $11.99 but my plan is $9.99` → 11.99).
5. **Dates are copied as written** (`tomorrow`, `the 1st`, `December 24`, `2026-11-05`, `03/04`). No converting to ISO, no checking validity (`February 30` stays; the form validates). Keep the day only: `the 1st of every month` → `the 1st`; "every week/month" is the frequency choice, not a date. A past event used as a reason (`dinner last night`) is not a schedule date. For `dispute_transaction` the date is the charge date.
6. **Phones and account numbers as written**, minus trailing words (`416 555 0123 ext 2` → `416 555 0123`).
7. **Several people in one message** (`send 50 to Sam and 30 to Priya`) are left out of the data. The UI handles one transfer at a time (Felix's call).
8. **Vague messages stay in.** `send it to Jordan` still has a name; `pay my bills` has nothing. Mostly-empty answers are the lesson, so they are kept on purpose (`# <action> (vague)` groups in the seed file).

## 3. Coverage targets

The seed (187 hand-labeled examples from `data/sample-messages.txt`) is the starting point, not the finish. Targets for the final set, counted per field in the **train** split (`npm run sft:build` prints this table):

| What | Target | Seed today |
| --- | --- | --- |
| Examples per action | 150 to 250 (about 2,000 total) | 15 to 30 |
| Per field: value stated | at least 40 each | 0 to 18 |
| Per field: field blank | at least 40 each, and 30 to 40% of all answers | 17 of 20 for `recipient_email`, few for `add_etransfer_contact.name` |
| Fully empty answers | 10 to 15% | 36% (68 of 187), too many: synthetic data should dilute this |
| Phrasing | typos, lowercase, no punctuation, slang (`bucks`, `interac`), spelled-out numbers, accented and hyphenated names, two or three word names | partial |
| Look-alikes | field A present but B absent (email without name, name without email, amount in the message but no date) | a few |

Weak spots in the seed today: `setup_autodeposit.phone` (no stated example in train), `request_etransfer.from_email` (1), `send_etransfer.date` (2), and `add_etransfer_contact.name` (rarely blank; add messages like `add a contact, email is x@y.com`).

Why a few thousand and not tens of thousands: this is one narrow, mechanical task and 230M parameters. Label quality and covering the "absent" cases matter more than volume.

## 4. Workflow

1. **Seed (done here).** 187 hand-labeled lines in `data/sft/seed-labeled.txt`. Messages came from `sample-messages.txt`, which is the same text the base model was evaluated on, so the base-model numbers stay comparable.
2. **Synthetic expansion.** Claude generates paraphrases of each **train** seed, plus new messages that target the thin fields above. For each generated message the generator also returns its labels. Prompt it with the labeling rules in section 2 and ask for the "absent" variant of each (same message with the email or amount removed).
3. **Automatic filter.** Run every generated example through `validateExamples` (structure only) and drop exact and near duplicates of val/test messages. Because there is no text-match check, review matters more: look first at any label whose text isn't a substring of its message, which is a cheap query to run on the generated file.
4. **Human review on `/annotate`.** Import a JSONL file (`data/sft/train.jsonl`, a synthetic file, or model output from `npm run extract:eval -- data/sample-messages.txt out.jsonl`) with the Import button. The **Full** view is the usual card; **Fields only** shows just the extractor's fields for the action, with blanks marked, and a fix-it form without the choice fields. Press Y to accept a row or fix it, then **Download labels** to get the reviewed rows as lines for `data/sft/seed-labeled.txt`. Review first any row where a label is not a substring of its message (amounts excepted), and about 10% of the rest.
5. **Check against the base model.** Run `npm run extract:eval` before and after tuning. Its CSV now only says kept or blank, so measuring fabrications means comparing against the labels in `test.jsonl`; a scorer for that is the next piece to build.

## 5. Split

`src/lib/sft/split.ts`: per action, sort by a hash of the id, take 15% as **test**, the next 15% as **val**, the rest as **train** (at least one each once an action has 5 examples). It is deterministic, so rerunning never moves an example, and per action so every action is tested.

Rules that keep the test honest:

- **Test and val are human-written only.** Synthetic examples are generated from train seeds only, so a paraphrase of a test message can never be in training.
- **Test is never tuned on**: it is read once per candidate model, val is for choosing settings. Both are rebuilt only by adding new lines at the end of a group (ids are line order, so appending keeps existing ids).
- **No message in two splits** (checked in `dataset.test.ts`).
- At 30 test examples each field has a handful of cases, which is noisy. Grow the held-out set to 100 to 150 hand-written messages before trusting small differences between models.

## 6. Training (next step, not in this PR)

LiquidAI publishes `LiquidAI/LFM2.5-230M` (the instruct model Ollama runs) on hf.co. Fine-tune that one, with loss on the assistant answer only. At this size a full fine-tune or a LoRA both fit on one GPU. Then convert to GGUF Q8_0 and register it with `scripts/ollama/Modelfile`, replacing the base weights. The e2e check is the same `extract:eval` run.

## Decisions (Felix, 2026-10-16)

1. Multi-recipient messages stay out of the data.
2. Relationship-only names are blank.
3. Claude generates the synthetic messages; Felix reviews them on the `/annotate` page.
