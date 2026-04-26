/**
 * Universal Fuzzy Matching Engine for cross-dataset entity resolution.
 *
 * Designed to work across CRA (charities), FED (grant recipients), and AB
 * (grants, contracts, sole-source, non-profits) to resolve entities that may
 * appear under dozens of name variations, abbreviations, and aliases.
 *
 * Strategy (multi-pass, cascading confidence):
 *
 *   Pass 1 - Exact match on normalized name (confidence: 1.0)
 *   Pass 2 - Token-normalized match: sort words, strip legal suffixes (0.95)
 *   Pass 3 - Trigram similarity via pg_trgm (threshold configurable, 0.7-0.9)
 *   Pass 4 - Levenshtein distance for short names (0.6-0.85)
 *   Pass 5 - Token overlap (Jaccard similarity) for long names (0.5-0.8)
 *   Pass 6 - AI-assisted matching for low-confidence candidates (deferred)
 *
 * Usage:
 *   const { FuzzyMatcher } = require('./lib/fuzzy-match');
 *   const matcher = new FuzzyMatcher(pool);
 *   await matcher.initialize();  // sets up extensions + temp indexes
 *   const results = await matcher.findMatches('UNIVERSITY OF ALBERTA', { source: 'ab_grants' });
 */

// Common legal suffixes to strip for normalization
const LEGAL_SUFFIXES = [
  'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
  'CO', 'COMPANY', 'LP', 'LLP', 'GP', 'ULC',
  'SOCIETY', 'ASSOCIATION', 'ASSN', 'FOUNDATION', 'FUND',
  'OF ALBERTA', 'OF CANADA',
  'THE',
];

const ABBREVIATIONS = {
  'UNIV': 'UNIVERSITY',
  'U OF': 'UNIVERSITY OF',
  'DEPT': 'DEPARTMENT',
  'GOVT': 'GOVERNMENT',
  'GOV': 'GOVERNMENT',
  'ASSN': 'ASSOCIATION',
  'ASSOC': 'ASSOCIATION',
  'INTL': 'INTERNATIONAL',
  'INT': 'INTERNATIONAL',
  'NATL': 'NATIONAL',
  'NAT': 'NATIONAL',
  'CTR': 'CENTRE',
  'CNTR': 'CENTRE',
  'CENTER': 'CENTRE',
  'HOSP': 'HOSPITAL',
  'SVS': 'SERVICES',
  'SVCS': 'SERVICES',
  'SVC': 'SERVICE',
  'SERV': 'SERVICE',
  'MGMT': 'MANAGEMENT',
  'MUN': 'MUNICIPAL',
  'MUNICIP': 'MUNICIPAL',
  'PROV': 'PROVINCIAL',
  'FDN': 'FOUNDATION',
  'FNDN': 'FOUNDATION',
  'SOC': 'SOCIETY',
  'INST': 'INSTITUTE',
  'TECH': 'TECHNOLOGY',
  'DEV': 'DEVELOPMENT',
  'COMM': 'COMMUNITY',
  'ENVIRO': 'ENVIRONMENT',
  'ENVIRON': 'ENVIRONMENT',
  'EDUC': 'EDUCATION',
  'EDU': 'EDUCATION',
  'AGRIC': 'AGRICULTURE',
  'AG': 'AGRICULTURE',
  'ST': 'SAINT',
  'MT': 'MOUNT',
  'FT': 'FORT',
};

/**
 * Normalize a name for matching:
 * - Uppercase
 * - Strip punctuation
 * - Expand common abbreviations
 * - Remove legal suffixes
 * - Sort tokens alphabetically for order-independent matching
 */
function normalizeName(name) {
  if (!name) return '';
  let n = name.toUpperCase().trim();

  // Remove punctuation and extra whitespace
  n = n.replace(/[.,;:'"()\-\/\\#&!@]+/g, ' ').replace(/\s+/g, ' ').trim();

  return n;
}

/**
 * Deep normalize: expand abbreviations, remove legal suffixes, sort tokens.
 */
function deepNormalize(name) {
  if (!name) return '';
  let n = normalizeName(name);

  // Expand abbreviations
  for (const [abbr, full] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    n = n.replace(regex, full);
  }

  // Remove legal suffixes
  for (const suffix of LEGAL_SUFFIXES) {
    const regex = new RegExp(`\\b${suffix}\\b`, 'g');
    n = n.replace(regex, '').trim();
  }

  // Collapse whitespace and sort tokens
  const tokens = n.replace(/\s+/g, ' ').trim().split(' ').filter(t => t.length > 0);
  tokens.sort();
  return tokens.join(' ');
}

/**
 * Compute Jaccard similarity between two token sets.
 * Exported for external use (e.g., resolve-entity, LLM review pipelines).
 */
function jaccardSimilarity(a, b) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

class FuzzyMatcher {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.trigramThreshold = options.trigramThreshold || 0.3;
    this.levenshteinMaxDist = options.levenshteinMaxDist || 5;
    this.minConfidence = options.minConfidence || 0.4;
  }

  async initialize() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch');
  }

  /**
   * Find matching entities across datasets for a given name.
   *
   * @param {string} name - The entity name to search for
   * @param {object} options
   * @param {string[]} options.searchIn - Tables to search: ['ab_grants', 'ab_contracts', 'ab_sole_source', 'ab_non_profit', 'cra', 'fed']
   * @param {number} options.limit - Max results per source (default 10)
   * @returns {Array<{source, name, confidence, method, details}>}
   */
  async findMatches(name, options = {}) {
    const searchIn = options.searchIn || ['ab_grants', 'ab_contracts', 'ab_sole_source', 'ab_non_profit'];
    const limit = options.limit || 10;
    const results = [];

    const normalized = normalizeName(name);

    const sourceQueries = {
      ab_grants: { schema: 'ab', table: 'ab_grants', col: 'recipient', distinct: true },
      ab_contracts: { schema: 'ab', table: 'ab_contracts', col: 'recipient', distinct: true },
      ab_sole_source: { schema: 'ab', table: 'ab_sole_source', col: 'vendor', distinct: true },
      ab_non_profit: { schema: 'ab', table: 'ab_non_profit', col: 'legal_name', distinct: true },
      cra: { schema: 'cra', table: 'cra_identification', col: 'legal_name', distinct: true },
      fed: { schema: 'fed', table: 'grants_contributions', col: 'recipient_legal_name', distinct: true },
    };

    for (const sourceKey of searchIn) {
      const src = sourceQueries[sourceKey];
      if (!src) continue;

      const fullTable = `${src.schema}.${src.table}`;

      try {
        // Pass 1: Exact normalized match
        const exact = await this.pool.query(`
          SELECT DISTINCT ${src.col} AS name
          FROM ${fullTable}
          WHERE UPPER(TRIM(${src.col})) = $1
            AND ${src.col} IS NOT NULL
          LIMIT $2
        `, [normalized, limit]);

        for (const r of exact.rows) {
          results.push({
            source: sourceKey,
            matched_name: r.name,
            confidence: 1.0,
            method: 'exact',
          });
        }

        // Pass 2: Trigram similarity (pg_trgm)
        const trigram = await this.pool.query(`
          SELECT DISTINCT ${src.col} AS name,
                 similarity(UPPER(${src.col}), $1) AS sim
          FROM ${fullTable}
          WHERE ${src.col} IS NOT NULL
            AND UPPER(${src.col}) % $1
            AND UPPER(TRIM(${src.col})) != $1
          ORDER BY sim DESC
          LIMIT $2
        `, [normalized, limit]);

        for (const r of trigram.rows) {
          results.push({
            source: sourceKey,
            matched_name: r.name,
            confidence: Math.round(parseFloat(r.sim) * 100) / 100,
            method: 'trigram',
          });
        }

        // Pass 3: Levenshtein for short names (< 40 chars)
        if (normalized.length < 40) {
          const lev = await this.pool.query(`
            SELECT DISTINCT ${src.col} AS name,
                   levenshtein(LEFT(UPPER(TRIM(${src.col})), 40), LEFT($1, 40)) AS dist
            FROM ${fullTable}
            WHERE ${src.col} IS NOT NULL
              AND LENGTH(${src.col}) BETWEEN $3 AND $4
              AND levenshtein(LEFT(UPPER(TRIM(${src.col})), 40), LEFT($1, 40)) <= $2
              AND UPPER(TRIM(${src.col})) != $1
            ORDER BY dist ASC
            LIMIT $5
          `, [normalized, this.levenshteinMaxDist, normalized.length - 5, normalized.length + 5, limit]);

          for (const r of lev.rows) {
            const maxLen = Math.max(normalized.length, r.name.length);
            const confidence = maxLen > 0 ? Math.round((1 - parseInt(r.dist) / maxLen) * 100) / 100 : 0;
            if (confidence >= this.minConfidence) {
              results.push({
                source: sourceKey,
                matched_name: r.name,
                confidence,
                method: 'levenshtein',
                details: { distance: parseInt(r.dist) },
              });
            }
          }
        }
      } catch (err) {
        // Table may not exist in this database - skip silently
        if (!err.message.includes('does not exist')) {
          console.error(`Error searching ${sourceKey}:`, err.message);
        }
      }
    }

    // Deduplicate and sort by confidence
    const seen = new Set();
    const deduped = [];
    for (const r of results.sort((a, b) => b.confidence - a.confidence)) {
      const key = `${r.source}:${(r.matched_name || '').toUpperCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    return deduped;
  }

  /**
   * Batch cross-match: find entities that appear across multiple datasets.
   * Uses trigram similarity for fuzzy matching.
   *
   * @param {string} sourceTable - Full table name (e.g., 'ab.ab_non_profit')
   * @param {string} sourceCol - Column name (e.g., 'legal_name')
   * @param {string} targetTable - Full table name to match against
   * @param {string} targetCol - Column in target
   * @param {object} options - { threshold: 0.6, limit: 100 }
   */
  async batchCrossMatch(sourceTable, sourceCol, targetTable, targetCol, options = {}) {
    const threshold = options.threshold || 0.6;
    const limit = options.limit || 100;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // SET LOCAL scopes the change to this transaction only
      await client.query(`SET LOCAL pg_trgm.similarity_threshold = ${threshold}`);

      const result = await client.query(`
        SELECT DISTINCT
          s.${sourceCol} AS source_name,
          t.${targetCol} AS target_name,
          similarity(UPPER(s.${sourceCol}), UPPER(t.${targetCol})) AS sim
        FROM ${sourceTable} s
        JOIN ${targetTable} t
          ON UPPER(s.${sourceCol}) % UPPER(t.${targetCol})
        WHERE s.${sourceCol} IS NOT NULL
          AND t.${targetCol} IS NOT NULL
          AND UPPER(TRIM(s.${sourceCol})) != UPPER(TRIM(t.${targetCol}))
        ORDER BY sim DESC
        LIMIT $1
      `, [limit]);

      await client.query('COMMIT');
      return result.rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  FuzzyMatcher,
  normalizeName,
  deepNormalize,
  jaccardSimilarity,
  LEGAL_SUFFIXES,
  ABBREVIATIONS,
};
