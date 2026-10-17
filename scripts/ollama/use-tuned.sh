#!/bin/sh
# Download the fine-tuned 350M extractor (Q8_0, about 380 MB) from the public Hugging Face repo
# felixglush156/LFM2.5-350M-banking-extractor-GGUF and register it with Ollama as "lfm25-350m-sft",
# the extractor's default model. (To rebuild it from training instead, see training/modal_train.py.)
set -eu
cd "$(dirname "$0")"
mkdir -p models
# Download to a temporary name and rename on success, so an interrupted transfer is never mistaken for the model.
if [ ! -f models/LFM2.5-350M-SFT-Q8_0.gguf ]; then
  curl -fL -o models/LFM2.5-350M-SFT-Q8_0.gguf.part \
    https://huggingface.co/felixglush156/LFM2.5-350M-banking-extractor-GGUF/resolve/main/LFM2.5-350M-SFT-Q8_0.gguf
  mv models/LFM2.5-350M-SFT-Q8_0.gguf.part models/LFM2.5-350M-SFT-Q8_0.gguf
fi
ollama create lfm25-350m-sft -f Modelfile.tuned
echo "Try it: npm run extract:eval"
