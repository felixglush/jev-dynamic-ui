# jev-dynamic-ui

A chat UI that picks a prebuilt banking form and fills it in from what the customer typed. Type "Send $50 to Sam for dinner" and the e-Transfer form opens with the recipient and amount already filled. Anything the message doesn't say stays blank and is highlighted.

## Demo

<!-- TODO: replace this placeholder with the demo video (drag the file into the GitHub editor or link it). -->
> **Demo video coming soon.** Placeholder: no recording has been made yet.

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

Scheduled payments ("every month on the 1st") add `date` and `frequency` to e-Transfers, bill payments and transfers between accounts. The table is a summary; the catalog is authoritative.

## Who does what

```
message --> Jev (TypeSafe AI)  --> which action, plus every choice field
        --> fine-tuned LFM2.5-350M (local, Ollama) --> the free-text fields
        --> prebuilt form, blanks highlighted
```

| Part | Does | Doesn't |
| --- | --- | --- |
| **Jev** ([TypeSafe AI](https://typesafe.ai) decision model, called server-side) | Picks the action. Picks the answer for each choice field (account, payment option, frequency, card action...) from the catalog's fixed options. For names, emails, phones and amounts it picks among candidates found by regex in [`candidates.ts`](src/lib/jev/candidates.ts), or "none". | Never writes text. |
| **Fine-tuned extractor** (LFM2.5-350M, trained to leave absent fields empty; Ollama model `lfm25-350m-sft`) | Copies the free-text values (names, emails, phones, amounts, dates, account numbers) out of the message, or leaves them blank. It is required: if Ollama is down the app reports the assistant as down. | Doesn't pick the action or the choices. |

The split is `param.type === "choice"` in the catalog: choices go to Jev, everything else to the extractor.

## Final experiment result

The shipped extractor is LFM2.5-350M fine-tuned with LoRA on 1,120 reviewed-or-generated examples, with every training row repeated three times in random key order so it doesn't depend on the order Ollama's JSON schema writes the fields in.

| Measure | Result |
| --- | --- |
| Stress set through the real extractor in Ollama (129 messages, Q8_0, schema on) | **125 / 129** |
| Same, schema off | 126 / 129 |
| Held-out validation, exact match, any key order (catalog / sorted / reversed) | 98.9 / 98.9 / 99.6 % |
| Held-out test, same three orders | 96.9 / 96.7 / 97.4 % |

Caveats: only about 62 training rows were reviewed by a person (the rest were approved by Claude), and the test set is not sealed. Full method, every run and the failure analysis are in [`docs/sft-experiments.md`](docs/sft-experiments.md).

## Run it

```bash
npm install
cp .env.example .env.local   # add your TYPESAFE_API_KEY
scripts/ollama/use-tuned.sh  # registers the fine-tuned extractor in Ollama (see below for the model file)
npm run dev                  # http://localhost:3000
```

The fine-tuned model file (`scripts/ollama/models/LFM2.5-350M-SFT-Q8_0.gguf`) is not in the repo. It is in a private Hugging Face repo (`felixglush156/LFM2.5-350M-banking-extractor-GGUF`) and on the project's Modal volume, so `use-tuned.sh` only works for people with access. Without it, run `scripts/ollama/setup.sh` (downloads the public base LFM2.5-230M, not fine-tuned and much less accurate: it invents values for fields the message doesn't state) and set `OLLAMA_MODEL=lfm25-230m` in `.env.local`.

Needs Node 22+ and [Ollama](https://ollama.com). Everything else (architecture, tests, annotation page, fine-tuning data, dependency notes) is in [`AGENTS.md`](AGENTS.md) and [`docs/`](docs).
