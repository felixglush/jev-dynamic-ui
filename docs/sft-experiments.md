# SFT experiment log

One entry per training run, newest last. For how the data and training work, see [sft-dataset.md](sft-dataset.md).

**Metrics** (per field, from `training/modal_train.py`, greedy decoding constrained to the action's JSON schema, as Ollama does at run time):

- **fabricated**: the label is blank but the model filled it in. The failure fine-tuning is for, so the number to watch.
- **missed**: the label has a value but the model left it blank.
- **wrong**: both have a value and they differ.
- **exact**: every field in the record matches.

Val is for choosing settings. Test is read once per candidate model. Both are AI-written, so treat differences of a few points as noise (98 records each).

## Setup shared by all runs

| | |
| --- | --- |
| Base model | `LiquidAI/LFM2.5-230M` |
| Data | 645 approved rows, all reviewed by Claude and approved in bulk (commit `e56efb1`); split 449 train / 98 val / 98 test, stratified by group |
| Hardware | Modal, L4 GPU, account `felixglush`, env `main` |
| Tooling | Modal client 1.6.2; `transformers`, `trl`, `peft` unpinned (latest at image build); `xgrammar` for constrained decoding |
| Scoring script | `training/modal_train.py` at `2ce8a47` |

## Baseline: untouched base model

Date: 2026-10-16. Stage: `modal run training/modal_train.py --stage baseline`.

| Split | Records | Exact | Fabricated | Missed | Wrong | Bad JSON |
| --- | --- | --- | --- | --- | --- | --- |
| val | 98 | 23.5% | 89.1% | 1.7% | 7.8% | 1 |
| test | 98 | 30.6% | 85.2% | 0.8% | 4.9% | 1 |

Reading: the base model fills in almost every field that should be blank (invented emails like `alex@example.com`, dates like `2023-10-05`). It rarely misses a stated value.

Notes on how this number was reached (so it isn't repeated):

- A first baseline without schema-constrained decoding scored 0% exact and 98/98 invalid JSON on both splits, because the base model chats back ("Sure! Here's the translated text…", "I'm sorry, but I can't assist with that."). That measured the missing output constraint, not the model. Discarded.
- `lm-format-enforcer` 0.11.3 fails to import under transformers 5 (`PreTrainedTokenizerBase` moved), so scoring uses `xgrammar`.

## Run 1: LoRA, first settings

Date: 2026-10-16. Command: `modal run training/modal_train.py`.

| Setting | Value |
| --- | --- |
| LoRA | rank 16, alpha 32, dropout 0.05 |
| Targets | `q_proj k_proj v_proj out_proj in_proj w1 w2 w3` |
| Training | learning rate 2e-4, cosine, warmup 5% of steps, 3 epochs, batch 16, max length 512, best epoch by validation loss |
| Loss | on the assistant answer only (prompt/completion form) |

Result (run on Modal, app `ap-oEu0eZ5MdhP4ltHhCGbo6V`; best epoch was the last, validation loss 0.019, 0.0105, 0.0100):

| Split | Exact | Fabricated | Missed | Wrong | Bad JSON |
| --- | --- | --- | --- | --- | --- |
| val | 95.9% | 0.8% (1 of 128 blank) | 0.0% | 2.6% (3 of 116 stated) | 0 |
| test | 95.9% | 1.6% (2 of 122 blank) | 1.6% (2 of 122 stated) | 0.0% | 0 |

Against the baseline, fabrication fell from 89.1% / 85.2% to 0.8% / 1.6% and exact match rose from 23.5% / 30.6% to 95.9% on both splits. A GGUF (Q8_0, 244 MB) was exported to the `jev-sft` volume; not yet fetched or tried in Ollama.

Errors (7 records in all, read from `training/out/tuned.json`):

- **Spelled-out numbers (val, 2 of 3 wrong):** `two hundred and fifty dollars` became 150 and 450. Only a handful of spelled-out amounts above 100 are in train.
- **Truncated name (val):** `Fortis BC` became `Fortis`.
- **Name derived from an email (test):** `nanny.jo@gmail.com` gave `name: nanny.jo`. This breaks labeling rule 2.
- **Past event used as a date (test):** `dinner last night` gave `date: last night`. This breaks labeling rule 5.
- **Dropped name (test):** `jordan` in lowercase was left blank.
- **Dropped date (test):** `send it today` left `date` blank.
- **Cancellation date (val):** `I was charged by Hulu after I cancelled on October 20` kept `October 20`, which is the cancellation date, not the charge date.

Caveats, so the number is not over-read:

- Val and test are 98 records each, AI-written, and many train rows are paraphrases of the same templates, so test is likely easier than real messages. One record is about 1 point.
- The best epoch was picked on val loss, so val is slightly optimistic. Test is the cleaner number.
- Read test only once per candidate model; this run's test numbers are now spent on Run 1.

## Run 2: Run 1 settings, plus 134 train-only rows for Run 1's errors

Date: 2026-10-16. Same settings and the same val and test files as Run 1. Train grew from 449 to 583 rows (commit `74a3f6f`). The new rows are tagged `meta.trainOnly`, so they never enter val or test. They target: spelled-out amounts of 100 or more, multi-word company names, an email with no name, past-event and cancellation dates left blank, lowercase names, `today` kept as a date.

| Split | Exact | Fabricated | Missed | Wrong | Bad JSON |
| --- | --- | --- | --- | --- | --- |
| val | 94.9% (Run 1: 95.9%) | 0.8% (1) | 0.9% (1) | 2.6% (3) | 0 |
| test | 98.0% (Run 1: 95.9%) | 0.8% (1) | 0.0% | 0.8% (1) | 0 |

Validation loss 0.0181, 0.0112, 0.0104; best epoch the last.

Errors (8 records):

- **Still wrong, same pattern as Run 1:** `ten thousand` became 1000 (val and test); the Hulu `cancelled on October 20` date was kept (val).
- **Fixed from Run 1:** `two hundred and fifty` (now right), `Fortis BC`, `nanny.jo@gmail.com` with no name, `dinner last night`, `jordan` in lowercase, `send it today`.
- **New errors:** `put dave at dave99@gmail.com` gave a blank name (label `dave`); `pay my Bell internet bill` gave payee `Bell internet bill`; `Scotia Insurance` came back with a leading space; `autodeposit for 438-555-0120 and kay.d@gmail.com` put the word `autodeposit` in `email`; `cancel e-transfer to ben@gmail.com` put the email in `recipient`.

Reading: the net change is not distinguishable from noise. Val went from 6 wrong records to 5 and test from 4 to 2, but the errors moved around: some patterns are fixed, new ones appeared, and the two worst (large spelled-out amounts, cancellation dates) did not move. Fabrication stayed at 1 to 2 fields. One record is 1 point on each set.

**Do not read the test gain as proof the fixes work.** Run 1's test errors were read and the new rows were written for them, so test is no longer a clean held-out set. Val and test are retired as the final measure until new held-out rows exist (see below).

## Fair evaluation v2

Date: 2026-10-16. Replaces the plan in [handoff-fair-eval.md](handoff-fair-eval.md).

**Decisions**

- **Val is the dev set.** Its errors may be read, and it is used to choose settings and to decide which train rows to add.
- **Test is sealed.** Nobody reads its errors; it is scored once per final candidate. The output of `modal_train.py` no longer contains the test messages or which test rows failed, only counts (overall and per pattern), so this is enforced in code and tested.
- **The old test is retired as `dev-2`.** Run 1's test errors were read and rows were written for them, so those 98 rows no longer measure generalisation. They stay in the v2 test file (existing rows keep their splits) but the sealed part of v2 test is its **new rows**, tagged `meta.version: "v2"`. The report gives both the pattern tables with all rows and with v2 rows alone.
- **Versions.** A row with no `meta.version` is v1. `data/sft/{train,val,test}.jsonl` is the current version (v2 = every row). `data/sft/v1/` holds the v1 files exactly as scored for Runs 1 and 2 (583 / 98 / 98); a test rebuilds v1 from the v1 rows and checks the messages are identical. **Scores are only compared within a version**: the v1 numbers above are not comparable with v2.

**What changed**

- Code (`b7e17a8`): `meta.split` (`train`/`val`/`test`) pins a row and overrides the hash split; `trainOnly` still works (read as `split: "train"`; `split` wins when both are set). `meta.pattern` and `meta.version` added. `sft:add` takes `--split`, `--pattern`, `--version`, and batch files can carry `# split:` / `# pattern:` lines. `applyReview` keeps the new fields. Tests cover pinning not moving any hash-split row, `trainOnly` compatibility and v1 reproducibility.
- Tags on existing rows (`b7e17a8`): assigned by simple rules on the message and label (see below), not by reading each row. Counts by pattern and v1 split are in the table below.
- Held-out rows (`1080147`): 70 new rows, 5 val and 5 test for each of 7 patterns. Written without opening the train batch (I only listed the 134 train-only messages to avoid exact duplicates; none of the 70 was a duplicate). Different names, companies, amounts and phrasing from train. Labels were checked against the substring rule and `docs/sft-dataset.md` section 2 and marked `approved` by Claude with a note; **none of these rows was reviewed by a person**.
- Scoring (`training/modal_train.py`): pass rate (exact record match) per `meta.pattern`, for all rows and for v2 rows alone, plus per version; `--stage score --run <folder>` scores a saved model from the volume; every stage writes to its own volume folder (`--run`), so `latest/` is no longer overwritten by accident; `--train-subset run1` trains on the Run 1 rows only. Run 2's weights were copied to the volume folder `run2/` before anything was trained.

**Pattern tags** (rules: `cancel-email-only` = cancel with an email and no recipient; `past-event-date` = a date field that is blank and the message has `last night`, `yesterday`, `cancelled on` and the like; `today-date` = date label `today`/`tonight`; `spelled-amount` = `hundred`/`thousand` in the message and amount at least 100; `lowercase-name` = a name label that starts lowercase; `email-no-name` = an email and no name, or autodeposit with phone and email; `company-name` = a payee/biller/merchant of two or more words, or `my X ... bill`):

| Pattern | Existing rows tagged (train / val / test) | New v2 rows (val / test) |
| --- | --- | --- |
| spelled-amount | 59 / 3 / 2 | 5 / 5 |
| company-name | 35 / 7 / 3 | 5 / 5 |
| email-no-name | 45 / 10 / 6 | 5 / 5 |
| past-event-date | 18 / 1 / 1 | 5 / 5 |
| lowercase-name | 17 / 1 / 1 | 5 / 5 |
| today-date | 9 / 1 / 1 | 5 / 5 |
| cancel-email-only | 1 / 0 / 1 | 5 / 5 |

v2 sets: val 133 (98 v1 + 35 new), test 133 (98 + 35), train 583 until Run 3's rows are added.

**Caveats that apply to every v2 number**

- The new rows are AI-written by the same author who knows which patterns failed, in the same style as train. A pass shows the fixes generalise within these patterns, not that the model is accurate on real messages.
- Five rows per pattern per split means one row is 20 points on a single cell. Read patterns as pass counts, not percentages, and do not rank models on differences of one or two rows.
- The v1 part of val and test was already read (errors from Run 1 and Run 2), so only the v2 rows are clean.

## Ideas to try next

- More data: train is 449 rows against a target of about 2,000; several fields have under 20 stated examples (`setup_autodeposit.phone` 9, `transfer_between_accounts.date` 11, `pay_bill.date` 12).
- Real user messages for val and test, so scores aren't measured on AI-written text.
- Fair evaluation: treat val as the dev set (read its errors) and keep test sealed. Write new held-out rows per failure pattern (8 to 10 each, tagged in `meta`, written without looking at the train batch), pin them to val or test, version the sets (v1, v2) and re-score every candidate on the current version. Report pass rate per pattern as well as overall. Needs a `meta.split` pin and a per-pattern report in `modal_train.py`.
- Large spelled-out amounts (`ten thousand`) and `cancelled on <date>` still fail after the Run 2 rows; they need more and more varied examples, or a different approach.
- Learning rate, epochs and LoRA rank sweeps, choosing on val only.
- Add train rows for the error patterns above: spelled-out amounts over 100, multi-word company names, an email given without a name, past-event dates, lowercase names.
- Fetch the GGUF, run it in Ollama through the real extractor (`extract:eval`) and compare with the Modal numbers.
- Install `causal_conv1d` in the training image for faster convolution layers.
