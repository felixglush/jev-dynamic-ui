#!/bin/sh
# Register the fine-tuned model (made by training/modal_train.py) with Ollama as "lfm25-230m-sft".
# Fetch the file first: modal volume get jev-sft latest/LFM2.5-230M-SFT-Q8_0.gguf scripts/ollama/models/
set -eu
cd "$(dirname "$0")"
[ -f models/LFM2.5-230M-SFT-Q8_0.gguf ] || { echo "models/LFM2.5-230M-SFT-Q8_0.gguf not found: run the modal volume get command above." >&2; exit 1; }
ollama create lfm25-230m-sft -f Modelfile.tuned
echo "Try it: OLLAMA_MODEL=lfm25-230m-sft npm run extract:eval"
