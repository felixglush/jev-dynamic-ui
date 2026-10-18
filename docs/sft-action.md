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
