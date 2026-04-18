# AI For Accountability Hackathon

A multi-dataset analysis platform for government transparency and accountability research, built for the **AI For Accountability Hackathon** (April 29, 2026).

## Overview

This repository brings together four major Canadian government open data sources into a shared PostgreSQL database, with separate schemas to prevent collisions. Each dataset has its own pipeline for downloading, cleansing, importing, verifying, and analyzing data.

A shared `general` module provides cross-dataset tools including a universal fuzzy matching engine for entity resolution across all datasets, with AI-assisted review via Claude.

## Architecture

```
hackathon/
├── CRA/        # CRA T3010 Charity Data (cra schema)
├── FED/        # Federal Grants & Contributions (fed schema)
├── AB/         # Alberta Open Data (ab schema)
├── general/    # Shared tools & reference data (general schema)
├── LICENSE     # MIT
└── README.md   # This file
```

All four modules share the same PostgreSQL database on Render. Each uses its own schema (`cra`, `fed`, `ab`, `general`) so tables never collide. Every module follows the same conventions:

- **`.env.public`** - Shared credentials (committed, primary)
- **`.env`** - Personal overrides (gitignored, fallback)
- **`.env.public` takes precedence** over `.env` for consistent hackathon defaults

## Datasets

### CRA - Canada Revenue Agency T3010 Charity Data
**Schema:** `cra` | **Records:** ~7.3M | **Years:** 2020-2024

Annual filings from ~85,000 registered Canadian charities including financial statements, board directors, gift flows between charities, and program descriptions. All 5 years loaded via the Government of Canada Open Data API.

```bash
cd CRA && npm install && npm run setup
```

Key features:
- 35 tables (6 lookup + 19 data + 10 analysis) + 3 views
- Deterministic circular gifting detection (2-6 hop cycles, 5,808 cycles found)
- 0-30 risk scoring across temporal, financial, and circular dimensions
- SCC decomposition, Johnson's algorithm, and matrix power cross-validation
- Interactive charity lookup and risk profiling

### FED - Federal Grants & Contributions
**Schema:** `fed` | **Records:** ~1.275M | **Years:** Multiple fiscal years

All federal government grants, contributions, and transfer payments from 51+ departments to 422K+ recipients.

```bash
cd FED && npm install && npm run setup
```

Key features:
- Single 40-column table with 12 indexes and 3 views
- 7-dimension risk scoring (0-35 scale)
- Provincial equity, amendment creep, vendor concentration analysis
- Cross-reference with CRA charity data

### AB - Alberta Open Data
**Schema:** `ab` | **Records:** ~2.36M | **Years:** 2014-2025

Four Alberta government datasets: grants, Blue Book contracts, sole-source contracts, and the non-profit registry.

```bash
cd AB && npm install && npm run setup
```

| Dataset | Table | Records |
|---------|-------|---------|
| Alberta Grants | `ab_grants` | 1,772,874 |
| Blue Book Contracts | `ab_contracts` | 67,079 |
| Sole-Source Contracts | `ab_sole_source` | 15,533 |
| Non-Profit Registry | `ab_non_profit` | 69,271 |

Key features:
- 9 tables + 3 views + status lookup
- Sole-source deep dive (repeat vendors, contract splitting, geographic concentration)
- Grant/contract ratio analysis, recipient concentration (HHI)
- Non-profit lifecycle trends (survival analysis, sector health scoring)
- 6 advanced analysis scripts producing JSON + TXT reports

### general - Shared Tools & Reference Data
**Schema:** `general` | Cross-dataset utilities

Shared reference data and tools that work across all datasets.

```bash
cd general && npm install && npm run setup
```

Key features:
- **Cross-dataset entity resolution pipeline** — seven stages combining deterministic matching, Splink probabilistic record linkage, and LLM verdict/authoring to produce one golden record per real-world organization
- **27 Alberta ministries** reference table (codes, ministers, deputy ministers)
- **Real-time dashboard** at `localhost:3800` for controlling and observing the pipeline end to end
- **AI-assisted matching** via Claude Sonnet 4.6 (Anthropic direct + Vertex AI, dual-provider parallel throughput)

## Entity Resolution

The defining challenge across these datasets is that the same organization appears under dozens of name variations across CRA, FED, and AB. *"The Boyle Street Service Society"* shows up in source data as 11+ distinct name variants, spread across 6 different tables, with 4 different Business Number suffix variants — without reconciling them to one canonical entity, cross-dataset accountability analysis is impossible.

The `general` module builds one canonical **golden record** per real-world organization, linked to every source row that contributed to it. The pipeline combines three complementary techniques:

1. **Deterministic matching** — business-number anchoring + exact + normalized-name + trade-name extraction, walked across the six source tables in trust order (CRA first, federal next, Alberta last)
2. **Probabilistic matching via [Splink](https://moj-analytical-services.github.io/splink/)** — the UK Ministry of Justice's open-source Fellegi-Sunter implementation, with feature weights learned from the data through expectation-maximization. Catches the cases rule-based matching misses: hierarchical organizations, truncated variants, no-BN cross-dataset pairs.
3. **LLM verdict and authoring** — Claude Sonnet 4.6, running 100+100 concurrent against Anthropic's direct API and Google Vertex AI for parallel throughput. The LLM does two jobs in one call: decides SAME / RELATED / DIFFERENT for each candidate pair, and *authors the canonical golden record* (canonical name, entity type, exhaustive alias list) when the verdict is SAME.

The output is a single `entity_golden_records` table with roughly 800,000 rows — one per real-world organization — each with a canonical name, every observed alias, the primary BN and all variants, per-dataset profiles (CRA registration + financials, federal grants summary, Alberta totals), addresses, merge history, and cross-references to related entities.

Key design principles:
- **BN is the primary identifier.** Every stage treats the 9-digit Canadian Business Number root as authoritative.
- **Every stage is idempotent and resumable.** Interruptions pick up cleanly.
- **Every stage is observable.** A browser dashboard at `localhost:3800` shows live metrics, streams each phase's output inline, and flags regressions on six test entities in real time.

See [general/README.md](general/README.md) for the full pipeline documentation (six stages, libraries, outcomes, validation against the Splink reference implementation). Run end-to-end with:

```bash
cd general
npm install
npm run entities:splink:install       # one-time: Splink Python deps
npm run entities:dashboard            # http://localhost:3800 — click through phases
```

## Environment Configuration

Each module loads environment variables in this order:

1. **`.env.public`** loaded first (shared defaults for hackathon participants, committed)
2. **`.env`** loaded second with `override: true` (personal overrides, gitignored)

Participants without a `.env` file get the shared read-only credentials from `.env.public`. Developers with a `.env` file (containing admin credentials) automatically override for write operations like migrations and imports.

## Quick Start

```bash
# Clone and install all modules
git clone <repo-url> && cd hackathon
for dir in CRA FED AB general; do (cd $dir && npm install); done

# Each module's data is already loaded in the shared database.
# To verify or reload:
cd CRA && npm run verify
cd ../FED && npm run verify
cd ../AB && npm run verify

# Run analysis
cd ../AB && npm run analyze:all

# Run the entity resolution pipeline (produces golden records across CRA+FED+AB)
cd ../general
npm run entities:splink:install     # one-time Splink Python deps
npm run entities:dashboard          # open http://localhost:3800 to drive the pipeline visually
```

## Database Access

**Read-only** (for querying, no data modification):
```
postgresql://hackathon_readonly:...@render.com:5432/database_database_w2a1
```
Credentials are in each module's `.env.public`.

**Schemas:** `cra`, `fed`, `ab`, `general` (set via `search_path` in each module's `lib/db.js`)

## License

MIT - see [LICENSE](LICENSE)
