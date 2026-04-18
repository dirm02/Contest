# Local Database Recreation Kit

This directory contains everything needed to recreate the AI For Accountability hackathon database in your own PostgreSQL instance.

## Contents

```
.local-db/
├── README.md           # This file
├── export.js           # Export script (for maintainers regenerating the dataset)
├── import.js           # Import script (for participants setting up locally)
├── manifest.json       # Table inventory with row counts
├── schemas/            # DDL (CREATE TABLE, INDEX, VIEW)
│   ├── cra.sql
│   ├── fed.sql
│   ├── ab.sql
│   └── general.sql
└── data/               # CSV data files (one per table, with headers)
    ├── cra/
    ├── fed/
    ├── ab/
    └── general/
```

## Quick Start

### Prerequisites

- **PostgreSQL 14+** running locally or on a server you control
- **Node.js 18+**
- A PostgreSQL database with a user that has CREATE and INSERT privileges

### 1. Create a database

```sql
CREATE DATABASE hackathon;
```

### 2. Install dependencies

```bash
cd .local-db
npm install
```

### 3. Set your connection string

Create a `.env` file in this directory:

```
DB_CONNECTION_STRING=postgresql://your_user:your_password@localhost:5432/hackathon
```

### 4. Run the import

```bash
# Full import (DDL + data for all 4 schemas)
npm run import

# Import just one schema
node import.js --schema cra

# Import DDL only (no data)
node import.js --schema-only

# Drop and recreate (if re-importing)
node import.js --drop
```

The import creates all schemas, tables, indexes, and views, then loads CSV data using batch INSERTs with `ON CONFLICT DO NOTHING` for idempotency.

### 5. Verify

After import, the script runs automatic row-count verification against the manifest. You can also verify manually:

```sql
SELECT schemaname, COUNT(*) AS tables
FROM pg_tables
WHERE schemaname IN ('cra', 'fed', 'ab', 'general')
GROUP BY schemaname ORDER BY schemaname;
```

## Alternative: psql bulk import (faster)

If you have `psql` available, you can import the DDL and data directly for better performance:

```bash
# Apply all DDL
for f in schemas/*.sql; do psql -d hackathon -f "$f"; done

# Load CSV data (much faster than batch INSERT)
for schema in cra fed ab general; do
  for csv in data/$schema/*.csv; do
    table=$(basename "$csv" .csv)
    psql -d hackathon -c "\copy $schema.$table FROM '$csv' WITH (FORMAT CSV, HEADER true, NULL '')"
  done
done
```

## Dataset Summary

| Schema | Tables + views | Approx rows | Description |
|--------|----------------|-------------|-------------|
| `cra` | 52 tables + 3 views | ~14M | CRA T3010 charity filings (2020-2024), plus accountability-analysis tables (loop detection, SCC decomposition, overhead/government-funding rollups, T3010 violation flags, donee-quality scoring) |
| `fed` | 6 tables + 3 views | ~1.3M | Federal grants and contributions |
| `ab` | 9 tables + 3 views | ~2.4M | Alberta grants, contracts, sole-source, non-profit registry |
| `general` | 13 tables + 2 views | ~6M | **Cross-dataset entity resolution pipeline output**, including `entities` (golden records), `entity_source_links`, `entity_golden_records` (final compiled table), `entity_merge_candidates`, `entity_merges`, and the Splink probabilistic-matching tables (`splink_predictions`, `splink_aliases`, `splink_build_metadata`). Also 27-row `ministries` reference table. See `/general/README.md` for the full pipeline. |

Both `export.js` and `import.js` auto-discover tables via `information_schema` — no code change is needed when new tables are added to any schema. A re-run regenerates the manifest and CSVs automatically.

## Import Options

| Flag | Description |
|------|-------------|
| `--schema cra` | Import only one schema |
| `--schema-only` | Apply DDL without loading data |
| `--data-only` | Load data only (tables must already exist) |
| `--batch-size 5000` | Rows per INSERT (default: 5000, lower = less memory) |
| `--drop` | Drop and recreate schemas before import (destructive) |

## Re-exporting (for maintainers)

To regenerate the export from the live database:

```bash
DB_CONNECTION_STRING=postgresql://admin:pass@host:5432/db npm run export
```

This overwrites `schemas/`, `data/`, and `manifest.json` with fresh data.

## Data Licensing

- **Code**: MIT License (Government of Alberta)
- **CRA Data**: [Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada)
- **Federal Data**: [Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada)
- **Alberta Data**: [Open Government Licence - Alberta](https://open.alberta.ca/licence)
