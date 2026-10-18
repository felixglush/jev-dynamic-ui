# jev-dynamic-ui

A chat UI that picks a prebuilt banking form and fills it in from what the customer typed. Type "Send $50 to Sam for dinner" and the e-Transfer form opens with the recipient and amount already filled. Anything the message doesn't say stays blank and is highlighted.

## Demo

<a href="docs/demo.mp4"><img src="docs/demo.gif" alt="Demo: typing a request opens the matching form, pre-filled" width="100%"></a>

Click for the full-quality video ([docs/demo.mp4](docs/demo.mp4)).

## Actions

Fourteen actions, one prebuilt form each. Defined in [`src/lib/jev/catalog.ts`](src/lib/jev/catalog.ts), which is the single source of truth for the actions and their fields (schemas).

| Action | What it does | Free-text fields (fine-tuned model) | Choice fields (Jev) |
| --- | --- | --- | --- |
| `add_etransfer_contact` | Save a new e-Transfer recipient | name, email, phone | |
| `send_etransfer` | Send an e-Transfer, now or scheduled | recipient, recipient_email, amount, date | from_account, frequency |
| `request_etransfer` | Ask someone to send you money | from_person, from_email, amount | |
| `cancel_etransfer` | Cancel an unaccepted e-Transfer | recipient, amount | |
| `setup_autodeposit` | Turn on Autodeposit | email, phone | deposit_account |
| `pay_credit_card` | Pay the credit card | amount | payment_option, from_account |
| `pay_bill` | Pay a biller, now or scheduled | payee, amount, date | from_account, frequency |
| `add_payee` | Add a biller | biller, account_number | |
| `transfer_between_accounts` | Move money between your own accounts | amount, date | from_account, to_account, frequency |
| `open_account` | Open a new account | initial_deposit | account_type, from_account |
| `manage_card` | Lock, unlock or replace a card | | card_action, card, reason |
| `view_account` | Show a balance or transactions | | account, view |
| `dispute_transaction` | Dispute a charge | merchant, amount, date | reason |
| `update_contact_info` | Change phone, email or address | new_email, new_phone | contact_type |


| Part | Does | Doesn't |
| --- | --- | --- |
| **Jev** ([TypeSafe AI](https://typesafe.ai) as action decision model, called via API) | Reads the whole message. Picks the action, and picks the answer for each choice field (account, payment option, frequency, card action...) from the catalog's fixed options. | Never writes text; picks action type or multiple choice options. |
| **Fine-tuned extractor** ([LFM2.5-350M](https://docs.liquid.ai/lfm/models/lfm25-350m)) | Copies the free-text values (names, emails, phones, amounts, dates, account numbers) out of the message, or leaves them blank. | Writes text; doesn't pick the action or the choices. |

## Final experiment result

The extractor model is LFM2.5-350M fine-tuned with LoRA on 1,120 examples. Every training row is repeated three times in random key order so it doesn't depend on the order Ollama's JSON schema writes the fields in. Initial evals showed the model was substituting name for email for instance just because of the order of keys passed into Ollama.

| Measure | Result |
| --- | --- |
| Stress set through the real extractor in Ollama (129 messages, Q8_0, schema on) | **125 / 129** |
| Held-out validation, exact match, any key order (catalog / sorted / reversed) | 98.9 / 98.9 / 99.6 % |
| Held-out test, same three orders | 96.9 / 96.7 / 97.4 % |
| Baseline: base LFM2.5-350M (not fine-tuned), exact match, validation / test | 20.8 % / 24.2 % |

Caveats: 
- about 62 training rows were reviewed by me and the rest were approved/edited by Claude given my annotations.
- the fine tuned model needs real production messages from users. Initial model trainings revealed the dataset was not sufficiently varied for all possible actions and ways of describing them. Additional examples were added to both the training set and validation/test to ensure the model is improving. The test set was never trained on, but it was scored while hill climbing the eval. This result is that compared to the base Liquid FM model, the fine-tuned model behaves better (e.g. doesn't hallucinate values into the structured output when no value is found in the query) but a fair evaluation requires real production data to create an entirely new, non-synthetic dataset.
- full method is in [`docs/sft-experiments.md`](docs/sft-experiments.md).

There is a small set of harder examples: 129 in data/extract-stress.txt. Contents: 24 groups, written by Claude. They cover typos (“sned 50 to sam”), accented names, odd amounts (“two grand”, “$1,234,567.89”), several numbers in one message, negation (“don’t send $50”), prompt injection, long polite messages, and other non-banking text.

## Latency

Time per message, from `npm run latency` (60 messages spread over `data/sample-messages.txt`, one at a time, after 2 warm-up messages). "Overall" is what the chat does: Jev first, then the extractor on the action Jev picked.

| Step | Messages | Median | 95th percentile | Mean |
| --- | --- | --- | --- | --- |
| Jev (TypeSafe API) | 60 | 0.10 s | 0.15 s | 0.11 s |
| Fine-tuned extractor (Ollama) | 55 | 0.64 s | 0.97 s | 0.56 s |
| Overall (Jev, then extractor) | 60 | 0.71 s | 1.09 s | 0.62 s |

Measured on 2026-10-17 in a 4-core cloud container with no GPU, so the extractor runs on CPU and will differ on your machine. Jev is a network call, so it depends on your connection. The 5 messages Jev maps to no action skip the extractor. The very first extraction after Ollama starts is slower (about 4 s) while the model loads.

## Run it

```bash
npm install
cp .env.example .env.local   # add your TYPESAFE_API_KEY
scripts/ollama/use-tuned.sh  # registers the fine-tuned extractor in Ollama (downloads the model from Hugging Face)
npm run dev                  # http://localhost:3000
```

`use-tuned.sh` downloads the fine-tuned model (about 380 MB) from the public [Hugging Face repo](https://huggingface.co/felixglush156/LFM2.5-350M-banking-extractor-GGUF) and registers it in Ollama as `lfm25-350m-sft`, the extractor's default.

Needs Node 22+ and [Ollama](https://ollama.com). Everything else (architecture, tests, annotation page, fine-tuning data, dependency notes) is in [`AGENTS.md`](AGENTS.md) and [`docs/`](docs).
