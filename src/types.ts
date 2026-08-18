export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type Direction = 'UP' | 'DOWN';

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
  source: string;
  publishedAt: string;
  link: string;
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
  origin: 'MARKET_SIGNAL' | 'EVENT_CLUSTER';
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
}

export interface SalesImpactRow {
  id: string;
  region: string;
  products: string[];
  riskType: string;
  riskTypeKo?: string;
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
  ruleCount: number;
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
