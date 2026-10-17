---
license: other
license_name: lfm1.0
license_link: LICENSE
base_model: LiquidAI/LFM2.5-350M
library_name: gguf
language:
- en
tags:
- information-extraction
- banking
- lora
- gguf
---

# LFM2.5-350M banking field extractor (GGUF, Q8_0)

`LiquidAI/LFM2.5-350M` fine-tuned with LoRA to pull the free-text fields (names, emails, phones, amounts, dates, account numbers) out of a short banking chat message, for one of 12 actions given in the system prompt. It only copies what the message states and leaves everything else blank. It does not choose the action.

## Use

```
ollama create lfm25-350m-sft -f Modelfile     # FROM ./LFM2.5-350M-SFT-Q8_0.gguf, PARAMETER temperature 0
```

System prompt (the field list changes with the action): `Extract these fields from the user's banking message: recipient, recipient_email, amount, date. Only copy information that is actually written in the message. If a field is not stated, leave it empty. Never invent names, emails, phone numbers or dates.` The answer is a JSON object with every field (`""` or `0` when absent). A JSON schema can be enforced with Ollama's `format`: the model was trained with the answer keys in random order, so Ollama's alphabetical key order does not matter.

## Training

LoRA (rank 16, alpha 32, lr 2e-4, batch 16, 2 epochs over 3 copies of each row with the answer keys shuffled), 1,120 training rows. Only about 62 rows were reviewed by a person; the rest were written by Claude and approved after an automatic check that every value appears in its message. Treat the scores as a check that the pipeline works, not as accuracy on real customer messages.

## Results

Measured on the merged bf16 weights with schema-constrained decoding (v5 sets: 274 validation, 459 test rows, AI-written):

| | Exact match, val | Exact match, test |
| --- | --- | --- |
| Base LFM2.5-350M | 20.8% | 24.2% |
| This model | 98.9% | 96.9% |

Exact match stays within about 1 point when the answer keys are written in alphabetical or reversed order. On a separate 129-message adversarial set (typos, prompt injection, odd names, several people in one message), this Q8_0 GGUF run in Ollama gets 126 exact. The validation and test sets were looked at while choosing the recipe, so the test number is a development number.

## Limits

English only. Not for production use with real money or identity data without human review of the extracted values. Known misses: `two grand` read as 2500, sometimes a date from unrelated text (`what's the weather today?` gives `today`).
