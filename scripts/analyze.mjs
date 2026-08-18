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

const DATA = new URL('../public/data/', import.meta.url);
const WINDOW_LABEL = { m30: '30분', m60: '60분', m120: '120분', today: '금일' };

const readJson = async (name) => JSON.parse(await readFile(new URL(name, DATA), 'utf8'));

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
          .map((a) => ({ id: a.id, title: a.title, source: a.source, publishedAt: a.publishedAt, link: a.link })),
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

/** Region x product projection (§13) — one row per actionable combination. */
function salesImpact(impacts) {
  const rows = [];
  for (const impact of impacts) {
    for (const region of impact.regions) {
      rows.push({
        id: `SI_${impact.id}_${region.replace(/\s+/g, '')}`,
        region,
        products: impact.products,
        riskType: impact.riskType,
        riskTypeKo: impact.riskTypeKo ?? impact.riskType,
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
    .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || confidenceRank[b.confidence] - confidenceRank[a.confidence])
    .slice(0, 20);
}

// ---------------------------------------------------------------- main

async function main() {
  const market = await readJson('market.json');
  const news = await readJson('news.json');

  const scored = news.articles
    .map((a) => ({ ...a, relevance: relevanceScore(`${a.title} ${a.source}`) }))
    .filter((a) => a.relevance.score >= 2);

  const rejected = news.articles.length - scored.length;

  const signals = marketSignals(market);
  const clusters = buildEventClusters(scored);
  const impacts = reconcile([...impactsFromMarket(signals, market), ...impactsFromEvents(clusters)]);
  const critical = impacts.filter((i) => SEVERITY[i.severity] >= SEVERITY.MEDIUM);

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
    },
    valueChain: VALUE_CHAIN,
    marketSignals: signals,
    eventClusters: clusters,
    impacts,
    criticalSignals: critical.slice(0, 10),
    salesImpact: salesImpact(impacts),
    ruleCount: RULES.length,
  };

  await writeFile(new URL('analysis.json', DATA), JSON.stringify(analysis));

  console.log(`  news       ${scored.length} relevant / ${news.articles.length} collected (${rejected} filtered out)`);
  console.log(`  signals    ${signals.length} market signal(s)`);
  for (const s of signals) console.log(`             ${s.severity.padEnd(6)} ${s.instrument} ${s.pct.toFixed(2)}% (${s.windowLabel})`);
  console.log(`  clusters   ${clusters.length} event cluster(s)`);
  for (const c of clusters) console.log(`             ${c.confidence.padEnd(6)} ${c.eventType} — ${c.articleCount} articles / ${c.publisherCount} publishers`);
  console.log(`  impacts    ${impacts.length} (critical: ${critical.length})`);
  console.log(`  salesImpact ${analysis.salesImpact.length} row(s)`);
  console.log('\nanalysis.json written');
}

main().catch((err) => {
  console.error('analyze failed:', err);
  process.exit(1);
});
