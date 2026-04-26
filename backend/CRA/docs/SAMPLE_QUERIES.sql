-- ============================================================================
-- AI For Accountability - Sample Analytical Queries
-- CRA T3010 Charity Data (2020-2024, 5 fiscal years, ~7.1M rows)
--
-- These queries are ready to run against the loaded database.
-- Copy/paste into any PostgreSQL client (psql, DBeaver, pgAdmin, etc.)
-- ============================================================================


-- ── 1. SEARCH & DISCOVERY ──────────────────────────────────────────────────

-- 1a. Search charities by name (fuzzy)
SELECT bn, fiscal_year, legal_name, city, province, designation
FROM cra_identification
WHERE legal_name ILIKE '%search term%'
  AND fiscal_year = 2024
ORDER BY legal_name;

-- 1b. Get full profile for a specific charity (using the view)
SELECT * FROM vw_charity_profiles
WHERE bn = '123456789RR0001' AND fiscal_year = 2024;

-- 1c. Count charities by province (latest year available per charity)
SELECT province, COUNT(*) AS charity_count
FROM cra_identification
WHERE fiscal_year = 2024 AND province IS NOT NULL
GROUP BY province
ORDER BY charity_count DESC;

-- 1d. Count charities by designation type
SELECT ci.designation, dl.name_en AS designation_name, COUNT(*) AS count
FROM cra_identification ci
JOIN cra_designation_lookup dl ON ci.designation = dl.code
WHERE ci.fiscal_year = 2024
GROUP BY ci.designation, dl.name_en
ORDER BY count DESC;


-- ── 2. FINANCIAL ANALYSIS ──────────────────────────────────────────────────

-- 2a. Top 25 charities by total revenue (2023 - complete year)
SELECT ci.legal_name, ci.province,
       fd.field_4700 AS total_revenue,
       fd.field_5100 AS total_expenditures,
       fd.field_4200 AS total_assets
FROM cra_financial_details fd
JOIN cra_identification ci ON fd.bn = ci.bn AND ci.fiscal_year = 2023
WHERE fd.fpe >= '2023-01-01' AND fd.fpe <= '2023-12-31'
  AND fd.field_4700 IS NOT NULL
ORDER BY fd.field_4700 DESC
LIMIT 25;

-- 2b. Revenue trend for a specific charity across all years
SELECT EXTRACT(YEAR FROM fd.fpe) AS year,
       fd.field_4700 AS revenue,
       fd.field_5100 AS expenditures,
       fd.field_4200 AS assets,
       fd.field_4350 AS liabilities,
       (fd.field_4200 - fd.field_4350) AS net_assets
FROM cra_financial_details fd
WHERE fd.bn = '123456789RR0001'
ORDER BY fd.fpe;

-- 2c. Average revenue by charity category (2023)
SELECT cat.name_en AS category,
       COUNT(*) AS charities,
       ROUND(AVG(fd.field_4700), 2) AS avg_revenue,
       ROUND(SUM(fd.field_4700), 2) AS total_revenue
FROM cra_financial_details fd
JOIN cra_identification ci ON fd.bn = ci.bn AND ci.fiscal_year = 2023
JOIN cra_category_lookup cat ON ci.category = cat.code
WHERE fd.fpe >= '2023-01-01' AND fd.fpe <= '2023-12-31'
  AND fd.field_4700 IS NOT NULL
GROUP BY cat.name_en
ORDER BY total_revenue DESC;

-- 2d. Charities spending more than they earn (potential sustainability issues)
-- CORRECTED: field_5100 = total expenditures, field_4700 = total revenue
SELECT ci.legal_name, ci.province,
       fd.field_4700 AS revenue,
       fd.field_5100 AS expenditures,
       (fd.field_5100 - fd.field_4700) AS deficit
FROM cra_financial_details fd
JOIN cra_identification ci ON fd.bn = ci.bn AND ci.fiscal_year = 2023
WHERE fd.fpe >= '2023-01-01' AND fd.fpe <= '2023-12-31'
  AND fd.field_5100 > fd.field_4700
  AND fd.field_4700 > 100000  -- Only charities with meaningful revenue
ORDER BY (fd.field_5100 - fd.field_4700) DESC
LIMIT 25;

-- 2e. Fundraising efficiency: ratio of fundraising costs to total revenue
-- CORRECTED: field_5020 = fundraising expenditure, field_4700 = total revenue
SELECT ci.legal_name,
       fd.field_4700 AS revenue,
       fd.field_5020 AS fundraising_cost,
       ROUND(fd.field_5020 / NULLIF(fd.field_4700, 0) * 100, 1) AS fundraising_pct
FROM cra_financial_details fd
JOIN cra_identification ci ON fd.bn = ci.bn AND ci.fiscal_year = 2023
WHERE fd.fpe >= '2023-01-01' AND fd.fpe <= '2023-12-31'
  AND fd.field_4700 > 1000000
  AND fd.field_5020 > 0
ORDER BY fundraising_pct DESC
LIMIT 25;

-- 2f. Year-over-year revenue growth (charities with data in both 2022 and 2023)
SELECT ci.legal_name,
       f22.field_4700 AS revenue_2022,
       f23.field_4700 AS revenue_2023,
       ROUND((f23.field_4700 - f22.field_4700) / NULLIF(f22.field_4700, 0) * 100, 1) AS growth_pct
FROM cra_financial_details f23
JOIN cra_financial_details f22 ON f23.bn = f22.bn
JOIN cra_identification ci ON f23.bn = ci.bn AND ci.fiscal_year = 2023
WHERE f23.fpe >= '2023-01-01' AND f23.fpe <= '2023-12-31'
  AND f22.fpe >= '2022-01-01' AND f22.fpe <= '2022-12-31'
  AND f23.field_4700 > 100000
  AND f22.field_4700 > 100000
ORDER BY growth_pct DESC
LIMIT 25;


-- ── 3. COMPENSATION & GOVERNANCE ───────────────────────────────────────────

-- 3a. Highest total compensation (Schedule 3)
-- CORRECTED: field_300 = full-time employee count, field_370 = part-time employee count,
--            field_390 = total compensation (all employees), field_380 = part-time compensation only
SELECT ci.legal_name,
       c.field_300 AS full_time_employees,
       c.field_370 AS part_time_employees,
       (COALESCE(c.field_300, 0) + COALESCE(c.field_370, 0)) AS total_employees,
       c.field_390 AS total_compensation,
       ROUND(c.field_390 / NULLIF(COALESCE(c.field_300, 0) + COALESCE(c.field_370, 0), 0), 0) AS avg_compensation
FROM cra_compensation c
JOIN cra_identification ci ON c.bn = ci.bn AND ci.fiscal_year = 2023
WHERE c.fpe >= '2023-01-01' AND c.fpe <= '2023-12-31'
  AND c.field_390 IS NOT NULL AND c.field_390 > 0
ORDER BY c.field_390 DESC
LIMIT 25;

-- 3b. Compensation as % of total expenditure
-- CORRECTED: field_390 = total compensation (all employees), not field_380 (part-time only)
SELECT ci.legal_name,
       fd.field_5100 AS total_expenditures,
       c.field_390 AS total_compensation,
       ROUND(c.field_390 / NULLIF(fd.field_5100, 0) * 100, 1) AS compensation_pct
FROM cra_compensation c
JOIN cra_financial_details fd ON c.bn = fd.bn AND c.fpe = fd.fpe
JOIN cra_identification ci ON c.bn = ci.bn AND ci.fiscal_year = 2023
WHERE c.fpe >= '2023-01-01' AND c.fpe <= '2023-12-31'
  AND fd.field_5100 > 500000
ORDER BY compensation_pct DESC
LIMIT 25;

-- 3c. Directors serving on multiple charities (network analysis)
SELECT last_name, first_name, COUNT(DISTINCT bn) AS charity_count,
       ARRAY_AGG(DISTINCT bn ORDER BY bn) AS charity_bns
FROM cra_directors
WHERE fpe >= '2023-01-01' AND fpe <= '2023-12-31'
  AND last_name IS NOT NULL AND first_name IS NOT NULL
GROUP BY last_name, first_name
HAVING COUNT(DISTINCT bn) > 5
ORDER BY charity_count DESC
LIMIT 25;

-- 3d. Board size distribution
SELECT board_size, COUNT(*) AS charity_count
FROM (
  SELECT bn, COUNT(*) AS board_size
  FROM cra_directors
  WHERE fpe >= '2023-01-01' AND fpe <= '2023-12-31'
  GROUP BY bn
) t
GROUP BY board_size
ORDER BY board_size;


-- ── 4. DONATIONS & FUNDING FLOWS ──────────────────────────────────────────

-- 4a. Largest gifts between charities (qualified donees)
SELECT ci.legal_name AS donor_charity,
       qd.donee_name, qd.donee_bn,
       qd.total_gifts
FROM cra_qualified_donees qd
JOIN cra_identification ci ON qd.bn = ci.bn AND ci.fiscal_year = 2023
WHERE qd.fpe >= '2023-01-01' AND qd.fpe <= '2023-12-31'
  AND qd.total_gifts IS NOT NULL
ORDER BY qd.total_gifts DESC
LIMIT 25;

-- 4b. Most popular recipient charities (by number of donors)
SELECT qd.donee_name, qd.donee_bn,
       COUNT(DISTINCT qd.bn) AS donor_count,
       SUM(qd.total_gifts) AS total_received
FROM cra_qualified_donees qd
WHERE qd.fpe >= '2023-01-01' AND qd.fpe <= '2023-12-31'
  AND qd.donee_bn IS NOT NULL AND qd.donee_bn != ''
GROUP BY qd.donee_name, qd.donee_bn
ORDER BY donor_count DESC
LIMIT 25;

-- 4c. Grants to non-qualified donees (grants to individuals/organizations)
SELECT ci.legal_name AS granting_charity,
       nqd.recipient_name, nqd.purpose,
       nqd.cash_amount, nqd.non_cash_amount, nqd.country
FROM cra_non_qualified_donees nqd
JOIN cra_identification ci ON nqd.bn = ci.bn AND ci.fiscal_year = 2024
WHERE nqd.fpe >= '2024-01-01' AND nqd.fpe <= '2024-12-31'
  AND nqd.cash_amount IS NOT NULL
ORDER BY nqd.cash_amount DESC
LIMIT 25;


-- ── 5. INTERNATIONAL ACTIVITIES ────────────────────────────────────────────

-- 5a. Charities with largest international spending
SELECT ci.legal_name, aod.field_200 AS intl_spending
FROM cra_activities_outside_details aod
JOIN cra_identification ci ON aod.bn = ci.bn AND ci.fiscal_year = 2023
WHERE aod.fpe >= '2023-01-01' AND aod.fpe <= '2023-12-31'
  AND aod.field_200 > 0
ORDER BY aod.field_200 DESC
LIMIT 25;

-- 5b. Most common countries for international activities
SELECT cl.name_en AS country, COUNT(DISTINCT aoc.bn) AS charity_count
FROM cra_activities_outside_countries aoc
JOIN cra_country_lookup cl ON aoc.country = cl.code
WHERE aoc.fpe >= '2023-01-01' AND aoc.fpe <= '2023-12-31'
GROUP BY cl.name_en
ORDER BY charity_count DESC
LIMIT 20;

-- 5c. Resources sent to specific countries
SELECT cl.name_en AS country,
       COUNT(*) AS transfers,
       SUM(rso.amount) AS total_amount
FROM cra_resources_sent_outside rso
LEFT JOIN cra_country_lookup cl ON rso.country = cl.code
WHERE rso.fpe >= '2023-01-01' AND rso.fpe <= '2023-12-31'
  AND rso.amount > 0
GROUP BY cl.name_en
ORDER BY total_amount DESC
LIMIT 20;


-- ── 6. PROGRAM ANALYSIS ───────────────────────────────────────────────────

-- 6a. Programs by type (ongoing vs new vs inactive)
SELECT ptl.name_en AS program_type, COUNT(*) AS program_count
FROM cra_charitable_programs cp
JOIN cra_program_type_lookup ptl ON cp.program_type = ptl.code
WHERE cp.fpe >= '2023-01-01' AND cp.fpe <= '2023-12-31'
GROUP BY ptl.name_en
ORDER BY program_count DESC;

-- 6b. Search program descriptions (full-text)
SELECT ci.legal_name, cp.program_type, cp.description
FROM cra_charitable_programs cp
JOIN cra_identification ci ON cp.bn = ci.bn AND ci.fiscal_year = 2023
WHERE cp.fpe >= '2023-01-01' AND cp.fpe <= '2023-12-31'
  AND to_tsvector('english', cp.description) @@ to_tsquery('english', 'housing & homeless')
LIMIT 20;


-- ── 7. TREND & CROSS-YEAR ANALYSIS ────────────────────────────────────────

-- 7a. Total sector revenue by year
SELECT EXTRACT(YEAR FROM fpe) AS year,
       COUNT(*) AS charities_reporting,
       ROUND(SUM(field_4700) / 1e9, 2) AS total_revenue_billions,
       ROUND(AVG(field_4700), 0) AS avg_revenue
FROM cra_financial_details
WHERE field_4700 IS NOT NULL
GROUP BY EXTRACT(YEAR FROM fpe)
ORDER BY year;

-- 7b. Growth in number of registered charities
SELECT fiscal_year, COUNT(*) AS registered_charities
FROM cra_identification
GROUP BY fiscal_year
ORDER BY fiscal_year;

-- 7c. Charities that appeared or disappeared between years
SELECT ci2024.bn, ci2024.legal_name AS name_2024, ci2023.legal_name AS name_2023
FROM cra_identification ci2024
LEFT JOIN cra_identification ci2023 ON ci2024.bn = ci2023.bn AND ci2023.fiscal_year = 2023
WHERE ci2024.fiscal_year = 2024 AND ci2023.bn IS NULL
ORDER BY ci2024.legal_name
LIMIT 25;


-- ── 8. DATA QUALITY & EXPLORATION ──────────────────────────────────────────

-- 8a. Row counts per table per year (quick health check)
SELECT 'identification' AS tbl, fiscal_year AS yr, COUNT(*) AS cnt
FROM cra_identification GROUP BY fiscal_year
UNION ALL
SELECT 'directors', EXTRACT(YEAR FROM fpe)::int, COUNT(*)
FROM cra_directors GROUP BY 2
UNION ALL
SELECT 'financial_details', EXTRACT(YEAR FROM fpe)::int, COUNT(*)
FROM cra_financial_details GROUP BY 2
ORDER BY 1, 2;

-- 8b. Null rate for key financial fields (data completeness)
SELECT EXTRACT(YEAR FROM fpe) AS year,
       COUNT(*) AS total,
       COUNT(field_4700) AS has_revenue,
       COUNT(field_5100) AS has_expenditures,
       COUNT(field_4200) AS has_assets,
       ROUND(COUNT(field_4700)::numeric / COUNT(*) * 100, 1) AS revenue_pct
FROM cra_financial_details
GROUP BY EXTRACT(YEAR FROM fpe)
ORDER BY year;

-- 8c. Form ID distribution (confirms T3010 form version usage over time)
SELECT EXTRACT(YEAR FROM fpe) AS fpe_year, form_id, COUNT(*) AS filings
FROM cra_financial_details
GROUP BY 1, 2
ORDER BY 1, 2;
