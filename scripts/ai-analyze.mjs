/**
 * AI-powered Risk Intelligence using Google Gemini.
 *
 * Pipeline: TRIAGE → ANALYST → CRITIC → Deterministic Scoring → Risk Case State
 *
 * Principles (Risk Constitution):
 * - EVIDENCE → EXPOSURE → MECHANISM → MATERIALITY → TIME
 * - PRECISION > NUMBER OF ALERTS
 * - FACT / INFERENCE / ASSUMPTION / MISSING EVIDENCE must be separated
 * - UNKNOWN is a valid answer; never expand to ALL
 * - Headline-only evidence limits maximum confidence
 * - Each causal step must be CONFIRMED / CONDITIONAL / UNCONFIRMED
 *
 * Required env: GEMINI_API_KEY
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';

// ────────────────────────────────────────────────── Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODELS = ['gemini-3.7-flash', 'gemini-3.5-flash'];
const STATE_PATH = new URL('../public/data/ai-state.json', import.meta.url);

// ────────────────────────────────────────────────── Zod Schemas

const DirectionEnum = z.enum(['UP', 'DOWN', 'NEUTRAL', 'UNKNOWN']);

const TriageCandidateSchema = z.object({
  articleIndices: z.array(z.number()),
  candidateType: z.string(),
  whyItMightMatter: z.string(),
  potentialExposure: z.string().optional().default(''),
  needsDeepAnalysis: z.boolean(),
});
const TriageOutputSchema = z.array(TriageCandidateSchema);

const CausalStepSchema = z.object({
  step: z.string(),
  state: z.enum(['CONFIRMED', 'CONDITIONAL', 'UNCONFIRMED']),
});

const ScoresSchema = z.object({
  evidenceQuality: z.number().min(0).max(3),
  exposureProximity: z.number().min(0).max(3),
  causalStrength: z.number().min(0).max(3),
  businessMateriality: z.number().min(0).max(3),
  urgency: z.number().min(0).max(2),
});

const ImpactVectorsSchema = z.object({
  price: DirectionEnum.optional().default('UNKNOWN'),
  cost: DirectionEnum.optional().default('UNKNOWN'),
  demand: DirectionEnum.optional().default('UNKNOWN'),
  sales: DirectionEnum.optional().default('UNKNOWN'),
  freight: DirectionEnum.optional().default('UNKNOWN'),
  leadTime: DirectionEnum.optional().default('UNKNOWN'),
  compliance: DirectionEnum.optional().default('UNKNOWN'),
  competition: DirectionEnum.optional().default('UNKNOWN'),
  opportunity: DirectionEnum.optional().default('UNKNOWN'),
});

const AnalystOutputSchema = z.object({
  canonicalEventTitle: z.string(),
  riskType: z.string(),
  facts: z.array(z.string()),
  inferences: z.array(z.string()),
  assumptions: z.array(z.string()).optional().default([]),
  missingEvidence: z.array(z.string()),
  exposure: z.object({
    products: z.array(z.string()).optional().default([]),
    regions: z.array(z.string()).optional().default([]),
    routes: z.array(z.string()).optional().default([]),
    tradeMeasures: z.array(z.string()).optional().default([]),
  }),
  causalChain: z.array(CausalStepSchema),
  impactVectors: ImpactVectorsSchema.optional(),
  scores: ScoresSchema,
  threat: z.string().optional().default(''),
  opportunity: z.string().optional().default(''),
  timeHorizon: z.enum(['NOW', 'DAYS', 'WEEKS', '1-3_MONTHS', '3-6_MONTHS', 'LONG_TERM', 'UNKNOWN']).optional().default('UNKNOWN'),
  watchSignals: z.array(z.string()).optional().default([]),
  counterScenario: z.string().optional().default(''),
  suggestedActions: z.array(z.string()).optional().default([]),
  evidenceIndices: z.array(z.number()).optional().default([]),
});

const CriticResultSchema = z.object({
  eventTitle: z.string(),
  issues: z.array(z.string()),
  adjustedScores: ScoresSchema.optional(),
  shouldDowngrade: z.boolean(),
  reason: z.string(),
});

// ────────────────────────────────────────────────── Company Context

const COMPANY_CONTEXT = `
Korea-based coated steel export / trading business.

Products: CRC, GI (galvanized), GL (galvalume), COLOR (PPGI/pre-painted)
Value chain: HRC → CRC → hot-dip coating (GI/GL) → color coating (COLOR)
Raw materials: HRC (substrate), zinc (GI coating), aluminium (GL coating 55%), zinc (GL coating 45%)
Export markets: Europe (EU), GCC (Saudi/UAE/Gulf), Asia (ASEAN), US
Competing origins: China, Turkey, India, Vietnam, Taiwan, Japan
Business model: export + 삼국간 (third-country/triangular trade)
Trade structure: Raw Material Origin → Manufacturing Origin → Processing/Intermediate → Destination → End Market
`.trim();

// ────────────────────────────────────────────────── Risk Constitution

const RISK_CONSTITUTION = `
## Steel Business Risk Constitution

1. A globally important event is NOT automatically a steel business risk. Prove the connection.
2. Always follow: EVIDENCE → EXPOSURE → MECHANISM → MATERIALITY → TIME.
3. Separate FACT / INFERENCE / ASSUMPTION / MISSING EVIDENCE strictly.
4. Never fabricate numbers, tariff rates, HS codes, quotas, prices, production volumes, or company data not in the evidence.
5. Distinguish policy stages: rumor → consideration → proposal → investigation opened → preliminary measure → final determination → enforced.
6. For triangular trade: consider ORIGIN → PROCESSING/INTERMEDIATE → DESTINATION.
7. Do not confuse event severity with business exposure.
8. Each causal step must explain WHY it leads to the next step.
9. If a critical link is unconfirmed, prefer WATCH over ALERT.
10. "No material impact currently" is a valid and good conclusion.
11. Before concluding, consider the counter-scenario.
12. Evaluate both THREAT and OPPORTUNITY separately.
13. If product or region is unknown, use empty array []. NEVER expand to "all products" or "all regions".
14. Headline-only evidence gets evidenceQuality ≤ 1. Never HIGH confidence from headlines alone.
15. The goal is NOT to generate many risks. It is to find real actionable risks.
16. UNKNOWN is always a valid answer. Use it freely.
17. Stronger risk claims require stronger evidence.
18. Indirect risks are allowed, but each additional unconfirmed causal step lowers confidence.
`.trim();

// ────────────────────────────────────────────────── Prompts

const TRIAGE_PROMPT = `You are a steel-business risk triage specialist.

${COMPANY_CONTEXT}

## Task
From the article list below, identify candidates that MIGHT affect this steel export business.
Do NOT perform deep analysis. Only answer: "Does this deserve deeper investigation?"

## Criteria for candidacy
- Direct steel/metals news (price, trade, supply, demand)
- Events with a plausible 1-3 step causal path to steel business impact
- Geopolitical events affecting shipping routes, trade corridors, or raw material supply
- Trade policy changes (anti-dumping, safeguard, tariff, quota, CBAM, sanctions)
- Natural disasters or infrastructure events near steel mills, ports, or key shipping routes
- Currency/financial events affecting trade competitiveness
- Competitor origin events affecting market dynamics

## Exclusions
- Entertainment, sports, celebrity news with no business connection
- Local domestic news in unrelated sectors
- Articles already clearly about steel that the rule engine would catch (HRC price, zinc price, etc.) — focus on what rules might MISS

## Output
Return a JSON array. Target 15-30 candidates max. Each candidate groups related articles.
Return [] if nothing qualifies.

[{
  "articleIndices": [article numbers that form this candidate event],
  "candidateType": "geopolitical | trade_policy | logistics | supply_chain | demand | competition | currency | regulatory | other",
  "whyItMightMatter": "one sentence: why this might affect steel business",
  "potentialExposure": "which product/region/route might be exposed",
  "needsDeepAnalysis": true
}]

JSON only. No other text.`;

const ANALYST_PROMPT = `You are a senior steel-business risk analyst.

${COMPANY_CONTEXT}

${RISK_CONSTITUTION}

## Task
For each candidate event below, perform deep analysis following the EEMMT framework:

**E**vidence — What is actually confirmed by the articles?
**E**xposure — How does this connect to our steel business?
**M**echanism — What is the causal chain from event to business impact?
**M**ateriality — Is the impact significant enough to matter?
**T**ime — When would this affect us?

## Scoring Guide
Each score 0-3:

evidenceQuality:
0 = headline only, vague
1 = single source, limited facts
2 = specific reporting from reliable source, or multiple sources
3 = official/primary source, very strong confirmation

exposureProximity:
0 = no identifiable connection to our business
1 = very indirect / broad
2 = clear product/region/material/route/competitor connection
3 = direct product/origin/destination/regulation exposure

causalStrength:
0 = no valid transmission path
1 = possible scenario but key steps unconfirmed
2 = mechanism is strong but some triggers not yet occurred
3 = direct transmission path already materializing

businessMateriality:
0 = negligible
1 = limited
2 = meaningful impact on price/cost/freight/sales/competition/compliance
3 = large-scale impact

urgency:
0 = long-term or uncertain timing
1 = weeks to months
2 = immediate or very near-term

## Causal Chain States
Each step must be marked:
- CONFIRMED: verified by evidence
- CONDITIONAL: would follow IF the preceding step occurs/continues
- UNCONFIRMED: speculative, no evidence yet

## Critical Rules
- Products: only use CRC, GI, GL, COLOR. If unknown, return [].
- Regions: only use Europe, GCC, Asia, US, Korea Export. If unknown, return [].
- Do NOT fill in unknown products/regions with "all". Empty [] is correct.
- If evidence is headline-only AND you cannot verify via search, evidenceQuality MUST be 0 or 1.
- If article "Content:" text is provided, or you find specific facts via Google Search, you may score evidenceQuality 2 or 3 when concrete facts, data, or official statements are available.
- When Google Search is available, use it to verify key claims and find additional context. Cite what you find as facts.
- Count unconfirmed causal steps. More unconfirmed steps = lower causalStrength.

## Output
Return a JSON array. One object per candidate event analyzed.

[{
  "canonicalEventTitle": "concise event name in Korean",
  "riskType": "risk category in Korean",
  "facts": ["confirmed fact 1", "confirmed fact 2"],
  "inferences": ["reasoned inference 1"],
  "assumptions": ["assumption needed for analysis"],
  "missingEvidence": ["what we don't know but need"],
  "exposure": {
    "products": [],
    "regions": [],
    "routes": [],
    "tradeMeasures": []
  },
  "causalChain": [
    {"step": "description", "state": "CONFIRMED"},
    {"step": "description", "state": "CONDITIONAL"}
  ],
  "impactVectors": {
    "price": "UP|DOWN|NEUTRAL|UNKNOWN",
    "cost": "UP|DOWN|NEUTRAL|UNKNOWN",
    "demand": "UP|DOWN|NEUTRAL|UNKNOWN",
    "sales": "UP|DOWN|NEUTRAL|UNKNOWN",
    "freight": "UP|DOWN|NEUTRAL|UNKNOWN",
    "leadTime": "UP|DOWN|NEUTRAL|UNKNOWN",
    "compliance": "UP|DOWN|NEUTRAL|UNKNOWN",
    "competition": "UP|DOWN|NEUTRAL|UNKNOWN",
    "opportunity": "UP|DOWN|NEUTRAL|UNKNOWN"
  },
  "scores": {
    "evidenceQuality": 0,
    "exposureProximity": 0,
    "causalStrength": 0,
    "businessMateriality": 0,
    "urgency": 0
  },
  "threat": "downside description in Korean",
  "opportunity": "possible upside in Korean, or empty",
  "timeHorizon": "NOW|DAYS|WEEKS|1-3_MONTHS|3-6_MONTHS|LONG_TERM|UNKNOWN",
  "watchSignals": ["what to monitor"],
  "counterScenario": "why this risk might not materialize",
  "suggestedActions": ["action item in Korean"],
  "evidenceIndices": [article numbers used]
}]

JSON only. No other text.`;

const CRITIC_PROMPT = `You are a skeptical risk reviewer. Your job is to find weaknesses in risk assessments.

${RISK_CONSTITUTION}

## Task
Review each risk assessment below. For each one, check:

1. Did the analyst fabricate facts not in the articles?
2. Are FACT and INFERENCE properly separated?
3. Is there a leap in the causal chain?
4. Is exposure overstated?
5. Was severity inflated because the news sounds dramatic?
6. Should this be WATCH rather than ALERT?
7. Is opportunity overstated?
8. What is the strongest counter-argument?
9. What missing evidence would break this conclusion?

## Output
Return a JSON array with one review per assessment.

[{
  "eventTitle": "the event being reviewed",
  "issues": ["issue 1 found", "issue 2 found"],
  "adjustedScores": { only if scores should change },
  "shouldDowngrade": true/false,
  "reason": "brief explanation"
}]

Be conservative. If in doubt, downgrade.
JSON only. No other text.`;

// ────────────────────────────────────────────────── Gemini API

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
}

/**
 * Call Gemini with model fallback. Returns { text, model } or null.
 */
async function callGemini(prompt, { temperature = 0.3, maxTokens = 8192, useGrounding = false } = {}) {
  const reqBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature,
      maxOutputTokens: maxTokens,
    },
  };
  // Google Search grounding: lets Gemini search for real-time context
  if (useGrounding) reqBody.tools = [{ googleSearch: {} }];
  let body = JSON.stringify(reqBody);

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let anyRateLimited = false;
    let hardError = false;
    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(120_000),
        });

        if (res.ok) {
          const data = await res.json();
          // Grounded responses may have text in different parts
          const parts = data.candidates?.[0]?.content?.parts || [];
          const text = parts.map(p => p.text || '').join('');
          if (text) return { text, model, grounded: !!data.candidates?.[0]?.groundingMetadata };
          console.error(`  ai       ${model}: empty response`);
          return null;
        }

        const status = res.status;
        if (status === 429) {
          anyRateLimited = true;
          console.log(`  ai       ${model} rate-limited (429), trying next...`);
          continue;
        }
        if (status === 503 || status === 404) {
          console.log(`  ai       ${model} unavailable (${status}), trying next...`);
          continue;
        }
        // If grounding caused the error, retry without it
        if (useGrounding && status === 400) {
          const errText = await res.text();
          console.log(`  ai       ${model} grounding failed (400), retrying without grounding...`);
          useGrounding = false;
          reqBody.tools = undefined;
          body = JSON.stringify(reqBody);
          break; // break inner model loop to retry outer attempt loop
        }
        const errText = await res.text();
        console.error(`  ai       ${model} error ${status}: ${errText.slice(0, 200)}`);
        hardError = true;
        break;
      } catch (err) {
        console.error(`  ai       ${model} failed: ${err.message}`);
        continue;
      }
    }
    if (hardError) break;
    // If any model was rate-limited and none succeeded, wait and retry
    if (anyRateLimited && attempt < MAX_RETRIES) {
      const wait = 30 * (attempt + 1); // 30s, 60s, 90s — aligned with free-tier 1-min RPM window
      console.log(`  ai       All models rate-limited, waiting ${wait}s (retry ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  return null;
}

/**
 * Extract all complete JSON objects from a potentially truncated JSON array.
 * Handles: `[{...}, {... <truncated>` by salvaging all complete objects.
 */
function salvageJsonArray(text) {
  const results = [];
  let depth = 0;
  let objStart = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Skip string contents (including escaped quotes)
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped char
        i++;
      }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        const slice = text.slice(objStart, i + 1);
        try {
          results.push(JSON.parse(slice));
        } catch { /* malformed object, skip */ }
        objStart = -1;
      }
    }
  }
  return results;
}

/** Parse JSON from Gemini response, handling markdown wrappers and truncation. */
function parseJson(text) {
  // 1. Direct parse
  try { return JSON.parse(text); } catch { /* continue */ }

  // 2. Markdown code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) try { return JSON.parse(fenceMatch[1]); } catch { /* continue */ }

  // 3. Find the outermost JSON array or object
  const arrStart = text.indexOf('[');
  const objStart = text.indexOf('{');
  const start = arrStart >= 0 && (objStart < 0 || arrStart < objStart) ? arrStart : objStart;
  if (start >= 0) {
    const isArr = text[start] === '[';
    const closer = isArr ? ']' : '}';
    const end = text.lastIndexOf(closer);
    if (end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* continue */ }
    }
  }

  // 4. Truncation recovery — extract all complete JSON objects from truncated array
  if (arrStart >= 0) {
    const salvaged = salvageJsonArray(text.slice(arrStart));
    if (salvaged.length > 0) {
      console.log(`  ai       Recovered ${salvaged.length} complete objects from truncated response`);
      return salvaged;
    }
  }

  // 5. Log first 500 chars for debugging
  console.error('  ai       Raw response (first 500 chars):', text.slice(0, 500));
  throw new Error('Could not parse Gemini response as JSON');
}

// ────────────────────────────────────────────────── Article Text Extraction

const FETCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Fetch and extract text from an article page.
 * Skips Google News redirect URLs (they use encrypted JS-based redirects).
 * Returns extracted text (max ~1500 chars) or null on failure.
 */
async function fetchArticleText(link) {
  if (!link) return null;
  // Google News URLs use encrypted JS redirects that can't be followed with fetch()
  if (link.includes('news.google.com')) return null;
  try {
    const res = await fetch(link, {
      headers: { 'User-Agent': FETCH_UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const html = await res.text();
    // Some pages are huge — only look at first 200KB
    const trimmedHtml = html.slice(0, 200_000);

    return extractArticleText(trimmedHtml);
  } catch {
    return null;
  }
}

/**
 * Extract readable text from HTML.
 * Targets common article containers, strips tags, trims to useful length.
 */
function extractArticleText(html) {
  // Remove script, style, nav, header, footer, aside
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Try to find article body (common selectors via tag matching)
  const articleMatch = cleaned.match(/<article[\s\S]*?<\/article>/i)
    || cleaned.match(/<div[^>]*class="[^"]*article[^"]*"[\s\S]*?<\/div>/i)
    || cleaned.match(/<div[^>]*class="[^"]*content[^"]*"[\s\S]*?<\/div>/i);

  const source = articleMatch ? articleMatch[0] : cleaned;

  // Extract paragraph text
  const paragraphs = [...source.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => m[1]
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(p => p.length > 30); // skip tiny fragments

  if (paragraphs.length === 0) return null;

  // Join paragraphs, limit to ~1500 chars
  let text = paragraphs.join(' ');
  if (text.length > 1500) text = text.slice(0, 1500) + '…';
  return text;
}

/**
 * Fetch article texts for candidate articles (parallel, rate-limited).
 * Only fetches unique URLs, max concurrency = 5.
 */
async function fetchCandidateTexts(articles, candidateIndices) {
  const uniqueIndices = [...new Set(candidateIndices)].filter(i => i >= 1 && i <= articles.length);
  const textMap = new Map(); // index → text

  // Process in batches of 5
  const BATCH = 5;
  let fetched = 0;
  let success = 0;

  for (let i = 0; i < uniqueIndices.length; i += BATCH) {
    const batch = uniqueIndices.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(idx => fetchArticleText(articles[idx - 1]?.link))
    );

    for (let j = 0; j < batch.length; j++) {
      fetched++;
      const r = results[j];
      if (r.status === 'fulfilled' && r.value) {
        textMap.set(batch[j], r.value);
        success++;
      }
    }

    // Rate limit
    if (i + BATCH < uniqueIndices.length) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`  ai       FETCH: ${success}/${fetched} article texts extracted`);
  return textMap;
}

// ────────────────────────────────────────────────── State Management

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return {
      lastAnalyzedAt: null,
      analyzedFingerprints: [],
      riskCases: {},
    };
  }
}

async function saveState(state) {
  state.lastAnalyzedAt = new Date().toISOString();
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Fixed alias table mapping event-title wording (KO/EN variants) onto stable
 * anchor tokens. This is what keeps "미국-캐나다 관세 전쟁 발발" and
 * "미국-캐나다 무역 협상 결렬 및 50% 상호 보복 관세 부과" in ONE risk case:
 * both normalize to the anchor set {canada, tariff, us}. Deterministic — no
 * embeddings, no external services. Unmatched titles fall back to the
 * normalized title string (same behaviour as before this table existed).
 */
const EVENT_ANCHORS = [
  // chokepoints / logistics — Hormuz, Red Sea and Suez are one connected
  // corridor crisis in practice (the audit found ONE such event split across
  // 10 cases whose titles mixed all three names), so they share one anchor.
  ['mideast_corridor', ['hormuz', '호르무즈', 'red sea', '홍해', 'houthi', '후티', 'suez', '수에즈']],
  ['panama', ['panama', '파나마']],
  ['malacca', ['malacca', '말라카']],
  ['port', ['port strike', '항만 파업', 'port closure', '항만 폐쇄']],
  ['freight', ['freight', '운임', 'shipping cost', '해상 운임']],
  // countries / blocs
  ['us', ['미국', 'united states', ' us ', 'u.s.', 'america', '트럼프', 'trump', 'washington']],
  ['canada', ['canada', '캐나다']],
  ['china', ['china', '중국', 'chinese']],
  ['eu', [' eu ', 'european union', '유럽연합', '유럽 연합', ' eu의', 'eu ', '유럽']],
  ['iran', ['iran', '이란']],
  ['india', ['india', '인도']],
  ['turkey', ['turkey', 'türkiye', '터키', '튀르키예']],
  ['vietnam', ['vietnam', '베트남']],
  ['japan', ['japan', '일본']],
  ['korea', ['korea', '한국', '원화', '원/달러', '원달러']],
  ['ukraine', ['ukraine', '우크라이나']],
  ['russia', ['russia', '러시아']],
  ['uae', ['uae', '아랍에미리트']],
  ['saudi', ['saudi', '사우디']],
  // measures / channels
  ['tariff', ['tariff', '관세', 'section 232', 'section 301', '보복 관세']],
  ['antidumping', ['anti-dumping', 'antidumping', '반덤핑']],
  ['quota', ['quota', '쿼터', 'safeguard', '세이프가드']],
  ['cbam', ['cbam', '탄소국경']],
  ['sanction', ['sanction', '제재', 'embargo', '수출통제', 'export control']],
  ['fx', ['환율', 'exchange rate', 'currency', '달러 매각', '원화 강세', '원화 약세']],
  ['oil', ['oil', '유가', 'crude', '원유']],
];

/**
 * Anchors that name a physical event locus. When one is present it defines the
 * event by itself — secondary anchors (countries, measures) are facets of the
 * same crisis ("호르무즈 + 이란 제재" and "홍해 물류 마비" are one corridor
 * event, not two), so they are dropped from the key.
 */
const PRIMARY_ANCHORS = new Set(['mideast_corridor', 'panama', 'malacca', 'port']);

/** Extract the sorted anchor set for an event title (lowercased match). */
function eventAnchors(title) {
  const t = ` ${(title || '').toLowerCase()} `;
  const found = new Set();
  for (const [anchor, aliases] of EVENT_ANCHORS) {
    if (aliases.some((a) => t.includes(a.toLowerCase()))) found.add(anchor);
  }
  const primaries = [...found].filter((a) => PRIMARY_ANCHORS.has(a));
  return (primaries.length > 0 ? primaries : [...found]).sort();
}

/**
 * Generate a stable case ID from a deterministic event fingerprint.
 *
 * Previous key was dominated by the raw canonicalEventTitle hash, so any
 * wording drift from the LLM opened a brand-new case (audit found ONE Hormuz
 * event split across 10 cases). The fingerprint now uses anchors extracted
 * with a fixed alias table + structured exposure fields. Opposing states of
 * the same dispute ("tariff imposed" / "tariff reduced") intentionally map to
 * the same case: updateRiskCases() overwrites content with the newest
 * assessment and appends to `history`, so the latest evidence wins while the
 * state transition is preserved.
 */
function generateCaseId(assessment) {
  const anchors = eventAnchors(assessment.canonicalEventTitle);
  const eventKey = anchors.length > 0
    ? anchors.join('+')
    : (assessment.canonicalEventTitle || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // A physical-locus event (chokepoint, port) is ONE event no matter which
  // region/product facet a given assessment emphasises — the LLM's region
  // list varies run to run and was splitting one corridor crisis into
  // parallel cases. Non-locus events keep exposure in the key so, e.g., two
  // different regions' trade measures stay separate.
  const hasPrimary = anchors.some((a) => PRIMARY_ANCHORS.has(a));
  const key = hasPrimary ? eventKey : [
    eventKey,
    (assessment.exposure?.regions || []).slice().sort().join(','),
    (assessment.exposure?.products || []).slice().sort().join(','),
  ].join('|');
  return 'RC_' + createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * One-time state migration: recompute case IDs for cases stored under the old
 * title-hash scheme and merge collisions. The newest case wins the content;
 * evidence fingerprints are unioned and histories concatenated (capped at 20)
 * so nothing is lost. Runs on every load — already-migrated states no-op.
 */
function migrateCaseIds(state) {
  const cases = state.riskCases || {};
  const migrated = {};
  let merges = 0;
  for (const c of Object.values(cases)) {
    const newId = generateCaseId(c);
    const existing = migrated[newId];
    if (!existing) {
      migrated[newId] = { ...c, caseId: newId };
      continue;
    }
    merges++;
    const newer = Date.parse(c.lastUpdated || 0) >= Date.parse(existing.lastUpdated || 0) ? c : existing;
    const older = newer === c ? existing : c;
    const merged = { ...newer, caseId: newId };
    merged.firstSeen = [older.firstSeen, newer.firstSeen].filter(Boolean).sort()[0] ?? newer.firstSeen;
    merged.evidenceFingerprints = [...new Set([...(older.evidenceFingerprints || []), ...(newer.evidenceFingerprints || [])])];
    merged.history = [...(older.history || []), ...(newer.history || [])]
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
      .slice(-20);
    migrated[newId] = merged;
  }
  if (merges > 0) console.log(`  ai       STATE: merged ${merges} duplicate risk case(s) during fingerprint migration`);
  state.riskCases = migrated;
  return state;
}

// ────────────────────────────────────────────────── Deterministic Scoring

/**
 * Compute assessmentStatus from AI scores using deterministic gates.
 * AI provides the ingredients; this function makes the final call.
 */
function computeAssessmentStatus(scores) {
  const { evidenceQuality, exposureProximity, causalStrength, businessMateriality, urgency } = scores;

  // ALERT: all core dimensions >= 2
  if (evidenceQuality >= 2 && exposureProximity >= 2 && causalStrength >= 2 && businessMateriality >= 2) {
    return 'ALERT';
  }

  // WATCH: at least some exposure and mechanism, evidence not zero
  if (evidenceQuality >= 1 && exposureProximity >= 1 && causalStrength >= 1 && businessMateriality >= 1) {
    return 'WATCH';
  }

  // INFO: some relevance identified
  if (exposureProximity >= 1 || businessMateriality >= 1) {
    return 'INFO';
  }

  return 'IGNORE';
}

/**
 * Compute severity from scores. Uses weighted sum with minimum gates.
 */
function computeSeverity(scores, assessmentStatus) {
  const { evidenceQuality, exposureProximity, causalStrength, businessMateriality, urgency } = scores;
  const total = evidenceQuality + exposureProximity + causalStrength + businessMateriality + urgency;

  // CRITICAL: very strict gate — direct business interruption level
  if (assessmentStatus === 'ALERT' && total >= 13 && evidenceQuality >= 3 && businessMateriality >= 3) {
    return 'CRITICAL';
  }

  // HIGH: strong evidence + clear exposure + meaningful impact.
  // ALERT's minimum composition is (2,2,2,2) + urgency, i.e. total 8-10, so the
  // old `total >= 10` gate made HIGH the *default* outcome of ALERT (audit:
  // 5 of 7 live HIGH cases sat exactly at total 10-11). total >= 12 on a
  // 14-point scale requires at least two dimensions at 3 on top of the ALERT
  // minimum gates — HIGH now means "clearly above the alert floor".
  if (assessmentStatus === 'ALERT' && total >= 12) {
    return 'HIGH';
  }

  if (assessmentStatus === 'ALERT' || (assessmentStatus === 'WATCH' && total >= 8)) {
    return 'MEDIUM';
  }

  return 'LOW';
}

/**
 * Derive a legacy direction field from impactVectors.
 * Picks the most dominant non-UNKNOWN direction across key vectors.
 */
function deriveLegacyDirection(vectors) {
  if (!vectors) return 'UP';
  const costVectors = [vectors.cost, vectors.freight, vectors.compliance];
  const ups = costVectors.filter(v => v === 'UP').length;
  const downs = costVectors.filter(v => v === 'DOWN').length;
  return ups >= downs ? 'UP' : 'DOWN';
}

// ────────────────────────────────────────────────── PIPELINE STEPS

/** Max articles per triage call — keeps both input and output within limits.
 *  200 ≈ 2 chunks for 400 articles → 2 API calls instead of 4. */
const TRIAGE_CHUNK_SIZE = 200;

/**
 * STEP 1 — TRIAGE
 * High recall, low cost. Identifies candidates for deep analysis.
 * Chunks articles to stay within Gemini's context window.
 */
async function triage(articles, analyzedFingerprints) {
  // Identify new/changed articles
  const fpSet = new Set(analyzedFingerprints);
  const newArticles = articles.filter(a => !fpSet.has(a.articleFingerprint));
  const newCount = newArticles.length;

  if (newCount === 0) {
    console.log('  ai       No new articles since last analysis — skipping');
    return { candidates: [], newCount: 0, cacheHits: articles.length, model: null };
  }

  console.log(`  ai       TRIAGE: ${newCount} new / ${articles.length - newCount} cached`);

  // Build compact article lines (no Korean titles — saves ~40% prompt size)
  const articleLines = articles.map((a, i) => {
    const isNew = !fpSet.has(a.articleFingerprint);
    const snippetPart = a.snippet ? ` — ${a.snippet.slice(0, 80)}` : '';
    return `[${i + 1}]${isNew ? ' [NEW]' : ''} ${a.title} (${a.source}, ${a.publishedAt?.slice(0, 10)})${snippetPart}`;
  });

  // Chunk articles if too many
  const allCandidates = [];
  let modelUsed = null;
  const chunks = [];
  for (let i = 0; i < articleLines.length; i += TRIAGE_CHUNK_SIZE) {
    chunks.push({ lines: articleLines.slice(i, i + TRIAGE_CHUNK_SIZE), offset: i });
  }

  for (const [ci, chunk] of chunks.entries()) {
    const chunkLabel = chunks.length > 1 ? ` [chunk ${ci + 1}/${chunks.length}]` : '';
    const prompt = TRIAGE_PROMPT
      + `\n\n## Articles${chunkLabel} (${chunk.lines.length} of ${articles.length} total, indices ${chunk.offset + 1}-${chunk.offset + chunk.lines.length})\n\n`
      + chunk.lines.join('\n');

    const result = await callGemini(prompt, { temperature: 0.2, maxTokens: 8192 });
    if (!result) {
      console.error(`  ai       TRIAGE${chunkLabel}: Gemini call failed`);
      continue;
    }
    modelUsed = result.model;

    try {
      const raw = parseJson(result.text);
      const items = Array.isArray(raw) ? raw : [];
      const parsed = TriageOutputSchema.safeParse(items);
      if (parsed.success) {
        const good = parsed.data.filter(c => c.needsDeepAnalysis);
        allCandidates.push(...good);
        console.log(`  ai       TRIAGE${chunkLabel}: ${good.length} candidates (model: ${result.model})`);
      } else {
        // Salvage what we can
        const salvaged = items.filter(c => c?.articleIndices?.length > 0 && c?.needsDeepAnalysis !== false);
        allCandidates.push(...salvaged);
        console.log(`  ai       TRIAGE${chunkLabel}: validation partial — salvaged ${salvaged.length}`);
      }
    } catch (err) {
      console.error(`  ai       TRIAGE${chunkLabel}: parse error: ${err.message}`);
    }

    // Pause between chunks to respect free-tier RPM limit
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 10_000));
  }

  const candidates = allCandidates.slice(0, 30);
  console.log(`  ai       TRIAGE total: ${candidates.length} candidates from ${articles.length} articles`);
  return { candidates, newCount, cacheHits: articles.length - newCount, model: modelUsed };
}

/**
 * STEP 2 — EVIDENCE ENRICHMENT
 * Fetches article texts for candidates and builds enriched context.
 * Only fetches articles that passed TRIAGE (not all 400).
 */
async function enrichCandidates(candidates, articles) {
  // Collect all unique article indices from all candidates
  const allIndices = [...new Set(candidates.flatMap(c => c.articleIndices))];

  // Check if any articles have non-Google-News URLs (fetchable)
  const fetchableIndices = allIndices.filter(i => {
    const link = articles[i - 1]?.link || '';
    return link && !link.includes('news.google.com');
  });

  let textMap;
  if (fetchableIndices.length > 0) {
    console.log(`  ai       EVIDENCE: fetching text for ${fetchableIndices.length}/${allIndices.length} fetchable articles...`);
    textMap = await fetchCandidateTexts(articles, fetchableIndices);
  } else {
    console.log(`  ai       EVIDENCE: ${allIndices.length} articles are Google News URLs (using search grounding instead)`);
    textMap = new Map();
  }

  return candidates.map(c => {
    const enrichedArticles = c.articleIndices
      .filter(idx => idx >= 1 && idx <= articles.length)
      .map(idx => {
        const a = articles[idx - 1];
        const articleText = textMap.get(idx) || null;
        return {
          index: idx,
          title: a.title,
          titleKo: a.titleKo || null,
          source: a.source,
          publishedAt: a.publishedAt?.slice(0, 10),
          snippet: a.snippet || null,
          articleText,       // full extracted article body
          domains: a.domains,
          fingerprint: a.articleFingerprint,
          hasText: !!articleText,
          hasSnippet: !!a.snippet,
        };
      });

    const hasFullText = enrichedArticles.some(a => a.hasText);
    return {
      ...c,
      enrichedArticles,
      evidenceLevel: hasFullText ? 'full_text' : enrichedArticles.some(a => a.hasSnippet) ? 'snippet' : 'headline_only',
    };
  });
}

/** Max candidates per analyst call — each produces ~500-800 tokens of output. */
const ANALYST_CHUNK_SIZE = 8;

/** Clamp a raw LLM score into [0, cap]. Anything non-numeric collapses to 0 —
 * the conservative direction. Never rounds upward past the cap. */
function clampScore(value, cap) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(cap, Math.round(n)));
}

const STR_ARRAY = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
const TIME_HORIZONS = ['NOW', 'DAYS', 'WEEKS', '1-3_MONTHS', '3-6_MONTHS', 'LONG_TERM', 'UNKNOWN'];
const CHAIN_STATES = ['CONFIRMED', 'CONDITIONAL', 'UNCONFIRMED'];

/**
 * Try to salvage an assessment object with missing/invalid fields.
 *
 * Order is SALVAGE → normalize → Zod validate → (caller pushes to scoring).
 * The normalize step clamps every score into schema range — the old version
 * passed `item.scores` through raw, so an LLM emitting `evidenceQuality: 9`
 * bypassed Zod entirely and inflated the severity total. The final safeParse
 * guarantees nothing schema-invalid can reach scoring; if even the normalized
 * object fails validation, the assessment is dropped rather than repaired.
 */
function salvageAssessment(item) {
  if (!item?.canonicalEventTitle || typeof item.canonicalEventTitle !== 'string') return null;
  const normalized = {
    canonicalEventTitle: item.canonicalEventTitle,
    riskType: typeof item.riskType === 'string' && item.riskType ? item.riskType : '기타',
    facts: STR_ARRAY(item.facts),
    inferences: STR_ARRAY(item.inferences),
    assumptions: STR_ARRAY(item.assumptions),
    missingEvidence: STR_ARRAY(item.missingEvidence),
    exposure: {
      products: Array.isArray(item.exposure?.products) ? item.exposure.products.filter(p => ['CRC','GI','GL','COLOR'].includes(p)) : [],
      regions: Array.isArray(item.exposure?.regions) ? item.exposure.regions.filter(r => ['Europe','GCC','Asia','US','Korea Export'].includes(r)) : [],
      routes: STR_ARRAY(item.exposure?.routes),
      tradeMeasures: STR_ARRAY(item.exposure?.tradeMeasures),
    },
    causalChain: (Array.isArray(item.causalChain) ? item.causalChain : [])
      .filter((c) => c && typeof c.step === 'string')
      .map((c) => ({ step: c.step, state: CHAIN_STATES.includes(c.state) ? c.state : 'UNCONFIRMED' })),
    impactVectors: Object.fromEntries(
      ['price','cost','demand','sales','freight','leadTime','compliance','competition','opportunity']
        .map((k) => [k, ['UP','DOWN','NEUTRAL','UNKNOWN'].includes(item.impactVectors?.[k]) ? item.impactVectors[k] : 'UNKNOWN']),
    ),
    scores: {
      evidenceQuality: clampScore(item.scores?.evidenceQuality, 3),
      exposureProximity: clampScore(item.scores?.exposureProximity, 3),
      causalStrength: clampScore(item.scores?.causalStrength, 3),
      businessMateriality: clampScore(item.scores?.businessMateriality, 3),
      urgency: clampScore(item.scores?.urgency, 2),
    },
    threat: typeof item.threat === 'string' ? item.threat : '',
    opportunity: typeof item.opportunity === 'string' ? item.opportunity : '',
    timeHorizon: TIME_HORIZONS.includes(item.timeHorizon) ? item.timeHorizon : 'UNKNOWN',
    watchSignals: STR_ARRAY(item.watchSignals),
    counterScenario: typeof item.counterScenario === 'string' ? item.counterScenario : '',
    suggestedActions: STR_ARRAY(item.suggestedActions),
    evidenceIndices: Array.isArray(item.evidenceIndices) ? item.evidenceIndices.filter(Number.isFinite) : [],
  };
  // Salvaged output must clear the same bar as first-pass output.
  const parsed = AnalystOutputSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

/**
 * STEP 3 — ANALYST
 * Deep EEMMT analysis on enriched candidates.
 * Chunks candidates to prevent output truncation.
 */
async function analyze(enrichedCandidates) {
  if (enrichedCandidates.length === 0) return { assessments: [], model: null };

  const allAssessments = [];
  let modelUsed = null;

  // Chunk candidates
  const chunks = [];
  for (let i = 0; i < enrichedCandidates.length; i += ANALYST_CHUNK_SIZE) {
    chunks.push(enrichedCandidates.slice(i, i + ANALYST_CHUNK_SIZE));
  }

  for (const [ci, chunk] of chunks.entries()) {
    const chunkLabel = chunks.length > 1 ? ` [batch ${ci + 1}/${chunks.length}]` : '';

    const candidateBlocks = chunk.map((c, i) => {
      const artDetails = c.enrichedArticles.map(a => {
        let line = `  [${a.index}] ${a.title}`;
        line += ` (${a.source}, ${a.publishedAt})`;
        if (a.articleText) {
          // Full article text available — much higher evidence quality
          line += `\n       Content: ${a.articleText.slice(0, 800)}`;
        } else if (a.snippet) {
          line += `\n       Snippet: ${a.snippet}`;
        }
        return line;
      }).join('\n');

      return `--- Candidate ${ci * ANALYST_CHUNK_SIZE + i + 1}: ${c.candidateType} ---
Why it might matter: ${c.whyItMightMatter}
Potential exposure: ${c.potentialExposure || 'unknown'}
Evidence level: ${c.evidenceLevel}
Articles:
${artDetails}`;
    }).join('\n\n');

    const prompt = ANALYST_PROMPT + `\n\n## Candidates for Deep Analysis${chunkLabel}\n\n` + candidateBlocks;

    // Enable Google Search grounding when evidence is headline-only (lets Gemini search for context)
    const needsGrounding = chunk.some(c => c.evidenceLevel === 'headline_only');
    console.log(`  ai       ANALYST${chunkLabel}: analyzing ${chunk.length} candidates...${needsGrounding ? ' (with search grounding)' : ''}`);
    const result = await callGemini(prompt, { temperature: 0.3, maxTokens: 16384, useGrounding: needsGrounding });
    if (!result) {
      console.error(`  ai       ANALYST${chunkLabel}: Gemini call failed`);
      continue;
    }
    modelUsed = result.model;

    try {
      const raw = parseJson(result.text);
      const items = Array.isArray(raw) ? raw : [raw];

      let validated = 0;
      let salvaged = 0;
      for (const item of items) {
        const parsed = AnalystOutputSchema.safeParse(item);
        if (parsed.success) {
          allAssessments.push(parsed.data);
          validated++;
        } else {
          const s = salvageAssessment(item);
          if (s) { allAssessments.push(s); salvaged++; }
        }
      }
      console.log(`  ai       ANALYST${chunkLabel}: ${validated} validated, ${salvaged} salvaged (model: ${result.model})`);
    } catch (err) {
      console.error(`  ai       ANALYST${chunkLabel}: parse error: ${err.message}`);
    }

    // Pause between chunks to respect free-tier RPM limit
    if (ci < chunks.length - 1) await new Promise(r => setTimeout(r, 10_000));
  }

  console.log(`  ai       ANALYST total: ${allAssessments.length} assessments from ${enrichedCandidates.length} candidates`);
  return { assessments: allAssessments, model: modelUsed };
}

/**
 * Constitution rule 14, enforced in code: if an assessment's evidence articles
 * have neither fetched body text nor an RSS snippet (headline-only), its
 * evidenceQuality is clamped to ≤ 1. An assessment with NO traceable evidence
 * indices is treated as headline-only too — untraceable evidence is the
 * weakest kind. Returns how many assessments were capped.
 */
function capEvidenceQuality(assessments, enrichedCandidates) {
  // article index → strongest evidence available for that article
  const evidenceByIndex = new Map();
  for (const cand of enrichedCandidates) {
    for (const a of cand.enrichedArticles || []) {
      const prev = evidenceByIndex.get(a.index);
      const level = a.hasText ? 2 : a.hasSnippet ? 1 : 0;
      if (prev == null || level > prev) evidenceByIndex.set(a.index, level);
    }
  }

  let capped = 0;
  for (const assessment of assessments) {
    const indices = assessment.evidenceIndices || [];
    const best = indices.length === 0
      ? 0
      : Math.max(...indices.map((i) => evidenceByIndex.get(i) ?? 0));
    if (best === 0 && assessment.scores.evidenceQuality > 1) {
      assessment.scores.evidenceQuality = 1;
      assessment._evidenceCapped = true;
      capped++;
    }
  }
  return capped;
}

/**
 * STEP 4 — CRITIC
 * Skeptical review of important assessments. Only reviews high-scoring ones.
 */
async function critique(assessments) {
  // Only critique assessments that might become ALERT or high WATCH
  const highScoring = assessments.filter(a => {
    const s = a.scores;
    const total = s.evidenceQuality + s.exposureProximity + s.causalStrength + s.businessMateriality + s.urgency;
    return total >= 7;
  });

  if (highScoring.length === 0) {
    console.log('  ai       CRITIC: no high-scoring assessments to review');
    return assessments;
  }

  const reviewBlocks = highScoring.map((a, i) => `
--- Assessment ${i + 1}: ${a.canonicalEventTitle} ---
Risk type: ${a.riskType}
Facts: ${a.facts.join('; ')}
Inferences: ${a.inferences.join('; ')}
Missing evidence: ${a.missingEvidence.join('; ')}
Causal chain: ${a.causalChain.map(c => `${c.step} [${c.state}]`).join(' → ')}
Scores: evidence=${a.scores.evidenceQuality} exposure=${a.scores.exposureProximity} causal=${a.scores.causalStrength} materiality=${a.scores.businessMateriality} urgency=${a.scores.urgency}
Threat: ${a.threat}
Opportunity: ${a.opportunity}
Counter-scenario: ${a.counterScenario}
`).join('\n');

  const prompt = CRITIC_PROMPT + '\n\n## Assessments to Review\n' + reviewBlocks;

  console.log(`  ai       CRITIC: reviewing ${highScoring.length} assessments...`);
  const result = await callGemini(prompt, { temperature: 0.2, maxTokens: 8192 });
  if (!result) {
    console.log('  ai       CRITIC: call failed — keeping original scores');
    return assessments;
  }

  try {
    const raw = parseJson(result.text);
    const critiques = Array.isArray(raw) ? raw : [raw];

    // Apply critic adjustments
    const titleMap = new Map(highScoring.map((a, i) => [a.canonicalEventTitle, i]));
    for (const c of critiques) {
      const parsed = CriticResultSchema.safeParse(c);
      if (!parsed.success) continue;
      const cr = parsed.data;

      // Find the matching assessment
      const matchIdx = assessments.findIndex(a => a.canonicalEventTitle === cr.eventTitle);
      if (matchIdx === -1) continue;

      if (cr.shouldDowngrade && cr.adjustedScores) {
        const orig = assessments[matchIdx].scores;
        assessments[matchIdx].scores = {
          evidenceQuality: Math.min(orig.evidenceQuality, cr.adjustedScores.evidenceQuality),
          exposureProximity: Math.min(orig.exposureProximity, cr.adjustedScores.exposureProximity),
          causalStrength: Math.min(orig.causalStrength, cr.adjustedScores.causalStrength),
          businessMateriality: Math.min(orig.businessMateriality, cr.adjustedScores.businessMateriality),
          urgency: Math.min(orig.urgency, cr.adjustedScores.urgency),
        };
        assessments[matchIdx]._criticDowngraded = true;
        assessments[matchIdx]._criticReason = cr.reason;
      }
      assessments[matchIdx]._criticIssues = cr.issues;
    }

    const downgraded = assessments.filter(a => a._criticDowngraded).length;
    console.log(`  ai       CRITIC: ${downgraded} assessments downgraded (model: ${result.model})`);
    return assessments;
  } catch (err) {
    console.log(`  ai       CRITIC: parse error (${err.message}) — keeping original scores`);
    return assessments;
  }
}

// ────────────────────────────────────────────────── Risk Case State

function updateRiskCases(assessments, state, articles) {
  const now = new Date().toISOString();
  const cases = state.riskCases || {};

  for (const assessment of assessments) {
    const caseId = generateCaseId(assessment);
    const status = computeAssessmentStatus(assessment.scores);
    const severity = computeSeverity(assessment.scores, status);

    if (status === 'IGNORE') continue;

    const evidenceFps = assessment.evidenceIndices
      .filter(idx => idx >= 1 && idx <= articles.length)
      .map(idx => articles[idx - 1]?.articleFingerprint)
      .filter(Boolean);

    const existing = cases[caseId];
    if (existing) {
      // Update existing case
      const newEvidence = evidenceFps.filter(fp => !(existing.evidenceFingerprints || []).includes(fp));
      existing.lastUpdated = now;
      existing.assessmentStatus = status;
      existing.severity = severity;
      existing.scores = assessment.scores;
      existing.canonicalEventTitle = assessment.canonicalEventTitle;
      existing.facts = assessment.facts;
      existing.inferences = assessment.inferences;
      existing.missingEvidence = assessment.missingEvidence;
      existing.watchSignals = assessment.watchSignals;
      existing.threat = assessment.threat;
      existing.opportunity = assessment.opportunity;
      existing.impactVectors = assessment.impactVectors;
      existing.causalChain = assessment.causalChain;
      existing.suggestedActions = assessment.suggestedActions;
      existing.counterScenario = assessment.counterScenario;
      existing.timeHorizon = assessment.timeHorizon;
      existing.exposure = assessment.exposure;
      existing.riskType = assessment.riskType;
      existing.assumptions = assessment.assumptions;
      existing.evidenceFingerprints = [...new Set([...(existing.evidenceFingerprints || []), ...evidenceFps])];
      if (newEvidence.length > 0) {
        existing.lastAnalyzed = now;
        existing.history = existing.history || [];
        existing.history.push({ date: now, status, severity, newEvidenceCount: newEvidence.length });
        if (existing.history.length > 20) existing.history = existing.history.slice(-20);
      }
    } else {
      // New case
      cases[caseId] = {
        caseId,
        canonicalEventTitle: assessment.canonicalEventTitle,
        assessmentStatus: status,
        severity,
        firstSeen: now,
        lastUpdated: now,
        lastAnalyzed: now,
        riskType: assessment.riskType,
        facts: assessment.facts,
        inferences: assessment.inferences,
        assumptions: assessment.assumptions,
        missingEvidence: assessment.missingEvidence,
        exposure: assessment.exposure,
        causalChain: assessment.causalChain,
        impactVectors: assessment.impactVectors,
        scores: assessment.scores,
        threat: assessment.threat,
        opportunity: assessment.opportunity,
        timeHorizon: assessment.timeHorizon,
        watchSignals: assessment.watchSignals,
        counterScenario: assessment.counterScenario,
        suggestedActions: assessment.suggestedActions,
        evidenceFingerprints: evidenceFps,
        evidenceIndices: assessment.evidenceIndices,
        history: [{ date: now, status, severity, newEvidenceCount: evidenceFps.length }],
      };
    }
  }

  // Prune very old cases that haven't been updated in 14 days
  const cutoff = Date.now() - 14 * 86_400_000;
  for (const [id, c] of Object.entries(cases)) {
    if (Date.parse(c.lastUpdated) < cutoff) delete cases[id];
  }

  state.riskCases = cases;
  return cases;
}

// ────────────────────────────────────────────────── Legacy Impact Adapter

/**
 * Convert a Risk Case to the legacy Impact format for dashboard compatibility.
 * New fields are added alongside legacy fields (additive migration).
 */
function toImpact(riskCase, articles, aiModelUsed) {
  const evidence = (riskCase.evidenceIndices || [])
    .filter(idx => idx >= 1 && idx <= articles.length)
    .slice(0, 6)
    .map(idx => {
      const a = articles[idx - 1];
      return { id: a.id, title: a.title, titleKo: a.titleKo ?? null, source: a.source, publishedAt: a.publishedAt, link: a.link };
    });

  const products = (riskCase.exposure?.products || []).filter(p => ['CRC','GI','GL','COLOR'].includes(p));
  const regions = (riskCase.exposure?.regions || []).filter(r => ['Europe','GCC','Asia','US','Korea Export'].includes(r));

  return {
    // Legacy fields (backward compatible)
    id: riskCase.caseId,
    ruleId: riskCase.caseId,
    ruleName: riskCase.canonicalEventTitle,
    ruleNameKo: riskCase.canonicalEventTitle,
    origin: 'AI_INSIGHT',
    originId: riskCase.caseId,
    severity: riskCase.severity,
    confidence: riskCase.assessmentStatus === 'ALERT' ? 'HIGH' : riskCase.assessmentStatus === 'WATCH' ? 'MEDIUM' : 'LOW',
    direction: deriveLegacyDirection(riskCase.impactVectors),
    riskType: riskCase.riskType,
    riskTypeKo: riskCase.riskType,
    products,    // empty [] if unknown — NEVER defaulted to all
    regions,     // empty [] if unknown — NEVER defaulted to all
    chain: (riskCase.causalChain || []).map(c => c.step),
    chainKo: (riskCase.causalChain || []).map(c => c.step),
    lagNote: null,
    lagNoteKo: null,
    narrativeKo: riskCase.threat || null,
    fact: riskCase.facts?.join('; ') || riskCase.canonicalEventTitle,
    factSource: `AI 분석 (${aiModelUsed || 'Gemini'})`,
    factTimestamp: riskCase.lastUpdated,
    rule: (riskCase.causalChain || []).map(c => c.step).join(' → '),
    inference: riskCase.inferences?.join('; ') || '',
    actions: riskCase.suggestedActions || [],
    actionsKo: riskCase.suggestedActions || [],
    evidence,

    // New fields (additive — dashboard can progressively adopt)
    assessmentStatus: riskCase.assessmentStatus,
    scores: riskCase.scores,
    impactVectors: riskCase.impactVectors,
    facts: riskCase.facts,
    inferences: riskCase.inferences,
    assumptions: riskCase.assumptions,
    missingEvidence: riskCase.missingEvidence,
    watchSignals: riskCase.watchSignals,
    threat: riskCase.threat,
    opportunity: riskCase.opportunity,
    timeHorizon: riskCase.timeHorizon,
    counterScenario: riskCase.counterScenario,
    causalChainDetailed: riskCase.causalChain,
    firstSeen: riskCase.firstSeen,
    lastUpdated: riskCase.lastUpdated,
    aiModelUsed,
  };
}

// ────────────────────────────────────────────────── Main Pipeline

/**
 * Main entry point. Called from analyze.mjs.
 *
 * @param {Array} articles — full news article list from news.json
 * @param {Array} existingRuleImpactIds — rule-engine impact IDs (for dedup awareness)
 * @returns {{ impacts: Array, metrics: Object }}
 */
export async function aiAnalyze(articles, existingRuleImpactIds = []) {
  const metrics = {
    articlesTotal: articles.length,
    newArticles: 0,
    cacheHits: 0,
    triageCandidates: 0,
    analystsProduced: 0,
    criticDowngraded: 0,
    riskCasesNew: 0,
    riskCasesUpdated: 0,
    riskCasesUnchanged: 0,
    outputAlerts: 0,
    outputWatch: 0,
    outputInfo: 0,
    aiModelUsed: null,
    aiCallCount: 0,
  };

  if (!GEMINI_API_KEY) {
    console.log('  ai       GEMINI_API_KEY not set — skipping AI analysis');
    return { impacts: [], metrics };
  }

  // Load persistent state and migrate any cases stored under the old
  // title-hash IDs onto the deterministic event fingerprint (merges dupes).
  const state = migrateCaseIds(await loadState());
  const prevCaseCount = Object.keys(state.riskCases || {}).length;

  // ── STEP 1: TRIAGE ──
  const triageResult = await triage(articles, state.analyzedFingerprints || []);
  metrics.newArticles = triageResult.newCount;
  metrics.cacheHits = triageResult.cacheHits;
  metrics.triageCandidates = triageResult.candidates.length;
  metrics.aiCallCount++;

  if (triageResult.candidates.length === 0) {
    // Triage found nothing actionable — update fingerprints and return existing cases
    state.analyzedFingerprints = articles.map(a => a.articleFingerprint).filter(Boolean).slice(0, 500);
    await saveState(state);
    const existingCases = Object.values(state.riskCases || {}).filter(c => c.assessmentStatus !== 'IGNORE');
    const impacts = existingCases.map(c => toImpact(c, articles, triageResult.model));
    metrics.outputAlerts = existingCases.filter(c => c.assessmentStatus === 'ALERT').length;
    metrics.outputWatch = existingCases.filter(c => c.assessmentStatus === 'WATCH').length;
    metrics.outputInfo = existingCases.filter(c => c.assessmentStatus === 'INFO').length;
    console.log(`  ai       No candidates found — returning ${existingCases.length} existing risk cases`);
    return { impacts, metrics };
  }

  // ── STEP 2: EVIDENCE ENRICHMENT ──
  const enrichedCandidates = await enrichCandidates(triageResult.candidates, articles);
  const fullTextCount = enrichedCandidates.filter(c => c.evidenceLevel === 'full_text').length;
  const snippetCount = enrichedCandidates.filter(c => c.evidenceLevel === 'snippet').length;
  const headlineCount = enrichedCandidates.length - fullTextCount - snippetCount;
  console.log(`  ai       EVIDENCE: ${fullTextCount} full-text / ${snippetCount} snippet / ${headlineCount} headline-only`);

  // ── STEP 3: ANALYST ──
  const analystResult = await analyze(enrichedCandidates);
  metrics.analystsProduced = analystResult.assessments.length;
  metrics.aiCallCount++;
  let modelUsed = analystResult.model || triageResult.model;

  // ── STEP 4: CRITIC ──
  let assessments = analystResult.assessments;
  if (assessments.length > 0) {
    assessments = await critique(assessments);
    metrics.aiCallCount++;
    metrics.criticDowngraded = assessments.filter(a => a._criticDowngraded).length;
  }

  // ── STEP 5: DETERMINISTIC SCORING ──
  // Enforce Constitution rule 14 in code, not just in the prompt: headline-only
  // evidence can never carry evidenceQuality above 1. Runs after CRITIC, so the
  // cap survives any critic adjustment (critic can only lower scores anyway).
  const capped = capEvidenceQuality(assessments, enrichedCandidates);
  if (capped > 0) console.log(`  ai       SCORE: evidenceQuality capped to ≤1 on ${capped} headline-only assessment(s)`);
  for (const a of assessments) {
    a._assessmentStatus = computeAssessmentStatus(a.scores);
    a._severity = computeSeverity(a.scores, a._assessmentStatus);
  }

  // ── STEP 6: RISK CASE STATE UPDATE ──
  const casesBeforeUpdate = new Set(Object.keys(state.riskCases || {}));
  updateRiskCases(assessments, state, articles);

  // Update fingerprint cache with all current article fingerprints
  state.analyzedFingerprints = articles
    .map(a => a.articleFingerprint)
    .filter(Boolean)
    .slice(0, 500); // cap to prevent unbounded growth

  const casesAfterUpdate = Object.keys(state.riskCases || {});
  metrics.riskCasesNew = casesAfterUpdate.filter(id => !casesBeforeUpdate.has(id)).length;
  metrics.riskCasesUpdated = casesAfterUpdate.filter(id => casesBeforeUpdate.has(id)).length;
  metrics.riskCasesUnchanged = casesBeforeUpdate.size - metrics.riskCasesUpdated;
  metrics.aiModelUsed = modelUsed;

  // Save state
  await saveState(state);

  // ── STEP 7: GENERATE IMPACTS ──
  const activeCases = Object.values(state.riskCases).filter(c => c.assessmentStatus !== 'IGNORE');
  const impacts = activeCases.map(c => toImpact(c, articles, modelUsed));

  metrics.outputAlerts = activeCases.filter(c => c.assessmentStatus === 'ALERT').length;
  metrics.outputWatch = activeCases.filter(c => c.assessmentStatus === 'WATCH').length;
  metrics.outputInfo = activeCases.filter(c => c.assessmentStatus === 'INFO').length;

  // Log summary
  console.log(`  ai       ──── AI Pipeline Summary ────`);
  console.log(`  ai       NEWS     ${articles.length} total, ${metrics.newArticles} new`);
  console.log(`  ai       TRIAGE   ${metrics.triageCandidates} candidates`);
  console.log(`  ai       EVIDENCE ${fullTextCount} full-text, ${snippetCount} snippet, ${headlineCount} headline-only`);
  console.log(`  ai       ANALYST  ${metrics.analystsProduced} assessments`);
  console.log(`  ai       CRITIC   ${metrics.criticDowngraded} downgraded`);
  console.log(`  ai       CASES    ${metrics.riskCasesNew} new, ${metrics.riskCasesUpdated} updated`);
  console.log(`  ai       OUTPUT   ${metrics.outputAlerts} ALERT, ${metrics.outputWatch} WATCH, ${metrics.outputInfo} INFO`);
  console.log(`  ai       MODEL    ${modelUsed || 'none'}`);

  return { impacts, metrics };
}

// Exported for deterministic tests (tests/*.test.mjs) — pure functions only.
export {
  computeAssessmentStatus,
  computeSeverity,
  salvageAssessment,
  capEvidenceQuality,
  generateCaseId,
  eventAnchors,
  migrateCaseIds,
  AnalystOutputSchema,
};
