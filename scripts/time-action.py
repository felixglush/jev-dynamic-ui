"""Time and score the action model in Ollama over the action test split (docs/sft-action.md).

    python3 scripts/time-action.py [model] [count] [action|extract]

"extract" times the field-extraction step instead (data/sft/test.jsonl, the schema built from each record's fields).

Each request is the system prompt + message with the action enum as the JSON schema, as the app would send it.
"""
import json, statistics, sys, time, urllib.request

model = sys.argv[1] if len(sys.argv) > 1 else "lfm25-350m-action"
mode = sys.argv[3] if len(sys.argv) > 3 else "action"
rows = [json.loads(l) for l in open("data/sft/test.jsonl" if mode == "extract" else "data/sft/action/test.jsonl") if l.strip()]
count = int(sys.argv[2]) if len(sys.argv) > 2 else len(rows)
actions = ["add_etransfer_contact", "send_etransfer", "pay_credit_card", "open_account", "transfer_between_accounts", "pay_bill", "add_payee", "manage_card", "view_account", "request_etransfer", "cancel_etransfer", "setup_autodeposit", "dispute_transaction", "update_contact_info", "none"]
schema = {"type": "object", "properties": {"action": {"type": "string", "enum": actions}}, "required": ["action"], "additionalProperties": False}

def schema_for(label):
    props = {k: {"type": "number" if k in ("amount", "initial_deposit") else "string"} for k in label}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}

def ask(system, message, label=None):
    body = json.dumps({"model": model, "stream": False, "format": schema_for(label) if label else schema, "options": {"temperature": 0},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": message}]}).encode()
    start = time.perf_counter()
    with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/chat", body, {"Content-Type": "application/json"})) as r:
        out = json.load(r)
    answer = json.loads(out["message"]["content"])
    return (answer if label else answer["action"]), (time.perf_counter() - start) * 1000, out

label0 = json.loads(rows[0]["messages"][2]["content"]) if mode == "extract" else None
ask(rows[0]["messages"][0]["content"], "warm up", label0)
ask(rows[0]["messages"][0]["content"], "warm up again", label0)
ms, right = [], 0
for row in rows[:count]:
    label = json.loads(row["messages"][2]["content"]) if mode == "extract" else None
    answer, t, out = ask(row["messages"][0]["content"], row["messages"][1]["content"], label)
    ms.append(t)
    right += (answer == label) if mode == "extract" else (answer == row["meta"]["action"])
ms.sort()
print(f"{model}: {right}/{count} {"exact (raw compare)" if mode == "extract" else "correct"}, median {statistics.median(ms):.0f} ms, p95 {ms[int(.95*len(ms))-1]:.0f} ms, mean {statistics.mean(ms):.0f} ms; last eval_count={out.get('eval_count')} prompt_eval_count={out.get('prompt_eval_count')}")
