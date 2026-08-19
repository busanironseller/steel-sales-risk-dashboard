/**
 * Collects exchange rates from Frankfurter API (free, no key required).
 * Frankfurter uses ECB reference rates, updated weekdays ~16:00 CET.
 *
 * Target pairs:
 *   USD/KRW, EUR/USD, USD/CNY, USD/JPY, JPY/KRW, GBP/USD
 *
 * The ECB quotes everything against EUR, so we:
 *   1. Fetch EUR → {USD, KRW, CNY, JPY, GBP}
 *   2. Derive cross-rates from EUR base
 */
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../public/data/fx.json', import.meta.url);

const BASE_URL = 'https://api.frankfurter.dev/v1';
const TARGETS = 'USD,KRW,CNY,JPY,GBP';

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

function cross(rates, from, to) {
  // rates are EUR-based: EUR/X
  // to get FROM/TO: (EUR/TO) / (EUR/FROM)
  if (from === 'EUR') return rates[to];
  if (to === 'EUR') return 1 / rates[from];
  return rates[to] / rates[from];
}

async function main() {
  console.log('Fetching exchange rates from Frankfurter API...');

  // Latest rates
  const latest = await fetchJson(`${BASE_URL}/latest?to=${TARGETS}`);
  const r = latest.rates;

  // Historical: 30 days back for sparkline
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = today.toISOString().slice(0, 10);

  let history = {};
  try {
    history = await fetchJson(`${BASE_URL}/${fromStr}..${toStr}?to=${TARGETS}`);
  } catch (err) {
    console.warn('  warn: history fetch failed:', err.message);
  }

  // Build pairs
  const pairs = [
    { key: 'USD_KRW', from: 'USD', to: 'KRW', label: 'USD/KRW', labelKo: '달러/원' },
    { key: 'EUR_USD', from: 'EUR', to: 'USD', label: 'EUR/USD', labelKo: '유로/달러' },
    { key: 'USD_CNY', from: 'USD', to: 'CNY', label: 'USD/CNY', labelKo: '달러/위안' },
    { key: 'USD_JPY', from: 'USD', to: 'JPY', label: 'USD/JPY', labelKo: '달러/엔' },
    { key: 'JPY_KRW', from: 'JPY', to: 'KRW', label: 'JPY/KRW (100엔)', labelKo: '엔/원 (100엔)' },
    { key: 'GBP_USD', from: 'GBP', to: 'USD', label: 'GBP/USD', labelKo: '파운드/달러' },
  ];

  const fxData = pairs.map((pair) => {
    const rate = cross(r, pair.from, pair.to);
    // For JPY/KRW, show per 100 JPY for readability
    const displayRate = pair.key === 'JPY_KRW' ? rate * 100 : rate;

    // Build sparkline from history
    const spark = [];
    if (history.rates) {
      const dates = Object.keys(history.rates).sort();
      for (const date of dates) {
        const dayRates = history.rates[date];
        const val = cross(dayRates, pair.from, pair.to);
        spark.push({
          date,
          value: pair.key === 'JPY_KRW' ? val * 100 : val,
        });
      }
    }

    // Calculate changes
    const prev = spark.length >= 2 ? spark[spark.length - 2].value : null;
    const weekAgo = spark.length >= 6 ? spark[spark.length - 6].value : null;
    const monthAgo = spark.length >= 1 ? spark[0].value : null;

    return {
      ...pair,
      rate: displayRate,
      change1d: prev ? ((displayRate - prev) / prev) * 100 : null,
      change1w: weekAgo ? ((displayRate - weekAgo) / weekAgo) * 100 : null,
      change1m: monthAgo ? ((displayRate - monthAgo) / monthAgo) * 100 : null,
      spark,
    };
  });

  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'Frankfurter API (ECB reference rates)',
      referenceDate: latest.date,
      pairs: fxData,
    }),
  );

  for (const p of fxData) {
    console.log(
      `  ok   ${p.label.padEnd(18)} ${p.rate.toFixed(p.key.includes('KRW') ? 2 : 4)} ` +
        `${p.change1d !== null ? `1d: ${p.change1d >= 0 ? '+' : ''}${p.change1d.toFixed(2)}%` : ''}`
    );
  }
  console.log(`\nfx.json written — ${fxData.length} pairs`);
}

main().catch((err) => {
  console.error('collect-fx failed:', err);
  process.exit(1);
});
