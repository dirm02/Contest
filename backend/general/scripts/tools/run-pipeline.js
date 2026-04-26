#!/usr/bin/env node
/**
 * run-pipeline.js - Sequential driver for the entity resolution pipeline.
 *
 * Talks to the dashboard HTTP API (localhost:3800) to trigger each phase in
 * order, polls /api/state, advances to the next phase when the current one
 * exits cleanly, and emits one-line events per transition so an operator
 * (human or Monitor tool) can follow along.
 *
 * Defaults to running 08 LLM with --provider vertex only (the DB is huge
 * enough that the full pipeline takes 12-16 hours at 100 concurrency).
 *
 * Usage:
 *   node scripts/tools/run-pipeline.js              # full pipeline, vertex only
 *   node scripts/tools/run-pipeline.js --skip reset # skip reset phase
 *   node scripts/tools/run-pipeline.js --from llm_vtx
 */

const DASH = process.env.DASH_URL || 'http://localhost:3800';
const POLL_MS = parseInt(process.env.POLL_MS || '15000', 10);

// Ordered phase keys — must match dashboard PHASES in dashboard.js.
const SEQUENCE = [
  'reset', 'migrate', 'resolve', 'splink', 'detect',
  'smartmatch', 'llm_vtx', 'build', 'donee_fb',
];

function parseArgs() {
  const out = { skip: new Set(), from: null };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skip' && args[i + 1]) out.skip.add(args[++i]);
    else if (args[i] === '--from' && args[i + 1]) out.from = args[++i];
  }
  return out;
}

function emit(line) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${line}`);
}

async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

async function getState() {
  return fetchJson(`${DASH}/api/state`);
}

async function triggerPhase(key) {
  return fetchJson(`${DASH}/api/run/${key}`, { method: 'POST' });
}

function pct(num, den) {
  if (!den || den === 0) return 0;
  return Math.round((num / den) * 1000) / 10;
}

function fmt(n) { return (n === null || n === undefined) ? '-' : Number(n).toLocaleString(); }

// Milestone tracking so we don't spam progress lines.
const milestones = {
  llm_last_pct: -1,
  llm_last_report_ms: 0,
  entities_last_report_ms: 0,
  splink_last_report_ms: 0,
};

function reportLlmProgress(state) {
  const p = state.counts.llm_progress;
  if (!p || !p.total) return;
  const reviewed = p.same + p.related + p.different + p.uncertain + p.error;
  const progress = pct(reviewed, p.total);
  const now = Date.now();
  const bucket = Math.floor(progress / 5) * 5;
  const timeElapsed = now - milestones.llm_last_report_ms;
  if (bucket !== milestones.llm_last_pct || timeElapsed > 10 * 60 * 1000) {
    milestones.llm_last_pct = bucket;
    milestones.llm_last_report_ms = now;
    const rate = state.counts.llm_rate_per_sec || 0;
    const eta = state.counts.llm_eta_min;
    const etaStr = eta === undefined ? '?' :
      (eta >= 60 ? `${Math.floor(eta/60)}h${eta%60}m` : `${eta}m`);
    emit(`llm progress: ${fmt(reviewed)}/${fmt(p.total)} (${progress}%) ` +
      `pending=${fmt(p.pending)} same=${fmt(p.same)} related=${fmt(p.related)} ` +
      `diff=${fmt(p.different)} err=${fmt(p.error)} rate=${rate}/s eta=${etaStr}`);
  }
}

function reportEntitiesSnapshot(state) {
  const now = Date.now();
  if (now - milestones.entities_last_report_ms < 2 * 60 * 1000) return;
  milestones.entities_last_report_ms = now;
  const e = state.counts.entities;
  if (!e) return;
  emit(`entities: total=${fmt(e.total)} active=${fmt(e.active)} merged=${fmt(e.merged)} ` +
    `with_bn=${fmt(e.with_bn)} cross_dataset=${fmt(e.cross_dataset)} ` +
    `links=${fmt(state.counts.source_links_total)}`);
}

function reportSplinkSnapshot(state) {
  const now = Date.now();
  if (now - milestones.splink_last_report_ms < 2 * 60 * 1000) return;
  milestones.splink_last_report_ms = now;
  const sp = state.counts.splink_predictions;
  const sb = state.counts.splink_build;
  if (!sp && !sb) return;
  emit(`splink: status=${sb?.status || '-'} preds=${fmt(sp?.total)} clusters=${fmt(sp?.clusters)} ` +
    `high=${fmt(sp?.high_conf)} mid=${fmt(sp?.high_mid)} rev=${fmt(sp?.review_band)}`);
}

async function waitForPhase(key, startTs) {
  // Poll /api/state until the phase stops running. Return { exitCode, elapsed }.
  // Keep event emission sparse — only error-ish lastLine content, explicit
  // milestones, and phase transitions. The dashboard UI shows the live tail.
  const t0 = startTs || Date.now();
  let lastLine = '';
  while (true) {
    let state;
    try { state = await getState(); }
    catch (e) { emit(`[poll error] ${e.message.slice(0, 120)}`); await sleep(POLL_MS); continue; }

    const p = state.phases[key];
    if (!p) throw new Error(`phase not in state: ${key}`);

    // Only echo the phase's lastLine when it looks like trouble.
    if (p.lastLine && p.lastLine !== lastLine) {
      lastLine = p.lastLine;
      // Exclude MaxListenersExceededWarning — cosmetic Node warning from 08's
      // client.on('error') accumulation. Fatal-looking words ("error",
      // "listener") match the main regex otherwise.
      if (!/MaxListenersExceededWarning|memory leak detected/i.test(lastLine) &&
          /\berror\b|\bfatal\b|\bexception\b|\btraceback\b|\bfail|\babort|ENOTFOUND|ECONN|timeout|killed|OOM/i.test(lastLine)) {
        emit(`  ${key} WARN :: ${lastLine.slice(0, 200)}`);
      }
    }

    // LLM milestones only — every 5% progress or 10 minutes minimum.
    if (key === 'llm_vtx' || key === 'llm_ant') reportLlmProgress(state);

    if (!p.running && p.exitCode !== null) {
      return { exitCode: p.exitCode, elapsedMs: Date.now() - t0 };
    }
    await sleep(POLL_MS);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fmtElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60), rm = m % 60;
  return `${h}h${rm}m`;
}

async function runPhase(key) {
  const t0 = Date.now();
  // If the phase is already running (e.g., from a prior driver instance or
  // kicked off manually via the dashboard), skip triggering and just wait.
  let preState;
  try { preState = await getState(); } catch {}
  const already = preState?.phases?.[key];
  if (already?.running) {
    emit(`RESUMED phase=${key} (already running pid=${already.pid})`);
  } else {
    emit(`STARTED phase=${key}`);
    try {
      const r = await triggerPhase(key);
      if (r.error) { emit(`FAILED phase=${key} trigger-error: ${r.error}`); return { ok: false }; }
      emit(`  ${key} :: pid=${r.pid}`);
    } catch (e) {
      emit(`FAILED phase=${key} trigger-throw: ${e.message}`);
      return { ok: false };
    }
  }

  const { exitCode, elapsedMs } = await waitForPhase(key, t0);
  if (exitCode === 0) {
    emit(`FINISHED phase=${key} exit=0 elapsed=${fmtElapsed(elapsedMs)}`);
    return { ok: true };
  }
  emit(`FAILED phase=${key} exit=${exitCode} elapsed=${fmtElapsed(elapsedMs)}`);
  return { ok: false, exitCode };
}

async function main() {
  const { skip, from } = parseArgs();
  const pipelineT0 = Date.now();

  let seq = SEQUENCE.slice();
  if (from) {
    const i = seq.indexOf(from);
    if (i === -1) { emit(`FATAL unknown --from: ${from}`); process.exit(2); }
    seq = seq.slice(i);
  }
  seq = seq.filter(k => !skip.has(k));

  emit(`PIPELINE START sequence=[${seq.join(', ')}] dash=${DASH} poll=${POLL_MS}ms`);

  // Sanity check: dashboard reachable and all phases exist.
  try {
    const st = await getState();
    const missing = seq.filter(k => !st.phases[k]);
    if (missing.length) {
      emit(`FATAL missing phases in dashboard: ${missing.join(', ')}`);
      process.exit(2);
    }
  } catch (e) {
    emit(`FATAL cannot reach dashboard at ${DASH}: ${e.message}`);
    process.exit(2);
  }

  for (const key of seq) {
    const r = await runPhase(key);
    if (!r.ok) {
      emit(`PIPELINE ABORT at phase=${key} total_elapsed=${fmtElapsed(Date.now() - pipelineT0)}`);
      process.exit(1);
    }
  }

  emit(`PIPELINE COMPLETE total_elapsed=${fmtElapsed(Date.now() - pipelineT0)}`);
}

main().catch(e => { emit(`PIPELINE FATAL: ${e.message}`); process.exit(1); });
