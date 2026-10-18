# Experiment: the extractor model picks the action too

Question: can the fine-tuned LFM2.5-350M pick the action (replacing Jev for that step) with its answer constrained to the 14 actions plus `none`, so it cannot invent an action?

Setup: `npx tsx scripts/sft-actions.mts` rebuilds `data/sft/action/{train,val,test}.jsonl` from the existing splits (same split per message). Each record is the `actionPrompt()` system prompt plus the message, answered with `{"action": "<name>"}`. `manage_card`, `view_account` and `none` have no free-text fields and so no rows in `examples.jsonl`: their train and val rows are in `data/sft/action-extra.txt` (written for this experiment) and their test rows are the matching groups of `data/sample-messages.txt` (14, 14 and 10 messages). Train: `modal run training/modal_train.py --stage train --run action1 --data-dir data/sft/action`. Note: from a cloud session the Modal CLI needs `pip install 'modal[api-proxy-support]'`.

Run `action1` (base LFM2.5-350M, LoRA r16, lr 2e-4, 3 epochs, 1,240 train rows, Modal L4), decoding constrained to the action enum:

| Split | Records | Exact action | Invalid JSON |
| --- | --- | --- | --- |
| val | 298 | 96.6% | 0 |
| test | 497 | 95.4% | 0 |

Caveats: the messages are synthetic and AI-written, so this is likely easier than real chat. Some vague rows carry an action label for a message that does not name one (`lol`, `bonjour`), so a few of the misses are label noise. Jev was not run on the same messages, so this is not yet a comparison with Jev. Choice fields (account, card, frequency...) are not covered: there are no labels for them yet. Not wired into the app.

## Comparison with Jev (same 497 test messages)

`npx tsx --conditions react-server scripts/compare-action.mts` runs Jev's action question over `data/sft/action/test.jsonl` (about 500 requests, median 105 ms each here).

| | Correct | Share |
| --- | --- | --- |
| Fine-tuned 350M (constrained) | 474 / 497 | 95.4% |
| Jev | 470 / 497 | 94.6% |

Both right 461, model only 13, Jev only 9, neither 14. The gap is within noise on a test set this size. Per action they are close; the largest difference is `pay_bill` (model 40/42, Jev 32/42). Jev misses are mostly "none" for junk messages (`wat`, `k`, `@@`) that the AI-written labels give an action; the model's own misses include real confusions (`get $60 from Pablo` read as send, `add my dentist to contacts` as add_payee) and typos (`pay my vissa 250`). Model latency was not measured in this run.

## Latency (Ollama, 4-core CPU sandbox, Q8_0 GGUF)

`python3 scripts/time-action.py` sends every test message to the GGUF of run `action1` (registered as `lfm25-350m-action`) with the action enum as the schema, one at a time after two warm-up calls. It also rescored accuracy through Ollama: 474 / 497, the same as the unquantized model on Modal.

| | Median | 95th percentile | Mean |
| --- | --- | --- | --- |
| Action model (Ollama, CPU) | 205 ms | 259 ms | 209 ms |
| Jev (API, from the earlier run) | 105 ms | 142 ms (90th) | |

A request is about 124 prompt tokens and 9 output tokens. This model is a separate fine-tune that only picks the action: it was not trained on the field extraction, so using it means a second model next to `lfm25-350m-sft`.

## One model for both steps (`combined1`)

Run `combined1` trains the same base on the extraction rows and the action rows together (`data/sft/combined/`, built by `scripts/sft-actions.mts`; 2,360 train rows, shuffled key order with 3 copies like the current extractor, 3 epochs). Scored on the two test splits separately with schema-constrained decoding:

| Model | Action test (497) | Extraction test (459), exact record |
| --- | --- | --- |
| `action1` (action only) | 474 (95.4%) | n/a |
| `m350s0` (current extractor recipe) | n/a | 440 (95.9%) |
| `combined1` | 471 (94.8%) | 436 (95.0%) |

Differences of 3 to 4 records are noise at this size, so one model does both about as well as two. Fabricated values on blank fields: 9 of 600 (combined) against 8 of 600 (`m350s0`).

Latency in Ollama on the 4-core sandbox (200 test messages per row, Q8_0, after two warm-up calls; `python3 scripts/time-action.py <model> 200 action|extract`):

| Step | Model | Median | 95th percentile |
| --- | --- | --- | --- |
| Action | `combined1` | 202 ms | 255 ms |
| Extraction | `combined1` | 242 ms | 333 ms |
| Extraction | `lfm25-350m-sft` (current) | 228 ms | 324 ms |
| Action | Jev (API) | 105 ms | |

Today's flow (Jev, then the extractor) is about 105 + 228 = 333 ms median. All-local with `combined1` is about 202 + 242 = 444 ms, with no API call and no credits. The README's 0.64 s extractor figure was measured on different hardware, so compare these rows only with each other.
