const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  parseDecimal,
  parseInteger,
  parseDate,
  cleanString,
  sqlStr,
  sqlVal,
} = require('../../lib/transformers');

// ─── parseDecimal ────────────────────────────────────────────────

describe('parseDecimal', () => {
  it('parses valid decimal strings', () => {
    assert.equal(parseDecimal('123.45'), 123.45);
    assert.equal(parseDecimal('0'), 0);
    assert.equal(parseDecimal('-50.5'), -50.5);
    assert.equal(parseDecimal('1000000'), 1000000);
  });

  it('returns null for empty/invalid', () => {
    assert.equal(parseDecimal(''), null);
    assert.equal(parseDecimal(null), null);
    assert.equal(parseDecimal(undefined), null);
    assert.equal(parseDecimal('abc'), null);
  });
});

// ─── parseInteger ────────────────────────────────────────────────

describe('parseInteger', () => {
  it('parses valid integers', () => {
    assert.equal(parseInteger('42'), 42);
    assert.equal(parseInteger('0'), 0);
    assert.equal(parseInteger('-1'), -1);
  });

  it('returns null for empty/invalid', () => {
    assert.equal(parseInteger(''), null);
    assert.equal(parseInteger(null), null);
    assert.equal(parseInteger(undefined), null);
    assert.equal(parseInteger('xyz'), null);
  });

  it('truncates decimal strings to integer', () => {
    assert.equal(parseInteger('3.14'), 3);
  });
});

// ─── parseDate ───────────────────────────────────────────────────

describe('parseDate', () => {
  it('accepts YYYY-MM-DD format', () => {
    assert.equal(parseDate('2024-01-15'), '2024-01-15');
    assert.equal(parseDate('2020-12-31'), '2020-12-31');
  });

  it('accepts YYYY/MM/DD format', () => {
    assert.equal(parseDate('2024/1/5'), '2024/1/5');
  });

  it('returns null for invalid dates', () => {
    assert.equal(parseDate(''), null);
    assert.equal(parseDate(null), null);
    assert.equal(parseDate('not-a-date'), null);
    assert.equal(parseDate('2024'), null);
    assert.equal(parseDate('01-15-2024'), null);
  });

  it('strips whitespace and control characters', () => {
    assert.equal(parseDate('  2024-01-15  '), '2024-01-15');
    assert.equal(parseDate('2024-01-15\n'), '2024-01-15');
  });
});

// ─── cleanString ─────────────────────────────────────────────────

describe('cleanString', () => {
  it('trims strings', () => {
    assert.equal(cleanString('  hello  '), 'hello');
  });

  it('returns null for empty/missing', () => {
    assert.equal(cleanString(''), null);
    assert.equal(cleanString(null), null);
    assert.equal(cleanString(undefined), null);
  });
});

// ─── sqlStr ──────────────────────────────────────────────────────

describe('sqlStr', () => {
  it('wraps strings in quotes', () => {
    assert.equal(sqlStr('hello'), "'hello'");
  });

  it('escapes single quotes', () => {
    assert.equal(sqlStr("it's"), "'it''s'");
  });

  it('returns NULL for null/undefined', () => {
    assert.equal(sqlStr(null), 'NULL');
    assert.equal(sqlStr(undefined), 'NULL');
  });
});

// ─── sqlVal ──────────────────────────────────────────────────────

describe('sqlVal', () => {
  it('quotes strings', () => {
    assert.equal(sqlVal('test'), "'test'");
  });

  it('passes numbers through', () => {
    assert.equal(sqlVal(42), 42);
    assert.equal(sqlVal(3.14), 3.14);
  });

  it('converts booleans', () => {
    assert.equal(sqlVal(true), 'true');
    assert.equal(sqlVal(false), 'false');
  });

  it('returns NULL for null/undefined', () => {
    assert.equal(sqlVal(null), 'NULL');
    assert.equal(sqlVal(undefined), 'NULL');
  });
});
