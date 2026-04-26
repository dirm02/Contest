#!/usr/bin/env node
/**
 * run-splink.js - Node orchestration for the Splink probabilistic matching tier.
 *
 * Drives the Python pipeline in splink/ as a subprocess:
 *   1. python splink/export_source_data.py  (Postgres → parquet)
 *   2. python splink/run_splink.py           (parquet → Splink → Postgres)
 *
 * On completion, general.splink_predictions + splink_aliases + splink_build_metadata
 * are populated. 06-detect-candidates.js Tier 5 reads from splink_predictions to
 * emit merge candidates for LLM review.
 *
 * Requires: Python 3.10+, pip install -r splink/requirements.txt
 *
 * Usage:
 *   npm run splink                   # export + match
 *   npm run splink -- --threshold 0.50
 *   npm run splink -- --skip-export  # reuse prior parquet files (fast rerun)
 */
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) { console.log(`[${ts()}] [splink-driver] ${msg}`); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { threshold: 0.40, skipExport: false, pythonCmd: process.env.PYTHON || 'python' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold') opts.threshold = parseFloat(args[++i]);
    if (args[i] === '--skip-export') opts.skipExport = true;
    if (args[i] === '--python') opts.pythonCmd = args[++i];
  }
  return opts;
}

function runPython(pythonCmd, scriptPath, scriptArgs) {
  return new Promise((resolve, reject) => {
    log(`spawn: ${pythonCmd} ${scriptPath} ${scriptArgs.join(' ')}`);
    const proc = spawn(pythonCmd, [scriptPath, ...scriptArgs], {
      cwd: path.dirname(path.dirname(scriptPath)), // general/
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

async function main() {
  const opts = parseArgs();
  const splinkDir = path.join(__dirname, '..', 'splink');
  const exportScript = path.join(splinkDir, 'export_source_data.py');
  const runScript = path.join(splinkDir, 'run_splink.py');

  for (const f of [exportScript, runScript]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing: ${f}`);
      process.exit(1);
    }
  }

  const t0 = Date.now();

  if (!opts.skipExport) {
    log('Step 1: Export Postgres sources → parquet');
    await runPython(opts.pythonCmd, exportScript, []);
  } else {
    log('Step 1: SKIPPED (--skip-export)');
  }

  log(`Step 2: Run Splink (threshold=${opts.threshold})`);
  await runPython(opts.pythonCmd, runScript, ['--threshold', String(opts.threshold)]);

  log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch(e => { console.error(`FATAL: ${e.message}`); process.exit(1); });
