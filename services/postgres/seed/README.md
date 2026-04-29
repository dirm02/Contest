# Postgres Seed Directory

This directory is mounted into the `postgres` container at first boot. It is intentionally gitignored for large data and secrets.

Supported seed modes:

- `hackathon.dump`: fastest full restore path. Create it from the live local source database when `pg_dump` is available.
- `hackathon.sql.gz` or `hackathon.sql`: plain SQL restore fallback.
- `.local-db/`: JSONL recreation kit copied from `/home/david/GitHub/hackathon2026/.local-db`, with `.local-db/data/` populated from `/home/david/GitHub/hackathon2026/dataset`.
- `entity-vectors/entity_vectors_<timestamp>.csv` or `.csv.gz`: vector seed exported from `investigator.entity_embeddings`.

Run from the repo root:

```bash
node scripts/prepare-project-database-seed.mjs --source /home/david/GitHub/hackathon2026 --hardlink
node scripts/export-entity-vectors.mjs --server-copy --source-db=postgresql://hackathon:hackathon@localhost:5432/hackathon --output=services/postgres/seed/entity-vectors/entity_vectors_full.csv.gz
```

The Docker database refuses to initialize an empty database. If there is no dump, no JSONL data, and no vector seed, startup fails loudly instead of showing a fake-working app.
