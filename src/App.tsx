import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, type Timeframe } from './Chart';
import { CostSimulator } from './CostSimulator';
import { Panel, SeverityTag, ConfidenceTag, Arrow, Pct, Epistemic, StatCard } from './ui';
import { createIssue, deleteIssue, listIssues, updateIssueStatus, seedIssuesIfEmpty } from './db';
import type { Analysis, FreightData, FxData, Impact, Issue, IssueStatus, MarketData, NewsDigestItem } from './types';

const BASE = import.meta.env.BASE_URL;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const KST = 'Asia/Seoul';
const PULSE_ORDER = ['hrc', 'rebar', 'zinc', 'aluminium', 'ironOre', 'cokingCoal'];
const STATUSES: IssueStatus[] = ['NEW', 'REVIEWING', 'ACTION_REQUIRED', 'RESOLVED'];
const ALL_REGIONS = ['China', 'Asia', 'Korea Export', 'Europe', 'GCC', 'US'];
const ALL_PRODUCTS = ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'];
const EVENTS_PER_PAGE = 5;

const STATUS_KO: Record<IssueStatus, string> = {
  NEW: '신규',
  REVIEWING: '검토 중',
  ACTION_REQUIRED: '조치 필요',
  RESOLVED: '완료',
};
const STATUS_EMOJI: Record<IssueStatus, string> = {
  NEW: '🆕',
  REVIEWING: '🔍',
  ACTION_REQUIRED: '⚠️',
  RESOLVED: '✅',
};

const INSTRUMENT_KO: Record<string, string> = {
  hrc: '열연강판 (HRC)',
  rebar: '철근',
  zinc: '아연',
  aluminium: '알루미늄',
  ironOre: '철광석',
  cokingCoal: '원료탄',
};

/** Detect trade-policy sub-type from article title and return Korean label */
function tradePolicyLabel(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('section 232')) return '🇺🇸 Section 232';
  if (t.includes('section 338')) return '🇺🇸 Section 338';
  if (t.includes('section 301')) return '🇺🇸 Section 301';
  if (t.includes('anti-dumping') || t.includes('antidumping') || t.includes('반덤핑')) return '⚖️ 반덤핑';
  if (t.includes('countervailing') || t.includes('상계관세')) return '⚖️ 상계관세';
  if (t.includes('safeguard') || t.includes('세이프가드')) return '🛡️ 세이프가드';
  if (t.includes('tariff') || t.includes('관세')) return '📋 관세';
  if (t.includes('quota') || t.includes('쿼터')) return '📊 수입 쿼터';
  if (t.includes('sanction') || t.includes('제재')) return '🚫 제재';
  return '📰 통상';
}

/** Extract target country from article title */
function targetCountry(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('china') || t.includes('중국')) return '🇨🇳 중국';
  if (t.includes('korea') || t.includes('한국')) return '🇰🇷 한국';
  if (t.includes('india') || t.includes('인도')) return '🇮🇳 인도';
  if (t.includes('eu ') || t.includes('europe') || t.includes('유럽')) return '🇪🇺 EU';
  if (t.includes('us ') || t.includes('u.s.') || t.includes('america') || t.includes('미국')) return '🇺🇸 미국';
  if (t.includes('canada') || t.includes('캐나다')) return '🇨🇦 캐나다';
  if (t.includes('japan') || t.includes('일본')) return '🇯🇵 일본';
  if (t.includes('vietnam') || t.includes('베트남')) return '🇻🇳 베트남';
  if (t.includes('turkey') || t.includes('türkiye') || t.includes('터키')) return '🇹🇷 터키';
  if (t.includes('saudi') || t.includes('사우디')) return '🇸🇦 사우디';
  if (t.includes('uae') || t.includes('아랍에미리트')) return '🇦🇪 UAE';
  if (t.includes('iran') || t.includes('이란')) return '🇮🇷 이란';
  if (t.includes('indonesia') || t.includes('인도네시아')) return '🇮🇩 인도네시아';
  if (t.includes('thailand') || t.includes('태국')) return '🇹🇭 태국';
  return '';
}

/** Rough Korean context from English article title — prominent topic tags */
function articleContextKo(title: string): string {
  const t = title.toLowerCase();
  const tags: string[] = [];
  // Material
  if (t.includes('hrc') || t.includes('hot-rolled') || t.includes('hot rolled')) tags.push('열연');
  if (t.includes('cold-rolled') || t.includes('cold rolled') || t.includes('crc')) tags.push('냉연');
  if (t.includes('galvaniz') || t.includes('gi ') || t.includes('hot-dip')) tags.push('도금 (GI)');
  if (t.includes('galvalume') || t.includes('zinc-alum')) tags.push('GL');
  if (t.includes('prepaint') || t.includes('ppgi') || t.includes('color coat')) tags.push('컬러강판');
  if (t.includes('zinc')) tags.push('아연');
  if (t.includes('alumin')) tags.push('알루미늄');
  if (t.includes('iron ore')) tags.push('철광석');
  if (t.includes('coking coal')) tags.push('원료탄');
  // Topic
  if (t.includes('price') || t.includes('가격')) tags.push('가격');
  if (t.includes('export') || t.includes('수출')) tags.push('수출');
  if (t.includes('import') || t.includes('수입')) tags.push('수입');
  if (t.includes('tariff') || t.includes('관세')) tags.push('관세');
  if (t.includes('dumping') || t.includes('반덤핑')) tags.push('반덤핑');
  if (t.includes('sanction') || t.includes('제재')) tags.push('제재');
  if (t.includes('shipping') || t.includes('freight') || t.includes('해운')) tags.push('해운/물류');
  if (t.includes('capacity') || t.includes('production') || t.includes('생산')) tags.push('생산');
  if (t.includes('demand') || t.includes('수요')) tags.push('수요');
  return tags.slice(0, 4).join(' · ');
}

function shanghaiToKst(stamp: string): string {
  const [date, time] = stamp.split(' ');
  if (!date || !time) return stamp;
  const d = new Date(`${date}T${time}+08:00`);
  return d.toLocaleString('ko-KR', { timeZone: KST, hour12: false });
}

const fmtIso = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: KST, hour12: false });

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

function sessionState(sourceTimestamp: string): { label: string; labelKo: string; tone: string } {
  const time = sourceTimestamp.split(' ')[1] ?? '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h)) return { label: 'UNKNOWN', labelKo: '알 수 없음', tone: 'var(--color-faint)' };
  const mins = h * 60 + m;
  const inWindow = (a: string, b: string) => {
    const to = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
    return mins >= to(a) && mins < to(b);
  };
  if (inWindow('21:00', '23:00')) return { label: 'NIGHT', labelKo: '야간장', tone: 'var(--color-steel)' };
  if (inWindow('09:00', '10:15') || inWindow('10:30', '11:30') || inWindow('13:30', '15:00'))
    return { label: 'DAY', labelKo: '주간장', tone: 'var(--color-ok)' };
  if (inWindow('10:15', '10:30') || inWindow('11:30', '13:30'))
    return { label: 'BREAK', labelKo: '휴장', tone: 'var(--color-risk-med)' };
  return { label: 'CLOSED', labelKo: '마감', tone: 'var(--color-muted)' };
}

/* ══════════════════════════════════════════════════════════════════
 *  APP COMPONENT
 * ══════════════════════════════════════════════════════════════════ */
export function App() {
  /* ── state ── */
  const [market, setMarket] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [fx, setFx] = useState<FxData | null>(null);
  const [freight, setFreight] = useState<FreightData | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedImpact, setSelectedImpact] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [filterRegion, setFilterRegion] = useState<string>('ALL');
  const [filterProduct, setFilterProduct] = useState<string>('ALL');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
  const [expandedSalesRow, setExpandedSalesRow] = useState<string | null>(null);

  // NEW UI state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('steel-dashboard-theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch { return 'dark'; }
  });
  const [signalTab, setSignalTab] = useState<string>('ALL');
  const [salesRiskTab, setSalesRiskTab] = useState<string>('ALL');
  const [eventThemeTab, setEventThemeTab] = useState<string>('ALL');
  const [eventPage, setEventPage] = useState(1);
  const [chartTimeframe, setChartTimeframe] = useState<Timeframe>('30m');
  const [chartInstrument, setChartInstrument] = useState<string>('hrc');
  const [newsPage, setNewsPage] = useState(1);
  const [newsDateFilter, setNewsDateFilter] = useState<string>('');
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  /* ── refs ── */
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const selectedImpactRef = useRef(selectedImpact);
  selectedImpactRef.current = selectedImpact;
  const marketRef = useRef(market);
  marketRef.current = market;
  const signalsRef = useRef<HTMLDivElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);

  /* ── theme effect ── */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('steel-dashboard-theme', theme); } catch {}
  }, [theme]);

  /* ── data loading ── */
  const loadData = useCallback(async (isManual = false) => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    try {
      const bust = `?t=${Date.now()}`;
      const [m, a, fxRes, freightRes] = await Promise.all([
        fetch(`${BASE}data/market.json${bust}`).then((r) => r.json()),
        fetch(`${BASE}data/analysis.json${bust}`).then((r) => r.json()),
        fetch(`${BASE}data/fx.json${bust}`).then((r) => r.json()).catch(() => null),
        fetch(`${BASE}data/freight.json${bust}`).then((r) => r.json()).catch(() => null),
      ]);
      const changed = !analysisRef.current || a.generatedAt !== analysisRef.current.generatedAt;
      setMarket(m);
      setAnalysis(a);
      if (fxRes) setFx(fxRes);
      if (freightRes) setFreight(freightRes);
      setLastRefresh(new Date());
      if (!selectedImpactRef.current || changed) {
        setSelectedImpact(a.criticalSignals[0]?.id ?? a.impacts[0]?.id ?? null);
      }
      try {
        const seeded = await seedIssuesIfEmpty(a.criticalSignals);
        setIssues(seeded);
      } catch (e) {
        setDbError(String(e));
      }
      if (isManual) {
        setToast(changed ? '✅ 새 데이터가 반영되었습니다' : 'ℹ️ 아직 새 데이터가 없습니다 (CI 대기 중)');
      }
      setLoadError(null);
    } catch (err) {
      if (isManual) setToast('❌ 데이터 로드 실패');
      if (!marketRef.current) setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, []);
  useEffect(() => {
    const id = setInterval(() => loadData(false), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadData]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  /* ── derived data ── */
  const hrc = market?.instruments.hrc;
  const impact = useMemo(
    () => analysis?.impacts.find((i) => i.id === selectedImpact) ?? analysis?.impacts[0] ?? null,
    [analysis, selectedImpact],
  );

  const isFiltered = filterRegion !== 'ALL' || filterProduct !== 'ALL';
  const matchFilter = (regions: string[], products: string[]) => {
    if (filterRegion !== 'ALL' && !regions.includes(filterRegion)) return false;
    if (filterProduct !== 'ALL' && !products.includes(filterProduct)) return false;
    return true;
  };

  const filteredCriticalSignals = useMemo(() => {
    if (!analysis) return [];
    if (!isFiltered) return analysis.criticalSignals;
    return analysis.criticalSignals.filter((s) => matchFilter(s.regions, s.products));
  }, [analysis, filterRegion, filterProduct]);

  const filteredSalesImpact = useMemo(() => {
    if (!analysis) return [];
    return analysis.salesImpact.filter((row) => {
      if (filterRegion !== 'ALL' && row.region !== filterRegion) return false;
      if (filterProduct !== 'ALL' && !row.products.includes(filterProduct)) return false;
      return true;
    });
  }, [analysis, filterRegion, filterProduct]);

  const filteredEventClusters = useMemo(() => {
    if (!analysis) return [];
    if (!isFiltered) return analysis.eventClusters;
    return analysis.eventClusters.filter((c) => matchFilter(c.regions, c.products));
  }, [analysis, filterRegion, filterProduct]);

  /* ── tab-filtered views ── */
  const signalsByTab = useMemo(() => {
    if (signalTab === 'ALL') return filteredCriticalSignals;
    if (signalTab === 'HIGH') return filteredCriticalSignals.filter((s) => s.severity === 'HIGH' || s.severity === 'CRITICAL');
    if (signalTab === 'MEDIUM') return filteredCriticalSignals.filter((s) => s.severity === 'MEDIUM');
    return filteredCriticalSignals.filter((s) => s.severity === 'LOW');
  }, [filteredCriticalSignals, signalTab]);

  const highCount = filteredCriticalSignals.filter((s) => s.severity === 'HIGH' || s.severity === 'CRITICAL').length;
  const medCount = filteredCriticalSignals.filter((s) => s.severity === 'MEDIUM').length;
  const lowCount = filteredCriticalSignals.filter((s) => s.severity === 'LOW').length;

  // Sales Impact risk-type tabs (dynamically extracted)
  const salesRiskTypes = useMemo(() => {
    const types = new Set(filteredSalesImpact.map((r) => r.riskTypeKo ?? r.riskType));
    return ['ALL', ...Array.from(types)];
  }, [filteredSalesImpact]);

  const salesByTab = useMemo(() => {
    if (salesRiskTab === 'ALL') return filteredSalesImpact;
    return filteredSalesImpact.filter((r) => (r.riskTypeKo ?? r.riskType) === salesRiskTab);
  }, [filteredSalesImpact, salesRiskTab]);

  // Event Radar risk-type tabs (dynamically extracted)
  const eventRiskTypes = useMemo(() => {
    const types = new Set(filteredEventClusters.map((c) => c.riskTypeKo ?? c.riskType));
    return ['ALL', ...Array.from(types)];
  }, [filteredEventClusters]);

  const eventsByTab = useMemo(() => {
    if (eventThemeTab === 'ALL') return filteredEventClusters;
    return filteredEventClusters.filter((c) => (c.riskTypeKo ?? c.riskType) === eventThemeTab);
  }, [filteredEventClusters, eventThemeTab]);

  const totalEventPages = Math.max(1, Math.ceil(eventsByTab.length / EVENTS_PER_PAGE));
  const clampedPage = Math.min(eventPage, totalEventPages);
  const pagedEvents = eventsByTab.slice((clampedPage - 1) * EVENTS_PER_PAGE, clampedPage * EVENTS_PER_PAGE);

  // Reset pages when tabs change
  useEffect(() => { setEventPage(1); }, [eventThemeTab]);
  useEffect(() => { setNewsPage(1); }, [newsDateFilter, eventThemeTab]);

  // News digest for Event Radar
  const NEWS_PER_PAGE = 8;
  const newsDigest = useMemo(() => {
    const items = analysis?.newsDigest ?? [];
    let filtered = items;
    if (eventThemeTab !== 'ALL') {
      filtered = filtered.filter((n) => n.theme === eventThemeTab);
    }
    if (newsDateFilter) {
      filtered = filtered.filter((n) => n.publishedAt.startsWith(newsDateFilter));
    }
    return filtered;
  }, [analysis, eventThemeTab, newsDateFilter]);

  const newsThemes = useMemo(() => {
    const themes = new Set((analysis?.newsDigest ?? []).map((n) => n.theme));
    return ['ALL', ...Array.from(themes)];
  }, [analysis]);

  const totalNewsPages = Math.max(1, Math.ceil(newsDigest.length / NEWS_PER_PAGE));
  const clampedNewsPage = Math.min(newsPage, totalNewsPages);
  const pagedNews = newsDigest.slice((clampedNewsPage - 1) * NEWS_PER_PAGE, clampedNewsPage * NEWS_PER_PAGE);

  // Selected chart instrument
  const chartInst = market?.instruments[chartInstrument] ?? hrc;
  const chartInstLabel = INSTRUMENT_KO[chartInstrument] ?? chartInst?.labelKo ?? chartInstrument;

  // Chart timeframe stats
  const chartStats = useMemo(() => {
    if (!chartInst) return null;
    if (chartTimeframe === '30m') {
      return {
        label: '30분봉',
        last: chartInst.last,
        change: chartInst.change.today,
        high: chartInst.high,
        low: chartInst.low,
        volume: chartInst.volume,
        oi: chartInst.openInterest,
      };
    }
    const daily = chartInst.daily ?? [];
    if (daily.length === 0) return null;
    const last = daily[daily.length - 1];
    const prev = daily.length >= 2 ? daily[daily.length - 2] : null;
    const change = prev ? ((last.c - prev.c) / prev.c) * 100 : null;

    if (chartTimeframe === 'daily') {
      return { label: '일봉', last: last.c, change, high: last.h, low: last.l, volume: last.v, oi: last.oi };
    }
    // Weekly/monthly: aggregate
    const period = chartTimeframe === 'weekly' ? 5 : 22;
    const slice = daily.slice(-period);
    const periodHigh = Math.max(...slice.map((b) => b.h));
    const periodLow = Math.min(...slice.map((b) => b.l));
    const periodVol = slice.reduce((s, b) => s + (b.v ?? 0), 0);
    const periodStart = slice[0];
    const periodChange = periodStart ? ((last.c - periodStart.o) / periodStart.o) * 100 : null;
    return {
      label: chartTimeframe === 'weekly' ? '주봉' : '월봉',
      last: last.c,
      change: periodChange,
      high: periodHigh,
      low: periodLow,
      volume: periodVol,
      oi: last.oi,
    };
  }, [chartInst, chartTimeframe]);

  /* ── issue handlers ── */
  async function onCreateIssue(target: Impact, region: string, action: string) {
    try {
      const created = await createIssue(target, region, action);
      setIssues(await listIssues());
      setToast(created ? `이슈 #${created.id} 생성됨` : '이미 열려 있는 이슈가 있습니다');
    } catch (err) {
      setDbError(String(err));
    }
  }

  async function onStatus(id: number, status: IssueStatus) {
    await updateIssueStatus(id, status);
    setIssues(await listIssues());
  }

  async function onDelete(id: number) {
    await deleteIssue(id);
    setIssues(await listIssues());
  }

  /* ── loading / error states ── */
  if (loadError) {
    return (
      <div className="p-8 text-[13px]">
        <div className="eyebrow mb-2">데이터 로드 오류</div>
        <p className="num text-[var(--color-risk-high)]">{loadError}</p>
        <p className="mt-2 text-[var(--color-muted)]">
          <code>npm run refresh</code> 로 수집기를 먼저 실행하세요.
        </p>
      </div>
    );
  }

  if (!market || !analysis || !hrc) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-[var(--color-steel)] text-[14px] font-bold tracking-widest mb-2">LOADING</div>
          <div className="text-[var(--color-faint)] text-[11px]">수집된 데이터를 불러오고 있습니다...</div>
        </div>
      </div>
    );
  }

  const session = sessionState(hrc.sourceTimestamp);
  const collectedAgo = minutesSince(analysis.generatedAt);
  const stale = collectedAgo > 90;

  const activeIssues = issues.filter((i) => i.status !== 'RESOLVED');

  /* ══════════════════════════════════════════════════════════════════
   *  RENDER
   * ══════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen">
      {/* ════════════════════════════ HEADER ════════════════════════════ */}
      <header className="border-b border-[var(--color-slate-line)] bg-[var(--color-panel)]">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md flex items-center justify-center text-[16px] font-black"
              style={{ background: 'linear-gradient(135deg, var(--color-steel), #7c4dff)', color: '#fff' }}>
              S
            </div>
            <div>
              <div className="text-[14px] font-bold tracking-[0.04em] text-[var(--color-ink)]">
                STEEL SALES RISK INTELLIGENCE
              </div>
              <div className="text-[10px] text-[var(--color-faint)] tracking-[0.06em]">
                도금 · 컬러강판 수출 조기경보 대시보드
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px]">
            {/* Tools */}
            <button
              className="theme-toggle"
              onClick={() => setSimulatorOpen(true)}
              title="원재료 비중 시뮬레이터"
            >
              <span style={{ fontSize: '14px' }}>🧮</span>
              원가 시뮬레이터
            </button>

            {/* Theme toggle */}
            <button
              className="theme-toggle"
              onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            >
              <span style={{ fontSize: '14px' }}>{theme === 'dark' ? '☀️' : '🌙'}</span>
              {theme === 'dark' ? '라이트' : '다크'}
            </button>

            <StatusChip label="MODE" value="PROTOTYPE" tone="var(--color-risk-med)" />
            <StatusChip label="HRC" value={session.labelKo} tone={session.tone} />
            <StatusChip
              label="DATA"
              value={stale ? `STALE · ${collectedAgo}분 전` : `${collectedAgo}분 전`}
              tone={stale ? 'var(--color-risk-med)' : 'var(--color-ok)'}
              pulse={!stale}
            />
            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="flex items-center gap-1.5 border rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-all"
              style={{
                borderColor: refreshing ? 'var(--color-slate-line)' : 'var(--color-steel)',
                color: refreshing ? 'var(--color-faint)' : 'var(--color-steel)',
                background: refreshing ? 'transparent' : 'rgba(79,195,247,0.08)',
                cursor: refreshing ? 'wait' : 'pointer',
              }}
              title="CI에서 수집된 최신 데이터를 다시 불러옵니다"
            >
              <span className={refreshing ? 'animate-spin' : ''} style={{ display: 'inline-block' }}>↻</span>
              {refreshing ? '로딩 중...' : '새로고침'}
            </button>
            <div className="num text-[var(--color-faint)] text-right">
              <div>수집 {fmtIso(analysis.generatedAt)}</div>
              <div className="text-[9px]">수집 주기: 30분 (GitHub Actions)</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-5">

        {/* ════════════════════════════ HERO STAT CARDS ════════════════════════════ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="cursor-pointer" onClick={() => signalsRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            <StatCard label="위험 신호" value={highCount} sub={`HIGH 이상 ${highCount}건${isFiltered ? ' (필터)' : ''}`} tone="high" />
          </div>
          <div className="cursor-pointer" onClick={() => signalsRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            <StatCard label="주의 신호" value={medCount} sub={`MEDIUM ${medCount}건${isFiltered ? ' (필터)' : ''}`} tone="med" />
          </div>
          <div className="cursor-pointer" onClick={() => eventsRef.current?.scrollIntoView({ behavior: 'smooth' })}>
            <StatCard label="뉴스 수집" value={(analysis.newsDigest ?? []).length}
              sub={`${newsThemes.length - 1}개 테마 · ${analysis.inputs.articlesCollected}건 중${isFiltered ? ' (필터)' : ''}`} tone="steel" />
          </div>
          <StatCard label="활성 이슈" value={activeIssues.length} sub={`전체 ${issues.length}건`}
            tone={issues.some((i) => i.status === 'ACTION_REQUIRED') ? 'med' : 'steel'} />
        </div>

        {/* ════════════════════════════ FILTER BAR ════════════════════════════ */}
        <div className="flex flex-wrap items-center gap-3 px-1">
          <span className="eyebrow">필터</span>
          {isFiltered && (
            <span className="text-[10px] text-[var(--color-risk-med)] font-semibold">● 필터 적용 중 — 전체 대시보드에 반영</span>
          )}
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="전체 지역" active={filterRegion === 'ALL'} onClick={() => setFilterRegion('ALL')} />
            {ALL_REGIONS.map((r) => (
              <FilterChip key={r} label={r} active={filterRegion === r} onClick={() => setFilterRegion(r)} />
            ))}
          </div>
          <div className="w-px h-5 bg-[var(--color-slate-line)]" />
          <div className="flex flex-wrap gap-1.5">
            <FilterChip label="전체 제품" active={filterProduct === 'ALL'} onClick={() => setFilterProduct('ALL')} />
            {ALL_PRODUCTS.map((p) => (
              <FilterChip key={p} label={p} active={filterProduct === p} onClick={() => setFilterProduct(p)} />
            ))}
          </div>
        </div>

        {/* ════════════════════════════ 01 MARKET PULSE ════════════════════════════ */}
        <Panel
          title="MARKET PULSE"
          titleKo="실시간 시장 현황"
          index="01"
          glow="steel"
          meta={
            <>
              SHFE + Sina · {analysis.inputs.instrumentsCovered}개 선물
              {market.failures.length > 0 && (
                <span className="ml-2 text-[var(--color-risk-high)]">{market.failures.length} FAILED</span>
              )}
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>품목</th>
                  <th>계약</th>
                  <th className="text-right">최종가</th>
                  <th className="text-right">당일</th>
                  <th className="text-right">30분</th>
                  <th className="text-right">60분</th>
                  <th className="text-right">120분</th>
                  <th className="text-right">거래량</th>
                  <th className="text-right">미결제</th>
                  <th>출처</th>
                  <th>거래소 시각</th>
                </tr>
              </thead>
              <tbody>
                {PULSE_ORDER.filter((k) => market.instruments[k]).map((key) => {
                  const it = market.instruments[key];
                  return (
                    <tr key={key}>
                      <td className="font-semibold whitespace-nowrap">
                        {INSTRUMENT_KO[key] ?? it.labelKo}
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--color-faint)]">{it.exchange}</span>
                      </td>
                      <td className="num text-[11px] text-[var(--color-muted)]">{it.contract}</td>
                      <td className="num text-right font-bold text-[var(--color-ink)]">{it.last?.toLocaleString()}</td>
                      <td className="text-right"><Pct value={it.change.today} /></td>
                      <td className="text-right"><Pct value={it.change.m30} /></td>
                      <td className="text-right"><Pct value={it.change.m60} /></td>
                      <td className="text-right"><Pct value={it.change.m120} /></td>
                      <td className="num text-right text-[var(--color-muted)]">{it.volume?.toLocaleString() ?? '—'}</td>
                      <td className="num text-right text-[var(--color-muted)]">{it.openInterest?.toLocaleString() ?? '—'}</td>
                      <td className="text-[10px]">
                        <span
                          className="border px-1.5 py-px rounded-sm"
                          style={{
                            borderColor: it.exchange === 'SHFE' ? 'rgba(79,195,247,0.4)' : 'var(--color-slate-line)',
                            color: it.exchange === 'SHFE' ? 'var(--color-steel)' : 'var(--color-faint)',
                            background: it.exchange === 'SHFE' ? 'rgba(79,195,247,0.06)' : 'transparent',
                          }}
                        >
                          {it.exchange === 'SHFE' ? '공식' : '비공식'}
                        </span>
                      </td>
                      <td className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">{it.sourceTimestamp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--color-slate-line)] px-4 py-2 text-[10px] text-[var(--color-faint)]">
            30분 / 60분 / 120분은 완료된 30분봉 기준입니다 (세션 브레이크 제외). 거래소 시각은 Asia/Shanghai 기준.
          </div>
        </Panel>

        {/* ════════════════════════════ FX MONITOR ════════════════════════════ */}
        {fx && fx.pairs.length > 0 && (
          <div className="panel overflow-x-auto">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-slate-line)]">
              <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--color-steel)]">💱 환율 모니터링</span>
              <span className="text-[9px] text-[var(--color-faint)] num">
                {fx.source} · 기준일 {fx.referenceDate}
              </span>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 divide-x divide-[var(--color-slate-line)]">
              {fx.pairs.map((pair) => (
                <div key={pair.key} className="px-3 py-2.5 text-center">
                  <div className="text-[10px] font-medium text-[var(--color-muted)] mb-0.5">{pair.labelKo}</div>
                  <div className="num text-[14px] font-bold text-[var(--color-ink)]">
                    {pair.rate.toLocaleString(undefined, {
                      minimumFractionDigits: pair.key.includes('KRW') ? 2 : 4,
                      maximumFractionDigits: pair.key.includes('KRW') ? 2 : 4,
                    })}
                  </div>
                  <div className="flex items-center justify-center gap-2 mt-0.5">
                    <Pct value={pair.change1d} />
                    {pair.change1w !== null && (
                      <span className="text-[9px] text-[var(--color-faint)] num">주간 <Pct value={pair.change1w} /></span>
                    )}
                  </div>
                  {/* Mini sparkline */}
                  {pair.spark.length > 2 && (
                    <svg viewBox={`0 0 ${pair.spark.length} 20`} className="w-full h-3 mt-1" preserveAspectRatio="none">
                      <polyline
                        points={pair.spark.map((s, i) => {
                          const min = Math.min(...pair.spark.map((p) => p.value));
                          const max = Math.max(...pair.spark.map((p) => p.value));
                          const range = max - min || 1;
                          return `${i},${20 - ((s.value - min) / range) * 18}`;
                        }).join(' ')}
                        fill="none"
                        stroke="var(--color-steel)"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════════════════ FREIGHT MONITOR ════════════════════════════ */}
        {freight && freight.tickers.length > 0 && (
          <div className="panel overflow-x-auto">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-slate-line)]">
              <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--color-steel)]">🚢 해상운임 모니터링</span>
              <span className="text-[9px] text-[var(--color-faint)] num">
                Yahoo Finance (ETF 기반) · {freight.tickers[0]?.lastDate ?? ''}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--color-slate-line)]">
              {freight.tickers.map((t) => {
                const catEmoji = t.category === 'bulk' ? '📦' : t.category === 'container' ? '🚢' : t.category === 'tanker' ? '🛢️' : '🌊';
                const catLabel = t.category === 'bulk' ? '벌크' : t.category === 'container' ? '컨테이너' : t.category === 'tanker' ? '탱커' : '종합';
                return (
                  <div key={t.symbol} className="px-3 py-2.5 text-center">
                    <div className="text-[10px] font-medium text-[var(--color-muted)] mb-0.5">
                      {catEmoji} {t.labelKo}
                    </div>
                    <div className="num text-[14px] font-bold text-[var(--color-ink)]">
                      ${t.last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="flex items-center justify-center gap-2 mt-0.5">
                      <Pct value={t.change1d} />
                      {t.change1w !== null && (
                        <span className="text-[9px] text-[var(--color-faint)] num">주간 <Pct value={t.change1w} /></span>
                      )}
                    </div>
                    <div className="flex items-center justify-center gap-1.5 mt-0.5 text-[9px] text-[var(--color-faint)]">
                      <span>{catLabel}</span>
                      <span>·</span>
                      <span>{t.symbol}</span>
                    </div>
                    {/* Mini sparkline */}
                    {t.spark.length > 2 && (
                      <svg viewBox={`0 0 ${t.spark.length} 20`} className="w-full h-3 mt-1" preserveAspectRatio="none">
                        <polyline
                          points={t.spark.map((s, i) => {
                            const min = Math.min(...t.spark.map((p) => p.value));
                            const max = Math.max(...t.spark.map((p) => p.value));
                            const range = max - min || 1;
                            return `${i},${20 - ((s.value - min) / range) * 18}`;
                          }).join(' ')}
                          fill="none"
                          stroke="var(--color-steel)"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════════════════ 02+04 CRITICAL SIGNALS + RISK BRIEF (SIDE-BY-SIDE) ════════════════════════════ */}
        <div ref={signalsRef}>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* ─── LEFT: Critical Signals ─── */}
            <Panel
              title="CRITICAL SIGNALS"
              titleKo={`핵심 위험 신호${isFiltered ? ' (필터 적용)' : ''}`}
              index="02"
              glow={highCount > 0 ? 'high' : undefined}
              meta={`${filteredCriticalSignals.length}건${isFiltered ? ` / 전체 ${analysis.criticalSignals.length}건` : ''} · 규칙 ${analysis.ruleCount}개`}
            >
              {/* Severity tabs */}
              <div className="tab-bar">
                <TabChip label="전체" count={filteredCriticalSignals.length} active={signalTab === 'ALL'}
                  onClick={() => setSignalTab('ALL')} />
                <TabChip label="🔴 HIGH" count={highCount} active={signalTab === 'HIGH'}
                  onClick={() => setSignalTab('HIGH')} />
                <TabChip label="🟡 MEDIUM" count={medCount} active={signalTab === 'MEDIUM'}
                  onClick={() => setSignalTab('MEDIUM')} />
                {lowCount > 0 && (
                  <TabChip label="⚪ LOW" count={lowCount} active={signalTab === 'LOW'}
                    onClick={() => setSignalTab('LOW')} />
                )}
              </div>

              {signalsByTab.length === 0 ? (
                <EmptyState text={
                  signalTab !== 'ALL'
                    ? `${signalTab} 등급 위험 신호가 없습니다.`
                    : isFiltered
                      ? '선택한 필터 조건에 맞는 위험 신호가 없습니다.'
                      : '현재 임계값을 넘은 위험 신호가 없습니다.'
                } />
              ) : (
                <div className="divide-y divide-[var(--color-slate-line)] max-h-[600px] overflow-y-auto">
                  {signalsByTab.map((sig) => {
                    const isExpanded = expandedSignal === sig.id;
                    const isSelected = selectedImpact === sig.id;
                    return (
                      <div key={sig.id}>
                        <button
                          onMouseEnter={() => setSelectedImpact(sig.id)}
                          onClick={() => {
                            setExpandedSignal(isExpanded ? null : sig.id);
                            setSelectedImpact(sig.id);
                          }}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-steel-soft)] ${
                            isSelected ? 'bg-[var(--color-steel-mid)]' : ''
                          }`}
                        >
                          <SeverityTag severity={sig.severity} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-x-2">
                              <span className="text-[13px] font-semibold text-[var(--color-ink)]">
                                {sig.ruleNameKo ?? sig.ruleName}
                              </span>
                              <Arrow direction={sig.direction} />
                              <span className="text-[10px] text-[var(--color-faint)]">
                                {sig.origin === 'MARKET_SIGNAL' ? '시장 신호' : '뉴스 클러스터'}
                                {' · '}{sig.riskTypeKo ?? sig.riskType}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11.5px] text-[var(--color-muted)]">{sig.fact}</div>
                            {!isExpanded && (
                              <div className="mt-1 text-[10.5px] text-[var(--color-steel)]">
                                ▸ 클릭하여 근거 확인 · 마우스 올려서 브리프 보기
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <ConfidenceTag confidence={sig.confidence} />
                            <span className="text-[10px] text-[var(--color-faint)]">{sig.regions.slice(0, 3).join(' · ')}</span>
                            <span className="text-[10px] text-[var(--color-faint)]">{sig.products.slice(0, 4).join(' · ')}</span>
                          </div>
                        </button>

                        {/* Expanded: evidence articles + actions */}
                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 space-y-3 border-l-2 ml-4 border-[var(--color-steel)]"
                            style={{ background: 'linear-gradient(90deg, var(--color-steel-soft), transparent 50%)' }}>

                            {sig.evidence && sig.evidence.length > 0 && (
                              <div>
                                <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">
                                  📋 근거 기사 — {sig.evidence.length}건
                                </div>
                                <ul className="space-y-2">
                                  {sig.evidence.map((e: any) => (
                                    <li key={e.id} className="rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-surface)]"
                                      style={{ border: '1px solid var(--color-slate-line)' }}>
                                      {/* Korean title (primary) */}
                                      <div className="text-[12px] font-medium text-[var(--color-ink)] leading-snug mb-1">
                                        {e.titleKo || articleContextKo(e.title) || e.title}
                                      </div>
                                      {/* English original (secondary link) */}
                                      <a href={e.link} target="_blank" rel="noreferrer noopener"
                                        className="text-[10.5px] text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block">
                                        ↗ {e.title}
                                      </a>
                                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-faint)] num">
                                        <span>{e.source}</span>
                                        <span>·</span>
                                        <span>{e.publishedAt.slice(0, 10)}</span>
                                        <span className="inline-block px-1 py-px rounded-sm text-[9px] font-bold bg-[var(--color-steel-soft)] text-[var(--color-steel)]">
                                          {tradePolicyLabel(e.title)}
                                        </span>
                                        {targetCountry(e.title) && (
                                          <span className="text-[9px] font-medium text-[var(--color-risk-med)]">{targetCountry(e.title)}</span>
                                        )}
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div>
                              <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-ok)] mb-1.5 uppercase">
                                ✅ 권장 조치
                              </div>
                              <ul className="space-y-1.5">
                                {(sig.actionsKo?.length ? sig.actionsKo : sig.actions).map((a: string) => (
                                  <li key={a} className="flex items-start justify-between gap-2 text-[12px] text-[var(--color-ink)]">
                                    <span>· {a}</span>
                                    <button
                                      className="shrink-0 border border-[var(--color-slate-line)] rounded-sm px-2 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)] hover:bg-[var(--color-steel-soft)] transition-colors"
                                      onClick={(ev) => { ev.stopPropagation(); onCreateIssue(sig, sig.regions[0], a); }}
                                    >
                                      + 이슈
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>

            {/* ─── RIGHT: Risk Brief (sticky, changes on hover/click) ─── */}
            <div className="lg:sticky lg:top-4 lg:self-start">
              <Panel
                title="RISK BRIEF"
                titleKo="위험 분석 브리프 — 왼쪽 신호에 마우스를 올리면 자동 변경됩니다"
                index="04"
                glow={impact?.severity === 'HIGH' || impact?.severity === 'CRITICAL' ? 'high' : impact?.severity === 'MEDIUM' ? 'med' : undefined}
                meta={impact ? `${impact.ruleId} · ${impact.origin === 'MARKET_SIGNAL' ? '시장' : '뉴스'} · ${impact.riskTypeKo ?? impact.riskType}` : undefined}
              >
                {!impact ? (
                  <EmptyState text="왼쪽 핵심 신호에 마우스를 올리거나 클릭하세요." />
                ) : (
                  <div className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityTag severity={impact.severity} />
                      <ConfidenceTag confidence={impact.confidence} />
                      <span className="text-[12px] font-semibold text-[var(--color-ink)]">
                        {impact.ruleNameKo ?? impact.ruleName}
                      </span>
                    </div>

                    {impact.narrativeKo && (
                      <div className="rounded-md px-3.5 py-2.5 text-[12px] leading-[1.6] text-[var(--color-ink)]"
                        style={{ background: 'linear-gradient(135deg, var(--color-risk-med-soft), var(--color-risk-high-soft))' }}>
                        <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-risk-med)] mb-1">
                          💡 왜 위험한가 — 영업 영향
                        </div>
                        {impact.narrativeKo}
                      </div>
                    )}

                    <Epistemic kind="FACT">
                      {impact.fact}
                      <div className="mt-1 text-[10px] text-[var(--color-faint)] num">
                        {impact.factSource} · {impact.factTimestamp}
                      </div>
                    </Epistemic>

                    <Epistemic kind="RULE">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        {(impact.chainKo ?? impact.chain).map((step: string, i: number) => (
                          <span key={step} className="flex items-center gap-1">
                            {i > 0 && <span className="text-[var(--color-faint)]">→</span>}
                            <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[11px] ${
                              i === (impact.chainKo ?? impact.chain).length - 1
                                ? 'font-semibold text-[var(--color-ink)] bg-[var(--color-risk-high-soft)] border border-[var(--color-risk-high)]'
                                : 'text-[var(--color-muted)] bg-[var(--color-surface)]'
                            }`}>
                              {step}
                            </span>
                          </span>
                        ))}
                      </div>
                      {(impact.lagNoteKo ?? impact.lagNote) && (
                        <div className="mt-1 text-[10.5px] text-[var(--color-faint)]">⏱ {impact.lagNoteKo ?? impact.lagNote}</div>
                      )}
                    </Epistemic>

                    <Epistemic kind="INFERENCE">{impact.inference}</Epistemic>

                    <Epistemic kind="ACTION">
                      <ul className="space-y-1.5">
                        {(impact.actionsKo?.length ? impact.actionsKo : impact.actions).map((a: string) => (
                          <li key={a} className="flex items-start justify-between gap-2">
                            <span>· {a}</span>
                            <button
                              className="shrink-0 border border-[var(--color-slate-line)] rounded-sm px-2 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)] hover:bg-[var(--color-steel-soft)] transition-colors"
                              onClick={() => onCreateIssue(impact, impact.regions[0], a)}
                            >
                              + 이슈
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Epistemic>

                    {impact.corroborationNote && (
                      <div className="border border-dashed border-[var(--color-slate-line)] rounded px-3 py-2 text-[10.5px] text-[var(--color-muted)]">
                        {impact.corroborationNote}
                      </div>
                    )}

                    {impact.evidence && impact.evidence.length > 0 && (
                      <div>
                        <div className="eyebrow mb-1.5">근거 자료 · {impact.evidence.length}건</div>
                        <ul className="space-y-2">
                          {impact.evidence.slice(0, 4).map((e: any) => (
                            <li key={e.id} className="text-[11px] leading-snug rounded-md px-3 py-1.5"
                              style={{ border: '1px solid var(--color-slate-line)' }}>
                              <div className="text-[11.5px] font-medium text-[var(--color-ink)] mb-0.5">
                                {e.titleKo || articleContextKo(e.title) || e.title}
                              </div>
                              <a href={e.link} target="_blank" rel="noreferrer noopener"
                                className="text-[10px] text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2">
                                ↗ {e.title}
                              </a>
                              <div className="mt-0.5 text-[10px] text-[var(--color-faint)] num">
                                {e.source} · {e.publishedAt.slice(0, 10)}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>

        {/* ════════════════════════════ 03 SALES IMPACT (with risk-type tabs) ════════════════════════════ */}
        <Panel
          title="SALES IMPACT"
          titleKo={`판매 영향 분석${isFiltered ? ' (필터 적용)' : ''} — 리스크 유형별 탭으로 분류`}
          index="03"
          meta={`${filteredSalesImpact.length}건${isFiltered ? ` / 전체 ${analysis.salesImpact.length}건` : ''}`}
        >
          {/* Risk-type tabs */}
          <div className="tab-bar">
            {salesRiskTypes.map((type) => {
              const count = type === 'ALL' ? filteredSalesImpact.length : filteredSalesImpact.filter((r) => (r.riskTypeKo ?? r.riskType) === type).length;
              return (
                <TabChip key={type} label={type === 'ALL' ? '전체' : type} count={count}
                  active={salesRiskTab === type} onClick={() => setSalesRiskTab(type)} />
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>지역</th>
                  <th>제품</th>
                  <th>리스크 유형</th>
                  <th>위험도</th>
                  <th className="text-center">방향</th>
                  <th>신뢰도</th>
                  <th>필요 조치</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {salesByTab.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-[var(--color-faint)] py-6">
                      {salesRiskTab !== 'ALL' ? `${salesRiskTab} 유형 리스크가 없습니다.` : '판매 영향 항목이 없습니다.'}
                    </td>
                  </tr>
                ) : (
                  salesByTab.map((row) => {
                    const target = analysis.impacts.find((i) => i.id === row.impactId);
                    const isSalesExpanded = expandedSalesRow === row.id;
                    return (
                      <React.Fragment key={row.id}>
                        <tr
                          className={`cursor-pointer transition-colors ${isSalesExpanded ? 'bg-[var(--color-steel-mid)]' : 'hover:bg-[var(--color-steel-soft)]'}`}
                          onClick={() => {
                            setExpandedSalesRow(isSalesExpanded ? null : row.id);
                            setSelectedImpact(row.impactId);
                          }}
                        >
                          <td className="font-semibold whitespace-nowrap">{row.region}</td>
                          <td className="text-[11px] text-[var(--color-muted)]">{row.products.join(' / ')}</td>
                          <td className="text-[11px]">
                            <span className="inline-block px-1.5 py-px rounded-sm text-[10px] font-medium bg-[var(--color-surface)] border border-[var(--color-slate-line)]">
                              {row.riskTypeKo ?? row.riskType}
                            </span>
                          </td>
                          <td className="whitespace-nowrap"><SeverityTag severity={row.severity} /></td>
                          <td className="text-center"><Arrow direction={row.direction} /></td>
                          <td><ConfidenceTag confidence={row.confidence} /></td>
                          <td className="text-[11.5px] text-[var(--color-muted)]">
                            {row.action}
                            <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-steel)' }}>
                              {isSalesExpanded ? '▾ 접기' : '▸ 근거 보기'}
                            </div>
                          </td>
                          <td className="text-right whitespace-nowrap">
                            <button
                              className="border border-[var(--color-slate-line)] rounded-sm px-2 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)] hover:bg-[var(--color-steel-soft)] transition-colors"
                              onClick={(ev) => { ev.stopPropagation(); target && onCreateIssue(target, row.region, row.action); }}
                              disabled={!target}
                            >
                              + 이슈
                            </button>
                          </td>
                        </tr>
                        {isSalesExpanded && target && (
                          <tr>
                            <td colSpan={8} className="p-0 border-b-0">
                              <div className="px-4 pb-4 pt-2 ml-4 space-y-3 border-l-2 border-[var(--color-steel)]"
                                style={{ background: 'linear-gradient(90deg, var(--color-steel-soft), transparent 50%)' }}>
                                {target.narrativeKo && (
                                  <div className="rounded-md px-3.5 py-2.5 text-[12px] leading-[1.6] text-[var(--color-ink)]"
                                    style={{ background: 'linear-gradient(135deg, var(--color-risk-med-soft), var(--color-risk-high-soft))' }}>
                                    <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-risk-med)] mb-1">
                                      💡 왜 위험한가 — {row.region} 시장
                                    </div>
                                    {target.narrativeKo}
                                  </div>
                                )}
                                <div>
                                  <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">📰 인과 체인</div>
                                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                    {(target.chainKo ?? target.chain).map((step: string, i: number) => (
                                      <span key={step} className="flex items-center gap-1">
                                        {i > 0 && <span className="text-[var(--color-faint)]">→</span>}
                                        <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[11px] ${
                                          i === (target.chainKo ?? target.chain).length - 1
                                            ? 'font-semibold text-[var(--color-ink)] bg-[var(--color-risk-high-soft)] border border-[var(--color-risk-high)]'
                                            : 'text-[var(--color-muted)] bg-[var(--color-surface)]'
                                        }`}>
                                          {step}
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                                {target.evidence && target.evidence.length > 0 && (
                                  <div>
                                    <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">
                                      📋 근거 기사 — {target.evidence.length}건
                                    </div>
                                    <ul className="space-y-1.5">
                                      {target.evidence.slice(0, 4).map((e: any) => (
                                        <li key={e.id} className="rounded-md px-3 py-1.5 transition-colors hover:bg-[var(--color-surface)]"
                                          style={{ border: '1px solid var(--color-slate-line)' }}>
                                          <div className="text-[11.5px] font-medium text-[var(--color-ink)] leading-snug mb-0.5">
                                            {e.titleKo || articleContextKo(e.title) || e.title}
                                          </div>
                                          <a href={e.link} target="_blank" rel="noreferrer noopener"
                                            className="text-[10px] text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block">
                                            ↗ {e.title}
                                          </a>
                                          <div className="mt-0.5 text-[10px] text-[var(--color-faint)] num">
                                            {e.source} · {e.publishedAt.slice(0, 10)}
                                          </div>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-ok)] mb-1 uppercase">✅ 권장 조치</div>
                                <ul className="space-y-1">
                                  {(target.actionsKo?.length ? target.actionsKo : target.actions).map((a: string) => (
                                    <li key={a} className="flex items-start justify-between gap-2 text-[12px] text-[var(--color-ink)]">
                                      <span>· {a}</span>
                                      <button
                                        className="shrink-0 border border-[var(--color-slate-line)] rounded-sm px-2 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)] hover:bg-[var(--color-steel-soft)] transition-colors"
                                        onClick={(ev) => { ev.stopPropagation(); onCreateIssue(target, row.region, a); }}
                                      >
                                        + 이슈
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ════════════════════════════ 05 PRICE CHART (Multi-Instrument + Multi-Timeframe) ════════════════════════════ */}
        <Panel
          title="PRICE CHART"
          titleKo={`${chartInstLabel} — ${chartStats?.label ?? '30분봉'}`}
          index="05"
          glow="steel"
          meta={
            chartInst ? (
              <>
                {chartInst.contract} · 일봉 {(chartInst.daily ?? []).length}개 · 30분봉 {chartInst.bars.length}개
              </>
            ) : undefined
          }
        >
          {/* Instrument tabs */}
          <div className="tab-bar" style={{ borderBottom: '1px solid var(--color-slate-line)' }}>
            {(['hrc', 'zinc', 'aluminium'] as const).map((key) => {
              const inst = market.instruments[key];
              if (!inst) return null;
              return (
                <button key={key}
                  className={`tab-chip ${chartInstrument === key ? 'active' : ''}`}
                  onClick={() => { setChartInstrument(key); setChartTimeframe('30m'); }}
                >
                  {INSTRUMENT_KO[key] ?? inst.labelKo}
                  <span className="ml-1 text-[9px] num" style={{ color: 'var(--color-faint)' }}>
                    {inst.last?.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Timeframe tabs */}
          <div className="tab-bar">
            {([['30m', '30분봉'], ['daily', '일봉'], ['weekly', '주봉'], ['monthly', '월봉']] as const).map(([tf, label]) => {
              const hasDailyData = (chartInst?.daily ?? []).length > 0;
              const disabled = tf !== '30m' && !hasDailyData;
              return (
                <button key={tf}
                  className={`tab-chip ${chartTimeframe === tf ? 'active' : ''}`}
                  onClick={() => !disabled && setChartTimeframe(tf as Timeframe)}
                  style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                  title={disabled ? '일봉 데이터 없음' : undefined}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {chartInst && (
            <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-[var(--color-slate-line)] p-4 lg:border-b-0 lg:border-r">
                <Metric label="최종가" value={`${(chartStats?.last ?? chartInst.last)?.toLocaleString()} ${chartInst.unit}`} strong />
                <Metric label={chartTimeframe === '30m' ? '당일 변동' : `${chartStats?.label ?? ''} 변동`}
                  node={<Pct value={chartStats?.change ?? chartInst.change.today} />} strong />
                {chartTimeframe === '30m' && (
                  <>
                    <Metric label="30분" node={<Pct value={chartInst.change.m30} />} />
                    <Metric label="60분" node={<Pct value={chartInst.change.m60} />} />
                    <Metric label="120분" node={<Pct value={chartInst.change.m120} />} />
                    <Metric label="예상정산가" value={chartInst.preSettlement?.toLocaleString() ?? '—'} />
                  </>
                )}
                <Metric label={chartTimeframe === '30m' ? '당일 고가' : `${chartStats?.label ?? ''} 고가`}
                  value={(chartStats?.high ?? chartInst.high)?.toLocaleString() ?? '—'} />
                <Metric label={chartTimeframe === '30m' ? '당일 저가' : `${chartStats?.label ?? ''} 저가`}
                  value={(chartStats?.low ?? chartInst.low)?.toLocaleString() ?? '—'} />
                <Metric label={chartTimeframe === '30m' ? '거래량' : `${chartStats?.label ?? ''} 거래량`}
                  value={(chartStats?.volume ?? chartInst.volume)?.toLocaleString() ?? '—'} />
                <Metric label="미결제약정" value={(chartStats?.oi ?? chartInst.openInterest)?.toLocaleString() ?? '—'} />
                <div className="col-span-2 mt-2 space-y-0.5 border-t border-[var(--color-slate-line)] pt-2 text-[10px] text-[var(--color-faint)]">
                  <Line k="거래소 시각" v={chartInst.sourceTimestamp} />
                  <Line k="KST 시각" v={shanghaiToKst(chartInst.sourceTimestamp)} />
                  <Line k="수집 시각" v={fmtIso(chartInst.collectedAt)} />
                  <Line k="출처" v={chartInst.exchange === 'SHFE' ? 'SHFE 공개 지연 데이터' : 'Sina Finance (비공식)'} />
                  <Line k="히스토리" v={chartInst.historySource ?? 'N/A'} />
                </div>
              </dl>
              <div className="p-3">
                <Chart bars={chartInst.bars} daily={chartInst.daily ?? []} height={320} theme={theme} timeframe={chartTimeframe} />
                <div className="px-2 pt-1.5 text-[10px] text-[var(--color-faint)]">
                  {chartTimeframe === '30m'
                    ? '밝은 거래량 = SHFE 공식 봉 · 어두운 거래량 = Sina 백필 · 세션 브레이크 구간 제외'
                    : `${chartStats?.label ?? ''} 차트 — 일봉 데이터 기반 집계 · 각 캔들 변동률 표시`
                  }
                </div>
              </div>
            </div>
          )}
        </Panel>

        {/* ════════════════════════════ 06 NEWS DIGEST (글로벌 뉴스 일간지) ════════════════════════════ */}
        <div ref={eventsRef}>
          <Panel
            title="NEWS DIGEST"
            titleKo="글로벌 뉴스 일간지 — 철강 관련 거시·정책·시장 뉴스 종합"
            index="06"
            meta={
              <>
                {(analysis.newsDigest ?? []).length}건 수집 · {newsThemes.length - 1}개 테마 · 업데이트 {fmtIso(analysis.inputs.newsGeneratedAt)}
              </>
            }
          >
            {/* Theme tabs */}
            <div className="tab-bar" style={{ flexWrap: 'wrap' }}>
              {newsThemes.map((th) => {
                const count = th === 'ALL'
                  ? (analysis.newsDigest ?? []).length
                  : (analysis.newsDigest ?? []).filter((n) => n.theme === th).length;
                return (
                  <TabChip key={th} label={th === 'ALL' ? '📰 전체' : th} count={count}
                    active={eventThemeTab === th} onClick={() => setEventThemeTab(th)} />
                );
              })}
            </div>

            {/* Date search + info bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-[var(--color-slate-line)]">
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-[var(--color-faint)]">📅 일자 검색</label>
                <input
                  type="date"
                  value={newsDateFilter}
                  onChange={(e) => setNewsDateFilter(e.target.value)}
                  className="rounded-sm border border-[var(--color-slate-line)] bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-ink)]"
                  style={{ colorScheme: theme }}
                />
                {newsDateFilter && (
                  <button
                    onClick={() => setNewsDateFilter('')}
                    className="text-[10px] text-[var(--color-steel)] hover:underline"
                  >
                    ✕ 초기화
                  </button>
                )}
              </div>
              <div className="text-[10px] text-[var(--color-faint)] num">
                {newsDigest.length}건{newsDateFilter ? ` (${newsDateFilter})` : ''} · 페이지 {clampedNewsPage}/{totalNewsPages}
              </div>
            </div>

            {/* News article list */}
            <div className="divide-y divide-[var(--color-slate-line)]">
              {pagedNews.length === 0 ? (
                <EmptyState text={
                  newsDateFilter
                    ? `${newsDateFilter} 해당 일자에 수집된 뉴스가 없습니다.`
                    : eventThemeTab !== 'ALL'
                      ? `${eventThemeTab} 테마에 해당하는 뉴스가 없습니다.`
                      : '수집된 뉴스가 없습니다. npm run refresh로 데이터를 수집하세요.'
                } />
              ) : (
                pagedNews.map((article) => (
                  <div key={article.id} className="px-4 py-3 transition-colors hover:bg-[var(--color-steel-soft)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        {/* Theme badge */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                          <span className="inline-block px-1.5 py-px rounded-sm text-[9px] font-bold bg-[var(--color-steel-soft)] text-[var(--color-steel)] border border-[var(--color-steel)]" style={{ opacity: 0.8 }}>
                            {article.theme}
                          </span>
                          {article.lang === 'ko' && (
                            <span className="text-[9px] px-1 py-px rounded-sm bg-[var(--color-surface)] text-[var(--color-faint)]">🇰🇷 한국어</span>
                          )}
                          {article.domains.slice(0, 3).map((d) => (
                            <span key={d} className="text-[9px] px-1 py-px rounded-sm bg-[var(--color-surface)] text-[var(--color-faint)]">{d}</span>
                          ))}
                        </div>
                        {/* Korean title (primary) */}
                        <div className="text-[13px] font-medium text-[var(--color-ink)] leading-snug mb-1">
                          {article.titleKo || article.title}
                        </div>
                        {/* English original as link (if Korean translation exists) */}
                        {article.titleKo && article.titleKo !== article.title && (
                          <a href={article.link} target="_blank" rel="noreferrer noopener"
                            className="text-[10.5px] text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block mb-0.5">
                            ↗ {article.title}
                          </a>
                        )}
                        {/* If no Korean translation, title itself is the link */}
                        {(!article.titleKo || article.titleKo === article.title) && (
                          <a href={article.link} target="_blank" rel="noreferrer noopener"
                            className="text-[10.5px] text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block mb-0.5">
                            ↗ 원문 보기
                          </a>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">{article.publishedAt.slice(0, 10)}</div>
                        <div className="text-[10px] text-[var(--color-faint)]">{article.source}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {totalNewsPages > 1 && (
              <div className="flex items-center justify-center gap-1.5 px-4 py-3 border-t border-[var(--color-slate-line)]">
                <button className="page-btn" disabled={clampedNewsPage <= 1}
                  onClick={() => setNewsPage((p) => Math.max(1, p - 1))}>‹</button>
                {Array.from({ length: Math.min(totalNewsPages, 10) }, (_, i) => {
                  // Show pages around current page
                  const half = 5;
                  let start = Math.max(1, clampedNewsPage - half);
                  const end = Math.min(totalNewsPages, start + 9);
                  start = Math.max(1, end - 9);
                  return start + i;
                }).filter((p) => p <= totalNewsPages).map((p) => (
                  <button key={p} className={`page-btn ${p === clampedNewsPage ? 'active' : ''}`}
                    onClick={() => setNewsPage(p)}>
                    {p}
                  </button>
                ))}
                {totalNewsPages > 10 && clampedNewsPage < totalNewsPages - 5 && (
                  <span className="text-[10px] text-[var(--color-faint)]">…{totalNewsPages}</span>
                )}
                <button className="page-btn" disabled={clampedNewsPage >= totalNewsPages}
                  onClick={() => setNewsPage((p) => Math.min(totalNewsPages, p + 1))}>›</button>
              </div>
            )}

            <div className="px-4 py-2 border-t border-[var(--color-slate-line)] text-[10px] text-[var(--color-faint)]">
              💡 Google News RSS에서 수집된 뉴스의 메타데이터만 표시합니다. 본문은 원문 링크에서 확인하세요.
              테마별 탭과 일자 검색을 활용하여 관심 분야의 뉴스를 확인할 수 있습니다.
            </div>
          </Panel>
        </div>

        {/* ════════════════════════════ 07 조치 현황 추적기 (ISSUE & ACTION CENTER) ════════════════════════════ */}
        <Panel
          title="ACTION TRACKER"
          titleKo="조치 현황 추적기 — 위험 신호에 대한 대응 상태를 관리합니다"
          index="07"
          meta={
            <>
              {issues.length}건 · 미완료 {activeIssues.length}건
              {dbError && <span className="ml-2 text-[var(--color-risk-high)]">DB 오류</span>}
            </>
          }
        >
          {dbError && (
            <div className="border-b border-[var(--color-slate-line)] bg-[var(--color-risk-high-soft)] px-4 py-2 text-[11px] text-[var(--color-risk-high)] num">
              {dbError}
            </div>
          )}

          {/* Purpose explanation */}
          <div className="px-4 py-3 border-b border-[var(--color-slate-line)] text-[11.5px] text-[var(--color-muted)] bg-[var(--color-surface)]">
            <strong className="text-[var(--color-ink)]">사용법:</strong>{' '}
            위 Critical Signals, Sales Impact, Event Radar에서{' '}
            <span className="inline-block px-1.5 py-px border border-[var(--color-slate-line)] rounded-sm text-[10px] text-[var(--color-steel)]">+ 이슈</span>
            {' '}버튼을 클릭하면 해당 리스크가 이슈로 등록됩니다. 등록된 이슈의 진행 상태를 아래에서 관리하세요.
          </div>

          {issues.length === 0 ? (
            <EmptyState text="등록된 이슈가 없습니다. 위험 신호에서 [+ 이슈] 를 클릭하여 추적을 시작하세요." />
          ) : (
            <div className="p-4 space-y-4">
              {/* Status summary bar */}
              <div className="flex flex-wrap gap-3">
                {STATUSES.map((s) => {
                  const count = issues.filter((i) => i.status === s).length;
                  return (
                    <div key={s} className="flex items-center gap-1.5 text-[11px]">
                      <span>{STATUS_EMOJI[s]}</span>
                      <span className="text-[var(--color-muted)]">{STATUS_KO[s]}</span>
                      <span className="num font-semibold text-[var(--color-ink)]">{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Issue cards grouped by status */}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                {STATUSES.map((status) => {
                  const statusIssues = issues.filter((i) => i.status === status);
                  if (statusIssues.length === 0) return null;
                  return (
                    <div key={status}>
                      <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--color-faint)] mb-2">
                        {STATUS_EMOJI[status]} {STATUS_KO[status]} ({statusIssues.length})
                      </div>
                      <div className="space-y-2">
                        {statusIssues.map((issue) => (
                          <div key={issue.id} className="issue-card">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="text-[12px] font-semibold text-[var(--color-ink)] leading-snug">{issue.title}</div>
                              <span className="num text-[9px] text-[var(--color-faint)] shrink-0">#{issue.id}</span>
                            </div>
                            <div className="text-[10.5px] text-[var(--color-muted)] mb-2 leading-snug">{issue.action}</div>
                            <div className="text-[9.5px] text-[var(--color-faint)] num mb-2">
                              {issue.region} · {issue.rule_id} · {fmtIso(issue.created_at).slice(5)}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {STATUSES.filter((s) => s !== status).map((s) => (
                                <button key={s} onClick={() => onStatus(issue.id, s)}
                                  className="border border-[var(--color-slate-line)] rounded-sm px-1.5 py-px text-[9px] text-[var(--color-muted)] hover:border-[var(--color-steel)] hover:text-[var(--color-steel)] transition-colors">
                                  → {STATUS_KO[s]}
                                </button>
                              ))}
                              <button onClick={() => onDelete(issue.id)}
                                className="border border-[var(--color-slate-line)] rounded-sm px-1.5 py-px text-[9px] text-[var(--color-faint)] hover:text-[var(--color-risk-high)] hover:border-[var(--color-risk-high)] transition-colors ml-auto">
                                삭제
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Panel>

        {/* ════════════════════════════ FOOTER ════════════════════════════ */}
        <footer className="panel px-4 py-3 text-[10.5px] text-[var(--color-muted)]">
          <div className="eyebrow mb-1.5">데이터 출처 (DATA PROVENANCE)</div>
          <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            <Line k="시장 데이터 수집" v={fmtIso(market.generatedAt)} />
            <Line k="뉴스 수집" v={fmtIso(analysis.inputs.newsGeneratedAt)} />
            <Line k="분석 생성" v={fmtIso(analysis.generatedAt)} />
            <Line k="시장 수집 실패" v={`${market.failures.length}건`} />
            <Line k="뉴스 수집 실패" v={`${analysis.inputs.newsFailures.length}건`} />
            <Line k="적용 규칙" v={`${analysis.ruleCount}개 승인된 인과 규칙`} />
          </div>
          <p className="mt-2.5 max-w-[900px] leading-relaxed text-[var(--color-faint)]">
            PROTOTYPE MODE — 가격은 SHFE 공개 지연 데이터와 Sina Finance(비공식)에서 수집되며 실시간이 아닙니다.
            뉴스는 Google News RSS의 메타데이터만 수집하고 본문은 저장하지 않습니다. 추론(INFERENCE)은 승인된 규칙
            그래프에 의한 가능성 제시이며 사실이 아닙니다. 수집에 실패한 항목은 값을 채우지 않고 실패로 표시합니다.
          </p>
        </footer>
      </main>

      {/* ════════════════════════════ COST SIMULATOR MODAL ════════════════════════════ */}
      <CostSimulator
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        marketPrices={{
          hrc: hrc?.last,
          zinc: market?.instruments.zinc?.last,
          aluminium: market?.instruments.aluminium?.last,
        }}
        theme={theme}
      />

      {/* ════════════════════════════ TOAST ════════════════════════════ */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 border border-[var(--color-steel)] bg-[var(--color-panel)] px-4 py-2 text-[11px] text-[var(--color-steel)] rounded-md shadow-lg shadow-black/20">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
 *  SUB-COMPONENTS
 * ══════════════════════════════════════════════════════════════════ */

function StatusChip({ label, value, tone, pulse }: { label: string; value: string; tone: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {pulse && <span className="pulse-dot block w-1.5 h-1.5 rounded-full" style={{ background: tone }} />}
      <span className="eyebrow">{label}</span>
      <span className="num font-semibold" style={{ color: tone }}>{value}</span>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick}>{label}</button>
  );
}

function TabChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button className={`tab-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
      <span className="tab-count">{count}</span>
    </button>
  );
}

function Metric({ label, value, node, strong }: { label: string; value?: string; node?: React.ReactNode; strong?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className={`num ${strong ? 'text-[15px] font-bold' : 'text-[12px]'}`}>{node ?? value}</dd>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[var(--color-faint)]">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-4 py-8 text-center text-[11.5px] text-[var(--color-faint)]">{text}</div>;
}
