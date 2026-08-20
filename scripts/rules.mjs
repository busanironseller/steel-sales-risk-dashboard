/**
 * The approved causal rule graph (§10.2 — expanded for product × region granularity).
 *
 * Nothing outside this file may create a causal path. AI-proposed paths are
 * surfaced separately and never feed severity until a human promotes them here.
 *
 * Each rule states: what triggers it, the chain it asserts, which products and
 * regions it lands on, and what a salesperson should do about it. `direction`
 * is the effect on *our* cost/risk, not on the underlying price.
 *
 * §2 — Product specificity: HRC affects CRC directly but reaches GI/GL
 *       only through the FH (Full-Hard) intermediate. Zinc affects GI
 *       directly, GL partially (45 % Zn in 55Al-45Zn alloy). Aluminium
 *       affects GL directly. These dependencies are reflected in separate
 *       rules so the product filter shows different intelligence.
 *
 * §3 — Region specificity: EU runs a safeguard quota; US levies Section 232
 *       tariffs; GCC has no trade barriers; ASEAN has selective anti-dumping.
 *       Competitor origins differ by region. Rules are split so the region
 *       filter surfaces the right risk for each market.
 *
 * Value chain (confirmed by domain expert):
 *   HRC → CRC → FH (Full-Hard) → coated (GI/GL/AL/ZM/GA) → COLOR (PPGI/PPGL/PPAL/…)
 *   - CRC: cold-rolled from HRC. Cost = f(HRC)
 *   - GI:  FH + pure zinc dip. Cost = f(HRC, Zinc)
 *   - GL:  FH + 55 %Al–45 %Zn alloy dip. Cost = f(HRC, Zinc, Aluminium)
 *   - AL:  FH + aluminium dip. Specialty — only 3–4 mills worldwide. Cost = f(HRC, Aluminium)
 *   - COLOR (umbrella): any coated substrate + paint. PPGI ⊂ COLOR.
 */

export const PRODUCTS = ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'];

/** Steel value chain used to explain why a substrate move reaches coated products. */
export const VALUE_CHAIN = [
  ['HRC', 'CRC', 'FH', 'GI', 'PPGI'],
  ['HRC', 'CRC', 'FH', 'GL', 'PPGL'],
  ['HRC', 'CRC', 'FH', 'AL', 'PPAL'],
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

// ═══════════════════════════════════════════════════════════════════════
//  RULES — 18 rules split by product × region for filter differentiation
// ═══════════════════════════════════════════════════════════════════════

export const RULES = [

  // ──────────────────── MARKET-TRIGGERED ────────────────────

  // R1A: HRC → CRC (direct, no intermediate)
  {
    id: 'R1A_HRC_CRC',
    name: 'China HRC futures → CRC substrate cost',
    nameKo: 'HRC 선물 → CRC 원판 원가 직접 영향',
    trigger: { kind: 'market', instrument: 'hrc' },
    chain: [
      'China HRC futures move',
      'CRC base cost shifts immediately',
      'CRC offer price pressure',
    ],
    chainKo: [
      '중국 HRC 선물 급변',
      'CRC 원판 원가 즉시 연동',
      'CRC 오퍼가 압력 발생',
    ],
    narrativeKo: {
      UP: 'HRC가 오르면 CRC 원가가 바로 올라갑니다. CRC는 HRC를 냉간 압연한 제품이므로, HRC 가격 변동이 가장 직접적으로 반영됩니다. 기발행 CRC 견적의 유효성을 즉시 확인하세요.',
      DOWN: 'HRC가 하락하면 바이어가 CRC 가격 인하를 기대합니다. 기발행 견적 대비 시장 괴리가 커져 재협상 압력이 높아집니다.',
    },
    products: ['CRC'],
    regions: ['China', 'Asia', 'Korea Export', 'Europe', 'GCC'],
    riskType: 'Substrate Cost',
    riskTypeKo: '원판(기판) 원가',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Reconfirm CRC offer validity dates immediately',
           'Check CRC quotation exposure in the last 48 hours'],
      DOWN: ['Hold back new fixed CRC offers — buyers will expect pass-through',
             'Re-check CRC cost basis on recent quotations'],
    },
    actionsKo: {
      UP: ['CRC 견적 유효 기간 점검 필요 — 원판 원가 상승으로 기발행 견적 손실 가능성',
           '최근 48시간 내 발행 CRC 견적의 마진 노출 확인 권장'],
      DOWN: ['신규 CRC 고정가 오퍼 발행 보류 권장 — 바이어의 하락분 반영 요구 가능성',
             '최근 CRC 견적의 원가 기준 재점검 필요'],
    },
  },

  // R1B: HRC → coated products (indirect, via CRC→FH)
  {
    id: 'R1B_HRC_COATED',
    name: 'China HRC futures → coated product base cost',
    nameKo: 'HRC 선물 → 도금·컬러 제품 원판 원가',
    trigger: { kind: 'market', instrument: 'hrc' },
    chain: [
      'China HRC futures move',
      'CRC → Full-Hard (FH) cost shifts',
      'Coated product (GI/GL/COLOR) substrate cost shifts',
      'Quotation validity & renegotiation risk',
    ],
    chainKo: [
      '중국 HRC 선물 급변',
      'CRC → 풀하드(FH) 원가 변동',
      '도금 제품(GI/GL/컬러) 원판 원가 변동',
      '기존 견적 유효성 · 재협상 리스크',
    ],
    narrativeKo: {
      UP: 'HRC가 오르면 CRC→FH를 경유하여 GI/GL/컬러 제품의 원판 원가가 올라갑니다. 도금 제품은 HRC 가격이 2~4주 시차로 반영되므로, 현재 나간 도금·컬러 견적의 원가 기반을 재확인해야 합니다.',
      DOWN: 'HRC 하락 → CRC→FH 원가가 내려가면서 바이어가 도금·컬러 가격 인하를 기대합니다. 시차(2~4주)가 있으므로 성급한 가격 인하에 주의하세요.',
    },
    products: ['GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['China', 'Asia', 'Korea Export'],
    riskType: 'Substrate Cost',
    riskTypeKo: '원판(기판) 원가',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    lagNote: 'HRC → coated product offers typically lag by 2–4 weeks.',
    lagNoteKo: 'HRC → 도금 제품 오퍼가 반영까지 통상 2~4주 시차',
    actions: {
      UP: ['Reconfirm open GI/GL/Color mill offers and validity dates',
           'Review unconfirmed quotations for renegotiation exposure',
           'Prioritise pending bookings before offers are withdrawn'],
      DOWN: ['Hold back new fixed offers — buyers will expect the decline to pass through',
             'Re-check cost basis on quotations issued in the last 48 hours'],
    },
    actionsKo: {
      UP: ['GI/GL/컬러 오퍼 유효 기간 점검 필요 — 원판 원가 상승 시 2~4주 내 반영',
           '미체결 견적의 재협상 노출 확인 권장',
           '오퍼 철회 가능성에 대비하여 대기 부킹 우선 확정 검토'],
      DOWN: ['신규 고정가 오퍼 발행 보류 권장 — 바이어의 하락분 반영 요구 가능성',
             '최근 발행 견적의 원가 기준 재점검 필요'],
    },
  },

  // R2: China mill offer hike → Asia reference
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
    products: ['CRC', 'GI', 'GL', 'COLOR'],
    regions: ['China', 'Asia'],
    riskType: 'Mill Offer',
    riskTypeKo: '제철소 오퍼',
    directionFrom: () => 'UP',
    actions: { UP: ['Reconfirm all open quotations against the new reference offer'] },
    actionsKo: { UP: ['미체결 견적의 기준가 괴리 점검 필요 — 새 기준가 반영 여부 확인'] },
  },

  // R3: Iron ore / coking coal → upstream
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
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['China', 'Asia', 'Korea Export'],
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
      UP: ['중기 원가 상승 가능성 — 다음 오퍼 사이클 전 가격 팀과 공유 권장'],
      DOWN: ['바이어의 가격 인하 요구 가능성에 유의 — 기존 원재료 원가 기반 오퍼 재검토'],
    },
  },

  // R4A: Zinc → GI coating cost (GI = 순수 아연 도금)
  {
    id: 'R4A_ZINC_GI',
    name: 'Zinc price → GI coating cost',
    nameKo: '아연 가격 → GI 도금 원가 직접 영향',
    trigger: { kind: 'market', instrument: 'zinc' },
    chain: [
      'Zinc price move',
      'GI coating bath cost (pure zinc) shifts',
      'GI conversion cost and margin pressure',
    ],
    chainKo: [
      '아연 가격 변동',
      'GI 도금 욕조 원가(순수 아연) 변동',
      'GI 가공비 · 마진 압박',
    ],
    narrativeKo: {
      UP: '아연이 오르면 GI 도금 원가가 직접 상승합니다. GI는 도금층이 순수 아연이므로 아연 가격 영향을 가장 크게 받습니다. 신규 GI 오퍼 발행 전 코팅 엑스트라 재계산이 필수입니다.',
      DOWN: '아연 하락 → GI 코팅 엑스트라를 경쟁 무기로 활용할 여지가 생깁니다. 가격 인하 카드로 활용하세요.',
    },
    products: ['GI', 'PPGI'],
    regions: ['Korea Export', 'Asia', 'Europe', 'GCC'],
    riskType: 'Coating Cost',
    riskTypeKo: '도금 원가 (아연)',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Recalculate GI coating extras before issuing new offers',
           'Check open GI/PPGI quotations for margin erosion'],
      DOWN: ['GI coating extras may be a competitive lever on open negotiations',
             'Consider GI price positioning vs competitor origins'],
    },
    actionsKo: {
      UP: ['GI 코팅 엑스트라 재계산 필요 — 아연 원가 변동분 반영 확인',
           '미체결 GI/PPGI 견적의 마진 침식 확인 권장'],
      DOWN: ['GI 코팅 엑스트라 인하분을 협상 카드로 활용 가능',
             '경쟁 오리진 대비 GI 가격 포지셔닝 검토 권장'],
    },
  },

  // R4B: Aluminium → GL coating cost (GL = 55%Al-45%Zn)
  {
    id: 'R4B_ALUM_GL',
    name: 'Aluminium price → GL / AL coating cost',
    nameKo: '알루미늄 가격 → GL·AL 도금 원가',
    trigger: { kind: 'market', instrument: 'aluminium' },
    chain: [
      'Aluminium price move',
      'GL coating alloy (55 %Al) cost shifts',
      'AL coating (pure aluminium) cost shifts',
      'GL / AL conversion cost and margin pressure',
    ],
    chainKo: [
      '알루미늄 가격 변동',
      'GL 도금 합금(55 %Al) 원가 변동',
      'AL 도금(순수 알루미늄) 원가 변동',
      'GL/AL 가공비 · 마진 압박',
    ],
    narrativeKo: {
      UP: '알루미늄이 오르면 GL(55 %Al-45 %Zn 합금)과 AL(순수 알루미늄 코팅)의 도금 원가가 직접 상승합니다. 특히 AL은 알루미늄 의존도가 100 %이므로 영향이 가장 큽니다.',
      DOWN: '알루미늄 하락 → GL/AL 코팅 엑스트라를 경쟁 무기로 활용할 여지가 생깁니다.',
    },
    products: ['GL', 'COLOR'],
    regions: ['Korea Export', 'Asia', 'US'],
    riskType: 'Coating Cost',
    riskTypeKo: '도금 원가 (알루미늄)',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Recalculate GL/AL coating extras before issuing new offers',
           'Check open GL/AL quotations for margin erosion at new aluminium level'],
      DOWN: ['GL/AL coating extras may be a competitive lever',
             'Consider GL pricing positioning in Southeast Asia (humidity → GL preference)'],
    },
    actionsKo: {
      UP: ['GL/AL 코팅 엑스트라 재계산 필요 — 알루미늄 원가 변동분 반영 확인',
           '미체결 GL/AL 견적의 마진 침식 확인 권장'],
      DOWN: ['GL/AL 코팅 엑스트라 인하분을 협상 카드로 활용 가능',
             '동남아(습도 → GL 선호) GL 가격 포지셔닝 검토 권장'],
    },
  },

  // R4C: Zinc also affects GL (45 % Zn in alloy)
  {
    id: 'R4C_ZINC_GL',
    name: 'Zinc price → GL coating cost (45 % Zn in 55Al-45Zn)',
    nameKo: '아연 가격 → GL 도금 원가 (합금 내 45 % 아연)',
    trigger: { kind: 'market', instrument: 'zinc' },
    chain: [
      'Zinc price move',
      'GL alloy bath cost (45 % Zn component) shifts',
      'GL conversion cost partially affected',
    ],
    chainKo: [
      '아연 가격 변동',
      'GL 합금 욕조 원가(45 % 아연 성분) 변동',
      'GL 가공비 부분 영향',
    ],
    narrativeKo: {
      UP: '아연이 오르면 GL 도금 원가도 일부 영향을 받습니다. GL은 55 %Al-45 %Zn 합금이므로 아연 비중은 GI보다 낮지만, 원가의 45 %를 차지하는 무시할 수 없는 요소입니다.',
      DOWN: '아연 하락 → GL 원가의 아연 부분이 내려갑니다. GI 대비 GL 가격 경쟁력이 상대적으로 개선될 수 있습니다.',
    },
    products: ['GL'],
    regions: ['Korea Export', 'Asia', 'US'],
    riskType: 'Coating Cost',
    riskTypeKo: '도금 원가 (GL 합금)',
    directionFrom: (pct) => (pct > 0 ? 'UP' : 'DOWN'),
    actions: {
      UP: ['Factor zinc component into GL coating-extra recalculation'],
      DOWN: ['GL cost advantage vs GI may widen — useful in Asia negotiations'],
    },
    actionsKo: {
      UP: ['GL 코팅 엑스트라에 아연 성분 변동분 반영 필요'],
      DOWN: ['GI 대비 GL 원가 우위 확대 가능 — 동남아 협상에 유리한 포인트'],
    },
  },

  // ──────────────────── NEWS-TRIGGERED: LOGISTICS ────────────────────

  // R5: Oil → freight → CIF
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
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Europe', 'GCC', 'Korea Export'],
    riskType: 'Freight',
    riskTypeKo: '운임',
    directionFrom: () => 'UP',
    actions: { UP: ['Request updated freight quotations before confirming CIF offers'] },
    actionsKo: { UP: ['CIF 오퍼에 운임 상승분 반영 여부 확인 필요 — 유가 연동 운임 변동'] },
  },

  // R6: Strait disruption
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
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
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
      'CIF 가격에 운임·보험료 급등분이 반영되었는지 확인 필요',
      '장기 유효 오퍼의 운임 전제 재검토 권장 — 발행 당시 대비 운임 변동 가능',
      '영향 항로 경유 선적의 일정 변동 가능성에 유의',
    ],
  },

  // R7: Port closure
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
    products: ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'],
    regions: ['Asia', 'Europe', 'US', 'GCC'],
    riskType: 'Logistics',
    riskTypeKo: '물류·해운',
    directionFrom: () => 'UP',
    actions: ['Verify ETD/ETA on affected shipments and notify customers early'],
    actionsKo: ['선적 지연 시 바이어 사전 통보 필요 — 체선료·계약 취소 리스크 방지'],
  },

  // ──────────────────── NEWS-TRIGGERED: TRADE POLICY (REGION-SPECIFIC) ────────────────────

  // R8A: EU safeguard / quota / CBAM
  {
    id: 'R8A_EU_TRADE',
    name: 'EU safeguard quota / CBAM → Europe import conditions',
    nameKo: 'EU 세이프가드·쿼터·CBAM → 유럽 수입 조건 변동',
    trigger: {
      kind: 'news',
      domains: ['eu_steel_trade', 'trade_policy'],
      keywords: ['safeguard', 'quota', 'EU', 'European', 'cbam', 'carbon border'],
    },
    chain: [
      'EU trade measure announced or updated',
      'Import quota or carbon cost changes',
      'EU market access conditions shift',
      'Origin competitiveness in Europe re-ranks',
    ],
    chainKo: [
      'EU 무역 조치 발표 · 갱신',
      '수입 쿼터 또는 탄소 비용 변동',
      '유럽 시장 접근 조건 변동',
      '유럽 내 원산지별 경쟁력 순위 재편',
    ],
    narrativeKo: {
      UP: 'EU가 세이프가드 쿼터를 조정하거나 CBAM 적용 범위를 변경하면 → 수입 가능 물량이나 탄소 비용이 바뀌고 → 한국산 vs 터키산·인도산·베트남산의 경쟁력이 재편됩니다. 유럽은 GI가 주력 시장입니다.',
    },
    products: ['CRC', 'GI', 'PPGI', 'COLOR'],
    regions: ['Europe'],
    riskType: 'Trade Policy',
    riskTypeKo: '통상 정책 (EU)',
    directionFrom: () => 'UP',
    actions: [
      'Check remaining quota utilisation for the current period',
      'Evaluate CBAM cost impact on Korea-origin vs competitor origins',
      'Confirm mill certificates for EU destination',
    ],
    actionsKo: [
      '잔여 수입 쿼터 소진율 확인 필요 — 분기 쿼터 초과 시 추가 관세 부과',
      '한국산 vs 경쟁 오리진의 CBAM 비용 비교 검토 권장',
      'EU 목적지용 Mill Certificate 적합성 확인 권장',
    ],
  },

  // R8B: EU anti-dumping on China → origin shift (opportunity for Korea)
  {
    id: 'R8B_EU_AD_CHINA',
    name: 'EU anti-dumping on China → origin competition shift',
    nameKo: 'EU 對중국 반덤핑 → 원산지 경쟁 구도 변동',
    trigger: {
      kind: 'news',
      domains: ['eu_steel_trade', 'trade_policy'],
      keywords: ['anti-dumping', 'antidumping', 'china', 'countervailing', 'EU'],
    },
    chain: [
      'EU anti-dumping duty on Chinese steel reinforced or extended',
      'Chinese origin effectively blocked in EU market',
      'Turkey, India, Vietnam, Korea compete for the gap',
      'Sourcing opportunity from alternative origins',
    ],
    chainKo: [
      'EU 對중국 반덤핑 관세 강화 · 연장',
      '중국산 유럽 시장 사실상 차단',
      '터키·인도·베트남·한국산이 공백 경쟁',
      '대체 오리진 소싱 기회 발생',
    ],
    narrativeKo: {
      UP: 'EU가 중국산 철강에 반덤핑 관세를 강화하면 → 중국산이 유럽에서 차단되고 → 터키산·인도산·베트남산과의 경쟁이 심화됩니다. 이들 국가 MILL에서 소싱도 가능하므로 경쟁자이자 기회이기도 합니다.',
    },
    products: ['GI', 'CRC', 'COLOR'],
    regions: ['Europe'],
    riskType: 'Trade Policy',
    riskTypeKo: '통상 정책 (반덤핑)',
    directionFrom: () => 'UP',
    actions: [
      'Monitor Turkey/India/Vietnam GI offers to EU for price positioning',
      'Evaluate sourcing from competitor-origin mills as alternative supply',
    ],
    actionsKo: [
      '유럽 향 경쟁 오리진(터키·인도·베트남) GI 오퍼 동향 주시 필요',
      '중국산 차단으로 인한 공백 수요 — 경쟁 오리진 MILL 소싱 기회 검토',
    ],
  },

  // R8C: US Section 232 / tariff → US market
  {
    id: 'R8C_US_TRADE',
    name: 'US Section 232 / tariff → US market access cost',
    nameKo: 'US Section 232·관세 → 미국 시장 접근 비용',
    trigger: {
      kind: 'news',
      domains: ['us_steel_trade', 'trade_policy'],
      keywords: ['section 232', 'section 338', 'section 301', 'tariff', 'US', 'United States', 'import duty'],
    },
    chain: [
      'US tariff policy change announced',
      'Import cost for affected origins shifts',
      'Tariff-inclusive price competitiveness changes',
      'Volume/margin trade-off in US market',
    ],
    chainKo: [
      '미국 관세 정책 변경 발표',
      '해당 원산지 수입 비용 변동',
      '관세 포함 가격 경쟁력 변동',
      '미국 시장 물량/마진 트레이드오프',
    ],
    narrativeKo: {
      UP: '미국은 쿼터제가 아닌 관세제(Section 232 등)를 운영합니다. 관세율 변동이 수입 비용에 직접 반영되므로, 관세 포함 도착가(Landed Cost)가 현지 시장가 대비 경쟁력이 있는지를 기준으로 판단해야 합니다.',
    },
    products: ['CRC', 'GI', 'GL', 'COLOR'],
    regions: ['US'],
    riskType: 'Trade Policy',
    riskTypeKo: '통상 정책 (US 관세)',
    directionFrom: () => 'UP',
    actions: [
      'Recalculate landed cost with updated tariff rates',
      'Recalculate landed cost with tariff at the updated rate',
      'Compare tariff-inclusive price vs US domestic mills',
    ],
    actionsKo: [
      '변경 관세율 기준 Landed Cost 재계산 필요 — 수출 채산성 재검토',
      '관세 포함 가격의 미국 내수가 대비 경쟁력 확인 권장',
    ],
  },

  // R8D: ASEAN anti-dumping / safeguard → Asia market
  {
    id: 'R8D_ASIA_TRADE',
    name: 'ASEAN trade remedy → Asia market access',
    nameKo: 'ASEAN 반덤핑·세이프가드 → 동남아 시장 접근 변동',
    trigger: {
      kind: 'news',
      domains: ['asia_steel_trade', 'trade_policy'],
      keywords: ['anti-dumping', 'antidumping', 'safeguard', 'ASEAN', 'Southeast Asia', 'Vietnam', 'Indonesia', 'Thailand', 'Philippines'],
    },
    chain: [
      'ASEAN country announces trade remedy',
      'Import cost or volume cap changes',
      'China/Korea/India competitiveness shifts in the region',
      'Product-specific impact (GL preferred in humid SEA)',
    ],
    chainKo: [
      'ASEAN 국가 무역 구제 조치 발표',
      '수입 비용 또는 물량 상한 변동',
      '중국·한국·인도산 역내 경쟁력 변동',
      '제품별 영향 (습도 높은 동남아는 GL 선호)',
    ],
    narrativeKo: {
      UP: '동남아 국가가 반덤핑·세이프가드를 발동하면 → 중국산 저가 물량이 제한되어 한국산에 기회가 될 수도 있고, 반대로 한국산이 대상이면 위협이 됩니다. 동남아는 GL 선호 시장이라 GL 영향을 특히 주시하세요.',
    },
    products: ['GI', 'GL', 'COLOR'],
    regions: ['Asia'],
    riskType: 'Trade Policy',
    riskTypeKo: '통상 정책 (ASEAN)',
    directionFrom: () => 'UP',
    actions: [
      'Identify if the trade remedy targets Korea-origin or competitor origins',
      'If competitor-targeting: assess opportunity for Korea-origin products',
      'Check GL/AL demand in affected ASEAN countries',
    ],
    actionsKo: [
      '무역 구제 대상 오리진 확인 필요 — 한국산 포함 여부에 따라 영향 상이',
      '경쟁 오리진 대상 시 한국산 반사이익 가능성 검토 권장',
      '해당 ASEAN 시장의 GL/AL 수요 변동 확인 필요',
    ],
  },

  // ──────────────────── NEWS-TRIGGERED: COMPETITION ────────────────────

  // R10: China overcapacity / export flood
  {
    id: 'R10_CHINA_FLOOD',
    name: 'China overcapacity / export flood → global price pressure',
    nameKo: '중국 과잉 생산·수출 공세 → 글로벌 가격 압력',
    trigger: {
      kind: 'news',
      domains: ['china_supply', 'china_export_flood'],
      keywords: ['overcapacity', 'export', 'dumping', 'flood', 'surplus', 'capacity', 'rebate', 'production cut'],
    },
    chain: [
      'China steel overcapacity or export surge reported',
      'Low-priced Chinese material floods target markets',
      'Regional price benchmarks pushed down',
      'Korea-origin price competitiveness erodes',
    ],
    chainKo: [
      '중국 철강 과잉 생산 또는 수출 급증 보도',
      '저가 중국산 물량이 목표 시장에 유입',
      '지역별 가격 벤치마크 하방 압력',
      '한국산 가격 경쟁력 약화',
    ],
    narrativeKo: {
      UP: '중국이 과잉 생산분을 수출로 밀어내면 → GCC(무역장벽 없음)와 동남아에서 중국산 저가 물량과 직접 경쟁해야 합니다. GCC는 "제일 싼 놈이 이기는" 시장이므로 마진 압박이 심합니다. 유럽은 반덤핑으로 중국산이 차단되어 상대적으로 영향이 적습니다.',
    },
    products: ['CRC', 'GI', 'GL', 'COLOR'],
    regions: ['Asia', 'GCC'],
    riskType: 'Competition',
    riskTypeKo: '경쟁 (중국 수출)',
    directionFrom: () => 'UP',
    actions: [
      'Monitor China FOB offer prices in target regions',
      'GCC: assess if sourcing Chinese material ($50/t premium vs direct) is viable',
      'Asia: check if Korea-origin GL/AL can maintain price premium over Chinese alternatives',
    ],
    actionsKo: [
      '목표 시장별 중국산 FOB 가격 동향 주시 필요 — 가격 하방 압력 파악',
      'GCC: 중국산 소싱 가능 여부 검토 (다이렉트 대비 톤당 약 $50 프리미엄 고려)',
      '동남아: 한국산 GL/AL의 중국산 대비 품질 프리미엄 유지 여부 확인',
    ],
  },

  // R11A: Turkey steel exports → Europe/GCC competition
  {
    id: 'R11A_TURKEY',
    name: 'Turkey steel export activity → Europe / GCC competition',
    nameKo: '터키 철강 수출 동향 → 유럽·중동 경쟁 변동',
    trigger: {
      kind: 'news',
      domains: ['competitor_turkey', 'steel_price'],
      keywords: ['turkey', 'türkiye', 'turkish', 'erdemir', 'tosyali', 'export'],
    },
    chain: [
      'Turkey mill activity or export volume change',
      'Turkish GI/CRC offers in EU and GCC adjust',
      'Competition pressure on Korea-origin offers',
    ],
    chainKo: [
      '터키 제철소 활동 또는 수출 물량 변동',
      '터키산 GI/CRC 유럽·중동 오퍼 변동',
      '한국산 오퍼에 대한 경쟁 압력 변동',
    ],
    narrativeKo: {
      UP: '터키는 유럽과 중동에서 한국산의 핵심 경쟁자입니다. 터키 제철소(Erdemir, Tosyalı 등)의 오퍼가 변동은 우리 유럽/GCC 오퍼 경쟁력에 직접 영향합니다. 다만 터키 MILL 소싱도 가능하므로 기회가 될 수도 있습니다.',
    },
    products: ['GI', 'CRC', 'COLOR'],
    regions: ['Europe', 'GCC'],
    riskType: 'Competition',
    riskTypeKo: '경쟁 (터키)',
    directionFrom: () => 'UP',
    actions: [
      'Track Turkey GI/CRC offer prices for EU and GCC destinations',
      'Evaluate sourcing from Turkish mills as alternative or supplement',
    ],
    actionsKo: [
      '유럽·중동 향 터키산 GI/CRC 오퍼 동향 주시 필요',
      '터키 MILL 소싱이 대안 공급으로 유효한지 검토 권장',
    ],
  },

  // R11B: India steel exports → Europe/GCC/Asia competition
  {
    id: 'R11B_INDIA',
    name: 'India steel export activity → multi-region competition',
    nameKo: '인도 철강 수출 동향 → 다지역 경쟁 변동',
    trigger: {
      kind: 'news',
      domains: ['competitor_india', 'steel_price'],
      keywords: ['india', 'indian', 'tata steel', 'jsw', 'sail', 'export'],
    },
    chain: [
      'India mill activity or export policy change',
      'Indian steel offers in EU / GCC / Asia adjust',
      'Competition pressure on Korea-origin offers',
    ],
    chainKo: [
      '인도 제철소 활동 또는 수출 정책 변동',
      '인도산 유럽/중동/아시아 오퍼 변동',
      '한국산 오퍼에 대한 경쟁 압력 변동',
    ],
    narrativeKo: {
      UP: '인도는 유럽·중동·동남아에서 한국산과 경쟁하는 주요 오리진입니다. Tata Steel, JSW 등의 수출 정책 변동은 여러 시장에 동시에 영향을 미칩니다. 인도 MILL 소싱도 검토 가능합니다.',
    },
    products: ['GI', 'CRC', 'GL', 'COLOR'],
    regions: ['Europe', 'GCC', 'Asia'],
    riskType: 'Competition',
    riskTypeKo: '경쟁 (인도)',
    directionFrom: () => 'UP',
    actions: [
      'Track India GI/CRC offer prices across regions',
      'Evaluate sourcing from Indian mills for target markets',
    ],
    actionsKo: [
      '인도산 GI/CRC 오퍼 가격의 지역별 동향 주시 필요',
      '목표 시장별 인도 MILL 소싱 가능성 검토 권장',
    ],
  },

  // R11C: Vietnam steel → Asia/Europe competition
  {
    id: 'R11C_VIETNAM',
    name: 'Vietnam steel production/export → Asia / EU competition',
    nameKo: '베트남 철강 생산·수출 → 동남아·유럽 경쟁 변동',
    trigger: {
      kind: 'news',
      domains: ['competitor_vietnam', 'asia_steel_trade'],
      keywords: ['vietnam', 'vietnamese', 'formosa ha tinh', 'hoa phat', 'export', 'production'],
    },
    chain: [
      'Vietnam mill capacity or export volume change',
      'Vietnamese steel offers in Asia and EU adjust',
      'Competition for GI/GL/COLOR orders shifts',
    ],
    chainKo: [
      '베트남 제철소 생산능력 또는 수출 물량 변동',
      '베트남산 아시아·유럽 오퍼 변동',
      'GI/GL/컬러 수주 경쟁 구도 변동',
    ],
    narrativeKo: {
      UP: '베트남(포모사하띤, 호아팟 등)은 동남아와 유럽에서 경쟁하는 오리진입니다. 현지 생산 능력 확대는 한국산 수출에 위협이지만, 소싱 파트너로의 기회이기도 합니다.',
    },
    products: ['GI', 'GL', 'COLOR'],
    regions: ['Asia', 'Europe'],
    riskType: 'Competition',
    riskTypeKo: '경쟁 (베트남)',
    directionFrom: () => 'UP',
    actions: [
      'Monitor Vietnam mill offers for overlap with Korea-origin target markets',
      'Assess Vietnam MILL sourcing opportunity if competitive',
    ],
    actionsKo: [
      '한국산 목표 시장과 겹치는 베트남 MILL 오퍼 동향 주시 필요',
      '가격 경쟁력 확인 시 베트남 MILL 소싱 기회 검토 권장',
    ],
  },

  // R12: GCC demand / construction
  {
    id: 'R12_GCC_DEMAND',
    name: 'GCC infrastructure / construction demand → import signal',
    nameKo: 'GCC 인프라·건설 수요 → 수입 수요 신호',
    trigger: {
      kind: 'news',
      domains: ['gcc_steel_market'],
      keywords: ['construction', 'project', 'demand', 'infrastructure', 'vision 2030', 'neom', 'saudi', 'uae', 'qatar'],
    },
    chain: [
      'GCC mega-project or construction activity reported',
      'Steel import demand in the region shifts',
      'Pricing environment changes (demand-pull vs price war)',
    ],
    chainKo: [
      'GCC 대형 프로젝트 또는 건설 활동 보도',
      '역내 철강 수입 수요 변동',
      '가격 환경 변동 (수요 견인 vs 가격 경쟁)',
    ],
    narrativeKo: {
      UP: 'GCC에서 대형 인프라 프로젝트(Vision 2030, NEOM 등)가 진행되면 → 철강 수입 수요가 늘고 → 가격 경쟁이 완화될 수 있습니다. 다만 중국·인도·터키산도 동시에 유입되므로 가격 경쟁은 여전합니다.',
    },
    products: ['GI', 'GL', 'COLOR'],
    regions: ['GCC'],
    riskType: 'Demand',
    riskTypeKo: '수요 동향 (GCC)',
    directionFrom: () => 'UP',
    actions: [
      'Identify specific projects driving demand and target product requirements',
      'Assess if demand uplift justifies holding price vs aggressive pricing',
    ],
    actionsKo: [
      '수요 견인 프로젝트의 제품 사양 확인 필요 — 목표 제품과 매칭 여부',
      '수요 증가 시 가격 유지 vs 공격적 가격 전략 판단 필요',
    ],
  },

  // ──────────────────── NEWS-TRIGGERED: SANCTIONS ────────────────────

  // R9: Sanctions
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
    actionsKo: ['영향 계약의 거래처·은행 제재 리스트 스크리닝 필요 — 선적 전 확인 필수'],
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
    'flat steel', 'flat-rolled', 'slab', 'plate',
  ],
  contextual: [
    'tariff', 'anti-dumping', 'antidumping', 'countervailing', 'safeguard', 'quota',
    'cbam', 'sanction', 'export control', 'freight', 'shipping', 'port', 'red sea',
    'hormuz', 'suez', 'container', 'bunker', 'crude', 'zinc', 'aluminium', 'aluminum',
    'nickel', 'scrap', 'export', 'import', 'section 232', 'section 338', 'section 301',
    'trade war', 'iran', 'houthi', 'strait', 'chokepoint', 'oil price', 'brent',
    'marine insurance', 'war risk', 'conflict', 'ceasefire', 'rerouting',
    '관세', '반덤핑', '운임', '수출', '무역전쟁', '호르무즈', '이란',
    'overcapacity', 'dumping', 'surplus', 'production cut', 'rebate',
    'turkey', 'india', 'vietnam', 'indonesia', 'posco', 'hyundai steel',
    'construction', 'infrastructure', 'vision 2030', 'neom',
    'galvalume', 'aluminized', 'zinc-aluminium',
  ],
  negative: [
    'fashion', 'collection', 'sneaker', 'jewelry', 'jewellery', 'watch', 'perfume',
    'album', 'movie', 'celebrity', 'recipe', 'cookware', 'guitar', 'lipstick',
  ],
};
