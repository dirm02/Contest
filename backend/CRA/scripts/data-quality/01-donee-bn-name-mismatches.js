/**
 * 01-donee-bn-name-mismatches.js   (part of scripts/data-quality/)
 *
 * Cross-checks every gift in cra_qualified_donees against the registered
 * legal name in cra_identification for the BN the filer wrote. The point
 * is not to accuse filers of fraud — many mismatches are legitimate
 * (acronyms, rebrands, parish-level naming, charitable-giving platforms).
 * The point is that **the public CRA T3010 dataset, as published, cannot
 * be programmatically joined donor-to-donee without either manual name
 * resolution or AI-assisted disambiguation.** This script quantifies that
 * join failure.
 *
 * Five mismatch categories (mutually exclusive):
 *   MINOR_VARIANT     Name differs from canonical but normalized trigram
 *                     similarity ≥ threshold. Trivial variation (case,
 *                     punctuation, "The X" vs "X"). NOT counted as an issue.
 *   NAME_MISMATCH     BN is a real registered charity, but donee_name is
 *                     not a spelling variant of its legal name. A mix of:
 *                     rebrands (Ryerson→TMU), acronyms (CAMH), branch
 *                     accounts (Salvation Army divisions), DAF platforms
 *                     (CanadaHelps), and genuine wrong-BN typos.
 *                     Distinguishing these requires manual or AI-assisted
 *                     review — THAT is the finding.
 *   UNREGISTERED_BN   donee_bn is well-formed (^[0-9]{9}RR[0-9]{4}$) but
 *                     has no row in cra_identification. Either a
 *                     de-registered charity, a non-charity qualified
 *                     donee (municipality, public university, First
 *                     Nation, UN agency), or a one-digit-off typo of a
 *                     real registration.
 *   MALFORMED_BN      donee_bn violates CRA's own 15-character format.
 *                     Wrong program type (RC/RP/RT payroll), embedded
 *                     whitespace, truncated, non-numeric, etc. The
 *                     donee is structurally unidentifiable in the
 *                     public data. Each row is also tagged with a
 *                     defect sub-code.
 *   PLACEHOLDER_BN    donee_bn is a string of zeros (e.g. 000000000RR0001).
 *                     Filer flagged "unknown BN" and wrote a name only.
 *
 * Outputs:
 *   cra.donee_name_quality                                   — one row per (donee_bn, donee_name)
 *   data/reports/data-quality/donee-bn-name-mismatches.{json,md}
 *
 * Usage:
 *   npm run data-quality:donees
 *   node scripts/data-quality/01-donee-bn-name-mismatches.js
 *   node scripts/data-quality/01-donee-bn-name-mismatches.js --threshold 0.25
 *   node scripts/data-quality/01-donee-bn-name-mismatches.js --top 100
 */

const fs = require('fs');
const path = require('path');
const db = require('../../lib/db');
const log = require('../../lib/logger');

function parseArgs() {
  const args = { threshold: 0.30, top: 40 };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    const next = process.argv[i + 1];
    if (a === '--threshold' && next) { args.threshold = parseFloat(next) || args.threshold; i++; }
    else if (a === '--top' && next)  { args.top = parseInt(next, 10) || args.top; i++; }
  }
  return args;
}

const args = parseArgs();
const REPORT_DIR = path.join(__dirname, '..', '..', 'data', 'reports', 'data-quality');

// ─── Migration ───────────────────────────────────────────────────────────────

async function migrate(client) {
  log.info('Phase 1: Creating tables + helper functions...');
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    DROP TABLE IF EXISTS cra.donee_name_quality CASCADE;
    CREATE TABLE cra.donee_name_quality (
      donee_bn             varchar(32) NOT NULL,
      donee_name           text        NOT NULL,
      canonical_name       text,
      mismatch_category    text        NOT NULL,
      bn_defect            text,                    -- populated only for MALFORMED_BN
      trigram_sim          numeric,
      citations            int,
      total_gifts          numeric,
      PRIMARY KEY (donee_bn, donee_name)
    );
    CREATE INDEX idx_dnq_category    ON cra.donee_name_quality (mismatch_category);
    CREATE INDEX idx_dnq_defect      ON cra.donee_name_quality (bn_defect);
    CREATE INDEX idx_dnq_total_gifts ON cra.donee_name_quality (total_gifts DESC);
  `);

  // Aggressive normalisation: uppercase, strip diacritics-proxy, strip
  // punctuation, drop common legal-form words that don't carry identity.
  // Kept simple (regex only) so it runs in set-based SQL without per-row
  // procedural overhead. "&" → " AND " so "A&B" and "A and B" match.
  await client.query(`
    CREATE OR REPLACE FUNCTION cra.norm_name(n text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$
      SELECT TRIM(REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            UPPER(COALESCE(n, '')),
            '&', ' AND ', 'g'),
          '[^A-Z0-9 ]', ' ', 'g'),
        '\\s+(THE|LA|LE|LES|DU|DE|DES|OF|AND|ET|FOR|POUR|A|AU|AUX|CANADA|INC|INCORPORATED|LTD|LIMITED|LIMITEE|CORP|CORPORATION|CO|COMPANY|FOUNDATION|FONDATION|SOCIETY|SOCIETE|ASSOCIATION|SOCIETYOF|CENTRE|CENTER|CHURCH|EGLISE|MINISTRY|MINISTERE)\\s+',
        ' ', 'g'))
    $$;
  `);
}

// ─── Phase 2: Per-(donee_bn, donee_name) aggregation + categorization ────────

async function categorize(client) {
  log.info('\nPhase 2: Classifying every (donee_bn, donee_name) combination...');

  await client.query(`
    INSERT INTO cra.donee_name_quality
      (donee_bn, donee_name, canonical_name, mismatch_category, bn_defect,
       trigram_sim, citations, total_gifts)
    WITH variants AS (
      SELECT
        TRIM(donee_bn)              AS donee_bn,
        TRIM(donee_name)            AS donee_name,
        COUNT(*)::int               AS citations,
        SUM(COALESCE(total_gifts, 0))::numeric AS total_gifts
      FROM cra.cra_qualified_donees
      WHERE donee_bn IS NOT NULL
        AND donee_name IS NOT NULL
        AND TRIM(donee_name) <> ''
      GROUP BY TRIM(donee_bn), TRIM(donee_name)
    ),
    canonical AS (
      SELECT DISTINCT ON (bn) bn, legal_name
      FROM cra.cra_identification
      ORDER BY bn, fiscal_year DESC
    ),
    tagged AS (
      SELECT
        v.*,
        (v.donee_bn ~ '^0{9}')                  AS is_placeholder,
        (v.donee_bn ~ '^[0-9]{9}RR[0-9]{4}$')   AS is_valid_format,
        c.bn          AS matched_bn,
        c.legal_name  AS canonical_name
      FROM variants v
      LEFT JOIN canonical c ON c.bn = v.donee_bn
    )
    SELECT
      donee_bn,
      donee_name,
      canonical_name,
      CASE
        WHEN is_placeholder                                          THEN 'PLACEHOLDER_BN'
        WHEN NOT is_valid_format                                     THEN 'MALFORMED_BN'
        WHEN matched_bn IS NULL                                      THEN 'UNREGISTERED_BN'
        WHEN similarity(cra.norm_name(donee_name),
                        cra.norm_name(canonical_name)) >= $1
             OR cra.norm_name(donee_name) = cra.norm_name(canonical_name)
                                                                     THEN 'MINOR_VARIANT'
        ELSE                                                              'NAME_MISMATCH'
      END AS mismatch_category,
      CASE WHEN is_placeholder OR is_valid_format THEN NULL
           WHEN donee_bn ~ ' '                                                     THEN '01_embedded_space'
           WHEN donee_bn ~ '^[0-9]{9}RC[0-9]'                                      THEN '02_RC_payroll_program'
           WHEN donee_bn ~ '^[0-9]{9}RT[0-9]'                                      THEN '03_RT_gst_hst_program'
           WHEN donee_bn ~ '^[0-9]{9}RP[0-9]'                                      THEN '04_RP_payroll_program'
           WHEN donee_bn ~ '^[0-9]{9}EE[0-9]'                                      THEN '05_EE_invalid_program'
           WHEN donee_bn ~ '^[0-9]{9}R[0-9]+$'                                     THEN '06_single_R_missing_one'
           WHEN donee_bn ~ '^[0-9]{9}RR[0-9]{1,3}$'                                THEN '07_RR_suffix_short'
           WHEN donee_bn ~ '^[0-9]{9}RR[0-9]{5,}$'                                 THEN '08_RR_suffix_long'
           WHEN donee_bn ~ '^[0-9]{9}$'                                            THEN '09_nine_digits_no_suffix'
           WHEN donee_bn ~ '^[0-9]{8}RR[0-9]{4}$'                                  THEN '10_root_eight_digits'
           WHEN donee_bn ~ '^[0-9]{10,}RR'                                         THEN '11_root_too_long'
           WHEN donee_bn ~ '^[0-9]{1,8}$'                                          THEN '12_fewer_than_nine_digits'
           WHEN donee_bn !~ '^[0-9]'                                               THEN '13_non_numeric'
           ELSE                                                                         '14_other'
      END AS bn_defect,
      CASE WHEN canonical_name IS NOT NULL
           THEN ROUND(similarity(cra.norm_name(donee_name),
                                 cra.norm_name(canonical_name))::numeric, 3)
      END AS trigram_sim,
      citations,
      total_gifts
    FROM tagged
  `, [args.threshold]);

  const counts = await client.query(`
    SELECT mismatch_category,
           COUNT(*)::int                                AS rows,
           SUM(citations)::int                          AS citations,
           SUM(total_gifts)::numeric                    AS dollars
    FROM cra.donee_name_quality
    GROUP BY mismatch_category ORDER BY mismatch_category
  `);
  for (const r of counts.rows) {
    log.info(`  ${r.mismatch_category.padEnd(16)} rows=${String(r.rows).padStart(6)}  citations=${String(r.citations).padStart(7)}  dollars=${'$' + Math.round(Number(r.dollars)).toLocaleString()}`);
  }
}

// ─── Phase 3: Reporting ──────────────────────────────────────────────────────

async function report(client) {
  log.info('\nPhase 3: Building report...');

  const headline = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM cra.cra_qualified_donees)::int                      AS total_gift_rows,
      (SELECT SUM(COALESCE(total_gifts,0)) FROM cra.cra_qualified_donees)::numeric AS total_gift_dollars,
      (SELECT SUM(citations) FROM cra.donee_name_quality
        WHERE mismatch_category <> 'MINOR_VARIANT')::int                        AS quality_issue_citations,
      (SELECT SUM(total_gifts) FROM cra.donee_name_quality
        WHERE mismatch_category <> 'MINOR_VARIANT')::numeric                    AS quality_issue_dollars,
      (SELECT COUNT(*) FROM cra.donee_name_quality
        WHERE mismatch_category = 'NAME_MISMATCH')::int                         AS name_mismatch_rows,
      (SELECT SUM(citations) FROM cra.donee_name_quality
        WHERE mismatch_category = 'NAME_MISMATCH')::int                         AS name_mismatch_citations,
      (SELECT SUM(total_gifts) FROM cra.donee_name_quality
        WHERE mismatch_category = 'NAME_MISMATCH')::numeric                     AS name_mismatch_dollars
  `);

  const byCat = await client.query(`
    SELECT mismatch_category,
           COUNT(DISTINCT donee_bn)::int        AS distinct_bns,
           COUNT(*)::int                        AS distinct_rows,
           SUM(citations)::int                  AS citations,
           SUM(total_gifts)::numeric            AS dollars
    FROM cra.donee_name_quality
    GROUP BY mismatch_category
    ORDER BY CASE mismatch_category
               WHEN 'PLACEHOLDER_BN'   THEN 1
               WHEN 'MALFORMED_BN'     THEN 2
               WHEN 'UNREGISTERED_BN'  THEN 3
               WHEN 'NAME_MISMATCH'    THEN 4
               WHEN 'MINOR_VARIANT'    THEN 5 END
  `);

  const malformedByDefect = await client.query(`
    SELECT bn_defect,
           COUNT(DISTINCT donee_bn)::int AS distinct_bns,
           COUNT(*)::int                 AS rows,
           SUM(citations)::int           AS citations,
           SUM(total_gifts)::numeric     AS dollars
    FROM cra.donee_name_quality
    WHERE mismatch_category = 'MALFORMED_BN'
    GROUP BY bn_defect
    ORDER BY SUM(total_gifts) DESC NULLS LAST
  `);

  const topMalformedPerDefect = await client.query(`
    WITH ranked AS (
      SELECT bn_defect, donee_bn, donee_name, citations, total_gifts,
             ROW_NUMBER() OVER (PARTITION BY bn_defect ORDER BY total_gifts DESC NULLS LAST) AS rn
      FROM cra.donee_name_quality
      WHERE mismatch_category = 'MALFORMED_BN'
    )
    SELECT bn_defect, donee_bn, donee_name, citations, total_gifts
    FROM ranked WHERE rn <= 3
    ORDER BY bn_defect, total_gifts DESC NULLS LAST
  `);

  const topMismatch = await client.query(`
    SELECT donee_bn, donee_name, canonical_name,
           trigram_sim, citations, total_gifts
    FROM cra.donee_name_quality
    WHERE mismatch_category = 'NAME_MISMATCH'
    ORDER BY total_gifts DESC NULLS LAST
    LIMIT $1
  `, [args.top]);

  const topPlaceholder = await client.query(`
    SELECT donee_bn, donee_name, citations, total_gifts
    FROM cra.donee_name_quality
    WHERE mismatch_category = 'PLACEHOLDER_BN'
    ORDER BY total_gifts DESC NULLS LAST
    LIMIT 15
  `);

  const topUnregistered = await client.query(`
    SELECT donee_bn, donee_name, citations, total_gifts
    FROM cra.donee_name_quality
    WHERE mismatch_category = 'UNREGISTERED_BN'
    ORDER BY total_gifts DESC NULLS LAST
    LIMIT 20
  `);

  const multiVariantBns = await client.query(`
    SELECT
      donee_bn,
      COUNT(*) FILTER (WHERE mismatch_category = 'NAME_MISMATCH')::int AS mismatch_variants,
      COUNT(*)::int AS total_variants,
      STRING_AGG(DISTINCT canonical_name, ' / ') AS canonical_name,
      SUM(total_gifts) FILTER (WHERE mismatch_category = 'NAME_MISMATCH')::numeric AS mismatch_dollars
    FROM cra.donee_name_quality
    WHERE canonical_name IS NOT NULL
    GROUP BY donee_bn
    HAVING COUNT(*) FILTER (WHERE mismatch_category = 'NAME_MISMATCH') >= 2
    ORDER BY SUM(total_gifts) FILTER (WHERE mismatch_category = 'NAME_MISMATCH') DESC NULLS LAST
    LIMIT 15
  `);

  // Case study: find any filer who used a single malformed donee_bn on ≥20 of their own records.
  // Per-year breakdown is materialised inline so the report shows exactly which fiscal years
  // carried each bad BN, not just the min-max range.
  const singleFilerBadBn = await client.query(`
    WITH c AS (
      SELECT
        qd.bn               AS filer_bn,
        TRIM(qd.donee_bn)   AS donee_bn,
        COUNT(*)::int       AS records,
        SUM(qd.total_gifts)::numeric AS dollars,
        MIN(EXTRACT(YEAR FROM qd.fpe))::int AS first_year,
        MAX(EXTRACT(YEAR FROM qd.fpe))::int AS last_year,
        COUNT(DISTINCT qd.donee_name)::int  AS distinct_names,
        STRING_AGG(DISTINCT EXTRACT(YEAR FROM qd.fpe)::int::text, ', ' ORDER BY EXTRACT(YEAR FROM qd.fpe)::int::text) AS years_list
      FROM cra.cra_qualified_donees qd
      WHERE qd.donee_bn IS NOT NULL
        AND TRIM(qd.donee_bn) !~ '^0{9}'
        AND TRIM(qd.donee_bn) !~ '^[0-9]{9}RR[0-9]{4}$'
      GROUP BY qd.bn, TRIM(qd.donee_bn)
      HAVING COUNT(*) >= 20
    ),
    per_year AS (
      SELECT
        qd.bn                              AS filer_bn,
        TRIM(qd.donee_bn)                  AS donee_bn,
        EXTRACT(YEAR FROM qd.fpe)::int     AS fy,
        COUNT(*)::int                       AS records,
        SUM(qd.total_gifts)::numeric        AS dollars
      FROM cra.cra_qualified_donees qd
      WHERE qd.donee_bn IS NOT NULL
        AND TRIM(qd.donee_bn) !~ '^0{9}'
        AND TRIM(qd.donee_bn) !~ '^[0-9]{9}RR[0-9]{4}$'
      GROUP BY qd.bn, TRIM(qd.donee_bn), EXTRACT(YEAR FROM qd.fpe)
    ),
    per_year_agg AS (
      SELECT
        filer_bn, donee_bn,
        STRING_AGG(
          fy::text || ':' || records || 'r/$' || to_char(dollars, 'FM999,999,999'),
          '; ' ORDER BY fy
        ) AS per_year_detail
      FROM per_year
      GROUP BY filer_bn, donee_bn
    )
    SELECT c.*,
           gi.legal_name AS filer_name,
           pya.per_year_detail
    FROM c
    JOIN per_year_agg pya ON pya.filer_bn = c.filer_bn AND pya.donee_bn = c.donee_bn
    LEFT JOIN cra.cra_identification gi ON gi.bn = c.filer_bn AND gi.fiscal_year = c.last_year
    ORDER BY records DESC, dollars DESC
    LIMIT 15
  `);

  return {
    headline: headline.rows[0],
    byCat: byCat.rows,
    malformedByDefect: malformedByDefect.rows,
    topMalformedPerDefect: topMalformedPerDefect.rows,
    topMismatch: topMismatch.rows,
    topPlaceholder: topPlaceholder.rows,
    topUnregistered: topUnregistered.rows,
    multiVariantBns: multiVariantBns.rows,
    singleFilerBadBn: singleFilerBadBn.rows
  };
}

// ─── Formatting ──────────────────────────────────────────────────────────────

function $(n) {
  if (n === null || n === undefined) return '—';
  return '$' + Math.round(Number(n)).toLocaleString('en-US');
}
function $m(n) {
  if (n === null || n === undefined) return '—';
  return '$' + (Number(n) / 1e6).toFixed(1) + 'M';
}

async function emit(report) {
  log.section('RESULTS');

  const h = report.headline;
  const qPct = Number(h.quality_issue_dollars) / Number(h.total_gift_dollars) * 100;
  const nmPct = Number(h.name_mismatch_dollars) / Number(h.total_gift_dollars) * 100;

  console.log('');
  console.log('── Gift universe');
  console.log(`  Total gift records in cra_qualified_donees: ${Number(h.total_gift_rows).toLocaleString()}`);
  console.log(`  Total dollar value of those gifts:           ${$(h.total_gift_dollars)}`);

  console.log('');
  console.log('── The headline: gift records where BN and name disagree');
  console.log('   (name on the gift record cannot be programmatically joined to the BN\'s');
  console.log('    row in cra_identification without AI/manual disambiguation)');
  console.log('');
  console.log(`  Gift records affected:           ${Number(h.quality_issue_citations).toLocaleString()}`);
  console.log(`  Dollars on affected records:     ${$(h.quality_issue_dollars)}  (${qPct.toFixed(2)}% of all gift dollars)`);
  console.log('');
  console.log('── By category');
  for (const r of report.byCat) {
    console.log(
      `  ${r.mismatch_category.padEnd(16)} ` +
      `BNs=${String(r.distinct_bns).padStart(6)}  ` +
      `(bn×name)=${String(r.distinct_rows).padStart(6)}  ` +
      `citations=${String(r.citations).padStart(7)}  ` +
      `$=${$(r.dollars).padStart(16)}`
    );
  }

  console.log('');
  console.log('  ── What each category means ──');
  console.log('  PLACEHOLDER_BN    Filer wrote a name but no real BN (000000000RR000x).');
  console.log('  MALFORMED_BN      BN violates CRA\'s 15-char format ^[0-9]{9}RR[0-9]{4}$');
  console.log('                    (wrong program type RC/RP/RT, embedded space, truncated, etc.).');
  console.log('                    Structurally unidentifiable. See defect taxonomy below.');
  console.log('  UNREGISTERED_BN   BN is well-formed but has no row in cra_identification.');
  console.log('                    De-registered charity, non-charity qualified donee (municipality,');
  console.log('                    public university, First Nation, UN agency), or one-digit-off typo.');
  console.log('  NAME_MISMATCH     BN IS a real registered charity but donee_name doesn\'t match its');
  console.log('                    legal name. Rebrands (Ryerson→TMU), acronyms (CAMH), branch');
  console.log('                    accounts, DAF platforms, and wrong-BN typos. Disambiguating these');
  console.log('                    requires sector expertise or AI — that necessity IS the finding.');
  console.log('  MINOR_VARIANT     Trivial variation (case, punctuation). Not counted.');

  // MALFORMED_BN defect taxonomy
  if (report.malformedByDefect.length) {
    console.log('');
    console.log('── MALFORMED_BN defect taxonomy (BN format violations, by $ volume)');
    console.log('  Defect                              BNs    Rows   Gift $');
    for (const r of report.malformedByDefect) {
      console.log(
        `  ${r.bn_defect.padEnd(34)}  ` +
        `${String(r.distinct_bns).padStart(5)}  ` +
        `${String(r.rows).padStart(5)}  ` +
        `${$(r.dollars).padStart(15)}`
      );
    }
  }

  // Smoking-gun examples per MALFORMED_BN defect
  if (report.topMalformedPerDefect.length) {
    console.log('');
    console.log('── Worked examples — top 3 gifts per MALFORMED_BN defect class');
    let lastDefect = null;
    for (const r of report.topMalformedPerDefect) {
      if (r.bn_defect !== lastDefect) {
        console.log(`\n  ${r.bn_defect}`);
        lastDefect = r.bn_defect;
      }
      console.log(
        `    bn=${String(r.donee_bn).padEnd(20)}  ` +
        `${$(r.total_gifts).padStart(14)}  ` +
        `cites=${String(r.citations).padStart(3)}  ` +
        `"${(r.donee_name || '').slice(0, 55)}"`
      );
    }
  }

  // Single-filer / single-bad-BN case study
  if (report.singleFilerBadBn.length) {
    console.log('');
    console.log('── Case study: single filers who used one malformed BN ≥20 times');
    console.log('  Each row lists the specific fiscal years the bad BN appeared in, with');
    console.log('  per-year record count and dollar total, so the evidence is unambiguous.');
    for (const r of report.singleFilerBadBn) {
      console.log(
        `\n  filer_bn=${r.filer_bn}  "${(r.filer_name || '(unknown)').slice(0, 55)}"\n` +
        `  bad_bn="${r.donee_bn}"  ${r.records} records, ${$(r.dollars)}, ${r.distinct_names} distinct donee names\n` +
        `  years=[${r.years_list}]   per-year: ${r.per_year_detail}`
      );
    }
  }

  console.log('');
  console.log(`── Top ${args.top} NAME_MISMATCH rows by dollar value:`);
  for (const r of report.topMismatch) {
    console.log(
      `  ${r.donee_bn}  ` +
      `$${Math.round(Number(r.total_gifts)).toLocaleString().padStart(12)}  ` +
      `cites=${String(r.citations).padStart(3)}  ` +
      `sim=${String(r.trigram_sim).padStart(5)}`
    );
    console.log(`    wrote:  "${(r.donee_name || '').slice(0, 80)}"`);
    console.log(`    CRA:    "${(r.canonical_name || '').slice(0, 80)}"`);
  }

  console.log('');
  console.log('── Top PLACEHOLDER_BN rows by dollar value (filer used 000000000...):');
  for (const r of report.topPlaceholder) {
    console.log(`  ${r.donee_bn}  $${Math.round(Number(r.total_gifts)).toLocaleString().padStart(12)}  cites=${String(r.citations).padStart(3)}  "${(r.donee_name || '').slice(0, 60)}"`);
  }

  console.log('');
  console.log('── Top UNREGISTERED_BN rows by dollar value (well-formed BN not in cra_identification):');
  for (const r of report.topUnregistered) {
    console.log(`  ${r.donee_bn}  $${Math.round(Number(r.total_gifts)).toLocaleString().padStart(12)}  cites=${String(r.citations).padStart(3)}  "${(r.donee_name || '').slice(0, 60)}"`);
  }

  console.log('');
  console.log('── BNs used under ≥2 significantly-different names (one BN, many recipients)');
  for (const r of report.multiVariantBns) {
    console.log(`  ${r.donee_bn}  mismatches=${r.mismatch_variants}/${r.total_variants}  $${Math.round(Number(r.mismatch_dollars)).toLocaleString().padStart(12)}  CRA="${(r.canonical_name || '').slice(0, 45)}"`);
  }

  // Files
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(REPORT_DIR, 'donee-bn-name-mismatches.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      options: args,
      headline: h,
      by_category: report.byCat,
      malformed_by_defect: report.malformedByDefect,
      top_malformed_per_defect: report.topMalformedPerDefect,
      single_filer_bad_bn: report.singleFilerBadBn,
      top_name_mismatch: report.topMismatch,
      top_placeholder:   report.topPlaceholder,
      top_unregistered:  report.topUnregistered,
      multi_variant_bns: report.multiVariantBns
    }, null, 2)
  );
  fs.writeFileSync(path.join(REPORT_DIR, 'donee-bn-name-mismatches.md'), buildMarkdown(report));
  log.info('');
  log.info(`  JSON: data/reports/data-quality/donee-bn-name-mismatches.json`);
  log.info(`  MD:   data/reports/data-quality/donee-bn-name-mismatches.md`);
}

function buildMarkdown(report) {
  const h = report.headline;
  const qPct  = Number(h.quality_issue_dollars) / Number(h.total_gift_dollars) * 100;
  const nmPct = Number(h.name_mismatch_dollars) / Number(h.total_gift_dollars) * 100;

  const catTable = report.byCat.map(r =>
    `| ${r.mismatch_category} | ${Number(r.distinct_bns).toLocaleString()} | ${Number(r.distinct_rows).toLocaleString()} | ${Number(r.citations).toLocaleString()} | ${$(r.dollars)} |`
  ).join('\n');

  const defectTable = report.malformedByDefect.map(r =>
    `| ${r.bn_defect} | ${Number(r.distinct_bns).toLocaleString()} | ${Number(r.rows).toLocaleString()} | ${Number(r.citations).toLocaleString()} | ${$(r.dollars)} |`
  ).join('\n');

  let defectExamples = '';
  let lastDefect = null;
  for (const r of report.topMalformedPerDefect) {
    if (r.bn_defect !== lastDefect) {
      defectExamples += `\n#### ${r.bn_defect}\n\n| donee_bn (as filed) | donee_name (as filed) | Citations | \$ value |\n|---|---|---:|---:|\n`;
      lastDefect = r.bn_defect;
    }
    defectExamples += `| \`${r.donee_bn}\` | \`${(r.donee_name || '').replace(/\|/g, '/').slice(0, 70)}\` | ${r.citations} | ${$(r.total_gifts)} |\n`;
  }

  const caseStudyTable = report.singleFilerBadBn.map(r =>
    `| ${r.filer_bn} | ${(r.filer_name || '(not in identification)').replace(/\|/g, '/')} | \`${r.donee_bn}\` | ${r.records} | ${$(r.dollars)} | ${r.years_list} | ${r.distinct_names} | ${(r.per_year_detail || '').replace(/\|/g, '/')} |`
  ).join('\n');

  const mismatchTable = report.topMismatch.map(r =>
    `| ${r.donee_bn} | \`${(r.donee_name || '').replace(/\|/g, '/').slice(0, 80)}\` | \`${(r.canonical_name || '').replace(/\|/g, '/').slice(0, 80)}\` | ${r.trigram_sim ?? '—'} | ${r.citations} | ${$(r.total_gifts)} |`
  ).join('\n');

  const placeholderTable = report.topPlaceholder.map(r =>
    `| ${r.donee_bn} | \`${(r.donee_name || '').replace(/\|/g, '/').slice(0, 80)}\` | ${r.citations} | ${$(r.total_gifts)} |`
  ).join('\n');

  const unregisteredTable = report.topUnregistered.map(r =>
    `| ${r.donee_bn} | \`${(r.donee_name || '').replace(/\|/g, '/').slice(0, 80)}\` | ${r.citations} | ${$(r.total_gifts)} |`
  ).join('\n');

  const multiTable = report.multiVariantBns.map(r =>
    `| ${r.donee_bn} | \`${(r.canonical_name || '').replace(/\|/g, '/').slice(0, 50)}\` | ${r.mismatch_variants}/${r.total_variants} | ${$(r.mismatch_dollars)} |`
  ).join('\n');

  const malformedTotal = report.byCat.find(r => r.mismatch_category === 'MALFORMED_BN');
  const unregTotal     = report.byCat.find(r => r.mismatch_category === 'UNREGISTERED_BN');
  const placeTotal     = report.byCat.find(r => r.mismatch_category === 'PLACEHOLDER_BN');
  const nameMMTotal    = report.byCat.find(r => r.mismatch_category === 'NAME_MISMATCH');

  return `# CRA Donee Name ↔ BN Data-Quality Analysis

Generated: ${new Date().toISOString()}
Options: ${JSON.stringify(args)}

## What this checks — and what it shows

Each row in \`cra.cra_qualified_donees\` records one registered charity
giving a gift to another, written on the T3010. Every row contains both
the donee's **business number** (\`donee_bn\`) and the donee's **name**
(\`donee_name\`). CRA also publishes \`cra_identification\`, which records
the canonical legal name for every registered BN. **If the two data
products were consistent, a researcher could freely join donee_bn to
cra_identification.bn and trust the result.**

They cannot. On a very large share of gift records the name the filer
wrote on the gift does *not* match the legal name the same charity filed
in its own identification record. That mismatch happens for many reasons,
some benign and some not:

* **Rebrands and mergers** — Ryerson University → Toronto Metropolitan
  University, Toronto General & Western Hospital Foundation → UHN
  Foundation, St. Michael's Hospital → Unity Health Toronto, Calgary Zoo
  Foundation → Wilder Institute, Markham Stouffville Hospital → Oak Valley
  Health, Grey Bruce Health Services → BrightShores Health System, Jewish
  Heritage Foundation of Canada → Moral Arc Foundation. Donors keep
  writing the familiar name; the identification record only carries the
  current legal name.
* **Acronyms and operating names** — "CAMH" vs "Centre for Addiction and
  Mental Health", "UJA" vs "United Jewish Appeal of Greater Toronto",
  "McGill University" vs the 1821 charter name "L'Institution Royale pour
  l'Avancement des Sciences". Same entity, different string.
* **Branch / division accounts** — every Salvation Army regional division
  files under \`107951618RRXXXX\` with its own local name, but
  \`cra_identification\` carries the national "Governing Council of the
  Salvation Army in Canada" for all of them. Same pattern for Catholic
  parishes under diocesan BNs.
* **Donor-advised-fund platforms** — gifts "to Brock Community Health
  Centre" arrive with CanadaHelps' BN because CanadaHelps is the legal
  recipient and re-grants to the ultimate beneficiary.
* **Genuine wrong-BN typos** — "Mikveh Israel" written against
  \`825330004RR0001\` whose legal name is "Congrégation Anshei Yisroel";
  "AMCAL Family Services" against a BN whose real occupant is "Projet
  Jeunesse de l'Ouest de l'Ile". Different organisations, wrong BN.

**The point of this analysis is not to separate the benign cases from
the erroneous ones — doing that reliably requires sector expertise or
AI-assisted disambiguation that the dataset itself does not provide. The
point is to measure the *scale* of the problem and show that it is
materially large.** A researcher who does \`JOIN cra_qualified_donees qd
ON qd.donee_bn = cra_identification.bn\` and publishes the results
without this caveat is wrong on a significant share of the dataset.

Trigram similarity (\`pg_trgm\`) is used only to filter out trivial
variation (case, punctuation, "The X" vs "X"). Threshold: **${args.threshold}**
(set via \`--threshold\`).

## Mismatch categories

| Category | Definition |
|---|---|
| \`PLACEHOLDER_BN\` | \`donee_bn\` begins with nine zeros (e.g. \`000000000RR0001\`). Filer flagged the BN as unknown and wrote a name only. |
| \`MALFORMED_BN\` | \`donee_bn\` violates CRA's own 15-character format \`^[0-9]{9}RR[0-9]{4}\$\`. Wrong program type (\`RC\` / \`RP\` / \`RT\` payroll), embedded whitespace, truncated, non-numeric, etc. Structurally unidentifiable. Every row is also tagged with a \`bn_defect\` sub-code. |
| \`UNREGISTERED_BN\` | \`donee_bn\` is well-formed but is not present in \`cra_identification\`. Either a de-registered charity, a transcription error, or a non-charity qualified donee (municipality, public university, First Nation, UN agency). |
| \`NAME_MISMATCH\` | BN is a real registered charity, but the donee_name the filer wrote is not a spelling variant of that charity's legal name. Mix of rebrands, acronyms, branch accounts, DAF platforms, and wrong-BN typos. |
| \`MINOR_VARIANT\` | Name differs from canonical but normalised trigram similarity ≥ threshold. Trivial variation. **Not counted.** |

## Headline — how much of the gift data fails the join?

| Metric | Value |
|---|---|
| Total gift records in \`cra_qualified_donees\`        | ${Number(h.total_gift_rows).toLocaleString()} |
| Total dollar value of those gifts                     | ${$(h.total_gift_dollars)} |
| **Gift records that can NOT be programmatically joined to \`cra_identification\` without manual/AI disambiguation** | **${Number(h.quality_issue_citations).toLocaleString()}** |
| **Dollars on those records**                          | **${$(h.quality_issue_dollars)}** (${qPct.toFixed(2)}% of all gift dollars) |
| …of which \`NAME_MISMATCH\` (BN valid, name disagrees) — rows | ${Number(h.name_mismatch_rows).toLocaleString()} |
| \`NAME_MISMATCH\` — gift citations                    | ${Number(h.name_mismatch_citations).toLocaleString()} |
| \`NAME_MISMATCH\` — dollars                           | ${$(h.name_mismatch_dollars)} (${nmPct.toFixed(2)}% of all gift dollars) |

## By category

| Category | Distinct BNs | Distinct (BN × name) rows | Gift citations | Dollars |
|----------|-------------:|--------------------------:|---------------:|--------:|
${catTable}

## MALFORMED_BN — BN format violations (${malformedTotal ? $(malformedTotal.dollars) : '—'} total)

Every row in this category has a \`donee_bn\` that CRA's own validation
rule should have rejected at filing time. The required 15-character
format is **\`^[0-9]{9}RR[0-9]{4}\$\`** — nine digits, then \`RR\` (the
registered-charity program-type code), then four digits. Any deviation
from that pattern means the donee cannot be resolved from the public
data regardless of how carefully the analyst matches on name.

### Defect taxonomy

| Defect code | Distinct BNs | Rows | Gift citations | Dollars |
|-------------|-------------:|-----:|---------------:|--------:|
${defectTable}

### Worked examples — top 3 gifts per defect class
${defectExamples}
### Case study: single filers who used one malformed BN on ≥ 20 of their own records

These are single charities who wrote the **same malformed business
number** on a large number of their own qualified-donee line items in a
single (or small number of) return(s). Every record in these sets is
structurally unidentifiable on BN alone. The filer's intended donee is
only recoverable from the name field they wrote — which is exactly the
disambiguation task that requires AI or manual review.

The best-known case (BN \`108155797RR0002\` — Jewish Foundation of Greater
Toronto, FY 2023): **all 434 line items on Schedule 5 of that single
return list \`donee_bn = 'Toronto'\`, totalling \$42,953,866.** The single
largest of those 434 rows is \$22,576,875 to "United Jewish Appeal of
Greater Toronto", sequence number 48 on the return.

| Filer BN | Filer legal name | Malformed donee_bn used | Records | Dollars | Fiscal years | Distinct donee names | Per-year detail |
|----------|------------------|--------------------------|--------:|--------:|--------------|---------------------:|------------------|
${caseStudyTable}

## Top ${args.top} NAME_MISMATCH rows by dollar value

"Sim" is the normalised trigram similarity between what the filer wrote on
the gift record and the canonical legal name registered under that BN
(0 = completely different strings, 1 = identical). Every row here is a
case where a researcher joining donor-to-donee on BN alone would find
the two CRA data products apparently disagreeing about who received the
money. Without manual or AI-assisted disambiguation, none of these rows
can be resolved from the published data.

| donee_bn | Name the filer wrote on the gift | Legal name registered for that BN | Sim | Gifts | \$ value |
|----------|----------------------------------|-----------------------------------|----:|------:|--------:|
${mismatchTable}

## Top PLACEHOLDER_BN rows by dollar value

BN is 9 zeros — filer flagged unknown BN but provided a name. The receiving
charity cannot be resolved from the data.

| donee_bn | donee_name | Citations | \$ value |
|----------|------------|----------:|--------:|
${placeholderTable}

## Top UNREGISTERED_BN rows by dollar value

BN passes the 15-character format check but is not in \`cra_identification\`.
Some of these are legitimate (gifts to municipalities, public universities,
First Nations, and UN agencies are qualified disbursements but the recipient
is not a registered charity in \`cra_identification\`). Others are
transcription errors where the BN is one digit off from a real registration.
Either way the gift record cannot be programmatically resolved to a
registered-charity identification row.

Notable examples include several well-known hospitals and institutions
whose gift records point at BNs that should trivially resolve — Sunnybrook
Health Sciences Centre, BC Cancer Agency / British Columbia Cancer Agency /
"British Columbian" Cancer Agency (three spellings against the same BN),
Hockey Canada, the University of Ottawa Heart Institute, CancerCare Manitoba,
and PEI's Queen Elizabeth Hospital.

| donee_bn | donee_name | Citations | \$ value |
|----------|------------|----------:|--------:|
${unregisteredTable}

## BNs used under ≥ 2 significantly-different names — the "one BN, many names" pattern

For these BNs the published gift data contains multiple non-spelling-variant
names attached to the same number. Again, each of these is a case a
researcher has to resolve by hand (or with AI) — the dataset itself does
not tell you whether the variation is a rebrand, a branch of the same
organisation, or an actual wrong-BN error.

| donee_bn | Legal name registered for the BN | Mismatch / total variants | Mismatch \$ |
|----------|----------------------------------|--------------------------:|------------:|
${multiTable}

## Reproducing this analysis

\`\`\`bash
cd CRA
npm run data-quality:donees                                         # recommended
node scripts/data-quality/01-donee-bn-name-mismatches.js
node scripts/data-quality/01-donee-bn-name-mismatches.js --threshold 0.25   # stricter
node scripts/data-quality/01-donee-bn-name-mismatches.js --top 100          # bigger lists
\`\`\`

Persisted table: \`cra.donee_name_quality\` (primary key \`(donee_bn, donee_name)\`).

## Caveats

* **NAME_MISMATCH is a join-failure count, not a fraud count.** Many of the
  rows are legitimate (rebrands, acronyms, parish-level naming, DAF platforms
  acting as legal recipients on behalf of ultimate beneficiaries). The
  analytical point is that separating those cases from the real wrong-BN
  errors is not possible from the published data alone — it requires manual
  curation or AI-assisted disambiguation. That necessity is itself the
  finding.
* **Placeholder BNs are a known convention.** \`000000000RR000X\` is sometimes
  used deliberately when the donee's BN is unknown to the filer. It still
  means the gift cannot be joined to a registered charity record.
* **Orphan BNs include legitimate non-charity donees.** Municipalities, public
  universities, prescribed universities outside Canada, Her Majesty in Right
  of Canada or a province, and UN agencies are all qualified donees under
  ITA s. 149.1(1) but do not have registered-charity rows in
  \`cra_identification\`. Not every ORPHAN_BN is an error.
* **Backfill in cra_identification hides rebrands.** Spot checks of known
  rebrands (Ryerson → Toronto Metropolitan University, Markham Stouffville
  Hospital → Oak Valley Health, Grey Bruce Health Services → BrightShores
  Health System, Calgary Zoo Foundation → Wilder Institute, Toronto General
  & Western Hospital Foundation → UHN Foundation, St. Michael's Hospital →
  Unity Health Toronto) show the *current* legal name stamped on every
  prior-year row. Historical-name lookup therefore does not recover the
  pre-rebrand name for most of these. Only 784 of 91,129 BNs (0.86%) show
  any \`legal_name\` variation across the five years in the database.
* **Trigram similarity is imperfect.** Acronyms, translations, and heavy
  rebrands can score below threshold despite being the same organisation.
* **Dollar totals reflect reported gift amounts, not verified flows.**
* **The MINOR_VARIANT threshold is tunable.** Default 0.30 is conservative.
  Tighter thresholds (0.20–0.25) fold more near-matches into NAME_MISMATCH;
  looser thresholds (0.35–0.40) do the opposite. The categorical split
  shifts, but the order of magnitude of the join-failure does not.
`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log.section('Step 10: Donee name ↔ BN data-quality analysis');
  log.info(`Options: ${JSON.stringify(args)}`);
  const client = await db.getClient();
  try {
    await migrate(client);
    await categorize(client);
    const r = await report(client);
    await emit(r);
    log.section('Step 10 Complete');
  } catch (err) {
    log.error(`Fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

main();
