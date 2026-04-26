---
name: compare-charities
description: Side-by-side comparison of multiple charities on financial and circular gifting metrics
argument-hint: [charity1, charity2, ...]
disable-model-invocation: true
---

Compare these charities side by side: $ARGUMENTS

1. **Find each charity** by name or BN:
   ```bash
   node -e "const db=require('./lib/db'); db.query(\"SELECT DISTINCT ON (bn) bn, legal_name FROM cra_identification WHERE legal_name ILIKE '%NAME%' ORDER BY bn, fiscal_year DESC LIMIT 5\").then(r=>{console.log(r.rows);db.end();})"
   ```

2. **Check scored universe** for each:
   ```bash
   node -e "const d=JSON.parse(require('fs').readFileSync('data/reports/universe-scored.json','utf8')); const bns=['BN1','BN2']; bns.forEach(bn=>{const c=d.charities.find(c=>c.bn===bn); if(c) console.log(JSON.stringify(c,null,2)); else console.log(bn+': not in circular patterns');});"
   ```

3. **If not in universe**, query the DB directly for financial data:
   ```sql
   SELECT ci.bn, ci.legal_name, ci.designation,
          fd.field_4700 AS revenue, fd.field_5100 AS expenditures,
          fd.field_5000 AS programs, fd.field_5010 AS admin,
          fd.field_5020 AS fundraising, c.field_390 AS compensation
   FROM cra_identification ci
   JOIN cra_financial_details fd ON ci.bn = fd.bn
   LEFT JOIN cra_compensation c ON fd.bn = c.bn AND fd.fpe = c.fpe
   WHERE ci.bn IN ('BN1', 'BN2') AND ci.fiscal_year = 2024
   ORDER BY ci.bn, fd.fpe DESC;
   ```

4. **Build comparison table** with columns: Name, Designation, Revenue, Programs, Overhead%, Compensation, Circular Amount, Same-Yr HIGH, Risk Score.

5. **Highlight key differences** - what makes one look different from the others?
