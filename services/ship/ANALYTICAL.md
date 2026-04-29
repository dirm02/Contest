# Analytical Query Agent

## Why Plan Then Compile

The analytical path never lets a user or model submit raw SQL directly. The service extracts concepts from the question, resolves them through curated YAML lexicon entries, builds a structured `QueryPlan`, compiles that plan to one SELECT statement, validates it with the SQL sandbox, and only then executes it in a read-only transaction.

This keeps the product behavior simple for the user: they can ask “How many schools received funding in 2024?” and see concept extraction, plan generation, sandbox validation, and execution in the activity feed. Underneath, the risky part is constrained to reviewable templates and a validator.

## Lexicon Authoring

Concept files live in `output/ship/seed/lexicon/*.yaml`. Each concept defines synonyms, applicable table/column pairs, a static SQL predicate template, caveats, confidence, and review metadata.

Example:

```yaml
concept: schools
synonyms: [school, schools, school board, conseil scolaire]
applicable_columns:
  - {table: fed.grants_contributions, column: recipient_legal_name, match: name_pattern}
predicate:
  name_pattern:
    sql_template: "({col} ILIKE '%school%' OR {col} ILIKE '%conseil scolaire%')"
caveats:
  - "School matching is name-pattern based and may miss some French-only authorities."
confidence: 0.85
version: 1
```

Adding a concept should be a YAML-only change when the target columns already exist in the catalog.

## Catalog Authoring

Dataset files live in `output/ship/seed/catalog/*.yaml`. Each file documents one safe analytical table: schema, name, grain, key columns, column descriptions, PII flags, refresh cadence, and coverage period. The analytical compiler and sandbox reject tables not present in this catalog and columns marked `pii=true`.

## Query Templates

Templates are Python code in `output/ship/sql_compiler.py`:

- `count_distinct`
- `aggregate_by_group`
- `top_n_with_filter`
- `intersection_across_filters`
- `delta_year_over_year`
- `percentile`

New templates need compiler logic and sandbox/security tests before use.

## Operational Notes

- Schema drift: update the catalog YAML and restart the service so `schema_hash` changes for auditability.
- Lexicon drift: update one YAML file; the next service reload exposes the new lexicon hash and predicates.
- Sandbox failure: the answer ships with caveats and failed verification instead of inventing results.
- Audit: every analytical attempt writes `investigator.ship_analytical_audit` with question, plan, SQL, sandbox status, schema hash, lexicon version, timing, row count, and verifier status.
- Permissions: production should use a read-only database role for analytical execution. The bootstrap creates an `analytical_reader` role placeholder; deployment grants should limit it to catalog-approved tables.
