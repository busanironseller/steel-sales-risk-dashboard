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

  // ── Product-specific domains (each gets its own News Digest theme) ──
  { domain: 'crc_market',    weight: 1.0, lang: 'en',
    q: 'when:7d ("cold rolled" OR CRC OR "cold-rolled coil") steel (price OR export OR import)' },
  { domain: 'crc_market',    weight: 0.9, lang: 'en',
    q: 'when:7d ("cold rolled steel" OR "flat steel") (automotive OR appliance OR demand OR supply OR market)' },
  { domain: 'crc_market',    weight: 0.9, lang: 'ko',
    q: 'when:7d (냉연 OR 냉연코일 OR 냉연강판) (가격 OR 시황 OR 수출 OR 수요)' },

  { domain: 'gi_market',     weight: 1.0, lang: 'en',
    q: 'when:7d (galvanized OR galvanised OR "hot-dip") steel (price OR export OR import OR tariff OR market)' },
  { domain: 'gi_market',     weight: 0.9, lang: 'en',
    q: 'when:7d ("hot-dip galvanized" OR HDG OR "zinc coated") steel (mill OR construction OR demand)' },
  { domain: 'gi_market',     weight: 0.9, lang: 'ko',
    q: 'when:7d (도금강판 OR 아연도금 OR 용융도금) (가격 OR 시황 OR 수출 OR 수요)' },

  { domain: 'gl_market',     weight: 1.0, lang: 'en',
    q: 'when:7d (galvalume OR "zinc-aluminium" OR "55% aluminium" OR "AZ150" OR aluzinc) steel' },
  { domain: 'gl_market',     weight: 0.9, lang: 'en',
    q: 'when:7d ("metal roofing" OR "steel roofing" OR "building panel") steel (market OR demand OR price)' },

  { domain: 'coated_steel',  weight: 1.0, lang: 'en',
    q: 'when:7d ("prepainted steel" OR PPGI OR "color coated" OR "colour coated" OR "pre-painted") steel' },
  { domain: 'coated_steel',  weight: 0.9, lang: 'en',
    q: 'when:7d ("coil coating" OR "painted steel" OR "coated coil") (market OR price OR export OR production)' },
  { domain: 'coated_steel',  weight: 0.9, lang: 'ko',
    q: 'when:7d (컬러강판 OR 도장강판 OR 프리코트) (가격 OR 시황 OR 수출 OR 생산)' },

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

  // ── Geopolitical / Global event radar (AI analysis target) ──
  { domain: 'geopolitics_asia', weight: 0.6, lang: 'en',
    q: 'when:7d ("Taiwan Strait" OR "cross-strait" OR "South China Sea" OR "East China Sea") (military OR tension OR conflict OR blockade)' },
  { domain: 'geopolitics_asia', weight: 0.6, lang: 'ko',
    q: 'when:7d (양안 OR 대만해협 OR 남중국해 OR 동중국해) (군사 OR 긴장 OR 분쟁 OR 봉쇄)' },
  { domain: 'geopolitics_korea', weight: 0.6, lang: 'en',
    q: 'when:7d ("North Korea" OR "Korean peninsula") (missile OR nuclear OR tension OR military OR sanctions)' },
  { domain: 'geopolitics_korea', weight: 0.6, lang: 'ko',
    q: 'when:7d (북한 OR 한반도 OR 미사일 OR 핵) (긴장 OR 제재 OR 도발 OR 군사)' },
  { domain: 'geopolitics_global', weight: 0.5, lang: 'en',
    q: 'when:7d (Russia OR Ukraine OR NATO) (war OR sanctions OR energy OR gas OR oil)' },
  { domain: 'geopolitics_global', weight: 0.5, lang: 'en',
    q: 'when:7d ("Panama Canal" OR "Suez Canal" OR "Malacca Strait") (disruption OR drought OR delay OR closure)' },
  { domain: 'natural_disaster', weight: 0.5, lang: 'en',
    q: 'when:7d (earthquake OR typhoon OR flood OR drought) (supply chain OR port OR factory OR production OR shipping)' },
  { domain: 'currency_crisis', weight: 0.5, lang: 'en',
    q: 'when:7d ("currency crisis" OR devaluation OR "capital flight" OR "forex reserve") (emerging OR Asia OR Turkey OR trade)' },
  { domain: 'currency_crisis', weight: 0.5, lang: 'ko',
    q: 'when:7d (환율급등 OR 외환위기 OR 자본유출 OR 통화가치) (신흥국 OR 아시아 OR 수출)' },
];

/**
 * Broad discovery feeds — Google News topic-based RSS.
 * These are NOT keyword-filtered: they return top stories in each category.
 * The AI TRIAGE layer decides which are steel-business-relevant.
 * Topic IDs are stable Google News identifiers (verified August 2026).
 */
export const BROAD_FEEDS = [
  { domain: 'broad_world', weight: 0.3, lang: 'en', label: 'World News',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en' },
  { domain: 'broad_business', weight: 0.3, lang: 'en', label: 'Business News',
    url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en' },
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
