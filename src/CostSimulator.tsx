/**
 * Raw-material cost simulator — popup modal.
 *
 * Estimates production cost per product type based on current market prices.
 * Composition ratios based on typical mill brochure specifications:
 *   CRC: HRC + cold-rolling
 *   GI:  CRC + zinc coating (pure zinc ~275 g/m² for Z275)
 *   GL:  CRC + zinc-aluminium alloy coating (55% Al, 43.5% Zn, 1.5% Si)
 *   AL:  CRC + aluminium coating (Type 1: ~100% Al)
 *   PPGI/COLOR: GI or GL + paint (primer + top coat)
 */
import React, { useMemo, useState } from 'react';

/* ── Product definitions ── */
interface ProductDef {
  key: string;
  label: string;
  labelKo: string;
  /** Base substrate */
  substrate: string;
  /** Coating weight g/m² (both sides) */
  coatingWeight: number;
  /** Coating composition: { element: fraction } */
  coatingMix: Record<string, number>;
  /** Extra processing cost USD/t (cold-rolling, painting, etc.) */
  processing: number;
  processingLabel: string;
}

const PRODUCTS: ProductDef[] = [
  {
    key: 'CRC',
    label: 'CRC (Cold-Rolled Coil)',
    labelKo: '냉연강판 (CRC)',
    substrate: 'HRC',
    coatingWeight: 0,
    coatingMix: {},
    processing: 80,
    processingLabel: '냉간압연 가공비',
  },
  {
    key: 'GI',
    label: 'GI (Hot-Dip Galvanized)',
    labelKo: '용융아연도금강판 (GI)',
    substrate: 'CRC',
    coatingWeight: 275,
    coatingMix: { zinc: 1.0 },
    processing: 50,
    processingLabel: '도금라인 가공비',
  },
  {
    key: 'GL',
    label: 'GL (Galvalume / Zn-Al-Mg)',
    labelKo: '갈바륨강판 (GL)',
    substrate: 'CRC',
    coatingWeight: 150,
    coatingMix: { aluminium: 0.55, zinc: 0.435, silicon: 0.015 },
    processing: 65,
    processingLabel: '도금라인 가공비',
  },
  {
    key: 'AL',
    label: 'AL (Aluminized)',
    labelKo: '알루미늄도금강판 (AL)',
    substrate: 'CRC',
    coatingWeight: 120,
    coatingMix: { aluminium: 0.92, silicon: 0.08 },
    processing: 60,
    processingLabel: '도금라인 가공비',
  },
  {
    key: 'PPGI',
    label: 'PPGI / COLOR (Pre-Painted)',
    labelKo: '컬러강판 (PPGI/COLOR)',
    substrate: 'GI',
    coatingWeight: 0,
    coatingMix: {},
    processing: 120,
    processingLabel: '도장라인 (프라이머+탑코트)',
  },
];

/* ── Price inputs ── */
interface PriceInputs {
  hrc: number;    // USD/t
  zinc: number;   // USD/t
  aluminium: number; // USD/t
  crcPremium: number; // USD/t over HRC
}

/* ── Helper: coating cost per tonne of steel ── */
function coatingCostPerTonne(product: ProductDef, prices: PriceInputs, thickness = 0.5): number {
  if (product.coatingWeight === 0) return 0;
  // Convert coating weight from g/m² to tonnes/tonne-of-steel
  // Steel density: 7,850 kg/m³. For thickness t(mm):
  //   mass/m² = t/1000 × 7850 kg/m³
  //   area/tonne = 1000 / (t/1000 × 7850) = 1,000,000 / (t × 7850)
  const steelArea = 1_000_000 / (thickness * 7850); // m² per tonne
  const coatingTonnesPerSteelTonne = (product.coatingWeight * steelArea) / 1e6;

  let cost = 0;
  for (const [element, fraction] of Object.entries(product.coatingMix)) {
    const pricePerTonne =
      element === 'zinc' ? prices.zinc :
      element === 'aluminium' ? prices.aluminium :
      0; // silicon cost negligible
    cost += fraction * coatingTonnesPerSteelTonne * pricePerTonne;
  }
  return cost;
}

function calcProductCost(product: ProductDef, prices: PriceInputs, thickness = 0.5): {
  baseCost: number;
  coatingCost: number;
  processingCost: number;
  total: number;
  breakdown: { label: string; value: number }[];
} {
  let baseCost: number;
  const breakdown: { label: string; value: number }[] = [];

  if (product.substrate === 'HRC') {
    baseCost = prices.hrc;
    breakdown.push({ label: 'HRC 원판', value: prices.hrc });
  } else if (product.substrate === 'CRC') {
    baseCost = prices.hrc + prices.crcPremium;
    breakdown.push({ label: 'HRC 원판', value: prices.hrc });
    breakdown.push({ label: 'CRC 프리미엄', value: prices.crcPremium });
  } else {
    // GI substrate for PPGI
    const giProduct = PRODUCTS.find((p) => p.key === 'GI')!;
    const giCost = calcProductCost(giProduct, prices, thickness);
    baseCost = giCost.total;
    breakdown.push({ label: 'GI 기판 원가', value: giCost.total });
  }

  const coatingCost = coatingCostPerTonne(product, prices, thickness);
  const processingCost = product.processing;

  if (coatingCost > 0) {
    breakdown.push({ label: '도금 원재료비', value: coatingCost });
  }
  breakdown.push({ label: product.processingLabel, value: processingCost });

  const total = baseCost + coatingCost + processingCost;
  return { baseCost, coatingCost, processingCost, total, breakdown };
}

/* ── Component ── */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Current market prices in CNY/t — converted to USD inside */
  marketPrices?: {
    hrc?: number;
    zinc?: number;
    aluminium?: number;
  };
  theme?: 'dark' | 'light';
}

export function CostSimulator({ open, onClose, marketPrices, theme = 'dark' }: Props) {
  // CNY → USD rough conversion (editable)
  const [cnyUsd, setCnyUsd] = useState(0.138);
  const [thickness, setThickness] = useState(0.5);

  const [customHrc, setCustomHrc] = useState<string>('');
  const [customZinc, setCustomZinc] = useState<string>('');
  const [customAlum, setCustomAlum] = useState<string>('');
  const [crcPremium, setCrcPremium] = useState(80);

  // Convert market prices to USD/t, or use custom
  const prices: PriceInputs = useMemo(() => ({
    hrc: customHrc ? Number(customHrc) : (marketPrices?.hrc ?? 450) * cnyUsd,
    zinc: customZinc ? Number(customZinc) : (marketPrices?.zinc ?? 2600) * cnyUsd,
    aluminium: customAlum ? Number(customAlum) : (marketPrices?.aluminium ?? 2400) * cnyUsd,
    crcPremium,
  }), [customHrc, customZinc, customAlum, crcPremium, marketPrices, cnyUsd]);

  const results = useMemo(
    () => PRODUCTS.map((p) => ({ product: p, ...calcProductCost(p, prices, thickness) })),
    [prices, thickness],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-[900px] max-h-[90vh] overflow-y-auto rounded-xl border"
        style={{
          background: 'var(--color-panel)',
          borderColor: 'var(--color-slate-line)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b px-5 py-3"
          style={{ background: 'var(--color-panel)', borderColor: 'var(--color-slate-line)' }}>
          <div>
            <div className="text-[14px] font-bold text-[var(--color-ink)]">🧮 원재료 비중 시뮬레이터</div>
            <div className="text-[10px] text-[var(--color-faint)]">
              현재 시장 가격 기반 제품별 원가 구조 시뮬레이션 · 도금 사양별 비교
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-colors"
            style={{ color: 'var(--color-faint)', background: 'var(--color-surface)' }}
          >
            ✕
          </button>
        </div>

        {/* Input Section */}
        <div className="border-b px-5 py-4 space-y-3" style={{ borderColor: 'var(--color-slate-line)' }}>
          <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-[var(--color-steel)]">
            가격 입력 (USD/t) — 빈칸이면 현재 시장 가격 자동 반영
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PriceInput
              label="HRC 열연"
              value={customHrc}
              placeholder={`${(prices.hrc).toFixed(0)} (자동)`}
              onChange={setCustomHrc}
              marketValue={marketPrices?.hrc ? `SHFE ${marketPrices.hrc.toLocaleString()} CNY` : undefined}
            />
            <PriceInput
              label="아연 (Zinc)"
              value={customZinc}
              placeholder={`${(prices.zinc).toFixed(0)} (자동)`}
              onChange={setCustomZinc}
              marketValue={marketPrices?.zinc ? `SHFE ${marketPrices.zinc.toLocaleString()} CNY` : undefined}
            />
            <PriceInput
              label="알루미늄"
              value={customAlum}
              placeholder={`${(prices.aluminium).toFixed(0)} (자동)`}
              onChange={setCustomAlum}
              marketValue={marketPrices?.aluminium ? `SHFE ${marketPrices.aluminium.toLocaleString()} CNY` : undefined}
            />
            <PriceInput
              label="CRC 프리미엄"
              value={String(crcPremium)}
              placeholder="80"
              onChange={(v) => setCrcPremium(Number(v) || 80)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[10.5px]">
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-faint)]">CNY→USD 환율</span>
              <input
                type="number"
                step="0.001"
                value={cnyUsd}
                onChange={(e) => setCnyUsd(Number(e.target.value) || 0.138)}
                className="w-20 rounded-sm border px-2 py-1 text-[11px] num text-right"
                style={{ borderColor: 'var(--color-slate-line)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-faint)]">판두께</span>
              <input
                type="number"
                step="0.1"
                min="0.2"
                max="3.0"
                value={thickness}
                onChange={(e) => setThickness(Number(e.target.value) || 0.5)}
                className="w-16 rounded-sm border px-2 py-1 text-[11px] num text-right"
                style={{ borderColor: 'var(--color-slate-line)', background: 'var(--color-surface)', color: 'var(--color-ink)' }}
              />
              <span className="text-[var(--color-faint)]">mm</span>
            </div>
          </div>
        </div>

        {/* Results Table */}
        <div className="px-5 py-4">
          <div className="overflow-x-auto">
            <table className="w-full text-[11.5px]" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr className="text-[9px] font-bold tracking-[0.1em] uppercase text-[var(--color-faint)]">
                  <th className="text-left py-2 px-2">제품</th>
                  <th className="text-right py-2 px-2">원판 비용</th>
                  <th className="text-right py-2 px-2">도금 원재료</th>
                  <th className="text-right py-2 px-2">가공비</th>
                  <th className="text-right py-2 px-2 font-bold">총 원가</th>
                  <th className="text-right py-2 px-2">원가 구성</th>
                </tr>
              </thead>
              <tbody>
                {results.map(({ product, baseCost, coatingCost, processingCost, total, breakdown }) => {
                  const baseRatio = (baseCost / total) * 100;
                  const coatRatio = (coatingCost / total) * 100;
                  const procRatio = (processingCost / total) * 100;
                  return (
                    <tr key={product.key} className="border-t" style={{ borderColor: 'var(--color-slate-line)' }}>
                      <td className="py-3 px-2">
                        <div className="font-semibold text-[var(--color-ink)]">{product.labelKo}</div>
                        <div className="text-[9px] text-[var(--color-faint)]">{product.label}</div>
                      </td>
                      <td className="num text-right py-3 px-2 text-[var(--color-muted)]">${baseCost.toFixed(0)}</td>
                      <td className="num text-right py-3 px-2 text-[var(--color-muted)]">
                        {coatingCost > 0 ? `$${coatingCost.toFixed(0)}` : '—'}
                      </td>
                      <td className="num text-right py-3 px-2 text-[var(--color-muted)]">${processingCost.toFixed(0)}</td>
                      <td className="num text-right py-3 px-2 font-bold text-[var(--color-ink)]">${total.toFixed(0)}</td>
                      <td className="py-3 px-2 w-40">
                        {/* Stacked bar */}
                        <div className="flex h-4 w-full rounded-sm overflow-hidden" style={{ background: 'var(--color-surface)' }}>
                          <div style={{ width: `${baseRatio}%`, background: 'var(--color-steel)', opacity: 0.7 }}
                            title={`원판 ${baseRatio.toFixed(0)}%`} />
                          {coatingCost > 0 && (
                            <div style={{ width: `${coatRatio}%`, background: 'var(--color-risk-med)', opacity: 0.7 }}
                              title={`도금 ${coatRatio.toFixed(0)}%`} />
                          )}
                          <div style={{ width: `${procRatio}%`, background: 'var(--color-ok)', opacity: 0.5 }}
                            title={`가공 ${procRatio.toFixed(0)}%`} />
                        </div>
                        <div className="flex gap-2 mt-0.5 text-[9px] text-[var(--color-faint)]">
                          <span>원판 {baseRatio.toFixed(0)}%</span>
                          {coatingCost > 0 && <span>도금 {coatRatio.toFixed(0)}%</span>}
                          <span>가공 {procRatio.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Coating specs */}
        <div className="border-t px-5 py-3 text-[10px] text-[var(--color-faint)] space-y-1"
          style={{ borderColor: 'var(--color-slate-line)' }}>
          <div className="font-bold text-[var(--color-muted)]">📋 도금 사양 기준</div>
          <div>GI: Z275 (275 g/m², 양면) · 순수 아연 100%</div>
          <div>GL: AZ150 (150 g/m², 양면) · 55% Al + 43.5% Zn + 1.5% Si</div>
          <div>AL: AS120 (120 g/m², 양면) · 92% Al + 8% Si (Type 1)</div>
          <div>PPGI: GI 기판 + 프라이머(5μm) + 탑코트(20μm)</div>
          <div className="mt-1 italic">
            ※ 시뮬레이션 수치이며 실제 원가와 차이가 있을 수 있습니다. 밀 브로셔 기준 도금량으로 계산합니다.
          </div>
        </div>
      </div>
    </div>
  );
}

function PriceInput({
  label,
  value,
  placeholder,
  onChange,
  marketValue,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  marketValue?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium text-[var(--color-muted)] block mb-1">{label}</label>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-sm border px-2.5 py-1.5 text-[12px] num"
        style={{
          borderColor: 'var(--color-slate-line)',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
        }}
      />
      {marketValue && (
        <div className="mt-0.5 text-[9px] text-[var(--color-faint)]">📊 {marketValue}</div>
      )}
    </div>
  );
}
