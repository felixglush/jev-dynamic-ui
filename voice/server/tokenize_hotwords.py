"""Turns a plain word list (hotwords.txt) into the file sherpa-onnx wants: each phrase split into the model's
BPE pieces. usage: tokenize_hotwords.py WORDS.txt MODEL_DIR OUT.txt"""
import sys
from pathlib import Path

import sentencepiece as spm


def tokenize(lines: list[str], bpe: spm.SentencePieceProcessor) -> list[str]:
    out = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        phrase, _, score = line.partition(":")
        pieces = " ".join(bpe.encode(phrase.strip().upper(), out_type=str))
        out.append(f"{pieces} :{score.strip()}" if score.strip() else pieces)
    return out


if __name__ == "__main__":
    words, model_dir, out = sys.argv[1:4]
    bpe = spm.SentencePieceProcessor(model_file=str(Path(model_dir) / "bpe.model"))
    vocab = Path(model_dir) / "bpe.vocab"  # the server also needs the vocabulary as text
    if not vocab.exists():
        vocab.write_text("".join(f"{bpe.id_to_piece(i)}\t{bpe.get_score(i)}\n" for i in range(bpe.get_piece_size())))
    Path(out).write_text("\n".join(tokenize(Path(words).read_text().splitlines(), bpe)) + "\n")
