"""The action catalog: the actions the banking app can perform and the parameters each one takes.

It lives in a JSON file (actions/banking.json) so adding an action never needs a code change.
The same file can later drive the Next.js UI: one component per action, one field per parameter.

Parameter types and how their values are found:
- choice: Jev picks one of `options` (a fixed set, like account types).
- amount, email, phone: code finds every candidate in the text with a regex, then Jev picks one.
- name: code proposes every short phrase in the text as a candidate, then Jev picks one.
Every parameter also gets a "none" option, so a value the customer didn't give stays empty
instead of being guessed.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

PARAM_TYPES = {"choice", "amount", "email", "phone", "name"}


@dataclass
class Param:
    name: str
    type: str
    question: str
    required: bool = False
    options: dict[str, str] = field(default_factory=dict)  # only for type "choice"


@dataclass
class Action:
    name: str
    description: str
    params: dict[str, Param]


@dataclass
class Catalog:
    actions: dict[str, Action]
    context: str | None = None


def load_catalog(path: Path) -> Catalog:
    raw = json.loads(path.read_text())
    actions: dict[str, Action] = {}
    for action_name, spec in raw["actions"].items():
        params: dict[str, Param] = {}
        for param_name, p in spec.get("params", {}).items():
            if p.get("type") not in PARAM_TYPES:
                raise ValueError(f"{path}: {action_name}.{param_name} has type {p.get('type')!r}; use one of {sorted(PARAM_TYPES)}")
            if p["type"] == "choice" and not p.get("options"):
                raise ValueError(f"{path}: {action_name}.{param_name} is a choice but has no options")
            params[param_name] = Param(param_name, p["type"], p["question"], p.get("required", False), p.get("options", {}))
        actions[action_name] = Action(action_name, spec["description"], params)
    if not actions:
        raise ValueError(f"{path}: no actions defined")
    return Catalog(actions, raw.get("context"))
