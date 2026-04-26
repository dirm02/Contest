---
name: department-audit
description: Audit a federal department's grant spending - recipients, concentration, amendments, and risks
argument-hint: "[department name or keyword]"
disable-model-invocation: true
---

Audit the grant spending of department **$ARGUMENTS**.

## Steps

1. **Find matching departments**:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT DISTINCT owner_org_title FROM fed.grants_contributions WHERE owner_org_title ILIKE '%\$ARGUMENTS%' LIMIT 10\`).then(r=>{r.rows.forEach(x=>console.log(x.owner_org_title));db.end();})"
```

2. **Department overview**:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT COUNT(*) FILTER (WHERE is_amendment=false) AS originals, COUNT(*) FILTER (WHERE is_amendment=true) AS amendments, ROUND(SUM(agreement_value) FILTER (WHERE is_amendment=false)::numeric/1e9,2) AS original_billions, COUNT(DISTINCT recipient_legal_name) AS recipients, COUNT(DISTINCT prog_name_en) AS programs, COUNT(DISTINCT recipient_province) AS provinces FROM fed.grants_contributions WHERE owner_org_title ILIKE '%DEPT_NAME%'\`).then(r=>{console.table(r.rows);db.end();})"
```

3. **Top 20 recipients** for the department:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_legal_name AS name, recipient_type, recipient_province AS prov, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE owner_org_title ILIKE '%DEPT_NAME%' AND is_amendment=false AND agreement_value>0 GROUP BY 1,2,3 ORDER BY SUM(agreement_value) DESC LIMIT 20\`).then(r=>{console.table(r.rows);db.end();})"
```

4. **Check HHI concentration** from the concentration report:
```bash
node -e "const r=require('./data/reports/recipient-concentration.json'); const dept=r.sections.hhi_by_department.data.find(d=>d.department.toLowerCase().includes('SEARCH')); if(dept)console.log(JSON.stringify(dept,null,2)); else console.log('Not found in HHI report');"
```

5. **Amendment rate** for this department:
```bash
node -e "const r=require('./data/reports/amendment-creep.json'); const dept=r.sections.dept_amendment_rates.data.find(d=>d.department.toLowerCase().includes('SEARCH')); if(dept)console.log(JSON.stringify(dept,null,2));"
```

6. **Provincial distribution** of the department's spending:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_province AS prov, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE owner_org_title ILIKE '%DEPT_NAME%' AND is_amendment=false AND recipient_province IS NOT NULL AND LENGTH(recipient_province)=2 GROUP BY 1 ORDER BY SUM(agreement_value) DESC\`).then(r=>{console.table(r.rows);db.end();})"
```

7. **Synthesize the audit** covering:
   - Department scale and scope
   - Recipient concentration (HHI, top-3 share)
   - Amendment patterns (rate vs other departments)
   - Geographic fairness (provincial distribution)
   - For-profit vs non-profit split
   - Risk-flagged recipients
   - Key findings and recommendations
