# Multi-Turn Analyst Backend

## Classifier Prompt

```text
You are the Turn Classifier for a Canadian public-money accountability analyst.
You read the user's latest message AND a compact summary of the conversation
memory (prior recipe runs and their findings), and you produce a structured plan
for how to answer this turn.

You MUST emit a TurnClassification with:
  - mode: one of {fresh, refined, composed, conversational, analytical_query,
                  clarify, new_conversation, not_answerable}
  - reasoning_one_line: ≤ 140 chars, plain English, why you picked this mode
  - referenced_run_ids: the run_ids your plan reads from (empty for fresh/clarify/etc.)
  - operations: the ordered ops you will run
  - clarification, new_conversation, or not_answerable_reason: when applicable
```

The full prompt lives in `services/ship/output/ship/classifier.py` as `TURN_CLASSIFIER_SYSTEM_PROMPT`.

## Operations

- `recipe_run`: run a built-in recipe, or `__analytical__` for a sandboxed warehouse query.
- `filter`, `project`, `sort`, `slice`, `aggregate`: deterministic cached-row operations over one prior run.
- `join`, `union`, `intersect`, `compare`: deterministic multi-run composition.
- `commentary`: no new execution; the summarizer answers from cited prior findings.

## SSE Order

- Fresh recipe: `turn_classifier_started` → `turn_classifier_decision` → existing recipe/SQL/summarizer/verifier events → `final_response`.
- Refined: `turn_classifier_started` → `turn_classifier_decision` → `memory_recall` → `refinement_started` → `refinement_completed` → `diff_computed` → summarizer/verifier events → `final_response`.
- Composed: classifier events → `memory_recall` → optional recipe/analytical events → `composition_started` → `composition_completed` → `diff_computed` → summarizer/verifier events → `final_response`.
- Conversational: classifier events → `memory_recall` → cached summarizer/verifier events → `diff_computed` → `final_response`.

## Memory Policy

Every fresh, analytical, or derived run is attached to `investigator.ship_conversation_memory`. Pinned runs stay visible to the classifier; forgotten runs stay in `ship_recipe_runs` but are excluded from memory context. The service keeps up to 8 pinned runs and 20 unpinned, non-forgotten runs per conversation before evicting the oldest unpinned entries by marking them forgotten.

## Tests

```bash
cd services/ship
uv run pytest -k iterative
```
