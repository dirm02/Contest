# Challenge 9 Procurement Ingestion

This folder contains the official-data loader for Challenge 9. It uses Open Government / CanadaBuys downloadable CSV resources and loads them into BigQuery raw tables. It is not a web scraper.

## Sources

Initial v1 sources:

- Federal contracts over $10K: `d8f85d91-7dec-4fd1-8055-483b77225d8b`
- CanadaBuys award notices: `a1acb126-9ce8-40a9-b889-5da2b1dd20cb`
- CanadaBuys contract history: `4fe645a1-ffcd-40c1-9385-2c771be956a4`
- Standing Offers and Supply Arrangements: `f5c8a5a0-354d-455a-99ab-8276aa38032e`

The loader resolves resource URLs dynamically from the CKAN API so it follows refreshed files without hard-coding download URLs.

## Commands

From `backend/general`:

```powershell
npm run c9:procurement:metadata
```

Writes metadata only to:

```text
backend/general/data/c9-procurement/manifest.json
```

Download and load all v1 CSVs into BigQuery:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:GOOGLE_CLOUD_PROJECT = "my-project-45978-resume"
$env:BIGQUERY_DATASET = "accountibilitymax_raw"
$env:BIGQUERY_LOCATION = "northamerica-northeast1"
npm run c9:procurement:load
```

Load one source first:

```powershell
node scripts/c9-ingest/procurement-loader.js --source contracts10k --download --load --create-views
```

## BigQuery Tables

Default dataset: `accountibilitymax_raw`.

Raw tables:

- `c9_contracts_10k_raw`
- `c9_canadabuys_award_notices_raw`
- `c9_canadabuys_contract_history_raw`
- `c9_sosa_raw`

Helper view:

- `c9_contracts_10k_normalized`

## Safety Rules

- Downloaded CSVs are local runtime data and ignored by Git:
  `backend/general/data/c9-procurement/raw/`
- Credentials stay in `.env`, shell environment, or Azure VM secrets. Do not commit them.
- Use raw tables first. Build Challenge 9 analytics from normalized views after row counts and key fields are validated.
- Keep wording honest:
  - contracts data = procurement-grade
  - CanadaBuys history/awards = procurement lifecycle context
  - grants/contributions = proxy-grade only
  - unit price claims require real quantity/unit fields

## Next Analytics Step

After raw loads:

1. Check row counts and date ranges.
2. Build a canonical procurement fact table.
3. Join contract/amendment lifecycle by procurement/contract ID where possible.
4. Add CPI deflation.
5. Recompute Challenge 9 with procurement-grade rows separated from proxy-grade rows.
