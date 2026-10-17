#!/bin/bash
# Cloud sessions only: install npm deps, Ollama, and the fine-tuned extractor (lfm25-350m-sft).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

npm install

# Ollama's installer needs zstd.
if ! command -v ollama >/dev/null 2>&1; then
  command -v zstd >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq zstd; }
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Start the server if it isn't answering yet.
if ! curl -fs http://localhost:11434/api/tags >/dev/null 2>&1; then
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -fs http://localhost:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Download (once) and register the model.
if ! ollama list | grep -q '^lfm25-350m-sft'; then
  scripts/ollama/use-tuned.sh
fi
