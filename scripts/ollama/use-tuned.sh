#!/bin/sh
# Register the fine-tuned 350M model (made by training/modal_train.py) with Ollama as "lfm25-350m-sft", the extractor's default model.
# Fetch the file first (the file in the volume is named 230M by the converter; it is the 350M model):
#   modal volume get jev-sft o350e2s0/LFM2.5-230M-SFT-Q8_0.gguf scripts/ollama/models/LFM2.5-350M-SFT-Q8_0.gguf
# or from the private Hugging Face repo felixglush156/LFM2.5-350M-banking-extractor-GGUF.
set -eu
cd "$(dirname "$0")"
[ -f models/LFM2.5-350M-SFT-Q8_0.gguf ] || { echo "models/LFM2.5-350M-SFT-Q8_0.gguf not found: run the modal volume get command above." >&2; exit 1; }
ollama create lfm25-350m-sft -f Modelfile.tuned
echo "Try it: npm run extract:eval"
