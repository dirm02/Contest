# Challenge 7 Policy Source Ingestion

This loader collects official source links and structured public datasets for
Challenge 7 policy alignment review:

> Is money going where government says its priorities are?

It loads structured CSV/ZIP resources into BigQuery raw tables and writes a
source registry table for official citation/context pages. The registry is
important because some priority statements are HTML pages, while the measurable
evidence lives in structured tables.

## Sources Loaded

Raw tables created by this loader:

- `c7_policy_source_registry`
- `c7_mandate_letter_commitments_2015_2019_raw`
- `c7_cmhc_housing_starts_cma_monthly_raw`
- `c7_cmhc_housing_starts_quarterly_raw`
- `c7_health_chronic_disease_indicators_raw`

The registry also records official source links that are citation-only or need a
follow-up parser, including Budget 2024 priority chapters, Departmental Plan
entry points, GC InfoBase records, housing-plan pages, ECCC climate data-mart
records, and infrastructure records already loaded for Challenge 8B.

## Commands

From `backend/general`:

```powershell
npm run c7:policy:metadata
```

Download and load the structured sources into BigQuery:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:GOOGLE_CLOUD_PROJECT = "my-project-45978-resume"
$env:BIGQUERY_DATASET = "accountibilitymax_raw"
$env:BIGQUERY_LOCATION = "northamerica-northeast1"
npm run c7:policy:load
```

## Safety Notes

- Downloaded files are ignored by Git:
  `backend/general/data/c7-policy/raw/`
- Credentials stay in `.env`, shell environment, or Azure VM secrets.
- Do not treat registry-only pages as parsed data. They are official source
  links/citations until a targeted parser extracts structured fields.
