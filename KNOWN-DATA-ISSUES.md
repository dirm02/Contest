# Known Data Issues

Living catalogue of every data-quality defect we can prove with evidence
against the **AB**, **CRA**, and **FED** source datasets as they sit in
this repository's database.

## How this document works

Every entry has the same structure:

- **Issue ID** — stable identifier (`F-…`, `C-…`, `A-…`) so external
  references don't rot.
- **What's wrong** — one sentence, plain language.
- **Evidence** — the exact SQL (or script output) a reader can run today to
  reproduce the count.
- **Count as of 2026-04-19** — the current snapshot's number. Re-run the
  query to refresh.
- **Source of authority** — TBS spec / T3010 form line / Open Data
  Dictionary / script that computed it.
- **Mitigation status** — one of:
  - ✅ **Mitigated** — a view, doc, or filter eliminates the footgun for
    users who follow the recommended path.
  - 📝 **Documented as-is** — we carry the defect through unchanged and
    warn consumers.
  - ⚠️ **Active** — no mitigation yet.

Rules of inclusion:
- Every issue must be **provable** — a SQL query, script output, or form-line
  citation must reproduce it. Editorial opinions, plausibility heuristics,
  and future concerns belong elsewhere.
- No row is ever modified or deleted from the source data to resolve an
  issue. Mitigations are always additive (views, docs, reports).
- If an issue changes — counts drift, a new mitigation lands, the defect
  evaporates on the next snapshot — update the entry in place and move the
  old number to the Changelog at the bottom.

---

## FED — Federal Grants and Contributions (`fed.grants_contributions`)

Authoritative TBS schema: [`FED/docs/grants.json`](FED/docs/grants.json),
[`FED/docs/grants.xlsx`](FED/docs/grants.xlsx).

### F-1. `ref_number` collisions across distinct recipients

**What's wrong.** TBS spec says `ref_number` is "a unique reference number
given to each entry." Publishers have broken that rule: the same
`ref_number` appears under multiple, unrelated recipients.

**Evidence.**
```sql
SELECT COUNT(*) FROM (
  SELECT ref_number FROM fed.grants_contributions
  WHERE ref_number IS NOT NULL
  GROUP BY ref_number
  HAVING COUNT(DISTINCT COALESCE(recipient_business_number,'') || '|' ||
                        COALESCE(recipient_legal_name,'')) > 1
) t;
-- 41,046
```

Concrete example: `ref_number = '001-2020-2021-Q1-00006'` covers **both** a
$23,755 Canadian Heritage Photography Foundation grant *and* a
$20.5M→$36.24M Women's Shelters Canada contribution — both tagged
`amendment_number = 0`.

**Count (2026-04-19):** 41,046 distinct `ref_number`s collide across ≥2
recipients. Concentrated in pre-2018 legacy `GC-…` records.

**Source.** TBS spec `FED/docs/grants.json` field `ref_number`,
description: "unique reference number given to each entry."

**Mitigation.** 📝 Documented in
[`FED/docs/DATA_DICTIONARY.md`](FED/docs/DATA_DICTIONARY.md) → "Known
source defects". `fed.vw_agreement_current` uses
`(ref_number, COALESCE(bn, legal_name, _id))` as the partition key so
colliding agreements stay separated instead of silently collapsing.
`FED/scripts/05-verify.js` prints the count on every run.

### F-2. Duplicate `(ref_number, amendment_number)` rows

**What's wrong.** Within any single `ref_number`, each `amendment_number`
should appear at most once. 25,853 pairs violate this, even after
normalising for the F-1 collision effect.

**Evidence.**
```sql
SELECT COUNT(*) FROM (
  SELECT ref_number, amendment_number
  FROM fed.grants_contributions
  WHERE ref_number IS NOT NULL
  GROUP BY ref_number, amendment_number
  HAVING COUNT(*) > 1
) t;
-- 25,853
```

**Count:** 25,853 colliding pairs.

**Source.** Direct consequence of the TBS uniqueness rule; duplicates here
are unambiguous publisher defects.

**Mitigation.** 📝 Documented. Reported by `05-verify.js`. `_id` remains
the only truly unique row PK.

### F-3. `agreement_value` is cumulative, not a delta — naive SUM double-counts

**What's wrong.** TBS spec: `agreement_value` "should report on the total
grant or contribution value, and **not the change in agreement value**."
Every amendment row restates the running total for the whole agreement.
Summing raw rows triple-counts an agreement amended twice.

**Evidence.**
```sql
SELECT
  (SELECT ROUND(SUM(agreement_value)::numeric,0) FROM fed.grants_contributions) AS all_rows,
  (SELECT ROUND(SUM(agreement_value)::numeric,0) FROM fed.vw_agreement_originals) AS originals,
  (SELECT ROUND(SUM(agreement_value)::numeric,0) FROM fed.vw_agreement_current) AS current_commitment;
-- all_rows = $921B, originals = $533B, current_commitment = $816B
```

**Count:** naive SUM inflates by ~$388B (~73%) versus the correct "current
commitment" figure.

**Source.** TBS spec `FED/docs/grants.json` field `agreement_value`.

**Mitigation.** ✅
- `fed.vw_agreement_current` — latest amendment per agreement.
- `fed.vw_agreement_originals` — `is_amendment = false` only.
- `FED/docs/DATA_DICTIONARY.md` → "How to sum `agreement_value` correctly".
- `FED/docs/SAMPLE_QUERIES.sql` leads with the sum-comparison query.
- `FED/CLAUDE.md` "Important Notes" rewritten to lead with this caveat.

### F-4. Negative `agreement_value` violates TBS validation

**What's wrong.** TBS spec: value "must be greater than 0." Source data
includes 4,633 negative rows. 99.7% of them are on amendment rows — the
publisher de facto uses negatives as termination/reversal markers,
although this is not authorised by the spec.

**Evidence.**
```sql
SELECT
  COUNT(*) FILTER (WHERE agreement_value < 0) AS negative_total,
  COUNT(*) FILTER (WHERE agreement_value < 0 AND is_amendment) AS negative_on_amendments,
  COUNT(*) FILTER (WHERE agreement_value < 0 AND NOT is_amendment) AS negative_on_originals
FROM fed.grants_contributions;
-- negative_total 4,633 | on_amendments 4,617 | on_originals 16
```

**Count:** 4,633 negative rows (4,617 on amendments, 16 on originals).

**Source.** TBS spec validation: "This field must not be empty. The number
must be greater than 0."

**Mitigation.** 📝 Documented in `FED/docs/DATA_DICTIONARY.md` and
`FED/CLAUDE.md`. `05-verify.js` reports the breakdown. No data is
rewritten.

### F-5. Zero `agreement_value` violates TBS validation

**What's wrong.** Same rule as F-4: value "must be greater than 0." 11,510
rows carry exactly 0.

**Evidence.**
```sql
SELECT COUNT(*) FROM fed.grants_contributions WHERE agreement_value = 0;
-- 11,510
```

**Count:** 11,510 rows.

**Source.** TBS spec validation clause.

**Mitigation.** 📝 Documented. Reported by `05-verify.js`.

### F-6. `recipient_business_number` format polyglot

**What's wrong.** TBS spec: 9-digit CRA Business Number. The column in
practice carries at least six distinct formats including garbage strings
like `-`.

**Evidence.**
```sql
SELECT LENGTH(recipient_business_number) AS len, COUNT(*)
FROM fed.grants_contributions
WHERE recipient_business_number IS NOT NULL
GROUP BY len ORDER BY count DESC;
```

| len | count | sample |
|-----|-------|--------|
| 15  | 336,851 | `017463077RT0001` (15-char CRA BN) |
| 9   | 207,389 | `000000000` (9-digit BN root) |
| 1   | 19,416 | `-` (garbage placeholder) |
| 10  | 3,585 | `0000000000` |
| 17  | 1,343 | `05231185913RT0001` (extra digits) |
| 16  | 677 | `000015123 RT0001` (embedded space) |
| other | ~2,000 | 1–8 chars, 11–14 chars, 18+ |

**Count:** ~28,600 rows outside the expected 9-char or 15-char BN formats.

**Source.** TBS spec `FED/docs/grants.json` field
`recipient_business_number`: 9-digit BN.

**Mitigation.** 📝 Documented in `FED/docs/DATA_DICTIONARY.md`,
`FED/CLAUDE.md`. No on-import normalization.

### F-7. Missing BN when a BN is expected (for-profit / not-for-profit)

**What's wrong.** TBS marks `recipient_business_number` "Optional" in
general, but organisations with `recipient_type` `F` (for-profit) or `N`
(not-for-profit / charity) should have one. Many rows don't.

**Evidence.**
```sql
SELECT recipient_type,
       COUNT(*) AS total,
       COUNT(*) FILTER (
         WHERE recipient_business_number IS NULL
            OR TRIM(recipient_business_number)=''
            OR LENGTH(recipient_business_number) < 9
       ) AS missing_or_stub
FROM fed.grants_contributions
WHERE recipient_type IN ('N','F')
GROUP BY recipient_type;
```

| recipient_type | total | missing_or_stub | % missing |
|---|---:|---:|---:|
| N (not-for-profit / charity) | 229,053 | 37,350 | **16.3%** |
| F (for-profit) | 234,766 | 9,752 | **4.2%** |

**Count:** 47,102 rows where a BN should have been recorded but isn't.

**Source.** Inference from TBS recipient-type semantics and the CRA BN
standard for all business-to-government transactions.

**Mitigation.** ⚠️ Active — not yet mitigated.

### F-8. Missing `agreement_end_date`

**What's wrong.** TBS marks `agreement_end_date` "Mandatory." 187,866
rows (14.7%) have it NULL.

**Evidence.**
```sql
SELECT COUNT(*) FROM fed.grants_contributions
WHERE agreement_end_date IS NULL;
-- 187,866
```

**Count:** 187,866 (14.7% of 1,275,521 rows).

**Source.** TBS spec `FED/docs/grants.json` field `agreement_end_date`:
"Mandatory."

**Mitigation.** ⚠️ Active. (`agreement_start_date` is populated on every
row — this is strictly an `end_date` problem.)

### F-9. `agreement_end_date < agreement_start_date`

**What's wrong.** 947 rows have an end date that precedes the start date.

**Evidence.**
```sql
SELECT COUNT(*) FROM fed.grants_contributions
WHERE agreement_end_date < agreement_start_date;
-- 947
```

**Count:** 947 rows.

**Mitigation.** ⚠️ Active.

### F-10. `agreement_number` is free text and reused as a program code

**What's wrong.** TBS spec marks it "Optional" and "Free text." In
practice, departments use it for program/award identifiers reused across
thousands of unrelated grants, so it **cannot be a join key** and
**cannot identify an agreement**.

**Evidence.**
```sql
SELECT agreement_number, COUNT(*), COUNT(DISTINCT recipient_legal_name) AS recipients
FROM fed.grants_contributions WHERE agreement_number IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
```

| agreement_number | rows | distinct recipients |
|---|---:|---:|
| URU | 3,439 | 3,439 |
| RGPIN | 2,157 | 2,157 |
| USRAI | 1,878 | 1,780 |
| EGP | 1,137 | 1,131 |
| CGSM | 790 | 790 |

**Count:** out of 747,531 distinct `agreement_number` values, hundreds
are program codes; the top 5 alone cover 9,401 unrelated grants.

**Source.** TBS spec + observation.

**Mitigation.** 📝 Documented in `FED/docs/DATA_DICTIONARY.md` and
`FED/CLAUDE.md` ("Never a join key").

### F-11. Amendments can reduce agreement value

**What's wrong.** Not strictly an error — but worth knowing. Of amendment
rows that have a prior value to compare against: 23,108 increased,
**2,900 decreased**, 9,379 unchanged. Analysts assuming amendments only
grow agreements will mis-read 8% of them.

**Evidence.** See the window-function query in the audit script (see
Changelog).

**Source.** Observation.

**Mitigation.** 📝 Captured in the "How to sum" box in
`FED/docs/DATA_DICTIONARY.md`; `vw_agreement_current` uses the latest
amendment regardless of direction.

---

## CRA — T3010 Charity Data (`cra.*`)

The CRA module ships a structured data-quality suite under
`CRA/scripts/data-quality/` that persists findings to the database. Every
rule is textually grounded in the T3010 form or the CRA Open Data
Dictionary v2.0 — see
[`CRA/scripts/data-quality/README.md`](CRA/scripts/data-quality/README.md)
for the full methodology.

### C-1. T3010 arithmetic impossibilities — 54,010 filings across 10 rules

**What's wrong.** Filings that fail one of ten identities printed on the
T3010 form or in the Dictionary — e.g. `field_5100 = 4950 + 5045 + 5050`
(printed literally on the form as "Total expenditures (add lines 4950,
5045, 5050)").

**Evidence.**
```sql
SELECT rule_code, COUNT(*) AS rows, COUNT(DISTINCT bn) AS distinct_bns
FROM cra.t3010_impossibilities
GROUP BY rule_code ORDER BY rows DESC;
```

| Rule | Rows | Distinct BNs | Meaning |
|------|---:|---:|---|
| `PARTITION_4950` | 24,960 | 18,017 | Sub-lines of line 4950 exceed the line itself |
| `COMP_4880_EQ_390` | 13,504 | 8,562 | Schedule 6 comp ≠ Schedule 3 comp (form line 631 says they must match) |
| `IDENTITY_5100` | 6,697 | 5,355 | Total expenditures don't reconcile to their three addends |
| `IDENTITY_4200` | 4,763 | 4,155 | Total assets ≠ sum of asset lines 4100–4170 |
| `SCH3_DEP_FORWARD` | 2,222 | 1,559 | `field_3400` = TRUE but no Schedule 3 row |
| `IDENTITY_4350` | 1,437 | 1,367 | Total liabilities ≠ sum of liability lines 4300–4330 |
| `DQ_845_EQ_5000` | 243 | 240 | Schedule 8 line 845 ≠ `field_5000` (Dictionary says "must be pre-populated") |
| `DQ_855_EQ_5050` | 161 | 157 | Schedule 8 line 855 ≠ `field_5050` |
| `DQ_850_EQ_5045` | 19 | 18 | Schedule 8 line 850 ≠ `field_5045` |
| `SCH3_DEP_REVERSE` | 4 | 4 | Schedule 3 row exists but `field_3400` ≠ TRUE |

**Count:** 54,010 violations across 30,856 distinct BNs (12.8% of the
240,714 BN-years with financial filings in the five-year window).

**Source.** T3010 form and Open Data Dictionary v2.0 — see
[`CRA/scripts/data-quality/02-t3010-arithmetic-impossibilities.js`](CRA/scripts/data-quality/02-t3010-arithmetic-impossibilities.js)
for the per-rule form-line citations.

**Mitigation.** ✅ Surfaced in `cra.t3010_impossibilities` with severity
($ impact) per row, plus a Markdown report at
`CRA/data/reports/data-quality/t3010-arithmetic-impossibilities.md`.
Three exemplars pre-validated against `charitydata.ca` match to the
dollar.

### C-2. T3010 plausibility flags — 1,075 unit-error candidates

**What's wrong.** Not impossibilities — the form puts no upper bound on
money fields — but values that are very likely unit errors (reported in
dollars when millions was meant, or vice-versa).

**Evidence.**
```sql
SELECT rule_code, COUNT(*) FROM cra.t3010_plausibility_flags GROUP BY rule_code;
```

| Rule | Count | Meaning |
|------|---:|---|
| `PLAUS_EXP_FAR_EXCEEDS_REV` | 792 | `field_5100 / field_4700 > 100` (excludes foundations A/B) |
| `PLAUS_COMP_EXCEEDS_TOTAL_EXP` | 234 | Comp > total expenditures (no sensible designation) |
| `PLAUS_MAGNITUDE_OUTLIER` | 49 | Money field > $10B (excludes foundations A/B) |

**Count:** 1,075 filings flagged.

**Source.** See the foundation-exclusion commentary in
[`CRA/scripts/data-quality/02-t3010-arithmetic-impossibilities.js:651–708`](CRA/scripts/data-quality/02-t3010-arithmetic-impossibilities.js).

**Mitigation.** ✅ Surfaced in `cra.t3010_plausibility_flags`; clearly
separated from impossibilities so downstream users can opt in.

### C-3. Qualified-donee BN→name mismatches — $8.97B unjoinable

**What's wrong.** Every `cra_qualified_donees` row lists the donee's BN
*and* the donee's name as the donor wrote it. They should agree with
`cra_identification` but frequently don't.

**Evidence.**
```sql
SELECT mismatch_category,
       COUNT(*) AS rows,
       ROUND(SUM(total_gifts)::numeric,0) AS dollars
FROM cra.donee_name_quality
GROUP BY mismatch_category
ORDER BY dollars DESC;
```

| Category | Rows | $ gifts | Meaning |
|----------|---:|---:|---|
| `MINOR_VARIANT` | 312,142 | $50.1B | Trivial variation (case, "The X" vs "X"); not an issue |
| `NAME_MISMATCH` | 67,631 | $4.99B | BN registered but name doesn't match (rebrands, acronyms, DAF platforms, or wrong-BN typos) |
| `UNREGISTERED_BN` | 24,151 | $2.03B | BN well-formed but not in `cra_identification` |
| `MALFORMED_BN` | 35,913 | $1.95B | BN violates CRA's own 15-char `^\d{9}RR\d{4}$` format |
| `PLACEHOLDER_BN` | 30 | $138K | All-zeros BN (`000000000RR0001`) — "unknown" |

**Count:** 127,725 problematic rows totalling **$8.97B** in gifts that
cannot be programmatically joined back to a charity record.

`MALFORMED_BN` breakdown (defect sub-codes):

| Defect | Rows | $ gifts |
|--------|---:|---:|
| 9 digits, no suffix | 14,102 | $897M |
| `RR` suffix truncated | 4,109 | $251M |
| Root = 8 digits | 3,559 | $130M |
| Single `R` (e.g. `R0001`) | 3,414 | $208M |
| Embedded space | 2,088 | $96M |
| Non-numeric BN | 1,511 | $74M |
| Root too long | 686 | $14M |
| `RP` (payroll) program code | 454 | $26M |
| `RC` (corporate-tax) program code | 445 | $82M |
| `RT` (GST/HST) program code | 372 | $24M |
| Fewer than 9 digits | 330 | $6M |
| `EE` invalid program code | 43 | $18M |

**Source.** CRA's own BN format (T3010 form) and Open Data Dictionary
v2.0. See
[`CRA/scripts/data-quality/01-donee-bn-name-mismatches.js`](CRA/scripts/data-quality/01-donee-bn-name-mismatches.js).

**Mitigation.** ✅ Full per-row breakdown in `cra.donee_name_quality`.
Markdown report at
`CRA/data/reports/data-quality/donee-bn-name-mismatches.md` with "Toronto"
case study (Jewish Foundation of Greater Toronto FY 2023: `donee_bn =
'Toronto'` on all 434 Schedule 5 rows, $42.95M).

### C-4. Qualified-donee BN or amount missing / invalid

**What's wrong.** Even before cross-referencing against the registry,
many rows are broken on their face.

**Evidence.**
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE donee_bn IS NULL) AS null_bn,
  COUNT(*) FILTER (WHERE donee_bn IS NOT NULL AND donee_bn !~ '^[0-9]{9}RR[0-9]{4}$') AS malformed_bn,
  COUNT(*) FILTER (WHERE total_gifts IS NULL) AS null_amount,
  COUNT(*) FILTER (WHERE total_gifts = 0) AS zero_amount,
  COUNT(*) FILTER (WHERE total_gifts < 0) AS negative_amount,
  COUNT(*) FILTER (WHERE donee_name IS NULL OR TRIM(donee_name)='') AS null_donee_name
FROM cra.cra_qualified_donees;
```

| Defect | Count |
|---|---:|
| Total rows | 1,664,343 |
| NULL `donee_bn` | 109,996 (6.6%) |
| Malformed BN (not `^\d{9}RR\d{4}$`) | 47,338 (2.8%) |
| NULL `total_gifts` | 41,989 (2.5%) |
| Zero `total_gifts` | 1,464 |
| Negative `total_gifts` | 3,332 |
| NULL / empty `donee_name` | 835 |

**Mitigation.** 📝 Surfaced inside `cra.donee_name_quality` (C-3) but not
called out as a headline number in any existing script. ⚠️ Active for the
NULL-amount and NULL-BN cases specifically.

### C-6. `cra_directors` NULL rates

**What's wrong.** Several director fields are optional in the form but
heavily missing in the data. The impact is biggest for shared-director
detection (`last_name` + `first_name`) where even 0.1% missingness
silently drops cycles.

**Evidence.**
```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE last_name IS NULL OR TRIM(last_name)='') AS null_lastname,
  COUNT(*) FILTER (WHERE first_name IS NULL OR TRIM(first_name)='') AS null_firstname,
  COUNT(*) FILTER (WHERE at_arms_length IS NULL) AS null_arms_length,
  COUNT(*) FILTER (WHERE start_date IS NULL) AS null_start,
  COUNT(*) FILTER (WHERE end_date IS NULL) AS null_end
FROM cra.cra_directors;
```

| Field | NULL count | % of 2,873,624 |
|---|---:|---:|
| `last_name` | 670 | 0.02% |
| `first_name` | 3,193 | 0.11% |
| `at_arms_length` | 142,682 | 4.96% |
| `start_date` | 288,822 | 10.05% |
| `end_date` | 2,178,291 | 75.80% *(expected — currently serving)* |

**Mitigation.** 📝 `end_date` NULLs are expected (active directors). The
`at_arms_length` and `start_date` gaps are not. Documented here; no
mitigation yet. ⚠️ Active.

### C-7. Historical legal names are NOT preserved — only 1.4% of BNs show any name change

**What's wrong.** CRA appears to backfill the current legal name onto
every historical year of each BN. Only 1,308 of 91,129 BNs (1.4%) show
*any* `legal_name` variation across 2020–2024, so well-known rebrands
(Ryerson → Toronto Metropolitan, Grey Bruce Health Services → BrightShores,
Calgary Zoo Foundation → Wilder Institute, Toronto General & Western
Hospital Foundation → UHN Foundation, etc.) are mostly erased.

**Evidence.**
```sql
SELECT COUNT(DISTINCT bn) AS bns_with_history,
       COUNT(*) AS total_rows
FROM cra.identification_name_history;
-- bns_with_history 91,129, total_rows 92,437
-- => only 1,308 BNs show any variation
```

**Count:** 1,308 of 91,129 BNs (≈1.4%) show any `legal_name` variation;
the other 98.6% carry the same name across all five years even when the
organisation demonstrably rebranded.

**Source.** See
[`CRA/scripts/data-quality/03-identification-backfill-check.js`](CRA/scripts/data-quality/03-identification-backfill-check.js).

**Mitigation.** ✅ Surfaced in `cra.identification_name_history`; report
at
`CRA/data/reports/data-quality/identification-backfill-check.md`
quantifies the $-rescue for NAME_MISMATCH gifts if the history were
preserved (the answer — small — is itself the finding).

### C-8. 2024 T3010 form revision — the v24→v27 migration

**What's wrong.** The T3010 form was revised in 2024. Some fields only
exist in pre-2024 filings (`field_4180`, `field_5030`), and others
(`field_4101`, `field_4102`, `field_5045`, etc.) are only populated from
2023 onwards as early filers adopted v27. Users filtering by column
alone will see confusing zero/NULL patterns.

**Evidence.**
```sql
SELECT EXTRACT(YEAR FROM fpe)::int AS yr,
       COUNT(field_4180) AS has_4180_pre2024,
       COUNT(field_4101) AS has_4101_v27,
       COUNT(field_5045) AS has_5045_v27
FROM cra.cra_financial_details
GROUP BY yr ORDER BY yr;
```

| yr | 4180 (pre-2024) | 4101 (v27+) | 5045 (v27+) |
|---|---:|---:|---:|
| 2020 | 1,174 | 0 | 4 |
| 2021 | 1,313 | 0 | 19 |
| 2022 | 1,387 | 6 | 2,627 |
| 2023 | 645 | 20,819 | 7,725 |
| 2024 | **0** | 41,020 | 8,665 |

**Source.** CRA Open Data Dictionary v2.0 `formIds` metadata; see
[`CRA/scripts/data-quality/05-field-mapping-audit.js`](CRA/scripts/data-quality/05-field-mapping-audit.js).

**Mitigation.** ✅ `CRA/docs/DATA_DICTIONARY.md` already notes the 2024
schema refresh. `05-field-mapping-audit.js` diffs published JSON keys
vs the dictionary's `formIds` metadata.

### C-11. `cra_qualified_donees` — 20,192 well-formed donee BNs unregistered

**What's wrong.** Of rows whose `donee_bn` is a well-formed 15-char CRA
BN, 20,192 distinct values do not appear in `cra_identification`.

**Evidence.**
```sql
SELECT COUNT(DISTINCT donee_bn)
FROM cra.cra_qualified_donees qd
WHERE LENGTH(qd.donee_bn) = 15
  AND NOT EXISTS (SELECT 1 FROM cra.cra_identification i WHERE i.bn = qd.donee_bn);
-- 20,192
```

**Count:** 20,192 distinct "orphan" donee BNs (this is the UNREGISTERED_BN
bucket in C-3 on a per-distinct-BN basis).

**Source.** Most are legitimate — non-charity qualified donees (municipalities,
public universities, First Nations councils, UN agencies) and charities
whose registration was revoked or predates the 2020 coverage window. Only
a minority are typos.

**Mitigation.** ✅ Already covered in `cra.donee_name_quality` per C-3;
analysts joining `cra_qualified_donees → cra_identification` silently
drop ~1.2% of rows. Call this out in any query that performs that join.

### C-12. `06-johnson-cycles.js` produced non-simple cycles — **resolved**

**What was wrong.** The Johnson-algorithm implementation in
`CRA/scripts/advanced/06-johnson-cycles.js` emitted cycles whose path
contained the same vertex twice (e.g.
`A→B→X→B→D→A`). Johnson's algorithm is defined to produce **simple**
cycles only, so these were artifacts of the block/unblock invariants
failing on this particular graph. The self-join in
`01-detect-all-loops.js` is structurally immune because N-way joins
enforce pairwise BN distinctness in SQL (`bn_i <> bn_j` across all pair
combinations), so `cra.loops` never contained these.

**Evidence (2026-04-19 initial run, pre-fix).**
```sql
-- Rows with a repeated intermediate node
SELECT hops, COUNT(*)
FROM cra.johnson_cycles j
JOIN LATERAL (
  SELECT COUNT(DISTINCT x) AS n_unique FROM unnest(j.path_bns) x
) uq ON true
WHERE uq.n_unique < j.hops
GROUP BY hops;
-- hops 5: 22 | hops 6: 136 | total 158
```

Concrete example: cycle id 13 was
`105200471RR0001 → 896568417RR0001 → 793187881RR0001 → 896568417RR0001
→ 888542198RR0001 → 136491875RR0001`, hops=6, with `896568417RR0001`
appearing at positions 1 and 3. 137 of the 158 followed that same
"sandwich" pattern (same node at positions i and i+2); the remaining
21 had other repeat shapes. Top offenders were all high-degree hub
BNs in the giant SCC — `748023538RR0001` (29 cycles),
`107951618RR0451` Salvation Army branch (17),
`793187881RR0001` (16), `118974294RR0001` (10),
`896568417RR0001` (9) — so the bug was concentrated where Johnson's
block chain does the most work.

**Root cause.** Classical Johnson's blocks a vertex when it's pushed
and unblocks it (plus a chain of dependent vertices via `blockMap`)
when a cycle is found through it. On this graph, an unblock chain can
reach a vertex that is **still on the current DFS stack** via stale
`blockMap` entries populated by a prior failed `circuit()` call of
that same vertex. Once the stack-resident vertex is unblocked, the
outer for-loop is free to re-enter it through a different path, and
when that re-entry closes back at `s`, the recorded stack contains
the vertex twice.

**Mitigation.** ✅ Resolved 2026-04-19. Two changes:

1. `CRA/scripts/advanced/06-johnson-cycles.js` now rejects non-simple
   paths at the authoritative recording point — a single
   `if (new Set(path).size !== path.length) continue;` guard right
   before `cycles.push(...)` in `circuit()`. The guard is O(n) per
   candidate cycle, negligible vs the DFS itself. The invariant is
   local and provable: whatever goes into `cra.johnson_cycles` is a
   simple cycle by construction. The deeper block/unblock invariants
   are not touched — fixing them would require re-engineering the
   algorithm and the practical gain is zero since the guard catches
   everything.
2. Dropped `cra.johnson_cycles` (surgical, not via `drop:loops`) and
   re-ran only `npm run analyze:johnson` (64 min). Row count went from
   4,759 → 4,601; the 158 non-simple rows are gone. Cross-validation
   now shows `Only in Johnson: 0` (was 158); `Only in Self-Join: 1,207`
   (unchanged — these are cycles Johnson legitimately misses at
   depth 6 on the giant SCC without hub partitioning, which is the
   expected limitation and is why `05-partitioned-cycles.js` exists).

**Verification query.**
```sql
SELECT COUNT(*) AS rows,
       COUNT(*) FILTER (
         WHERE array_length(path_bns, 1) =
               (SELECT COUNT(DISTINCT x) FROM unnest(path_bns) x)
       ) AS simple_rows
FROM cra.johnson_cycles;
-- rows 4,601 | simple_rows 4,601
```

---

## AB — Alberta Open Data (`ab.*`)

Every Alberta dataset is shipped as-is; no mitigation modifies source
rows.

### A-1. `ab_grants.fiscal_year` is not a canonical format — do not group by it — ✅ RESOLVED 2026-04-19

**Historical note.** Before the 2026-04-19 normalization sweep, the
`fiscal_year` column held three different formats: `"YYYY - YYYY"` for
most MongoDB-sourced rows, single-year `"2024"` for all 139,816 rows
from `tbf-grants-disclosure-2024-25.csv`, and calendar-date strings
(`"2023-04-06"` etc.) on 118 rows in FY 2023–24. Total non-canonical:
139,934 rows.

**Resolution.** `AB/scripts/09-normalize-grants.js` overwrote
`fiscal_year` with `display_fiscal_year` on every row (139,934 UPDATEs).
`fiscal_year` and `display_fiscal_year` are now identical across all
1,986,676 rows.

**Verification.**
```sql
SELECT COUNT(*) FROM ab.ab_grants
 WHERE fiscal_year IS DISTINCT FROM display_fiscal_year;
-- 0
```

### A-2. `ab_grants.lottery` is boolean-as-text with no CHECK constraint

**What's wrong.** The column stores string literals `"True"` / `"False"`
rather than PostgreSQL booleans, and the schema doesn't constrain the
value set. If the upstream source ever shifts to `Y`/`N`, lowercase, or a
new value, queries using `WHERE lottery = 'True'` will silently miss
rows.

**Evidence.** Schema check:
```sql
\d ab.ab_grants  -- lottery is TEXT, no CHECK constraint
```

**Count:** today, only `"True"` / `"False"` observed — but this is not
enforced.

**Mitigation.** 📝 Documented in `AB/docs/DATA_DICTIONARY.md`. ⚠️ A
CHECK constraint could be added on the next schema rev.

### A-3. `ab_sole_source.special` — semantics undocumented by publisher

**What's wrong.** Boolean-as-text column with two observed values. The
Alberta government does not publicly document what the flag means.

**Evidence.**
```sql
SELECT special, COUNT(*) FROM ab.ab_sole_source GROUP BY special;
-- true 9,911 | false 5,622
```

**Mitigation.** 📝 Documented as opaque in `AB/docs/DATA_DICTIONARY.md`.
⚠️ Authoritative mapping still needed from Alberta Service Alberta.

### A-4. `ab_sole_source.permitted_situations` letter codes are not publicly keyed

**What's wrong.** The Alberta government publishes the twelve
"permitted situations" as a numbered list on
[alberta.ca/sole-source-contracts](https://www.alberta.ca/sole-source-contracts)
but does **not** publish a letter-to-number codebook for the `a`–`l`, `z`
codes that appear in the data.

**Evidence.**
```sql
SELECT permitted_situations, COUNT(*)
FROM ab.ab_sole_source
GROUP BY permitted_situations ORDER BY count DESC;
-- d 7,825 | b 3,570 | g 2,280 | j 967 | h 334 | z 307 | i 94 | k 74 | c 38 | l 38 | f 4 | a 2
```

**Mitigation.** 📝 `AB/docs/DATA_DICTIONARY.md` contains a
positional-inference table mapping `a`–`l` to the numbered list (1–12),
with a clear caveat that Alberta has not confirmed the mapping. `z` is
documented as "outside the twelve permitted situations" per the Alberta
page.

### A-5. `ab_grants` aggregation tables double-count if `aggregation_type` isn't filtered

**What's wrong.** `ab_grants_ministries` and `ab_grants_programs` contain
two kinds of rows: `by_fiscal_year` (annual subtotals) *and* `all_years`
(all-time rollups). Joining naively against `ab_grants_fiscal_years` or
treating the table as annual counts double-counts the all-time rollup
line.

**Evidence.**
```sql
SELECT aggregation_type, COUNT(*) FROM ab.ab_grants_ministries GROUP BY aggregation_type;
-- all_years 61 | by_fiscal_year 260
```

**Mitigation.** 📝 `AB/docs/DATA_DICTIONARY.md` explicitly warns to
filter `aggregation_type = 'by_fiscal_year'` for period analyses.

### A-6. `ab_grants.amount` — 50,381 negative rows totalling -$13.11B

**What's wrong.** Alberta's publishing convention: negative amounts are
reversals/corrections, not errors. That convention is documented by the
publisher. Analysts unaware of it will double-count reversals.

**Evidence.**
```sql
SELECT CASE WHEN amount<0 THEN 'neg' WHEN amount=0 THEN 'zero'
            WHEN amount IS NULL THEN 'null' ELSE 'pos' END AS bucket,
       COUNT(*), ROUND(SUM(amount)::numeric,2)
FROM ab.ab_grants GROUP BY 1;
-- neg  50,381    (-$13,113,304,419.02)
-- zero  2,357    ($0.00)
-- null      4    ($0.00)
-- pos  1,933,934 ($492,371,029,631.96)
```

**Count:** 50,381 negative rows summing to -$13.11B (counts as of the
2026-04-19 reload that added FY 2024-25 + 2025-26 from CSV).

**Mitigation.** 📝 Documented in `AB/README.md`, `AB/CLAUDE.md`, and
`AB/docs/DATA_DICTIONARY.md`.

### A-7. Per-period aggregate tables stale after the 2026-04-19 reload — ✅ RESOLVED 2026-04-19

**Historical note.** Immediately after the TBF CSV reload, the
pre-rolled aggregate tables still reflected the pre-reload MongoDB
state: `ab_grants_fiscal_years` showed FY 2024-25 at 106,482 rows /
$35.30B (actual: 139,816 / $47.08B) and had **no row** for FY 2025-26
(actual: 180,468 / $50.22B). `ab_grants_ministries`, `_programs`, and
`_recipients` were similarly stale.

**Resolution.** `AB/scripts/09-normalize-grants.js` TRUNCATEs and
repopulates all four aggregate tables directly from `ab_grants`. Both
`by_fiscal_year` and `all_years` rollups are produced for `_ministries`
and `_programs`. Resulting row counts: `ab_grants_fiscal_years` = 12,
`ab_grants_ministries` = 352 (290 by_fiscal_year + 62 all_years),
`ab_grants_programs` = 20,208 (13,834 + 6,374),
`ab_grants_recipients` = 452,900.

**Verification.**
```sql
-- agg sums match grants sums for every fiscal year
SELECT g.display_fiscal_year, g.cnt AS grants_rows, f.count AS agg_rows,
       g.total AS grants_sum, f.total_amount AS agg_sum
FROM (SELECT display_fiscal_year, COUNT(*)::INT AS cnt,
             ROUND(SUM(amount)::numeric,2) AS total
      FROM ab.ab_grants GROUP BY display_fiscal_year) g
JOIN ab.ab_grants_fiscal_years f USING (display_fiscal_year)
ORDER BY g.display_fiscal_year;
-- All 12 rows: grants_rows = agg_rows, grants_sum = agg_sum (exact).
```

### A-8. `ab_grants.mongo_id` breaks ON CONFLICT idempotency — ✅ RESOLVED 2026-04-19

**Historical note.** The column carried a UNIQUE constraint and was
used by `03-import-grants.js` for ON CONFLICT. All 320,284 CSV-loaded
rows had `mongo_id = NULL`, making the CSV loader non-idempotent.

**Resolution.** `mongo_id` column dropped entirely from `ab_grants`
(including the `ab_grants_mongo_id_key` UNIQUE index). `01-migrate.js`
updated: column removed from CREATE TABLE and a defensive
`ALTER TABLE ... DROP COLUMN IF EXISTS mongo_id` added for existing
environments. `03-import-grants.js` updated: `mongo_id` removed from
the MongoDB-era transform and columns list, and the `ON CONFLICT
(mongo_id) DO NOTHING` clause removed from the bulk-insert SQL. That
loader now relies on its existing "skip if table has rows" guard for
idempotency.

**Verification.**
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema='ab' AND table_name='ab_grants' AND column_name='mongo_id';
-- (empty)
```

Columns `data_quality` and `data_quality_issues` were dropped at the
same time — they had been populated on 1,666,392 MongoDB-sourced rows
but were never used by any analysis script.

### A-9. CSV-sourced rows have NULL `lottery`, `lottery_fund`, `version`, `created_at`, `updated_at`

**What's wrong.** The TBF CSV disclosures for FY 2024-25 and 2025-26
ship only 9 columns (`Ministry`, `BUName`, `Recipient`, `Program`,
`Amount`, `Lottery`, `PaymentDate`, `FiscalYear`, `DisplayFiscalYear`),
and the `Lottery` column is **always empty** in both files. There is no
analogue at all for `lottery_fund`, `version`, `createdAt`, `updatedAt`.
All 320,284 CSV-sourced rows carry NULL for these five columns.

This means **`lottery` cannot be used as a filter for FY 2023-24, 2024-25,
or 2025-26**: the 2023-24 MongoDB data has numeric-string lottery values
(see A-2 for format mess), and the CSV years have nothing at all.

**Evidence.**
```sql
SELECT display_fiscal_year,
       COUNT(*) FILTER (WHERE lottery IS NULL) AS null_lottery,
       COUNT(*) AS rows
FROM ab.ab_grants
WHERE display_fiscal_year IN ('2024 - 2025','2025 - 2026')
GROUP BY display_fiscal_year;
-- 2024 - 2025 | 139,816 | 139,816
-- 2025 - 2026 | 180,468 | 180,468
```

**Count:** 320,284 rows (100% of CSV-sourced) with NULL `lottery` +
`lottery_fund` + `version` + `created_at` + `updated_at`.

**Mitigation.** ⚠️ Unmitigated. Analysts needing lottery-funded totals
must restrict to FY ≤ 2022-23 (where A-2's value-set risk also applies).
The CSV crosswalk at `AB/config/grants-csv-crosswalk.json` does map
`Lottery` → `lottery`, so if Alberta later ships a populated lottery
column in future TBF CSVs, no loader change is required.

### A-10. Publisher roll-up rows appear as `recipient IS NULL` + `payment_date IS NULL` with huge amounts

**What's wrong.** Alberta publishes some programme-level aggregates as
single rows with no recipient and no payment date — these are roll-ups
from the upstream finance system, not missing data. A handful of these
rows account for ~$25B of the two newest fiscal years' spend.

| FY | Rows | Total amount |
|----|------|--------------|
| 2024 - 2025 | 196 | $12,031,247,348.06 |
| 2025 - 2026 | 420 | $12,920,876,757.06 |

Examples: `HEALTH / PRIMARY CARE PHYSICAN - FFS OP` = $5.08B on one row;
`SENIORS, COMMUNITY AND SOCIAL SERVICES / AISH FINANCIAL ASSISTANCE
GRANTS` = $1.62B; `JOBS, ECONOMY AND TRADE / CHILD CARE-CANADA-WIDE
ELCC WORKER SUPP` = $466M. These are the individual-recipient pools
that Alberta chooses not to disclose at the person level (AISH
beneficiaries, per-physician FFS billings, income support recipients,
etc.).

**Evidence.**
```sql
SELECT display_fiscal_year, COUNT(*), ROUND(SUM(amount)::numeric,2) AS total
FROM ab.ab_grants
WHERE display_fiscal_year IN ('2024 - 2025','2025 - 2026')
  AND recipient IS NULL
GROUP BY display_fiscal_year;
```

**Count:** 616 rows / $24.95B for FY 2024-25 + 2025-26 alone. The
pattern exists in earlier years too but the CSV-sourced years
concentrate it visibly.

**Mitigation.** ⚠️ Unmitigated in schema. Any recipient-level
aggregation must either filter `recipient IS NOT NULL` (losing ~$25B of
real spend) or treat the NULL bucket as a distinct "undisclosed
individual recipients" category.

### A-11. Ministry rename / comma-normalization drift across years — ✅ PARTIALLY RESOLVED 2026-04-19

**Historical note.** The `ministry` column had three sources of drift:
(1) commas inserted or removed across years for the same ministry
(`"SENIORS COMMUNITY AND SOCIAL SERVICES"` vs `"SENIORS, COMMUNITY AND
SOCIAL SERVICES"`), (2) multiple simultaneous JOBS-economy variants in
FY 2025-26, (3) genuine cabinet reorganisations between years.

**Resolution.** `AB/scripts/09-normalize-grants.js` performed two data
normalizations across all fiscal years:

* **Comma stripping.** All commas in `ministry` and `business_unit_name`
  removed globally (7,713 rows updated in each column). Verification:
  `SELECT COUNT(*) FROM ab_grants WHERE ministry LIKE '%,%' OR
  business_unit_name LIKE '%,%'` → `0`.
* **JOBS family canonicalization.** Every ministry/BU value matching
  `UPPER(...) LIKE 'JOBS%ECONOMY%'` (`JOBS ECONOMY AND INNOVATION`,
  `JOBS ECONOMY AND NORTHERN DEVELOPMENT`, `JOBS ECONOMY AND TRADE`,
  `JOBS, ECONOMY AND TRADE`, `JOBS, ECONOMY, TRADE AND IMMIGRATION`,
  `JOBS, ECONOMY, TRADE AND MULTICULTURALISM`) rewritten to
  `JOBS ECONOMY TRADE AND IMMIGRATION` — 177,784 rows in `ministry`,
  177,786 in `business_unit_name`. The older `JOBS SKILLS TRAINING AND
  LABOUR` ministry (1,898 rows, pre-2016) was **not** folded in because
  it is a semantically different ministry.

**Remaining drift (unmitigated).** Genuine cabinet reorganisations still
produce distinct ministry names across years — e.g. `SENIORS AND
HOUSING` / `SENIORS COMMUNITY AND SOCIAL SERVICES` / `ASSISTED LIVING
AND SOCIAL SERVICES`. Longitudinal joins on `ministry` across cabinet
changes should still use `general/data/ministries-history.json` as the
predecessor/successor crosswalk.

**Evidence.**
```sql
SELECT ministry, display_fiscal_year, COUNT(*)
FROM ab.ab_grants
WHERE UPPER(ministry) LIKE 'SENIORS%SOCIAL SERVICES%'
   OR UPPER(ministry) LIKE 'JOBS%ECONOMY%'
GROUP BY ministry, display_fiscal_year
ORDER BY ministry, display_fiscal_year DESC;
```

**Count:** ≥ 6 rename events between FY 2022-23 and FY 2025-26.

**Mitigation.** 📝 `general/data/ministries-history.json` already tracks
Alberta ministry predecessors/successors for 2015-2026; it needs to be
cross-checked against the freshly loaded FY 2025-26 variants before
downstream joins (`general/scripts/11-ministries-history.js` is the
consumer).

### A-12. `ministry` and `business_unit_name` swapped for `ALBERTA SOCIAL HOUSING CORPORATION` — ✅ RESOLVED 2026-04-19

**Historical note.** `ALBERTA SOCIAL HOUSING CORPORATION` (ASHC) is a
Crown corporation, historically shown as the `business_unit_name` under
a parent ministry. The FY 2025-26 CSV introduced three problem patterns:
1,043 rows with `ministry="ALBERTA SOCIAL HOUSING CORPORATION"` and
`business_unit_name="ASSISTED LIVING AND SOCIAL SERVICES"` (swapped),
2,093 rows with ASHC in both columns, and 1,421 rows with the columns
in the historical orientation. Historical years (2020-21 through
2024-25, ~16,566 rows) had ASHC only as the `business_unit_name`.

**Resolution.** `AB/scripts/09-normalize-grants.js` folded every row
referencing ASHC (either column) into the current parent ministry:
`ministry = 'ASSISTED LIVING AND SOCIAL SERVICES'` and
`business_unit_name = 'ASSISTED LIVING AND SOCIAL SERVICES'`. 18,963
rows updated across FY 2020-21 through FY 2025-26.

**Trade-off.** This collapses historical rows that previously carried
the then-current parent ministry name (`SENIORS AND HOUSING`,
`SENIORS COMMUNITY AND SOCIAL SERVICES`) into the FY 2025-26 name. Any
longitudinal reconstruction of the original ministry-of-record requires
joining against `general/data/ministries-history.json`, not
`ab.ab_grants` alone.

**Verification.**
```sql
SELECT COUNT(*) FROM ab.ab_grants
 WHERE ministry = 'ALBERTA SOCIAL HOUSING CORPORATION'
    OR business_unit_name = 'ALBERTA SOCIAL HOUSING CORPORATION';
-- 0
```

### A-13. Exact-duplicate rows and perfect reversal pairs — `COUNT(*)` overstates distinct payments

**What's wrong.** The TBF CSV disclosures ship two patterns that make
raw row counts misleading:

1. **Exact duplicates.** Multiple rows with the identical
   `(ministry, business_unit_name, recipient, program, amount,
   payment_date)` tuple. These are real repeated micro-payments in the
   source system (e.g. 56× $82.50 `REMOTE AREA HEATING ALLOWANCE` to
   `METIS NATION OF ALBERTA ASSOCIATION LOCAL #125 FORT CHIPEWYAN` on
   2024-05-22). Not a loader bug, but `COUNT(DISTINCT ...)` versus
   `COUNT(*)` diverges significantly.

   | FY | Duplicate groups | Excess rows | Excess dollars if naive-summed |
   |----|------------------|-------------|--------------------------------|
   | 2024-25 | 1,270 | 2,269 | $604,249,782.45 |
   | 2025-26 | 1,743 | 3,288 | $7,310,429,568.58 |

2. **Perfect reversal pairs.** Same `(ministry, recipient, program)`
   with a positive amount and an exactly-offsetting negative amount
   (typical example: `-$7,000.00` and `+$7,000.00` posted on the same
   day). These net to $0 but inflate `COUNT(*)` by double.

   | FY | Matched pairs | ± magnitude (one-side) |
   |----|---------------|------------------------|
   | 2024-25 | 476 | $359,959,521.64 |
   | 2025-26 | 475 | $171,033,983.65 |

**Evidence (reversal pattern, 2025-26):**
```sql
WITH p AS (
  SELECT recipient, program, ministry, amount FROM ab.ab_grants
  WHERE display_fiscal_year = '2025 - 2026' AND amount > 0
), n AS (
  SELECT recipient, program, ministry, amount FROM ab.ab_grants
  WHERE display_fiscal_year = '2025 - 2026' AND amount < 0
)
SELECT COUNT(*), SUM(p.amount)
FROM p JOIN n USING (recipient, program, ministry)
WHERE p.amount = -n.amount;
-- 475 | 171,033,983.65
```

**Count:** 5,557 excess rows across the two years (2,269 + 3,288);
951 reversal pairs.

**Mitigation.** ⚠️ Unmitigated in the schema. Analysts producing
payment-count metrics should decide case by case whether to dedupe on
the full tuple or treat duplicates as real repeated micro-payments.
`general/splink/` entity-resolution paths dedupe at the recipient name
layer so are unaffected, but straight `COUNT(*)` on `ab_grants` is not
a reliable "payment count" metric.

---

## Active / unmitigated

- **F-7** NFP/for-profit recipients missing BN (47,102 rows). No format validator at ingest.
- **F-8** Missing `agreement_end_date` (187,866 rows).
- **F-9** `agreement_end_date < agreement_start_date` (947 rows).
- **C-4** Raw NULL/malformed/zero/negative counts in `cra_qualified_donees` are not a headline in any script.
- **C-5** Four `cra_identification` columns are 100% NULL — schema should drop them or doc them.
- **C-6** `cra_directors` NULL rates for `at_arms_length` (5%), `start_date` (10%), `first_name` (0.1%) not surfaced.
- ~~**C-9** Loop-detection output tables empty with orphan rollup IDs~~ — ✅ resolved 2026-04-19 (see Changelog).
- **C-10** `cra_political_activity_funding` is empty — investigation needed.
- ~~**A-1** `fiscal_year` non-canonical on 139,934 rows~~ — ✅ resolved 2026-04-19 (see Changelog).
- **A-2** `lottery` CHECK constraint not yet added.
- **A-3** `special` semantics still unsourced from Alberta.
- **A-4** `permitted_situations` letter→number mapping is positional inference; needs Alberta confirmation.
- ~~**A-7** Aggregate tables stale after CSV reload~~ — ✅ resolved 2026-04-19 (see Changelog).
- ~~**A-8** `mongo_id` NULL on 320,284 CSV rows~~ — ✅ resolved 2026-04-19 (column dropped, see Changelog).
- **A-9** CSV-sourced rows have NULL `lottery`/`lottery_fund`/`version`/`created_at`/`updated_at`; lottery filtering is unusable for FY ≥ 2023-24.
- **A-10** Publisher roll-up rows (`recipient IS NULL`) hold ~$25B across FY 2024-25 + 2025-26 alone; recipient-level aggregates must decide how to treat them.
- ~~**A-11** Comma / JOBS-variant drift across years~~ — ✅ partially resolved 2026-04-19; genuine cabinet-shuffle renames remain (use `general/data/ministries-history.json`).
- ~~**A-12** ASHC ministry/BU swap in FY 2025-26~~ — ✅ resolved 2026-04-19 (folded into `ASSISTED LIVING AND SOCIAL SERVICES`).
- **A-13** Exact-duplicate rows (5,557 excess across FY 2024-25 + 2025-26) and perfect reversal pairs (951 matched) make `COUNT(*)` unreliable as a "payment count".

## How to update this document

When a new defect is proven:

1. Append an entry under the relevant dataset using the same five-field
   structure (**What's wrong / Evidence / Count / Source / Mitigation**).
2. Assign the next unused ID (`F-12`, `C-12`, `A-7`).
3. If you add a mitigation (view, constraint, doc, filter), flip the
   status to ✅ and link the artefact.
4. On each data snapshot refresh, re-run the Evidence queries and update
   the count in place. Move the prior number to the Changelog below.

Re-run paths:

- CRA: `cd CRA && npm run data-quality` → repopulates
  `cra.donee_name_quality`, `cra.t3010_impossibilities`,
  `cra.t3010_plausibility_flags`, `cra.identification_name_history` and
  their Markdown reports.
- FED: `cd FED && npm run verify` → prints F-1, F-2, F-4, F-5 counts.
- AB: `cd AB && npm run verify` → prints A-1 warnings.

## Changelog

### 2026-04-19 (normalization sweep)

- **`AB/scripts/09-normalize-grants.js` run against `ab.ab_grants`.**
  All steps inside a single transaction. Row totals unchanged
  (1,986,676 rows, SUM(amount) = $479,257,725,212.94).
- **A-1 resolved.** `fiscal_year := display_fiscal_year` for 139,934
  rows; `fiscal_year !~ '^[0-9]{4} - [0-9]{4}$'` now returns 0.
- **A-7 resolved.** `ab_grants_fiscal_years` / `_ministries` /
  `_programs` / `_recipients` TRUNCATE+rebuilt from `ab_grants`. New
  row counts: 12 / 352 (290 by_fiscal_year + 62 all_years) / 20,208
  (13,834 + 6,374) / 452,900. Agg sums = raw sums for every fiscal
  year.
- **A-8 resolved.** Dropped columns `mongo_id`, `data_quality`,
  `data_quality_issues` from `ab_grants`. `01-migrate.js` updated to
  match (column removed from CREATE TABLE; DROP IF EXISTS added for
  existing environments). `03-import-grants.js` `mongo_id` and
  `ON CONFLICT (mongo_id) DO NOTHING` removed from the bulk-insert
  path; the loader now falls back on its "skip if table already
  populated" guard for idempotency.
- **A-11 partially resolved.** Stripped commas from every `ministry`
  and `business_unit_name` value globally (7,713 + 7,713 rows).
  Canonicalized every `JOBS%ECONOMY%` variant to `JOBS ECONOMY TRADE
  AND IMMIGRATION` (177,784 ministry + 177,786 BU rows). `JOBS SKILLS
  TRAINING AND LABOUR` (1,898 rows, 2014-2016) left intact as a
  semantically different historical ministry. Genuine cabinet-shuffle
  renames (`SENIORS AND HOUSING` → `SENIORS COMMUNITY AND SOCIAL
  SERVICES` → `ASSISTED LIVING AND SOCIAL SERVICES`) still require the
  `general/data/ministries-history.json` crosswalk.
- **A-12 resolved.** Every row where either `ministry` or
  `business_unit_name` was `ALBERTA SOCIAL HOUSING CORPORATION` (18,963
  rows across FY 2020-21 through FY 2025-26) rewritten so both columns
  read `ASSISTED LIVING AND SOCIAL SERVICES` — the current parent
  ministry. Trade-off: historical rows no longer carry their
  then-current parent-ministry name.

### 2026-04-19 (later)

- **AB grants reloaded for fiscal 2024-2025 and 2025-2026.** Deleted 106,482
  `ab.ab_grants` rows where `display_fiscal_year IN ('2024 - 2025','2025 - 2026')`
  (all 2024-2025 MongoDB-sourced; 2025-2026 had no prior rows). Re-imported
  from `AB/data/grants/tbf-grants-disclosure-2024-25.csv` (139,816 rows,
  SUM(amount)=$47,076,867,264.47) and `tbf-grants-disclosure-2025-26.csv`
  (180,468 rows, SUM(amount)=$50,221,793,893.21) via the new
  `AB/scripts/08-import-grants-csv.js` loader, which uses
  `AB/config/grants-csv-crosswalk.json` to map CSV headers to columns and
  normalises empty / whitespace-only values to NULL. Grants row count:
  1,772,874 → **1,986,676**. Fiscal-year coverage extended from 2014-2015
  through 2023-2024 (+2024-2025 reload) to 2014-2015 through **2025-2026**.
- **Post-reload DQ sweep added A-7 through A-13 and expanded A-1/A-6.**
  Findings: (A-1 expanded) `fiscal_year` column now holds three formats —
  single-year `"2024"` for 139,816 FY 2024-25 CSV rows plus the 118
  calendar-date contaminants from FY 2023-24, total 139,934 non-canonical
  rows. (A-6 refreshed) negative rows now 50,381 totalling -$13.11B.
  (A-7) aggregate tables stale: `ab_grants_fiscal_years` under-reports
  FY 2024-25 by $11.78B and is missing FY 2025-26 entirely. (A-8) all
  320,284 CSV rows have NULL `mongo_id` — `08-import-grants-csv.js` is
  non-idempotent without pre-delete. (A-9) same rows have NULL
  `lottery`/`lottery_fund`/`version`/`created_at`/`updated_at`; the
  `Lottery` column in both TBF CSVs is entirely blank. (A-10) 616
  publisher roll-up rows (`recipient IS NULL`) account for $24.95B
  across the two new years. (A-11) ministry-name drift documented
  (comma/no-comma variants + cabinet renames; 3 simultaneous
  `JOBS, ECONOMY, TRADE ...` spellings in FY 2025-26). (A-12)
  1,043 FY 2025-26 rows have `ministry`/`business_unit_name` swapped
  for `ALBERTA SOCIAL HOUSING CORPORATION`, plus 2,093 both-ASHC
  ambiguous rows. (A-13) 5,557 excess exact-duplicate rows and 951
  perfect-reversal pairs across the two CSV years.

### 2026-04-19

- Document created. Snapshot counts reflect the data as loaded on Render
  on this date. All FED counts calculated from 1,275,521 rows; CRA from
  421,866 `cra_identification` rows / 1,664,343 `cra_qualified_donees`
  rows / 420,849 financial filings; AB from 1,772,874 grant rows.
- Mitigations landed in this session: `fed.vw_agreement_current`,
  `fed.vw_agreement_originals`, `FED/docs/DATA_DICTIONARY.md` "How to
  sum" section, `FED/CLAUDE.md` Important Notes rewrite,
  `FED/scripts/05-verify.js` DQ reporters, `AB/docs/DATA_DICTIONARY.md`
  (new file).
- **C-9 resolved.** Ran `npm run analyze:full` against the Render DB
  after dropping all 13 loop/SCC/matrix/financial tables. Total wall
  clock ~4h 20min (6-hop cycle detection 2h 34min, Johnson on full graph
  1h 21min, matrix census 4m 52s, scorer 4m). New row counts —
  `loops` 5,808 (2-hop 508, 3-hop 236, 4-hop 472, 5-hop 1,161, 6-hop
  3,431), `loop_universe` 1,501 (all scored 0–23, top CANADA GIVES at
  23/30), `loop_participants` 30,003, `loop_edges` 53,771,
  `partitioned_cycles` 108, `identified_hubs` 20, `johnson_cycles`
  4,759, `matrix_census` 10,177, `scc_components` 10,177, `scc_summary`
  347. `loop_financials` now references `loops` 1:1 (no orphans).
- **C-12 resolved.** `06-johnson-cycles.js` was emitting 158 non-simple
  cycles (22 at 5-hop, 136 at 6-hop) due to the block/unblock invariant
  failing on this graph's hub-dense giant SCC. Added an O(n)
  simplicity guard at the authoritative cycle-recording point in
  `circuit()`, then dropped `cra.johnson_cycles` (surgical, other
  tables untouched) and re-ran `npm run analyze:johnson` (~64 min).
  Row count 4,759 → 4,601; post-fix `Only in Johnson: 0` (was 158).
- **Three permanent fixes landed so C-9 cannot recur silently.**
  (1) `migrate()` is now unconditional in `CRA/scripts/advanced/01`,
  `03`, `04`, `05`, `06` — removed the `--migrate` gate so future runs
  against a freshly dropped DB self-bootstrap.
  (2) `CRA/scripts/advanced/01-detect-all-loops.js` now declares the
  `score int` / `scored_at timestamptz` columns on `cra.loop_universe`
  and idempotently `ALTER TABLE ADD COLUMN IF NOT EXISTS`es them onto
  pre-existing DBs — previous schema drift caused `02-score-universe.js`
  to crash on the final write-back.
  (3) New `CRA/scripts/drop-loop-tables.js` + `npm run drop:loops` +
  `npm run analyze:full` supports a documented clean-slate re-run in
  dependency order (01 → 03 → 05 → 06 → 04 → 07 → 02). `CRA/README.md`
  and `CRA/CLAUDE.md` updated with the new commands.
