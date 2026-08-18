/**
 * The approved causal rule graph (§10.2).
 *
 * Nothing outside this file may create a causal path. AI-proposed paths are
 * surfaced separately and never feed severity until a human promotes them here.
 *
 * Each rule states: what triggers it, the chain it asserts, which products and
 * regions it lands on, and what a salesperson should do about it. `direction`
 * is the effect on *our* cost/risk, not on the underlying price.
 */

export const PRODUCTS = ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'];

/** Steel value chain used to explain why a substrate move reaches coated products. */
export const VALUE_CHAIN = [
  ['HRC', 'CRC', 'GI', 'COLOR'],
  ['HRC', 'CRC', 'GL', 'COLOR'],
];

export const SEVERITY = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Market-signal thresholds (§6). Tuned to the 30-minute bar grid: `bars` counts
 * completed bars, so `m120` is four bars and session breaks never inflate it.
 */
export const MARKET_THRESHOLDS = {
  hrc: [
    { window: 'm120', abs: 0.8, severity: 'HIGH' },
    { window: 'm60',  abs: 0.4, severity: 'MEDIUM' },
    { window: 'today', abs: 1.0, severity: 'HIGH' },
    { window: 'today', abs: 0.3, severity: 'MEDIUM' },
  ],
  zinc: [
    { window: 'today', abs: 1.0, severity: 'HIGH' },
    { window: 'today', abs: 0.3, severity: 'MEDIUM' },
  ],
  aluminium: [
    { window: 'today', abs: 1.0, severity: 'HIGH' },
    { window: 'today', abs: 0.3, severity: 'MEDIUM' },
  ],
  ironOre: [
    { window: 'today', abs: 0.5, severity: 'MEDIUM' },
  ],
  cokingCoal: [
    { window: 'today', abs: 0.5, severity: 'MEDIUM' },
  ],
  rebar: [
    { window: 'today', abs: 0.5, severity: 'LOW' },
  ],
};

export const RULES = [
  {
    id: 'R1_HRC_TO_COATED',
    name: 'China HRC futures → coated offer pressure',
    trigger: { kind: 'market', instrument: 'hrc' },
    chain: [
      'China HRC futures move',
      'Chinese mill price expectation shifts',
      'CRC cost base shifts',
      'GI / GL / Color offer pressure',
      'Quotation validity & renegotiation risk',
    ],
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['China', 'Asia', 'Korea Export'],
    riskType: 'Mill Offer',
    // Rising substrate = rising cost to us = risk up.
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: [
        'Reconfirm open mill offers and their validity dates',
        'Review unconfirmed GI/Color quotations for renegotiation exposure',
        'Prioritise pending bookings before offers are withdrawn',
      ],
      DOWN: [
        'Hold back new fixed offers — buyers will expect the decline to pass through',
        'Re-check cost basis on quotations issued in the last 48 hours',
      ],
    },
  },
  {
    id: 'R2_MILL_OFFER',
    name: 'China mill offer hike → Asia reference offer',
    trigger: { kind: 'news', domains: ['china_supply', 'steel_price'], keywords: ['offer', 'price hike', 'increase', 'raise', '인상'] },
    chain: [
      'Chinese mill raises published offer',
      'Asia steel reference offer resets higher',
      'Open quotations require reconfirmation',
    ],
    products: ['CRC', 'GI', 'COLOR'],
    regions: ['China', 'Asia'],
    riskType: 'Mill Offer',
    directionFrom: () => 'UP',
    actions: { UP: ['Reconfirm all open quotations against the new reference offer'] },
  },
  {
    id: 'R3_RAWMAT',
    name: 'Iron ore / coking coal → integrated mill cost',
    trigger: { kind: 'market', instrument: ['ironOre', 'cokingCoal'] },
    chain: [
      'Iron ore / coking coal move',
      'Integrated mill cost pressure',
      'HRC / CRC offer pressure',
    ],
    products: ['CRC', 'GI', 'GL'],
    regions: ['China', 'Asia'],
    riskType: 'Raw Material',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    lagNote: 'Upstream cost leads substrate offers by weeks, not days.',
    actions: {
      UP: ['Flag medium-term cost pressure to pricing before next offer cycle'],
      DOWN: ['Expect buyer pushback on offers priced off older raw-material costs'],
    },
  },
  {
    id: 'R4_COATING_METAL',
    name: 'Zinc / aluminium → coating cost',
    trigger: { kind: 'market', instrument: ['zinc', 'aluminium'] },
    chain: [
      'Zinc / aluminium price move',
      'Coating bath cost per tonne shifts',
      'GI / GL conversion cost shifts',
      'Coated product margin pressure',
    ],
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Korea Export', 'Asia'],
    riskType: 'Coating Cost',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Recalculate GI/GL coating extras before issuing new offers'],
      DOWN: ['Coating extras may be a competitive lever on open negotiations'],
    },
  },
  {
    id: 'R5_OIL_FREIGHT',
    name: 'Crude oil → bunker → ocean freight → CIF',
    trigger: { kind: 'news', domains: ['energy', 'logistics'], keywords: ['crude', 'oil price', 'bunker', 'fuel'] },
    chain: [
      'Crude oil rises',
      'Bunker cost rises',
      'Ocean freight rises',
      'CIF competitiveness falls',
    ],
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'GCC', 'Korea Export'],
    riskType: 'Freight',
    directionFrom: () => 'UP',
    actions: { UP: ['Request updated freight quotations before confirming CIF offers'] },
  },
  {
    id: 'R6_STRAIT_DISRUPTION',
    name: 'Hormuz / Red Sea / Suez disruption → delivered cost',
    trigger: {
      kind: 'news',
      domains: ['logistics', 'geopolitics'],
      keywords: ['hormuz', 'red sea', 'suez', 'strait', 'rerouting', 'marine insurance', 'attack', 'houthi'],
    },
    chain: [
      'Route disruption reported',
      'Rerouting and longer transit',
      'Marine insurance premium rises',
      'Freight and delivered cost rise',
      'GCC / Asia → Europe competitiveness shifts',
    ],
    products: ['GI', 'GL', 'COLOR'],
    regions: ['Europe', 'GCC', 'Korea Export'],
    riskType: 'Logistics',
    directionFrom: () => 'UP',
    actions: [
      'Request updated freight and marine insurance quotations',
      'Review EU offers carrying long validity periods',
      'Check ETD/ETA exposure on shipments routed via the affected corridor',
    ],
  },
  {
    id: 'R7_PORT',
    name: 'Port closure → delay → demurrage → cancellation risk',
    trigger: { kind: 'news', domains: ['logistics'], keywords: ['port closure', 'congestion', 'strike', 'berth', 'demurrage'] },
    chain: ['Port disruption', 'Delay', 'Demurrage exposure', 'ETD / ETA risk', 'Cancellation risk'],
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Asia', 'Europe', 'US'],
    riskType: 'Logistics',
    directionFrom: () => 'UP',
    actions: ['Verify ETD/ETA on affected shipments and notify customers early'],
  },
  {
    id: 'R8_TRADE_REMEDY',
    name: 'AD / CVD / Safeguard / Tariff → origin competitiveness',
    trigger: {
      kind: 'news',
      domains: ['trade_policy'],
      keywords: ['anti-dumping', 'antidumping', 'countervailing', 'safeguard', 'tariff', 'quota', 'cbam', '반덤핑'],
    },
    chain: [
      'Trade remedy action announced',
      'Import cost or available volume changes',
      'Origin competitiveness re-ranks',
      'Contract routing may need to change',
    ],
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'US', 'Asia', 'Korea Export'],
    riskType: 'Trade Policy',
    directionFrom: () => 'UP',
    actions: [
      'Check whether affected origins appear in open offers or contracts',
      'Confirm mill certificates and melt-and-pour evidence for the destination',
    ],
  },
  {
    id: 'R9_SANCTION',
    name: 'Sanction → payment / shipping / insurance restriction',
    trigger: { kind: 'news', domains: ['geopolitics', 'trade_policy'], keywords: ['sanction', 'export control', 'embargo', 'blacklist'] },
    chain: [
      'Sanction or export control announced',
      'Payment, shipping or insurance channel restricted',
      'Contract execution risk',
    ],
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'GCC', 'US'],
    riskType: 'Sanction',
    directionFrom: () => 'UP',
    actions: ['Screen counterparties and banks on affected contracts before shipment'],
  },
];

/**
 * Steel-domain vocabulary used to score whether an article belongs on this
 * dashboard at all. Without this the news queries pull in things like a fashion
 * label's "gold coated" release, which matched `coated_steel` on wording alone.
 */
export const RELEVANCE_TERMS = {
  strong: [
    'steel', 'hrc', 'hot-rolled', 'hot rolled', 'cold-rolled', 'cold rolled', 'coil',
    'galvanized', 'galvanised', 'galvalume', 'ppgi', 'prepainted', 'color coated',
    'colour coated', 'iron ore', 'coking coal', 'billet', 'rebar', 'mill', 'smelter',
    'blast furnace', 'metallurgical', '철강', '열연', '냉연', '도금', '컬러강판', '철광석', '원료탄',
  ],
  contextual: [
    'tariff', 'anti-dumping', 'antidumping', 'countervailing', 'safeguard', 'quota',
    'cbam', 'sanction', 'export control', 'freight', 'shipping', 'port', 'red sea',
    'hormuz', 'suez', 'container', 'bunker', 'crude', 'zinc', 'aluminium', 'aluminum',
    'nickel', 'scrap', 'export', 'import', '관세', '반덤핑', '운임', '수출',
  ],
  negative: [
    'fashion', 'collection', 'sneaker', 'jewelry', 'jewellery', 'watch', 'perfume',
    'album', 'movie', 'celebrity', 'recipe', 'cookware', 'guitar', 'lipstick',
  ],
};
