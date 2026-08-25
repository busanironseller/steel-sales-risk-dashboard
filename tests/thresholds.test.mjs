/**
 * Regression tests 7-8 — market thresholds must treat routine moves as
 * routine and tail moves as HIGH. Calibration basis (last ~500 trading days,
 * public/data/market.json daily closes): hrc |Δ| p80=0.99 p95=1.92 · zinc
 * p80=1.20 p95=2.22 · aluminium p80=0.99 p95=1.96.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marketSignals } from '../scripts/analyze.mjs';
import { MARKET_THRESHOLDS } from '../scripts/rules.mjs';

const marketWith = (instrument, todayPct) => ({
  instruments: {
    [instrument]: {
      label: instrument, labelKo: instrument, contract: 'x2610', exchange: 'SHFE',
      last: 3000, unit: 'CNY/t',
      sourceTimestamp: '2026-08-25T00:00:00Z', collectedAt: '2026-08-25T00:00:00Z',
      change: { today: todayPct },
    },
  },
});

test('7. a routine HRC day (+1.03%, ~p80) is MEDIUM, never HIGH', () => {
  const signals = marketSignals(marketWith('hrc', 1.03));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'MEDIUM');
});

test('7b. an ordinary zinc day (+1.37%) is MEDIUM, never HIGH', () => {
  const signals = marketSignals(marketWith('zinc', 1.37));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'MEDIUM');
});

test('7c. a below-p80 move produces no MEDIUM signal at all', () => {
  const signals = marketSignals(marketWith('hrc', 0.5));
  assert.equal(signals.length, 0);
});

test('8. a tail move (HRC +2.5%, beyond p95) is HIGH', () => {
  const signals = marketSignals(marketWith('hrc', 2.5));
  assert.equal(signals.length, 1);
  assert.equal(signals[0].severity, 'HIGH');
});

test('8b. tail moves are HIGH for zinc (+2.3%) and aluminium (+2.1%)', () => {
  assert.equal(marketSignals(marketWith('zinc', 2.3))[0].severity, 'HIGH');
  assert.equal(marketSignals(marketWith('aluminium', 2.1))[0].severity, 'HIGH');
});

test('HIGH thresholds sit at/above the measured p95 for each instrument', () => {
  const p95 = { hrc: 1.92, zinc: 2.22, aluminium: 1.96 };
  for (const [inst, expected] of Object.entries(p95)) {
    const high = MARKET_THRESHOLDS[inst].find((t) => t.window === 'today' && t.severity === 'HIGH');
    assert.ok(high, `${inst} must have a today/HIGH threshold`);
    assert.ok(high.abs >= expected - 0.05, `${inst} HIGH (${high.abs}%) must be ≈≥ p95 (${expected}%)`);
  }
});
