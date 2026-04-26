/**
 * clear-cache.js - Delete cached API data
 *
 * Removes all downloaded batch files from data/cache/grants/.
 * Use this to force a fresh re-download from the Open Data API.
 *
 * Usage: npm run clear-cache
 */
const { clearCache } = require('../lib/api-client');
const log = require('../lib/logger');

log.section('Clear Cache');
clearCache();
log.info('Cache cleared. Run "npm run fetch" to re-download.');
