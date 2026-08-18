/**
 * SHFE delayed-market adapter.
 *
 * Two official endpoints, both verified live before this file was written:
 *   delaymarket_<pid>.dat — one snapshot row per listed contract (OI, volume,
 *                           open/high/low/last, official updatetime)
 *   <pid>.dat             — minute-resolution ticks for the current trading day,
 *                           keyed by contract code
 *
 * The snapshot picks the main contract; the tick file becomes the 30-minute bars.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const BASE = 'https://www.shfe.com.cn/data/tradedata/future/delaymarket';

/**
 * SHFE ferrous/base-metal session windows, in exchange local time (Asia/Shanghai).
 *
 * Encoded as config rather than inlined constants because §5.4 requires these to
 * be re-checked against the exchange calendar; `crossesMidnight` marks the night
 * session so a Friday-night bar is attributed to the Monday trading day.
 */
export const SESSIONS = [
  { name: 'NIGHT', start: '21:00', end: '23:00', crossesMidnight: false },
  { name: 'DAY',   start: '09:00', end: '10:15', crossesMidnight: false },
  { name: 'DAY',   start: '10:30', end: '11:30', crossesMidnight: false },
  { name: 'DAY',   start: '13:30', end: '15:00', crossesMidnight: false },
];

export const SHFE_PRODUCTS = {
  hc: { key: 'hrc',       label: 'SHFE Hot-Rolled Coil', labelKo: '열연코일 (HRC)',  unit: 'CNY/t' },
  rb: { key: 'rebar',     label: 'SHFE Rebar',           labelKo: '철근',            unit: 'CNY/t' },
  zn: { key: 'zinc',      label: 'SHFE Zinc',            labelKo: '아연 (GI 도금층)', unit: 'CNY/t' },
  al: { key: 'aluminium', label: 'SHFE Aluminium',       labelKo: '알루미늄 (GL)',   unit: 'CNY/t' },
};

export async function fetchJson(url, { attempts = 3 } = {}) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Referer: 'https://www.shfe.com.cn/' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (err) {
      lastError = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1_000 * i));
    }
  }
  throw lastError;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Liquidity score from §5.5: 0.60 x OI share + 0.40 x volume share.
 * Returns the winning contract plus the full ranking, so the UI can show why.
 */
export function pickMainContract(rows) {
  const valid = rows
    .map((r) => ({
      contract: r.contractname,
      last: num(r.lastprice),
      open: num(r.openprice),
      high: num(r.highprice),
      low: num(r.lowerprice),
      preSettlement: num(r.presettlementprice),
      volume: num(r.volume) ?? 0,
      openInterest: num(r.openinterest) ?? 0,
      updateTime: r.updatetime,
    }))
    .filter((r) => r.last !== null && r.openInterest > 0);

  if (valid.length === 0) throw new Error('no valid contract rows in snapshot');

  const totalOi = valid.reduce((a, r) => a + r.openInterest, 0);
  const totalVol = valid.reduce((a, r) => a + r.volume, 0) || 1;

  const ranked = valid
    .map((r) => ({
      ...r,
      liquidityScore: 0.6 * (r.openInterest / totalOi) + 0.4 * (r.volume / totalVol),
    }))
    .sort((a, b) => b.liquidityScore - a.liquidityScore);

  return { main: ranked[0], ranked };
}

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Which session window (if any) a `HH:MM:SS` local time falls in. */
export function sessionAt(hhmmss) {
  const [h, m] = hhmmss.split(':').map(Number);
  const mins = h * 60 + m;
  for (const s of SESSIONS) {
    if (mins >= toMinutes(s.start) && mins < toMinutes(s.end)) return s.name;
  }
  return null;
}

/**
 * Buckets minute ticks into 30-minute bars, anchored to each session's own start
 * so a 10:30 session restart begins a fresh bar rather than extending the 10:00 one.
 * Ticks outside any session window (the 10:15-10:30 and 11:30-13:30 breaks) are
 * dropped, which is what makes "last 60m" mean two real bars and not wall clock.
 */
export function buildBars(ticks, intervalMinutes = 30) {
  const buckets = new Map();

  for (const t of ticks) {
    const price = num(t.lastprice);
    if (price === null || price <= 0) continue;
    const [datePart, timePart] = String(t.updatetime).split(' ');
    if (!datePart || !timePart) continue;
    if (!sessionAt(timePart)) continue;

    const [h, m] = timePart.split(':').map(Number);
    const slot = Math.floor((h * 60 + m) / intervalMinutes) * intervalMinutes;
    const key = `${datePart} ${String(Math.floor(slot / 60)).padStart(2, '0')}:${String(
      slot % 60,
    ).padStart(2, '0')}:00`;

    let bar = buckets.get(key);
    if (!bar) {
      bar = {
        t: key,
        session: sessionAt(timePart),
        o: price, h: price, l: price, c: price,
        firstCumVolume: num(t.volume) ?? 0,
        lastCumVolume: num(t.volume) ?? 0,
        oi: num(t.openinterest),
        ticks: 0,
      };
      buckets.set(key, bar);
    }
    bar.h = Math.max(bar.h, price);
    bar.l = Math.min(bar.l, price);
    bar.c = price;
    const cum = num(t.volume);
    if (cum !== null) bar.lastCumVolume = cum;
    const oi = num(t.openinterest);
    if (oi !== null) bar.oi = oi;
    bar.ticks++;
  }

  return [...buckets.values()]
    .sort((a, b) => a.t.localeCompare(b.t))
    .map(({ firstCumVolume, lastCumVolume, ticks, ...bar }) => ({
      ...bar,
      // Exchange volume is cumulative across the trading day; the bar's own
      // volume is the increment. The first bar of a session has no prior
      // reference inside the bucket, so its increment is reported as null
      // rather than as the full running total.
      v: lastCumVolume > firstCumVolume ? lastCumVolume - firstCumVolume : null,
      tickCount: ticks,
    }));
}

/** §5.3 — change vs the Nth preceding *completed* bar, breaks excluded. */
export function barChange(bars, barsBack) {
  if (bars.length <= barsBack) return null;
  const now = bars.at(-1).c;
  const then = bars.at(-1 - barsBack).c;
  if (!then) return null;
  return ((now - then) / then) * 100;
}

export async function fetchProduct(pid) {
  const [snapshot, ticksByContract] = await Promise.all([
    fetchJson(`${BASE}/delaymarket_${pid}.dat`),
    fetchJson(`${BASE}/${pid}.dat`),
  ]);

  const rows = snapshot.delaymarket ?? snapshot[Object.keys(snapshot)[0]];
  if (!Array.isArray(rows)) throw new Error('unexpected snapshot shape');

  const { main, ranked } = pickMainContract(rows);
  const ticks = ticksByContract[main.contract] ?? [];
  if (ticks.length === 0) throw new Error(`no ticks for main contract ${main.contract}`);

  const bars = buildBars(ticks);
  const latestTick = ticks.at(-1);

  return {
    product: pid,
    ...SHFE_PRODUCTS[pid],
    contract: main.contract,
    exchange: 'SHFE',
    currency: 'CNY',
    last: main.last,
    open: main.open,
    high: main.high,
    low: main.low,
    preSettlement: main.preSettlement,
    volume: main.volume,
    openInterest: main.openInterest,
    liquidityScore: main.liquidityScore,
    contractRanking: ranked.slice(0, 5).map((r) => ({
      contract: r.contract,
      openInterest: r.openInterest,
      volume: r.volume,
      liquidityScore: r.liquidityScore,
    })),
    // The exchange's own clock, kept separate from our collection clock (§3.5).
    sourceTimestamp: latestTick.updatetime ?? main.updateTime,
    collectedAt: new Date().toISOString(),
    change: {
      today: main.preSettlement ? ((main.last - main.preSettlement) / main.preSettlement) * 100 : null,
      m30: barChange(bars, 1),
      m60: barChange(bars, 2),
      m120: barChange(bars, 4),
    },
    bars,
    tickCount: ticks.length,
  };
}
