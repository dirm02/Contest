---
name: temporal-flow-analysis
description: Analyze timing of circular gift flows - same-year symmetric and adjacent-year round-trips
argument-hint: [charity name or BN]
disable-model-invocation: true
---

Analyze the timing of circular gift flows for: $ARGUMENTS

This is the most forensically significant analysis tool. It distinguishes legitimate collaboration from potential disbursement quota gaming.

1. **Generate the risk report** (includes temporal analysis):
   ```bash
   npm run risk -- --name "$ARGUMENTS"
   ```

2. **Read the "Same-Year Symmetric Flows" section** from `data/reports/risk-<BN>.md`:
   - HIGH (>75% symmetric in same fiscal year) = strongest signal
   - MEDIUM (50-75%) = worth examining
   - LOW (<50%) = likely legitimate

3. **Read the "Adjacent-Year Round-Trips" section**:
   - Flows where charity sends in year N and partner returns in N±1
   - The cross-year variant of quota gaming - harder to detect

4. **For the most concerning partner pairs**, run year-by-year analysis:
   ```sql
   WITH out_by_yr AS (
     SELECT EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
     FROM cra_qualified_donees WHERE bn='<BN_A>' AND donee_bn='<BN_B>' AND total_gifts>0
     GROUP BY EXTRACT(YEAR FROM fpe)
   ), in_by_yr AS (
     SELECT EXTRACT(YEAR FROM fpe)::int AS yr, SUM(total_gifts) AS amt
     FROM cra_qualified_donees WHERE bn='<BN_B>' AND donee_bn='<BN_A>' AND total_gifts>0
     GROUP BY EXTRACT(YEAR FROM fpe)
   )
   SELECT COALESCE(o.yr,i.yr) AS year, COALESCE(o.amt,0) AS sent,
          COALESCE(i.amt,0) AS received,
          CASE WHEN o.amt>0 AND i.amt>0
               THEN ROUND(LEAST(o.amt,i.amt)/GREATEST(o.amt,i.amt)*100)
               ELSE NULL END AS symmetry_pct
   FROM out_by_yr o FULL JOIN in_by_yr i ON o.yr=i.yr ORDER BY year;
   ```

5. **Classify each partner pair**:
   - Same-year >75% symmetric + persistent across years = **highest concern**
   - Adjacent-year >50% with no same-year return = **cross-year variant**
   - Direction alternates across years = likely project-based, lower concern
   - One-directional all years = normal disbursement, no concern

6. **Key insight**: Aggregate symmetry that dissolves at the yearly level is LESS concerning than symmetry within a single year.
