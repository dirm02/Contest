---
name: recipient-profile
description: Deep profile of a federal grant recipient including all grants, departments, programs, and risk factors
argument-hint: "[recipient name or business number]"
disable-model-invocation: true
---

Build a comprehensive profile for the grant recipient **$ARGUMENTS**.

## Steps

1. **Find the entity** in the database:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT DISTINCT recipient_legal_name, recipient_business_number, recipient_type, recipient_province, recipient_city FROM fed.grants_contributions WHERE recipient_legal_name ILIKE '%\$ARGUMENTS%' OR recipient_business_number LIKE '%\$ARGUMENTS%' LIMIT 10\`).then(r=>{console.table(r.rows);db.end();})"
```

2. **Get the entity summary** (use the exact name from step 1):
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_legal_name AS name, recipient_business_number AS bn, recipient_type, recipient_province, recipient_city, COUNT(*) FILTER (WHERE is_amendment=false) AS original_grants, COUNT(*) FILTER (WHERE is_amendment=true) AS amendments, COUNT(DISTINCT owner_org) AS dept_count, ROUND(SUM(agreement_value) FILTER (WHERE is_amendment=false)::numeric/1e6,2) AS original_millions, ROUND(SUM(agreement_value) FILTER (WHERE is_amendment=true)::numeric/1e6,2) AS amendment_millions, MIN(agreement_start_date) AS first_grant, MAX(agreement_start_date) AS last_grant FROM fed.grants_contributions WHERE recipient_legal_name='EXACT_NAME' GROUP BY 1,2,3,4,5\`).then(r=>{console.table(r.rows);db.end();})"
```

3. **List all grants** with details:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT ref_number, agreement_type, agreement_value, agreement_start_date, is_amendment, owner_org_title, prog_name_en, agreement_title_en FROM fed.grants_contributions WHERE recipient_legal_name='EXACT_NAME' ORDER BY agreement_start_date DESC\`).then(r=>{console.table(r.rows);db.end();})"
```

4. **Check the risk register** for this entity:
```bash
node -e "const r=require('./data/reports/risk-register.json'); const e=r.critical_and_high.find(x=>x.name.toLowerCase().includes('SEARCH_TERM')); if(e){console.log('RISK SCORE:',e.total_score+'/35',e.risk_level); console.log('Scores:',JSON.stringify(e.scores)); console.log('Factors:',e.factors.join(', '))}else{console.log('Not in critical/high risk list')}"
```

5. **Check for the entity in the for-profit deep dive** (if for-profit):
```bash
node -e "const r=require('./data/reports/for-profit-deep-dive.json'); const found=r.sections.top_recipients?.data?.find(x=>x.name?.toLowerCase().includes('SEARCH_TERM')); if(found)console.log(JSON.stringify(found,null,2)); else console.log('Not in for-profit top 50');"
```

6. **Synthesize a profile** including:
   - Entity identity (name, BN, type, location)
   - Funding summary (total value, grant count, departments)
   - Grant timeline and trend
   - Amendment patterns
   - Risk assessment with specific factors
   - Recommendations for further investigation
