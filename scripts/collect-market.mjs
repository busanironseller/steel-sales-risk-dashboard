/**
 * Builds data/market.json.
 *
 * SHFE official is authoritative for everything it covers: it names the actual
 * contract, carries the exchange's own timestamp, and its tick file yields
 * session-correct 30-minute bars. Sina only fills the chart's history behind the
 * current trading day, and every bar records which source it came from so the UI
 * never implies official provenance for a backfilled bar.
 *
 * DCE products (iron ore, coking coal) have no SHFE equivalent and are Sina-only,
 * labelled as such.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchProduct, SHFE_PRODUCTS, sessionAt } from './shfe.mjs';
import { sinaUrl } from './sources.mjs';

const OUT = new URL('../public/data/market.json', import.meta.url);
const HISTORY_BARS = 480;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const DCE_PRODUCTS = [
  { key: 'ironOre',    symbol: 'I0',  label: 'DCE Iron Ore',    labelKo: '철광석',  unit: 'CNY/t' },
  { key: 'cokingCoal', symbol: 'JM0', label: 'DCE Coking Coal', labelKo: '원료탄',  unit: 'CNY/t' },
];

async function fetchText(url, { attempts = 3 } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn/' },
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

function parseJsonp(text) {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close <= open) throw new Error('no JSONP envelope');
  const parsed = JSON.parse(text.slice(open + 1, close));
  if (!Array.isArray(parsed)) throw new Error('payload is not an array');
  return parsed;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Sina stamps a 30-minute bar with a time inside the slot rather than its start,
 * so labels are floored onto the same grid the SHFE bars use before the two
 * series are put on one axis.
 */
function floorToSlot(stamp, minutes = 30) {
  const [datePart, timePart] = String(stamp).split(' ');
  if (!datePart || !timePart) return null;
  const [h, m] = timePart.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const slot = Math.floor((h * 60 + m) / minutes) * minutes;
  return `${datePart} ${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(slot % 60).padStart(2, '0')}:00`;
}

function normalizeSinaBars(raw, { source }) {
  const out = [];
  const seen = new Set();
  for (const b of raw) {
    const t = floorToSlot(b.d);
    if (!t || seen.has(t)) continue;
    const bar = { t, o: num(b.o), h: num(b.h), l: num(b.l), c: num(b.c), v: num(b.v), oi: num(b.p), source };
    // §22 validation — a bar that fails its own OHLC invariants is dropped, not drawn.
    if ([bar.o, bar.h, bar.l, bar.c].some((x) => x === null || x <= 0)) continue;
    if (bar.l > Math.min(bar.o, bar.c) || bar.h < Math.max(bar.o, bar.c)) continue;
    bar.session = sessionAt(t.split(' ')[1]) ?? 'UNKNOWN';
    seen.add(t);
    out.push(bar);
  }
  return out.sort((a, b) => a.t.localeCompare(b.t));
}

async function sinaSeries(symbol, kind) {
  return parseJsonp(await fetchText(sinaUrl(symbol, kind)));
}

/** SHFE bars win any timestamp collision; Sina only fills what precedes them. */
function mergeBars(history, official) {
  const officialFrom = official.length ? official[0].t : null;
  const kept = officialFrom ? history.filter((b) => b.t < officialFrom) : history;
  return [...kept, ...official].slice(-HISTORY_BARS);
}

async function collectShfe(pid) {
  const live = await fetchProduct(pid);
  const official = live.bars.map((b) => ({ ...b, source: 'SHFE' }));

  let history = [];
  let historySource = null;
  try {
    const sinaSymbol = `${pid.toUpperCase()}0`;
    history = normalizeSinaBars(await sinaSeries(sinaSymbol, '30m'), { source: 'SINA_BACKFILL' });
    historySource = 'Sina Finance (backfill)';
  } catch (err) {
    // A missing backfill costs chart history, not correctness — keep going.
    console.warn(`  warn ${pid}: history backfill failed (${err.message})`);
  }

  const daily = await sinaSeries(`${pid.toUpperCase()}0`, 'daily').catch(() => []);

  return {
    ...live,
    bars: mergeBars(history, official),
    officialBarCount: official.length,
    historySource,
    daily: normalizeSinaBars(
      daily.map((d) => ({ ...d, d: `${d.d} 00:00:00` })),
      { source: 'SINA_BACKFILL' },
    ).slice(-260),
    quality: 'OK',
  };
}

async function collectDce(spec) {
  const bars = normalizeSinaBars(await sinaSeries(spec.symbol, '30m'), { source: 'SINA' });
  const daily = normalizeSinaBars(
    (await sinaSeries(spec.symbol, 'daily')).map((d) => ({ ...d, d: `${d.d} 00:00:00` })),
    { source: 'SINA' },
  );
  if (bars.length === 0) throw new Error('no bars');

  const last = bars.at(-1);
  const prevClose = daily.length >= 2 ? daily.at(-2).c : null;
  const change = (n) => {
    if (bars.length <= n) return null;
    const then = bars.at(-1 - n).c;
    return then ? ((last.c - then) / then) * 100 : null;
  };

  return {
    ...spec,
    exchange: 'DCE',
    currency: 'CNY',
    contract: `${spec.symbol} (continuous main)`,
    last: last.c,
    open: null,
    high: Math.max(...bars.filter((b) => b.t.startsWith(last.t.slice(0, 10))).map((b) => b.h)),
    low: Math.min(...bars.filter((b) => b.t.startsWith(last.t.slice(0, 10))).map((b) => b.l)),
    preSettlement: prevClose,
    volume: last.v,
    openInterest: last.oi,
    sourceTimestamp: last.t,
    collectedAt: new Date().toISOString(),
    change: {
      today: prevClose ? ((last.c - prevClose) / prevClose) * 100 : null,
      m30: change(1),
      m60: change(2),
      m120: change(4),
    },
    bars: bars.slice(-HISTORY_BARS),
    officialBarCount: 0,
    historySource: 'Sina Finance',
    daily: daily.slice(-260),
    quality: 'DELAYED_UNOFFICIAL',
  };
}

async function main() {
  const instruments = {};
  const failures = [];

  for (const pid of Object.keys(SHFE_PRODUCTS)) {
    try {
      const r = await collectShfe(pid);
      instruments[r.key] = r;
      console.log(
        `  ok   ${r.key.padEnd(10)} ${r.contract.padEnd(8)} ${String(r.last).padStart(7)} ${r.unit}  ` +
          `${r.officialBarCount} official + ${r.bars.length - r.officialBarCount} backfill bars`,
      );
    } catch (err) {
      failures.push({ instrument: pid, source: 'SHFE', error: String(err.message || err) });
      console.error(`  FAIL ${pid.padEnd(10)} ${err.message || err}`);
    }
  }

  for (const spec of DCE_PRODUCTS) {
    try {
      const r = await collectDce(spec);
      instruments[r.key] = r;
      console.log(`  ok   ${r.key.padEnd(10)} ${String(r.last).padStart(16)} ${r.unit}  (Sina, ${r.bars.length} bars)`);
    } catch (err) {
      failures.push({ instrument: spec.key, source: 'SINA', error: String(err.message || err) });
      console.error(`  FAIL ${spec.key.padEnd(10)} ${err.message || err}`);
    }
  }

  if (!instruments.hrc) {
    throw new Error('HRC is the primary signal — refusing to write market.json without it');
  }

  await mkdir(new URL('../public/data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: {
          SHFE: 'Shanghai Futures Exchange — public delayed market data',
          SINA: 'Sina Finance futures API (unofficial, delayed)',
        },
        instruments,
        failures,
      },
      null,
      2,
    ),
  );

  console.log(`\nmarket.json — ${Object.keys(instruments).length} instruments, ${failures.length} failure(s)`);
}

main().catch((err) => {
  console.error('collect-market failed:', err);
  process.exit(1);
});
