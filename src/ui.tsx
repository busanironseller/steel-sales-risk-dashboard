/** Shared presentational primitives — dark terminal theme. */
import type { ReactNode } from 'react';
import type { Confidence, Direction, Severity } from './types';

export function Panel({
  title,
  titleKo,
  index,
  meta,
  children,
  className = '',
  glow,
}: {
  title: string;
  titleKo?: string;
  index?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  glow?: 'high' | 'med' | 'steel';
}) {
  const glowCls = glow === 'high' ? 'glow-high' : glow === 'med' ? 'glow-med' : glow === 'steel' ? 'glow-steel' : '';
  return (
    <section className={`panel ${glowCls} ${className}`}>
      <header className="panel-head">
        <div>
          <h2 className="panel-title">
            {index && <span className="text-[var(--color-faint)] mr-2">{index}</span>}
            {title}
          </h2>
          {titleKo && (
            <div className="text-[10px] text-[var(--color-muted)] mt-0.5">{titleKo}</div>
          )}
        </div>
        {meta && <div className="text-[10px] text-[var(--color-faint)] num text-right">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

const severityStyle: Record<Severity, { bg: string; text: string; border: string }> = {
  CRITICAL: {
    bg: 'rgba(255, 82, 82, 0.15)',
    text: '#ff5252',
    border: '#ff5252',
  },
  HIGH: {
    bg: 'rgba(255, 82, 82, 0.12)',
    text: '#ff5252',
    border: 'rgba(255, 82, 82, 0.5)',
  },
  MEDIUM: {
    bg: 'rgba(255, 171, 64, 0.12)',
    text: '#ffab40',
    border: 'rgba(255, 171, 64, 0.5)',
  },
  LOW: {
    bg: 'rgba(77, 91, 107, 0.15)',
    text: '#7a8899',
    border: 'rgba(77, 91, 107, 0.4)',
  },
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const s = severityStyle[severity];
  return (
    <span
      className="inline-block border px-1.5 py-px text-[9.5px] font-bold tracking-[0.07em] rounded-sm"
      style={{ background: s.bg, color: s.text, borderColor: s.border }}
    >
      {severity}
    </span>
  );
}

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  const dots = confidence === 'HIGH' ? 3 : confidence === 'MEDIUM' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-muted)]" title={`Confidence: ${confidence}`}>
      <span className="inline-flex gap-[2px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block h-[7px] w-[3px] rounded-[1px]"
            style={{ background: i < dots ? 'var(--color-steel)' : 'var(--color-slate-line)' }}
          />
        ))}
      </span>
      {confidence}
    </span>
  );
}

export function Arrow({ direction }: { direction: Direction }) {
  const up = direction === 'UP';
  return (
    <span
      className="num font-semibold text-[12px]"
      style={{ color: up ? 'var(--color-risk-high)' : 'var(--color-ok)' }}
      aria-label={up ? '상승' : '하락'}
    >
      {up ? '▲' : '▼'}
    </span>
  );
}

/** Signed percentage. Colour means data movement, never decoration. */
export function Pct({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="num text-[var(--color-faint)]">—</span>;
  }
  const color =
    value > 0 ? 'var(--color-risk-high)' : value < 0 ? 'var(--color-ok)' : 'var(--color-muted)';
  return (
    <span className="num font-medium" style={{ color }}>
      {value > 0 ? '+' : ''}
      {value.toFixed(digits)}%
    </span>
  );
}

const epistemicColors: Record<string, { border: string; label: string }> = {
  FACT: { border: '#4fc3f7', label: '사실 (FACT)' },
  RULE: { border: '#7c4dff', label: '규칙 (RULE)' },
  INFERENCE: { border: '#ffab40', label: '추론 (INFERENCE)' },
  ACTION: { border: '#69f0ae', label: '조치 (ACTION)' },
};

export function Epistemic({ kind, children }: { kind: 'FACT' | 'RULE' | 'INFERENCE' | 'ACTION'; children: ReactNode }) {
  const e = epistemicColors[kind];
  return (
    <div
      className="border-l-2 pl-3 py-1.5 rounded-r-sm"
      style={{
        borderColor: e.border,
        background: `linear-gradient(90deg, ${e.border}08, transparent 60%)`,
      }}
    >
      <div className="text-[9px] font-bold tracking-[0.12em] uppercase mb-0.5" style={{ color: e.border }}>
        {e.label}
      </div>
      <div className="text-[12px] leading-[1.55] text-[var(--color-ink)]">{children}</div>
    </div>
  );
}

/** Stat card for hero metrics */
export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | ReactNode;
  sub?: string;
  tone?: 'high' | 'med' | 'ok' | 'steel';
}) {
  const borderColor =
    tone === 'high' ? 'var(--color-risk-high)' :
    tone === 'med' ? 'var(--color-risk-med)' :
    tone === 'ok' ? 'var(--color-ok)' :
    'var(--color-steel)';
  return (
    <div
      className="px-4 py-3 rounded-md border-t-2"
      style={{
        background: 'var(--color-surface)',
        borderTopColor: borderColor,
        borderLeft: '1px solid var(--color-slate-line)',
        borderRight: '1px solid var(--color-slate-line)',
        borderBottom: '1px solid var(--color-slate-line)',
      }}
    >
      <div className="eyebrow mb-1">{label}</div>
      <div className="text-[18px] font-bold num" style={{ color: borderColor }}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--color-faint)] mt-0.5 num">{sub}</div>}
    </div>
  );
}
