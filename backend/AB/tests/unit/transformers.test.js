const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractMongoValue,
  parseDecimal,
  parseInteger,
  parseDate,
  cleanString,
  sqlStr,
  sqlVal,
} = require('../../lib/transformers');

// ── extractMongoValue ──────────────────────────────────────────────

describe('extractMongoValue', () => {
  it('returns null for null/undefined', () => {
    assert.equal(extractMongoValue(null), null);
    assert.equal(extractMongoValue(undefined), null);
  });

  it('passes through plain numbers', () => {
    assert.equal(extractMongoValue(42), 42);
    assert.equal(extractMongoValue(-1125000), -1125000);
    assert.equal(extractMongoValue(0), 0);
  });

  it('passes through plain strings', () => {
    assert.equal(extractMongoValue('hello'), 'hello');
  });

  it('extracts $numberLong', () => {
    assert.equal(extractMongoValue({ $numberLong: '1234567890' }), 1234567890);
  });

  it('extracts $numberDecimal', () => {
    assert.equal(extractMongoValue({ $numberDecimal: '99.95' }), 99.95);
  });

  it('extracts $numberInt', () => {
    assert.equal(extractMongoValue({ $numberInt: '42' }), 42);
  });

  it('extracts $oid', () => {
    assert.equal(extractMongoValue({ $oid: 'abc123' }), 'abc123');
  });

  it('extracts $date', () => {
    assert.equal(extractMongoValue({ $date: '2024-01-15T00:00:00.000Z' }), '2024-01-15T00:00:00.000Z');
  });

  it('returns unknown objects as-is', () => {
    const obj = { foo: 'bar' };
    assert.deepEqual(extractMongoValue(obj), obj);
  });
});

// ── parseDecimal ───────────────────────────────────────────────────

describe('parseDecimal', () => {
  it('returns null for null/undefined/empty', () => {
    assert.equal(parseDecimal(null), null);
    assert.equal(parseDecimal(undefined), null);
    assert.equal(parseDecimal(''), null);
  });

  it('passes through numbers', () => {
    assert.equal(parseDecimal(42.5), 42.5);
    assert.equal(parseDecimal(-100), -100);
    assert.equal(parseDecimal(0), 0);
  });

  it('parses string numbers', () => {
    assert.equal(parseDecimal('42.50'), 42.50);
    assert.equal(parseDecimal('-100'), -100);
  });

  it('strips $ signs, commas, spaces', () => {
    assert.equal(parseDecimal('$3,138.00'), 3138.00);
    assert.equal(parseDecimal('$ 1,000,000.50'), 1000000.50);
    assert.equal(parseDecimal('250851.89'), 250851.89);
  });

  it('returns null for non-numeric', () => {
    assert.equal(parseDecimal('abc'), null);
    assert.equal(parseDecimal('N/A'), null);
  });

  it('returns null for NaN', () => {
    assert.equal(parseDecimal(NaN), null);
  });
});

// ── parseInteger ───────────────────────────────────────────────────

describe('parseInteger', () => {
  it('returns null for null/undefined/empty', () => {
    assert.equal(parseInteger(null), null);
    assert.equal(parseInteger(undefined), null);
    assert.equal(parseInteger(''), null);
  });

  it('parses integers', () => {
    assert.equal(parseInteger('42'), 42);
    assert.equal(parseInteger(42), 42);
    assert.equal(parseInteger(42.7), 43); // rounds
  });

  it('returns null for non-numeric', () => {
    assert.equal(parseInteger('abc'), null);
  });
});

// ── parseDate ──────────────────────────────────────────────────────

describe('parseDate', () => {
  it('returns null for null/undefined/empty', () => {
    assert.equal(parseDate(null), null);
    assert.equal(parseDate(undefined), null);
    assert.equal(parseDate(''), null);
  });

  it('parses ISO 8601 with time', () => {
    assert.equal(parseDate('2014-04-02T00:00:00.000Z'), '2014-04-02');
    assert.equal(parseDate('2025-03-03T23:18:46.645Z'), '2025-03-03');
  });

  it('parses YYYY-MM-DD', () => {
    assert.equal(parseDate('2024-01-15'), '2024-01-15');
  });

  it('parses YYYY/MM/DD (non-profit format)', () => {
    assert.equal(parseDate('1979/06/18'), '1979-06-18');
  });

  it('parses M/D/YYYY format (sole-source)', () => {
    assert.equal(parseDate('6/22/2015 12:00:00 AM'), '2015-06-22');
    assert.equal(parseDate('12/1/2020 12:00:00 AM'), '2020-12-01');
  });

  it('handles Excel serial numbers', () => {
    // Excel serial 44927 = 2023-01-01
    const result = parseDate(44927);
    assert.ok(result, 'Should return a date for serial number');
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects invalid years', () => {
    assert.equal(parseDate('0001-01-01'), null);
    assert.equal(parseDate('3000-01-01'), null);
  });

  it('rejects garbage strings', () => {
    assert.equal(parseDate('not-a-date'), null);
    assert.equal(parseDate('hello'), null);
  });
});

// ── cleanString ────────────────────────────────────────────────────

describe('cleanString', () => {
  it('returns null for null/undefined', () => {
    assert.equal(cleanString(null), null);
    assert.equal(cleanString(undefined), null);
  });

  it('trims whitespace', () => {
    assert.equal(cleanString('  hello  '), 'hello');
  });

  it('returns null for empty/whitespace-only strings', () => {
    assert.equal(cleanString(''), null);
    assert.equal(cleanString('   '), null);
  });

  it('converts non-strings', () => {
    assert.equal(cleanString(42), '42');
    assert.equal(cleanString(false), 'false');
  });
});

// ── sqlStr / sqlVal ────────────────────────────────────────────────

describe('sqlStr', () => {
  it('returns NULL for null/undefined', () => {
    assert.equal(sqlStr(null), 'NULL');
    assert.equal(sqlStr(undefined), 'NULL');
  });

  it('quotes strings', () => {
    assert.equal(sqlStr('hello'), "'hello'");
  });

  it('escapes single quotes', () => {
    assert.equal(sqlStr("it's"), "'it''s'");
  });
});

describe('sqlVal', () => {
  it('returns NULL for null', () => {
    assert.equal(sqlVal(null), 'NULL');
  });

  it('quotes strings', () => {
    assert.equal(sqlVal('hello'), "'hello'");
  });

  it('passes numbers through', () => {
    assert.equal(sqlVal(42), 42);
  });

  it('converts booleans', () => {
    assert.equal(sqlVal(true), 'true');
    assert.equal(sqlVal(false), 'false');
  });
});
