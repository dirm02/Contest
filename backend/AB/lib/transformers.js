/**
 * Data transformation helpers for Alberta Open Data pipeline.
 * Handles MongoDB extended JSON types, Excel formats, and currency parsing.
 */

/**
 * Extract a value from MongoDB extended JSON format.
 * Handles $numberLong, $numberDecimal, $numberInt, $oid, $date.
 */
function extractMongoValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (value.$numberLong) return parseFloat(value.$numberLong);
  if (value.$numberDecimal) return parseFloat(value.$numberDecimal);
  if (value.$numberInt) return parseInt(value.$numberInt, 10);
  if (value.$oid) return value.$oid;
  if (value.$date) return value.$date;
  return value;
}

/** Parse a decimal/currency string. Strips $, commas, spaces. Returns null for empty/invalid. */
function parseDecimal(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : value;
  const cleaned = String(value).replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/** Parse an integer string. Returns null for empty/invalid. */
function parseInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isNaN(value) ? null : Math.round(value);
  const parsed = Number.parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Parse a date from various formats:
 * - ISO 8601: "2014-04-02T00:00:00.000Z"
 * - YYYY-MM-DD or YYYY/MM/DD
 * - M/D/YYYY HH:MM:SS AM/PM (sole-source Excel)
 * - Excel serial number (days since 1899-12-30)
 * Returns ISO date string (YYYY-MM-DD) or null.
 */
function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  // Date object (e.g. from XLSX cellDates:true)
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    if (y < 1800 || y > 2100) return null;
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  // Excel serial number
  if (typeof value === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + value * 86400000);
    const y = d.getUTCFullYear();
    if (y < 1800 || y > 2100) return null;
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  const s = String(value).trim();
  if (!s) return null;

  // ISO 8601 with time
  if (s.includes('T')) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    if (y < 1800 || y > 2100) return null;
    return d.toISOString().slice(0, 10);
  }

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    const d = new Date(s.replace(/\//g, '-'));
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    if (y < 1800 || y > 2100) return null;
    return d.toISOString().slice(0, 10);
  }

  // M/D/YYYY ... (sole-source format: "6/22/2015 12:00:00 AM")
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    if (y < 1800 || y > 2100) return null;
    return d.toISOString().slice(0, 10);
  }

  // Fallback
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1800 || y > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/** Trim a string. Returns null for empty/missing. */
function cleanString(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Escape a string for SQL insertion (single quotes). */
function sqlStr(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Format a value for SQL: strings get quoted, null/undefined become NULL, others pass through. */
function sqlVal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string') return sqlStr(value);
  if (typeof value === 'boolean') return value.toString();
  return value;
}

module.exports = {
  extractMongoValue,
  parseDecimal,
  parseInteger,
  parseDate,
  cleanString,
  sqlStr,
  sqlVal,
};
