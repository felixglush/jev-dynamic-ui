"""Checks for the scoring in modal_train.py. Run: python3 -m pytest training  (needs `pip install modal pytest`)."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from modal_train import normalize, parse_answer, score  # noqa: E402

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
