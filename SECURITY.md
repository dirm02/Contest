# Security and credentials

## Environment files — important convention

Every module in this repository loads environment variables in the same
order via its `lib/db.js`:

1. **`.env.public`** — loaded first. Contains shared read-only database
   credentials and any shared defaults. Despite the name, **this file is
   `.gitignored` and is distributed out-of-band** (shared link, Slack,
   instructor hand-out). It is not committed to the repository.
2. **`.env`** — loaded second with `override: true`. Personal admin
   credentials if you have them. Also gitignored.

A fresh clone will **not work** until you obtain a `.env.public` for each
module (`CRA/.env.public`, `FED/.env.public`, `AB/.env.public`,
`general/.env.public`) from the team distributing them.

If you spin up your own PostgreSQL instance via `.local-db/import.js`,
create your own `.env` or `.env.public` pointing at it and the pipeline
will use that.

## What the files should contain

| Variable | Scope | Typical value |
|----------|-------|---------------|
| `DB_CONNECTION_STRING` | All modules | `postgresql://user:pass@host:5432/database` |
| `ANTHROPIC_API_KEY` | `general` (LLM phase only) | `sk-ant-...` |
| `VERTEX_PROJECT_ID` | `general` (LLM phase only) | Google Cloud project ID |
| `VERTEX_SERVICE_ACCOUNT_JSON` | `general` (LLM phase only) | JSON string (the full service-account key) |
| `VERTEX_CLAUDE_SONNET_MODEL` | `general` (LLM phase only) | `claude-sonnet-4-6` |
| `VERTEX_LOCATION_ID` | `general` (LLM phase only) | `global` |

The LLM phase does **not** require both providers — set either
`ANTHROPIC_API_KEY` or the `VERTEX_*` variables and the script will use
whichever is configured. Setting both enables dual-provider parallel
throughput (the `08a` and `08b` dashboard buttons).

## Rotating credentials

If an `.env.public` leaks (e.g. you accidentally commit it, or share it
too widely):

1. Rotate the PostgreSQL read-only user password and update the master
   `.env.public` file. Redistribute to team members.
2. Revoke the leaked Anthropic API key at https://console.anthropic.com
   and issue a new one.
3. Revoke the leaked Vertex service-account key in Google Cloud IAM and
   generate a new one for the `vertex-express@` (or equivalent) account.
4. If the file ended up in a git commit: `git rm` is insufficient; use
   `git filter-repo` or BFG to scrub history before pushing, and force-push
   once you're certain. Any user who cloned in the meantime already has
   the leaked secrets.

## Read-only vs admin access

The shared `.env.public` deliberately ships a **read-only** database user.
This means:

- Participants can run analysis queries, the dossier, the dashboard, and
  the `.local-db/export.js` script against the shared Render database.
- Participants CANNOT run migrations, seed scripts, or the write-path
  pipeline (`04-resolve` through `09-build-golden-records`) on the
  shared database. Those require an admin `.env` with write privileges.

The expected workflow for participants who want to modify data is: spin
up a local PostgreSQL, run `.local-db/import.js` with your own
`DB_CONNECTION_STRING`, and work against your own copy.

## Data sensitivity

The datasets this project works with are **public open-government data**
published by CRA, Treasury Board, and the Government of Alberta under
their respective Open Government Licences. Notable content:

- **CRA T3010 data** includes names of registered-charity board directors
  (first name + last name, public per the form's design). T3010 filings
  are public documents — this is not PII in the conventional sense, but
  redistribution alongside other indicators warrants the standard care
  of any public-registry republication.
- **Federal grants & contributions** includes recipient names. For
  individuals receiving grants (e.g., research fellowships), the data
  includes their names as published by the awarding department.
- **Alberta sole-source contracts** includes vendor business addresses.

No salary, tax, medical, or other private data is present.

Please consult the original Open Government Licence terms before
redistributing derivative outputs.

## Reporting vulnerabilities

If you discover a security issue in the pipeline code (e.g. SQL injection
via a dossier search parameter, an API endpoint leaking data it shouldn't,
a credential-handling bug), please open a private issue or contact the
maintainers directly rather than filing a public bug report. Standard
responsible-disclosure practice.
