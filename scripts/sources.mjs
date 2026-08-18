/**
 * Shared source definitions for the collectors.
 *
 * Every endpoint here was probed live before being committed. If one starts
 * failing the collector records the failure instead of substituting values —
 * the dashboard renders a gap, never an invented number.
 */

/** Sina futures JSONP endpoints (SHFE / DCE continuous-main contracts). */
export const SINA_BASE = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php';

/**
 * Futures series that actually move a coated-steel P&L.
 *
 * `role` drives how the rule engine reads a move: `substrate` is the CRC/GI/GL
 * base cost, `coating` is the zinc/aluminium bath, `upstream` is the mill's own
 * input cost (leads substrate by weeks, not days).
 */
export const FUTURES = [
  { key: 'hrc',        symbol: 'HC0', exchange: 'SHFE', role: 'substrate', unit: 'CNY/t',
    label: 'SHFE Hot-Rolled Coil',  labelKo: '중국 열연코일 (HRC)' },
  { key: 'rebar',      symbol: 'RB0', exchange: 'SHFE', role: 'substrate', unit: 'CNY/t',
    label: 'SHFE Rebar',            labelKo: '중국 철근 (건설 수요 프록시)' },
  { key: 'zinc',       symbol: 'ZN0', exchange: 'SHFE', role: 'coating',   unit: 'CNY/t',
    label: 'SHFE Zinc',             labelKo: '아연 (GI 도금층 원가)' },
  { key: 'aluminium',  symbol: 'AL0', exchange: 'SHFE', role: 'coating',   unit: 'CNY/t',
    label: 'SHFE Aluminium',        labelKo: '알루미늄 (GL 도금층 원가)' },
  { key: 'ironOre',    symbol: 'I0',  exchange: 'DCE',  role: 'upstream',  unit: 'CNY/t',
    label: 'DCE Iron Ore',          labelKo: '철광석' },
  { key: 'cokingCoal', symbol: 'JM0', exchange: 'DCE',  role: 'upstream',  unit: 'CNY/t',
    label: 'DCE Coking Coal',       labelKo: '원료탄' },
];

/**
 * Google News RSS queries, one per risk domain.
 *
 * `when:7d` is load-bearing: without it Google returns relevance-ordered results
 * and months-old articles outrank today's, which would quietly poison every
 * "what changed" panel on the dashboard.
 */
export const NEWS_QUERIES = [
  { domain: 'steel_price',   weight: 1.0, lang: 'en',
    q: 'when:7d (HRC OR "hot-rolled coil" OR "steel price") (mill OR export OR offer)' },
  { domain: 'coated_steel',  weight: 1.0, lang: 'en',
    q: 'when:7d (galvanized OR galvalume OR "prepainted steel" OR PPGI OR "color coated")' },
  { domain: 'raw_material',  weight: 0.9, lang: 'en',
    q: 'when:7d ("iron ore" OR "coking coal" OR zinc OR aluminium) price (steel OR smelter)' },
  { domain: 'trade_policy',  weight: 1.0, lang: 'en',
    q: 'when:7d (anti-dumping OR countervailing OR safeguard OR tariff OR quota) steel' },
  { domain: 'china_supply',  weight: 1.0, lang: 'en',
    q: 'when:7d China steel (export OR rebate OR "production cut" OR "capacity") ' },
  { domain: 'energy',        weight: 0.7, lang: 'en',
    q: 'when:7d (electricity OR "natural gas" OR "energy cost") (steel OR smelter OR mill)' },
  { domain: 'logistics',     weight: 0.8, lang: 'en',
    q: 'when:7d (freight OR "container rate" OR "Red Sea" OR "port congestion") shipping' },
  { domain: 'geopolitics',   weight: 0.8, lang: 'en',
    q: 'when:7d (sanctions OR "export control" OR conflict) (steel OR metals OR shipping)' },
  { domain: 'korea_steel',   weight: 1.0, lang: 'ko',
    q: 'when:7d (철강 OR 도금강판 OR 컬러강판 OR 열연) (가격 OR 수출 OR 반덤핑)' },
];

export const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search';

export function newsFeedUrl(query) {
  const locale =
    query.lang === 'ko'
      ? { hl: 'ko', gl: 'KR', ceid: 'KR:ko' }
      : { hl: 'en-US', gl: 'US', ceid: 'US:en' };
  const params = new URLSearchParams({ q: query.q, ...locale });
  return `${GOOGLE_NEWS_BASE}?${params.toString()}`;
}

export function sinaUrl(symbol, kind) {
  const service =
    kind === 'daily'
      ? `InnerFuturesNewService.getDailyKLine?symbol=${symbol}`
      : `InnerFuturesNewService.getFewMinLine?symbol=${symbol}&type=30`;
  // The callback name is echoed back verbatim; it only has to be a valid identifier.
  return `${SINA_BASE}/var%20_cb=/${service}`;
}
