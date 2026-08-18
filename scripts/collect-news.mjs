/**
 * Collects Google News RSS across every risk domain and writes data/news.json.
 *
 * One story routinely surfaces under several queries (a China export-rebate cut
 * hits `trade_policy`, `china_supply` and `steel_price` at once). Rather than
 * dropping the duplicates we merge them and keep every domain that matched —
 * cross-domain hits are exactly the signal the event clusterer wants.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { NEWS_QUERIES, newsFeedUrl } from './sources.mjs';

const OUT = new URL('../data/news.json', import.meta.url);
const MAX_AGE_DAYS = 10;
const MAX_ITEMS = 400;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
    const title = tag(block, 'title');
    // Google appends " - Publisher" to every headline; strip it, we have <source>.
    const source = tag(block, 'source');
    const cleanTitle =
      source && title.endsWith(` - ${source}`)
        ? title.slice(0, -(source.length + 3)).trim()
        : title;
    return {
      title: cleanTitle,
      link: tag(block, 'link'),
      publishedAt: tag(block, 'pubDate'),
      source: source || 'Unknown',
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
    ...rest,
  }));

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: startedAt,
        source: 'Google News RSS',
        window: `${MAX_AGE_DAYS}d`,
        counts: { collected: collected.length, afterDedupe: merged.length, written: articles.length },
        failures,
        articles,
      },
      null,
      2,
    ),
  );

  console.log(
    `\nnews.json written — ${articles.length} articles ` +
      `(${collected.length} raw, ${collected.length - merged.length} merged as duplicates), ` +
      `${failures.length} failed feed(s)`,
  );
}

main().catch((err) => {
  console.error('collect-news failed:', err);
  process.exit(1);
});
