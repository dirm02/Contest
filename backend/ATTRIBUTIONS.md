# Attributions

This project builds on excellent open-source work from other teams. All
dependencies are open-source and used in line with their licenses.

## Data sources

| Source | Publisher | License |
|--------|-----------|---------|
| **T3010 Registered Charity Information Return** | Canada Revenue Agency | [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada) |
| **Grants and Contributions (federal)** | Government of Canada, Treasury Board Secretariat | [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada) |
| **Alberta Grants, Contracts, Sole-Source, Non-Profit Registry** | Government of Alberta | [Open Government Licence – Alberta](https://open.alberta.ca/licence) |

Specific dataset pages:
- CRA T3010 open data: https://open.canada.ca/data/en/dataset/2dc3c94d-f98c-4144-98c8-3c7da3d844d5
- Federal Grants & Contributions: https://open.canada.ca/data/en/dataset/1d15a62f-5656-49ad-8c88-f40ce689d831
- Alberta open data portal: https://open.alberta.ca/opendata

All data in this repository is redistributed under the original publishers'
open-government licences. The source code and pipeline are MIT-licensed
(see `LICENSE`) but that does **not** relicense the underlying data —
downstream use is governed by the open-government licences above.

## Third-party libraries

### Entity resolution core

| Library | License | Used for | URL |
|---------|---------|----------|-----|
| **[Splink](https://moj-analytical-services.github.io/splink/)** | MIT | Probabilistic record linkage (Fellegi-Sunter model, EM training, clustering) | https://github.com/moj-analytical-services/splink |
| **DuckDB** | MIT | In-memory analytics backend for Splink | https://duckdb.org |
| **pg_trgm** | PostgreSQL (BSD-style) | Trigram similarity for fuzzy-name matching | Built into PostgreSQL |
| **cleanco** | MIT | Legal-suffix stripping (Inc / Ltd / Société / GmbH) | https://github.com/psolin/cleanco |
| **pyarrow** | Apache 2.0 | Parquet serialization between Postgres and Splink | https://arrow.apache.org |
| **psycopg2** | LGPL with exception | Python PostgreSQL driver | https://www.psycopg.org |

### LLM integration

| Library | License | Used for | URL |
|---------|---------|----------|-----|
| **Anthropic SDK (`@anthropic-ai/sdk`)** | MIT | Claude API client (LLM verdict + golden-record authoring) | https://github.com/anthropics/anthropic-sdk-typescript |
| **Claude Sonnet 4.6** | Commercial API | Entity-match decisions and canonical-name authoring | https://www.anthropic.com |
| **Google Vertex AI** | Commercial API | Dual-provider throughput for Claude (same model, different billing pool) | https://cloud.google.com/vertex-ai |
| **jose** | MIT | JWT signing for Vertex AI service-account auth | https://github.com/panva/jose |

### Dashboard & dossier UI

| Library | License | Used for | URL |
|---------|---------|----------|-----|
| **Vue 3** | MIT | Single-page UI framework (loaded from unpkg CDN) | https://vuejs.org |
| **Chart.js** | MIT | Per-entity funding-by-year bar charts (loaded from jsdelivr CDN) | https://www.chartjs.org |
| **Express** | MIT | Dashboard + dossier HTTP servers | https://expressjs.com |
| **better-sqlite3** | MIT | Reading Splink's SQLite reference output for quality comparison | https://github.com/WiseLibs/better-sqlite3 |

### Node runtime + data access

| Library | License | Used for | URL |
|---------|---------|----------|-----|
| **pg** (`node-postgres`) | MIT | PostgreSQL connection pooling + query interface | https://node-postgres.com |
| **dotenv** (dotenvx) | BSD-2-Clause | Environment-variable loading with fallback chain | https://github.com/dotenvx/dotenvx |

## Splink reference comparison

The [`splink-master-table`](https://github.com/moj-analytical-services/splink)
reference output is distributed separately. Our `compare-500-vs-splink.js`
quality-validation tool reads a 500-entity stratified sample from Splink's
own published release to check our pipeline against their independently
computed output. Point `SPLINK_MASTER_DIR` at the extracted folder to run
the comparison.

## Generative AI assistance

Portions of this codebase and documentation were developed with assistance
from **Claude** (Anthropic). All AI-assisted code was reviewed by the
maintainers before commit.
