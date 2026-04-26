# Alberta Open Data Pipeline

Part of the **AI For Accountability Hackathon** suite, alongside the [CRA T3010](../CRA/) and [Federal Grants](../FED/) pipelines.

## Datasets

| Dataset | Source | Records | Format |
|---------|--------|---------|--------|
| **Alberta Grants** | Alberta Open Data Portal | 1,986,676 | JSON (MongoDB export) + CSV disclosures |
| **Contracts (Blue Book)** | Alberta Blue Book | 67,079 | Excel |
| **Sole-Source Contracts** | Alberta Procurement | 15,533 | Excel |
| **Non-Profit Registry** | Alberta Corporate Registry | 69,271 | Excel |

All data lives in the `ab` schema of the shared PostgreSQL database, completely isolated from the `cra` and `fed` schemas. Grants cover fiscal years **2014-2015 through 2025-2026** (12 years). Fiscal 2024-2025 (139,816 rows, $47.08B) and 2025-2026 (180,468 rows, $50.22B) are sourced from TBF CSV disclosures loaded via `scripts/08-import-grants-csv.js`; earlier years come from the MongoDB JSON export.

## Quick Start

```bash
# Install dependencies
npm install

# Run the full pipeline (migrate, seed, import all, verify)
npm run setup

# Or run individual steps:
npm run migrate             # Create schema and tables
npm run seed                # Load lookup tables
npm run import:grants       # Import grants JSON (~5-10 min for 1.1GB file)
npm run import:grants-csv   # Import fiscal 2024-25 + 2025-26 TBF CSV disclosures
npm run import:contracts    # Import Blue Book contracts
npm run import:sole-source  # Import sole-source contracts
npm run import:non-profit   # Import non-profit registry
npm run verify              # Run verification checks
```

## Configuration

The pipeline uses the same database as CRA and FED:

- `.env` - Admin credentials (gitignored)
- `.env.public` - Read-only credentials (committed, for hackathon participants)

## Testing

```bash
npm run test:unit         # 37 unit tests (transformers, no DB needed)
npm run test:integration  # Schema + data quality checks (needs DB)
npm test                  # All tests
```

## Architecture

Follows the same patterns as the CRA and FED pipelines:
- Numbered scripts (`01-migrate.js` through `07-verify.js`)
- Shared `lib/` for database, logging, and data transformers
- Batch-based imports with progress tracking
- Idempotent operations (safe to re-run)
- Comprehensive verification with source-vs-DB row count checks

## Data Notes

- **Fiscal years** use "YYYY - YYYY" format with spaces (e.g., "2024 - 2025"); grants cover "2014 - 2015" through "2025 - 2026"
- **Negative grant amounts** are reversals/corrections
- The main grants JSON file is **1.1GB** and uses a streaming parser
- Fiscal 2024-2025 and 2025-2026 grants come from TBF disclosure CSVs; `config/grants-csv-crosswalk.json` defines the header-to-column mapping
- Non-profit registry dates go back to **1979**
- Sole-source dates are in M/D/YYYY format (parsed automatically)
