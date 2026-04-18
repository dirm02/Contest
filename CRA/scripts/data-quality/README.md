# Data-Quality Scripts

Deterministic, reproducible checks against the CRA T3010 Open Data
snapshot as it is ingested into this repository's `cra` schema. Each
script runs against the public dataset, persists its results to a table
in the database, and writes both a human-readable Markdown report and a
machine-readable JSON file to `data/reports/data-quality/`.

## Methodology — and what we deliberately do not do

This suite is intentionally conservative. Every finding is traceable to
an observable fact in one of these three published sources:

1. **CRA T3010 Registered Charity Information Return** — the form
   itself, as reproduced in `docs/guides-forms/T3010.md` and
   `docs/guides-forms/codes_en.pdf`.
2. **CRA Open Data Dictionary v2.0** — the field dictionary for the
   public extract, reproduced in `docs/guides-forms/OPEN-DATA-DICTIONARY-V2.0 ENG.md`.
3. **The ingested dataset itself** — `cra.cra_identification` and
   `cra.cra_qualified_donees` as loaded by the pipeline.

**What this suite flags:**

- **Direct form-identity violations.** Rules that derive from
  arithmetic identities stated explicitly on the T3010 form —
  e.g. "field_5100 = field_4950 + field_5045 + field_5050" is printed
  on the form itself. A filing that violates such an identity is
  internally inconsistent on its face.
- **Direct form-partition violations.** Rules grounded in form text
  that designates sub-lines as "Of the amount at line X" — those
  sub-lines cannot, together, exceed their parent.
- **Format violations.** Business numbers filed in the public
  `cra_qualified_donees` table that violate the 15-character CRA
  BN format (`^[0-9]{9}RR[0-9]{4}$`).
- **Empirical coverage findings.** Observable facts about the
  dataset as published — for example, how many BNs in
  `cra_identification` show any `legal_name` variation across the
  fiscal years loaded.

**What this suite does NOT flag:**

- **Magnitude thresholds.** No "field > $X" threshold is applied. The
  T3010 form imposes no magnitude bound on any financial field.
  Large, legitimate filings (provincial health authorities, school
  boards) routinely cross any threshold a third-party analyst might
  pick. Known typos such as FINCA CANADA FY 2023 ($222B compensation
  on $1.8M revenue) are still caught here *because they violate the
  IDENTITY_5100 arithmetic identity* — not because of their
  magnitude.
- **Sign rules.** We do not flag negative values on revenue or
  expenditure fields as impossibilities. The T3010 form explicitly
  instructs filers to "show a negative amount with brackets" on
  field_4600 (Net proceeds from disposition of assets), and the CRA
  Open Data Dictionary v2.0 records that every financial field in
  the extract has a length of 14 "including one digit reserved for
  a potential negative sign." Sophisticated foundations
  (Mastercard Foundation, Azrieli Foundation, The Winnipeg
  Foundation, Fondation Lucie et André Chagnon and many others)
  have reported negative `field_4700` (total revenue) in years with
  investment losses. These filings reconcile correctly and are not
  data errors.
- **Cross-field inequalities that depend on non-negativity.** Rules
  like "compensation must not exceed total expenditures" or "gifts
  to qualified donees must not exceed total expenditures" are
  structurally derivable from the form's arithmetic *only* if one
  assumes every expenditure sub-line is non-negative. The form text
  does not say that. We therefore do not claim those as
  impossibilities.
- **Plausibility flags.** "Total expenditures > revenue + total
  assets", "expenditure-to-revenue ratio > 100×", and similar
  cross-section ratios are not in the form text. They may be
  analytically interesting but they are not impossibilities, so
  they are out of scope for this suite.

The goal of this discipline is that every claim in a generated
report survives a hostile read by a reviewer who has the T3010 form
and the data dictionary in front of them.

## One-line summary of each script

| Script | What it answers | Persisted table | Report |
|---|---|---|---|
| `01-donee-bn-name-mismatches.js` | Of $66.9B in charity-to-charity gifts, how much cannot be programmatically joined from `cra_qualified_donees` to `cra_identification`? Surfaces the MALFORMED_BN defect taxonomy (BN format violations — the only format-rule impossibility), UNREGISTERED_BN list, and per-year single-filer case studies (e.g. the Calgary Foundation's `"Sec. 149.1(1)"` BN use in FY 2020 and FY 2022). | `cra.donee_name_quality` | `donee-bn-name-mismatches.md` |
| `02-t3010-arithmetic-impossibilities.js` | How many T3010 financial filings violate one of **ten** structural identity / consistency / dependency rules stated directly in the T3010 form or the CRA Open Data Dictionary v2.0? Rules cover the expenditure tree (IDENTITY_5100, PARTITION_4950), the balance sheet (IDENTITY_4200, IDENTITY_4350), cross-schedule equalities that the dictionary literally says "must be pre-populated" (COMP_4880_EQ_390, DQ_845_EQ_5000, DQ_850_EQ_5045, DQ_855_EQ_5050), and Schedule 3 dependencies (SCH3_DEP_FORWARD, SCH3_DEP_REVERSE). | `cra.t3010_arithmetic_violations` | `t3010-arithmetic-impossibilities.md` |
| `03-identification-backfill-check.js` | Does `cra_identification` preserve historical legal names across years, or has CRA backfilled the current name onto every row? Measures how much of the NAME_MISMATCH $ would be rescuable if historical names were preserved. | `cra.identification_name_history` | `identification-backfill-check.md` |

All reports land in `data/reports/data-quality/`.

## How to run

```bash
npm install                      # once — before any of this works
npm run data-quality             # runs all three scripts in order (~2 min)
npm run data-quality:donees      # 01 — gift-record BN ↔ name linkage
npm run data-quality:arithmetic  # 02 — T3010 arithmetic identity violations
npm run data-quality:backfill    # 03 — identification-table backfill
```

Script 03 uses a table that script 01 creates, so if you're running
them individually, run `:donees` before `:backfill` or the impact
section of 03's report will be skipped.

## Insights you will find when you run these

### 1. Gift records whose BN cannot be joined to `cra_identification`

Every row in `cra_qualified_donees` records one charity giving a gift
to another, with both the donee's business number AND the donee's name
written on the form. `cra_identification` publishes the canonical legal
name for every registered BN. The two datasets *should* join cleanly.
They don't. Script 01 surfaces:

- **~$9B in gifts (13.4% of the five-year total)** where the donee_bn
  on the gift either violates CRA's own BN format, isn't in
  `cra_identification`, or has a legal name that does not spelling-match
  what the filer wrote. Rows are split into four categories:
  PLACEHOLDER_BN, **MALFORMED_BN**, UNREGISTERED_BN, NAME_MISMATCH.

- **$1.95B of that sits under BNs that fail CRA's own 15-character
  format** (`^[0-9]{9}RR[0-9]{4}$`) — the MALFORMED_BN category. This
  is a format-rule impossibility: the form itself defines the
  business-number structure and any deviation is an input error. The
  report includes a defect taxonomy (embedded spaces, RC/RP/RT
  payroll-program codes where registered-charity codes belong, missing
  `RR`, truncated suffix, non-numeric BN) and three worked examples
  per defect class.

- **Well-known registered charities absent from the identification
  roster** (UNREGISTERED_BN bucket — not an impossibility, just a
  factual count of failed joins): Sunnybrook Health Sciences Centre,
  BC Cancer Agency, Hockey Canada, University of Ottawa Heart
  Institute, CancerCare Manitoba, PEI's Queen Elizabeth Hospital.

- **The "Toronto" single-filer case study**: Jewish Foundation of
  Greater Toronto's FY 2023 return lists `donee_bn = 'Toronto'` on
  all 434 of its Schedule 5 line items, totalling $42,953,866. The
  case study section prints per-year record counts for every filer
  who used the same malformed BN on 20+ records in any single return.

### 2. T3010 filings that violate the form's own arithmetic or consistency rules

Script 02 runs **10 rules** across four families. Every rule is traced
to a specific line number in the T3010 form or the CRA Open Data
Dictionary v2.0 — the suite claims no rule that isn't printed in
CRA's own documentation.

**Expenditure-tree identities**

- `IDENTITY_5100` — `field_5100 = field_4950 + field_5045 + field_5050`
  (T3010.md lines 281 & 657: "Total expenditures (add lines 4950, 5045
  and 5050)"). FINCA CANADA FY 2023 is caught here because its $222B
  reported field_5100 does not reconcile to its components.
- `PARTITION_4950` — `field_5000 + 5010 + 5020 + 5040 ≤ field_4950`
  (T3010.md lines 644, 648–651: "Of the amounts at lines 4950:…").

**Balance-sheet identities** (strict: both total AND at least one
component must be populated, so Section D filers who report only the
total are not flagged)

- `IDENTITY_4200` — `field_4200 = field_4100 + 4110 + … + 4170`
  (T3010.md line 584: "Total assets (add lines 4100, 4110 to 4155,
  and 4160 to 4170)"). `field_4180` (pre-v27 10-year gift balance)
  and `field_4190` (v27+ impact investments) are NOT part of this
  sum — the form text stops at 4170.
- `IDENTITY_4350` — `field_4350 = field_4300 + 4310 + 4320 + 4330`
  (T3010.md line 572: "Total liabilities (add lines 4300 to 4330)").

**Cross-schedule equalities** — these are direct constraints the CRA
Open Data Dictionary v2.0 literally says "must be pre-populated":

- `COMP_4880_EQ_390` — Schedule 6 `field_4880` = Schedule 3
  `field_390` (T3010.md line 631: "enter the amount reported at line
  390 in Schedule 3").
- `DQ_845_EQ_5000` — Schedule 8 line 845 = Schedule 6 `field_5000`
  (Dictionary line 1023: "Must be pre-populated with the amount from
  line 5000 from Schedule 6 of this return").
- `DQ_850_EQ_5045` — Schedule 8 line 850 = Schedule 6 `field_5045`
  (Dictionary line 1024).
- `DQ_855_EQ_5050` — Schedule 8 line 855 = Schedule 6 `field_5050`
  (Dictionary line 1025).

**Schedule dependencies** — the T3010 form's own "If yes/no" logic:

- `SCH3_DEP_FORWARD` — if `field_3400` (C9) = TRUE, a Schedule 3
  (cra_compensation) row must exist (T3010.md line 133: "Did the
  charity incur any expenses for compensation of employees ... If
  yes, you must complete Schedule 3").
- `SCH3_DEP_REVERSE` — if a Schedule 3 row exists, `field_3400` (C9)
  must = TRUE (T3010.md line 467: "If you complete this section, you
  must answer yes to question C9").

Every violation prints the BN, the fiscal year, the legal name on file
for that charity-year, and a plain-English description of the
violation citing the specific form line or dictionary entry.

### 3. Rebrand erasure in `cra_identification`

Script 03 tests whether `cra_identification` preserves historical
legal names. This is not an impossibility check — it's an
**observable coverage fact** about the published dataset. You will
find:

- **Only ~0.86% of BNs** (~784 of 91,129) show any `legal_name`
  variation at all across 2020–2024.
- **Seven well-known rebrands** are spot-checked by BN (Ryerson →
  Toronto Metropolitan, Grey Bruce → BrightShores, Calgary Zoo
  Foundation → Wilder Institute, Markham Stouffville → Oak Valley,
  Toronto General & Western → UHN Foundation, St. Michael's → Unity
  Health Toronto, Jewish Heritage Foundation → Moral Arc). For six
  of the seven, the pre-rebrand name is no longer recoverable from
  `cra_identification`.
- The report quantifies how much of the NAME_MISMATCH dollar total
  from script 01 would be "rescuable" by a historical-name join if
  CRA had preserved the history. The answer — small, because the
  history isn't preserved — is itself the finding.

Output: `identification-backfill-check.md`

## Extending these checks

New rules are welcome provided they meet the methodology standard
above: every rule must be traceable to explicit text in the T3010
form or the CRA Open Data Dictionary v2.0. A minimal new script
should:

1. Sit in this folder with a numeric prefix (`04-…`).
2. Use `../../lib/db` for the database connection and `../../lib/logger`
   for output.
3. Persist findings to a table under the `cra` schema with a
   `rule_code` column identifying the specific rule.
4. Write both JSON and Markdown to `data/reports/data-quality/`.
5. Be idempotent — every run reproduces the same result given the
   same data snapshot.
6. Cite the specific form line number or dictionary entry that
   grounds each rule.
7. Get a line in `package.json` (`data-quality:<shortname>`) and an
   entry in the headline `data-quality` command.

If a proposed rule is a threshold, a magnitude check, or a
cross-field inequality that depends on non-negativity, it does not
belong in this suite.

## Third-party verification (pre-validated exemplars)

The values in every report are drawn from the CRA Open Data T3010
snapshot that this repo ingests. That same snapshot is independently
re-published by `charitydata.ca`, so every violation is reproducible
against a source outside this pipeline. Three exemplars have already
been cross-checked end-to-end; every field matched to the dollar:

| Rule | Charity | BN | FY | 3rd-party source |
|---|---|---|---|---|
| `IDENTITY_5100` | Centreville Presbyterian Church | `129955928RR0001` | 2024 | [charitydata.ca](https://www.charitydata.ca/charity/centreville-presbyterian-church/129955928RR0001/) — `field_4950` reads $5,204,352,043 on a rural church with $62K revenue |
| `COMP_4880_EQ_390` | Fraser Health Authority | `887612463RR0001` | 2020 | [charitydata.ca](https://www.charitydata.ca/charity/fraser-health-authority/887612463RR0001/) — Sch 6 comp $2.01B vs Sch 3 comp $2.01M (exactly 1000×) |
| `IDENTITY_5100` | MSC Canada | `119042489RR0001` | 2021 | [charitydata.ca](https://www.charitydata.ca/charity/msc-canada/119042489RR0001/) — `field_4950 = $147M` but sum of sub-lines = $15.6M (9.4×) |

**How to verify for yourself:** run `npm run data-quality`, open any
Markdown report, pick any row, find the BN on
`canada.ca/charities-list` or `charitydata.ca`, and compare the
published T3010 values against the report's "Supporting detail"
column. The report also cites the exact form-text or dictionary
line that establishes the rule is violated — so you can independently
check whether the form really defines the identity or relationship
the rule enforces.
