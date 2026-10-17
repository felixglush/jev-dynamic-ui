"""
LoRA fine-tune LiquidAI/LFM2.5-350M on the field-extraction data, on Modal, and score it.

    pip install modal && modal setup           # once, on the machine you run this from
    npm run sft:build                          # approved rows -> data/sft/{train,val,test}.jsonl
    modal run training/modal_train.py          # baseline score, LoRA training, tuned score, GGUF

Stages (--stage): baseline | train | score | gguf | snapshot | all (default); see main() for the options. The training data is read from the local
data/sft/ folder and sent to Modal; results land in the Modal Volume "jev-sft" under latest/. Then:

    modal volume get jev-sft latest/LFM2.5-350M-SFT-Q8_0.gguf scripts/ollama/models/   # named after the base model
    scripts/ollama/use-tuned.sh                # registers it with Ollama as lfm25-350m-sft

Not run in CI: it needs a Modal account and a GPU. The LoRA settings follow the model's own layer
names, read from its safetensors header: attention q/k/v/out_proj, the short-convolution blocks'
in_proj/out_proj, and the feed-forward w1/w2/w3.
"""

import json
import re
import unicodedata
from pathlib import Path

import modal

BASE_MODEL = "LiquidAI/LFM2.5-350M"
VOLUME_NAME = "jev-sft"
LORA_TARGETS = ["q_proj", "k_proj", "v_proj", "out_proj", "in_proj", "w1", "w2", "w3"]

app = modal.App("jev-sft")
volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=True)

train_image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "torch", "transformers>=5.2", "trl", "peft", "datasets", "accelerate", "xgrammar"
)
# llama.cpp's converter turns the merged Hugging Face model into a GGUF that Ollama can load.
gguf_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install("torch", "transformers>=5.2", "numpy", "sentencepiece", "protobuf", "gguf")
    .run_commands("git clone --depth 1 https://github.com/ggml-org/llama.cpp /opt/llama.cpp")
)

# ---------------------------------------------------------------------------------------------
# Scoring: plain Python, no Modal or GPU, so it can be tested anywhere.
# ---------------------------------------------------------------------------------------------

AMOUNT_FIELDS = {"amount", "initial_deposit"}


def normalize(field: str, value) -> str:
    """The comparable form of a field value; "" means blank. 50 equals 50.00, case and accents as NFC."""
    if value is None or value == "":
        return ""
    if field in AMOUNT_FIELDS:
        try:
            number = float(str(value).replace("$", "").replace(",", ""))
        except ValueError:
            return str(value).strip().casefold()
        return "" if number == 0 else f"{number:.2f}"
    return unicodedata.normalize("NFC", str(value)).strip().casefold()


def parse_answer(text: str):
    """The first JSON object in the model's reply, or None when there isn't a valid one."""
    match = re.search(r"\{.*?\}", text, re.DOTALL)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def record_passes(row: dict) -> bool:
    """True when the reply is valid JSON and every field matches the label (the exact-record criterion)."""
    answer = parse_answer(row["reply"])
    return answer is not None and all(
        normalize(field, label) == normalize(field, answer.get(field)) for field, label in row["label"].items()
    )


def pass_rates(rows: list[dict], key) -> dict:
    """Records and exact-match pass rate per group; `key(row)` names the group, or None to leave the row out."""
    groups: dict[str, list[bool]] = {}
    for row in rows:
        name = key(row)
        if name is not None:
            groups.setdefault(name, []).append(record_passes(row))
    return {
        name: {"records": len(flags), "passed": sum(flags), "pass_rate": sum(flags) / len(flags)}
        for name, flags in sorted(groups.items())
    }


def breakdowns(rows: list[dict]) -> dict:
    """
    Pass rate per failure pattern (`meta.pattern`), over all rows and over the newest version's rows alone
    (the rows nobody has read errors for yet), and per set version (`meta.version`, v1 when absent). Rows
    without a pattern are left out of the pattern tables.
    """
    versions = {r.get("version") or "v1" for r in rows}
    newest = max(versions, default="v1")
    return {
        "newest_version": newest,
        "patterns": pass_rates(rows, lambda r: r.get("pattern")),
        "patterns_new": pass_rates(rows, lambda r: r.get("pattern") if (r.get("version") or "v1") == newest else None),
        "versions": pass_rates(rows, lambda r: r.get("version") or "v1"),
    }


def select_train(text: str, subset: str = "all") -> str:
    """
    The train rows to fit on. "all" is every row. "run1" is the Run 1 recipe: rows that existed before
    the train-only additions, i.e. without `meta.trainOnly`, `meta.split` or any `meta.version`.
    """
    if subset == "all":
        return text
    if subset != "run1":
        raise ValueError(f"unknown train subset {subset!r} (all or run1)")
    keep = []
    for record in load_records(text):
        meta = record["meta"]
        if not (meta.get("trainOnly") or meta.get("split") or meta.get("version")):
            keep.append(record)
    return "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in keep)


def score(rows: list[dict]) -> dict:
    """
    rows: [{"action": str, "label": {field: value}, "reply": str}]. Per field and overall:
      correct     the model's value equals the label (both blank counts as correct)
      fabricated  the label is blank but the model filled it in (the failure fine-tuning is for)
      missed      the label has a value but the model left it blank
      wrong       both have a value and they differ
    """
    fields: dict[str, dict[str, int]] = {}
    exact = invalid = 0
    for row in rows:
        answer = parse_answer(row["reply"])
        if answer is None:
            invalid += 1
        for field, label in row["label"].items():
            want = normalize(field, label)
            got = normalize(field, (answer or {}).get(field))
            kind = (
                "correct" if want == got
                else "fabricated" if not want
                else "missed" if not got
                else "wrong"
            )
            entry = fields.setdefault(f"{row['action']}.{field}", dict(correct=0, fabricated=0, missed=0, wrong=0, stated=0, blank=0))
            entry[kind] += 1
            entry["stated" if want else "blank"] += 1
        exact += record_passes(row)
    total = {k: sum(f[k] for f in fields.values()) for k in ("correct", "fabricated", "missed", "wrong", "stated", "blank")}
    cells = total["correct"] + total["fabricated"] + total["missed"] + total["wrong"]
    return {
        "records": len(rows),
        "invalid_json": invalid,
        "exact_record_match": exact / len(rows) if rows else 0.0,
        "field_accuracy": total["correct"] / cells if cells else 0.0,
        # Of the fields that should be blank, how many did the model fill in anyway?
        "fabrication_rate": total["fabricated"] / total["blank"] if total["blank"] else 0.0,
        # Of the fields that should have a value, how many did it leave blank or get wrong?
        "miss_rate": total["missed"] / total["stated"] if total["stated"] else 0.0,
        "wrong_rate": total["wrong"] / total["stated"] if total["stated"] else 0.0,
        "totals": total,
        "fields": fields,
    }


def load_records(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def ordered(names, key_order: str = "catalog") -> list[str]:
    """Field names in the order the decoder writes them: as trained (catalog), alphabetical (what Ollama's schema does), or reversed."""
    names = list(names)
    return sorted(names) if key_order == "sorted" else names[::-1] if key_order == "reversed" else names


def answer_schema(label: dict, key_order: str = "catalog") -> dict:
    """The JSON schema the extractor hands Ollama (schemaFor in ollama.ts): every field, amounts as numbers, keys in `key_order`."""
    properties = {name: {"type": "number" if name in AMOUNT_FIELDS else "string"} for name in ordered(label, key_order)}
    return {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}


def generate_replies(model, tokenizer, records: list[dict], key_order: str = "catalog") -> list[dict]:
    """
    Greedy answers for each record's system + user messages, paired with the label. Decoding is
    constrained to the action's JSON schema, as Ollama does at run time, so the model can only
    choose values: it cannot chat back, and base and tuned models are scored on equal terms.
    """
    import torch
    import xgrammar as xgr

    compiler = xgr.GrammarCompiler(xgr.TokenizerInfo.from_huggingface(tokenizer, vocab_size=model.config.vocab_size))

    rows = []
    model.eval()
    for record in records:
        prompt = tokenizer.apply_chat_template(
            record["messages"][:2], add_generation_prompt=True, return_tensors="pt", return_dict=True
        ).to(model.device)
        label = json.loads(record["messages"][2]["content"])
        # A logits processor holds the parse state, so each answer gets its own.
        constrain = xgr.contrib.hf.LogitsProcessor(compiler.compile_json_schema(json.dumps(answer_schema(label, key_order))))
        with torch.no_grad():
            out = model.generate(**prompt, max_new_tokens=160, do_sample=False, logits_processor=[constrain])
        reply = tokenizer.decode(out[0][prompt["input_ids"].shape[1]:], skip_special_tokens=True)
        rows.append(
            {
                "id": record["meta"]["id"],
                "action": record["meta"]["action"],
                "pattern": record["meta"].get("pattern"),
                "version": record["meta"].get("version", "v1"),
                "label": label,
                "message": record["messages"][1]["content"],
                "reply": reply,
            }
        )
    return rows


def evaluate(model, tokenizer, files: dict[str, str], other_orders: bool = False) -> dict:
    result = {}
    for split in ("val", "test"):
        rows = generate_replies(model, tokenizer, load_records(files[split]))
        result[split] = score(rows)
        result[split].update(breakdowns(rows))
        # Val is the dev set: keep its misses so they can be read. Test is sealed (docs/sft-experiments.md,
        # "Fair evaluation v2"): only counts leave this function, never the messages or which rows failed.
        if split == "val":
            result[split]["examples"] = [r for r in rows if not record_passes(r)][:40]
        if other_orders:
            # The same records decoded with the keys written in another order (counts only).
            result[split]["by_key_order"] = {
                order: {k: v for k, v in score(generate_replies(model, tokenizer, load_records(files[split]), order)).items() if k in ("exact_record_match", "fabrication_rate", "miss_rate", "wrong_rate", "invalid_json")}
                for order in ("sorted", "reversed")
            }
    return result


# ---------------------------------------------------------------------------------------------
# Modal functions
# ---------------------------------------------------------------------------------------------


@app.function(image=train_image, gpu="L4", timeout=3600, volumes={"/out": volume})
def baseline(files: dict[str, str], base: str = BASE_MODEL, run: str = "latest") -> dict:
    """Score the untouched base model, so the tuned model has something to be compared with."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForCausalLM.from_pretrained(base, dtype=torch.bfloat16).to("cuda")
    result = evaluate(model, tokenizer, files)
    Path(f"/out/{run}").mkdir(parents=True, exist_ok=True)
    Path(f"/out/{run}/baseline.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    volume.commit()
    return result


@app.function(image=train_image, gpu="L4", timeout=7200, volumes={"/out": volume})
def train(files: dict[str, str], base: str = BASE_MODEL, epochs: int = 3, lr: float = 2e-4, rank: int = 16, run: str = "latest", seed: int = 0, patience: int = 100, keep_last: bool = False, order_copies: int = 1) -> dict:
    """LoRA fine-tune on train.jsonl, keep the best checkpoint by validation loss (stop early after `patience` evals without improvement), score it, save adapter and merged model."""
    import torch
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer, EarlyStoppingCallback
    from trl import SFTConfig, SFTTrainer

    import random

    def to_dataset(text: str, copies: int = 1) -> Dataset:
        # Prompt/completion form: the loss is counted on the assistant's answer only. With copies > 1 every
        # record appears that many times, each with its answer keys in a different random order, so the model
        # does not depend on the order the fields are written in (the values are identical).
        records = load_records(text)
        rng = random.Random(seed)
        rows = []
        for r in records:
            answer = json.loads(r["messages"][2]["content"])
            for _ in range(copies):
                keys = list(answer)
                if copies > 1:
                    rng.shuffle(keys)
                completion = {"role": "assistant", "content": json.dumps({k: answer[k] for k in keys}, ensure_ascii=False, separators=(",", ":"))}
                rows.append({"prompt": r["messages"][:2], "completion": [completion]})
        return Dataset.from_list(rows)

    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForCausalLM.from_pretrained(base, dtype=torch.bfloat16).to("cuda")
    # Overfitting watch: loss is measured four times an epoch on the held-out val rows AND on a fixed
    # sample of train rows (same size as val, so the two numbers are comparable; the running train loss
    # in the log is noisy and includes dropout). Val loss rising while train loss keeps falling = overfitting.
    train_dataset = to_dataset(files["train"], order_copies)
    steps_per_epoch = max(1, -(-len(train_dataset) // 16))  # ceil: the last partial batch is a step too
    eval_every = max(1, steps_per_epoch // 4)
    val_dataset = to_dataset(files["val"])
    train_sample = to_dataset(files["train"]).shuffle(seed=0).select(range(min(len(val_dataset), len(train_dataset))))  # catalog order, like val
    trainer = SFTTrainer(
        model=model,
        args=SFTConfig(
            output_dir="/tmp/sft",
            num_train_epochs=epochs,
            per_device_train_batch_size=16,
            learning_rate=lr,
            lr_scheduler_type="cosine",
            warmup_steps=0.05,  # a float below 1 is a fraction of all steps
            bf16=True,
            max_length=512,
            logging_steps=10,
            eval_strategy="steps",
            eval_steps=eval_every,
            save_strategy="steps",
            save_steps=eval_every,
            save_total_limit=2,
            load_best_model_at_end=not keep_last,
            metric_for_best_model="eval_val_loss",
            greater_is_better=False,
            report_to="none",
            seed=seed,
        ),
        train_dataset=train_dataset,
        eval_dataset={"val": val_dataset, "train": train_sample},
        callbacks=[EarlyStoppingCallback(early_stopping_patience=patience)],
        processing_class=tokenizer,
        peft_config=LoraConfig(
            r=rank, lora_alpha=2 * rank, lora_dropout=0.05, target_modules=LORA_TARGETS, task_type="CAUSAL_LM"
        ),
    )
    trainer.train()
    # One more measurement on the weights actually kept (the last step is not always an eval step).
    final = trainer.evaluate()

    out = Path(f"/out/{run}")
    out.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(out / "adapter")
    merged = trainer.model.merge_and_unload()
    merged.save_pretrained(out / "merged")
    tokenizer.save_pretrained(out / "merged")

    result = evaluate(merged, tokenizer, files, other_orders=True)
    result["settings"] = {"base": base, "epochs": epochs, "lr": lr, "rank": rank, "targets": LORA_TARGETS}
    result["train_records"] = len(load_records(files["train"]))
    result["log"] = trainer.state.log_history
    result["final_eval"] = {k: v for k, v in final.items() if k.endswith("_loss")}
    result["best_checkpoint_step"] = int(trainer.state.best_global_step)
    result["settings"]["seed"] = seed
    result["settings"]["patience"] = patience
    result["settings"]["keep_last"] = keep_last
    result["settings"]["order_copies"] = order_copies
    (out / "tuned.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    volume.commit()
    return result


@app.function(image=train_image, gpu="L4", timeout=3600, volumes={"/out": volume})
def score_saved(files: dict[str, str], run: str) -> dict:
    """Score a merged model saved in the volume under <run>/merged (no training), on val and test."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    volume.reload()
    path = f"/out/{run}/merged"
    tokenizer = AutoTokenizer.from_pretrained(path)
    model = AutoModelForCausalLM.from_pretrained(path, dtype=torch.bfloat16).to("cuda")
    return evaluate(model, tokenizer, files, other_orders=True)


@app.function(image=train_image, gpu="L4", timeout=1800, volumes={"/out": volume})
def probe(run: str, records: list[dict]) -> list[dict]:
    """Answers for a few records from a saved merged model, both schema-constrained (as scored) and free-running."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    volume.reload()
    path = f"/out/{run}/merged"
    tokenizer = AutoTokenizer.from_pretrained(path)
    model = AutoModelForCausalLM.from_pretrained(path, dtype=torch.bfloat16).to("cuda")
    constrained = generate_replies(model, tokenizer, records)
    free = []
    for record in records:
        prompt = tokenizer.apply_chat_template(record["messages"][:2], add_generation_prompt=True, return_tensors="pt", return_dict=True).to(model.device)
        with torch.no_grad():
            out = model.generate(**prompt, max_new_tokens=160, do_sample=False)
        free.append(tokenizer.decode(out[0][prompt["input_ids"].shape[1]:], skip_special_tokens=True))
    return [{"message": c["message"], "constrained": c["reply"], "free": f, "label": c["label"]} for c, f in zip(constrained, free)]


@app.function(image=gguf_image, timeout=1800, volumes={"/out": volume})
def to_gguf(run: str = "latest") -> str:
    """Convert the merged model to a Q8_0 GGUF, the format Ollama loads."""
    import subprocess

    volume.reload()
    # Named after the base model that was trained (tuned.json), e.g. LFM2.5-350M-SFT-Q8_0.gguf.
    settings = json.loads(Path(f"/out/{run}/tuned.json").read_text()).get("settings", {}) if Path(f"/out/{run}/tuned.json").exists() else {}
    target = f"/out/{run}/{settings.get('base', BASE_MODEL).split('/')[-1]}-SFT-Q8_0.gguf"
    subprocess.run(
        ["python", "/opt/llama.cpp/convert_hf_to_gguf.py", f"/out/{run}/merged", "--outfile", target, "--outtype", "q8_0"],
        check=True,
    )
    volume.commit()
    return target


@app.function(
    image=modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub"),
    timeout=1800,
    volumes={"/out": volume},
    secrets=[modal.Secret.from_name("huggingface-secret")],
)
def upload_hf(run: str, repo: str, card: str, gguf_name: str, base: str) -> str:
    """Upload <run>'s GGUF, a model card and the base model's license to a PRIVATE Hugging Face repo (created if missing)."""
    import os
    from huggingface_hub import HfApi, hf_hub_download

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    api = HfApi(token=token)
    volume.reload()
    api.create_repo(repo, private=True, exist_ok=True)
    api.upload_file(path_or_fileobj=str(next(Path(f"/out/{run}").glob("*-SFT-Q8_0.gguf"))), path_in_repo=gguf_name, repo_id=repo)
    api.upload_file(path_or_fileobj=card.encode(), path_in_repo="README.md", repo_id=repo)
    api.upload_file(path_or_fileobj=hf_hub_download(base, "LICENSE", token=token), path_in_repo="LICENSE", repo_id=repo)
    return f"https://huggingface.co/{repo}"


@app.function(image=modal.Image.debian_slim(python_version="3.12"), timeout=1800, volumes={"/out": volume})
def snapshot(src: str, dst: str) -> list[str]:
    """Copy a folder of the volume to a new name (the volume CLI cannot copy folders), so a later run cannot overwrite it."""
    import shutil

    volume.reload()
    if Path(f"/out/{dst}").exists():
        raise SystemExit(f"/out/{dst} already exists; refusing to overwrite it.")
    shutil.copytree(f"/out/{src}", f"/out/{dst}")
    volume.commit()
    return sorted(str(p.relative_to(f"/out/{dst}")) for p in Path(f"/out/{dst}").rglob("*") if p.is_file())


def report(name: str, result: dict) -> None:
    print(f"\n{name}")
    print(f"  {'split':6} {'records':>7} {'exact':>7} {'field acc':>10} {'fabricated':>11} {'missed':>8} {'wrong':>7} {'bad json':>9}")
    for split in ("val", "test"):
        r = result[split]
        print(
            f"  {split:6} {r['records']:7d} {r['exact_record_match']:7.1%} {r['field_accuracy']:10.1%} "
            f"{r['fabrication_rate']:11.1%} {r['miss_rate']:8.1%} {r['wrong_rate']:7.1%} {r['invalid_json']:9d}"
        )
    print(report_patterns(result))


def report_patterns(result: dict) -> str:
    """Pass rate (exact record match) per failure pattern, as passed/records, for val and test; "new" = the newest version's rows alone."""
    names = sorted({n for split in ("val", "test") for n in result[split].get("patterns", {})})
    lines = [f"  {'pattern':20} {'val':>12} {'val new rows':>12} {'test':>12} {'test new rows':>13}"]

    def cell(split: str, table: str, name: str) -> str:
        entry = result[split].get(table, {}).get(name)
        return f"{entry['passed']}/{entry['records']}" if entry else "-"

    for name in names:
        lines.append(
            f"  {name:20} {cell('val', 'patterns', name):>12} {cell('val', 'patterns_new', name):>12} "
            f"{cell('test', 'patterns', name):>12} {cell('test', 'patterns_new', name):>13}"
        )
    for version in sorted({v for split in ("val", "test") for v in result[split].get("versions", {})}):
        lines.append(f"  {'all ' + version + ' rows':20} {cell('val', 'versions', version):>12} {'':>12} {cell('test', 'versions', version):>12}")
    return "\n".join(lines)


@app.local_entrypoint()
def main(
    run: str = "latest",
    stage: str = "all",
    epochs: int = 3,
    lr: float = 2e-4,
    rank: int = 16,
    base: str = BASE_MODEL,
    train_subset: str = "all",
    label: str = "",
    seed: int = 0,
    patience: int = 100,
    keep_last: bool = False,
    order_copies: int = 1,
):
    """
    --run     folder in the Modal volume that the stage reads or writes (default latest, which every training
              run overwrites: give each run its own name)
    --stage   baseline | train | score (a saved <run>/merged model, no training) | gguf | snapshot (copy latest to <run>) | probe (answer the records in the JSONL file named by --label) | upload (private Hugging Face repo, --label = model card) | all
    --train-subset  all | run1 (the rows Run 1 trained on: no trainOnly / split / v2 rows)
    --seed    training seed (default 0, the seed of Runs 1 to 4)
    --patience  stop early after this many evals (four per epoch) without a better val loss (default 100: effectively never for runs this short, but 100 non-improving evals do stop a long one)
    --keep-last  keep the final-epoch weights instead of the best-val-loss checkpoint (to test whether more training hurts)
    --order-copies  train on this many copies of every row, each with the answer keys in a different random order (default 1: catalog order)
    --label   names the local result file training/out/v5-<label>.json (default: the run name)
    """
    if stage == "probe":
        # --label is a path to a JSONL file of records (the data/sft format) to answer from <run>.
        records = [json.loads(line) for line in Path(label).read_text().splitlines() if line.strip()]
        for row in probe.remote(run, records):
            print(json.dumps(row, ensure_ascii=False))
        return
    if stage == "upload":
        # --label is the path of the model card (Markdown); --base names the base model whose LICENSE is copied.
        repo = f"felixglush156/{base.split('/')[-1]}-banking-extractor-GGUF"
        print(upload_hf.remote(run, repo, Path(label).read_text(), f"{base.split('/')[-1]}-SFT-Q8_0.gguf", base))
        return
    if stage == "snapshot":
        print("\n".join(snapshot.remote("latest", run)))
        return
    files = {split: Path(f"data/sft/{split}.jsonl").read_text() for split in ("train", "val", "test")}
    empty = [split for split, text in files.items() if not text.strip()]
    if empty:
        raise SystemExit(
            f"data/sft/{', '.join(empty)}.jsonl is empty. Approve rows on /annotate (Fine-tuning data), "
            "then run `npm run sft:build`."
        )
    files["train"] = select_train(files["train"], train_subset)
    out_dir = Path("training/out")
    out_dir.mkdir(exist_ok=True)

    def save(result: dict, kind: str) -> None:
        # One file per stage; "all" runs two scorings, so they get a suffix.
        suffix = f"-{kind}" if stage == "all" else ""
        (out_dir / f"v5-{label or run}{suffix}.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))

    if stage in ("baseline", "all"):
        result = baseline.remote(files, base, run)
        save(result, "baseline")
        report("base model", result)
    if stage == "score":
        result = score_saved.remote(files, run)
        save(result, "score")
        report(f"saved model {run}", result)
    if stage in ("train", "all"):
        result = train.remote(files, base, epochs, lr, rank, run, seed, patience, keep_last, order_copies)
        save(result, "tuned")
        report(f"LoRA (r={rank}, lr={lr}, {epochs} epochs, {result['train_records']} train rows)", result)
    if stage in ("gguf", "all"):
        print("\nGGUF:", to_gguf.remote(run))
        print(f"Fetch it: modal volume get jev-sft {run}/<base model name>-SFT-Q8_0.gguf scripts/ollama/models/")
