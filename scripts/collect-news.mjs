/**
 * Collects Google News RSS across every risk domain and writes data/news.json.
 *
 * One story routinely surfaces under several queries (a China export-rebate cut
 * hits `trade_policy`, `china_supply` and `steel_price` at once). Rather than
 * dropping the duplicates we merge them and keep every domain that matched —
 * cross-domain hits are exactly the signal the event clusterer wants.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { NEWS_QUERIES, BROAD_FEEDS, newsFeedUrl } from './sources.mjs';

const OUT = new URL('../public/data/news.json', import.meta.url);
const ANALYSIS = new URL('../public/data/analysis.json', import.meta.url);
const MAX_AGE_DAYS = 10;
const MAX_ITEMS = 400;

/**
 * Hard time budget for the best-effort translation pass. Translation is
 * ENRICHMENT, not part of the freshness critical path: fresh news.json is
 * written BEFORE translation starts, so even a zero budget only means English
 * titles — never stale data. 3 min default; override via TRANSLATE_BUDGET_MS.
 * (2026-08-25: a slow gtx endpoint held `translating 400 titles...` past the
 * deploy step's 15-min timeout, killing refresh and shipping stale data.)
 */
const TRANSLATE_BUDGET_MS = Number(process.env.TRANSLATE_BUDGET_MS || 180_000);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * Translate a string to Korean using Google Translate's free endpoint.
 * Retries up to 3 times with exponential backoff on failure.
 * Returns null only after all retries are exhausted — never blocks the pipeline.
 */
async function translateToKo(text, retries = 2) {
  if (!text || text.length < 3) return null;
  // Skip if already Korean (title from ko-language queries)
  if (/[가-힯]/.test(text.slice(0, 10))) return text;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${encodeURIComponent(text.slice(0, 500))}`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 429) {
        // Rate-limited — back off and retry
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) continue;
      const data = await res.json();
      const result = data[0]?.map((x) => x[0]).join('') || null;
      if (result) return result;
    } catch {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  return null;
}

/**
 * Batch-translate titles with throttling and a hard deadline (best effort).
 * Untranslated articles simply keep titleKo: null — English titles beat
 * stale data. Returns counts so the caller knows whether anything changed.
 */
async function translateTitles(articles, {
  translate = translateToKo,
  deadlineAt = Date.now() + TRANSLATE_BUDGET_MS,
  throttleMs = 250,
} = {}) {
  let translated = 0;
  let newlyTranslated = 0;
  let failed = 0;
  let skippedByBudget = 0;
  const failedArticles = [];

  for (const article of articles) {
    if (article.titleKo) { translated++; continue; }   // already has translation (reuse or ko-lang)
    if (Date.now() >= deadlineAt) { skippedByBudget++; continue; }
    const ko = await translate(article.title);
    if (ko) {
      article.titleKo = ko;
      translated++;
      newlyTranslated++;
    } else {
      failed++;
      failedArticles.push(article);
    }
    // Throttle to avoid rate limiting
    if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
  }
  console.log(`  translate pass 1: ${translated} ok / ${failed} failed / ${skippedByBudget} skipped (budget)`);

  // Second pass for failures — only if budget remains
  if (failedArticles.length > 0 && failedArticles.length <= 100 && Date.now() < deadlineAt) {
    console.log(`  retrying ${failedArticles.length} failed translations...`);
    let retryOk = 0;
    for (const article of failedArticles) {
      if (Date.now() >= deadlineAt) break;
      if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs * 2));
      const ko = await translate(article.title);
      if (ko) {
        article.titleKo = ko;
        retryOk++;
      }
    }
    translated += retryOk;
    newlyTranslated += retryOk;
    failed -= retryOk;
    console.log(`  translate pass 2: ${retryOk} recovered / ${failed} still failed`);
  }

  return { translated, newlyTranslated, failed, skippedByBudget };
}

/**
 * Reuse translations from previous runs, keyed by articleFingerprint (stable
 * across re-collection). Sources, best effort: the previous news.json (local
 * runs) and the committed analysis.json's newsDigest (CI — news.json is
 * gitignored there, so this is the only carry-over that survives a fresh
 * checkout). Without this, every hourly run re-translated all ~400 titles.
 */
async function loadPreviousTranslations() {
  const map = new Map();
  const harvest = (title, source, publishedAt, titleKo) => {
    if (!titleKo || !title) return;
    map.set(fingerprint(title, source, publishedAt), titleKo);
  };
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    for (const a of prev.articles ?? []) {
      if (a.articleFingerprint && a.titleKo) map.set(a.articleFingerprint, a.titleKo);
      else harvest(a.title, a.source, a.publishedAt, a.titleKo);
    }
  } catch { /* no previous news.json — fine */ }
  try {
    const analysis = JSON.parse(await readFile(ANALYSIS, 'utf8'));
    for (const n of analysis.newsDigest ?? []) harvest(n.title, n.source, n.publishedAt, n.titleKo);
  } catch { /* no analysis.json — fine */ }
  return map;
}

/** Apply reused translations in place; returns how many were reused. */
function applyPreviousTranslations(articles, prevMap) {
  let reused = 0;
  for (const a of articles) {
    if (!a.titleKo && prevMap.has(a.articleFingerprint)) {
      a.titleKo = prevMap.get(a.articleFingerprint);
      reused++;
    }
  }
  return reused;
}

/**
 * Write fresh news.json FIRST, then enrich with best-effort translation and
 * rewrite only if anything new was translated. Collection freshness never
 * waits on the translation endpoint.
 */
async function finalizeAndWrite(articles, { counts, failures, generatedAt }, opts = {}) {
  const {
    translate = translateToKo,
    budgetMs = TRANSLATE_BUDGET_MS,
    throttleMs = 250,
    outUrl = OUT,
    reuse = new Map(),
  } = opts;

  const reusedCount = applyPreviousTranslations(articles, reuse);
  if (reusedCount > 0) console.log(`  translate reuse: ${reusedCount} titles carried over from previous run`);

  const payload = {
    generatedAt,
    source: 'Google News RSS',
    window: `${MAX_AGE_DAYS}d`,
    counts,
    failures,
    articles,
  };

  // 1) FRESH WRITE — collection result is safe on disk before translation starts.
  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(outUrl, JSON.stringify(payload));
  console.log(`  news.json written (pre-translation) — ${articles.length} articles`);

  // 2) Best-effort enrichment within the budget. Never throws.
  let translation = { translated: 0, newlyTranslated: 0, failed: 0, skippedByBudget: 0 };
  try {
    const untranslated = articles.filter((a) => !a.titleKo).length;
    if (untranslated > 0) {
      console.log(`\ntranslating ${untranslated} untranslated titles (budget ${Math.round(budgetMs / 1000)}s)...`);
      translation = await translateTitles(articles, { translate, deadlineAt: Date.now() + budgetMs, throttleMs });
    }
  } catch (err) {
    console.error(`  translate: enrichment failed (${err.message}) — keeping untranslated titles`);
  }

  // 3) Rewrite only when enrichment actually added something.
  if (translation.newlyTranslated > 0) {
    await writeFile(outUrl, JSON.stringify(payload));
    console.log(`  news.json updated with ${translation.newlyTranslated} new translation(s)`);
  }

  return { payload, translation, reusedCount };
}

async function fetchText(url, { attempts = 3 } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1_000 * i));
    }
  }
  throw lastError;
}

const decodeEntities = (s) =>
  s
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : '';
}

/**
 * Stable deterministic fingerprint for an article.
 * Uses normalized title + source + date → SHA-256 prefix (16 hex chars).
 * This ID survives re-collection, re-sorting, and re-indexing.
 */
function fingerprint(title, source, pubDate) {
  const normalized = `${title.toLowerCase().trim()}|${(source || '').toLowerCase().trim()}|${pubDate?.slice(0, 10) || ''}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Extract useful text from Google News RSS <description>.
 * Descriptions contain HTML anchor tags with related article titles and publishers.
 * For clustered stories, this provides extra context (multiple related headlines).
 */
function cleanDescription(raw) {
  if (!raw) return null;
  // Extract anchor text (article titles) and publisher names from font tags
  const titles = [...raw.matchAll(/">[^<]*<\/a>/g)].map(m => m[0].replace(/">/,'').replace(/<\/a>/,'').trim());
  const text = titles.filter(t => t.length > 5).join(' | ');
  return text || null;
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
    const title = tag(block, 'title');
    // Google appends " - Publisher" to every headline; strip it, we have <source>.
    const source = tag(block, 'source');
    const cleanTitle =
      source && title.endsWith(` - ${source}`)
        ? title.slice(0, -(source.length + 3)).trim()
        : title;
    const rawDesc = tag(block, 'description');
    return {
      title: cleanTitle,
      link: tag(block, 'link'),
      publishedAt: tag(block, 'pubDate'),
      source: source || 'Unknown',
      snippet: cleanDescription(rawDesc),
    };
  });
}

/** Normalised token set for near-duplicate detection. */
const STOPWORDS = new Set(
  ('a an the of in on for to and or by with from as at is are be been will'
    + ' its it this that new says said after over amid').split(' '),
);

function tokenize(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

async function main() {
  const startedAt = new Date().toISOString();
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  const collected = [];
  const failures = [];

  for (const query of NEWS_QUERIES) {
    try {
      const xml = await fetchText(newsFeedUrl(query));
      const items = parseRss(xml);
      let kept = 0;
      for (const item of items) {
        const ts = Date.parse(item.publishedAt);
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        collected.push({
          ...item,
          publishedAt: new Date(ts).toISOString(),
          domains: [query.domain],
          weight: query.weight,
          lang: query.lang,
          tokens: tokenize(item.title),
        });
        kept++;
      }
      console.log(`  ok   ${query.domain.padEnd(14)} ${String(kept).padStart(3)} fresh / ${items.length} returned`);
    } catch (err) {
      failures.push({ domain: query.domain, error: String(err.message || err) });
      console.error(`  FAIL ${query.domain.padEnd(14)} ${err.message || err}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // Broad discovery feeds (Google News topic-based, no search query)
  for (const feed of (BROAD_FEEDS || [])) {
    try {
      const xml = await fetchText(feed.url);
      const items = parseRss(xml);
      let kept = 0;
      for (const item of items) {
        const ts = Date.parse(item.publishedAt);
        if (!Number.isFinite(ts) || ts < cutoff) continue;
        collected.push({
          ...item,
          publishedAt: new Date(ts).toISOString(),
          domains: [feed.domain],
          weight: feed.weight,
          lang: feed.lang,
          tokens: tokenize(item.title),
        });
        kept++;
      }
      console.log(`  ok   ${feed.domain.padEnd(14)} ${String(kept).padStart(3)} fresh / ${items.length} returned  [broad]`);
    } catch (err) {
      failures.push({ domain: feed.domain, error: String(err.message || err) });
      console.error(`  FAIL ${feed.domain.padEnd(14)} ${err.message || err}  [broad]`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (collected.length === 0) {
    throw new Error('no news items collected — refusing to write an empty news.json');
  }

  // Merge near-duplicates, unioning their domains and keeping the highest weight.
  collected.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const merged = [];
  for (const item of collected) {
    const hit = merged.find(
      (m) => m.title === item.title || jaccard(m.tokens, item.tokens) >= 0.6,
    );
    if (hit) {
      for (const d of item.domains) if (!hit.domains.includes(d)) hit.domains.push(d);
      hit.weight = Math.max(hit.weight, item.weight);
      hit.duplicateCount++;
    } else {
      merged.push({ ...item, duplicateCount: 1 });
    }
  }

  const articles = merged.slice(0, MAX_ITEMS).map(({ tokens, ...rest }, i) => ({
    id: `n${String(i + 1).padStart(4, '0')}`,
    articleFingerprint: fingerprint(rest.title, rest.source, rest.publishedAt),
    ...rest,
  }));

  // generatedAt = the moment collection actually succeeded (not translation).
  const { translation, reusedCount } = await finalizeAndWrite(
    articles,
    {
      counts: { collected: collected.length, afterDedupe: merged.length, written: articles.length },
      failures,
      generatedAt: new Date().toISOString(),
    },
    { reuse: await loadPreviousTranslations() },
  );

  console.log(
    `\nnews.json final — ${articles.length} articles ` +
      `(${collected.length} raw, ${collected.length - merged.length} merged as duplicates), ` +
      `${failures.length} failed feed(s), ` +
      `titleKo: ${reusedCount} reused + ${translation.newlyTranslated} new / ${translation.skippedByBudget + translation.failed} pending`,
  );
  void startedAt;
}

// Exported for deterministic tests — importing must not run the collector.
export { translateTitles, finalizeAndWrite, applyPreviousTranslations, fingerprint };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('collect-news failed:', err);
    process.exit(1);
  });
}
