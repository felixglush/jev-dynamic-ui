"""Render action calls as a terminal table."""

from jev_eval.classify import ActionCall

PREVIEW = 45


def _cell(text: str, width: int) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"


def to_table(calls: list[ActionCall], low_confidence: float) -> str:
    header = ["#", "query", "action", "conf", "parameters", "missing"]
    rows = []
    for i, call in enumerate(calls, start=1):
        if call.error:
            rows.append([str(i), _cell(call.query, PREVIEW), "ERROR", "", call.error, ""])
            continue
        params = ", ".join(
            f"{name}={p.value}" + ("?" if p.confidence is not None and p.confidence < low_confidence else "")
            for name, p in call.params.items()
            if p.value is not None
        )
        weakest = call.weakest
        conf = f"{weakest:.2f}" if weakest is not None else ""
        if weakest is not None and weakest < low_confidence:
            conf += " ⚠"
        rows.append([str(i), _cell(call.query, PREVIEW), call.action or "none", conf, params, ", ".join(call.missing)])
    widths = [max(len(c) for c in col) for col in zip(header, *rows)]

    def line(cells: list[str]) -> str:
        return "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()

    legend = f"conf = least certain judgment in the row; ⚠ and ? mark values below {low_confidence}."
    return "\n".join([line(header), line(["-" * w for w in widths]), *(line(r) for r in rows), "", legend])
