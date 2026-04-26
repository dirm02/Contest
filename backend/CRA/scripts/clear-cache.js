/**
 * clear-cache.js - Delete all cached API data.
 * Accepts optional --year YYYY to clear only one year.
 *
 * Usage:
 *   npm run clear-cache          # clear all cached data
 *   npm run clear-cache -- --year 2023   # clear only 2023
 */
const { clearCache } = require('../lib/api-client');

const yearArg = process.argv.find((a, i) => process.argv[i - 1] === '--year');
const year = yearArg ? parseInt(yearArg, 10) : null;

if (year && (year < 2000 || year > 2100)) {
  console.error('Invalid year. Provide a 4-digit year like 2023.');
  process.exit(1);
}

clearCache(year);
console.log('Done.');
