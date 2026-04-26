#!/usr/bin/env python3
"""
Export source data from Postgres to parquet files for Splink.

Reads from our Render PG via DB_CONNECTION_STRING (in general/.env or .env.public).
Writes 6 parquet files (one per source dataset) with a standardized schema:
  record_id, source_dataset, legal_name, cleaned_name, bn_root,
  postal_code, city, province, entity_type

The preprocessing (clean_name + bn_root) matches general.norm_name and
general.is_valid_bn_root in the Postgres side, so Splink and the rest of the
pipeline normalize entity names and BN identifiers the same way.

Usage: python splink/export_source_data.py
"""

import os
import sys
import hashlib
from pathlib import Path

# Force UTF-8 stdout — Windows consoles default to cp1252 which breaks on
# em-dashes and other Unicode characters in log messages.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import psycopg2
import pyarrow as pa
import pyarrow.parquet as pq

# ---------------------------------------------------------------------------
# Environment loading: mirror lib/db.js — .env.public first, .env overrides.
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
for env_file in [ROOT / ".env.public", ROOT / ".env"]:
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                os.environ[key.strip()] = val.strip().strip('"').strip("'")

try:
    from cleanco import basename
except ImportError:
    print("[export] WARNING: cleanco not installed. Legal-suffix stripping disabled.")
    def basename(name):
        return name

DB_URL = os.environ.get("DB_CONNECTION_STRING", "")
if not DB_URL:
    print("[export] ERROR: DB_CONNECTION_STRING not set", flush=True)
    sys.exit(1)

OUT_DIR = HERE / "data"
OUT_DIR.mkdir(exist_ok=True)


def connect():
    kwargs = {}
    if "render.com" in DB_URL:
        kwargs["sslmode"] = "require"
    return psycopg2.connect(DB_URL, **kwargs)


# ---------------------------------------------------------------------------
# Name cleaning — must stay in sync with general.norm_name() in norm_name.sql.
# Strips trade-name / operational tails (TRADE NAME OF, O/A, DBA, AKA, FORMERLY),
# bilingual halves (split on " | ", " / "), uppercases, collapses whitespace.
# cleanco additionally strips legal suffixes (Inc, Ltd, Foundation, Société) so
# Splink's JaroWinkler sees the core legal-entity stem.
# ---------------------------------------------------------------------------
import re as _re

_NOISE_SUFFIX_RE = _re.compile(
    r"\s*\b(?:"
    r"ASSUMED(?:\s+NAME(?:\s+.*)?)?"
    r"|AKA(?:\s+.*)?"
    r"|O\s*/\s*A(?:\s+.*)?"
    r"|D\s*/\s*B\s*/\s*A(?:\s+.*)?"
    r"|DBA(?:\s+.*)?"
    r"|DOING\s+BUSINESS\s+AS(?:\s+.*)?"
    r"|OPERATING\s+AS(?:\s+.*)?"
    r"|TRADING\s+AS(?:\s+.*)?"
    r"|TRADE\s+NAME\s+OF(?:\s+.*)?"
    r"|FORMERLY(?:\s+.*)?"
    r"|F\s*/\s*K\s*/\s*A(?:\s+.*)?"
    r")$",
    _re.IGNORECASE,
)


def clean_name(name):
    if not name:
        return ""
    s = name
    for sep in [" │ ", " | ", "│", " / "]:
        if sep in s:
            parts = [p.strip() for p in s.split(sep)]
            if len(parts) >= 2:
                s = parts[0]
                break
    s = _NOISE_SUFFIX_RE.sub("", s).strip()
    cleaned = basename(s) or s
    out = cleaned.strip().upper()
    out = _re.sub(r"\s+", " ", out)
    return out


# ---------------------------------------------------------------------------
# BN root extraction — must match general.is_valid_bn_root() in bn_helpers.sql.
# ---------------------------------------------------------------------------
_PLACEHOLDER_BNS = {
    "000000000", "100000000", "200000000", "300000000", "400000000",
    "500000000", "600000000", "700000000", "800000000", "900000000",
    "320000000",
}


def bn_root(bn):
    if not bn:
        return None
    digits = "".join(c for c in str(bn) if c.isdigit())
    if len(digits) < 9:
        return None
    root = digits[:9]
    if root in _PLACEHOLDER_BNS:
        return None
    if root.endswith("00000000"):
        return None
    return root


def make_id(dataset, *parts):
    raw = f"{dataset}:{'::'.join(str(p) for p in parts if p)}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]


def export_table(conn, name, query, transform, out_file):
    print(f"[export] Exporting {name}...", flush=True)
    cur = conn.cursor()
    cur.execute(query)
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    cur.close()

    records = []
    for row in rows:
        rec = transform(dict(zip(cols, row)))
        if rec and rec.get("legal_name"):
            records.append(rec)

    if not records:
        print(f"[export]   {name}: 0 records — skipping", flush=True)
        return 0

    schema = [
        ("record_id", pa.string()),
        ("source_dataset", pa.string()),
        ("legal_name", pa.string()),
        ("cleaned_name", pa.string()),
        ("bn_root", pa.string()),
        ("postal_code", pa.string()),
        ("city", pa.string()),
        ("province", pa.string()),
        ("entity_type", pa.string()),
    ]
    arrays = {k: [r.get(k) for r in records] for k, _ in schema}
    table = pa.table({k: pa.array(arrays[k], type=t) for k, t in schema})
    pq.write_table(table, OUT_DIR / out_file)
    print(f"[export]   {name}: {len(records):,} records -> {out_file}", flush=True)
    return len(records)


def main():
    print("[export] Connecting to database...", flush=True)
    conn = connect()

    total = 0
    total += export_table(
        conn, "FED grants_contributions",
        """
        SELECT recipient_business_number AS bn,
               recipient_legal_name AS legal_name,
               recipient_type AS entity_type,
               MAX(recipient_postal_code) AS postal_code,
               MAX(recipient_city) AS city,
               MAX(recipient_province) AS province
        FROM fed.grants_contributions
        WHERE recipient_legal_name IS NOT NULL AND is_amendment = false
        GROUP BY recipient_business_number, recipient_legal_name, recipient_type
        """,
        lambda r: {
            "record_id": make_id("fed", r["bn"], r["legal_name"]),
            "source_dataset": "fed",
            "legal_name": r["legal_name"],
            "cleaned_name": clean_name(r["legal_name"]),
            "bn_root": bn_root(r["bn"]),
            "postal_code": (r.get("postal_code") or "").strip().upper().replace(" ", "") or None,
            "city": (r.get("city") or "").strip().upper() or None,
            "province": (r.get("province") or "").strip().upper() or None,
            "entity_type": r.get("entity_type"),
        },
        "fed.parquet",
    )

    total += export_table(
        conn, "CRA cra_identification",
        """
        SELECT DISTINCT ON (bn)
               bn, legal_name, designation, postal_code, city, province
        FROM cra.cra_identification
        WHERE legal_name IS NOT NULL
        ORDER BY bn, fiscal_year DESC
        """,
        lambda r: {
            "record_id": r["bn"],
            "source_dataset": "cra",
            "legal_name": r["legal_name"],
            "cleaned_name": clean_name(r["legal_name"]),
            "bn_root": bn_root(r["bn"]),
            "postal_code": (r.get("postal_code") or "").strip().upper().replace(" ", "") or None,
            "city": (r.get("city") or "").strip().upper() or None,
            "province": (r.get("province") or "").strip().upper() or None,
            "entity_type": r.get("designation"),
        },
        "cra.parquet",
    )

    total += export_table(
        conn, "AB ab_non_profit",
        "SELECT id, legal_name, type, status, postal_code, city FROM ab.ab_non_profit WHERE legal_name IS NOT NULL",
        lambda r: {
            "record_id": str(r["id"]),
            "source_dataset": "ab_non_profit",
            "legal_name": r["legal_name"],
            "cleaned_name": clean_name(r["legal_name"]),
            "bn_root": None,
            "postal_code": (r.get("postal_code") or "").strip().upper().replace(" ", "") or None,
            "city": (r.get("city") or "").strip().upper() or None,
            "province": "AB",
            "entity_type": r.get("type"),
        },
        "ab_non_profit.parquet",
    )

    total += export_table(
        conn, "AB ab_grants",
        "SELECT DISTINCT recipient FROM ab.ab_grants WHERE recipient IS NOT NULL",
        lambda r: {
            "record_id": make_id("ab_grants", r["recipient"]),
            "source_dataset": "ab_grants",
            "legal_name": r["recipient"],
            "cleaned_name": clean_name(r["recipient"]),
            "bn_root": None, "postal_code": None, "city": None,
            "province": "AB", "entity_type": None,
        },
        "ab_grants.parquet",
    )

    total += export_table(
        conn, "AB ab_contracts",
        "SELECT DISTINCT recipient FROM ab.ab_contracts WHERE recipient IS NOT NULL",
        lambda r: {
            "record_id": make_id("ab_contracts", r["recipient"]),
            "source_dataset": "ab_contracts",
            "legal_name": r["recipient"],
            "cleaned_name": clean_name(r["recipient"]),
            "bn_root": None, "postal_code": None, "city": None,
            "province": "AB", "entity_type": None,
        },
        "ab_contracts.parquet",
    )

    total += export_table(
        conn, "AB ab_sole_source",
        """
        SELECT DISTINCT ON (vendor)
               vendor, vendor_postal_code, vendor_city, vendor_province
        FROM ab.ab_sole_source
        WHERE vendor IS NOT NULL
        ORDER BY vendor
        """,
        lambda r: {
            "record_id": make_id("ab_sole_source", r["vendor"]),
            "source_dataset": "ab_sole_source",
            "legal_name": r["vendor"],
            "cleaned_name": clean_name(r["vendor"]),
            "bn_root": None,
            "postal_code": (r.get("vendor_postal_code") or "").strip().upper().replace(" ", "") or None,
            "city": (r.get("vendor_city") or "").strip().upper() or None,
            "province": (r.get("vendor_province") or "AB").strip().upper() or "AB",
            "entity_type": None,
        },
        "ab_sole_source.parquet",
    )

    conn.close()
    print(f"\n[export] === Complete — {total:,} records exported to {OUT_DIR} ===", flush=True)


if __name__ == "__main__":
    main()
