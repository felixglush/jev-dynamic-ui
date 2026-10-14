"""Read the queries to classify: one per non-empty line of a text file."""

from pathlib import Path


def read_queries(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text().splitlines() if line.strip()]
