/**
 * Turns collected market bars and news metadata into the read model the UI
 * renders: market signals, event clusters, rule-derived impact paths, a sales
 * impact table and a FACT / RULE / INFERENCE brief.
 *
 * Every statement it emits is tagged with its epistemic status. FACT sentences
 * quote collected data; RULE sentences quote rules.mjs; INFERENCE sentences are
 * explicitly hedged. Nothing here invents a number.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { RULES, MARKET_THRESHOLDS, SEVERITY, RELEVANCE_TERMS, VALUE_CHAIN } from './rules.mjs';
import { aiAnalyze } from './ai-analyze.mjs';

const DATA = new URL('../public/data/', import.meta.url);
const WINDOW_LABEL = { m30: '30분', m60: '60분', m120: '120분', today: '금일' };
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const readJson = async (name) => JSON.parse(await readFile(new URL(name, DATA), 'utf8'));

// ────────────────────────────────── Gemini-based batch title translation
// Fallback for articles whose titleKo is still null after collect-news.mjs
// (Google Translate free endpoint is often rate-limited from GitHub Actions IPs).

async function translateTitlesViaGemini(articles) {
  if (!GEMINI_API_KEY) return;
  const needTranslation = articles.filter(
    (a) => !a.titleKo && a.title && !/[가-힯]/.test(a.title.slice(0, 10)),
  );
  if (needTranslation.length === 0) return;
  console.log(`  translate  ${needTranslation.length} titles need Gemini translation...`);

  const BATCH = 60;  // titles per Gemini call
  const models = ['gemini-3.7-flash', 'gemini-3.5-flash'];
  let translated = 0;

  for (let start = 0; start < needTranslation.length; start += BATCH) {
    const batch = needTranslation.slice(start, start + BATCH);
    const numbered = batch.map((a, i) => `${i + 1}. ${a.title}`).join('\n');
    const prompt = `Translate each English news headline to natural Korean. Return a JSON array of objects [{\"i\":1,\"ko\":\"한국어 제목\"}, ...]. Keep the same numbering. Do NOT add information not in the original title.\n\n${numbered}`;

    let result = null;
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4096 },
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status === 429) { continue; }
        if (!res.ok) continue;
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) { result = JSON.parse(text); break; }
      } catch { /* try next model */ }
    }

    if (Array.isArray(result)) {
      for (const item of result) {
        const idx = (item.i || item.index) - 1;
        if (idx >= 0 && idx < batch.length && item.ko) {
          batch[idx].titleKo = item.ko;
          translated++;
        }
      }
    }

    // Respect Gemini rate limits — pause between batches
    if (start + BATCH < needTranslation.length) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(`  translate  Gemini: ${translated}/${needTranslation.length} translated`);
}

// ---------------------------------------------------------------- market signals

function marketSignals(market) {
  const signals = [];

  for (const [key, thresholds] of Object.entries(MARKET_THRESHOLDS)) {
    const inst = market.instruments[key];
    if (!inst) continue;

    // Highest-severity threshold that the instrument actually breached.
    let best = null;
    for (const th of thresholds) {
      const pct = inst.change?.[th.window];
      if (pct == null || Math.abs(pct) < th.abs) continue;
      if (!best || SEVERITY[th.severity] > SEVERITY[best.severity]) {
        best = { ...th, pct };
      }
    }
    if (!best) continue;

    signals.push({
      id: `MS_${key.toUpperCase()}_${best.window}`,
      kind: 'MARKET',
      instrument: key,
      instrumentLabel: inst.labelKo ?? inst.label,
      contract: inst.contract,
      exchange: inst.exchange,
      severity: best.severity,
      direction: best.pct > 0 ? 'UP' : 'DOWN',
      pct: best.pct,
      window: best.window,
      windowLabel: WINDOW_LABEL[best.window] ?? best.window,
      threshold: best.abs,
      last: inst.last,
      unit: inst.unit,
      sourceTimestamp: inst.sourceTimestamp,
      collectedAt: inst.collectedAt,
      source: inst.exchange === 'SHFE' ? 'SHFE (official, delayed)' : 'Sina Finance (unofficial)',
      fact:
        `${inst.labelKo ?? inst.label} ${inst.contract} ${best.pct > 0 ? '상승' : '하락'} ` +
        `${best.pct.toFixed(2)}% (${WINDOW_LABEL[best.window] ?? best.window} 기준), ` +
        `현재 ${inst.last?.toLocaleString()} ${inst.unit}`,
    });
  }

  return signals.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || Math.abs(b.pct) - Math.abs(a.pct));
}

// ---------------------------------------------------------------- news relevance

function relevanceScore(text) {
  const lower = text.toLowerCase();
  let score = 0;
  const matched = [];
  for (const t of RELEVANCE_TERMS.strong) if (lower.includes(t)) { score += 2; matched.push(t); }
  for (const t of RELEVANCE_TERMS.contextual) if (lower.includes(t)) { score += 1; matched.push(t); }
  for (const t of RELEVANCE_TERMS.negative) if (lower.includes(t)) score -= 3;
  return { score, matched: [...new Set(matched)].slice(0, 6) };
}

// ---------------------------------------------------------------- event clusters

/**
 * Groups relevant articles by the rule they trigger. A cluster is a *reported
 * situation*, so it needs corroboration: single-article clusters are kept but
 * marked LOW confidence, never promoted to a critical signal on their own.
 */
function buildEventClusters(articles) {
  const clusters = new Map();

  for (const article of articles) {
    const haystack = `${article.title} ${article.source}`.toLowerCase();

    for (const rule of RULES) {
      if (rule.trigger.kind !== 'news') continue;
      const domainHit = rule.trigger.domains?.some((d) => article.domains.includes(d));
      if (!domainHit) continue;
      const keywordHits = rule.trigger.keywords.filter((k) => haystack.includes(k));
      if (keywordHits.length === 0) continue;

      let cluster = clusters.get(rule.id);
      if (!cluster) {
        cluster = {
          id: `EC_${rule.id}`,
          ruleId: rule.id,
          eventType: rule.name,
          eventTypeKo: rule.nameKo ?? rule.name,
          riskType: rule.riskType,
          riskTypeKo: rule.riskTypeKo ?? rule.riskType,
          regions: rule.regions,
          products: rule.products,
          articles: [],
          keywords: new Set(),
          publishers: new Set(),
          status: 'OPEN',
        };
        clusters.set(rule.id, cluster);
      }
      cluster.articles.push(article);
      keywordHits.forEach((k) => cluster.keywords.add(k));
      cluster.publishers.add(article.source);
    }
  }

  const now = Date.now();
  return [...clusters.values()]
    .map((c) => {
      const times = c.articles.map((a) => Date.parse(a.publishedAt)).filter(Number.isFinite);
      const firstDetected = new Date(Math.min(...times)).toISOString();
      const latestUpdate = new Date(Math.max(...times)).toISOString();
      const ageHours = (now - Math.max(...times)) / 3_600_000;
      const publishers = c.publishers.size;

      // Confidence is corroboration (distinct publishers) discounted by staleness.
      let confidence = 'LOW';
      if (publishers >= 4 && ageHours <= 72) confidence = 'HIGH';
      else if (publishers >= 2 && ageHours <= 120) confidence = 'MEDIUM';

      const status = ageHours <= 24 ? 'ACTIVE' : ageHours <= 96 ? 'OPEN' : 'COOLING';

      return {
        ...c,
        keywords: [...c.keywords],
        publisherCount: publishers,
        articleCount: c.articles.length,
        firstDetected,
        latestUpdate,
        ageHours: Math.round(ageHours),
        confidence,
        status,
        evidence: c.articles
          .slice(0, 6)
          .map((a) => ({ id: a.id, title: a.title, titleKo: a.titleKo ?? null, source: a.source, publishedAt: a.publishedAt, link: a.link })),
        articles: undefined,
      };
    })
    .sort((a, b) => b.publisherCount - a.publisherCount || b.articleCount - a.articleCount);
}

// ---------------------------------------------------------------- impact engine

const confidenceRank = { LOW: 1, MEDIUM: 2, HIGH: 3 };

function impactsFromMarket(signals, market) {
  const impacts = [];

  for (const signal of signals) {
    for (const rule of RULES) {
      if (rule.trigger.kind !== 'market') continue;
      const targets = Array.isArray(rule.trigger.instrument) ? rule.trigger.instrument : [rule.trigger.instrument];
      if (!targets.includes(signal.instrument)) continue;

      const direction = rule.directionFrom(signal.pct);
      const actions = Array.isArray(rule.actions) ? rule.actions : rule.actions[direction] ?? [];
      const actionsKo = rule.actionsKo
        ? (Array.isArray(rule.actionsKo) ? rule.actionsKo : rule.actionsKo[direction] ?? [])
        : [];
      const narrative = rule.narrativeKo?.[direction] ?? rule.narrativeKo?.UP ?? null;

      impacts.push({
        id: `IM_${rule.id}_${signal.instrument}`,
        ruleId: rule.id,
        ruleName: rule.name,
        ruleNameKo: rule.nameKo ?? rule.name,
        origin: 'MARKET_SIGNAL',
        originId: signal.id,
        severity: signal.severity,
        confidence: signal.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
        direction,
        riskType: rule.riskType,
        riskTypeKo: rule.riskTypeKo ?? rule.riskType,
        products: rule.products,
        regions: rule.regions,
        chain: rule.chain,
        chainKo: rule.chainKo ?? rule.chain,
        lagNote: rule.lagNote ?? null,
        lagNoteKo: rule.lagNoteKo ?? rule.lagNote ?? null,
        narrativeKo: narrative,
        fact: signal.fact,
        factSource: signal.source,
        factTimestamp: signal.sourceTimestamp,
        rule: rule.chain.join(' → '),
        inference:
          `${rule.regions.join('/')} 향 ${rule.products.join('/')} 거래에서 ` +
          `${rule.riskTypeKo ?? rule.riskType} 리스크가 ` +
          `${direction === 'UP' ? '상승' : '하락'}할 가능성이 있습니다. ` +
          `(시장 데이터 기반 추론이며, 실제 오퍼 변동은 확인이 필요합니다)`,
        actions,
        actionsKo,
      });
    }
  }
  return impacts;
}

function impactsFromEvents(clusters) {
  return clusters.map((cluster) => {
    const rule = RULES.find((r) => r.id === cluster.ruleId);
    const direction = rule.directionFrom();
    const actions = Array.isArray(rule.actions) ? rule.actions : rule.actions[direction] ?? [];
    const actionsKo = rule.actionsKo
      ? (Array.isArray(rule.actionsKo) ? rule.actionsKo : rule.actionsKo[direction] ?? [])
      : [];
    const narrative = rule.narrativeKo?.[direction] ?? rule.narrativeKo?.UP ?? null;
    const severity =
      cluster.confidence === 'HIGH' ? 'HIGH' : cluster.confidence === 'MEDIUM' ? 'MEDIUM' : 'LOW';

    return {
      id: `IM_${rule.id}_EVENT`,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleNameKo: rule.nameKo ?? rule.name,
      origin: 'EVENT_CLUSTER',
      originId: cluster.id,
      severity,
      confidence: cluster.confidence,
      direction,
      riskType: rule.riskType,
      riskTypeKo: rule.riskTypeKo ?? rule.riskType,
      products: rule.products,
      regions: rule.regions,
      chain: rule.chain,
      chainKo: rule.chainKo ?? rule.chain,
      lagNote: rule.lagNote ?? null,
      lagNoteKo: rule.lagNoteKo ?? rule.lagNote ?? null,
      narrativeKo: narrative,
      fact:
        `${rule.nameKo ?? cluster.eventType} 관련 보도 ${cluster.articleCount}건 ` +
        `(매체 ${cluster.publisherCount}곳, 최신 ${cluster.latestUpdate.slice(0, 10)})`,
      factSource: `Google News RSS — ${[...new Set(cluster.evidence.map((e) => e.source))].slice(0, 3).join(', ')}`,
      factTimestamp: cluster.latestUpdate,
      rule: (rule.chainKo ?? rule.chain).join(' → '),
      inference:
        `${rule.regions.join('/')} 향 ${rule.products.join('/')} 거래에서 ` +
        `${rule.riskTypeKo ?? rule.riskType} 리스크가 ${direction === 'UP' ? '상승' : '하락'}할 가능성이 있습니다. ` +
        `(보도 기반 추론이며 실제 계약 영향은 개별 확인이 필요합니다)`,
      actions,
      actionsKo,
      evidence: cluster.evidence,
    };
  });
}

/**
 * §6 — when a market signal and a news cluster assert the same rule, that is one
 * cause seen twice. Severity is not added; corroboration raises confidence only.
 */
function reconcile(impacts) {
  const byRule = new Map();
  for (const impact of impacts) {
    const existing = byRule.get(impact.ruleId);
    if (!existing) {
      byRule.set(impact.ruleId, impact);
      continue;
    }
    const keep = SEVERITY[impact.severity] > SEVERITY[existing.severity] ? impact : existing;
    const other = keep === impact ? existing : impact;
    keep.confidence =
      confidenceRank[keep.confidence] >= confidenceRank[other.confidence] ? keep.confidence : other.confidence;
    keep.corroboratedBy = other.origin;
    keep.corroborationNote =
      '시장 신호와 뉴스가 같은 원인을 가리킵니다. Severity를 중복 가산하지 않고 Confidence만 상향했습니다.';
    byRule.set(impact.ruleId, keep);
  }
  return [...byRule.values()].sort(
    (a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || confidenceRank[b.confidence] - confidenceRank[a.confidence],
  );
}

/**
 * Normalize AI-generated riskType labels into canonical categories.
 * AI produces 50+ variations ("물류 리스크", "물류 및 공급망 리스크", "logistics", etc.)
 * — this maps them all to 7 standard categories for consistent filtering.
 */
const RISK_CATEGORY_RULES = [
  { category: '원자재 원가', categoryEn: 'raw_material',
    keywords: ['원자재', '원재료', '원판', '기판', '도금 원가', '아연', '알루미늄', 'raw_material', '원료', '코크스', 'coating cost', '합금'] },
  { category: '물류·운임', categoryEn: 'logistics',
    keywords: ['물류', '운임', '해운', 'logistics', 'supply_chain', '공급망', '선적', '항만', 'freight', '운송'] },
  { category: '통상·규제', categoryEn: 'trade_policy',
    keywords: ['통상', '관세', '규제', 'trade_policy', '무역', 'CBAM', 'ESG', '세이프가드', '반덤핑', '쿼터', 'safeguard', 'tariff'] },
  { category: '환율', categoryEn: 'fx',
    keywords: ['환율', 'currency', '금융', '달러', '원화', '위안'] },
  { category: '경쟁 동향', categoryEn: 'competition',
    keywords: ['경쟁', 'competition', '인도', '터키', '베트남', '중국', '대체재', '자급률', '공급 과잉', '수출 급증', '오퍼', '제철소'] },
  { category: '지정학·제재', categoryEn: 'geopolitics',
    keywords: ['지정학', '제재', 'sanction', 'geopolitical', '분쟁', '갈등', '전쟁', '군사'] },
  { category: '수요·시장', categoryEn: 'demand',
    keywords: ['수요', 'demand', '시장', '건설', '소비', '경기'] },
];

function normalizeRiskCategory(riskTypeKo, riskType) {
  const label = (riskTypeKo || riskType || '').toLowerCase();
  for (const rule of RISK_CATEGORY_RULES) {
    if (rule.keywords.some(kw => label.includes(kw.toLowerCase()))) {
      return { category: rule.category, categoryEn: rule.categoryEn };
    }
  }
  return { category: '기타', categoryEn: 'other' };
}

/** Region x product projection (§13) — one row per actionable combination. */
function salesImpact(impacts) {
  const rows = [];
  for (const impact of impacts) {
    const { category, categoryEn } = normalizeRiskCategory(impact.riskTypeKo, impact.riskType);
    for (const region of impact.regions) {
      rows.push({
        id: `SI_${impact.id}_${region.replace(/\s+/g, '')}`,
        region,
        products: impact.products,
        riskType: categoryEn,
        riskTypeKo: category,
        riskTypeOriginal: impact.riskTypeKo ?? impact.riskType,  // 원본 보존
        direction: impact.direction,
        severity: impact.severity,
        confidence: impact.confidence,
        action: impact.actionsKo?.[0] ?? impact.actions[0] ?? '노출 점검 필요',
        impactId: impact.id,
        ruleId: impact.ruleId,
      });
    }
  }
  return rows
    .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || confidenceRank[b.confidence] - confidenceRank[a.confidence]);
}

// ---------------------------------------------------------------- news digest

/** Map news domains to Korean theme labels for Event Radar digest. */
const DOMAIN_THEME = {
  steel_price: '원자재·가격',
  raw_material: '원자재·가격',
  zinc_market: '원자재·가격',
  aluminium_market: '원자재·가격',
  // ── Product-specific themes (own tabs in News Digest) ──
  crc_market: 'CRC 시황',
  gi_market: 'GI·도금 시황',
  gl_market: 'GL·갈바 시황',
  coated_steel: '컬러강판 시황',
  trade_policy: '통상·관세',
  eu_steel_trade: '통상·관세',
  us_steel_trade: '통상·관세',
  asia_steel_trade: '통상·관세',
  china_supply: '중국 동향',
  china_export_flood: '중국 동향',
  competitor_turkey: '경쟁국 동향',
  competitor_india: '경쟁국 동향',
  competitor_vietnam: '경쟁국 동향',
  gcc_steel_market: '중동·수요',
  energy: '에너지·물류',
  logistics: '에너지·물류',
  geopolitics: '지정학',
  geopolitics_asia: '지정학',
  geopolitics_korea: '지정학',
  geopolitics_global: '지정학',
  natural_disaster: '자연재해·공급망',
  currency_crisis: '환율·금융',
  broad_world: '글로벌',
  broad_business: '글로벌·경제',
  korea_steel: '한국 철강',
  macro_politics: '거시경제·정치',
  macro_economy: '거시경제·정치',
  macro_japan: '일본 경제',
  macro_kr_economy: '한국 경제',
  macro_construction: '건설·수요',
};

function buildNewsDigest(allArticles) {
  const digest = [];
  for (const article of allArticles) {
    const theme = article.domains
      .map((d) => DOMAIN_THEME[d])
      .filter(Boolean)[0] ?? '기타';
    digest.push({
      id: article.id,
      title: article.title,
      titleKo: article.titleKo ?? null,
      source: article.source,
      publishedAt: article.publishedAt,
      link: article.link,
      theme,
      domains: article.domains,
      lang: article.lang,
    });
  }
  return digest.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

// ---------------------------------------------------------------- main

async function main() {
  const market = await readJson('market.json');
  const news = await readJson('news.json');

  // Translate any titles still missing Korean translation (Google Translate fallback)
  const preTranslateCount = news.articles.filter((a) => !a.titleKo).length;
  await translateTitlesViaGemini(news.articles);
  // Write back to news.json so translations persist for subsequent runs
  if (preTranslateCount > 0 && news.articles.some((a) => a.titleKo)) {
    await writeFile(new URL('news.json', DATA), JSON.stringify(news));
  }

  const scored = news.articles
    .map((a) => ({ ...a, relevance: relevanceScore(`${a.title} ${a.source}`) }))
    .filter((a) => a.relevance.score >= 2);

  const rejected = news.articles.length - scored.length;

  const signals = marketSignals(market);
  const clusters = buildEventClusters(scored);
  const ruleImpacts = reconcile([...impactsFromMarket(signals, market), ...impactsFromEvents(clusters)]);

  // AI analysis — TRIAGE → ANALYST → CRITIC → Deterministic Scoring pipeline
  let aiImpacts = [];
  let aiMetrics = {};
  try {
    const aiResult = await aiAnalyze(news.articles, ruleImpacts.map((i) => i.id));
    aiImpacts = aiResult.impacts || [];
    aiMetrics = aiResult.metrics || {};
  } catch (err) {
    console.error('  ai       AI analysis failed (non-fatal):', err.message);
  }

  // Dedup: AI impacts with same ruleId as a rule-engine impact are dropped (rule engine is authoritative)
  const ruleImpactIds = new Set(ruleImpacts.map((i) => i.ruleId));
  const dedupedAiImpacts = aiImpacts.filter((ai) => !ruleImpactIds.has(ai.ruleId));

  // Merge: rule-based first, then AI insights
  const allImpacts = [...ruleImpacts, ...dedupedAiImpacts];
  // Re-sort by severity
  allImpacts.sort(
    (a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || (['HIGH', 'MEDIUM', 'LOW'].indexOf(a.confidence) - ['HIGH', 'MEDIUM', 'LOW'].indexOf(b.confidence)),
  );

  const critical = allImpacts.filter((i) => SEVERITY[i.severity] >= SEVERITY.MEDIUM);

  // News digest for Event Radar: ALL articles, not just rule-matched
  const newsDigest = buildNewsDigest(news.articles);

  const analysis = {
    generatedAt: new Date().toISOString(),
    inputs: {
      marketGeneratedAt: market.generatedAt,
      newsGeneratedAt: news.generatedAt,
      articlesCollected: news.articles.length,
      articlesRelevant: scored.length,
      articlesRejected: rejected,
      instrumentsCovered: Object.keys(market.instruments).length,
      marketFailures: market.failures,
      newsFailures: news.failures,
      aiInsightsCount: dedupedAiImpacts.length,
      aiMetrics,
    },
    valueChain: VALUE_CHAIN,
    marketSignals: signals,
    eventClusters: clusters,
    impacts: allImpacts,
    criticalSignals: critical.slice(0, 15),
    salesImpact: salesImpact(allImpacts),
    newsDigest,
    ruleCount: RULES.length,
    aiEnabled: dedupedAiImpacts.length > 0,
  };

  await writeFile(new URL('analysis.json', DATA), JSON.stringify(analysis));

  console.log(`  news       ${scored.length} relevant / ${news.articles.length} collected (${rejected} filtered out)`);
  console.log(`  signals    ${signals.length} market signal(s)`);
  for (const s of signals) console.log(`             ${s.severity.padEnd(6)} ${s.instrument} ${s.pct.toFixed(2)}% (${s.windowLabel})`);
  console.log(`  clusters   ${clusters.length} event cluster(s)`);
  for (const c of clusters) console.log(`             ${c.confidence.padEnd(6)} ${c.eventType} — ${c.articleCount} articles / ${c.publisherCount} publishers`);
  console.log(`  impacts    ${allImpacts.length} total (rules: ${ruleImpacts.length}, AI: ${dedupedAiImpacts.length}, critical: ${critical.length})`);
  console.log(`  salesImpact ${analysis.salesImpact.length} row(s)`);
  console.log('\nanalysis.json written');
}

main().catch((err) => {
  console.error('analyze failed:', err);
  process.exit(1);
});
