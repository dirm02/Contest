# Architecture

## System Overview

```
                    ┌─────────────────────────────────┐
                    │   Government of Canada           │
                    │   Open Data Portal (CKAN API)    │
                    │   open.canada.ca                 │
                    └──────────┬──────────────────────┘
                               │ HTTPS GET (paginated)
                               │ 10,000 records/page
                               │ 5 retries + exponential backoff
                               ▼
┌──────────────────────────────────────────────────────┐
│  03-fetch-data.js                                    │
│  Fetches 2020-2024 data from CKAN datastore API      │
│  93 datasets across 5 fiscal years                   │
│  Paginates, retries, caches to local JSON            │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│  Local Cache: data/cache/{year}/{dataset}.json        │
│                                                      │
│  2020/  (19 files)                                   │
│  2021/  (18 files — no disbursement_quota)            │
│  2022/  (18 files — no disbursement_quota)            │
│  2023/  (19 files)                                   │
│  2024/  (19 files)                                   │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│  04-import-data.js                                   │
│                                                      │
│  19 typed importers for all datasets                 │
│  Batch INSERT (1,000 rows/batch)                     │
│  ON CONFLICT DO NOTHING (idempotent)                 │
│  Data transformers: Y/N→boolean, decimals,           │
│    dates, province/country code validation            │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│  PostgreSQL (Render)                                  │
│                                                      │
│  cra schema:                                         │
│    6 lookup tables     (620 reference rows)          │
│    19 data tables      (7,338,550 rows)              │
│    10 analysis tables  (loop detection, SCC, etc.)   │
│    3 analytical views                                │
│  Full-text search indexes (GIN)                      │
│  B-tree indexes on all foreign keys                  │
└──────────────────────────────────────────────────────┘
```

## Data Pipeline

All 5 fiscal years (2020-2024) use the same loading pathway via the Government of Canada Open Data API.

```
config/dataset-inventory.json (UUID registry: 93 dataset/year combinations)
    → config/datasets.js (runtime loader)
        → lib/api-client.js (HTTPS + pagination + retry + cache)
            → data/cache/{year}/{dataset}.json
                → scripts/04-import-data.js (19 typed importers)
                    → PostgreSQL
```

**Key characteristics:**
- UUIDs in `config/dataset-inventory.json` identify each dataset on the CKAN API
- Pagination at 10,000 records per page
- Automatic retry (5 attempts, exponential backoff: 2s, 4s, 8s, 16s, 32s)
- JSON cache files store raw API responses for re-import without re-fetching
- Column names match API field names (e.g., `BN`, `FPE`, `Form ID`)
- Import handles field name variants across years (e.g., `Program #1 Code` vs `Program Area 1`)

## Schema Design Decisions

### Multi-Year Support
- `cra_identification` and `cra_web_urls` use `(bn, fiscal_year)` as PK because these datasets have no FPE field
- All other tables use `(bn, fpe, ...)` which naturally supports multi-year via the fiscal period end date
- Additive schema: columns from all form versions (23-27) are present; unused fields are NULL

### Unified Migration
- `01-migrate.js` creates everything: cra schema, 6 lookup tables, 19 data tables, 10 analysis tables, 3 views
- 2024-specific columns (donor advised funds, impact investments) included in the base CREATE TABLE
- Analysis tables (loops, SCC, partitioned cycles, etc.) created alongside data tables
- Financial columns use DECIMAL(18,2) to accommodate outlier values in source data

### Idempotency
Every operation is safe to re-run:
- `01-migrate.js`: CREATE SCHEMA/TABLE IF NOT EXISTS
- `02-seed-codes.js`: INSERT ON CONFLICT DO UPDATE
- `04-import-data.js`: INSERT ON CONFLICT DO NOTHING

### Batch Processing
- All imports use 1,000-row batches
- Each batch is a single INSERT ... VALUES (...),(...),... statement
- Progress logged every 10,000 rows
- Skipped rows counted and reported

## File Organization

```
CRA/
├── config/
│   ├── dataset-inventory.json  # UUID registry (source of truth for all 93 datasets)
│   └── datasets.js             # Runtime loader for inventory
├── lib/
│   ├── db.js                   # PostgreSQL pool (.env → .env.public fallback, search_path=cra)
│   ├── api-client.js           # CKAN API client (fetch, paginate, retry, cache)
│   ├── transformers.js         # Type converters (Y/N, dates, decimals, codes)
│   └── logger.js               # Timestamped console output
├── scripts/
│   ├── 01-migrate.js           # Schema + all tables (lookup, data, analysis) + views
│   ├── 02-seed-codes.js        # Lookup data (620 rows)
│   ├── 03-fetch-data.js        # API download (2020-2024)
│   ├── 04-import-data.js       # Import cached JSON to database
│   ├── 05-verify.js            # 195 verification checks
│   ├── drop-tables.js          # Drop all tables (destructive)
│   ├── clear-cache.js          # Delete cached API data
│   ├── download-data.js        # Export tables as CSV/JSON
│   ├── create-readonly-user.js # Create read-only DB user
│   └── revoke-readonly-user.js # Revoke read-only user
├── scripts/advanced/
│   ├── 01-detect-all-loops.js  # Brute-force 2-6 hop cycle detection
│   ├── 02-score-universe.js    # Deterministic 0-30 risk scoring
│   ├── 03-scc-decomposition.js # Tarjan SCC decomposition
│   ├── 04-matrix-power-census.js # Walk census (cross-validation)
│   ├── 05-partitioned-cycles.js  # SCC-partitioned Johnson's
│   ├── 06-johnson-cycles.js      # Johnson's algorithm (cross-validation)
│   ├── lookup-charity.js         # Interactive network lookup
│   └── risk-report.js            # Interactive risk report
├── data/
│   ├── cache/                  # All source data (JSON) by year
│   ├── downloads/              # Exported CSV/JSON (gitignored)
│   ├── reports/                # Analysis reports (gitignored)
│   └── 5 Year Inventory.xlsx   # UUID lookup spreadsheet
├── tests/
│   ├── unit/                   # 54 tests (no DB required)
│   └── integration/            # Schema + row count + quality checks
└── docs/
    ├── ARCHITECTURE.md         # This file
    ├── DATA_DICTIONARY.md      # Complete field reference
    ├── SAMPLE_QUERIES.sql      # Ready-to-run analytical queries
    └── guides-forms/           # Authoritative CRA source documents
```
