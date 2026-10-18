#!/usr/bin/env bash
# Downloads the streaming Zipformer English model (~310 MB, several variants; the server uses the int8 files) into
# voice/models/. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."
name=sherpa-onnx-streaming-zipformer-en-2023-06-26
mkdir -p models && cd models
[ -d "$name" ] && { echo "$name is already here"; exit 0; }
curl -fSL -o "$name.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$name.tar.bz2"
tar xjf "$name.tar.bz2" && rm "$name.tar.bz2"
echo "Model ready: voice/models/$name"
