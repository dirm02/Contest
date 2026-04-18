#!/usr/bin/env python3
"""
backfill_aliases.py - Populate general.splink_aliases from splink_predictions + parquet.

Splink's aliases are one row per (cluster_id, record_id) with the record's legal_name.
The original run_splink.py tried to merge clusters_df with records_df on record_id but
landed 0 rows — likely a column-naming mismatch. This script sidesteps that by
reconstructing the (record -> cluster_id) mapping from splink_predictions (which was
written correctly) and joining to the parquet-resident legal_name.

Usage:
  python splink/backfill_aliases.py
"""
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = HERE / "data"

for env_file in [ROOT / ".env.public", ROOT / ".env"]:
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

import pyarrow.parquet as pq
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

DB_URL = os.environ["DB_CONNECTION_STRING"]
PARQUET = ["fed.parquet", "cra.parquet", "ab_non_profit.parquet",
           "ab_grants.parquet", "ab_contracts.parquet", "ab_sole_source.parquet"]


def log(m): print(f"[aliases] {m}", flush=True)


def main():
    # Load legal_names from parquet.
    log("Loading parquet records...")
    dfs = []
    for fn in PARQUET:
        fp = DATA_DIR / fn
        if fp.exists():
            dfs.append(pq.read_table(fp).to_pandas())
    recs = pd.concat(dfs, ignore_index=True)
    recs["record_id"] = recs["source_dataset"] + ":" + recs["record_id"]
    # Map record_id (prefixed) -> (source_dataset, source_id_unprefixed, legal_name)
    rec_map = {
        row["record_id"]: (row["source_dataset"], row["record_id"].split(":", 1)[1], row["legal_name"])
        for _, row in recs[["record_id", "source_dataset", "legal_name"]].iterrows()
        if row["legal_name"]
    }
    log(f"  {len(rec_map):,} records with legal_name")

    # Pull predictions — one row per cluster/record side.
    kw = {"sslmode": "require"} if "render.com" in DB_URL else {}
    conn = psycopg2.connect(DB_URL, **kw)
    cur = conn.cursor()

    log("Fetching (record, cluster_id) from splink_predictions...")
    cur.execute("""
        SELECT DISTINCT cluster_id, source_l, record_l FROM general.splink_predictions
         WHERE cluster_id IS NOT NULL
        UNION
        SELECT DISTINCT cluster_id, source_r, record_r FROM general.splink_predictions
         WHERE cluster_id IS NOT NULL
    """)
    pairs = cur.fetchall()
    log(f"  {len(pairs):,} distinct (cluster, record) pairs")

    # Build rows: (cluster_id, alias, source_dataset, source_id, match_probability, build_id)
    build = cur.execute("SELECT id FROM general.splink_build_metadata ORDER BY id DESC LIMIT 1")
    build_id = cur.fetchone()[0]
    log(f"  Writing against build_id={build_id}")

    rows = []
    seen = set()
    for cluster_id, source_ds, source_id in pairs:
        key = (cluster_id, source_ds, source_id)
        if key in seen: continue
        seen.add(key)
        rid = f"{source_ds}:{source_id}"
        tup = rec_map.get(rid)
        if not tup: continue
        _, _, legal_name = tup
        if not legal_name: continue
        rows.append((str(cluster_id), legal_name, source_ds, source_id, 1.0, build_id))

    if not rows:
        log("No alias rows to write.")
        return

    log(f"Writing {len(rows):,} alias rows...")
    cur.execute("TRUNCATE general.splink_aliases")
    execute_values(cur, """
        INSERT INTO general.splink_aliases
          (cluster_id, alias, source_dataset, source_id, match_probability, build_id)
        VALUES %s ON CONFLICT DO NOTHING
    """, rows, page_size=5000)
    conn.commit()
    log("Done.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
