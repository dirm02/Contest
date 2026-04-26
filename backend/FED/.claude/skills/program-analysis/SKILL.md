---
name: program-analysis
description: Analyze a federal funding program - recipients, spending patterns, concentration, and risks
argument-hint: "[program name or keyword]"
disable-model-invocation: true
---

Analyze the federal program **$ARGUMENTS**.

## Steps

1. **Find matching programs**:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT prog_name_en, owner_org_title, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions, COUNT(DISTINCT recipient_legal_name) AS recipients FROM fed.grants_contributions WHERE prog_name_en ILIKE '%\$ARGUMENTS%' AND is_amendment=false GROUP BY prog_name_en, owner_org_title ORDER BY SUM(agreement_value) DESC LIMIT 15\`).then(r=>{console.table(r.rows);db.end();})"
```

2. **Get program details** (use exact program name):
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT prog_name_en, prog_purpose_en, owner_org_title, COUNT(*) AS grants, COUNT(DISTINCT recipient_legal_name) AS recipients, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions, MIN(agreement_start_date) AS first_grant, MAX(agreement_start_date) AS last_grant FROM fed.grants_contributions WHERE prog_name_en='EXACT_NAME' AND is_amendment=false GROUP BY 1,2,3\`).then(r=>{console.table(r.rows);db.end();})"
```

3. **Get top recipients** in the program:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_legal_name AS name, recipient_type, recipient_province AS prov, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE prog_name_en='EXACT_NAME' AND is_amendment=false GROUP BY 1,2,3 ORDER BY SUM(agreement_value) DESC LIMIT 20\`).then(r=>{console.table(r.rows);db.end();})"
```

4. **Check recipient concentration** (is this program dominated by few recipients?):
```bash
node -e "const db=require('./lib/db'); db.query(\`WITH t AS (SELECT recipient_legal_name, SUM(agreement_value) AS total FROM fed.grants_contributions WHERE prog_name_en='EXACT_NAME' AND is_amendment=false GROUP BY 1), s AS (SELECT SUM(total) AS grand_total FROM t) SELECT COUNT(*) AS recipients, ROUND((SELECT SUM(total) FROM (SELECT total FROM t ORDER BY total DESC LIMIT 3) x)::numeric / NULLIF((SELECT grand_total FROM s),0) * 100, 1) AS top3_pct FROM t\`).then(r=>{console.table(r.rows);db.end();})"
```

5. **Geographic distribution**:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_province AS prov, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE prog_name_en='EXACT_NAME' AND is_amendment=false AND recipient_province IS NOT NULL GROUP BY 1 ORDER BY SUM(agreement_value) DESC\`).then(r=>{console.table(r.rows);db.end();})"
```

6. **Synthesize** the program analysis:
   - Program purpose and funding department
   - Scale (total value, grant count, recipient count)
   - Concentration risk (top-3 share, single-recipient?)
   - Geographic distribution (equitable across provinces?)
   - Amendment patterns
   - Key findings and concerns
