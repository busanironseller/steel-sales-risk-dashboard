/**
 * Collects exchange rates from Yahoo Finance v8 API (primary) with
 * Frankfurter/ECB as fallback.
 *
 * Yahoo Finance updates FX rates near-real-time during forex market hours
 * (Sun 17:00 – Fri 17:00 ET). No API key required.
 *
 * Frankfurter (ECB) updates once per weekday at ~16:00 CET — used only
 * when Yahoo fails.
 *
 * Target pairs:
 *   USD/KRW, EUR/USD, USD/CNY, USD/JPY, JPY/KRW (×100), GBP/USD
 */
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../public/data/fx.json', import.meta.url);

/* ── Yahoo Finance FX symbols ── */
const PAIRS = [
  { key: 'USD_KRW', yahoo: 'KRW=X',    from: 'USD', to: 'KRW', label: 'USD/KRW', labelKo: '달러/원',        scale: 1 },
  { key: 'EUR_USD', yahoo: 'EURUSD=X',  from: 'EUR', to: 'USD', label: 'EUR/USD', labelKo: '유로/달러',      scale: 1 },
  { key: 'USD_CNY', yahoo: 'CNY=X',     from: 'USD', to: 'CNY', label: 'USD/CNY', labelKo: '달러/위안',      scale: 1 },
  { key: 'USD_JPY', yahoo: 'JPY=X',     from: 'USD', to: 'JPY', label: 'USD/JPY', labelKo: '달러/엔',        scale: 1 },
  { key: 'JPY_KRW', yahoo: 'JPYKRW=X',  from: 'JPY', to: 'KRW', label: 'JPY/KRW (100엔)', labelKo: '엔/원 (100엔)', scale: 100 },
  { key: 'GBP_USD', yahoo: 'GBPUSD=X',  from: 'GBP', to: 'USD', label: 'GBP/USD', labelKo: '파운드/달러',    scale: 1 },
];

function round(n, d = 4) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function pctChange(curr, prev) {
  if (!curr || !prev) return null;
  return Math.round(((curr - prev) / prev) * 10000) / 100;
}

/* ── Yahoo Finance v8 chart API ── */
async function fetchYahooFx(symbol, range = '3mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  return result;
}

function buildDailySeries(result) {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i];
    if (c == null) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      value: c,
    });
  }
  return bars;
}

/* ── Frankfurter fallback (ECB, daily) ── */
const FRANK_URL = 'https://api.frankfurter.dev/v1';
const FRANK_TARGETS = 'USD,KRW,CNY,JPY,GBP';

async function fetchFrankfurter() {
  console.log('  fallback: trying Frankfurter/ECB...');
  const latest = await fetch(`${FRANK_URL}/latest?to=${FRANK_TARGETS}`, {
    signal: AbortSignal.timeout(15_000),
  }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 90);
  let history = {};
  try {
    history = await fetch(
      `${FRANK_URL}/${from.toISOString().slice(0, 10)}..${today.toISOString().slice(0, 10)}?to=${FRANK_TARGETS}`,
      { signal: AbortSignal.timeout(15_000) },
    ).then(r => r.json());
  } catch { /* sparkline not critical */ }

  const r = latest.rates;
  function cross(from, to) {
    if (from === 'EUR') return r[to];
    if (to === 'EUR') return 1 / r[from];
    return r[to] / r[from];
  }

  return PAIRS.map(pair => {
    const rate = cross(pair.from, pair.to) * pair.scale;
    const spark = [];
    if (history.rates) {
      for (const [date, dayRates] of Object.entries(history.rates).sort()) {
        const rr = { ...dayRates };
        function crossDay(f, t) {
          if (f === 'EUR') return rr[t];
          if (t === 'EUR') return 1 / rr[f];
          return rr[t] / rr[f];
        }
        spark.push({ date, value: crossDay(pair.from, pair.to) * pair.scale });
      }
    }
    const prev = spark.length >= 2 ? spark.at(-2).value : null;
    const weekAgo = spark.length >= 6 ? spark.at(-6).value : null;
    return {
      ...pair,
      rate: round(rate, pair.key.includes('KRW') ? 2 : 4),
      change1d: pctChange(rate, prev),
      change1w: pctChange(rate, weekAgo),
      spark,
      source: 'ECB',
    };
  });
}

/* ── Main ── */
async function main() {
  console.log('Fetching FX rates from Yahoo Finance...');
  const results = [];
  let yahooOk = 0;
  let yahooFail = 0;

  for (const pair of PAIRS) {
    try {
      const result = await fetchYahooFx(pair.yahoo, '3mo');
      const series = buildDailySeries(result);
      if (series.length === 0) throw new Error('empty series');

      const meta = result.meta ?? {};
      const lastRaw = meta.regularMarketPrice ?? series.at(-1).value;
      const rate = round(lastRaw * pair.scale, pair.key.includes('KRW') ? 2 : 4);

      // Build sparkline
      const spark = series.map(s => ({
        date: s.date,
        value: round(s.value * pair.scale, pair.key.includes('KRW') ? 2 : 4),
      }));

      const prev = series.length >= 2 ? series.at(-2).value * pair.scale : null;
      const weekAgo = series.length >= 6 ? series.at(-6).value * pair.scale : null;

      results.push({
        ...pair,
        rate,
        change1d: pctChange(rate, prev),
        change1w: pctChange(rate, weekAgo),
        spark,
        lastUpdated: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : new Date().toISOString(),
        source: 'Yahoo',
      });
      yahooOk++;
      console.log(
        `  ok   ${pair.label.padEnd(18)} ${String(rate).padStart(10)} ` +
        `1d: ${pctChange(rate, prev)?.toFixed(2) ?? 'N/A'}%  [Yahoo]`
      );
    } catch (err) {
      console.warn(`  FAIL ${pair.label.padEnd(18)} ${err.message}`);
      yahooFail++;
    }
  }

  // Fallback: if Yahoo failed for any pair, try Frankfurter for ALL (consistency)
  let source = 'Yahoo Finance (near real-time)';
  if (yahooFail > 0) {
    console.log(`\nYahoo failed for ${yahooFail}/${PAIRS.length} pairs, trying Frankfurter fallback...`);
    try {
      const fallback = await fetchFrankfurter();
      // Replace failed pairs (or all if majority failed)
      if (yahooFail > PAIRS.length / 2) {
        results.length = 0;
        results.push(...fallback);
        source = 'Frankfurter/ECB (fallback — daily)';
        console.log('  Using Frankfurter for all pairs');
      } else {
        const okKeys = new Set(results.map(r => r.key));
        for (const fb of fallback) {
          if (!okKeys.has(fb.key)) {
            results.push(fb);
            console.log(`  ok   ${fb.label.padEnd(18)} ${String(fb.rate).padStart(10)} [ECB fallback]`);
          }
        }
        source = 'Yahoo Finance + Frankfurter/ECB (mixed)';
      }
    } catch (err) {
      console.error('  Frankfurter fallback also failed:', err.message);
      if (results.length === 0) throw new Error('All FX sources failed');
    }
  }

  // Sort to match original pair order
  const order = PAIRS.map(p => p.key);
  results.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  // Remove internal fields before writing
  const pairs = results.map(({ yahoo, scale, source: s, ...rest }) => rest);

  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source,
    referenceDate: new Date().toISOString().slice(0, 10),
    pairs,
  }));

  console.log(`\nfx.json written — ${pairs.length} pairs via ${source}`);
}

main().catch((err) => {
  console.error('collect-fx failed:', err);
  process.exit(1);
});
