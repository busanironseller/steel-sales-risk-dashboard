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
- If evidence is headline-only, evidenceQuality MUST be 0 or 1.
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
async function callGemini(prompt, { temperature = 0.3, maxTokens = 8192 } = {}) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature,
      maxOutputTokens: maxTokens,
    },
  });

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
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return { text, model };
        console.error(`  ai       ${model}: empty response`);
        return null;
      }

      const status = res.status;
      if (status === 503 || status === 429 || status === 404) {
        console.log(`  ai       ${model} unavailable (${status}), trying next...`);
        continue;
      }
      const errText = await res.text();
      console.error(`  ai       ${model} error ${status}: ${errText.slice(0, 200)}`);
      return null;
    } catch (err) {
      console.error(`  ai       ${model} failed: ${err.message}`);
      continue;
    }
  }
  return null;
}

/** Parse JSON from Gemini response, handling markdown wrappers. */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw new Error('Could not parse Gemini response as JSON');
  }
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

/** Generate a stable case ID from event characteristics. */
function generateCaseId(assessment) {
  const key = [
    assessment.canonicalEventTitle?.toLowerCase() || '',
    assessment.riskType?.toLowerCase() || '',
    (assessment.exposure?.regions || []).sort().join(','),
    (assessment.exposure?.products || []).sort().join(','),
  ].join('|');
  return 'RC_' + createHash('sha256').update(key).digest('hex').slice(0, 12);
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

  // HIGH: strong evidence + clear exposure + meaningful impact
  if (assessmentStatus === 'ALERT' && total >= 10) {
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

/**
 * STEP 1 — TRIAGE
 * High recall, low cost. Identifies candidates for deep analysis.
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

  // Build article list for triage (all articles, but mark new ones)
  const articleLines = articles.map((a, i) => {
    const isNew = !fpSet.has(a.articleFingerprint);
    const snippetPart = a.snippet ? ` — ${a.snippet.slice(0, 100)}` : '';
    return `[${i + 1}]${isNew ? ' [NEW]' : ''} ${a.title}${a.titleKo ? ' / ' + a.titleKo : ''} (${a.source}, ${a.publishedAt?.slice(0, 10)})${snippetPart}`;
  });

  const prompt = TRIAGE_PROMPT + '\n\n## Articles (' + articles.length + ')\n\n' + articleLines.join('\n');

  const result = await callGemini(prompt, { temperature: 0.2, maxTokens: 4096 });
  if (!result) {
    console.error('  ai       TRIAGE: Gemini call failed');
    return { candidates: [], newCount, cacheHits: articles.length - newCount, model: null };
  }

  try {
    const raw = parseJson(result.text);
    const parsed = TriageOutputSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('  ai       TRIAGE: validation failed:', parsed.error.message?.slice(0, 200));
      // Try to salvage what we can
      const salvaged = (Array.isArray(raw) ? raw : []).filter(c => c?.articleIndices?.length > 0);
      return { candidates: salvaged.slice(0, 30), newCount, cacheHits: articles.length - newCount, model: result.model };
    }

    const candidates = parsed.data.filter(c => c.needsDeepAnalysis).slice(0, 30);
    console.log(`  ai       TRIAGE: ${candidates.length} candidates from ${articles.length} articles (model: ${result.model})`);
    return { candidates, newCount, cacheHits: articles.length - newCount, model: result.model };
  } catch (err) {
    console.error('  ai       TRIAGE: parse error:', err.message);
    return { candidates: [], newCount, cacheHits: articles.length - newCount, model: result.model };
  }
}

/**
 * STEP 2 — EVIDENCE ENRICHMENT
 * Build enriched context for each candidate from available article data.
 */
function enrichCandidates(candidates, articles) {
  return candidates.map(c => {
    const enrichedArticles = c.articleIndices
      .filter(idx => idx >= 1 && idx <= articles.length)
      .map(idx => {
        const a = articles[idx - 1];
        return {
          index: idx,
          title: a.title,
          titleKo: a.titleKo || null,
          source: a.source,
          publishedAt: a.publishedAt?.slice(0, 10),
          snippet: a.snippet || null,
          domains: a.domains,
          fingerprint: a.articleFingerprint,
          hasSnippet: !!a.snippet,
        };
      });

    return {
      ...c,
      enrichedArticles,
      evidenceLevel: enrichedArticles.some(a => a.hasSnippet) ? 'snippet' : 'headline_only',
    };
  });
}

/**
 * STEP 3 — ANALYST
 * Deep EEMMT analysis on enriched candidates.
 */
async function analyze(enrichedCandidates) {
  if (enrichedCandidates.length === 0) return { assessments: [], model: null };

  // Build candidate descriptions for the analyst
  const candidateBlocks = enrichedCandidates.map((c, i) => {
    const artDetails = c.enrichedArticles.map(a => {
      let line = `  [${a.index}] ${a.title}`;
      if (a.titleKo) line += ` / ${a.titleKo}`;
      line += ` (${a.source}, ${a.publishedAt})`;
      if (a.snippet) line += `\n       Snippet: ${a.snippet}`;
      return line;
    }).join('\n');

    return `--- Candidate ${i + 1}: ${c.candidateType} ---
Why it might matter: ${c.whyItMightMatter}
Potential exposure: ${c.potentialExposure || 'unknown'}
Evidence level: ${c.evidenceLevel}
Articles:
${artDetails}`;
  }).join('\n\n');

  const prompt = ANALYST_PROMPT + '\n\n## Candidates for Deep Analysis\n\n' + candidateBlocks;

  console.log(`  ai       ANALYST: analyzing ${enrichedCandidates.length} candidates...`);
  const result = await callGemini(prompt, { temperature: 0.3, maxTokens: 12288 });
  if (!result) {
    console.error('  ai       ANALYST: Gemini call failed');
    return { assessments: [], model: null };
  }

  try {
    const raw = parseJson(result.text);
    const items = Array.isArray(raw) ? raw : [raw];

    // Validate each assessment individually (partial success is OK)
    const assessments = [];
    for (const item of items) {
      const parsed = AnalystOutputSchema.safeParse(item);
      if (parsed.success) {
        assessments.push(parsed.data);
      } else {
        // Try to salvage with defaults
        if (item?.canonicalEventTitle && item?.scores) {
          assessments.push({
            canonicalEventTitle: item.canonicalEventTitle,
            riskType: item.riskType || '기타',
            facts: item.facts || [],
            inferences: item.inferences || [],
            assumptions: item.assumptions || [],
            missingEvidence: item.missingEvidence || [],
            exposure: {
              products: Array.isArray(item.exposure?.products) ? item.exposure.products.filter(p => ['CRC','GI','GL','COLOR'].includes(p)) : [],
              regions: Array.isArray(item.exposure?.regions) ? item.exposure.regions.filter(r => ['Europe','GCC','Asia','US','Korea Export'].includes(r)) : [],
              routes: item.exposure?.routes || [],
              tradeMeasures: item.exposure?.tradeMeasures || [],
            },
            causalChain: item.causalChain || [],
            impactVectors: item.impactVectors || {},
            scores: item.scores,
            threat: item.threat || '',
            opportunity: item.opportunity || '',
            timeHorizon: item.timeHorizon || 'UNKNOWN',
            watchSignals: item.watchSignals || [],
            counterScenario: item.counterScenario || '',
            suggestedActions: item.suggestedActions || [],
            evidenceIndices: item.evidenceIndices || [],
          });
        }
      }
    }

    console.log(`  ai       ANALYST: ${assessments.length} assessments produced (model: ${result.model})`);
    return { assessments, model: result.model };
  } catch (err) {
    console.error('  ai       ANALYST: parse error:', err.message);
    return { assessments: [], model: result.model };
  }
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
  const result = await callGemini(prompt, { temperature: 0.2, maxTokens: 4096 });
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

  // Load persistent state
  const state = await loadState();
  const prevCaseCount = Object.keys(state.riskCases || {}).length;

  // ── STEP 1: TRIAGE ──
  const triageResult = await triage(articles, state.analyzedFingerprints || []);
  metrics.newArticles = triageResult.newCount;
  metrics.cacheHits = triageResult.cacheHits;
  metrics.triageCandidates = triageResult.candidates.length;
  metrics.aiCallCount++;

  if (triageResult.candidates.length === 0 && triageResult.newCount === 0) {
    // No new articles — return existing risk cases as impacts
    const existingCases = Object.values(state.riskCases || {}).filter(c => c.assessmentStatus !== 'IGNORE');
    const impacts = existingCases.map(c => toImpact(c, articles, null));
    metrics.outputAlerts = existingCases.filter(c => c.assessmentStatus === 'ALERT').length;
    metrics.outputWatch = existingCases.filter(c => c.assessmentStatus === 'WATCH').length;
    metrics.outputInfo = existingCases.filter(c => c.assessmentStatus === 'INFO').length;
    console.log('  ai       Using cached risk cases (no new articles)');
    return { impacts, metrics };
  }

  // ── STEP 2: EVIDENCE ENRICHMENT ──
  const enrichedCandidates = enrichCandidates(triageResult.candidates, articles);
  const enrichedCount = enrichedCandidates.filter(c => c.evidenceLevel !== 'headline_only').length;
  console.log(`  ai       EVIDENCE: ${enrichedCount} enriched / ${enrichedCandidates.length - enrichedCount} headline-only`);

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
  console.log(`  ai       EVIDENCE ${enrichedCount} enriched, ${enrichedCandidates.length - enrichedCount} headline-only`);
  console.log(`  ai       ANALYST  ${metrics.analystsProduced} assessments`);
  console.log(`  ai       CRITIC   ${metrics.criticDowngraded} downgraded`);
  console.log(`  ai       CASES    ${metrics.riskCasesNew} new, ${metrics.riskCasesUpdated} updated`);
  console.log(`  ai       OUTPUT   ${metrics.outputAlerts} ALERT, ${metrics.outputWatch} WATCH, ${metrics.outputInfo} INFO`);
  console.log(`  ai       MODEL    ${modelUsed || 'none'}`);

  return { impacts, metrics };
}
