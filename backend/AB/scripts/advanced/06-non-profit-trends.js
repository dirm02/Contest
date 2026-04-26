/**
 * 06-non-profit-trends.js - Non-Profit Lifecycle Trends Analysis
 *
 * Analyses:
 *   1. Registration trends - annual creation rates, seasonal patterns
 *   2. Closure/dissolution trends - annual rates, acceleration detection
 *   3. Survival analysis - what % survive 5/10/20/30 years by entity type
 *   4. Entity type evolution - how the mix of types has shifted over time
 *   5. Geographic distribution - city-level density and growth
 *   6. Status transitions - active vs defunct rates by decade and type
 *   7. Net formation rate - creations minus closures per year
 *   8. Non-profit sector health score by entity type
 *
 * Outputs: data/reports/non-profit-trends.json and .txt
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../../lib/db');
const log = require('../../lib/logger');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

async function run() {
  const report = { generated: new Date().toISOString() };
  const lines = ['NON-PROFIT LIFECYCLE TRENDS ANALYSIS', '='.repeat(70), ''];

  try {
    log.section('Non-Profit Trends');

    // ── 1. Annual Registration Trends ─────────────────────────────
    log.info('1. Annual registration trends...');
    lines.push('1. ANNUAL REGISTRATION TRENDS', '-'.repeat(60));

    const annualReg = await pool.query(`
      SELECT EXTRACT(YEAR FROM registration_date)::int AS reg_year,
             COUNT(*) AS registrations
      FROM ab.ab_non_profit
      WHERE registration_date IS NOT NULL
        AND EXTRACT(YEAR FROM registration_date) >= 1960
      GROUP BY 1
      ORDER BY 1
    `);
    report.annual_registrations = annualReg.rows;
    const maxReg = Math.max(...annualReg.rows.map(r => parseInt(r.registrations)));
    for (const r of annualReg.rows) {
      const bar = '#'.repeat(Math.round(parseInt(r.registrations) / maxReg * 50));
      lines.push(`  ${r.reg_year} ${parseInt(r.registrations).toLocaleString().padStart(6)} ${bar}`);
    }

    // ── 2. Seasonal Registration Patterns ─────────────────────────
    log.info('2. Seasonal patterns...');
    lines.push('\n\n2. SEASONAL REGISTRATION PATTERNS (BY MONTH)', '-'.repeat(60));

    const seasonal = await pool.query(`
      SELECT EXTRACT(MONTH FROM registration_date)::int AS month,
             COUNT(*) AS registrations
      FROM ab.ab_non_profit
      WHERE registration_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    `);
    report.seasonal_patterns = seasonal.rows;
    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
    const maxMonth = Math.max(...seasonal.rows.map(r => parseInt(r.registrations)));
    for (const r of seasonal.rows) {
      const bar = '#'.repeat(Math.round(parseInt(r.registrations) / maxMonth * 40));
      lines.push(`  ${monthNames[r.month].padEnd(12)} ${parseInt(r.registrations).toLocaleString().padStart(6)} ${bar}`);
    }

    // ── 3. Survival Analysis by Entity Type ───────────────────────
    log.info('3. Survival analysis...');
    lines.push('\n\n3. CURRENT ACTIVE STATUS BY ORGANIZATION AGE', '-'.repeat(60));
    lines.push('What % of organizations at each age are currently active? (Not survival analysis — requires dissolution dates.)\n');

    const survival = await pool.query(`
      WITH aged AS (
        SELECT type, status,
               EXTRACT(YEAR FROM AGE(NOW(), registration_date)) AS age_years
        FROM ab.ab_non_profit
        WHERE registration_date IS NOT NULL AND type IS NOT NULL
      )
      SELECT type,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS active,
             ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(status) = 'active') / COUNT(*), 1) AS active_pct,
             ROUND(AVG(age_years), 1) AS avg_age,
             ROUND(AVG(age_years) FILTER (WHERE LOWER(status) = 'active'), 1) AS avg_age_active,
             COUNT(*) FILTER (WHERE age_years >= 5 AND LOWER(status) = 'active') AS survived_5yr,
             COUNT(*) FILTER (WHERE age_years >= 5) AS total_5yr,
             COUNT(*) FILTER (WHERE age_years >= 10 AND LOWER(status) = 'active') AS survived_10yr,
             COUNT(*) FILTER (WHERE age_years >= 10) AS total_10yr,
             COUNT(*) FILTER (WHERE age_years >= 20 AND LOWER(status) = 'active') AS survived_20yr,
             COUNT(*) FILTER (WHERE age_years >= 20) AS total_20yr
      FROM aged
      GROUP BY type
      HAVING COUNT(*) >= 50
      ORDER BY active_pct DESC
    `);
    report.survival_by_type = survival.rows;
    lines.push(`${'Entity Type'.padEnd(35)} ${'Total'.padStart(7)} ${'Active%'.padStart(8)} ${'Avg Age'.padStart(8)} ${'5yr Act%'.padStart(10)} ${'10yr Act%'.padStart(10)} ${'20yr Act%'.padStart(10)}`);
    for (const r of survival.rows) {
      const s5 = r.total_5yr > 0 ? `${Math.round(100 * r.survived_5yr / r.total_5yr)}%` : 'n/a';
      const s10 = r.total_10yr > 0 ? `${Math.round(100 * r.survived_10yr / r.total_10yr)}%` : 'n/a';
      const s20 = r.total_20yr > 0 ? `${Math.round(100 * r.survived_20yr / r.total_20yr)}%` : 'n/a';
      lines.push(`${(r.type || '').slice(0, 35).padEnd(35)} ${parseInt(r.total).toLocaleString().padStart(7)} ${(r.active_pct + '%').padStart(8)} ${(r.avg_age + 'y').padStart(8)} ${s5.padStart(10)} ${s10.padStart(10)} ${s20.padStart(10)}`);
    }

    // ── 4. Entity Type Evolution by Decade ────────────────────────
    log.info('4. Entity type evolution...');
    lines.push('\n\n4. ENTITY TYPE EVOLUTION BY DECADE', '-'.repeat(60));
    lines.push('How the mix of non-profit types has changed over time\n');

    const typeEvolution = await pool.query(`
      SELECT
        CASE
          WHEN EXTRACT(YEAR FROM registration_date) < 1990 THEN 'Pre-1990'
          WHEN EXTRACT(YEAR FROM registration_date) < 2000 THEN '1990s'
          WHEN EXTRACT(YEAR FROM registration_date) < 2010 THEN '2000s'
          WHEN EXTRACT(YEAR FROM registration_date) < 2020 THEN '2010s'
          ELSE '2020s'
        END AS era,
        type,
        COUNT(*) AS registrations
      FROM ab.ab_non_profit
      WHERE registration_date IS NOT NULL AND type IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 1, registrations DESC
    `);

    // Group by era
    const byEra = {};
    for (const r of typeEvolution.rows) {
      if (!byEra[r.era]) byEra[r.era] = [];
      byEra[r.era].push(r);
    }
    report.type_evolution = byEra;

    for (const [era, rows] of Object.entries(byEra)) {
      const total = rows.reduce((s, r) => s + parseInt(r.registrations), 0);
      lines.push(`\n  ${era} (${total.toLocaleString()} total):`);
      for (const r of rows) {
        const pct = ((parseInt(r.registrations) / total) * 100).toFixed(1);
        lines.push(`    ${(r.type || '').padEnd(40)} ${parseInt(r.registrations).toLocaleString().padStart(6)} (${pct}%)`);
      }
    }

    // ── 5. Geographic Distribution ────────────────────────────────
    log.info('5. Geographic distribution...');
    lines.push('\n\n5. TOP 25 CITIES BY NON-PROFIT DENSITY', '-'.repeat(60));

    const geography = await pool.query(`
      SELECT city,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS active,
             ROUND(100.0 * COUNT(*) FILTER (WHERE LOWER(status) = 'active') / COUNT(*), 1) AS active_pct,
             COUNT(DISTINCT type) AS entity_types
      FROM ab.ab_non_profit
      WHERE city IS NOT NULL
      GROUP BY city
      ORDER BY total DESC
      LIMIT 25
    `);
    report.geography = geography.rows;
    lines.push(`${'City'.padEnd(30)} ${'Total'.padStart(7)} ${'Active'.padStart(7)} ${'Active%'.padStart(8)} ${'Types'.padStart(6)}`);
    for (const r of geography.rows) {
      lines.push(`${(r.city || '').slice(0, 30).padEnd(30)} ${parseInt(r.total).toLocaleString().padStart(7)} ${parseInt(r.active).toLocaleString().padStart(7)} ${(r.active_pct + '%').padStart(8)} ${r.entity_types.toString().padStart(6)}`);
    }

    // ── 6. Net Formation Rate ─────────────────────────────────────
    log.info('6. Net formation rate...');
    lines.push('\n\n6. NET FORMATION RATE (REGISTRATIONS VS DISSOLUTIONS BY YEAR)', '-'.repeat(60));
    lines.push('Approximated: new registrations per year vs entities that became dissolved/struck\n');

    // We only have registration_date, not dissolution_date, so we approximate
    // by comparing registrations to current status counts by registration year
    const netFormation = await pool.query(`
      SELECT EXTRACT(YEAR FROM registration_date)::int AS year,
             COUNT(*) AS registrations,
             COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS still_active,
             COUNT(*) FILTER (WHERE LOWER(status) IN ('dissolved', 'struck', 'cancelled', 'amalgamated')) AS now_defunct,
             COUNT(*) FILTER (WHERE LOWER(status) NOT IN ('active', 'dissolved', 'struck', 'cancelled', 'amalgamated')) AS other_status
      FROM ab.ab_non_profit
      WHERE registration_date IS NOT NULL
        AND EXTRACT(YEAR FROM registration_date) >= 1990
      GROUP BY 1
      ORDER BY 1
    `);
    report.net_formation = netFormation.rows;
    lines.push(`${'Year'.padEnd(6)} ${'New'.padStart(6)} ${'Still Active'.padStart(13)} ${'Now Defunct'.padStart(12)} ${'Survival%'.padStart(10)}`);
    for (const r of netFormation.rows) {
      const total = parseInt(r.registrations);
      const active = parseInt(r.still_active);
      const survival = total > 0 ? ((active / total) * 100).toFixed(1) : '0.0';
      lines.push(`${r.year.toString().padEnd(6)} ${total.toLocaleString().padStart(6)} ${active.toLocaleString().padStart(13)} ${parseInt(r.now_defunct).toLocaleString().padStart(12)} ${(survival + '%').padStart(10)}`);
    }

    // ── 7. Sector Health Score ────────────────────────────────────
    log.info('7. Sector health score...');
    lines.push('\n\n7. NON-PROFIT SECTOR HEALTH SCORE BY ENTITY TYPE', '-'.repeat(60));
    lines.push('Composite score: active rate + recent growth + survival rate (0-100)\n');

    const health = await pool.query(`
      WITH type_stats AS (
        SELECT type,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE LOWER(status) = 'active') AS active,
               COUNT(*) FILTER (WHERE registration_date >= NOW() - INTERVAL '5 years') AS recent_5yr,
               COUNT(*) FILTER (WHERE registration_date >= NOW() - INTERVAL '5 years' AND LOWER(status) = 'active') AS recent_5yr_active,
               COUNT(*) FILTER (WHERE registration_date >= NOW() - INTERVAL '10 years') AS reg_10yr,
               COUNT(*) FILTER (WHERE registration_date >= NOW() - INTERVAL '10 years' AND LOWER(status) = 'active') AS active_10yr
        FROM ab.ab_non_profit
        WHERE type IS NOT NULL
        GROUP BY type
        HAVING COUNT(*) >= 20
      )
      SELECT type, total, active,
             ROUND(100.0 * active / total, 1) AS active_rate,
             recent_5yr, recent_5yr_active,
             ROUND(100.0 * COALESCE(active_10yr, 0) / NULLIF(reg_10yr, 0), 1) AS survival_10yr,
             ROUND(
               (100.0 * active / total * 0.4) +
               (LEAST(100, 100.0 * recent_5yr / NULLIF(total, 0) * 5) * 0.3) +
               (100.0 * COALESCE(active_10yr, 0) / NULLIF(reg_10yr, 0) * 0.3)
             , 0) AS health_score
      FROM type_stats
      ORDER BY health_score DESC
    `);
    report.sector_health = health.rows;
    lines.push(`${'Entity Type'.padEnd(40)} ${'Total'.padStart(7)} ${'Active%'.padStart(8)} ${'10yr Surv'.padStart(10)} ${'Health'.padStart(7)}`);
    for (const r of health.rows) {
      lines.push(`${(r.type || '').slice(0, 40).padEnd(40)} ${parseInt(r.total).toLocaleString().padStart(7)} ${(r.active_rate + '%').padStart(8)} ${(r.survival_10yr ? r.survival_10yr + '%' : 'n/a').padStart(10)} ${r.health_score.toString().padStart(7)}`);
    }

    // Write reports
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORTS_DIR, 'non-profit-trends.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(REPORTS_DIR, 'non-profit-trends.txt'), lines.join('\n'));

    log.section('Non-Profit Trends Complete');
    console.log(lines.join('\n'));

  } catch (err) {
    log.error(`Analysis error: ${err.message}`);
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
