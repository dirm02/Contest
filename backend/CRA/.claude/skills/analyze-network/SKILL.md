---
name: analyze-network
description: Map the gift-flow network around a charity to find connected organizations and clusters
argument-hint: [charity name or BN]
disable-model-invocation: true
---

Map the gift-flow network around: $ARGUMENTS

1. **Run the network lookup**:
   ```bash
   npm run lookup -- --name "$ARGUMENTS" --hops 5
   ```
   Or by BN: `npm run lookup -- --bn <BN> --hops 5`

2. **Read the results** from `data/reports/lookup-<BN>.json`:
   - Total outgoing and incoming gift amounts
   - Number of reciprocal partners
   - Network size (unique connected charities)
   - Any funding loops detected (3-5 hops)

3. **Identify the largest flows**:
   ```bash
   node -e "const r=JSON.parse(require('fs').readFileSync('data/reports/lookup-<BN>.json','utf8')); console.log('Top recipients:'); r.outgoingGifts.slice(0,10).forEach(g=>console.log(' \$'+g.amount.toLocaleString()+' → '+g.name)); console.log('Top donors:'); r.incomingGifts.slice(0,10).forEach(g=>console.log(' \$'+g.amount.toLocaleString()+' ← '+g.name));"
   ```

4. **Check for cluster patterns**: hub-and-spoke, ring structures, daisy chains.

5. **Cross-reference shared directors** from the report.

6. **For suspicious clusters**, suggest profiling connected charities:
   `/profile-charity <partner name>`
