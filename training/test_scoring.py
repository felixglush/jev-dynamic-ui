"""Checks for the scoring in modal_train.py. Run: python3 -m pytest training  (needs `pip install modal pytest`)."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from modal_train import breakdowns, normalize, parse_answer, pass_rates, record_passes, report_patterns, score, select_train  # noqa: E402

LABEL = {"recipient": "Sam", "recipient_email": "", "amount": 50, "date": ""}


def row(reply, label=LABEL, action="send_etransfer"):
    return {"action": action, "label": label, "reply": reply}


def test_a_perfect_answer_is_exact():
    result = score([row(json.dumps({"recipient": "Sam", "recipient_email": "", "amount": 50.0, "date": ""}))])
    assert result["exact_record_match"] == 1 and result["field_accuracy"] == 1 and result["fabrication_rate"] == 0


def test_filling_a_blank_field_counts_as_fabricated():
    result = score([row(json.dumps({"recipient": "Sam", "recipient_email": "sam@example.com", "amount": 50, "date": "2023-10-05"}))])
    assert result["totals"]["fabricated"] == 2
    assert result["fabrication_rate"] == 1  # both blank fields were filled in
    assert result["exact_record_match"] == 0


def test_missed_and_wrong_values_are_told_apart():
    result = score([row(json.dumps({"recipient": "", "recipient_email": "", "amount": 60, "date": ""}))])
    assert result["totals"]["missed"] == 1 and result["totals"]["wrong"] == 1
    assert result["miss_rate"] == 0.5 and result["wrong_rate"] == 0.5


def test_unparseable_replies_are_counted():
    result = score([row("Sure! Here you go.")])
    assert result["invalid_json"] == 1 and result["exact_record_match"] == 0


def test_values_compare_the_way_a_person_would():
    assert normalize("amount", "$1,850.00") == normalize("amount", 1850)
    assert normalize("amount", 0) == "" and normalize("amount", "") == ""
    assert normalize("recipient", " María-José ") == normalize("recipient", "maría-josé")


def test_reply_with_text_around_the_json_still_parses():
    assert parse_answer('Answer: {"a": 1}') == {"a": 1}


def tagged(reply_ok, pattern=None, version="v1"):
    reply = {"recipient": "Sam", "recipient_email": "", "amount": 50, "date": ""}
    if not reply_ok:
        reply["amount"] = 5
    return {**row(json.dumps(reply)), "pattern": pattern, "version": version}


def test_record_passes_matches_the_exact_criterion():
    assert record_passes(tagged(True)) and not record_passes(tagged(False))
    assert not record_passes(row("not json"))


def test_pass_rate_per_pattern_leaves_untagged_rows_out():
    rows = [tagged(True, "a"), tagged(False, "a"), tagged(True, "b"), tagged(False)]
    rates = pass_rates(rows, lambda r: r["pattern"])
    assert rates == {"a": {"records": 2, "passed": 1, "pass_rate": 0.5}, "b": {"records": 1, "passed": 1, "pass_rate": 1.0}}


def test_breakdowns_separate_v2_rows_and_versions():
    rows = [tagged(True, "a", "v1"), tagged(False, "a", "v2"), tagged(True, "a", "v2"), tagged(True)]
    b = breakdowns(rows)
    assert b["patterns"]["a"]["records"] == 3 and b["patterns"]["a"]["passed"] == 2
    assert b["patterns_v2_only"]["a"] == {"records": 2, "passed": 1, "pass_rate": 0.5}
    assert b["versions"]["v1"]["records"] == 2 and b["versions"]["v2"]["records"] == 2


def test_score_exact_count_agrees_with_record_passes():
    rows = [tagged(True, "a"), tagged(False, "a"), row("oops")]
    assert score(rows)["exact_record_match"] == sum(record_passes(r) for r in rows) / 3


def test_report_lists_every_pattern_with_passed_over_records():
    rows = [tagged(True, "a", "v2"), tagged(False, "b", "v2")]
    split = {**score(rows), **breakdowns(rows)}
    text = report_patterns({"val": split, "test": split})
    assert "a" in text and "1/1" in text and "0/1" in text


def test_select_train_run1_drops_the_later_additions():
    def rec(i, **meta):
        return json.dumps({"messages": [], "meta": {"id": i, **meta}})

    text = "\n".join([rec("a"), rec("b", trainOnly=True), rec("c", split="train", version="v2"), rec("d", pattern="x")]) + "\n"
    kept = [json.loads(line)["meta"]["id"] for line in select_train(text, "run1").splitlines()]
    assert kept == ["a", "d"]
    assert select_train(text, "all") == text


def test_evaluate_never_returns_test_failures():
    import modal_train

    rows = [{**tagged(False, "a"), "id": "x", "message": "m"}]
    original = modal_train.generate_replies
    modal_train.generate_replies = lambda model, tokenizer, records: rows
    try:
        result = modal_train.evaluate(None, None, {"val": '{"messages": []}', "test": '{"messages": []}'})
    finally:
        modal_train.generate_replies = original
    assert "examples" in result["val"] and "examples" not in result["test"]
    assert result["test"]["patterns"]["a"]["records"] == 1
