#!/usr/bin/env python3
"""
Run Splink probabilistic matching and write results directly to Postgres.

Reads the parquet files produced by export_source_data.py, runs Splink's
Fellegi-Sunter probabilistic record linkage using a DuckDB backend (in-memory,
fast), then writes:

  - general.splink_predictions  — pairwise match probabilities above threshold
  - general.splink_aliases      — name variants per cluster, for golden-record enrichment
  - general.splink_build_metadata — audit row with build parameters

No SQLite artifact. Postgres is the single source of truth. Our Node-side
05-detect-candidates.js Tier 5 reads from splink_predictions to feed the LLM
review queue with probabilistic matches our deterministic cascade missed.

Usage:
  python splink/run_splink.py                     # default threshold 0.40
  python splink/run_splink.py --threshold 0.50    # only write pairs ≥ 0.50
"""
import argparse
import hashlib
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# Force UTF-8 stdout so Unicode chars (em-dash, arrows) in log messages don't
# crash on Windows consoles defaulting to cp1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

print("[splink] starting imports...", flush=True)

# Splink must import before raw duckdb/pyarrow to avoid DuckDB handle conflicts.
try:
    import splink
    from splink import DuckDBAPI, Linker, SettingsCreator, block_on
    import splink.comparison_library as cl
    SPLINK_VERSION = splink.__version__
    print(f"[splink] splink {SPLINK_VERSION} ready", flush=True)
except ImportError as e:
    print(f"[splink] ERROR: splink not installed: {e}", flush=True)
    sys.exit(1)

import duckdb
import pandas as pd
import pyarrow.parquet as pq
import psycopg2
from psycopg2.extras import execute_values

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA_DIR = HERE / "data"

# Load env (mirror lib/db.js)
for env_file in [ROOT / ".env.public", ROOT / ".env"]:
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ[key.strip()] = val.strip().strip('"').strip("'")

DB_URL = os.environ.get("DB_CONNECTION_STRING", "")
if not DB_URL:
    print("[splink] ERROR: DB_CONNECTION_STRING not set", flush=True)
    sys.exit(1)

PARQUET_FILES = [
    "fed.parquet", "cra.parquet",
    "ab_non_profit.parquet", "ab_grants.parquet",
    "ab_contracts.parquet", "ab_sole_source.parquet",
]


def log(m): print(f"[splink] {m}", flush=True)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--threshold", type=float, default=0.40,
                   help="Minimum match probability to persist (default 0.40)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--memory-limit", type=str, default="10GB")
    return p.parse_args()


def pg_connect():
    kw = {"sslmode": "require"} if "render.com" in DB_URL else {}
    return psycopg2.connect(DB_URL, **kw)


def load_parquet():
    log("Loading parquet files...")
    dfs = []
    for fn in PARQUET_FILES:
        fp = DATA_DIR / fn
        if not fp.exists():
            log(f"  WARNING: {fn} not found — skipping")
            continue
        df = pq.read_table(fp).to_pandas()
        before = len(df)
        df = df.drop_duplicates(
            subset=["cleaned_name", "bn_root", "postal_code", "city"],
            keep="first"
        ).reset_index(drop=True)
        log(f"  {fn}: {before:,} -> {len(df):,} after dedup")
        dfs.append(df)
    if not dfs:
        log("ERROR: no parquet files. Run export_source_data.py first.")
        sys.exit(1)
    combined = pd.concat(dfs, ignore_index=True)
    combined["record_id"] = combined["source_dataset"] + ":" + combined["record_id"]
    log(f"  Total: {len(combined):,} records")
    return combined


def configure_splink():
    return SettingsCreator(
        link_type="link_and_dedupe",
        unique_id_column_name="record_id",
        probability_two_random_records_match=1 / 50_000,
        comparisons=[
            cl.ExactMatch("bn_root").configure(term_frequency_adjustments=True),
            cl.JaroWinklerAtThresholds("cleaned_name", [0.92, 0.82]).configure(
                term_frequency_adjustments=True
            ),
            cl.ExactMatch("postal_code"),
            cl.ExactMatch("city"),
            cl.ExactMatch("entity_type"),
        ],
        blocking_rules_to_generate_predictions=[
            block_on("bn_root"),
            block_on("cleaned_name"),
            block_on("postal_code", 'substr("cleaned_name", 1, 4)'),
            block_on("city", 'substr("cleaned_name", 1, 5)'),
        ],
        retain_matching_columns=True,
        retain_intermediate_calculation_columns=False,
    )


def start_build(conn, args):
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO general.splink_build_metadata
          (started_at, splink_version, backend, threshold, config, status)
        VALUES (NOW(), %s, 'duckdb', %s, %s::jsonb, 'running')
        RETURNING id
    """, (SPLINK_VERSION, args.threshold, json.dumps({"seed": args.seed})))
    build_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    return build_id


def finish_build(conn, build_id, total_records, total_predictions, total_clusters, status="completed"):
    cur = conn.cursor()
    cur.execute("""
        UPDATE general.splink_build_metadata SET
          completed_at = NOW(),
          total_records = %s,
          total_predictions = %s,
          total_clusters = %s,
          status = %s
        WHERE id = %s
    """, (total_records, total_predictions, total_clusters, status, build_id))
    conn.commit()
    cur.close()


def write_predictions(conn, build_id, predictions_df, clusters_df):
    log("Writing predictions to Postgres...")
    cur = conn.cursor()

    # Clear any prior Splink state so repeat runs are clean.
    cur.execute("TRUNCATE general.splink_predictions, general.splink_aliases")

    # Build record_id -> cluster_id map.
    cluster_map = dict(zip(clusters_df["record_id"], clusters_df["cluster_id"]))

    # Prepare rows: split record_id "dataset:id" back into (dataset, id).
    def split_rid(rid):
        if not rid: return (None, None)
        if ":" in rid:
            ds, _, sid = rid.partition(":")
            return (ds, sid)
        return (None, rid)

    rows = []
    for _, r in predictions_df.iterrows():
        l = r.get("record_id_l") or r.get("unique_id_l")
        rr = r.get("record_id_r") or r.get("unique_id_r")
        if not l or not rr: continue
        ds_l, id_l = split_rid(l)
        ds_r, id_r = split_rid(rr)
        prob = float(r.get("match_probability") or 0)
        wt = float(r.get("match_weight") or 0)
        rows.append((
            ds_l, id_l, ds_r, id_r,
            prob, wt, json.dumps({}),
            cluster_map.get(l) or cluster_map.get(rr),
            build_id,
        ))

    if not rows:
        log("  No predictions to write.")
        cur.close()
        return 0

    execute_values(cur, """
        INSERT INTO general.splink_predictions
          (source_l, record_l, source_r, record_r, match_probability,
           match_weight, features, cluster_id, build_id)
        VALUES %s
    """, rows, page_size=5000)
    conn.commit()
    log(f"  Wrote {len(rows):,} pairwise predictions")
    cur.close()
    return len(rows)


def write_aliases(conn, build_id, clusters_df, records_df):
    """For each cluster, emit one splink_aliases row per distinct legal_name variant.

    This captures the fuzzy name matches Splink surfaces that our deterministic
    cascade doesn't. Downstream, 11-build-golden-records merges these into the
    golden record's alias list.
    """
    log("Writing per-cluster aliases...")
    # Join clusters -> records to pick up legal_name + source_dataset per member.
    merged = clusters_df.merge(records_df[["record_id", "legal_name", "source_dataset"]],
                               on="record_id", how="left")
    rows = []
    for _, r in merged.iterrows():
        cid = r["cluster_id"]
        nm = (r.get("legal_name") or "").strip()
        ds = r.get("source_dataset")
        rid = r["record_id"]
        sid = rid.split(":", 1)[1] if rid and ":" in rid else rid
        if nm:
            rows.append((str(cid), nm, ds, sid, 1.0, build_id))
    if not rows:
        return 0
    cur = conn.cursor()
    execute_values(cur, """
        INSERT INTO general.splink_aliases
          (cluster_id, alias, source_dataset, source_id, match_probability, build_id)
        VALUES %s ON CONFLICT DO NOTHING
    """, rows, page_size=5000)
    conn.commit()
    cur.close()
    log(f"  Wrote {len(rows):,} alias rows")
    return len(rows)


def main():
    args = parse_args()
    start = time.time()

    records_df = load_parquet()

    log("Initializing Splink with DuckDB backend...")
    duck = duckdb.connect(":memory:")
    duck.execute(f"SET memory_limit='{args.memory_limit}'")
    duck.execute("SET threads=4")
    duck.execute("SET preserve_insertion_order=false")
    tmp = DATA_DIR / "duckdb_tmp"; tmp.mkdir(exist_ok=True)
    duck.execute(f"SET temp_directory='{str(tmp).replace(os.sep, '/')}'")
    db_api = DuckDBAPI(connection=duck)

    settings = configure_splink()
    linker = Linker(records_df, settings, db_api=db_api)

    log("EM: u via random sampling...")
    linker.training.estimate_u_using_random_sampling(max_pairs=1_000_000)

    log("EM: parameters via expectation maximisation (bn_root block)...")
    try:
        linker.training.estimate_parameters_using_expectation_maximisation(
            block_on("bn_root"), fix_u_probabilities=False
        )
    except Exception as e:
        log(f"  EM(bn_root) failed: {e}")

    log("EM: parameters via expectation maximisation (cleaned_name block)...")
    try:
        linker.training.estimate_parameters_using_expectation_maximisation(
            block_on("cleaned_name"), fix_u_probabilities=False
        )
    except Exception as e:
        log(f"  EM(cleaned_name) failed: {e}")

    log(f"Predicting matches (threshold >= {args.threshold})...")
    predictions = linker.inference.predict(threshold_match_probability=args.threshold)
    predictions_df = predictions.as_pandas_dataframe()
    log(f"  {len(predictions_df):,} pairwise predictions")

    log(f"Clustering at threshold {args.threshold}...")
    clusters = linker.clustering.cluster_pairwise_predictions_at_threshold(
        predictions, threshold_match_probability=args.threshold
    )
    clusters_df = clusters.as_pandas_dataframe()
    n_clusters = clusters_df["cluster_id"].nunique()
    log(f"  {n_clusters:,} clusters")

    pg = pg_connect()
    try:
        build_id = start_build(pg, args)
        log(f"Build id: {build_id}")
        n_pred = write_predictions(pg, build_id, predictions_df, clusters_df)
        write_aliases(pg, build_id, clusters_df, records_df)
        finish_build(pg, build_id, len(records_df), n_pred, n_clusters)
    except Exception:
        try: finish_build(pg, build_id, 0, 0, 0, status="failed")
        except Exception: pass
        raise
    finally:
        pg.close()

    log(f"\n=== Done in {time.time() - start:.0f}s ===")


if __name__ == "__main__":
    main()
