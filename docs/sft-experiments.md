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

v2 sets: val 133 (98 v1 + 35 new), test 133 (98 + 35), train 583 (Runs 2 and earlier) and 653 after Run 3's 70 rows (`47b1a97`).

**Caveats that apply to every v2 number**

- The new rows are AI-written by the same author who knows which patterns failed, in the same style as train. A pass shows the fixes generalise within these patterns, not that the model is accurate on real messages.
- Five rows per pattern per split means one row is 20 points on a single cell. Read patterns as pass counts, not percentages, and do not rank models on differences of one or two rows.
- The v1 part of val and test was already read (errors from Run 1 and Run 2), so only the v2 rows are clean.

## v2 results

All on the v2 sets (val 133, test 133), greedy schema-constrained decoding, one seed. Raw output: `training/out/v2-<label>.json` (not committed; test files hold counts only). Pass = exact record match. Cells are passed/records for the **v2 rows only** (5 per pattern per split); "all v1 rows" is the 98 older rows per split, which were already read.

| Pattern (v2 rows) | Base val / test | Run 1 recipe val / test | Run 2 val / test | Run 3 val / test |
| --- | --- | --- | --- | --- |
| spelled-amount | 2/5, 1/5 | 1/5, 5/5 | 2/5, 3/5 | 5/5, 5/5 |
| company-name | 1/5, 1/5 | 5/5, 5/5 | 5/5, 5/5 | 5/5, 5/5 |
| email-no-name | 0/5, 1/5 | 4/5, 4/5 | 4/5, 5/5 | 5/5, 5/5 |
| past-event-date | 0/5, 1/5 | 2/5, 3/5 | 3/5, 4/5 | 5/5, 5/5 |
| lowercase-name | 0/5, 1/5 | 2/5, 2/5 | 5/5, 2/5 | 5/5, 3/5 |
| today-date | 3/5, 2/5 | 4/5, 4/5 | 5/5, 5/5 | 4/5, 4/5 |
| cancel-email-only | 0/5, 0/5 | 3/5, 4/5 | 3/5, 5/5 | 3/5, 4/5 |
| **all v2 rows** | 6/35, 7/35 | 21/35, 27/35 | 27/35, 29/35 | 32/35, 31/35 |
| all v1 rows (98) | 23, 30 | 94, 94 | 93, 96 | 97, 96 |

Overall (v2 sets):

| Model | Train rows | Val exact | Val fabricated | Test exact | Test fabricated | Test missed / wrong |
| --- | --- | --- | --- | --- | --- | --- |
| Base | 0 | 21.8% | 88.5% | 27.8% | 84.7% | 1.1% / 8.0% |
| Run 1 recipe | 449 | 86.5% | 4.2% | 91.0% | 4.5% | 3.2% / 0.0% |
| Run 2 (saved weights, not retrained) | 583 | 90.2% | 3.6% | 94.0% | 1.9% | 1.6% / 1.6% |
| Run 3 | 653 | 97.0% | 1.2% | 95.5% | 1.9% | 1.6% / 0.5% |

Each pattern also has older rows in val and test (tagged by rule); the full tables with them are in the `training/out` files.

**Caveats**

- Every new row is AI-written by the author who knew what failed; passes show the fixes generalise within these patterns, not accuracy on real messages. No new row was reviewed by a person.
- 5 rows per cell: one row is 20 points. Differences of one or two rows are noise. The Run 1 recipe passing `spelled-amount` 5/5 on test but 1/5 on val shows how much a cell moves.
- **Val is not clean for Run 3.** Run 3's 70 rows were chosen from what failed on val (`ten thousand`, `cancelled on <date>`), so its val gain is partly the fix being aimed at val. The sealed v2 test rows are the fairer number (Run 2 29/35, Run 3 31/35: two rows, not a significant gain).
- The test set was scored for four models (counts only). That is more than "once per final candidate"; treat Run 3 as the candidate and the others as reference points.
- The Run 1 recipe retrain (seed 0, 449 rows) reproduced Run 1's v1 numbers on the old rows (94/98 on val and on test, 95.9% as before), so training is stable across Modal runs at this scale.

### Base model, re-scored on v2

2026-10-16, `--stage baseline --run base-v2`. Val 21.8% exact, test 27.8%; fabrication 88.5% / 84.7%; 2 invalid JSON per split. The same picture as v1 (23.5% / 30.6%): it fills in almost everything.

### Run 1 recipe, retrained on v2

2026-10-16, `--stage train --train-subset run1 --run run1recipe`. Same settings as Run 1 (rank 16, alpha 32, lr 2e-4, 3 epochs, batch 16, seed 0); 449 train rows (no `trainOnly`, no v2 rows). Validation loss 0.0401, 0.0317, 0.0310 (on the larger v2 val, so not comparable with Run 1's 0.0100). Val 86.5% exact, test 91.0%. Val errors read (18 records): spelled-out amounts (`two hundred and fifty` as 150 and 450, `fifteen hundred` as 15000, `twenty five hundred` as 250, `nine hundred and eighty` as 180), `Fortis BC` truncated, the Hulu `cancelled on` date kept, past-event and cancellation dates kept, lowercase names dropped, a name taken from an email, `today` dropped on a dispute, and the recipient filled with the email on cancel rows.

### Run 2, re-scored on v2

2026-10-16, `--stage score --run run2` (weights copied to `run2/` in the volume before any retraining). Val 90.2%, test 94.0%. Val errors read (13 records): `ten thousand` as 1000 (twice), `nine hundred and eighty` as 900, `a hundred and sixty` as 60; `cancelled on <date>` kept as the date (three times); a name taken from `tomas_h@outlook.com`; `dave` dropped next to an email; `Bell internet bill` as payee; `autodeposit` put in the email field; the recipient filled with the email on two cancel rows. Run 2's own training rows moved the company, email-only and lowercase patterns (compare with the Run 1 recipe) but not large amounts or `cancelled on`.

### Run 3: Run 2 plus 70 train-only rows for the two patterns that still failed

2026-10-16, `--stage train --run run3`, commit `47b1a97`. Settings as Run 1; 653 train rows = Run 2's 583 + 70 new (`meta.split: "train"`, `meta.version: "v2"`): 46 large spelled-out amounts across all actions (`ten thousand`, `twenty thousand`, `twelve thousand five hundred`, `fifteen hundred`, `twenty-five hundred`, `nine hundred and eighty`, `a hundred and sixty` forms) and 24 dispute messages with `cancelled on <date>` (date left blank, or the charge date kept when one is given). New messages, none a copy of a held-out row. Validation loss 0.0216, 0.0112, 0.0102 (best epoch the last).

Result: val 97.0% exact, test 95.5%; fabrication 1.2% / 1.9%. Val errors read (4 records): `put dave at dave99@gmail.com` (name dropped, as in Run 2), `dispute the $23 Lyft charge from today` (date dropped), and the recipient filled with the email on two cancel rows. Test errors were not read.

Patterns that moved (v2 rows, val / test): `spelled-amount` 2/5, 3/5 to 5/5, 5/5; `past-event-date` 3/5, 4/5 to 5/5, 5/5; `email-no-name` 4/5, 5/5 to 5/5, 5/5.

### Which fixes held up

- **Held up:** large spelled-out amounts and `cancelled on <date>` after adding rows for them (val 8/8 and 6/6 including old rows, test 7/7 and 6/6, with the caveat above that the val rows are the ones the data was aimed at, and test is two or three rows better than Run 2). Multi-word company names and company-in-phrase (`Bell internet bill`, `Hydro One`, `Great-West Life`): 5/5 on val and test already from Run 2 on. Email with no name: 5/5 and 5/5 in Run 3.
- **Did not hold or not fixed:** `cancel-email-only` (3/5 val and 4/5 test in Run 3; the model puts the email in `recipient`; no rows were added for it, so this is the largest known gap). `lowercase-name` next to an email (`put dave at dave99@gmail.com` fails in every run since Run 2; test 3/5). `today-date` regressed from 5/5, 5/5 (Run 2) to 4/5, 4/5 (Run 3), but these were not targeted and the change is one row per split, so it is noise until shown otherwise. A name taken from an email (`tomas_h`) was fixed in Run 3 on val but is a rule-2 failure to watch.

## Ideas to try next

- Add train rows for the gaps found on v2 val: cancel rows that give only an email (recipient must stay blank), a lowercase name written next to an email (`put dave at dave99@gmail.com`), `today` kept as the date on dispute messages, and a name derived from an underscore email. Then re-score on v2 and compare only with Run 3. Keep the 5 held-out rows per pattern fixed; add more held-out rows if a pattern needs a finer reading.
- More held-out rows per pattern (5 per split is one-row-equals-20-points), and real user messages for val and test, so scores are not measured on AI-written text.
- Have a person review the 70 v2 held-out rows and the 140 v2 train rows on `/annotate`.
- More data: train is 653 rows against a target of about 2,000; several fields have under 20 stated examples (`setup_autodeposit.phone` 9, `transfer_between_accounts.date` 11, `pay_bill.date` 12).
- Repeat the Run 1 recipe, Run 2 and Run 3 with two or three seeds to see how much of a one-row difference is seed noise.
- Learning rate, epochs and LoRA rank sweeps, choosing on val only.
- Fetch the GGUF (`run3/LFM2.5-230M-SFT-Q8_0.gguf` once exported with `--stage gguf --run run3`), run it in Ollama through the real extractor (`extract:eval`) and compare with the Modal numbers.
- Install `causal_conv1d` in the training image for faster convolution layers.
