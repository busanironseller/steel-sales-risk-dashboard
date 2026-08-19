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
    label: 'SHFE Aluminium',        labelKo: '알루미늄 (GL/AL 도금층 원가)' },
  { key: 'ironOre',    symbol: 'I0',  exchange: 'DCE',  role: 'upstream',  unit: 'CNY/t',
    label: 'DCE Iron Ore',          labelKo: '철광석' },
  { key: 'cokingCoal', symbol: 'JM0', exchange: 'DCE',  role: 'upstream',  unit: 'CNY/t',
    label: 'DCE Coking Coal',       labelKo: '원료탄' },
];

/**
 * Google News RSS queries — one per risk domain × product / region slice.
 *
 * `when:7d` is load-bearing: without it Google returns relevance-ordered results
 * and months-old articles outrank today's, which would quietly poison every
 * "what changed" panel on the dashboard.
 *
 * §2 — Product-specific queries let rules emit signals that differentiate
 *       CRC vs GI vs GL vs COLOR when the user applies a product filter.
 * §3 — Region-specific queries enable rules that only fire for one market,
 *       so the Europe and GCC filters show genuinely different intelligence.
 */
export const NEWS_QUERIES = [
  // ── General steel / price ──
  { domain: 'steel_price',   weight: 1.0, lang: 'en',
    q: 'when:7d (HRC OR "hot-rolled coil" OR "steel price") (mill OR export OR offer)' },
  { domain: 'raw_material',  weight: 0.9, lang: 'en',
    q: 'when:7d ("iron ore" OR "coking coal" OR zinc OR aluminium) price (steel OR smelter)' },

  // ── Product-specific domains ──
  { domain: 'crc_market',    weight: 1.0, lang: 'en',
    q: 'when:7d ("cold rolled" OR CRC OR "cold-rolled coil") steel (price OR export OR import)' },
  { domain: 'gi_market',     weight: 1.0, lang: 'en',
    q: 'when:7d (galvanized OR galvanised OR "hot-dip" OR "GI steel") (price OR export OR import OR tariff)' },
  { domain: 'gl_market',     weight: 1.0, lang: 'en',
    q: 'when:7d (galvalume OR "zinc-aluminium" OR "55% aluminium" OR "AZ150") steel' },
  { domain: 'coated_steel',  weight: 1.0, lang: 'en',
    q: 'when:7d ("prepainted steel" OR PPGI OR "color coated" OR "colour coated" OR "pre-painted")' },

  // ── Coating metals (product-specific upstream) ──
  { domain: 'zinc_market',   weight: 0.9, lang: 'en',
    q: 'when:7d zinc (price OR LME OR SHFE OR supply OR deficit OR surplus) metal' },
  { domain: 'aluminium_market', weight: 0.9, lang: 'en',
    q: 'when:7d (aluminium OR aluminum) (price OR LME OR SHFE OR supply OR smelter) metal' },

  // ── Trade policy (general + region-specific) ──
  { domain: 'trade_policy',  weight: 1.0, lang: 'en',
    q: 'when:7d (anti-dumping OR countervailing OR safeguard OR tariff OR quota) steel' },
  { domain: 'trade_policy',  weight: 1.0, lang: 'en',
    q: 'when:7d ("Section 232" OR "Section 338" OR "Section 301") (steel OR aluminum OR tariff)' },
  { domain: 'eu_steel_trade', weight: 1.0, lang: 'en',
    q: 'when:7d EU (steel OR metals) (safeguard OR quota OR "anti-dumping" OR import OR CBAM)' },
  { domain: 'us_steel_trade', weight: 1.0, lang: 'en',
    q: 'when:7d US (steel OR metals) (import OR tariff OR "Section 232" OR Korea OR "trade deal")' },
  { domain: 'asia_steel_trade', weight: 1.0, lang: 'en',
    q: 'when:7d (ASEAN OR "Southeast Asia" OR Vietnam OR Indonesia OR Thailand OR Philippines) steel (import OR "anti-dumping" OR safeguard OR tariff)' },

  // ── China supply & export ──
  { domain: 'china_supply',  weight: 1.0, lang: 'en',
    q: 'when:7d China steel (export OR rebate OR "production cut" OR capacity)' },
  { domain: 'china_export_flood', weight: 1.0, lang: 'en',
    q: 'when:7d China steel (overcapacity OR dumping OR surplus OR flood) (Asia OR Europe OR global OR export)' },

  // ── Competitor origins ──
  { domain: 'competitor_turkey', weight: 0.9, lang: 'en',
    q: 'when:7d Turkey steel (export OR mill OR production OR galvanized OR price)' },
  { domain: 'competitor_india', weight: 0.9, lang: 'en',
    q: 'when:7d India steel (export OR mill OR production OR galvanized OR price)' },
  { domain: 'competitor_vietnam', weight: 0.9, lang: 'en',
    q: 'when:7d Vietnam steel (export OR production OR capacity OR mill)' },

  // ── GCC / Middle East market ──
  { domain: 'gcc_steel_market', weight: 0.9, lang: 'en',
    q: 'when:7d ("Middle East" OR GCC OR Saudi OR UAE OR Gulf) (steel OR construction) (demand OR project OR import)' },

  // ── Energy & logistics ──
  { domain: 'energy',        weight: 0.7, lang: 'en',
    q: 'when:7d (electricity OR "natural gas" OR "energy cost") (steel OR smelter OR mill)' },
  { domain: 'energy',        weight: 0.8, lang: 'en',
    q: 'when:7d ("oil price" OR "crude oil" OR Brent OR WTI) (shipping OR supply OR risk)' },
  { domain: 'logistics',     weight: 0.8, lang: 'en',
    q: 'when:7d (freight OR "container rate" OR "Red Sea" OR "port congestion") shipping' },
  { domain: 'logistics',     weight: 0.9, lang: 'en',
    q: 'when:7d ("Strait of Hormuz" OR Hormuz OR Houthi OR "Red Sea") (shipping OR attack OR disruption)' },
  { domain: 'geopolitics',   weight: 0.8, lang: 'en',
    q: 'when:7d (sanctions OR "export control" OR conflict) (steel OR metals OR shipping)' },
  { domain: 'geopolitics',   weight: 0.9, lang: 'en',
    q: 'when:7d (Iran OR "Middle East") (war OR conflict OR shipping OR oil OR sanctions)' },

  // ── Korean-language ──
  { domain: 'korea_steel',   weight: 1.0, lang: 'ko',
    q: 'when:7d (철강 OR 도금강판 OR 컬러강판 OR 열연) (가격 OR 수출 OR 반덤핑)' },
  { domain: 'korea_steel',   weight: 0.9, lang: 'ko',
    q: 'when:7d (관세 OR 무역전쟁 OR 호르무즈 OR 이란) (철강 OR 수출 OR 해운)' },
  { domain: 'korea_steel',   weight: 0.9, lang: 'ko',
    q: 'when:7d (포스코 OR 현대제철 OR 동국제강) (수출 OR 생산 OR 가격 OR 실적)' },

  // ── Macro / Event Radar — broad news for daily briefing ──
  { domain: 'macro_politics', weight: 0.5, lang: 'en',
    q: 'when:7d (Trump OR "trade war" OR tariff OR "executive order") (steel OR metals OR trade OR manufacturing)' },
  { domain: 'macro_politics', weight: 0.5, lang: 'en',
    q: 'when:7d (China OR Xi OR PBOC OR "Belt and Road") (economy OR stimulus OR manufacturing OR export OR policy)' },
  { domain: 'macro_economy', weight: 0.5, lang: 'en',
    q: 'when:7d (PMI OR GDP OR inflation OR "interest rate" OR "central bank") (manufacturing OR steel OR construction)' },
  { domain: 'macro_economy', weight: 0.5, lang: 'en',
    q: 'when:7d ("supply chain" OR semiconductor OR EV OR "electric vehicle") (steel OR metals OR demand)' },
  { domain: 'macro_japan', weight: 0.5, lang: 'en',
    q: 'when:7d (Japan OR BOJ OR Nippon) (steel OR yen OR trade OR export OR economy)' },
  { domain: 'macro_japan', weight: 0.5, lang: 'ko',
    q: 'when:7d (일본 OR 엔화 OR 다카이치 OR 일본은행) (철강 OR 경제 OR 무역 OR 수출)' },
  { domain: 'macro_kr_economy', weight: 0.6, lang: 'ko',
    q: 'when:7d (환율 OR 원달러 OR 수출 OR 경기) (철강 OR 제조업 OR 산업)' },
  { domain: 'macro_construction', weight: 0.5, lang: 'en',
    q: 'when:7d (construction OR infrastructure OR housing OR "real estate") (steel OR demand OR investment) (Asia OR Middle East OR global)' },
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
