---
name: detect-circular-patterns
description: Run the circular gifting detection pipeline and interpret the top results
disable-model-invocation: true
---

Run the circular pattern detection and scoring pipeline, then interpret results.

1. **Check if already run**:
   ```bash
   ls data/reports/universe-scored.json 2>/dev/null && echo "Already run" || echo "Not yet run"
   ```

2. **Run if needed** (loop detection takes ~2 hours for 6-hop, scoring ~5 minutes):
   ```bash
   npm run analyze:all
   ```

3. **Show the results**:
   ```bash
   head -60 data/reports/universe-top50.txt
   ```

4. **Show score distribution**:
   ```bash
   node -e "const d=JSON.parse(require('fs').readFileSync('data/reports/universe-scored.json','utf8')); console.log('Total scored:',d.charities.length); console.log('Score>=15:',d.charities.filter(c=>c.score>=15).length); console.log('Score>=10:',d.charities.filter(c=>c.score>=10).length);"
   ```

5. **Triage the top results** by charity type:
   - Denominational hierarchies → structurally expected circular flows
   - Federated charities (United Way) → redistribution IS the mission
   - Online platforms → hub artifacts
   - Public/private foundations → endowment/grant cycles
   - **Standalone Designation C charities** → strongest signal for further analysis

6. For interesting entities, suggest: `/profile-charity <name>`
