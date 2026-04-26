# Challenge 8B Policy / Outcome Source Ingestion

This loader collects official source data that can support Challenge 8B gap analysis:
where governments claim a priority, where spending appears, and where comparable
outcome or project data exists.

It is an official-data ingestion pipeline, not a crawler. CSV resources are loaded
to BigQuery raw tables. HTML, ZIP, and PDF resources are recorded in the manifest
for follow-up parsers.

## Sources

Initial v1 loadable CSV sources:

- GC InfoBase Open Datasets: `a35cf382-690c-4221-a971-cf0fd189a46f`
- GC InfoBase Departmental Plans and Results Reports: `b15ee8d7-2ac0-4656-8330-6c60d085cda8`
- Infrastructure Canada Projects: `beee0771-dab9-4be8-9b80-f8e8b3fdfd9d`
- Infrastructure Canada Transfer Program Allocations: `9401f5c7-0787-4261-a99d-ac78c970b73e`

Manifest-only sources included for later targeted extraction:

- CMHC Housing Market Information Portal: `c2a1fdbf-d9b7-4c84-b7eb-c845b6ffd5e6`
- Health Infobase: `32570fdc-6d31-45cd-8e1d-5d9e0af8e268`
- Canada's Core Infrastructure Cost Dataset: `c7fa5905-3115-45ad-ab7d-48a85700255a`

## Commands

From `backend/general`:

```powershell
npm run c8b:policy:metadata
```

Download and load the loadable CSV sources into BigQuery:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
$env:GOOGLE_CLOUD_PROJECT = "my-project-45978-resume"
$env:BIGQUERY_DATASET = "accountibilitymax_raw"
$env:BIGQUERY_LOCATION = "northamerica-northeast1"
npm run c8b:policy:load
```

Download every manifest source, including HTML/ZIP metadata sources:

```powershell
node scripts/c8b-ingest/policy-loader.js --source all --download
```

## BigQuery Tables

Default dataset: `accountibilitymax_raw`.

Raw tables:

- `c8b_gcinfobase_transfer_payments_en_raw`
- `c8b_gcinfobase_program_spending_en_raw`
- `c8b_gcinfobase_performance_info_en_raw`
- `c8b_departmental_plan_program_spending_en_raw`
- `c8b_departmental_plan_performance_info_en_raw`
- `c8b_infrastructure_projects_raw`
- `c8b_infrastructure_projects_forecast_en_raw`
- `c8b_infrastructure_transfer_programs_raw`

## Safety Notes

- Downloaded files are ignored by Git:
  `backend/general/data/c8b-policy/raw/`
- Credentials stay in `.env`, shell environment, or Azure VM secrets.
- Do not use these raw tables to claim a policy gap directly. They are source
  inputs for a later, explicit taxonomy and target/outcome mapping pass.
