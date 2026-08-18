import { useEffect, useMemo, useState } from 'react';
import { Chart } from './Chart';
import { Panel, SeverityTag, ConfidenceTag, Arrow, Pct, Epistemic } from './ui';
import { createIssue, deleteIssue, listIssues, updateIssueStatus } from './db';
import type { Analysis, Impact, Issue, IssueStatus, MarketData } from './types';

const BASE = import.meta.env.BASE_URL;
const KST = 'Asia/Seoul';
const PULSE_ORDER = ['hrc', 'rebar', 'zinc', 'aluminium', 'ironOre', 'cokingCoal'];
const STATUSES: IssueStatus[] = ['NEW', 'REVIEWING', 'ACTION_REQUIRED', 'RESOLVED'];

/** Exchange bar labels are Asia/Shanghai wall time; KST is one hour ahead. */
function shanghaiToKst(stamp: string): string {
  const [date, time] = stamp.split(' ');
  if (!date || !time) return stamp;
  const d = new Date(`${date}T${time}+08:00`);
  return d.toLocaleString('ko-KR', { timeZone: KST, hour12: false });
}

const fmtIso = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: KST, hour12: false });

const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/**
 * Session state derived from the exchange clock, not the browser's — a Korean
 * user at 16:00 KST is looking at a market that closed at 15:00 Shanghai time.
 */
function sessionState(sourceTimestamp: string): { label: string; tone: string } {
  const time = sourceTimestamp.split(' ')[1] ?? '';
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h)) return { label: 'UNKNOWN', tone: 'var(--color-faint)' };
  const mins = h * 60 + m;
  const inWindow = (a: string, b: string) => {
    const to = (s: string) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]);
    return mins >= to(a) && mins < to(b);
  };
  if (inWindow('21:00', '23:00')) return { label: 'NIGHT', tone: 'var(--color-steel)' };
  if (inWindow('09:00', '10:15') || inWindow('10:30', '11:30') || inWindow('13:30', '15:00'))
    return { label: 'DAY', tone: 'var(--color-ok)' };
  if (inWindow('10:15', '10:30') || inWindow('11:30', '13:30'))
    return { label: 'BREAK', tone: 'var(--color-risk-med)' };
  return { label: 'CLOSED', tone: 'var(--color-muted)' };
}

export function App() {
  const [market, setMarket] = useState<MarketData | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedImpact, setSelectedImpact] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, a] = await Promise.all([
          fetch(`${BASE}data/market.json`).then((r) => r.json()),
          fetch(`${BASE}data/analysis.json`).then((r) => r.json()),
        ]);
        setMarket(m);
        setAnalysis(a);
        setSelectedImpact(a.criticalSignals[0]?.id ?? a.impacts[0]?.id ?? null);
      } catch (err) {
        setLoadError(String(err));
      }
    })();
  }, []);

  useEffect(() => {
    listIssues().then(setIssues).catch((e) => setDbError(String(e)));
  }, []);

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
        <div className="eyebrow mb-2">DATA LOAD ERROR</div>
        <p className="num text-[var(--color-risk-high)]">{loadError}</p>
        <p className="mt-2 text-[var(--color-muted)]">
          <code>npm run refresh</code> 로 수집기를 먼저 실행하세요.
        </p>
      </div>
    );
  }

  if (!market || !analysis || !hrc) {
    return <div className="p-8 eyebrow text-[var(--color-faint)]">LOADING COLLECTED DATA…</div>;
  }

  const session = sessionState(hrc.sourceTimestamp);
  const collectedAgo = minutesSince(analysis.generatedAt);
  const stale = collectedAgo > 90;

  return (
    <div className="min-h-screen">
      {/* ---------------------------------------------------------- masthead */}
      <header className="border-b border-[var(--color-slate-line)] bg-[var(--color-panel)]">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
          <div>
            <div className="text-[13px] font-bold tracking-[0.02em]">
              STEEL SALES RISK INTELLIGENCE
            </div>
            <div className="eyebrow">
              Galvanized / Color Coated · Early Warning Dashboard
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[10px]">
            <StatusChip label="MODE" value="PROTOTYPE" tone="var(--color-risk-med)" />
            <StatusChip label="HRC SESSION" value={session.label} tone={session.tone} />
            <StatusChip
              label="DATA"
              value={stale ? `STALE · ${collectedAgo}m` : `COLLECTED ${collectedAgo}m AGO`}
              tone={stale ? 'var(--color-risk-med)' : 'var(--color-ok)'}
            />
            <div className="num text-[var(--color-faint)]">
              KST {fmtIso(analysis.generatedAt)}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1560px] space-y-3 p-3 md:p-5">
        {/* ------------------------------------------------ 01 market pulse */}
        <Panel
          title="Market Pulse"
          index="01"
          meta={
            <>
              SHFE official + Sina backfill · {analysis.inputs.instrumentsCovered} instruments
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
                  <th>Instrument</th>
                  <th>Contract</th>
                  <th className="text-right">Last</th>
                  <th className="text-right">Today</th>
                  <th className="text-right">30m</th>
                  <th className="text-right">60m</th>
                  <th className="text-right">120m</th>
                  <th className="text-right">Volume</th>
                  <th className="text-right">Open Int.</th>
                  <th>Source</th>
                  <th>Market time</th>
                </tr>
              </thead>
              <tbody>
                {PULSE_ORDER.filter((k) => market.instruments[k]).map((key) => {
                  const it = market.instruments[key];
                  return (
                    <tr key={key}>
                      <td className="font-semibold whitespace-nowrap">
                        {it.labelKo}
                        <span className="ml-1.5 text-[10px] font-normal text-[var(--color-faint)]">
                          {it.exchange}
                        </span>
                      </td>
                      <td className="num text-[11px] text-[var(--color-muted)]">{it.contract}</td>
                      <td className="num text-right font-semibold">{it.last?.toLocaleString()}</td>
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
                          className="border px-1 py-px"
                          style={{
                            borderColor: it.exchange === 'SHFE' ? 'var(--color-steel)' : 'var(--color-slate-line)',
                            color: it.exchange === 'SHFE' ? 'var(--color-steel)' : 'var(--color-faint)',
                          }}
                        >
                          {it.exchange === 'SHFE' ? 'OFFICIAL' : 'UNOFFICIAL'}
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
          <div className="border-t border-[var(--color-slate-line)] px-3.5 py-1.5 text-[10px] text-[var(--color-faint)]">
            30m / 60m / 120m는 완료된 30분봉 기준입니다 (세션 브레이크 제외). Market time은 거래소 현지시각(Asia/Shanghai).
          </div>
        </Panel>

        {/* --------------------------------------------- 02 critical signals */}
        <Panel
          title="Critical Signals"
          index="02"
          meta={`${analysis.criticalSignals.length} critical · ${analysis.impacts.length} total impacts · ${analysis.ruleCount} rules`}
        >
          {analysis.criticalSignals.length === 0 ? (
            <EmptyState text="현재 임계값을 넘은 Critical Signal이 없습니다." />
          ) : (
            <div className="divide-y divide-[var(--color-slate-line)]">
              {analysis.criticalSignals.map((sig) => (
                <button
                  key={sig.id}
                  onClick={() => setSelectedImpact(sig.id)}
                  className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--color-steel-soft)] ${
                    sig.id === impact?.id ? 'bg-[var(--color-steel-soft)]' : ''
                  }`}
                >
                  <SeverityTag severity={sig.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[13px] font-semibold">{sig.ruleName}</span>
                      <Arrow direction={sig.direction} />
                      <span className="text-[10px] text-[var(--color-faint)]">
                        {sig.origin === 'MARKET_SIGNAL' ? 'MARKET SIGNAL' : 'EVENT CLUSTER'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[var(--color-muted)]">{sig.fact}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <ConfidenceTag confidence={sig.confidence} />
                    <span className="text-[10px] text-[var(--color-faint)]">
                      {sig.regions.slice(0, 3).join(' · ')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* ------------------------------------ 03 sales impact + 04 brief */}
        <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
          <Panel title="Sales Impact" index="03" meta={`${analysis.salesImpact.length} rows`}>
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Product</th>
                    <th>Risk</th>
                    <th className="text-center">Dir</th>
                    <th>Conf.</th>
                    <th>Required action</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {analysis.salesImpact.map((row) => {
                    const target = analysis.impacts.find((i) => i.id === row.impactId);
                    return (
                      <tr key={row.id}>
                        <td className="font-semibold whitespace-nowrap">{row.region}</td>
                        <td className="text-[11px] text-[var(--color-muted)]">{row.products.join(' / ')}</td>
                        <td className="whitespace-nowrap">
                          <SeverityTag severity={row.severity} />
                          <span className="ml-1.5 text-[11px]">{row.riskType}</span>
                        </td>
                        <td className="text-center"><Arrow direction={row.direction} /></td>
                        <td><ConfidenceTag confidence={row.confidence} /></td>
                        <td className="text-[11.5px]">{row.action}</td>
                        <td className="text-right whitespace-nowrap">
                          <button
                            className="border border-[var(--color-slate-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)]"
                            onClick={() => target && onCreateIssue(target, row.region, row.action)}
                            disabled={!target}
                          >
                            + ISSUE
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Risk Brief"
            index="04"
            meta={impact ? `${impact.ruleId} · ${impact.origin === 'MARKET_SIGNAL' ? 'market' : 'news'}` : undefined}
          >
            {!impact ? (
              <EmptyState text="선택된 Impact가 없습니다." />
            ) : (
              <div className="space-y-2.5 p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityTag severity={impact.severity} />
                  <ConfidenceTag confidence={impact.confidence} />
                  <span className="text-[12px] font-semibold">{impact.ruleName}</span>
                </div>

                <Epistemic kind="FACT">
                  {impact.fact}
                  <div className="mt-1 text-[10px] text-[var(--color-faint)] num">
                    {impact.factSource} · {impact.factTimestamp}
                  </div>
                </Epistemic>

                <Epistemic kind="RULE">
                  <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
                    {impact.chain.map((step, i) => (
                      <span key={step} className="flex items-center gap-1">
                        {i > 0 && <span className="text-[var(--color-faint)]">→</span>}
                        <span
                          className={
                            i === impact.chain.length - 1
                              ? 'font-semibold text-[var(--color-graphite)]'
                              : 'text-[var(--color-muted)]'
                          }
                        >
                          {step}
                        </span>
                      </span>
                    ))}
                  </div>
                  {impact.lagNote && (
                    <div className="mt-1 text-[10.5px] text-[var(--color-faint)]">{impact.lagNote}</div>
                  )}
                </Epistemic>

                <Epistemic kind="INFERENCE">{impact.inference}</Epistemic>

                <Epistemic kind="ACTION">
                  <ul className="space-y-1">
                    {impact.actions.map((a) => (
                      <li key={a} className="flex items-start justify-between gap-2">
                        <span>· {a}</span>
                        <button
                          className="shrink-0 border border-[var(--color-slate-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-steel)] hover:border-[var(--color-steel)]"
                          onClick={() => onCreateIssue(impact, impact.regions[0], a)}
                        >
                          + ISSUE
                        </button>
                      </li>
                    ))}
                  </ul>
                </Epistemic>

                {impact.corroborationNote && (
                  <div className="border border-dashed border-[var(--color-slate-line)] px-2.5 py-1.5 text-[10.5px] text-[var(--color-muted)]">
                    {impact.corroborationNote}
                  </div>
                )}

                {impact.evidence && impact.evidence.length > 0 && (
                  <div>
                    <div className="eyebrow mb-1">EVIDENCE · {impact.evidence.length}</div>
                    <ul className="space-y-1">
                      {impact.evidence.slice(0, 4).map((e) => (
                        <li key={e.id} className="text-[11px] leading-snug">
                          <a
                            href={e.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[var(--color-steel)] underline decoration-dotted underline-offset-2"
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

        {/* ------------------------------------------- 05 HRC intraday detail */}
        <Panel
          title="HRC Intraday Detail"
          index="05"
          meta={
            <>
              {hrc.contract} · liquidity {hrc.liquidityScore?.toFixed(3)} ·{' '}
              {hrc.officialBarCount} official + {hrc.bars.length - hrc.officialBarCount} backfill bars
            </>
          }
        >
          <div className="grid gap-0 lg:grid-cols-[260px_1fr]">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 border-b border-[var(--color-slate-line)] p-3.5 lg:border-b-0 lg:border-r">
              <Metric label="Last" value={`${hrc.last?.toLocaleString()} ${hrc.unit}`} strong />
              <Metric label="Today" node={<Pct value={hrc.change.today} />} strong />
              <Metric label="Last 30m" node={<Pct value={hrc.change.m30} />} />
              <Metric label="Last 60m" node={<Pct value={hrc.change.m60} />} />
              <Metric label="Last 120m" node={<Pct value={hrc.change.m120} />} />
              <Metric label="Pre-settle" value={hrc.preSettlement?.toLocaleString() ?? '—'} />
              <Metric label="Today high" value={hrc.high?.toLocaleString() ?? '—'} />
              <Metric label="Today low" value={hrc.low?.toLocaleString() ?? '—'} />
              <Metric label="Volume" value={hrc.volume?.toLocaleString() ?? '—'} />
              <Metric label="Open interest" value={hrc.openInterest?.toLocaleString() ?? '—'} />
              <div className="col-span-2 mt-1 space-y-0.5 border-t border-[var(--color-slate-line)] pt-1.5 text-[10px] text-[var(--color-muted)]">
                <Line k="Market time (SHA)" v={hrc.sourceTimestamp} />
                <Line k="Market time (KST)" v={shanghaiToKst(hrc.sourceTimestamp)} />
                <Line k="Collected (KST)" v={fmtIso(hrc.collectedAt)} />
                <Line k="Source" v="SHFE public delayed market data" />
                <Line k="History backfill" v={hrc.historySource ?? 'none'} />
              </div>
            </dl>
            <div className="p-2">
              <Chart bars={hrc.bars.slice(-160)} height={300} />
              <div className="px-1.5 pt-1 text-[10px] text-[var(--color-faint)]">
                진한 거래량 막대 = SHFE 공식 봉, 옅은 막대 = Sina 백필 봉. 세션 브레이크 구간은 봉이 생성되지 않습니다.
              </div>
            </div>
          </div>
        </Panel>

        {/* --------------------------------------------- 06 global event radar */}
        <Panel
          title="Global Event Radar"
          index="06"
          meta={
            <>
              {analysis.eventClusters.length} clusters · {analysis.inputs.articlesRelevant} relevant /{' '}
              {analysis.inputs.articlesCollected} collected ({analysis.inputs.articlesRejected} filtered)
            </>
          }
        >
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Status</th>
                  <th className="text-right">Articles</th>
                  <th className="text-right">Publishers</th>
                  <th>Conf.</th>
                  <th>Latest</th>
                  <th>Matched terms</th>
                </tr>
              </thead>
              <tbody>
                {analysis.eventClusters.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedImpact(`IM_${c.ruleId}_EVENT`)}
                  >
                    <td className="font-semibold">{c.eventType}</td>
                    <td>
                      <span
                        className="border px-1 py-px text-[9.5px]"
                        style={{
                          borderColor: c.status === 'ACTIVE' ? 'var(--color-risk-high)' : 'var(--color-slate-line)',
                          color: c.status === 'ACTIVE' ? 'var(--color-risk-high)' : 'var(--color-muted)',
                        }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="num text-right">{c.articleCount}</td>
                    <td className="num text-right">{c.publisherCount}</td>
                    <td><ConfidenceTag confidence={c.confidence} /></td>
                    <td className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">
                      {c.latestUpdate.slice(0, 10)} ({c.ageHours}h)
                    </td>
                    <td className="text-[10.5px] text-[var(--color-faint)]">
                      {c.keywords.slice(0, 4).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ------------------------------------------------- 07 issue & action */}
        <Panel
          title="Issue & Action"
          index="07"
          meta={
            <>
              {issues.length} issue(s) · PGlite (WASM PostgreSQL) → IndexedDB
              {dbError && <span className="ml-2 text-[var(--color-risk-high)]">DB ERROR</span>}
            </>
          }
        >
          {dbError && (
            <div className="border-b border-[var(--color-slate-line)] bg-[var(--color-risk-high-soft)] px-3.5 py-2 text-[11px] text-[var(--color-risk-high)] num">
              {dbError}
            </div>
          )}
          {issues.length === 0 ? (
            <EmptyState text="생성된 Issue가 없습니다. Sales Impact 또는 Risk Brief에서 + ISSUE 를 누르세요." />
          ) : (
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr>
                    <th className="w-10">#</th>
                    <th>Issue</th>
                    <th>Action</th>
                    <th>Status</th>
                    <th>Created (KST)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id}>
                      <td className="num text-[var(--color-faint)]">{issue.id}</td>
                      <td>
                        <div className="text-[12px] font-semibold">{issue.title}</div>
                        <div className="text-[10px] text-[var(--color-faint)] num">{issue.rule_id}</div>
                      </td>
                      <td className="max-w-[340px] text-[11.5px]">{issue.action}</td>
                      <td>
                        <div className="flex flex-wrap gap-0.5">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              onClick={() => onStatus(issue.id, s)}
                              className="border px-1 py-px text-[9px] tracking-[0.04em]"
                              style={
                                issue.status === s
                                  ? { borderColor: 'var(--color-graphite)', background: 'var(--color-graphite)', color: '#fff' }
                                  : { borderColor: 'var(--color-slate-line)', color: 'var(--color-faint)' }
                              }
                            >
                              {s.replace('ACTION_REQUIRED', 'ACTION')}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="num text-[10.5px] text-[var(--color-muted)] whitespace-nowrap">
                        {fmtIso(issue.created_at)}
                      </td>
                      <td className="text-right">
                        <button
                          onClick={() => onDelete(issue.id)}
                          className="text-[10px] text-[var(--color-faint)] hover:text-[var(--color-risk-high)]"
                        >
                          delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ------------------------------------------------------ provenance */}
        <footer className="panel px-3.5 py-2.5 text-[10.5px] text-[var(--color-muted)]">
          <div className="eyebrow mb-1">DATA PROVENANCE</div>
          <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
            <Line k="Market collected" v={fmtIso(market.generatedAt)} />
            <Line k="News collected" v={fmtIso(analysis.inputs.newsGeneratedAt)} />
            <Line k="Analysis generated" v={fmtIso(analysis.generatedAt)} />
            <Line k="Market failures" v={String(market.failures.length)} />
            <Line k="News feed failures" v={String(analysis.inputs.newsFailures.length)} />
            <Line k="Rules applied" v={`${analysis.ruleCount} approved causal rules`} />
          </div>
          <p className="mt-2 max-w-[900px] leading-relaxed">
            PROTOTYPE MODE. 가격은 SHFE 공개 지연 데이터와 Sina Finance(비공식)에서 수집되며 실시간이 아닙니다.
            뉴스는 Google News RSS의 메타데이터만 수집하고 본문은 저장하지 않습니다. 추론(INFERENCE)은 승인된 Rule
            그래프에 의한 가능성 제시이며 사실이 아닙니다. 수집에 실패한 항목은 값을 채우지 않고 실패로 표시합니다.
          </p>
        </footer>
      </main>

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 border border-[var(--color-graphite)] bg-[var(--color-graphite)] px-3 py-1.5 text-[11px] text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatusChip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className="num font-semibold" style={{ color: tone }}>
        {value}
      </span>
    </div>
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
      <dd className={`num ${strong ? 'text-[15px] font-semibold' : 'text-[12px]'}`}>{node ?? value}</dd>
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
  return <div className="px-3.5 py-6 text-center text-[11.5px] text-[var(--color-faint)]">{text}</div>;
}
