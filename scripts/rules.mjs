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
    nameKo: '중국 HRC 선물 변동 → 도금강판 오퍼 압력',
    trigger: { kind: 'market', instrument: 'hrc' },
    chain: [
      'China HRC futures move',
      'Chinese mill price expectation shifts',
      'CRC cost base shifts',
      'GI / GL / Color offer pressure',
      'Quotation validity & renegotiation risk',
    ],
    chainKo: [
      '중국 HRC 선물 급변',
      '중국 제철소 가격 기대 변동',
      'CRC 원가 기반 이동',
      'GI/GL/컬러 오퍼가 연동 압력',
      '기존 견적 유효성 · 재협상 리스크',
    ],
    narrativeKo: {
      UP: '중국 열연 선물이 오르면 → 제철소 CRC 오퍼가 올라가고 → 도금·컬러 제품 원가도 따라 상승합니다. 지금 나간 견적의 유효성이 흔들릴 수 있습니다.',
      DOWN: '중국 열연 선물이 하락하면 → 바이어가 가격 인하를 기대합니다. 기발행 견적 대비 시장 괴리가 커져 재협상 압력이 높아집니다.',
    },
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['China', 'Asia', 'Korea Export'],
    riskType: 'Mill Offer',
    riskTypeKo: '제철소 오퍼',
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
    actionsKo: {
      UP: [
        '미확정 제철소 오퍼의 유효 기간을 재확인하세요',
        '미체결 GI/컬러 견적의 재협상 노출을 점검하세요',
        '오퍼 철회 전에 대기 중인 부킹을 우선 확정하세요',
      ],
      DOWN: [
        '신규 고정가 오퍼 발행을 보류하세요 — 바이어가 하락분 반영을 요구합니다',
        '최근 48시간 내 발행한 견적의 원가 기준을 재점검하세요',
      ],
    },
  },
  {
    id: 'R2_MILL_OFFER',
    name: 'China mill offer hike → Asia reference offer',
    nameKo: '중국 제철소 가격 인상 → 아시아 기준가 상승',
    trigger: { kind: 'news', domains: ['china_supply', 'steel_price'], keywords: ['offer', 'price hike', 'increase', 'raise', '인상'] },
    chain: [
      'Chinese mill raises published offer',
      'Asia steel reference offer resets higher',
      'Open quotations require reconfirmation',
    ],
    chainKo: [
      '중국 제철소 공표 오퍼 인상',
      '아시아 철강 기준가 상향 조정',
      '기존 견적 재확인 필요',
    ],
    narrativeKo: {
      UP: '중국 주요 제철소(보강, 마강 등)가 오퍼를 올리면 → 아시아 전체의 기준가격이 재설정됩니다. 이미 나간 CRC/GI/컬러 견적을 새 기준가 대비 재확인해야 합니다.',
    },
    products: ['CRC', 'GI', 'COLOR'],
    regions: ['China', 'Asia'],
    riskType: 'Mill Offer',
    riskTypeKo: '제철소 오퍼',
    directionFrom: () => 'UP',
    actions: { UP: ['Reconfirm all open quotations against the new reference offer'] },
    actionsKo: { UP: ['새 기준가 대비 모든 미체결 견적을 재확인하세요'] },
  },
  {
    id: 'R3_RAWMAT',
    name: 'Iron ore / coking coal → integrated mill cost',
    nameKo: '철광석·원료탄 변동 → 일관제철 원가 압력',
    trigger: { kind: 'market', instrument: ['ironOre', 'cokingCoal'] },
    chain: [
      'Iron ore / coking coal move',
      'Integrated mill cost pressure',
      'HRC / CRC offer pressure',
    ],
    chainKo: [
      '철광석 / 원료탄 가격 변동',
      '일관제철소 원가 압력 발생',
      'HRC → CRC 오퍼가 연쇄 압력',
    ],
    narrativeKo: {
      UP: '철광석·원료탄이 오르면 → 일관제철소(고로) 생산 원가가 올라 → 수 주 후 HRC·CRC 오퍼에 반영됩니다. 당장은 아니지만 중기 원가 상승 신호입니다.',
      DOWN: '원재료 하락 → 바이어가 이전 원가 기반 오퍼에 저항합니다. 재협상 압력에 대비하세요.',
    },
    products: ['CRC', 'GI', 'GL'],
    regions: ['China', 'Asia'],
    riskType: 'Raw Material',
    riskTypeKo: '원재료',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    lagNote: 'Upstream cost leads substrate offers by weeks, not days.',
    lagNoteKo: '원재료 원가는 기판 오퍼보다 수 주 앞서 움직입니다.',
    actions: {
      UP: ['Flag medium-term cost pressure to pricing before next offer cycle'],
      DOWN: ['Expect buyer pushback on offers priced off older raw-material costs'],
    },
    actionsKo: {
      UP: ['다음 오퍼 사이클 전 중기 원가 상승 압력을 가격 팀에 알리세요'],
      DOWN: ['이전 원재료 원가 기반 오퍼에 대한 바이어 저항을 예상하세요'],
    },
  },
  {
    id: 'R4_COATING_METAL',
    name: 'Zinc / aluminium → coating cost',
    nameKo: '아연·알루미늄 변동 → 도금 원가 변동',
    trigger: { kind: 'market', instrument: ['zinc', 'aluminium'] },
    chain: [
      'Zinc / aluminium price move',
      'Coating bath cost per tonne shifts',
      'GI / GL conversion cost shifts',
      'Coated product margin pressure',
    ],
    chainKo: [
      '아연 / 알루미늄 가격 변동',
      '도금 욕조 원가(톤당) 변동',
      'GI / GL 가공비 변동',
      '도금 제품 마진 압박',
    ],
    narrativeKo: {
      UP: '아연·알루미늄이 오르면 → GI/GL 도금 원가(코팅 엑스트라)가 직접 상승합니다. 신규 오퍼 발행 전 코팅 할증 재계산이 필수입니다.',
      DOWN: '도금 원재료 하락 → 코팅 엑스트라를 경쟁 무기로 활용할 여지가 생깁니다.',
    },
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Korea Export', 'Asia'],
    riskType: 'Coating Cost',
    riskTypeKo: '도금 원가',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Recalculate GI/GL coating extras before issuing new offers'],
      DOWN: ['Coating extras may be a competitive lever on open negotiations'],
    },
    actionsKo: {
      UP: ['신규 오퍼 발행 전 GI/GL 코팅 엑스트라를 재계산하세요'],
      DOWN: ['코팅 엑스트라 인하를 협상 카드로 활용할 수 있습니다'],
    },
  },
  {
    id: 'R5_OIL_FREIGHT',
    name: 'Crude oil → bunker → ocean freight → CIF',
    nameKo: '유가 상승 → 벙커유 → 해상운임 → CIF 경쟁력 약화',
    trigger: { kind: 'news', domains: ['energy', 'logistics'], keywords: ['crude', 'oil price', 'bunker', 'fuel'] },
    chain: [
      'Crude oil rises',
      'Bunker cost rises',
      'Ocean freight rises',
      'CIF competitiveness falls',
    ],
    chainKo: [
      '국제 유가 상승',
      '벙커유(선박 연료) 원가 상승',
      '해상 운임 상승',
      'CIF 기준 수출 경쟁력 약화',
    ],
    narrativeKo: {
      UP: '유가가 오르면 → 벙커유·해상운임이 오르고 → CIF 가격이 올라 수출 경쟁력이 약화됩니다. 유럽·GCC 향 CIF 오퍼에 직접 영향합니다.',
    },
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'GCC', 'Korea Export'],
    riskType: 'Freight',
    riskTypeKo: '운임',
    directionFrom: () => 'UP',
    actions: { UP: ['Request updated freight quotations before confirming CIF offers'] },
    actionsKo: { UP: ['CIF 오퍼 확정 전 최신 운임 견적을 받으세요'] },
  },
  {
    id: 'R6_STRAIT_DISRUPTION',
    name: 'Hormuz / Red Sea / Suez disruption → delivered cost',
    nameKo: '호르무즈·홍해·수에즈 분쟁 → 운임·보험료 급등',
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
    chainKo: [
      '항로 분쟁 · 공격 보도',
      '우회 항로 전환, 운항 일수 증가',
      '해상 전쟁보험료 급등',
      '운임 + 도착가(CIF) 상승',
      'GCC·아시아 → 유럽 수출 경쟁력 변동',
    ],
    narrativeKo: {
      UP: '호르무즈 해협·홍해에서 선박 공격이나 항로 차단이 발생하면 → 우회 항로로 운항 일수가 늘고 → 전쟁보험료(War Risk Premium)가 급등하며 → CIF 가격이 올라 유럽·GCC 향 수출 채산성이 악화됩니다.',
    },
    products: ['GI', 'GL', 'COLOR'],
    regions: ['Europe', 'GCC', 'Korea Export'],
    riskType: 'Logistics',
    riskTypeKo: '물류·해운',
    directionFrom: () => 'UP',
    actions: [
      'Request updated freight and marine insurance quotations',
      'Review EU offers carrying long validity periods',
      'Check ETD/ETA exposure on shipments routed via the affected corridor',
    ],
    actionsKo: [
      '최신 운임 및 전쟁보험료 견적을 받으세요',
      '유효 기간이 긴 유럽 향 오퍼를 재점검하세요',
      '영향 항로 경유 선적의 ETD/ETA 노출을 확인하세요',
    ],
  },
  {
    id: 'R7_PORT',
    name: 'Port closure → delay → demurrage → cancellation risk',
    nameKo: '항만 폐쇄·파업 → 지연 → 체선료 → 계약 취소 위험',
    trigger: { kind: 'news', domains: ['logistics'], keywords: ['port closure', 'congestion', 'strike', 'berth', 'demurrage'] },
    chain: ['Port disruption', 'Delay', 'Demurrage exposure', 'ETD / ETA risk', 'Cancellation risk'],
    chainKo: ['항만 운영 중단', '선적 지연', '체선료(Demurrage) 노출', 'ETD/ETA 리스크', '계약 취소 위험'],
    narrativeKo: {
      UP: '항만 파업·폐쇄가 발생하면 → 선적이 지연되고 → 체선료가 발생하며 → 바이어의 인도 일정이 어긋나 계약 취소 위험까지 이어질 수 있습니다.',
    },
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Asia', 'Europe', 'US'],
    riskType: 'Logistics',
    riskTypeKo: '물류·해운',
    directionFrom: () => 'UP',
    actions: ['Verify ETD/ETA on affected shipments and notify customers early'],
    actionsKo: ['영향 받는 선적의 ETD/ETA를 확인하고 바이어에게 사전 통보하세요'],
  },
  {
    id: 'R8_TRADE_REMEDY',
    name: 'AD / CVD / Safeguard / Tariff → origin competitiveness',
    nameKo: '반덤핑·세이프가드·관세 → 원산지별 경쟁력 변동',
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
    chainKo: [
      '무역 구제 조치 발표',
      '수입 비용 또는 가용 물량 변동',
      '원산지별 경쟁력 순위 재편',
      '계약 루트 변경 필요 가능성',
    ],
    narrativeKo: {
      UP: '반덤핑 관세·세이프가드·Section 232/338 등이 발동되면 → 특정 원산지 제품의 수입 비용이 올라가고 → 원산지 간 경쟁력이 재편되며 → 기존 계약의 공급 루트를 변경해야 할 수 있습니다.',
    },
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'US', 'Asia', 'Korea Export'],
    riskType: 'Trade Policy',
    riskTypeKo: '통상 정책',
    directionFrom: () => 'UP',
    actions: [
      'Check whether affected origins appear in open offers or contracts',
      'Confirm mill certificates and melt-and-pour evidence for the destination',
    ],
    actionsKo: [
      '영향 받는 원산지가 미체결 오퍼·계약에 포함되어 있는지 확인하세요',
      '목적지용 제철소 인증서(Mill Certificate)와 용해·주조 증빙을 확인하세요',
    ],
  },
  {
    id: 'R9_SANCTION',
    name: 'Sanction → payment / shipping / insurance restriction',
    nameKo: '제재·수출통제 → 결제·선적·보험 제한',
    trigger: { kind: 'news', domains: ['geopolitics', 'trade_policy'], keywords: ['sanction', 'export control', 'embargo', 'blacklist'] },
    chain: [
      'Sanction or export control announced',
      'Payment, shipping or insurance channel restricted',
      'Contract execution risk',
    ],
    chainKo: [
      '제재 또는 수출통제 발표',
      '결제·선적·보험 채널 제한',
      '계약 이행 리스크 발생',
    ],
    narrativeKo: {
      UP: '제재·수출통제가 발동되면 → 해당 국가·기업과의 결제 채널이 막히고 → 선적 보험 확보가 어려워져 → 기존 계약 이행 자체가 불가능해질 수 있습니다.',
    },
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'GCC', 'US'],
    riskType: 'Sanction',
    riskTypeKo: '제재',
    directionFrom: () => 'UP',
    actions: ['Screen counterparties and banks on affected contracts before shipment'],
    actionsKo: ['선적 전 영향 받는 계약의 거래처·은행 제재 스크리닝을 실시하세요'],
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
    'nickel', 'scrap', 'export', 'import', 'section 232', 'section 338', 'section 301',
    'trade war', 'iran', 'houthi', 'strait', 'chokepoint', 'oil price', 'brent',
    'marine insurance', 'war risk', 'conflict', 'ceasefire', 'rerouting',
    '관세', '반덤핑', '운임', '수출', '무역전쟁', '호르무즈', '이란',
  ],
  negative: [
    'fashion', 'collection', 'sneaker', 'jewelry', 'jewellery', 'watch', 'perfume',
    'album', 'movie', 'celebrity', 'recipe', 'cookware', 'guitar', 'lipstick',
  ],
};
