export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Direction = 'UP' | 'DOWN';
export type AssessmentStatus = 'ALERT' | 'WATCH' | 'INFO' | 'IGNORE';
export type ImpactDirection = 'UP' | 'DOWN' | 'NEUTRAL' | 'UNKNOWN';
export type TimeHorizon = 'NOW' | 'DAYS' | 'WEEKS' | '1-3_MONTHS' | '3-6_MONTHS' | 'LONG_TERM' | 'UNKNOWN';
export type CausalState = 'CONFIRMED' | 'CONDITIONAL' | 'UNCONFIRMED';

export interface CausalStep {
  step: string;
  state: CausalState;
}

export interface ImpactVectors {
  price?: ImpactDirection;
  cost?: ImpactDirection;
  demand?: ImpactDirection;
  sales?: ImpactDirection;
  freight?: ImpactDirection;
  leadTime?: ImpactDirection;
  compliance?: ImpactDirection;
  competition?: ImpactDirection;
  opportunity?: ImpactDirection;
}

export interface RiskScores {
  evidenceQuality: number;
  exposureProximity: number;
  causalStrength: number;
  businessMateriality: number;
  urgency: number;
}

export interface Bar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  oi: number | null;
  session: string;
  source: 'SHFE' | 'SINA' | 'SINA_BACKFILL';
}

export interface Instrument {
  key: string;
  label: string;
  labelKo: string;
  unit: string;
  contract: string;
  exchange: string;
  currency: string;
  last: number;
  open: number | null;
  high: number | null;
  low: number | null;
  preSettlement: number | null;
  volume: number | null;
  openInterest: number | null;
  liquidityScore?: number;
  contractRanking?: { contract: string; openInterest: number; volume: number; liquidityScore: number }[];
  sourceTimestamp: string;
  collectedAt: string;
  change: { today: number | null; m30: number | null; m60: number | null; m120: number | null };
  bars: Bar[];
  daily: Bar[];
  officialBarCount: number;
  historySource: string | null;
  quality: string;
}

export interface MarketData {
  generatedAt: string;
  sources: Record<string, string>;
  instruments: Record<string, Instrument>;
  failures: { instrument: string; source: string; error: string }[];
}

export interface Evidence {
  id: string;
  title: string;
  titleKo?: string | null;
  source: string;
  publishedAt: string;
  link: string;
}

export interface NewsDigestItem {
  id: string;
  title: string;
  titleKo?: string | null;
  source: string;
  publishedAt: string;
  link: string;
  theme: string;
  domains: string[];
  lang: string;
}

export interface EventCluster {
  id: string;
  ruleId: string;
  eventType: string;
  eventTypeKo?: string;
  riskType: string;
  riskTypeKo?: string;
  regions: string[];
  products: string[];
  keywords: string[];
  publisherCount: number;
  articleCount: number;
  firstDetected: string;
  latestUpdate: string;
  ageHours: number;
  confidence: Confidence;
  status: 'OPEN' | 'ACTIVE' | 'COOLING' | 'CLOSED';
  evidence: Evidence[];
}

export interface MarketSignal {
  id: string;
  instrument: string;
  instrumentLabel: string;
  contract: string;
  exchange: string;
  severity: Severity;
  direction: Direction;
  pct: number;
  window: string;
  windowLabel: string;
  threshold: number;
  last: number;
  unit: string;
  sourceTimestamp: string;
  collectedAt: string;
  source: string;
  fact: string;
}

export interface Impact {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleNameKo?: string;
  origin: 'MARKET_SIGNAL' | 'EVENT_CLUSTER' | 'AI_INSIGHT';
  originId: string;
  severity: Severity;
  confidence: Confidence;
  direction: Direction;
  riskType: string;
  riskTypeKo?: string;
  products: string[];
  regions: string[];
  chain: string[];
  chainKo?: string[];
  lagNote: string | null;
  lagNoteKo?: string | null;
  narrativeKo?: string | null;
  fact: string;
  factSource: string;
  factTimestamp: string;
  rule: string;
  inference: string;
  actions: string[];
  actionsKo?: string[];
  evidence?: Evidence[];
  corroboratedBy?: string;
  corroborationNote?: string;

  // ── AI Risk Intelligence fields (additive, all optional) ──
  assessmentStatus?: AssessmentStatus;
  scores?: RiskScores;
  impactVectors?: ImpactVectors;
  facts?: string[];
  inferences?: string[];
  assumptions?: string[];
  missingEvidence?: string[];
  watchSignals?: string[];
  threat?: string;
  opportunity?: string;
  timeHorizon?: TimeHorizon;
  counterScenario?: string;
  causalChainDetailed?: CausalStep[];
  firstSeen?: string;
  lastUpdated?: string;
  aiModelUsed?: string;
}

export interface SalesImpactRow {
  id: string;
  region: string;
  products: string[];
  riskType: string;           // normalized category key (e.g. 'logistics')
  riskTypeKo?: string;        // normalized category label (e.g. '물류·운임')
  riskTypeOriginal?: string;  // AI-generated original label (preserved for detail view)
  direction: Direction;
  severity: Severity;
  confidence: Confidence;
  action: string;
  impactId: string;
  ruleId: string;
}

export interface Analysis {
  generatedAt: string;
  inputs: {
    marketGeneratedAt: string;
    newsGeneratedAt: string;
    articlesCollected: number;
    articlesRelevant: number;
    articlesRejected: number;
    instrumentsCovered: number;
    marketFailures: unknown[];
    newsFailures: unknown[];
  };
  marketSignals: MarketSignal[];
  eventClusters: EventCluster[];
  impacts: Impact[];
  criticalSignals: Impact[];
  salesImpact: SalesImpactRow[];
  newsDigest?: NewsDigestItem[];
  ruleCount: number;
}

export interface FxPair {
  key: string;
  from: string;
  to: string;
  label: string;
  labelKo: string;
  rate: number;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  spark: { date: string; value: number }[];
}

export interface FxData {
  generatedAt: string;
  source: string;
  referenceDate: string;
  pairs: FxPair[];
}

export interface FreightTicker {
  symbol: string;
  label: string;
  labelKo: string;
  category: 'bulk' | 'container' | 'tanker' | 'broad';
  unit: string;
  last: number;
  lastDate: string;
  change1d: number | null;
  change1w: number | null;
  change1m: number | null;
  high52w: number;
  low52w: number;
  volume: number;
  currency: string;
  exchange: string;
  bars: { date: string; open: number | null; high: number | null; low: number | null; close: number; volume: number }[];
  spark: { date: string; value: number }[];
}

export interface FreightData {
  generatedAt: string;
  source: string;
  note: string;
  tickers: FreightTicker[];
  failures: { symbol: string; error: string }[];
}

export type IssueStatus = 'NEW' | 'REVIEWING' | 'ACTION_REQUIRED' | 'RESOLVED';

export interface Issue {
  id: number;
  title: string;
  impact_id: string;
  rule_id: string;
  risk_type: string;
  region: string;
  products: string;
  action: string;
  status: IssueStatus;
  created_at: string;
  updated_at: string;
}
