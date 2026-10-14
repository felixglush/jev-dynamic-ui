"""Classify banking chat queries into parametrized app actions with TypeSafe's Jev model."""

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

from typesafe_sdk import TypeSafeClient, TypeSafeError

from jev_eval.apikey import ENV_VAR, delete_stored_key, load_api_key, prompt_and_store_key
from jev_eval.catalog import load_catalog
from jev_eval.classify import classify
from jev_eval.inputs import read_queries
from jev_eval.table import to_table

DEFAULT_CATALOG = Path("actions/banking.json")


def _require_key() -> str:
    key = load_api_key()
    if not key:
        sys.exit(f"No API key found. Set {ENV_VAR} in a .env file, or run `uv run jev-eval set-key`.")
    return key


def _classify(args: argparse.Namespace) -> None:
    catalog = load_catalog(args.actions)
    queries = read_queries(args.input)
    calls = asyncio.run(classify(queries, catalog, api_key=_require_key(), model=args.model, concurrency=args.concurrency))
    # --json prints what the UI step will consume; the table is for reading.
    print(json.dumps([asdict(c) for c in calls], indent=2) if args.json else to_table(calls, args.low_confidence))
    if any(c.error for c in calls):
        sys.exit(1)


def _models(_: argparse.Namespace) -> None:
    # A cheap way to confirm the key works.
    with TypeSafeClient(api_key=_require_key()) as client:
        for model in client.models.list().models:
            print(f"{model.name:20} {model.release_date}  {model.description}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="jev-eval", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("classify", help="Classify queries (one per line) into actions with parameters")
    run.add_argument("input", type=Path, help="Text file with one query per line")
    run.add_argument("-a", "--actions", type=Path, default=DEFAULT_CATALOG, help=f"Action catalog JSON (default: {DEFAULT_CATALOG})")
    run.add_argument("-m", "--model", help="Model name (default: jev-latest)")
    run.add_argument("-c", "--concurrency", type=int, default=8, help="Requests in flight at once")
    run.add_argument("--low-confidence", type=float, default=0.6, help="Flag judgments below this confidence")
    run.add_argument("--json", action="store_true", help="Print JSON instead of a table")
    run.set_defaults(func=_classify)

    sub.add_parser("models", help="List available models (checks your key)").set_defaults(func=_models)
    sub.add_parser("set-key", help="Store the API key in the OS keychain").set_defaults(func=lambda _: prompt_and_store_key())
    sub.add_parser("delete-key", help="Remove the key from the OS keychain").set_defaults(func=lambda _: delete_stored_key())

    args = parser.parse_args()
    try:
        args.func(args)
    except (TypeSafeError, ValueError, FileNotFoundError) as error:
        sys.exit(f"error: {error}")
