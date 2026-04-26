---
name: provincial-briefing
description: Generate a comprehensive federal funding briefing for a specific province or territory
argument-hint: "[province code, e.g. AB, ON, BC, SK]"
disable-model-invocation: true
---

Generate a provincial funding briefing for **$ARGUMENTS**.

## Steps

1. **Validate the province code** against the fed.province_lookup table:
```bash
node -e "const db=require('./lib/db'); db.query(\"SELECT code, name_en FROM fed.province_lookup WHERE code = '\$ARGUMENTS' OR name_en ILIKE '%\$ARGUMENTS%'\").then(r=>{console.table(r.rows);db.end();})"
```

2. **Get the provincial overview** (total funding, departments, recipients, programs):
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT COUNT(*) AS grants, COUNT(DISTINCT recipient_legal_name) AS recipients, ROUND(SUM(agreement_value)::numeric/1e9,2) AS total_billions, COUNT(DISTINCT owner_org) AS departments, COUNT(DISTINCT prog_name_en) AS programs FROM fed.grants_contributions WHERE recipient_province='CODE' AND is_amendment=false\`).then(r=>{console.table(r.rows);db.end();})"
```

3. **Compare per-capita funding** against the national average ($10,621/capita). Use population data:
   - ON: 15.8M, QC: 8.9M, BC: 5.6M, AB: 4.8M, MB: 1.5M, SK: 1.2M, NS: 1.1M, NB: 833K, NL: 534K, PE: 176K, NT: 45K, YT: 44K, NU: 41K

4. **Get top 15 recipients** in the province:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_legal_name AS name, recipient_type, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions, COUNT(DISTINCT owner_org) AS depts FROM fed.grants_contributions WHERE recipient_province='CODE' AND is_amendment=false AND agreement_value>0 GROUP BY recipient_legal_name, recipient_type ORDER BY SUM(agreement_value) DESC LIMIT 15\`).then(r=>{console.table(r.rows);db.end();})"
```

5. **Get top departments** spending in the province:
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT owner_org_title AS dept, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE recipient_province='CODE' AND is_amendment=false GROUP BY owner_org_title ORDER BY SUM(agreement_value) DESC LIMIT 10\`).then(r=>{console.table(r.rows);db.end();})"
```

6. **Get for-profit recipients without business numbers** (ghost signals):
```bash
node -e "const db=require('./lib/db'); db.query(\`SELECT recipient_legal_name AS name, COUNT(*) AS grants, ROUND(SUM(agreement_value)::numeric/1e6,1) AS millions FROM fed.grants_contributions WHERE recipient_province='CODE' AND recipient_type='F' AND is_amendment=false AND (recipient_business_number IS NULL OR recipient_business_number='') AND agreement_value>0 GROUP BY recipient_legal_name HAVING SUM(agreement_value)>=100000 ORDER BY SUM(agreement_value) DESC LIMIT 15\`).then(r=>{console.table(r.rows);db.end();})"
```

7. **Check the risk register** for flagged entities in this province:
```bash
node -e "const r=require('./data/reports/risk-register.json'); const prov=r.top_risks.filter(e=>e.province==='CODE'); console.log('Flagged in province:', prov.length); prov.slice(0,15).forEach((e,i)=>console.log((i+1)+'. ['+e.total_score+'] '+e.recipient_type+' | $'+(e.total_value/1e6).toFixed(1)+'M | '+e.name.slice(0,50)+' | Factors: '+e.factors.join(', ')));"
```

8. **Synthesize a briefing** covering:
   - Overall funding position vs national average
   - Key federal departments investing in the province
   - Largest recipients and what they do
   - Indigenous funding significance
   - For-profit concerns (ghost companies, concentration)
   - Risk-flagged entities requiring attention
   - Policy alignment observations
