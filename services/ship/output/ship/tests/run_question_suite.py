"""Run the natural-language router path over the ship-mode question examples."""

from __future__ import annotations

import argparse
import asyncio
import time
import traceback
from collections import defaultdict
from pathlib import Path
from typing import Any
from uuid import UUID

from output.ship.bootstrap_schema import bootstrap_schema
from output.ship.orchestrator import create_conversation, get_recipe_run, handle_user_message
from output.ship.primitives.base import create_pool
from output.ship.tests.question_examples import QUESTIONS_BY_RECIPE


REPORT_PATH = Path("output/ship/tests/router_path_report.md")


async def run_suite(*, limit_per_recipe: int | None = None) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    pool = await create_pool()
    try:
        await bootstrap_schema(pool)
        for expected_recipe_id, questions in QUESTIONS_BY_RECIPE.items():
            selected_questions = questions[:limit_per_recipe] if limit_per_recipe is not None else questions
            for question in selected_questions:
                started = time.perf_counter()
                row: dict[str, Any] = {
                    "expected_recipe_id": expected_recipe_id,
                    "question": question,
                    "actual_recipe_id": None,
                    "status": "crashed",
                    "latency_ms": 0,
                    "failures": [],
                    "traceback": "",
                    "conversation_id": None,
                    "recipe_run_id": None,
                }
                try:
                    conversation = await create_conversation(pool, title=f"suite: {expected_recipe_id}")
                    conversation_id = UUID(str(conversation["conversation_id"]))
                    row["conversation_id"] = str(conversation_id)
                    answer = await handle_user_message(conversation_id=conversation_id, content=question, pool=pool)
                    row["status"] = answer.type
                    row["latency_ms"] = getattr(answer, "latency_ms", int((time.perf_counter() - started) * 1000))
                    if answer.type == "answer":
                        row["recipe_run_id"] = answer.recipe_run_id
                        run = await get_recipe_run(pool, UUID(answer.recipe_run_id))
                        row["actual_recipe_id"] = run["recipe_id"] if run else None
                        row["status"] = "completed" if answer.verification.status == "pass" else "verification_failed"
                        row["failures"] = answer.verification.failures
                    elif answer.type == "clarification_needed":
                        row["failures"] = [answer.reason]
                    elif answer.type == "needs_new_conversation":
                        row["failures"] = [answer.reason]
                    elif answer.type == "not_answerable":
                        row["failures"] = [answer.message]
                except Exception:
                    row["latency_ms"] = int((time.perf_counter() - started) * 1000)
                    row["traceback"] = traceback.format_exc(limit=8)
                    row["failures"] = [row["traceback"].splitlines()[-1] if row["traceback"] else "unknown exception"]
                rows.append(row)
                print(f"{row['status']}: expected={expected_recipe_id} actual={row['actual_recipe_id']} latency={row['latency_ms']}ms question={question}")
    finally:
        await pool.close()
    return _summarize(rows)


def _summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    routing_correct = sum(1 for row in rows if row["actual_recipe_id"] == row["expected_recipe_id"])
    completed = sum(1 for row in rows if row["status"] in {"completed", "verification_failed"})
    verified = sum(1 for row in rows if row["status"] == "completed")
    crashed = sum(1 for row in rows if row["status"] == "crashed")
    by_recipe: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0, "routing_correct": 0, "completed": 0, "verified": 0, "crashed": 0})
    for row in rows:
        bucket = by_recipe[row["expected_recipe_id"]]
        bucket["total"] += 1
        bucket["routing_correct"] += int(row["actual_recipe_id"] == row["expected_recipe_id"])
        bucket["completed"] += int(row["status"] in {"completed", "verification_failed"})
        bucket["verified"] += int(row["status"] == "completed")
        bucket["crashed"] += int(row["status"] == "crashed")
    return {
        "rows": rows,
        "summary": {
            "total": total,
            "routing_accuracy": _rate(routing_correct, total),
            "pipeline_completion_rate": _rate(completed, total),
            "verification_pass_rate": _rate(verified, total),
            "crashes": crashed,
        },
        "by_recipe": dict(by_recipe),
    }


def _rate(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def render_report(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# Router Path Report",
        "",
        "This report runs the full natural-language path: `question -> router -> recipe -> summary -> verifier`.",
        "",
        "## Summary",
        "",
        f"- Questions: {summary['total']}",
        f"- Routing accuracy: {summary['routing_accuracy']:.1%}",
        f"- Pipeline completion rate: {summary['pipeline_completion_rate']:.1%}",
        f"- Verification pass rate: {summary['verification_pass_rate']:.1%}",
        f"- Crashes: {summary['crashes']}",
        "",
        "## Per Recipe",
        "",
        "| Recipe | Questions | Routing | Completed | Verified | Crashes |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for recipe_id, stats in sorted(payload["by_recipe"].items()):
        total = stats["total"]
        lines.append(
            f"| `{recipe_id}` | {total} | {_rate(stats['routing_correct'], total):.1%} | "
            f"{_rate(stats['completed'], total):.1%} | {_rate(stats['verified'], total):.1%} | {stats['crashed']} |"
        )
    lines.extend([
        "",
        "## Questions",
        "",
        "| Expected | Actual | Status | Latency | Failures | Question |",
        "| --- | --- | --- | ---: | --- | --- |",
    ])
    for row in payload["rows"]:
        failures = "<br>".join(str(item).replace("|", "\\|") for item in row["failures"][:3]) or ""
        question = row["question"].replace("|", "\\|")
        lines.append(
            f"| `{row['expected_recipe_id']}` | `{row['actual_recipe_id']}` | `{row['status']}` | "
            f"{row['latency_ms']}ms | {failures} | {question} |"
        )
    crashes = [row for row in payload["rows"] if row["traceback"]]
    if crashes:
        lines.extend(["", "## Crash Tracebacks", ""])
        for index, row in enumerate(crashes, start=1):
            lines.extend([
                f"### Crash {index}: {row['question']}",
                "",
                "```text",
                row["traceback"].rstrip(),
                "```",
                "",
            ])
    return "\n".join(lines).rstrip() + "\n"


async def _main() -> None:
    parser = argparse.ArgumentParser(description="Run the output.ship natural-language question suite.")
    parser.add_argument("--limit-per-recipe", type=int, default=None)
    parser.add_argument("--report", default=str(REPORT_PATH))
    args = parser.parse_args()
    payload = await run_suite(limit_per_recipe=args.limit_per_recipe)
    Path(args.report).write_text(render_report(payload), encoding="utf-8")
    print(f"wrote {args.report}")


if __name__ == "__main__":
    asyncio.run(_main())
