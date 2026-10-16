# Handoff: fair evaluation sets (v2) for the SFT field extractor

Paste everything below the line into a new chat in this repo.

---

You are continuing work on the SFT dataset for the field extractor in this repo (`/Users/felixg/dev/jev-dynamic-ui`, branch `claude/sft-dataset-gbz8y4`). Read `AGENTS.md`, `docs/sft-dataset.md` and `docs/sft-experiments.md` first. The experiment log is the record of what has been tried; **every result and decision from this task goes into it** (see "Logging" below).

## Where things stand

- 779 approved rows in `data/sft/examples.jsonl`. Splits are built by `npm run sft:build` (`src/lib/sft/build.ts`, `split.ts`): train 583, val 98, test 98. 134 train rows have `meta.trainOnly: true` and bypass the split, so val and test are byte-identical to the ones Run 1 was scored on.
- `training/modal_train.py` (Modal, L4, account `felixglush`, env `main`, Modal client 1.6.2) scores the base model, trains a LoRA, scores the tuned model and exports a GGUF. Scoring uses schema-constrained decoding with `xgrammar`, as Ollama does at run time. Run it with `modal run training/modal_train.py [--stage baseline|train|gguf|all]`.
- Results so far (see the log): base model fabricates 85 to 89% of blank fields. Run 1: val 95.9% exact, test 95.9%. Run 2 (plus 134 train-only rows aimed at Run 1's errors): val 94.9%, test 98.0%. The difference is not distinguishable from noise: 98 records per split, one record is about 1 point.
- Run 2's weights are in the Modal volume `jev-sft` under `latest/` (`merged/`, `adapter/`, GGUF). **Any training run overwrites `latest/`.** Save or copy Run 2's weights to a named folder first (for example `run2/`), or train into a per-run folder.

## The problem to fix

Evaluation is not fair yet:

1. Run 1's val and test errors were both read, and train rows were then written for them. Test no longer measures generalisation, and val is only partly clean.
2. Most failure patterns have only one or two held-out examples, usually the very cases that failed, so a pass cannot be told apart from luck or memorisation.
3. Val and test are AI-written and share templates with train.

## What to build

1. **Roles.** Val is the dev set (its errors may be read). Test is sealed: nobody reads its errors until a final candidate, and it is scored once. Treat the current test as retired for that purpose (`dev-2`); say so in the log.
2. **Pin rows to a split.** Generalise the `trainOnly` flag into `meta.split?: "train" | "val" | "test"` that overrides the hash split in `buildSplits`. Keep the hash split unchanged for rows without it, and keep `trainOnly` working (or migrate it, with a test). `sft:add` takes a flag to set it. The existing rows must keep their current splits.
3. **Tag patterns.** Add `meta.pattern?: string`. Tag the new rows, and tag existing val/test/train rows that clearly belong to a pattern.
4. **New held-out rows**, about 8 to 10 per pattern, split between val and test, **written without looking at the train batch** (the train-only batch is in `git show 74a3f6f -- data/sft/examples.jsonl`; use it only to avoid duplicating messages, not to copy phrasing). Use different names, amounts, companies and phrasing from train. Patterns:
   - spelled-out amounts of 100 or more (include `ten thousand`, `fifteen hundred`, `a hundred and twenty`)
   - multi-word company names (`Fortis BC`, `Bell Canada`, `Sun Life Financial`), and a company inside a phrase (`my Bell internet bill` gives payee `Bell`)
   - an email with no name (the name must stay blank; `autodeposit for <phone> and <email>`)
   - past-event or cancellation dates left blank (`for dinner last night`, `cancelled on October 20`)
   - lowercase names, and a name written next to an email (`put dave at dave99@gmail.com`)
   - `today`/`tonight` kept as the date
   - cancel rows where only an email is given (recipient stays blank)
   Follow the labeling rules in `docs/sft-dataset.md` section 2.
5. **Version the sets.** Record which version each row belongs to (`v1` = current files, `v2` = after this change) so scores are only compared within a version. The build should still write `val.jsonl` and `test.jsonl` for the current version; keep the v1 files under `data/sft/v1/` for reference.
6. **Per-pattern report.** Extend `training/modal_train.py` to report pass rate per `meta.pattern` (and the overall numbers), keeping `training/test_scoring.py` passing and adding tests for the new scoring code (`python3 -m pytest training` needs `uv run --with pytest`).
7. **Re-score on v2** the base model, Run 2's saved weights (add a score-only stage that loads a saved model from the volume), and a retrain of Run 1's recipe (the 449 train rows without `trainOnly`, same settings, seed 0). Compare only within v2.
8. **Add the missing train data** for patterns that still fail after Run 2: large spelled-out amounts (`ten thousand` came out as 1000 twice) and `cancelled on <date>`. These are train-only rows (`meta.split: "train"`), new messages, not copies of any held-out row. Then run a new training run (Run 3) and score it on v2.

## Constraints

- Do not read the **test** error examples (`examples` in the output JSON) for the new test rows or for Run 3. Look at val errors only, and per-pattern pass counts on test.
- No message may appear in two splits (`buildSplits` drops train rows that repeat a held-out message; keep that).
- The held-out rows you write are AI-written and the author knows what failed, so a pass shows the fixes generalise within those patterns, not that the model is accurate on real messages. Say so in the log.
- Approving rows: Felix approved everything in bulk earlier and approved the first 134 train-only rows indirectly. Mark new rows `approved` yourself only after checking each label against the rules; tell Felix the new held-out rows were not reviewed by a person.
- Commit in small steps; do not push.

## Logging (required)

Update `docs/sft-experiments.md` as you go, not at the end:

- A "Fair evaluation v2" section with the decision (val dev, test sealed, versions), what changed in the data and code, how many new rows per pattern and split, and the commit hashes.
- A result table for each model re-scored on v2 (base, Run 1 recipe, Run 2, Run 3), overall and per pattern, with the caveats above.
- Each training run as its own entry (date, settings, data counts, results, errors read from val only, which patterns moved).
- Update "Ideas to try next": remove what is done, add what you found.

When finished, report the v2 numbers by pattern and say plainly which fixes held up and which did not.
