const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  yesNoToBool,
  parseDecimal,
  parseInteger,
  parseDate,
  cleanString,
  cleanCode2,
  sqlStr,
  sqlVal,
} = require('../../lib/transformers');

describe('yesNoToBool', () => {
  it('converts Y to true', () => assert.equal(yesNoToBool('Y'), true));
  it('converts y to true (case-insensitive)', () => assert.equal(yesNoToBool('y'), true));
  it('converts N to false', () => assert.equal(yesNoToBool('N'), false));
  it('converts n to false', () => assert.equal(yesNoToBool('n'), false));
  it('returns null for empty string', () => assert.equal(yesNoToBool(''), null));
  it('returns null for null', () => assert.equal(yesNoToBool(null), null));
  it('returns null for undefined', () => assert.equal(yesNoToBool(undefined), null));
  it('returns false for other strings', () => assert.equal(yesNoToBool('X'), false));
});

describe('parseDecimal', () => {
  it('parses valid decimal', () => assert.equal(parseDecimal('123.45'), 123.45));
  it('parses integer as decimal', () => assert.equal(parseDecimal('100'), 100));
  it('parses negative', () => assert.equal(parseDecimal('-50.5'), -50.5));
  it('returns null for empty', () => assert.equal(parseDecimal(''), null));
  it('returns null for null', () => assert.equal(parseDecimal(null), null));
  it('returns null for non-numeric', () => assert.equal(parseDecimal('abc'), null));
  it('parses zero', () => assert.equal(parseDecimal('0'), 0));
});

describe('parseInteger', () => {
  it('parses valid integer', () => assert.equal(parseInteger('42'), 42));
  it('parses negative', () => assert.equal(parseInteger('-7'), -7));
  it('truncates decimal', () => assert.equal(parseInteger('3.14'), 3));
  it('returns null for empty', () => assert.equal(parseInteger(''), null));
  it('returns null for null', () => assert.equal(parseInteger(null), null));
  it('returns null for non-numeric', () => assert.equal(parseInteger('abc'), null));
  it('parses zero', () => assert.equal(parseInteger('0'), 0));
});

describe('parseDate', () => {
  it('parses YYYY-MM-DD', () => assert.equal(parseDate('2023-01-31'), '2023-01-31'));
  it('parses YYYY/MM/DD', () => assert.equal(parseDate('2023/1/1'), '2023/1/1'));
  it('returns null for empty', () => assert.equal(parseDate(''), null));
  it('returns null for null', () => assert.equal(parseDate(null), null));
  it('returns null for too short', () => assert.equal(parseDate('2023'), null));
  it('returns null for bad format', () => assert.equal(parseDate('Jan 31, 2023'), null));
  it('strips whitespace', () => assert.equal(parseDate('  2023-01-31  '), '2023-01-31'));
});

describe('cleanString', () => {
  it('trims whitespace', () => assert.equal(cleanString('  hello  '), 'hello'));
  it('returns null for empty', () => assert.equal(cleanString(''), null));
  it('returns null for null', () => assert.equal(cleanString(null), null));
  it('preserves internal spaces', () => assert.equal(cleanString(' foo bar '), 'foo bar'));
});

describe('cleanCode2', () => {
  it('returns uppercase 2-letter code', () => assert.equal(cleanCode2('on'), 'ON'));
  it('returns null for too long', () => assert.equal(cleanCode2('ONT'), null));
  it('returns null for numbers', () => assert.equal(cleanCode2('12'), null));
  it('returns null for empty', () => assert.equal(cleanCode2(''), null));
  it('returns null for null', () => assert.equal(cleanCode2(null), null));
  it('trims and validates', () => assert.equal(cleanCode2(' CA '), 'CA'));
});

describe('sqlStr', () => {
  it('wraps string in quotes', () => assert.equal(sqlStr('hello'), "'hello'"));
  it('escapes single quotes', () => assert.equal(sqlStr("it's"), "\'it''s\'"));
  it('returns NULL for null', () => assert.equal(sqlStr(null), 'NULL'));
  it('returns NULL for undefined', () => assert.equal(sqlStr(undefined), 'NULL'));
});

describe('sqlVal', () => {
  it('quotes strings', () => assert.equal(sqlVal('test'), "'test'"));
  it('passes numbers through', () => assert.equal(sqlVal(42), 42));
  it('converts booleans', () => assert.equal(sqlVal(true), 'true'));
  it('returns NULL for null', () => assert.equal(sqlVal(null), 'NULL'));
});
