"""Gets hotwords.txt ready for the server. usage: prepare_hotwords.py WORDS.txt MODEL_DIR OUT.txt

sherpa-onnx splits the phrases into the model's BPE pieces itself, so OUT is the same list as plain text: comments
removed, phrases in capitals (the model's alphabet), an optional ":score" kept. It also writes MODEL_DIR/bpe.vocab
(the vocabulary as text, made from bpe.model) if it isn't there, which the engine needs to do that splitting.
"""
import sys
from pathlib import Path

import sentencepiece as spm


def clean(lines: list[str]) -> list[str]:
    out = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        phrase, _, score = line.partition(":")
        phrase = " ".join(phrase.upper().split())
        out.append(f"{phrase} :{score.strip()}" if score.strip() else phrase)
    return out


def write_vocab(model_dir: Path) -> None:
    vocab = model_dir / "bpe.vocab"
    if vocab.exists():
        return
    bpe = spm.SentencePieceProcessor(model_file=str(model_dir / "bpe.model"))
    vocab.write_text("".join(f"{bpe.id_to_piece(i)}\t{bpe.get_score(i)}\n" for i in range(bpe.get_piece_size())))


if __name__ == "__main__":
    words, model_dir, out = sys.argv[1:4]
    write_vocab(Path(model_dir))
    Path(out).write_text("\n".join(clean(Path(words).read_text().splitlines())) + "\n")
