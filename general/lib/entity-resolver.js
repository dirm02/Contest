/**
 * Entity Resolver - Advanced multi-strategy entity resolution.
 *
 * The core problem: a single mid-sized multi-dataset charity commonly appears
 * under 10–30 name variants across CRA, FED, and AB datasets (legal names,
 * bilingual pairs, trade names, typos). Naive fuzzy matching over-merges
 * unrelated organizations that share a locality or institution name stem,
 * while missing legitimate trade-name variants declared on T3010 filings.
 *
 * Resolution strategy (layered, in priority order):
 *
 *   Layer 1 - BN Anchor: If a business number (BN) is available, use it as
 *             the gold-standard link. BN variants (118814391, 118814391RR0001,
 *             118814391RC0001, etc.) all resolve to the same root entity.
 *
 *   Layer 2 - Deterministic Name Matching: Exact match after normalization
 *             (strip "THE", legal suffixes, punctuation, trade-name clauses).
 *
 *   Layer 3 - Core Token Matching: Extract "core tokens" (the discriminating
 *             words), require ALL core tokens to be present. For a name like
 *             "ACME SERVICE SOCIETY", cores are {ACME, SERVICE, SOCIETY}. This
 *             rejects "ACME EDUCATION CENTRE" (missing SERVICE, SOCIETY) even
 *             though it shares the ACME stem.
 *
 *   Layer 4 - Trigram with Core-Token Gate: pg_trgm similarity but only among
 *             candidates that pass the core-token filter.
 *
 *   Layer 5 - Trade-Name / DBA Expansion: Parse "TRADE NAME OF" and "|" patterns
 *             to extract alternate names and resolve them independently.
 *
 *   Layer 6 - AI Candidate Review (deferred): For remaining low-confidence
 *             matches, send to AI for contextual judgment.
 */

const { normalizeName, deepNormalize, LEGAL_SUFFIXES } = require('./fuzzy-match');

// Tokens that carry no entity-discriminating value
const STOP_TOKENS = new Set([
  'THE', 'A', 'AN', 'OF', 'AND', 'FOR', 'IN', 'TO', 'BY',
  'LTD', 'LIMITED', 'INC', 'INCORPORATED', 'CORP', 'CORPORATION',
  'CO', 'COMPANY', 'LP', 'LLP', 'GP', 'ULC',
  'ALBERTA', 'CANADA', 'CANADIAN',
]);

/**
 * Extract a root BN from various formats.
 * "118814391RR0001" -> "118814391"
 * "118814391" -> "118814391"
 */
function extractRootBN(bn) {
  if (!bn) return null;
  const cleaned = bn.replace(/\s+/g, '');
  // CRA BN format: 9 digits + optional 2-letter suffix + 4-digit program number
  const match = cleaned.match(/^(\d{9})/);
  return match ? match[1] : null;
}

/**
 * Extract core (discriminating) tokens from a name.
 * Strips stop words and legal suffixes, keeps the meaningful identifiers.
 */
function coreTokens(name) {
  if (!name) return new Set();
  const normalized = normalizeName(name);

  // Remove trade-name clauses
  let clean = normalized
    .replace(/\bTRADE\s+NAME\s+OF\b.*$/i, '')
    .replace(/\|.*$/, '')
    .replace(/[.,;:'"()\-\/\\#&!@]+/g, ' ')
    .trim();

  const tokens = clean.split(/\s+/).filter(t => t.length > 1 && !STOP_TOKENS.has(t));
  return new Set(tokens);
}

/**
 * Check if candidate name's core tokens are a superset of (or equal to) the
 * query's core tokens. This catches "BOYLE STREET COMMUNITY SERVICES" matching
 * against a query of "BOYLE STREET SERVICE" because the candidate contains
 * all query core tokens except SERVICE ≠ SERVICES (but we handle plurals).
 */
function coreTokenOverlap(queryTokens, candidateTokens) {
  if (queryTokens.size === 0 || candidateTokens.size === 0) return 0;

  let matched = 0;
  for (const qt of queryTokens) {
    for (const ct of candidateTokens) {
      // Exact match or singular/plural match
      if (ct === qt || ct === qt + 'S' || qt === ct + 'S' ||
          (ct.startsWith(qt) && qt.length >= 5) || (qt.startsWith(ct) && ct.length >= 5)) {
        matched++;
        break;
      }
    }
  }

  return matched / queryTokens.size;
}

/**
 * Extract alternate names from trade-name patterns.
 * "BOYLE STREET COMMUNITY SERVICES TRADE NAME OF THE BOYLE STREET SERVICE SOCIETY"
 * -> ["BOYLE STREET COMMUNITY SERVICES", "THE BOYLE STREET SERVICE SOCIETY"]
 *
 * "Org A | Org B" -> ["Org A", "Org B"]
 */
function extractAlternateNames(name) {
  if (!name) return [name];
  const names = [];

  // Split on "TRADE NAME OF"
  if (/trade\s+name\s+of/i.test(name)) {
    const parts = name.split(/\s+trade\s+name\s+of\s+/i);
    names.push(...parts.map(p => p.trim()).filter(p => p.length > 2));
  }
  // Split on "O/A" (operating as)
  else if (/\s+O\/A\s+/i.test(name)) {
    const parts = name.split(/\s+O\/A\s+/i);
    names.push(...parts.map(p => p.trim()).filter(p => p.length > 2));
  }
  // Split on "DBA" (doing business as)
  else if (/\s+DBA\s+/i.test(name)) {
    const parts = name.split(/\s+DBA\s+/i);
    names.push(...parts.map(p => p.trim()).filter(p => p.length > 2));
  }
  // Split on "|"
  else if (name.includes('|')) {
    names.push(...name.split('|').map(p => p.trim()).filter(p => p.length > 2));
  }
  // Split on ","  followed by a period (FED pattern: "Society, .")
  else if (/,\s*\.\s*$/.test(name)) {
    names.push(name.replace(/,\s*\.\s*$/, '').trim());
  }

  if (names.length === 0) names.push(name);
  return names;
}

class EntityResolver {
  constructor(pool) {
    this.pool = pool;
  }

  async initialize() {
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await this.pool.query('CREATE EXTENSION IF NOT EXISTS fuzzystrmatch');
  }

  /**
   * Resolve an entity across all datasets.
   *
   * @param {string} name - Entity name to resolve
   * @param {object} options
   * @param {string} options.bn - Business number (if known)
   * @param {number} options.coreTokenThreshold - Min fraction of core tokens that must match (default 0.7)
   * @param {number} options.trigramMin - Min trigram similarity for final candidates (default 0.3)
   * @returns {object} { entity, matches: [...], rejected: [...] }
   */
  async resolve(name, options = {}) {
    const bn = options.bn || null;
    const coreThreshold = options.coreTokenThreshold || 0.7;
    const trigramMin = options.trigramMin || 0.3;

    const queryTokens = coreTokens(name);
    const altNames = extractAlternateNames(name);
    const rootBN = extractRootBN(bn);

    const matches = [];
    const rejected = [];

    const sources = [
      { schema: 'ab', table: 'ab_grants', col: 'recipient', label: 'AB-Grants' },
      { schema: 'ab', table: 'ab_contracts', col: 'recipient', label: 'AB-Contracts' },
      { schema: 'ab', table: 'ab_sole_source', col: 'vendor', label: 'AB-SoleSource' },
      { schema: 'ab', table: 'ab_non_profit', col: 'legal_name', label: 'AB-NonProfit' },
      { schema: 'cra', table: 'cra_identification', col: 'legal_name', label: 'CRA', bnCol: 'bn' },
      { schema: 'fed', table: 'grants_contributions', col: 'recipient_legal_name', label: 'FED', bnCol: 'recipient_business_number' },
    ];

    for (const src of sources) {
      const fullTable = `${src.schema}.${src.table}`;

      try {
        // Layer 1: BN Anchor
        if (rootBN && src.bnCol) {
          const bnResult = await this.pool.query(`
            SELECT DISTINCT ${src.col} AS name, ${src.bnCol} AS bn
            FROM ${fullTable}
            WHERE ${src.bnCol} LIKE $1
              AND ${src.col} IS NOT NULL
          `, [`${rootBN}%`]);

          for (const r of bnResult.rows) {
            matches.push({
              source: src.label,
              matched_name: r.name,
              bn: r.bn,
              confidence: 0.99,
              method: 'bn_anchor',
            });
          }
        }

        // Layer 2+3+4: Name-based matching with core-token gate
        // Include BN column if available for cross-validation
        const bnSelect = src.bnCol ? `, ${src.bnCol} AS candidate_bn` : '';
        for (const altName of altNames) {
          const normalized = normalizeName(altName);

          const candidates = await this.pool.query(`
            SELECT DISTINCT ${src.col} AS name,
                   similarity(UPPER(${src.col}), $1) AS sim
                   ${bnSelect}
            FROM ${fullTable}
            WHERE ${src.col} IS NOT NULL
              AND UPPER(${src.col}) % $1
            ORDER BY sim DESC
            LIMIT 50
          `, [normalized]);

          for (const c of candidates.rows) {
            const candTokens = coreTokens(c.name);
            const overlap = coreTokenOverlap(queryTokens, candTokens);
            const sim = parseFloat(c.sim);

            // Also check alternate names extracted from the candidate
            const candAlts = extractAlternateNames(c.name);
            let bestOverlap = overlap;
            for (const ca of candAlts) {
              const caTokens = coreTokens(ca);
              const caOverlap = coreTokenOverlap(queryTokens, caTokens);
              if (caOverlap > bestOverlap) bestOverlap = caOverlap;
            }

            // Layer 1b: BN cross-validation (negative filter)
            // If we have a query BN AND the candidate has a BN, compare roots.
            // Different root BN = confirmed different entity -> reject.
            // Same root BN = confirmed same entity -> boost confidence.
            const candidateBN = c.candidate_bn || null;
            const candidateRootBN = extractRootBN(candidateBN);
            let bnStatus = 'no_bn';  // no BN data available for comparison
            if (rootBN && candidateRootBN) {
              bnStatus = candidateRootBN === rootBN ? 'bn_confirmed' : 'bn_mismatch';
            }

            if (bnStatus === 'bn_mismatch') {
              // Confirmed different entity via BN - always reject
              rejected.push({
                source: src.label,
                name: c.name,
                trigram_sim: Math.round(sim * 100) / 100,
                token_overlap: Math.round(bestOverlap * 100) / 100,
                reason: `BN mismatch: candidate root ${candidateRootBN} != query root ${rootBN}`,
                candidate_bn: candidateBN,
              });
              continue;
            }

            if (bestOverlap >= coreThreshold && sim >= trigramMin) {
              // Confidence: blend of trigram similarity and token overlap
              let confidence = Math.round((sim * 0.6 + bestOverlap * 0.4) * 100) / 100;

              // Boost if BN confirms same entity
              if (bnStatus === 'bn_confirmed') {
                confidence = Math.min(0.98, confidence + 0.15);
              }

              matches.push({
                source: src.label,
                matched_name: c.name,
                confidence,
                method: bnStatus === 'bn_confirmed' ? 'bn_confirmed'
                  : bestOverlap >= 1.0 ? 'exact_tokens' : 'core_token_gate',
                details: {
                  trigram_sim: Math.round(sim * 100) / 100,
                  token_overlap: Math.round(bestOverlap * 100) / 100,
                  ...(candidateBN ? { bn: candidateBN } : {}),
                },
              });
            } else if (sim >= 0.35) {
              // Track what we rejected and why
              rejected.push({
                source: src.label,
                name: c.name,
                trigram_sim: Math.round(sim * 100) / 100,
                token_overlap: Math.round(bestOverlap * 100) / 100,
                reason: bestOverlap < coreThreshold
                  ? `core tokens ${Math.round(bestOverlap * 100)}% < ${Math.round(coreThreshold * 100)}% threshold`
                  : `trigram ${Math.round(sim * 100)}% < ${Math.round(trigramMin * 100)}% threshold`,
              });
            }
          }
        }
      } catch (err) {
        if (!err.message.includes('does not exist')) {
          console.error(`Error searching ${src.label}:`, err.message);
        }
      }
    }

    // Deduplicate matches
    const seen = new Set();
    const deduped = [];
    for (const m of matches.sort((a, b) => b.confidence - a.confidence)) {
      const key = `${m.source}:${(m.matched_name || '').toUpperCase().trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(m);
      }
    }

    // Deduplicate rejected
    const seenR = new Set();
    const dedupedR = [];
    for (const r of rejected.sort((a, b) => b.trigram_sim - a.trigram_sim)) {
      const key = `${r.source}:${(r.name || '').toUpperCase().trim()}`;
      if (!seenR.has(key) && !seen.has(key)) {
        seenR.add(key);
        dedupedR.push(r);
      }
    }

    return {
      query: name,
      bn: rootBN,
      core_tokens: [...queryTokens],
      matches: deduped,
      rejected: dedupedR,
    };
  }
}

module.exports = {
  EntityResolver,
  extractRootBN,
  coreTokens,
  coreTokenOverlap,
  extractAlternateNames,
};
