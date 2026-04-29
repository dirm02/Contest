# Ship Database Seed

This directory is mounted into the `ship-db` Postgres container on first boot.

Preferred local seed:

```bash
# From the source repo that already has the loaded hackathon database:
pg_dump -h localhost -U hackathon -F c -d hackathon -f hackathon.dump

# Then place the dump here:
mv hackathon.dump /home/david/GitHub/Contest/services/ship/seed/hackathon.dump
```

`hackathon.dump` is intentionally gitignored because it is several GB. On the first `docker compose up`, Postgres restores it with `pg_restore`, creates the required extensions, and then the FastAPI service starts.

Supported seed filenames:

- `hackathon.dump`: custom-format `pg_dump -F c` restore through `pg_restore`.
- `hackathon.sql.gz`: gzipped plain SQL restore through `psql`.
- `hackathon.sql`: plain SQL restore through `psql`.
- `.local-db/` plus `dataset/`: JSONL import kit fallback. The stock `postgres:16` image does not include Node.js, so this fallback requires a custom DB image or manual import outside the container. The dump path is the supported fast path for this repo.

Do not commit dumps, JSONL data, or local `.env` files from this directory.

