/**
 * end-to-end.test.js - Comprehensive test suite covering 100% of exported
 * functions across general, AB, CRA, and FED projects.
 *
 * Run from hackathon root:
 *   node --test tests/end-to-end.test.js
 *
 * Sections:
 *   1. AB transformers (7 functions)
 *   2. AB logger (5 functions)
 *   3. CRA transformers (8 functions)
 *   4. CRA csv-parser (3 pure functions + 1 file function)
 *   5. FED transformers (6 functions)
 *   6. FED logger (5 functions)
 *   7. General fuzzy-match (5 functions + 2 constants)
 *   8. General entity-resolver (4 pure functions)
 *   9. General llm-review (2 pure functions)
 *  10. DB connectivity (4 pools: ab, cra, fed, general)
 *  11. General FuzzyMatcher integration (requires DB)
 *  12. General EntityResolver integration (requires DB)
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════
//  1. AB TRANSFORMERS
// ═══════════════════════════════════════════════════════════════════════

const abT = require('../AB/lib/transformers');

describe('AB transformers', () => {

  describe('extractMongoValue', () => {
    it('returns null for null/undefined', () => {
      assert.equal(abT.extractMongoValue(null), null);
      assert.equal(abT.extractMongoValue(undefined), null);
    });
    it('passes through plain values', () => {
      assert.equal(abT.extractMongoValue(42), 42);
      assert.equal(abT.extractMongoValue('hello'), 'hello');
      assert.equal(abT.extractMongoValue(0), 0);
    });
    it('extracts $numberLong', () => {
      assert.equal(abT.extractMongoValue({ $numberLong: '9999999' }), 9999999);
    });
    it('extracts $numberDecimal', () => {
      assert.equal(abT.extractMongoValue({ $numberDecimal: '3.14' }), 3.14);
    });
    it('extracts $numberInt', () => {
      assert.equal(abT.extractMongoValue({ $numberInt: '7' }), 7);
    });
    it('extracts $oid', () => {
      assert.equal(abT.extractMongoValue({ $oid: 'abc123' }), 'abc123');
    });
    it('extracts $date', () => {
      assert.equal(abT.extractMongoValue({ $date: '2024-01-01T00:00:00Z' }), '2024-01-01T00:00:00Z');
    });
    it('passes unknown objects through', () => {
      assert.deepEqual(abT.extractMongoValue({ foo: 1 }), { foo: 1 });
    });
  });

  describe('parseDecimal', () => {
    it('returns null for empty', () => {
      assert.equal(abT.parseDecimal(null), null);
      assert.equal(abT.parseDecimal(''), null);
    });
    it('parses numbers and strings', () => {
      assert.equal(abT.parseDecimal(42.5), 42.5);
      assert.equal(abT.parseDecimal('100.25'), 100.25);
    });
    it('strips currency formatting', () => {
      assert.equal(abT.parseDecimal('$3,138.00'), 3138);
      assert.equal(abT.parseDecimal('$ 1,000'), 1000);
    });
    it('returns null for non-numeric', () => {
      assert.equal(abT.parseDecimal('abc'), null);
      assert.equal(abT.parseDecimal(NaN), null);
    });
  });

  describe('parseInteger', () => {
    it('parses integers', () => {
      assert.equal(abT.parseInteger('42'), 42);
      assert.equal(abT.parseInteger(7), 7);
    });
    it('rounds numbers', () => {
      assert.equal(abT.parseInteger(3.9), 4);
    });
    it('returns null for empty/invalid', () => {
      assert.equal(abT.parseInteger(null), null);
      assert.equal(abT.parseInteger('abc'), null);
    });
  });

  describe('parseDate', () => {
    it('parses ISO 8601', () => {
      assert.equal(abT.parseDate('2024-01-15T00:00:00.000Z'), '2024-01-15');
    });
    it('parses YYYY-MM-DD', () => {
      assert.equal(abT.parseDate('2024-01-15'), '2024-01-15');
    });
    it('parses YYYY/MM/DD', () => {
      assert.equal(abT.parseDate('1979/06/18'), '1979-06-18');
    });
    it('parses M/D/YYYY HH:MM:SS AM/PM', () => {
      assert.equal(abT.parseDate('6/22/2015 12:00:00 AM'), '2015-06-22');
    });
    it('parses Excel serial numbers', () => {
      const result = abT.parseDate(44927);
      assert.ok(result);
      assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });
    it('rejects invalid years', () => {
      assert.equal(abT.parseDate('0001-01-01'), null);
      assert.equal(abT.parseDate('3000-01-01'), null);
    });
    it('returns null for null/empty/garbage', () => {
      assert.equal(abT.parseDate(null), null);
      assert.equal(abT.parseDate(''), null);
      assert.equal(abT.parseDate('not-a-date'), null);
    });
  });

  describe('cleanString', () => {
    it('trims whitespace', () => assert.equal(abT.cleanString('  hi  '), 'hi'));
    it('returns null for empty/whitespace', () => {
      assert.equal(abT.cleanString(''), null);
      assert.equal(abT.cleanString('   '), null);
      assert.equal(abT.cleanString(null), null);
    });
  });

  describe('sqlStr', () => {
    it('returns NULL for null', () => assert.equal(abT.sqlStr(null), 'NULL'));
    it('quotes strings', () => assert.equal(abT.sqlStr('hello'), "'hello'"));
    it('escapes quotes', () => assert.equal(abT.sqlStr("it's"), "'it''s'"));
  });

  describe('sqlVal', () => {
    it('returns NULL for null', () => assert.equal(abT.sqlVal(null), 'NULL'));
    it('quotes strings', () => assert.equal(abT.sqlVal('x'), "'x'"));
    it('passes numbers', () => assert.equal(abT.sqlVal(42), 42));
    it('converts booleans', () => assert.equal(abT.sqlVal(true), 'true'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. AB LOGGER
// ═══════════════════════════════════════════════════════════════════════

const abLog = require('../AB/lib/logger');

describe('AB logger', () => {
  it('info() does not throw', () => assert.doesNotThrow(() => abLog.info('test')));
  it('warn() does not throw', () => assert.doesNotThrow(() => abLog.warn('test')));
  it('error() does not throw', () => assert.doesNotThrow(() => abLog.error('test')));
  it('section() does not throw', () => assert.doesNotThrow(() => abLog.section('Test Section')));
  it('progress() does not throw', () => assert.doesNotThrow(() => abLog.progress(50, 100, 'items')));
});

// ═══════════════════════════════════════════════════════════════════════
//  3. CRA TRANSFORMERS
// ═══════════════════════════════════════════════════════════════════════

const craT = require('../CRA/lib/transformers');

describe('CRA transformers', () => {

  describe('yesNoToBool', () => {
    it('converts Y to true', () => assert.equal(craT.yesNoToBool('Y'), true));
    it('converts N to false', () => assert.equal(craT.yesNoToBool('N'), false));
    it('converts y to true (case)', () => assert.equal(craT.yesNoToBool('y'), true));
    it('returns null for empty', () => assert.equal(craT.yesNoToBool(''), null));
    it('returns null for null', () => assert.equal(craT.yesNoToBool(null), null));
  });

  describe('parseDecimal', () => {
    it('parses decimals', () => assert.equal(craT.parseDecimal('42.5'), 42.5));
    it('returns null for empty', () => assert.equal(craT.parseDecimal(''), null));
    it('returns null for invalid', () => assert.equal(craT.parseDecimal('abc'), null));
  });

  describe('parseInteger', () => {
    it('parses integers', () => assert.equal(craT.parseInteger('42'), 42));
    it('returns null for empty', () => assert.equal(craT.parseInteger(''), null));
  });

  describe('parseDate', () => {
    it('parses YYYY-MM-DD', () => assert.equal(craT.parseDate('2024-01-15'), '2024-01-15'));
    it('parses YYYY/MM/DD', () => assert.equal(craT.parseDate('2024/01/15'), '2024/01/15'));
    it('rejects short strings', () => assert.equal(craT.parseDate('abc'), null));
    it('rejects dates with time', () => assert.equal(craT.parseDate('2024-01-15T00:00:00Z'), null));
    it('strips whitespace chars', () => assert.equal(craT.parseDate('2024-01-15\r'), '2024-01-15'));
  });

  describe('cleanString', () => {
    it('trims', () => assert.equal(craT.cleanString('  hi  '), 'hi'));
    it('null for empty', () => assert.equal(craT.cleanString(''), null));
  });

  describe('cleanCode2', () => {
    it('returns uppercase code', () => assert.equal(craT.cleanCode2('on'), 'ON'));
    it('rejects long strings', () => assert.equal(craT.cleanCode2('ABC'), null));
    it('rejects numbers', () => assert.equal(craT.cleanCode2('12'), null));
    it('rejects null', () => assert.equal(craT.cleanCode2(null), null));
  });

  describe('sqlStr', () => {
    it('returns NULL for null', () => assert.equal(craT.sqlStr(null), 'NULL'));
    it('quotes and escapes', () => assert.equal(craT.sqlStr("O'Brien"), "'O''Brien'"));
  });

  describe('sqlVal', () => {
    it('null -> NULL', () => assert.equal(craT.sqlVal(null), 'NULL'));
    it('number passthrough', () => assert.equal(craT.sqlVal(99), 99));
    it('boolean conversion', () => assert.equal(craT.sqlVal(false), 'false'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. CRA CSV-PARSER (pure functions)
// ═══════════════════════════════════════════════════════════════════════

// CRA csv-parser tests are conditionally loaded. The CRA module archived
// `lib/csv-parser.js` during a refactor of its data-load pipeline. If it
// comes back (or any future module ships an equivalent), the require will
// succeed and the tests will run. If not, the describe() block is a no-op
// so the rest of the suite still executes.
let csvParser = null;
try { csvParser = require('../CRA/lib/csv-parser'); }
catch (e) { /* archived; tests below become skips */ }

describe('CRA csv-parser', { skip: !csvParser && 'CRA/lib/csv-parser.js not present (archived during a CRA module refactor)' }, () => {
  if (!csvParser) return;

  describe('parseDollar', () => {
    it('parses dollar amounts', () => assert.equal(csvParser.parseDollar('$3,138.00'), 3138));
    it('handles plain numbers', () => assert.equal(csvParser.parseDollar('100.50'), 100.5));
    it('returns null for empty', () => assert.equal(csvParser.parseDollar(''), null));
    it('returns null for null', () => assert.equal(csvParser.parseDollar(null), null));
    it('handles negative', () => assert.equal(csvParser.parseDollar('-$1,000'), -1000));
  });

  describe('parseCSVDate', () => {
    it('parses timestamp date', () => assert.equal(csvParser.parseCSVDate('2024-6-30 00:00:00'), '2024-06-30'));
    it('parses already formatted', () => assert.equal(csvParser.parseCSVDate('2024-06-30'), '2024-06-30'));
    it('pads single-digit months', () => assert.equal(csvParser.parseCSVDate('2024-1-5'), '2024-01-05'));
    it('returns null for empty', () => assert.equal(csvParser.parseCSVDate(''), null));
    it('returns null for null', () => assert.equal(csvParser.parseCSVDate(null), null));
    it('returns null for garbage', () => assert.equal(csvParser.parseCSVDate('nope'), null));
  });

  describe('readCSV with temp file', () => {
    const fs = require('fs');
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), 'test-csv-parser.csv');

    it('reads a basic CSV', () => {
      fs.writeFileSync(tmpFile, 'name,age,city\nAlice,30,Edmonton\nBob,25,Calgary\n');
      const result = csvParser.readCSV(tmpFile);
      assert.deepEqual(result.headers, ['name', 'age', 'city']);
      assert.equal(result.rows.length, 2);
      assert.equal(result.rows[0].name, 'Alice');
      assert.equal(result.rows[1].city, 'Calgary');
      fs.unlinkSync(tmpFile);
    });

    it('handles UTF-8 BOM', () => {
      fs.writeFileSync(tmpFile, '\uFEFFname,val\ntest,1\n');
      const result = csvParser.readCSV(tmpFile);
      assert.deepEqual(result.headers, ['name', 'val']);
      assert.equal(result.rows.length, 1);
      fs.unlinkSync(tmpFile);
    });

    it('countLines counts non-empty lines', () => {
      fs.writeFileSync(tmpFile, 'a\nb\n\nc\n');
      assert.equal(csvParser.countLines(tmpFile), 3);
      fs.unlinkSync(tmpFile);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  5. FED TRANSFORMERS
// ═══════════════════════════════════════════════════════════════════════

const fedT = require('../FED/lib/transformers');

describe('FED transformers', () => {

  describe('parseDecimal', () => {
    it('parses', () => assert.equal(fedT.parseDecimal('99.9'), 99.9));
    it('null for empty', () => assert.equal(fedT.parseDecimal(''), null));
  });

  describe('parseInteger', () => {
    it('parses', () => assert.equal(fedT.parseInteger('7'), 7));
    it('null for null', () => assert.equal(fedT.parseInteger(null), null));
  });

  describe('parseDate', () => {
    it('parses YYYY-MM-DD', () => assert.equal(fedT.parseDate('2024-01-15'), '2024-01-15'));
    it('returns null for garbage', () => assert.equal(fedT.parseDate('nope'), null));
  });

  describe('cleanString', () => {
    it('trims', () => assert.equal(fedT.cleanString('  hi  '), 'hi'));
    it('null for empty', () => assert.equal(fedT.cleanString(''), null));
  });

  describe('sqlStr', () => {
    it('quotes', () => assert.equal(fedT.sqlStr('test'), "'test'"));
    it('null', () => assert.equal(fedT.sqlStr(null), 'NULL'));
  });

  describe('sqlVal', () => {
    it('number', () => assert.equal(fedT.sqlVal(42), 42));
    it('string', () => assert.equal(fedT.sqlVal('x'), "'x'"));
    it('bool', () => assert.equal(fedT.sqlVal(true), 'true'));
    it('null', () => assert.equal(fedT.sqlVal(undefined), 'NULL'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  6. FED LOGGER
// ═══════════════════════════════════════════════════════════════════════

const fedLog = require('../FED/lib/logger');

describe('FED logger', () => {
  it('info()', () => assert.doesNotThrow(() => fedLog.info('test')));
  it('warn()', () => assert.doesNotThrow(() => fedLog.warn('test')));
  it('error()', () => assert.doesNotThrow(() => fedLog.error('test')));
  it('section()', () => assert.doesNotThrow(() => fedLog.section('Test')));
  it('progress()', () => assert.doesNotThrow(() => fedLog.progress(1, 10, 'x')));
});

// ═══════════════════════════════════════════════════════════════════════
//  7. GENERAL FUZZY-MATCH
// ═══════════════════════════════════════════════════════════════════════

const fm = require('../general/lib/fuzzy-match');

describe('General fuzzy-match', () => {

  describe('normalizeName', () => {
    it('uppercases and trims', () => {
      assert.equal(fm.normalizeName('  Hello World  '), 'HELLO WORLD');
    });
    it('strips punctuation', () => {
      assert.equal(fm.normalizeName("O'Brien & Sons, Inc."), 'O BRIEN SONS INC');
    });
    it('returns empty for null', () => {
      assert.equal(fm.normalizeName(null), '');
    });
  });

  describe('deepNormalize', () => {
    it('expands abbreviations', () => {
      const result = fm.deepNormalize('UNIV OF ALBERTA');
      // 'UNIV' expands to 'UNIVERSITY', 'OF ALBERTA' is stripped as suffix
      assert.ok(result.includes('UNIVERSITY'));
    });
    it('removes legal suffixes', () => {
      const result = fm.deepNormalize('ACME CORP LTD');
      assert.ok(result.includes('ACME'));
      // CORP and LTD should be stripped - check they're not standalone tokens
      const tokens = result.split(' ');
      assert.ok(!tokens.includes('CORP'));
      assert.ok(!tokens.includes('LTD'));
    });
    it('sorts tokens', () => {
      const result = fm.deepNormalize('ZEBRA ALPHA BETA');
      assert.equal(result, 'ALPHA BETA ZEBRA');
    });
    it('returns empty for null', () => {
      assert.equal(fm.deepNormalize(null), '');
    });
  });

  describe('jaccardSimilarity', () => {
    it('returns 1 for identical sets', () => {
      assert.equal(fm.jaccardSimilarity('A B C', 'A B C'), 1);
    });
    it('returns 0 for disjoint sets', () => {
      assert.equal(fm.jaccardSimilarity('A B', 'C D'), 0);
    });
    it('returns correct partial overlap', () => {
      const sim = fm.jaccardSimilarity('A B C', 'B C D');
      assert.ok(sim > 0.4 && sim < 0.6); // 2/4 = 0.5
    });
    it('returns >= 0 for empty strings', () => {
      // splitting '' produces [''] which has size 1; implementation-defined
      const sim = fm.jaccardSimilarity('', '');
      assert.ok(sim >= 0 && sim <= 1);
    });
  });

  describe('LEGAL_SUFFIXES', () => {
    it('is an array with expected entries', () => {
      assert.ok(Array.isArray(fm.LEGAL_SUFFIXES));
      assert.ok(fm.LEGAL_SUFFIXES.includes('LTD'));
      assert.ok(fm.LEGAL_SUFFIXES.includes('INC'));
      assert.ok(fm.LEGAL_SUFFIXES.includes('FOUNDATION'));
    });
  });

  describe('ABBREVIATIONS', () => {
    it('is an object with expected mappings', () => {
      assert.equal(typeof fm.ABBREVIATIONS, 'object');
      assert.equal(fm.ABBREVIATIONS['UNIV'], 'UNIVERSITY');
      assert.equal(fm.ABBREVIATIONS['DEPT'], 'DEPARTMENT');
      assert.equal(fm.ABBREVIATIONS['ASSN'], 'ASSOCIATION');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  8. GENERAL ENTITY-RESOLVER (pure functions)
// ═══════════════════════════════════════════════════════════════════════

const er = require('../general/lib/entity-resolver');

describe('General entity-resolver', () => {

  describe('extractRootBN', () => {
    it('extracts 9-digit root from full BN', () => {
      assert.equal(er.extractRootBN('118814391RR0001'), '118814391');
    });
    it('handles bare 9-digit BN', () => {
      assert.equal(er.extractRootBN('118814391'), '118814391');
    });
    it('handles RP suffix', () => {
      assert.equal(er.extractRootBN('834173627RP0001'), '834173627');
    });
    it('handles RC suffix', () => {
      assert.equal(er.extractRootBN('118814391RC0001'), '118814391');
    });
    it('handles RT suffix', () => {
      assert.equal(er.extractRootBN('834173627RT0001'), '834173627');
    });
    it('returns null for null/empty', () => {
      assert.equal(er.extractRootBN(null), null);
      assert.equal(er.extractRootBN(''), null);
    });
    it('returns null for short strings', () => {
      assert.equal(er.extractRootBN('12345'), null);
    });
    it('strips whitespace', () => {
      assert.equal(er.extractRootBN(' 118814391 RR0001'), '118814391');
    });
  });

  describe('coreTokens', () => {
    it('extracts meaningful tokens', () => {
      const tokens = er.coreTokens('THE ACME COMMUNITY SERVICE SOCIETY');
      assert.ok(tokens.has('ACME'));
      assert.ok(tokens.has('COMMUNITY'));
      assert.ok(tokens.has('SERVICE'));
      assert.ok(!tokens.has('THE'));      // stop word removed
      // SOCIETY is kept as a discriminating token — in Canadian non-profit
      // naming it distinguishes legal entity types (e.g. a "Society" is a
      // different corporate form than a "Foundation" under provincial law).
      assert.ok(tokens.has('SOCIETY'));
    });
    it('strips trade-name clauses', () => {
      const tokens = er.coreTokens('BOYLE STREET COMMUNITY SERVICES TRADE NAME OF THE BOYLE STREET SERVICE SOCIETY');
      assert.ok(tokens.has('BOYLE'));
      assert.ok(tokens.has('STREET'));
      assert.ok(tokens.has('COMMUNITY'));
      assert.ok(tokens.has('SERVICES'));
    });
    it('strips pipe-separated suffixes', () => {
      const tokens = er.coreTokens('Org Name | Nom Org');
      assert.ok(tokens.has('ORG'));
      assert.ok(tokens.has('NAME'));
      assert.ok(!tokens.has('NOM')); // after pipe, stripped
    });
    it('returns empty set for null', () => {
      assert.equal(er.coreTokens(null).size, 0);
    });
  });

  describe('coreTokenOverlap', () => {
    it('returns 1 for identical sets', () => {
      const a = new Set(['BOYLE', 'STREET', 'SERVICE']);
      assert.equal(er.coreTokenOverlap(a, a), 1);
    });
    it('returns 0 for disjoint sets', () => {
      const a = new Set(['BOYLE', 'STREET']);
      const b = new Set(['EDUCATION', 'CENTRE']);
      assert.equal(er.coreTokenOverlap(a, b), 0);
    });
    it('returns partial for subset', () => {
      const query = new Set(['BOYLE', 'STREET', 'SERVICE']);
      const cand = new Set(['BOYLE', 'STREET', 'EDUCATION']);
      const overlap = er.coreTokenOverlap(query, cand);
      assert.ok(overlap > 0.6 && overlap < 0.7); // 2/3
    });
    it('handles plural matching', () => {
      const query = new Set(['SERVICE']);
      const cand = new Set(['SERVICES']);
      assert.equal(er.coreTokenOverlap(query, cand), 1);
    });
    it('returns 0 for empty sets', () => {
      assert.equal(er.coreTokenOverlap(new Set(), new Set(['A'])), 0);
    });
  });

  describe('extractAlternateNames', () => {
    it('splits on TRADE NAME OF', () => {
      const names = er.extractAlternateNames('ORG A TRADE NAME OF ORG B');
      assert.ok(names.length >= 2);
      assert.ok(names.some(n => n.includes('ORG A')));
      assert.ok(names.some(n => n.includes('ORG B')));
    });
    it('splits on pipe', () => {
      const names = er.extractAlternateNames('Org English | Org French');
      assert.equal(names.length, 2);
      assert.equal(names[0], 'Org English');
      assert.equal(names[1], 'Org French');
    });
    it('strips trailing comma-period', () => {
      const names = er.extractAlternateNames('The Society, .');
      assert.ok(names[0].includes('The Society'));
      assert.ok(!names[0].includes(', .'));
    });
    it('returns single-element array for plain name', () => {
      const names = er.extractAlternateNames('Simple Name');
      assert.equal(names.length, 1);
      assert.equal(names[0], 'Simple Name');
    });
    it('handles null', () => {
      const names = er.extractAlternateNames(null);
      assert.equal(names.length, 1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  9. GENERAL LLM-REVIEW (pure functions)
// ═══════════════════════════════════════════════════════════════════════

const llm = require('../general/lib/llm-review');

describe('General llm-review', () => {

  describe('buildPrompt', () => {
    it('builds a prompt string from resolver results', () => {
      const mockResult = {
        query: 'Test Entity',
        bn: '123456789',
        core_tokens: ['TEST', 'ENTITY'],
        matches: [
          { matched_name: 'Test Entity Inc', source: 'CRA', confidence: 0.9, method: 'exact_tokens', details: { trigram_sim: 0.8, token_overlap: 1.0 } },
        ],
        rejected: [
          { name: 'Other Thing', source: 'FED', trigram_sim: 0.3, token_overlap: 0, reason: 'core tokens 0% < 70% threshold' },
        ],
      };
      const prompt = llm.buildPrompt(mockResult);
      assert.ok(typeof prompt === 'string');
      assert.ok(prompt.includes('Test Entity'));
      assert.ok(prompt.includes('123456789'));
      assert.ok(prompt.includes('Test Entity Inc'));
      assert.ok(prompt.includes('Other Thing'));
      assert.ok(prompt.includes('SAME'));
      assert.ok(prompt.includes('DIFFERENT'));
    });
  });

  describe('mergeResults', () => {
    it('merges LLM verdicts into resolver results', () => {
      const resolverResult = {
        query: 'Test',
        bn: null,
        core_tokens: ['TEST'],
        matches: [
          { matched_name: 'Test Corp', source: 'CRA', confidence: 0.7, method: 'exact_tokens' },
          { matched_name: 'Testing Ltd', source: 'FED', confidence: 0.6, method: 'core_token_gate' },
        ],
        rejected: [
          { name: 'Unrelated', source: 'AB-Grants', trigram_sim: 0.3, token_overlap: 0, reason: 'tokens' },
        ],
      };
      const llmResult = {
        verdicts: [
          { name: 'Test Corp', source: 'CRA', verdict: 'SAME', confidence: 0.95, reasoning: 'Same entity' },
          { name: 'Testing Ltd', source: 'FED', verdict: 'DIFFERENT', confidence: 0.9, reasoning: 'Different org' },
        ],
        summary: 'Test summary',
      };

      const merged = llm.mergeResults(resolverResult, llmResult);

      assert.equal(merged.llm_summary, 'Test summary');
      // Test Corp should be in final_matches (SAME)
      assert.ok(merged.final_matches.some(m => m.matched_name === 'Test Corp'));
      // Testing Ltd should be reclassified (DIFFERENT)
      assert.ok(merged.reclassified_by_llm.some(m => m.matched_name === 'Testing Ltd'));
      assert.equal(merged.reclassified_by_llm[0].llm_verdict, 'DIFFERENT');
    });

    it('handles LLM error gracefully', () => {
      const resolverResult = { query: 'X', matches: [], rejected: [] };
      const llmResult = { error: 'parse failed', raw_response: 'garbage' };
      const merged = llm.mergeResults(resolverResult, llmResult);
      assert.equal(merged.llm_error, 'parse failed');
    });

    it('promotes near-misses that LLM approves', () => {
      const resolverResult = {
        query: 'X', bn: null, core_tokens: ['X'],
        matches: [],
        rejected: [
          { name: 'Promoted One', source: 'CRA', trigram_sim: 0.35, token_overlap: 0.5, reason: 'tokens' },
        ],
      };
      const llmResult = {
        verdicts: [
          { name: 'Promoted One', source: 'CRA', verdict: 'SAME', confidence: 0.8, reasoning: 'Actually same' },
        ],
        summary: 'test',
      };
      const merged = llm.mergeResults(resolverResult, llmResult);
      assert.ok(merged.final_matches.some(m => m.matched_name === 'Promoted One'));
      assert.equal(merged.final_matches[0].method, 'llm_promoted');
    });
  });

  describe('availableProviders', () => {
    it('returns an array', () => {
      const providers = llm.availableProviders();
      assert.ok(Array.isArray(providers));
    });
    it('detects at least one provider from env', () => {
      // .env.public has both ANTHROPIC_API_KEY and VERTEX credentials
      const providers = llm.availableProviders();
      assert.ok(providers.length > 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  10-12. DATABASE CONNECTIVITY + INTEGRATION TESTS
//  All DB tests share one pool and close it at the end.
// ═══════════════════════════════════════════════════════════════════════

// Use a single shared pool (general has search_path=general,public)
// For cross-schema queries, use explicit schema prefix.
const sharedPool = require('../general/lib/db').pool;
const { FuzzyMatcher } = require('../general/lib/fuzzy-match');
const { EntityResolver } = require('../general/lib/entity-resolver');

describe('Database connectivity', () => {

  it('pool connects and queries', async () => {
    const result = await sharedPool.query('SELECT 1 AS val');
    assert.equal(result.rows[0].val, 1);
  });

  it('AB schema exists with tables', async () => {
    const result = await sharedPool.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'ab'"
    );
    assert.ok(parseInt(result.rows[0].cnt) >= 9, `AB should have >= 9 tables, got ${result.rows[0].cnt}`);
  });

  it('CRA schema exists with tables', async () => {
    const result = await sharedPool.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'cra'"
    );
    assert.ok(parseInt(result.rows[0].cnt) >= 15, `CRA should have >= 15 tables, got ${result.rows[0].cnt}`);
  });

  it('FED schema exists with tables', async () => {
    const result = await sharedPool.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'fed'"
    );
    assert.ok(parseInt(result.rows[0].cnt) >= 5, `FED should have >= 5 tables, got ${result.rows[0].cnt}`);
  });

  it('General schema exists with ministries', async () => {
    const result = await sharedPool.query('SELECT COUNT(*) AS cnt FROM general.ministries');
    assert.ok(parseInt(result.rows[0].cnt) >= 27);
  });

  it('AB ab_grants has data', async () => {
    const result = await sharedPool.query('SELECT COUNT(*) AS cnt FROM ab.ab_grants');
    assert.ok(parseInt(result.rows[0].cnt) > 1000000);
  });

  it('CRA cra_identification has data', async () => {
    const result = await sharedPool.query('SELECT COUNT(*) AS cnt FROM cra.cra_identification');
    assert.ok(parseInt(result.rows[0].cnt) > 100000);
  });

  it('FED grants_contributions has data', async () => {
    const result = await sharedPool.query('SELECT COUNT(*) AS cnt FROM fed.grants_contributions');
    assert.ok(parseInt(result.rows[0].cnt) > 1000000);
  });
});

describe('FuzzyMatcher integration', () => {
  const matcher = new FuzzyMatcher(sharedPool);

  it('initialize() enables pg_trgm', async () => {
    await matcher.initialize();
    const result = await sharedPool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    assert.equal(result.rows.length, 1);
  });

  it('findMatches() returns results for known entity', async () => {
    const results = await matcher.findMatches('UNIVERSITY OF ALBERTA', {
      searchIn: ['ab_grants'],
      limit: 5,
    });
    assert.ok(results.length > 0);
    assert.ok(results[0].matched_name);
    assert.ok(results[0].confidence > 0);
  });

  it('findMatches() returns empty for gibberish', async () => {
    const results = await matcher.findMatches('XYZZYQWERTY999', {
      searchIn: ['ab_grants'],
      limit: 5,
    });
    assert.equal(results.length, 0);
  });

  it('batchCrossMatch() returns array', async () => {
    const results = await matcher.batchCrossMatch(
      'ab.ab_non_profit', 'legal_name',
      'ab.ab_contracts', 'recipient',
      { threshold: 0.9, limit: 3 }
    );
    assert.ok(Array.isArray(results));
  });
});

describe('EntityResolver integration', () => {
  const resolver = new EntityResolver(sharedPool);

  it('initialize() enables extensions', async () => {
    await resolver.initialize();
    const r1 = await sharedPool.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
    const r2 = await sharedPool.query("SELECT 1 FROM pg_extension WHERE extname = 'fuzzystrmatch'");
    assert.equal(r1.rows.length, 1);
    assert.equal(r2.rows.length, 1);
  });

  it('resolve() finds BN-anchored matches', async () => {
    const result = await resolver.resolve('BOYLE STREET SERVICE', { bn: '118814391' });
    assert.equal(result.query, 'BOYLE STREET SERVICE');
    assert.equal(result.bn, '118814391');
    assert.ok(result.core_tokens.length > 0);
    assert.ok(result.matches.length > 0);
    const bnMatches = result.matches.filter(m => m.method === 'bn_anchor');
    assert.ok(bnMatches.length > 0, 'Should have BN-anchored matches');
  });

  it('resolve() has BN-mismatch rejections', async () => {
    const result = await resolver.resolve('BOYLE STREET SERVICE', { bn: '118814391' });
    assert.ok(Array.isArray(result.rejected));
    const bnRejects = result.rejected.filter(r => r.reason && r.reason.startsWith('BN mismatch'));
    assert.ok(bnRejects.length > 0, 'Should have BN-mismatch rejections');
  });

  it('resolve() rejects different BN root', async () => {
    const result = await resolver.resolve('MUSTARD SEED', { bn: '119050102' });
    const foundationReject = result.rejected.find(r => r.reason && r.reason.includes('874532518'));
    assert.ok(foundationReject, 'Mustard Seed Foundation should be BN-rejected');
  });

  it('resolve() works without BN', async () => {
    const result = await resolver.resolve('CITY OF CALGARY');
    assert.ok(result.matches.length > 0);
    assert.equal(result.bn, null);
  });

  it('resolve() returns empty for gibberish', async () => {
    const result = await resolver.resolve('XYZZYQWERTY999FOOBAR');
    assert.equal(result.matches.length, 0);
  });
});

// Close all pools after all tests
after(async () => {
  await sharedPool.end();
});
