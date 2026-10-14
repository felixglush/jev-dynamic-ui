# jev-eval

A CLI that reads banking-app chat queries (one per line) and uses TypeSafe's Jev model to
classify each into an app action with its parameters filled in, e.g.

```
Send $50 to Sam for dinner  ->  send_etransfer  recipient=Sam, amount=50.00
```

That output is what the next step (a Next.js UI) will use to pick and pre-fill a component.

## Setup

```bash
uv sync                          # creates .venv and installs dependencies
cp .env.example .env             # then put your key in .env        (option A)
uv run jev-eval set-key          # or store it in your OS keychain  (option B, more secure)
uv run jev-eval models           # checks the key works
```

Run these from inside the `jev-eval` folder. `uv run` runs a command inside the project's
virtual environment; `jev-eval` is the command defined under `[project.scripts]` in
`pyproject.toml`, which points at `main()` in `src/jev_eval/cli.py`.

The key is looked up in this order: the `TYPESAFE_API_KEY` env var (loaded from `.env`), then
the OS keychain. `.env` is gitignored; never commit it.

## Run

```bash
uv run jev-eval classify examples/queries.txt
uv run jev-eval classify examples/queries.txt --json   # what the UI will consume
```

Columns: the chosen action (or `none`), `conf` (the least certain judgment in the row; ⚠ when
below `--low-confidence`, default 0.6), the filled parameters (`?` marks an uncertain one), and
`missing`: required parameters the query didn't give, which the UI should ask for.

## How it works

Each query is one Jev request that asks, in parallel:

- `__action__`: a Choice over the actions in `actions/banking.json`, plus `none`.
- `<action>.<param>`: every parameter of every action, speculatively. Code then keeps only the
  chosen action's answers, so there's one round trip instead of two.

Jev picks, it never writes text. So parameter values come from TypeSafe's "select, don't
generate" pattern:

| param type | candidates come from | then |
| --- | --- | --- |
| `choice` | the fixed `options` in the catalog | Jev picks one |
| `amount`, `email`, `phone` | regexes in `candidates.py` | Jev picks which span, code normalizes it |
| `name` | every 1 to 3 word phrase in the query | Jev picks which phrase |

Every parameter question also has a `none` option, so a value the customer didn't give stays
empty rather than being guessed.

## Adding an action

Add an entry to `actions/banking.json` with a `description` and its `params`. No code change.
Write each `question` as a full sentence about `query`; Jev never sees the parameter's name.

## Layout

```
actions/banking.json     the action catalog (actions, params, options)
src/jev_eval/
  cli.py                 commands: classify, models, set-key, delete-key
  apikey.py              .env/env var, then OS keychain
  catalog.py             loads the catalog JSON into dataclasses
  candidates.py          regex candidate finders and value normalizing
  classify.py            builds the Jev questions and turns answers into action calls
  table.py               terminal table
  inputs.py              reads one query per line
```
