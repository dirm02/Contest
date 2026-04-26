---
name: profile-charity
description: Profile a charity's finances, gift network, circular flows, and accountability metrics
argument-hint: [charity name or BN]
disable-model-invocation: true
---

Profile the charity: $ARGUMENTS

Follow these steps in order:

1. **Find the charity** by name or BN:
   ```bash
   npm run lookup -- --name "$ARGUMENTS"
   ```
   If multiple matches, list them and ask the user which one.

2. **Determine its type** - this frames all interpretation:
   ```bash
   node -e "const db=require('./lib/db'); db.query(\"SELECT designation, category, legal_name FROM cra_identification WHERE bn='\$BN' AND fiscal_year=2024\").then(r=>{console.log(r.rows);db.end();})"
   ```
   - Designation A (public foundation): circular flows expected
   - Designation B (private foundation): related-party flows expected
   - Designation C (charitable organization): circular flows NOT expected

3. **Generate the risk report**:
   ```bash
   npm run risk -- --bn <BN>
   ```
   Read `data/reports/risk-<BN>.md` and summarize the score and factors.

4. **Generate the full network analysis**:
   ```bash
   npm run lookup -- --bn <BN> --hops 5
   ```
   Read `data/reports/lookup-<BN>.json` for gift network data.

5. **Summarize findings** with:
   - Charity type and what that means for interpreting the data
   - Risk score and which factors are structural vs concerning
   - Financial profile (revenue, programs, overhead, compensation)
   - Circular gifting summary (total, partners, same-year symmetric, adjacent-year)
   - Whether the patterns are consistent with the charity's stated purpose
