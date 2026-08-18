import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from './Chart';
import { Panel, SeverityTag, ConfidenceTag, Arrow, Pct, Epistemic, StatCard } from './ui';
import { createIssue, deleteIssue, listIssues, updateIssueStatus, seedIssuesIfEmpty } from './db';
import type { Analysis, Impact, Issue, IssueStatus, MarketData } from './types';

const BASE = import.meta.env.BASE_URL;
const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5분마다 자동 새로고침
const KST = 'Asia/Seoul';
const PULSE_ORDER = ['hrc', 'rebar', 'zinc', 'aluminium', 'ironOre', 'cokingCoal'];
const STATUSES: IssueStatus[] = ['NEW', 'REVIEWING', 'ACTION_REQUIRED', 'RESOLVED'];
const ALL_REGIONS = ['China', 'Asia', 'Korea Export', 'Europe', 'GCC', 'US'];
const ALL_PRODUCTS = ['CRC', 'GI', 'GL', 'PPGI', 'COLOR'];

const INSTRUMENT_KO: Record<string, string> = {
  hrc: '열연강판 (HRC)',
  rebar: '철근',
  zinc: '아연',
  aluminium: '알루미늄',
  ironOre: '철광석',
  cokingCoal: '원료탄',
};

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

export function App() {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
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

  // Refs for values loadData reads but shouldn't trigger recreation
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;
  const analysisRef = useRef(analysis);
  analysisRef.current = analysis;
  const selectedImpactRef = useRef(selectedImpact);
  selectedImpactRef.current = selectedImpact;
  const marketRef = useRef(market);
  marketRef.current = market;

  /** Cache-busting fetch for JSON data files */
  const loadData = useCallback(async (isManual = false) => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    try {
      const bust = `?t=${Date.now()}`;
      const [m, a] = await Promise.all([
        fetch(`${BASE}data/market.json${bust}`).then((r) => r.json()),
        fetch(`${BASE}data/analysis.json${bust}`).then((r) => r.json()),
      ]);

      // Check if data actually changed (compare generatedAt)
      const changed = !analysisRef.current || a.generatedAt !== analysisRef.current.generatedAt;

      setMarket(m);
      setAnalysis(a);
      setLastRefresh(new Date());
      if (!selectedImpactRef.current || changed) {
        setSelectedImpact(a.criticalSignals[0]?.id ?? a.impacts[0]?.id ?? null);
      }

      // Auto-seed issues from critical signals on first visit
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
      if (isManual) {
        setToast('❌ 데이터 로드 실패');
      }
      if (!marketRef.current) setLoadError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, []); // stable — reads from refs, never recreated

  // Initial load
  useEffect(() => { loadData(); }, []);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(() => loadData(false), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadData]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const hrc = market?.instruments.hrc;
  const impact = useMemo(
    () => analysis?.impacts.find((i) => i.id === selectedImpact) ?? analysis?.impacts[0] ?? null,
    [analysis, selectedImpact],
  );

  // Filtered sales impact
  const filteredSalesImpact = useMemo(() => {
    if (!analysis) return [];
    return analysis.salesImpact.filter((row) => {
      if (filterRegion !== 'ALL' && row.region !== filterRegion) return false;
      if (filterProduct !== 'ALL' && !row.products.includes(filterProduct)) return false;
      return true;
    });
  }, [analysis, filterRegion, filterProduct]);

  async function onCreateIssue(target: Impact, region: string, action: string) {
    try {
      const created = await createIssue(target, region, action);
      setIssues(await listIssues());
      setToast(created ? `Issue #${created.id} 생성됨` : '이미 열려 있는 Issue가 있습니다');
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
  const highCount = analysis.criticalSignals.filter((s) => s.severity === 'HIGH' || s.severity === 'CRITICAL').length;
  const medCount = analysis.criticalSignals.filter((s) => s.severity === 'MEDIUM').length;

  return (
    <div className="min-h-screen">
      {/* ──────────────────────────────── HEADER ──────────────────────────────── */}
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
              title="서버에서 최신 데이터를 다시 불러옵니다 (5분마다 자동 새로고침)"
            >
              <span className={refreshing ? 'animate-spin' : ''} style={{ display: 'inline-block' }}>
                ↻
              </span>
              {refreshing ? '로딩 중...' : '새로고침'}
            </button>
            <div className="num text-[var(--color-faint)]">
              {fmtIso(analysis.generatedAt)} KST
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-5">

        {/* ──────────────── HERO STAT CARDS ──────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="위험 신호"
            value={highCount}
            sub={`HIGH 이상 ${highCount}건`}
            tone="high"
          />
          <StatCard
            label="주의 신호"
            value={medCount}
            sub={`MEDIUM ${medCount}건`}
            tone="med"
          />
          <StatCard
            label="이벤트 클러스터"
            value={analysis.eventClusters.length}
            sub={`뉴스 ${analysis.inputs.articlesRelevant}건 분석`}
            tone="steel"
          />
          <StatCard
            label="활성 이슈"
            value={issues.filter((i) => i.status !== 'RESOLVED').length}
            sub={`전체 ${issues.length}건`}
            tone={issues.some((i) => i.status === 'ACTION_REQUIRED') ? 'med' : 'steel'}
          />
        </div>

        {/* ──────────────── FILTER BAR ──────────────── */}
        <div className="flex flex-wrap items-center gap-3 px-1">
          <span className="eyebrow">필터</span>
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

        {/* ──────────────── 01 MARKET PULSE ──────────────── */}
        <Panel
          title="MARKET PULSE"
          titleKo="실시간 시장 현황"
          index="01"
          glow="steel"
          meta={
            <>
              SHFE + Sina · {analysis.inputs.instrumentsCovered}개 선물
              {market.failures.length > 0 && (
                <span className="ml-2 text-[var(--color-risk-high)]">
                  {market.failures.length} FAILED
                </span>
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
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--color-faint)]">
                          {it.exchange}
                        </span>
                      </td>
                      <td className="num text-[11px] text-[var(--color-muted)]">{it.contract}</td>
                      <td className="num text-right font-bold text-[var(--color-ink)]">{it.last?.toLocaleString()}</td>
                      <td className="text-right"><Pct value={it.change.today} /></td>
                      <td className="text-right"><Pct value={it.change.m30} /></td>
                      <td className="text-right"><Pct value={it.change.m60} /></td>
                      <td className="text-right"><Pct value={it.change.m120} /></td>
                      <td className="num text-right text-[var(--color-muted)]">
                        {it.volume?.toLocaleString() ?? '—'}
                      </td>
                      <td className="num text-right text-[var(--color-muted)]">
                        {it.openInterest?.toLocaleString() ?? '—'}
                      </td>
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
                      <td className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">
                        {it.sourceTimestamp}
                      </td>
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

        {/* ──────────────── 02 CRITICAL SIGNALS ──────────────── */}
        <Panel
          title="CRITICAL SIGNALS"
          titleKo="핵심 위험 신호 — 클릭하여 근거 확인"
          index="02"
          glow={highCount > 0 ? 'high' : undefined}
          meta={`${analysis.criticalSignals.length}건 감지 · 전체 ${analysis.impacts.length}건 · 규칙 ${analysis.ruleCount}개`}
        >
          {analysis.criticalSignals.length === 0 ? (
            <EmptyState text="현재 임계값을 넘은 위험 신호가 없습니다." />
          ) : (
            <div className="divide-y divide-[var(--color-slate-line)]">
              {analysis.criticalSignals.map((sig) => {
                const isExpanded = expandedSignal === sig.id;
                return (
                  <div key={sig.id}>
                    <button
                      onClick={() => {
                        setExpandedSignal(isExpanded ? null : sig.id);
                        setSelectedImpact(sig.id);
                      }}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--color-steel-soft)] ${
                        isExpanded ? 'bg-[var(--color-steel-mid)]' : ''
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
                            {' · '}
                            {sig.riskTypeKo ?? sig.riskType}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-[var(--color-muted)]">{sig.fact}</div>
                        {!isExpanded && sig.narrativeKo && (
                          <div className="mt-1 text-[10.5px] text-[var(--color-steel)]">
                            ▸ 클릭하여 근거 · 인과관계 · 조치 사항 확인
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <ConfidenceTag confidence={sig.confidence} />
                        <span className="text-[10px] text-[var(--color-faint)]">
                          {sig.regions.slice(0, 3).join(' · ')}
                        </span>
                        <span className="text-[10px] text-[var(--color-faint)]">
                          {sig.products.slice(0, 4).join(' · ')}
                        </span>
                        <span className="text-[10px] mt-0.5" style={{ color: 'var(--color-steel)' }}>
                          {isExpanded ? '▾ 접기' : '▸ 펼치기'}
                        </span>
                      </div>
                    </button>

                    {/* ── Expanded detail: WHY + EVIDENCE + ACTIONS ── */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-l-2 ml-4 border-[var(--color-steel)]"
                        style={{ background: 'linear-gradient(90deg, rgba(79,195,247,0.04), transparent 50%)' }}>

                        {sig.narrativeKo && (
                          <div className="rounded-md px-3.5 py-2.5 text-[12px] leading-[1.6] text-[var(--color-ink)]"
                            style={{ background: 'linear-gradient(135deg, rgba(255,171,64,0.1), rgba(255,82,82,0.06))' }}>
                            <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-risk-med)] mb-1">
                              💡 왜 위험한가 — 영업 영향
                            </div>
                            {sig.narrativeKo}
                          </div>
                        )}

                        <div>
                          <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">
                            📰 인과 체인
                          </div>
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                            {(sig.chainKo ?? sig.chain).map((step: string, i: number) => (
                              <span key={step} className="flex items-center gap-1">
                                {i > 0 && <span className="text-[var(--color-faint)]">→</span>}
                                <span className={`inline-block px-1.5 py-0.5 rounded-sm text-[11px] ${
                                  i === (sig.chainKo ?? sig.chain).length - 1
                                    ? 'font-semibold text-[var(--color-ink)] bg-[rgba(255,82,82,0.1)] border border-[rgba(255,82,82,0.3)]'
                                    : 'text-[var(--color-muted)] bg-[var(--color-surface)]'
                                }`}>
                                  {step}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>

                        {sig.evidence && sig.evidence.length > 0 && (
                          <div>
                            <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">
                              📋 근거 기사 — {sig.evidence.length}건 (클릭하여 원문 확인)
                            </div>
                            <ul className="space-y-2">
                              {sig.evidence.map((e: any) => (
                                <li key={e.id} className="rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-surface)]"
                                  style={{ border: '1px solid var(--color-slate-line)' }}>
                                  <a href={e.link} target="_blank" rel="noreferrer noopener"
                                    className="text-[12px] font-medium text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block">
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
                                  + 이슈 등록
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

        {/* ──────────────── 03 + 04 SALES IMPACT + RISK BRIEF ──────────────── */}
        <div className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <Panel
            title="SALES IMPACT"
            titleKo="판매 영향 분석"
            index="03"
            meta={`${filteredSalesImpact.length}건 ${filterRegion !== 'ALL' || filterProduct !== 'ALL' ? '(필터 적용)' : ''}`}
          >
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr>
                    <th>지역</th>
                    <th>제품</th>
                    <th>위험도</th>
                    <th className="text-center">방향</th>
                    <th>신뢰도</th>
                    <th>필요 조치</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredSalesImpact.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-[var(--color-faint)] py-6">
                        필터 조건에 맞는 항목이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredSalesImpact.map((row) => {
                      const target = analysis.impacts.find((i) => i.id === row.impactId);
                      return (
                        <tr key={row.id}
                          className="cursor-pointer hover:bg-[var(--color-steel-soft)] transition-colors"
                          onClick={() => {
                            setSelectedImpact(row.impactId);
                            setExpandedSignal(row.impactId);
                          }}
                          title="클릭하여 상세 근거 확인"
                        >
                          <td className="font-semibold whitespace-nowrap">{row.region}</td>
                          <td className="text-[11px] text-[var(--color-muted)]">{row.products.join(' / ')}</td>
                          <td className="whitespace-nowrap">
                            <SeverityTag severity={row.severity} />
                            <span className="ml-1.5 text-[11px] text-[var(--color-muted)]">{row.riskTypeKo ?? row.riskType}</span>
                          </td>
                          <td className="text-center"><Arrow direction={row.direction} /></td>
                          <td><ConfidenceTag confidence={row.confidence} /></td>
                          <td className="text-[11.5px] text-[var(--color-muted)]">
                            {row.action}
                            <div className="text-[10px] text-[var(--color-steel)] mt-0.5">▸ 근거 보기</div>
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
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="RISK BRIEF"
            titleKo="위험 분석 브리프"
            index="04"
            glow={impact?.severity === 'HIGH' || impact?.severity === 'CRITICAL' ? 'high' : impact?.severity === 'MEDIUM' ? 'med' : undefined}
            meta={impact ? `${impact.ruleId} · ${impact.origin === 'MARKET_SIGNAL' ? '시장' : '뉴스'} · ${impact.riskTypeKo ?? impact.riskType}` : undefined}
          >
            {!impact ? (
              <EmptyState text="선택된 Impact가 없습니다. 위의 시그널을 클릭하세요." />
            ) : (
              <div className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityTag severity={impact.severity} />
                  <ConfidenceTag confidence={impact.confidence} />
                  <span className="text-[12px] font-semibold text-[var(--color-ink)]">
                    {impact.ruleNameKo ?? impact.ruleName}
                  </span>
                </div>

                {/* ── 왜 위험한가: 내러티브 ── */}
                {impact.narrativeKo && (
                  <div className="rounded-md px-3.5 py-2.5 text-[12px] leading-[1.6] text-[var(--color-ink)]"
                    style={{ background: 'linear-gradient(135deg, rgba(255,171,64,0.1), rgba(255,82,82,0.06))' }}>
                    <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-risk-med)] mb-1">
                      💡 왜 위험한가 — 영업 영향 요약
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
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded-sm text-[11px] ${
                            i === (impact.chainKo ?? impact.chain).length - 1
                              ? 'font-semibold text-[var(--color-ink)] bg-[rgba(255,82,82,0.1)] border border-[rgba(255,82,82,0.3)]'
                              : 'text-[var(--color-muted)] bg-[var(--color-surface)]'
                          }`}
                        >
                          {step}
                        </span>
                      </span>
                    ))}
                  </div>
                  {(impact.lagNoteKo ?? impact.lagNote) && (
                    <div className="mt-1 text-[10.5px] text-[var(--color-faint)]">
                      ⏱ {impact.lagNoteKo ?? impact.lagNote}
                    </div>
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
                    <ul className="space-y-1.5">
                      {impact.evidence.slice(0, 4).map((e: any) => (
                        <li key={e.id} className="text-[11px] leading-snug">
                          <a
                            href={e.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2"
                          >
                            {e.title}
                          </a>
                          <span className="ml-1 text-[10px] text-[var(--color-faint)] num">
                            {e.source} · {e.publishedAt.slice(0, 10)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* ──────────────── 05 HRC INTRADAY ──────────────── */}
        <Panel
          title="HRC INTRADAY"
          titleKo="열연강판 장중 상세"
          index="05"
          glow="steel"
          meta={
            <>
              {hrc.contract} · 유동성 {hrc.liquidityScore?.toFixed(3)} ·{' '}
              {hrc.officialBarCount} 공식 + {hrc.bars.length - hrc.officialBarCount} 백필
            </>
          }
        >
          <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-[var(--color-slate-line)] p-4 lg:border-b-0 lg:border-r">
              <Metric label="최종가" value={`${hrc.last?.toLocaleString()} ${hrc.unit}`} strong />
              <Metric label="당일 변동" node={<Pct value={hrc.change.today} />} strong />
              <Metric label="30분" node={<Pct value={hrc.change.m30} />} />
              <Metric label="60분" node={<Pct value={hrc.change.m60} />} />
              <Metric label="120분" node={<Pct value={hrc.change.m120} />} />
              <Metric label="예상정산가" value={hrc.preSettlement?.toLocaleString() ?? '—'} />
              <Metric label="당일 고가" value={hrc.high?.toLocaleString() ?? '—'} />
              <Metric label="당일 저가" value={hrc.low?.toLocaleString() ?? '—'} />
              <Metric label="거래량" value={hrc.volume?.toLocaleString() ?? '—'} />
              <Metric label="미결제약정" value={hrc.openInterest?.toLocaleString() ?? '—'} />
              <div className="col-span-2 mt-2 space-y-0.5 border-t border-[var(--color-slate-line)] pt-2 text-[10px] text-[var(--color-faint)]">
                <Line k="거래소 시각" v={hrc.sourceTimestamp} />
                <Line k="KST 시각" v={shanghaiToKst(hrc.sourceTimestamp)} />
                <Line k="수집 시각" v={fmtIso(hrc.collectedAt)} />
                <Line k="출처" v="SHFE 공개 지연 데이터" />
                <Line k="히스토리" v={hrc.historySource ?? 'N/A'} />
              </div>
            </dl>
            <div className="p-3">
              <Chart bars={hrc.bars.slice(-160)} height={300} />
              <div className="px-2 pt-1.5 text-[10px] text-[var(--color-faint)]">
                밝은 거래량 = SHFE 공식 봉 · 어두운 거래량 = Sina 백필 · 세션 브레이크 구간 제외
              </div>
            </div>
          </div>
        </Panel>

        {/* ──────────────── 06 EVENT RADAR ──────────────── */}
        <Panel
          title="EVENT RADAR"
          titleKo="글로벌 이벤트 레이더 — 클릭하여 근거 기사 확인"
          index="06"
          meta={
            <>
              {analysis.eventClusters.length}개 클러스터 · 관련 {analysis.inputs.articlesRelevant} /{' '}
              전체 {analysis.inputs.articlesCollected}건 ({analysis.inputs.articlesRejected}건 필터링)
            </>
          }
        >
          <div className="divide-y divide-[var(--color-slate-line)]">
            {analysis.eventClusters.map((c) => {
              const relatedImpact = analysis.impacts.find((i: any) => i.ruleId === c.ruleId);
              const isExpanded = expandedCluster === c.id;
              return (
                <div key={c.id}>
                  <div
                    className="px-4 py-3 cursor-pointer transition-colors hover:bg-[var(--color-steel-soft)]"
                    onClick={() => {
                      setExpandedCluster(isExpanded ? null : c.id);
                      setSelectedImpact(`IM_${c.ruleId}_EVENT`);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span
                            className="border px-1.5 py-px text-[9.5px] rounded-sm font-medium"
                            style={{
                              borderColor: c.status === 'ACTIVE' ? 'rgba(255,82,82,0.5)' : 'var(--color-slate-line)',
                              color: c.status === 'ACTIVE' ? 'var(--color-risk-high)' : 'var(--color-muted)',
                              background: c.status === 'ACTIVE' ? 'rgba(255,82,82,0.08)' : 'transparent',
                            }}
                          >
                            {c.status === 'ACTIVE' ? '🔴 활성' : c.status === 'OPEN' ? '🟡 감시' : c.status === 'COOLING' ? '⚪ 완화' : '종료'}
                          </span>
                          <ConfidenceTag confidence={c.confidence} />
                          <span className="text-[10px] text-[var(--color-faint)]">
                            {c.riskTypeKo ?? c.riskType} · {c.articleCount}건 / {c.publisherCount}매체
                          </span>
                        </div>
                        <div className="text-[13px] font-semibold text-[var(--color-ink)] mb-1">
                          {c.eventTypeKo ?? c.eventType}
                        </div>
                        {relatedImpact?.narrativeKo && (
                          <div className="text-[11.5px] leading-[1.5] text-[var(--color-muted)] mb-1.5">
                            {relatedImpact.narrativeKo}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5 text-[10px]">
                          <span className="text-[var(--color-faint)]">영향 지역:</span>
                          {c.regions.map((r: string) => (
                            <span key={r} className="px-1.5 py-px bg-[var(--color-surface)] text-[var(--color-muted)] rounded-sm">
                              {r}
                            </span>
                          ))}
                          <span className="text-[var(--color-faint)] ml-1">제품:</span>
                          {c.products.slice(0, 4).map((p: string) => (
                            <span key={p} className="px-1.5 py-px bg-[var(--color-surface)] text-[var(--color-muted)] rounded-sm">
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">
                          최신 {c.latestUpdate.slice(0, 10)}
                        </div>
                        <div className="num text-[10px] text-[var(--color-faint)]">
                          {c.ageHours}시간 전
                        </div>
                        <div className="text-[10px] mt-1" style={{ color: 'var(--color-steel)' }}>
                          {isExpanded ? '▾ 근거 접기' : '▸ 근거 기사 보기'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Expanded: source articles ── */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 ml-4 border-l-2 border-[var(--color-steel)] space-y-3"
                      style={{ background: 'linear-gradient(90deg, rgba(79,195,247,0.04), transparent 50%)' }}>

                      {relatedImpact?.narrativeKo && (
                        <div className="rounded-md px-3.5 py-2.5 text-[12px] leading-[1.6] text-[var(--color-ink)]"
                          style={{ background: 'linear-gradient(135deg, rgba(255,171,64,0.1), rgba(255,82,82,0.06))' }}>
                          <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-risk-med)] mb-1">
                            💡 이 이벤트가 왜 위험한가
                          </div>
                          {relatedImpact.narrativeKo}
                        </div>
                      )}

                      <div>
                        <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-steel)] mb-1.5 uppercase">
                          📋 근거 기사 — 총 {c.articleCount}건 중 상위 {c.evidence.length}건 (클릭하여 원문 확인)
                        </div>
                        <ul className="space-y-1.5">
                          {c.evidence.map((e: any) => (
                            <li key={e.id}
                              className="rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-surface)]"
                              style={{ border: '1px solid var(--color-slate-line)' }}>
                              <a href={e.link} target="_blank" rel="noreferrer noopener"
                                className="text-[12px] font-medium text-[var(--color-steel)] hover:underline decoration-dotted underline-offset-2 leading-snug block">
                                ↗ {e.title}
                              </a>
                              <div className="mt-0.5 text-[10px] text-[var(--color-faint)] num">
                                {e.source} · {e.publishedAt.slice(0, 10)}
                              </div>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-2 text-[10px] text-[var(--color-faint)]">
                          이 클러스터는 {c.publisherCount}개 독립 매체가 보도했습니다. 매칭 키워드: {c.keywords.slice(0, 6).join(', ')}
                        </div>
                      </div>

                      {relatedImpact && (
                        <div>
                          <div className="text-[9px] font-bold tracking-[0.12em] text-[var(--color-ok)] mb-1.5 uppercase">
                            ✅ 권장 조치
                          </div>
                          <ul className="space-y-1.5">
                            {(relatedImpact.actionsKo?.length ? relatedImpact.actionsKo : relatedImpact.actions).map((a: string) => (
                              <li key={a} className="flex items-start justify-between gap-2 text-[12px] text-[var(--color-ink)]">
                                <span>· {a}</span>
                                <button
                                  className="shrink-0 border border-[var(--color-slate-line)] rounded-sm px-2 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)] hover:bg-[var(--color-steel-soft)] transition-colors"
                                  onClick={(ev) => { ev.stopPropagation(); onCreateIssue(relatedImpact, relatedImpact.regions[0], a); }}
                                >
                                  + 이슈 등록
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* ──────────────── 07 ISSUE & ACTION ──────────────── */}
        <Panel
          title="ISSUE & ACTION CENTER"
          titleKo="이슈 관리 및 조치"
          index="07"
          meta={
            <>
              {issues.length}건 · PGlite (WASM PostgreSQL → IndexedDB)
              {dbError && <span className="ml-2 text-[var(--color-risk-high)]">DB 오류</span>}
            </>
          }
        >
          {dbError && (
            <div className="border-b border-[var(--color-slate-line)] bg-[var(--color-risk-high-soft)] px-4 py-2 text-[11px] text-[var(--color-risk-high)] num">
              {dbError}
            </div>
          )}
          {issues.length === 0 ? (
            <EmptyState text="생성된 이슈가 없습니다. Sales Impact 또는 Risk Brief에서 [+ 이슈] 를 클릭하세요." />
          ) : (
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>이슈</th>
                    <th>조치</th>
                    <th>상태</th>
                    <th>생성일 (KST)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id}>
                      <td className="num text-[var(--color-faint)]">{issue.id}</td>
                      <td>
                        <div className="text-[12px] font-semibold text-[var(--color-ink)]">{issue.title}</div>
                        <div className="text-[10px] text-[var(--color-faint)] num">{issue.rule_id}</div>
                      </td>
                      <td className="max-w-[340px] text-[11.5px] text-[var(--color-muted)]">{issue.action}</td>
                      <td>
                        <div className="flex flex-wrap gap-0.5">
                          {STATUSES.map((s) => {
                            const active = issue.status === s;
                            const label = s === 'NEW' ? '신규' : s === 'REVIEWING' ? '검토' : s === 'ACTION_REQUIRED' ? '조치' : '완료';
                            return (
                              <button
                                key={s}
                                onClick={() => onStatus(issue.id, s)}
                                className="border px-1.5 py-px text-[9px] tracking-[0.04em] rounded-sm transition-colors"
                                style={
                                  active
                                    ? { borderColor: 'var(--color-steel)', background: 'var(--color-steel)', color: '#0c1219' }
                                    : { borderColor: 'var(--color-slate-line)', color: 'var(--color-faint)' }
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">
                        {fmtIso(issue.created_at)}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => onDelete(issue.id)}
                          className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-risk-high)] transition-colors"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ──────────────── FOOTER ──────────────── */}
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

      {/* ──────────────── TOAST ──────────────── */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 border border-[var(--color-steel)] bg-[var(--color-panel)] px-4 py-2 text-[11px] text-[var(--color-steel)] rounded-md shadow-lg shadow-black/40">
          {toast}
        </div>
      )}
    </div>
  );
}

/* ──────────────── Sub-components ──────────────── */

function StatusChip({ label, value, tone, pulse }: { label: string; value: string; tone: string; pulse?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {pulse && (
        <span className="pulse-dot block w-1.5 h-1.5 rounded-full" style={{ background: tone }} />
      )}
      <span className="eyebrow">{label}</span>
      <span className="num font-semibold" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function Metric({
  label,
  value,
  node,
  strong,
}: {
  label: string;
  value?: string;
  node?: React.ReactNode;
  strong?: boolean;
}) {
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
