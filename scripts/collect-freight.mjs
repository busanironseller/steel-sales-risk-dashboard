/**
 * Collects shipping/freight proxy data from Yahoo Finance v8 API.
 * No API key required. Updated daily after US market close.
 *
 * Tickers:
 *   BDRY  — Breakwave Dry Bulk Shipping ETF (BDI proxy)
 *   ZIM   — ZIM Integrated Shipping (container freight indicator)
 *   BWET  — Breakwave Tanker Shipping ETF (tanker rates)
 *   BOAT  — SonicShares Global Shipping ETF (broad shipping)
 */
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../public/data/freight.json', import.meta.url);

const TICKERS = [
  { symbol: 'BDRY', label: 'BDI Proxy (BDRY ETF)', labelKo: 'BDI 추적 ETF', category: 'bulk', unit: 'USD' },
  { symbol: 'ZIM',  label: 'ZIM Integrated Shipping', labelKo: 'ZIM 컨테이너 해운', category: 'container', unit: 'USD' },
  { symbol: 'BWET', label: 'Tanker Shipping ETF', labelKo: '탱커 운임 ETF', category: 'tanker', unit: 'USD' },
  { symbol: 'BOAT', label: 'Global Shipping ETF', labelKo: '글로벌 해운 ETF', category: 'broad', unit: 'USD' },
];

async function fetchYahoo(symbol, range = '6mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${symbol}`);
  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  return result;
}

function buildSeries(result) {
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i];
    if (c == null) continue;
    bars.push({
      date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
      open: round(o), high: round(h), low: round(l), close: round(c),
      volume: v ?? 0,
    });
  }
  return bars;
}

function round(n) {
  return n != null ? Math.round(n * 100) / 100 : null;
}

function pctChange(curr, prev) {
  if (!curr || !prev) return null;
  return Math.round(((curr - prev) / prev) * 10000) / 100;
}

async function main() {
  console.log('Fetching freight proxy data from Yahoo Finance...');
  const tickers = [];
  const failures = [];

  for (const spec of TICKERS) {
    try {
      const result = await fetchYahoo(spec.symbol, '6mo');
      const bars = buildSeries(result);
      if (bars.length === 0) throw new Error('empty series');

      const meta = result.meta ?? {};
      const last = bars.at(-1);
      const prev = bars.length >= 2 ? bars.at(-2) : null;
      const weekAgo = bars.length >= 6 ? bars.at(-6) : null;
      const monthAgo = bars.length >= 22 ? bars.at(-22) : null;

      // Also fetch 5y for long sparkline
      let longBars = bars;
      try {
        const longResult = await fetchYahoo(spec.symbol, '5y');
        longBars = buildSeries(longResult);
      } catch { /* use 6mo */ }

      // Build sparkline (weekly samples from long history)
      const spark = [];
      const step = Math.max(1, Math.floor(longBars.length / 52));
      for (let i = 0; i < longBars.length; i += step) {
        spark.push({ date: longBars[i].date, value: longBars[i].close });
      }
      // Always include latest
      if (spark.length === 0 || spark.at(-1).date !== last.date) {
        spark.push({ date: last.date, value: last.close });
      }

      tickers.push({
        ...spec,
        last: last.close,
        lastDate: last.date,
        change1d: pctChange(last.close, prev?.close),
        change1w: pctChange(last.close, weekAgo?.close),
        change1m: pctChange(last.close, monthAgo?.close),
        high52w: Math.max(...bars.map(b => b.high).filter(Boolean)),
        low52w: Math.min(...bars.map(b => b.low).filter(Boolean)),
        volume: last.volume,
        currency: meta.currency ?? 'USD',
        exchange: meta.exchangeName ?? 'NYSE',
        bars,          // 6mo daily for chart
        spark,         // weekly samples for sparkline
      });

      console.log(
        `  ok   ${spec.symbol.padEnd(6)} $${String(last.close).padStart(8)} ` +
        `1d: ${pctChange(last.close, prev?.close)?.toFixed(2) ?? 'N/A'}% ` +
        `(${bars.length} bars)`
      );
    } catch (err) {
      failures.push({ symbol: spec.symbol, error: err.message });
      console.error(`  FAIL ${spec.symbol.padEnd(6)} ${err.message}`);
    }
  }

  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'Yahoo Finance v8 (free, no API key)',
      note: 'BDRY ETF tracks BDI futures; ZIM is container shipping; prices are US market close',
      tickers,
      failures,
    }),
  );

  console.log(`\nfreight.json — ${tickers.length} tickers, ${failures.length} failure(s)`);
}

main().catch((err) => {
  console.error('collect-freight failed:', err);
  process.exit(1);
});
