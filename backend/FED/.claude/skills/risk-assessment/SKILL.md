---
name: risk-assessment
description: Analyze risk factors for a specific entity or group of entities from the risk register
argument-hint: "[entity name, province code, or 'top N']"
disable-model-invocation: true
---

Perform a risk assessment for **$ARGUMENTS**.

## Steps

1. **Load the risk register**:
```bash
node -e "const r=require('./data/reports/risk-register.json'); console.log('Summary:', JSON.stringify(r.summary)); console.log('Methodology:', JSON.stringify(r.methodology.dimensions, null, 2));"
```

2. **Find matching entities** (by name, province, or top N):
```bash
# By name:
node -e "const r=require('./data/reports/risk-register.json'); const matches=r.critical_and_high.filter(e=>e.name.toLowerCase().includes('SEARCH')); matches.slice(0,20).forEach((e,i)=>console.log((i+1)+'. ['+e.total_score+'/35 '+e.risk_level+'] '+e.recipient_type+' | '+e.province+' | $'+(e.total_value/1e6).toFixed(1)+'M | '+e.name.slice(0,50)));"

# By province:
node -e "const r=require('./data/reports/risk-register.json'); const matches=r.critical_and_high.filter(e=>e.province==='AB').sort((a,b)=>b.total_score-a.total_score); console.log('Found:',matches.length); matches.slice(0,20).forEach((e,i)=>console.log((i+1)+'. ['+e.total_score+'] '+e.recipient_type+' | $'+(e.total_value/1e6).toFixed(1)+'M | '+e.name.slice(0,50)+' | '+e.factors.join(', ')));"

# Top N:
node -e "const r=require('./data/reports/risk-register.json'); r.top_risks.slice(0,20).forEach((e,i)=>console.log((i+1)+'. ['+e.total_score+'/35] '+e.recipient_type+' | '+e.province+' | $'+(e.total_value/1e6).toFixed(1)+'M | '+e.name.slice(0,50)));"
```

3. **For each entity of interest, get the score breakdown**:
```bash
node -e "const r=require('./data/reports/risk-register.json'); const e=r.top_risks.find(x=>x.name.includes('NAME')); if(e){console.log(JSON.stringify({name:e.name,type:e.recipient_type,province:e.province,score:e.total_score,level:e.risk_level,scores:e.scores,factors:e.factors,total_value:e.total_value,grants:e.original_count,last_year:e.last_year},null,2))}"
```

4. **Cross-reference with other reports** for deeper context:
   - `data/reports/zombie-and-ghost.json` for cessation/ghost signals
   - `data/reports/amendment-creep.json` for amendment patterns
   - `data/reports/recipient-concentration.json` for dominance patterns

5. **Present the assessment** with:
   - Risk score breakdown by dimension (C/I/A/N/D/O/S)
   - Specific risk factors with explanations
   - Comparison to peers (same type, same province)
   - Recommended next steps (external lookups, audits)
