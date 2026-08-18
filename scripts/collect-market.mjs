/**
 * Collects futures bars for every series in sources.mjs and writes data/market.json.
 *
 * Failure policy: a series that cannot be fetched or parsed is recorded in
 * `failures[]` and omitted from `series`. It is never backfilled, carried over,
 * or approximated — the UI is responsible for showing the gap.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { FUTURES, sinaUrl } from './sources.mjs';

const OUT = new URL('../data/market.json', import.meta.url);
const MIN_BARS_30M = 240;   // ~10 trading days
const MAX_BARS_30M = 720;   // ~30 trading days, keeps the payload small
const MAX_BARS_DAILY = 500; // ~2 years

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

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

/** Sina wraps the payload as `var _cb=([...]);` behind a redirect-guard comment. */
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

function normalizeBars(raw) {
  return raw
    .map((b) => ({
      t: b.d,
      o: num(b.o),
      h: num(b.h),
      l: num(b.l),
      c: num(b.c),
      v: num(b.v),
      oi: num(b.p),
    }))
    .filter((b) => b.t && b.o !== null && b.h !== null && b.l !== null && b.c !== null);
}

/** Percent change of the last close against the close `n` bars earlier. */
function pctChange(bars, n) {
  if (bars.length <= n) return null;
  const now = bars.at(-1).c;
  const then = bars.at(-1 - n).c;
  if (!then) return null;
  return ((now - then) / then) * 100;
}

/** Annualised stdev of daily log returns over the trailing window. */
function realizedVol(daily, window = 20) {
  if (daily.length < window + 1) return null;
  const slice = daily.slice(-(window + 1));
  const returns = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].c > 0 && slice[i].c > 0) {
      returns.push(Math.log(slice[i].c / slice[i - 1].c));
    }
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

async function collectSeries(spec) {
  const [minText, dayText] = await Promise.all([
    fetchText(sinaUrl(spec.symbol, '30m')),
    fetchText(sinaUrl(spec.symbol, 'daily')),
  ]);

  const bars30m = normalizeBars(parseJsonp(minText));
  const daily = normalizeBars(parseJsonp(dayText));

  if (bars30m.length < MIN_BARS_30M) {
    throw new Error(`only ${bars30m.length} 30m bars (min ${MIN_BARS_30M})`);
  }
  if (daily.length < 60) {
    throw new Error(`only ${daily.length} daily bars`);
  }

  const trimmed30m = bars30m.slice(-MAX_BARS_30M);
  const trimmedDaily = daily.slice(-MAX_BARS_DAILY);
  const last = trimmed30m.at(-1);

  return {
    ...spec,
    last: last.c,
    lastBarAt: last.t,
    lastDailyAt: trimmedDaily.at(-1).t,
    change: {
      // 30m bars: 1 bar, then ~1 session (16 bars) and ~1 week (80 bars)
      bar30m: pctChange(trimmed30m, 1),
      session: pctChange(trimmedDaily, 1),
      week: pctChange(trimmedDaily, 5),
      month: pctChange(trimmedDaily, 20),
      quarter: pctChange(trimmedDaily, 60),
    },
    volatility20d: realizedVol(trimmedDaily, 20),
    range52w: {
      high: Math.max(...trimmedDaily.slice(-252).map((b) => b.h)),
      low: Math.min(...trimmedDaily.slice(-252).map((b) => b.l)),
    },
    bars30m: trimmed30m,
    daily: trimmedDaily,
  };
}

async function main() {
  const startedAt = new Date().toISOString();
  const series = {};
  const failures = [];

  // Sequential on purpose — Sina throttles aggressively on parallel bursts.
  for (const spec of FUTURES) {
    try {
      series[spec.key] = await collectSeries(spec);
      const s = series[spec.key];
      console.log(
        `  ok   ${spec.key.padEnd(11)} ${String(s.last).padStart(9)} ${spec.unit}  ` +
          `(${s.bars30m.length} x 30m, last ${s.lastBarAt})`,
      );
    } catch (err) {
      failures.push({ key: spec.key, symbol: spec.symbol, error: String(err.message || err) });
      console.error(`  FAIL ${spec.key.padEnd(11)} ${err.message || err}`);
    }
  }

  if (Object.keys(series).length === 0) {
    throw new Error('every futures series failed — refusing to write an empty market.json');
  }

  // Preserve the previous file's timestamp so the UI can tell "stale" from "missing".
  let previousGeneratedAt = null;
  try {
    previousGeneratedAt = JSON.parse(await readFile(OUT, 'utf8')).generatedAt ?? null;
  } catch {
    /* first run */
  }

  await mkdir(new URL('../data/', import.meta.url), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      { generatedAt: startedAt, previousGeneratedAt, source: 'Sina Finance (SHFE/DCE)', series, failures },
      null,
      2,
    ),
  );

  console.log(
    `\nmarket.json written — ${Object.keys(series).length}/${FUTURES.length} series, ` +
      `${failures.length} failure(s)`,
  );
  // A partial collection is still useful; only a total wipeout is fatal (thrown above).
}

main().catch((err) => {
  console.error('collect-market failed:', err);
  process.exit(1);
});
