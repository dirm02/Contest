<div align="center">
  <img src="public/Maple%20DOGE.png" alt="Maple DOGE logo" width="160" />

  <h1>Maple DOGE</h1>

  <p>
    A proof-of-concept OSINT app for Canadian public spending, procurement,
    charity, registry, governance, policy, and adverse-media data.
  </p>

  <p>
    <img alt="React" src="https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white" />
    <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white" />
    <img alt="Azure VM" src="https://img.shields.io/badge/Azure-VM-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white" />
    <img alt="GCP BigQuery" src="https://img.shields.io/badge/GCP-BigQuery-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white" />
  </p>
</div>

---

## Project Summary

Maple DOGE turns fragmented public-sector datasets into evidence-backed investigation modules.

The app connects entity search, dossiers, ranked watchlists, procurement analytics, policy-gap review, graph exploration, adverse-media context, and a human-in-the-loop review workflow. The goal is not to make automatic enforcement decisions. The goal is to help a reviewer understand which public-spending cases deserve attention first and why.

## System Architecture

```mermaid
flowchart LR
  UI["React + Vite frontend"]
  VM["Azure VM web server"]
  API["Node/Express API"]
  PG["Postgres source/serving data"]
  BQ["GCP BigQuery analytics"]
  EXT["Official public datasets"]

  EXT --> BQ
  EXT --> PG
  UI --> VM
  VM --> API
  API --> PG
  API --> BQ
```

| Layer | What We Built |
| --- | --- |
| Frontend | React, Vite, TypeScript, Recharts, XYFlow, Lucide icons |
| Backend API | Node/Express API in `backend/general/visualizations/server.js` |
| Hosting | Azure VM serving static frontend and API routing |
| Analytical warehouse | GCP BigQuery for heavier challenge tables and validation |
| Source/serving data | Postgres-backed entity, funding, charity, registry, governance, and graph data |
| Deployment | `deploy/` scripts sync `dist/` and backend server code to the VM |

## What The App Contains

| Area | Built Feature |
| --- | --- |
| Entity search | Search-first entry point for organizations, charities, companies, vendors, and people |
| Dossiers | Source coverage, funding context, related records, graph context, and challenge signals |
| Investigation Panel | One hub for the challenge modules instead of crowded header navigation |
| Graphs | XYFlow relationship graphs for loops, governance, and entity context |
| Procurement analytics | Amendment creep, sole-source follow-on, vendor concentration, contract trend views |
| Policy analytics | Spending/priority alignment and priority-gap review |
| Human review | Challenge 1 review queue, case workspace, score explanation, advisory actions, brief, and outcomes |
| External context | Backend adverse-media scan using Google News RSS and NewsAPI |

## Challenge Coverage

| # | Challenge | What We Built | Maturity |
| --- | --- | --- | --- |
| 1 | Zombie Recipients | Registry-backed recipient review, BN-root matching, funding-disappearance fallback, review queue, case workspace | End-to-end PoC workflow |
| 2 | Ghost Capacity | No-BN, sparse-award, high-average-award, and multi-department capacity signals | Live investigation module |
| 3 | Funding Loops | CRA loop detection with participants, hops, bottlenecks, flow totals, and graph views | Live graph module |
| 4 | Sole Source and Amendment Creep | Federal original/current amendment logic plus Alberta competitive-to-sole-source follow-on matching | Live procurement module |
| 5 | Vendor Concentration | BigQuery HHI, CR4, top share, effective competitors, invariant-checked concentration results | Live analytical module |
| 6 | Governance Networks | Shared-director normalization, organization-pair discovery, person/entity graph views | Live graph module |
| 7 | Policy Alignment | BigQuery review rows comparing priorities, planned/actual values, targets, and results | Live analytical module |
| 8 | Duplicative Funding and Gaps | 8A overlapping public funding streams; 8B priority-gap and infrastructure-delay review | Live analytical module |
| 9 | Contract Intelligence | Procurement-grade trend decomposition, amendment contribution, concentration context | Live analytical module |
| 10 | Adverse Media | Backend RSS/NewsAPI scanner with failure handling and deduped adverse-media context | Live contextual module |

## Challenge Methods

### 1. Zombie Recipients

Built the strongest full workflow in the PoC.

- Matched funding recipients to registry status using business number roots.
- Separated registry-backed cases from lower-confidence funding-only fallback cases.
- Added score bands, caveats, source context, advisory actions, action briefs, and outcome tracking.

### 2. Ghost Capacity

- Flagged recipients with weak capacity signals.
- Used missing BN, sparse grants, high average award value, and multi-department patterns.
- Added recipient detail pages for evidence review.

### 3. Funding Loops

- Detected circular giving/funding paths using CRA relationship data.
- Ranked loops by hop count, participant count, bottleneck, and flow value.
- Rendered loop paths as graph evidence.

### 4. Sole Source and Amendment Creep

- Compared original federal agreement values to latest cumulative amended values.
- Avoided raw summing of federal amendment rows because agreement values are cumulative.
- Linked Alberta competitive contracts to sole-source follow-ons by normalized vendor name.
- Flagged high growth, follow-on value, near-threshold patterns, repeated relationships, and nonstandard justification context.

### 5. Vendor Concentration

- Built BigQuery concentration outputs by source, department, and category.
- Calculated HHI, CR4, top supplier share, effective competitors, total dollars, and top entities.
- Added invariant checks so impossible share metrics cannot be published.

### 6. Governance Networks

- Normalized director/person names.
- Built organization-pair and person-detail views.
- Used graph layouts to show shared governance relationships.

### 7. Policy Alignment

- Used official planning, mandate, performance, infrastructure, housing, and health indicator sources.
- Compared stated priorities and planned spending against observed amounts, results, or delivery status.
- Added confidence levels and caveats to prevent overclaiming.

### 8. Duplicative Funding and Priority Gaps

- Split the work into two streams.
- 8A finds overlapping funding across federal grants, Alberta grants, and CRA-reported government funding.
- 8B reviews priority gaps, project delays, spending variance, and allocation-without-project-match cases.
- Added public-sector caveats for expected co-funding.

### 9. Contract Intelligence

- Built procurement-grade views from contract datasets.
- Decomposed growth into contract count, average contract value, amendment contribution, interaction effects, and vendor concentration.
- Clearly labels the metric as average contract value, not unit price.

### 10. Adverse Media

- Moved media scanning to the backend.
- Used Google News RSS and NewsAPI.
- Removed browser-side public CORS proxy dependency.
- Added graceful failure behavior so failed scans do not appear as clean results.
- Treated media as contextual review input, not a standalone decision trigger.

## Data Platform

| Platform | Role |
| --- | --- |
| Azure VM | Hosts the proof-of-concept web app and Node API |
| GCP BigQuery | Stores and computes larger analytical challenge tables |
| Postgres | Serves existing entity, funding, CRA, Alberta, federal, governance, and graph-backed API routes |
| Public datasets | Federal grants, Alberta contracts/grants, CRA charity data, registry data, CanadaBuys, GC InfoBase, Infrastructure Canada, CMHC, PHAC, news sources |

## Human-In-The-Loop Design

Maple DOGE is advisory by design.

| Design Choice | Reason |
| --- | --- |
| Scores are triage signals | They prioritize review, not enforcement |
| Caveats stay near evidence | Reviewers see uncertainty before acting |
| Adverse media is contextual only | News does not create a case by itself |
| Review queue uses human confirmation | A person must verify sources and select an advisory action |
| Action briefs summarize evidence | Decision-makers get a compact review artifact |

## Repository Layout

```text
src/
  React frontend, routes, dossiers, challenge pages, graph components

backend/general/
  Node API, data access, entity-resolution scripts, challenge ingestion scripts

backend/general/visualizations/server.js
  Main JSON API used by the web app

deploy/
  Azure VM deployment helpers

public/
  Static assets, including the Maple DOGE logo
```

## PoC Scope

Maple DOGE demonstrates that a public-spending accountability app can combine:

- public data ingestion
- entity resolution
- ranked review signals
- source-linked dossiers
- graph evidence
- procurement analytics
- policy analytics
- GCP BigQuery analytical tables
- Azure VM deployment
- human-in-the-loop review workflows

Challenge 1 is the most complete decision workflow. The other challenges are implemented as investigation modules with ranked outputs, graphs, tables, charts, source caveats, and analytical evidence ready for deeper validation.

## Full Docker Deployment

The deployment stack now runs the entire application from this repo:

| Container | User-facing role |
| --- | --- |
| `web` | Serves the React app on `http://localhost:8080`, including search, dossiers, challenge pages, and `/accountability`. |
| `dossier-api` | Serves the Node JSON API behind `/api/*`. |
| `ship-service` | Serves the analytical conversation API behind `/ship-api/*`. |
| `cloud-sql-proxy` | Opens a local tunnel to the GCP Cloud SQL database used by the deployed app. |
| `postgres` | Local seeded Postgres fallback, available only with the explicit `local-postgres` compose profile. |

The browser entry point is:

```bash
http://localhost:8080
```

The web container proxies `/api` to the Node dossier API and `/ship-api` to the ship analyst service, so users stay on one origin instead of juggling service ports. By default those two API services connect to the GCP Cloud SQL database through the local Cloud SQL Auth Proxy; they no longer use the local Postgres container unless you deliberately opt into that fallback.

### Local Seed

Prepare the project-local database seed from the already-loaded hackathon source repo:

```bash
node scripts/prepare-project-database-seed.mjs --source=/home/david/GitHub/hackathon2026 --hardlink
node scripts/export-entity-vectors.mjs --server-copy --source-db=postgresql://hackathon:hackathon@localhost:5432/hackathon --output=services/postgres/seed/entity-vectors/entity_vectors_full.csv.gz
```

The first command places the `.local-db` importer and 13 GB dataset under `services/postgres/seed/` using hardlinks, so the data is available from this repo without duplicating disk. The second command exports `investigator.entity_embeddings` into `services/postgres/seed/entity-vectors/`.

The database container refuses to initialize an empty database. It needs either:

- `services/postgres/seed/hackathon.dump`, or
- `services/postgres/seed/.local-db/data/` plus an entity-vector CSV or CSV.GZ export.

### Local Runtime

Secrets live in `.env.docker`, which is gitignored.

```bash
deploy/gcp/configure-local-gcp-db.sh
docker compose --env-file .env.docker up --build
```

`configure-local-gcp-db.sh` reads `deploy/gcp/env` when it exists, otherwise it uses the defaults in `deploy/gcp/env.example`. It writes the Cloud SQL connection name, database user/name, and Secret Manager database password into `.env.docker` without printing the password. The local screen flow is still `http://localhost:8080`; the difference is that every search, dossier API call, and `/accountability` chat now reaches the same GCP database that Cloud Run uses.

The Docker Cloud SQL proxy expects Application Default Credentials from your local Google Cloud login. If the proxy cannot authenticate, run:

```bash
gcloud auth application-default login
```

Health checks:

```bash
curl http://localhost:8080/healthz
curl http://localhost:3801/api/health
curl http://localhost:8765/healthz
```

### GCP

Full-app GCP deployment scripts live in `deploy/gcp/`.

```bash
cp deploy/gcp/env.example deploy/gcp/env
deploy/gcp/bootstrap.sh
deploy/gcp/load-data.sh
deploy/gcp/build-and-deploy.sh
```

The GCP shape is Cloud Run for the three Docker services, Cloud SQL PostgreSQL 16 for the shared database, Artifact Registry for images, and Secret Manager for API keys and the database password. Cloud SQL supports the `pgvector` extension; the load script creates `vector`, `pg_trgm`, `fuzzystrmatch`, and `pgcrypto` before loading data.

The app/deployment project is `agency2026ot-doge-v-0429`. The source-data BigQuery project remains `agency2026ot-data-1776775157`; do not move the BigQuery settings to the app project.

If the database/API services are provisioned before the web service is redeployed, run this after the backend service URLs exist:

```bash
deploy/gcp/update-web-routing.sh
```

That updates the deployed UI so `/api` points at the Cloud SQL-backed dossier API and `/ship-api` points at the Cloud SQL-backed ship analyst API.

## Copyright

Copyright (c) From 2026-3000 dirm02. All rights reserved.

This project is protected by the repository [COPYRIGHT](COPYRIGHT) notice. No permission is granted to use, copy, modify, publish, distribute, sublicense, or sell any part of the software or source code except as required by applicable law or with prior written permission from the copyright holder.
