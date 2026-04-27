# Challenge 1 Registry Source Ingestion

This loader collects official registry/status sources for Challenge 1
(`Zombie Recipients`) and loads the federal corporation baseline into BigQuery.

The purpose is to separate two ideas:

- **Funding disappearance**: a recipient is last seen in funding records before a cutoff.
- **Registry inactivity**: an official registry reports an inactive, discontinued,
  amalgamated, dissolution-pending, or dissolved status.

Challenge 1 should not claim registry inactivity unless it joins to these tables.

## BigQuery Tables

Default dataset: `accountibilitymax_raw`.

- `c1_registry_source_registry`
- `c1_federal_corporation_status_codes`
- `c1_federal_corporations_raw`

## Commands

From `backend/general`:

```powershell
npm run c1:registry:metadata
```

Download, parse, and load the federal corporation registry data:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:GOOGLE_CLOUD_PROJECT = "my-project-45978-resume"
$env:BIGQUERY_DATASET = "accountibilitymax_raw"
$env:BIGQUERY_LOCATION = "northamerica-northeast1"
npm run c1:registry:load
```

## Sources

Loaded:

- Federal Corporations open dataset:
  `https://open.canada.ca/data/en/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2`
- Corporations Canada open data ZIP:
  `https://ised-isde.canada.ca/cc/lgcy/download/OPEN_DATA_SPLIT.zip`

Registered for citation/follow-up:

- Corporations Canada search and glossary/status definitions
- Canada's Business Registries federated search
- CRA charity status/search/bulk listing pages
- CRA business number guidance
- Federal annual filing/API pages
- Alberta registry and annual return context

## Safety Notes

- Downloaded ZIP/XML/CSV outputs are ignored by Git:
  `backend/general/data/c1-registry/`
- The federal registry table is not a complete Canada-wide registry. It is a
  strong national baseline for federally incorporated entities.
- CRA charity and Alberta bulk status data are not loaded in this pass; those
  remain citation/follow-up sources.
