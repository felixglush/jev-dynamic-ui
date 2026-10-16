#!/bin/sh
# Download LiquidAI's LFM2.5-230M (Q8_0, about 235 MB) and register it with Ollama as "lfm25-230m".
# Uses huggingface.co directly: `ollama run hf.co/...` talks to the hf.co host, which some networks block.
set -eu
cd "$(dirname "$0")"
mkdir -p models
# Download to a temporary name and rename on success, so an interrupted transfer is never mistaken for the model.
if [ ! -f models/LFM2.5-230M-Q8_0.gguf ]; then
  curl -fL -o models/LFM2.5-230M-Q8_0.gguf.part \
    https://huggingface.co/LiquidAI/LFM2.5-230M-GGUF/resolve/main/LFM2.5-230M-Q8_0.gguf
  mv models/LFM2.5-230M-Q8_0.gguf.part models/LFM2.5-230M-Q8_0.gguf
fi
ollama create lfm25-230m -f Modelfile
