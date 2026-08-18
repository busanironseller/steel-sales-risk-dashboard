/** Shared presentational primitives. Deliberately small — no decorative chrome. */
import type { ReactNode } from 'react';
import type { Confidence, Direction, Severity } from './types';

export function Panel({
  title,
  index,
  meta,
  children,
  className = '',
}: {
  title: string;
  index?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2 className="panel-title">
          {index && <span className="text-[var(--color-faint)] mr-2">{index}</span>}
          {title}
        </h2>
        {meta && <div className="text-[10px] text-[var(--color-faint)] num text-right">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

const severityStyle: Record<Severity, string> = {
  CRITICAL: 'bg-[var(--color-risk-high-soft)] text-[var(--color-risk-high)] border-[var(--color-risk-high)]',
  HIGH: 'bg-[var(--color-risk-high-soft)] text-[var(--color-risk-high)] border-[var(--color-risk-high)]',
  MEDIUM: 'bg-[var(--color-risk-med-soft)] text-[var(--color-risk-med)] border-[var(--color-risk-med)]',
  LOW: 'bg-[var(--color-canvas)] text-[var(--color-muted)] border-[var(--color-slate-line)]',
};

export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-block border px-1.5 py-px text-[9.5px] font-semibold tracking-[0.07em] ${severityStyle[severity]}`}
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
            className="block h-[7px] w-[3px]"
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
      className="num font-semibold"
      style={{ color: up ? 'var(--color-risk-high)' : 'var(--color-ok)' }}
      aria-label={up ? 'up' : 'down'}
    >
      {up ? '▲' : '▼'}
    </span>
  );
}

/** Signed percentage. Neutral grey at exactly zero — colour must mean movement. */
export function Pct({ value, digits = 2 }: { value: number | null | undefined; digits?: number }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="num text-[var(--color-faint)]">—</span>;
  }
  const color =
    value > 0 ? 'var(--color-risk-high)' : value < 0 ? 'var(--color-ok)' : 'var(--color-muted)';
  return (
    <span className="num" style={{ color }}>
      {value > 0 ? '+' : ''}
      {value.toFixed(digits)}%
    </span>
  );
}

export function Epistemic({ kind, children }: { kind: 'FACT' | 'RULE' | 'INFERENCE' | 'ACTION'; children: ReactNode }) {
  const tone: Record<string, string> = {
    FACT: 'border-l-[var(--color-graphite)]',
    RULE: 'border-l-[var(--color-steel)]',
    INFERENCE: 'border-l-[var(--color-risk-med)]',
    ACTION: 'border-l-[var(--color-ok)]',
  };
  return (
    <div className={`border-l-2 pl-2.5 py-0.5 ${tone[kind]}`}>
      <div className="eyebrow mb-0.5">{kind}</div>
      <div className="text-[12px] leading-[1.5]">{children}</div>
    </div>
  );
}
