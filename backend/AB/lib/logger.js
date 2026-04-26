function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function info(msg) {
  console.log(`[${timestamp()}] ${msg}`);
}

function warn(msg) {
  console.warn(`[${timestamp()}] WARN: ${msg}`);
}

function error(msg) {
  console.error(`[${timestamp()}] ERROR: ${msg}`);
}

function section(title) {
  const line = '='.repeat(60);
  console.log('');
  console.log(line);
  console.log(`  ${title}`);
  console.log(line);
}

function progress(current, total, label) {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : 0;
  info(`  ${label}: ${current.toLocaleString()}/${total.toLocaleString()} (${pct}%)`);
}

module.exports = { info, warn, error, section, progress };
