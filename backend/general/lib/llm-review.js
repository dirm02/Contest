/**
 * LLM Review - AI-assisted second pass for entity resolution.
 *
 * Dual-provider architecture:
 *   1. Try Anthropic direct API first (if ANTHROPIC_API_KEY is set)
 *   2. Fall back to Vertex AI (if VERTEX_SERVICE_ACCOUNT_JSON is set)
 *   3. Fail with clear error if neither is available
 *
 * Both providers call the same Claude model with the same prompt.
 * Vertex uses Google OAuth2 service account auth + rawPredict endpoint.
 *
 * Can be used standalone or invoked automatically via --llm flag on resolve-entity.js.
 */
const path = require('path');
const fs = require('fs');

// Load .env.public first (shared defaults for hackathon participants),
// then .env (personal overrides, e.g. admin credentials) which wins.
const publicEnv = path.join(__dirname, '..', '.env.public');
if (fs.existsSync(publicEnv)) {
  require('dotenv').config({ path: publicEnv });
}
const adminEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(adminEnv)) {
  require('dotenv').config({ path: adminEnv, override: true });
}

// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER: ANTHROPIC DIRECT API
// ═══════════════════════════════════════════════════════════════════════

async function callAnthropic(prompt, { model = 'claude-sonnet-4-6', maxTokens = 16000 } = {}) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  return {
    text: response.content[0].text.trim(),
    usage: {
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      model,
      provider: 'anthropic',
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER: VERTEX AI (Google Cloud)
// ═══════════════════════════════════════════════════════════════════════

let _cachedToken = null;
let _tokenExpiry = 0;

/**
 * Obtain a Google OAuth2 access token from service account credentials.
 * Caches the token until 60 seconds before expiry.
 */
async function getVertexAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && now < _tokenExpiry - 60) return _cachedToken;

  // jose is ESM-only in newer versions, use dynamic import
  const { SignJWT, importPKCS8 } = await import('jose');

  const sa = JSON.parse(process.env.VERTEX_SERVICE_ACCOUNT_JSON);
  const privateKey = await importPKCS8(sa.private_key, 'RS256');

  const jwt = await new SignJWT({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: sa.token_uri,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) throw new Error(`Vertex token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + (data.expires_in || 3600);
  return _cachedToken;
}

async function callVertex(prompt, { model, maxTokens = 16000, retries = 3 } = {}) {
  const PROJECT_ID = process.env.VERTEX_PROJECT_ID;
  const LOCATION   = process.env.VERTEX_LOCATION_ID || 'global';
  const ENDPOINT   = process.env.VERTEX_ENDPOINT || 'aiplatform.googleapis.com';
  const METHOD     = process.env.VERTEX_METHOD || 'rawPredict';
  const SONNET     = process.env.VERTEX_CLAUDE_SONNET_MODEL || 'claude-sonnet-4-6';

  const resolvedModel = model || SONNET;
  const url = `https://${ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/anthropic/models/${resolvedModel}:${METHOD}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const token = await getVertexAccessToken();

    const body = {
      anthropic_version: 'vertex-2023-10-16',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) {
      // Auth failure - invalidate cached token before retrying
      _cachedToken = null;
      _tokenExpiry = 0;
      if (attempt < retries) {
        console.warn(`  [vertex retry] ${res.status} auth failure on attempt ${attempt + 1}, cleared token cache, retrying...`);
        continue;
      }
      const errText = await res.text();
      throw new Error(`Vertex API auth error ${res.status}: ${errText}`);
    }

    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      const delay = Math.min(2000 * Math.pow(2, attempt) + Math.random() * 2000, 30000);
      console.warn(`  [vertex retry] ${res.status} on attempt ${attempt + 1}, waiting ${(delay / 1000).toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Vertex API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    return {
      text,
      usage: {
        input_tokens: data.usage?.input_tokens,
        output_tokens: data.usage?.output_tokens,
        model: resolvedModel,
        provider: 'vertex',
      },
    };
  }

  throw new Error(`Vertex API failed after ${retries + 1} attempts`);
}

// ═══════════════════════════════════════════════════════════════════════
//  PROVIDER SELECTION + FALLBACK
// ═══════════════════════════════════════════════════════════════════════

/**
 * Detect which providers are available from environment.
 */
function availableProviders() {
  const providers = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  if (process.env.VERTEX_SERVICE_ACCOUNT_JSON && process.env.VERTEX_PROJECT_ID) providers.push('vertex');
  return providers;
}

/**
 * Call Claude with automatic provider selection and fallback.
 *
 * Order: Anthropic direct -> Vertex AI -> error
 * Override with forceProvider option.
 *
 * @param {string} prompt
 * @param {object} options - { model, maxTokens, forceProvider: 'anthropic'|'vertex' }
 * @returns {{ text: string, usage: object }}
 */
async function callLLM(prompt, options = {}) {
  const providers = options.forceProvider
    ? [options.forceProvider]
    : availableProviders();

  if (providers.length === 0) {
    throw new Error(
      'No LLM provider configured. Set ANTHROPIC_API_KEY (direct) or ' +
      'VERTEX_SERVICE_ACCOUNT_JSON + VERTEX_PROJECT_ID (Vertex AI) in .env'
    );
  }

  const errors = [];

  for (const provider of providers) {
    try {
      if (provider === 'anthropic') {
        console.log('  [llm] Trying Anthropic direct API...');
        return await callAnthropic(prompt, options);
      } else if (provider === 'vertex') {
        console.log('  [llm] Trying Vertex AI...');
        return await callVertex(prompt, options);
      }
    } catch (err) {
      const msg = err.message || String(err);
      console.warn(`  [llm] ${provider} failed: ${msg.slice(0, 120)}`);
      errors.push({ provider, error: msg });

      // If there's another provider to try, continue
      if (providers.indexOf(provider) < providers.length - 1) {
        console.log('  [llm] Falling back to next provider...');
        continue;
      }
    }
  }

  // All providers failed
  const summary = errors.map(e => `${e.provider}: ${e.error.slice(0, 100)}`).join(' | ');
  throw new Error(`All LLM providers failed: ${summary}`);
}

// ═══════════════════════════════════════════════════════════════════════
//  PROMPT BUILDER + REVIEW LOGIC (unchanged from original)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Sanitize an entity name before embedding in a prompt.
 * Strips non-printable characters (except newline/tab), truncates to 200 chars,
 * and escapes markdown-like formatting to prevent prompt injection.
 */
function sanitizeName(name) {
  if (!name) return '';
  let s = String(name);
  // Strip non-printable characters below ASCII 32 except \n (10) and \t (9)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Truncate to 200 characters
  s = s.slice(0, 200);
  // Escape markdown-like formatting: *, _, `, ~, #, [, ], |
  s = s.replace(/([*_`~#\[\]|])/g, '\\$1');
  return s;
}

/**
 * Build the prompt for LLM entity review.
 */
function buildPrompt(resolverResult) {
  const { query, bn, core_tokens, matches, rejected } = resolverResult;

  // Sanitize all entity names from database before embedding in prompt
  const sanitizedQuery = sanitizeName(query);
  const sanitizedMatches = matches.map(m => ({ ...m, matched_name: sanitizeName(m.matched_name) }));
  const sanitizedRejected = rejected.map(r => ({ ...r, name: sanitizeName(r.name) }));

  const bnAnchored = sanitizedMatches.filter(m => m.method === 'bn_anchor' || m.method === 'bn_confirmed');
  const highConf = sanitizedMatches.filter(m => m.confidence >= 0.75 && m.method !== 'bn_anchor' && m.method !== 'bn_confirmed');
  const ambiguous = sanitizedMatches.filter(m => m.confidence < 0.75 && m.method !== 'bn_anchor' && m.method !== 'bn_confirmed');
  const bnRejected = sanitizedRejected.filter(r => r.reason && r.reason.startsWith('BN mismatch'));
  const nearMisses = sanitizedRejected.filter(r => !r.reason || !r.reason.startsWith('BN mismatch')).slice(0, 15);

  let prompt = `You are an expert at entity resolution for Canadian government open data. You are reviewing fuzzy matching results to determine which name variants refer to the SAME legal entity versus DIFFERENT entities that happen to share similar names.

## Query Entity
- **Name:** "${sanitizedQuery}"
- **Business Number (BN):** ${bn ? bn : 'Not provided'}
- **Core identifying tokens:** [${core_tokens.join(', ')}]

## Context
In Canadian government data, the same organization often appears under many name variations:
- With/without "THE", legal suffixes (LTD, INC, SOCIETY)
- Trade names (e.g., "Org A TRADE NAME OF Org B")
- Truncated names (field length limits)
- Minor typos and formatting differences (extra spaces, periods)
- French/English bilingual names separated by "|"
- Business Number (BN) format: 9-digit root + 2-letter program type (RR=charity, RP=pension, RC=corporate, RT=GST) + 4-digit account. Same root 9 digits = same organization regardless of suffix.

However, entities with similar names can be COMPLETELY DIFFERENT organizations. For example, three different registered charities might each call themselves "[NAME] Society", "[NAME] Foundation", and "[NAME] Community Church" — same name stem, different legal entities, different BNs, different purposes.

Parent/subsidiary relationships (e.g., an operating charity vs its holding corporation vs its separately-incorporated charitable foundation — all sharing a name stem, all with different BNs) are related but legally distinct entities. Flag these as RELATED but not SAME.
`;

  if (bnAnchored.length > 0) {
    prompt += `\n## BN-Confirmed Matches (ground truth - same entity)\n`;
    for (const m of bnAnchored) {
      prompt += `- "${m.matched_name}" [${m.source}] BN: ${m.bn || m.details?.bn || 'n/a'}\n`;
    }
  }

  if (highConf.length > 0) {
    prompt += `\n## High-Confidence Name Matches (likely same entity, needs verification)\n`;
    for (const m of highConf) {
      prompt += `- "${m.matched_name}" [${m.source}] confidence: ${(m.confidence * 100).toFixed(0)}% (trigram: ${(m.details?.trigram_sim * 100 || 0).toFixed(0)}%, tokens: ${(m.details?.token_overlap * 100 || 0).toFixed(0)}%)${m.details?.bn ? ' BN: ' + m.details.bn : ''}\n`;
    }
  }

  if (ambiguous.length > 0) {
    prompt += `\n## Ambiguous Matches (NEED YOUR JUDGMENT)\nThese passed the deterministic filters but may be different entities:\n`;
    for (const m of ambiguous) {
      prompt += `- "${m.matched_name}" [${m.source}] confidence: ${(m.confidence * 100).toFixed(0)}% (trigram: ${(m.details?.trigram_sim * 100 || 0).toFixed(0)}%, tokens: ${(m.details?.token_overlap * 100 || 0).toFixed(0)}%)${m.details?.bn ? ' BN: ' + m.details.bn : ''}\n`;
    }
  }

  if (bnRejected.length > 0) {
    prompt += `\n## BN-Rejected (confirmed different entities via BN mismatch)\nThese are provided as context - they are confirmed different:\n`;
    for (const r of bnRejected.slice(0, 10)) {
      prompt += `- "${r.name}" [${r.source}] BN: ${r.candidate_bn || 'n/a'} (${r.reason})\n`;
    }
    if (bnRejected.length > 10) {
      prompt += `  ... and ${bnRejected.length - 10} more BN-rejected entities\n`;
    }
  }

  if (nearMisses.length > 0) {
    prompt += `\n## Near-Misses (rejected by token/trigram filters, but review for false negatives)\nThese were rejected by deterministic rules. Check if any should actually be matches:\n`;
    for (const r of nearMisses) {
      prompt += `- "${r.name}" [${r.source}] trigram: ${(r.trigram_sim * 100).toFixed(0)}%, tokens: ${(r.token_overlap * 100).toFixed(0)}% (${r.reason})\n`;
    }
  }

  prompt += `
## Your Task
For EVERY entity listed in "High-Confidence Name Matches", "Ambiguous Matches", and "Near-Misses", provide a verdict. Respond with a JSON object (no markdown fencing) with this exact structure:

{
  "query_entity": "${sanitizedQuery}",
  "verdicts": [
    {
      "name": "exact name as listed above",
      "source": "source as listed above",
      "verdict": "SAME" | "RELATED" | "DIFFERENT" | "UNCERTAIN",
      "confidence": 0.0 to 1.0,
      "reasoning": "brief explanation"
    }
  ],
  "summary": "1-2 sentence summary of the entity and its alias landscape"
}

Verdict definitions:
- **SAME**: Same legal entity, just a name variant/alias/trade name/typo
- **RELATED**: Corporate family (parent/subsidiary/affiliated foundation) but legally distinct
- **DIFFERENT**: Completely separate organization that happens to share similar words
- **UNCERTAIN**: Not enough information to determine; needs human review

Be precise. Do not guess. If you cannot determine from the name alone, say UNCERTAIN.`;

  return prompt;
}

/**
 * Send resolver results to Claude for AI review.
 * Tries Anthropic direct first, falls back to Vertex AI.
 *
 * @param {object} resolverResult - Output from EntityResolver.resolve()
 * @param {object} options - { forceProvider: 'anthropic'|'vertex' }
 * @returns {object} LLM verdicts with reasoning
 */
async function reviewWithLLM(resolverResult, options = {}) {
  const prompt = buildPrompt(resolverResult);

  const response = await callLLM(prompt, {
    maxTokens: 16000,
    ...options,
  });

  const text = response.text;

  // Parse JSON response - handle potential markdown fencing
  let json;
  try {
    const cleaned = text.replace(/^```\w*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    json = JSON.parse(cleaned);
  } catch (err) {
    return {
      error: 'Failed to parse LLM response as JSON',
      raw_response: text,
      usage: response.usage,
    };
  }

  json.usage = response.usage;
  return json;
}

/**
 * Merge LLM verdicts back into resolver results, producing a final
 * consolidated result with deterministic + AI confidence.
 */
function mergeResults(resolverResult, llmResult) {
  if (llmResult.error) {
    return {
      ...resolverResult,
      llm_error: llmResult.error,
      llm_raw: llmResult.raw_response,
    };
  }

  const verdictMap = new Map();
  for (const v of (llmResult.verdicts || [])) {
    const key = `${v.source}:${(v.name || '').toUpperCase().trim()}`;
    verdictMap.set(key, v);
  }

  const finalMatches = [];
  const reclassified = [];

  for (const m of resolverResult.matches) {
    const key = `${m.source}:${(m.matched_name || '').toUpperCase().trim()}`;
    const verdict = verdictMap.get(key);

    if (verdict) {
      const enhanced = {
        ...m,
        llm_verdict: verdict.verdict,
        llm_confidence: verdict.confidence,
        llm_reasoning: verdict.reasoning,
      };

      if (verdict.verdict === 'DIFFERENT') {
        reclassified.push(enhanced);
      } else {
        enhanced.final_confidence = Math.round(
          (m.confidence * 0.4 + verdict.confidence * 0.6) * 100
        ) / 100;
        finalMatches.push(enhanced);
      }
    } else {
      finalMatches.push({ ...m, final_confidence: m.confidence });
    }
  }

  const promoted = [];
  for (const r of resolverResult.rejected) {
    const key = `${r.source}:${(r.name || '').toUpperCase().trim()}`;
    const verdict = verdictMap.get(key);
    if (verdict && (verdict.verdict === 'SAME' || verdict.verdict === 'RELATED')) {
      promoted.push({
        source: r.source,
        matched_name: r.name,
        confidence: 0,
        method: 'llm_promoted',
        llm_verdict: verdict.verdict,
        llm_confidence: verdict.confidence,
        llm_reasoning: verdict.reasoning,
        final_confidence: verdict.confidence * 0.6,
        original_rejection_reason: r.reason,
      });
    }
  }

  return {
    query: resolverResult.query,
    bn: resolverResult.bn,
    core_tokens: resolverResult.core_tokens,
    llm_summary: llmResult.summary,
    llm_usage: llmResult.usage,
    final_matches: [...finalMatches, ...promoted].sort((a, b) =>
      (b.final_confidence || b.confidence) - (a.final_confidence || a.confidence)
    ),
    reclassified_by_llm: reclassified,
    rejected: resolverResult.rejected.filter(r => {
      const key = `${r.source}:${(r.name || '').toUpperCase().trim()}`;
      const verdict = verdictMap.get(key);
      return !verdict || (verdict.verdict !== 'SAME' && verdict.verdict !== 'RELATED');
    }),
  };
}

module.exports = {
  reviewWithLLM,
  mergeResults,
  buildPrompt,
  callLLM,
  availableProviders,
};
