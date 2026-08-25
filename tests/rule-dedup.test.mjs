/**
 * Regression tests 1-3, 13 — one market signal must yield exactly one risk,
 * distinct signals must stay distinct, and severity counts must come from the
 * full list, never a truncated slice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { impactsFromMarket, impactsFromEvents, dedupAiAgainstRules, summarizeSeverity } from '../scripts/analyze.mjs';

const signal = (instrument, pct, severity) => ({
  id: `MS_${instrument.toUpperCase()}_today`,
  kind: 'MARKET',
  instrument,
  instrumentLabel: instrument,
  contract: 'x2610',
  exchange: 'SHFE',
  severity,
  direction: pct > 0 ? 'UP' : 'DOWN',
  pct,
  window: 'today',
  windowLabel: '금일',
  threshold: 1,
  last: 3000,
  unit: 'CNY/t',
  sourceTimestamp: '2026-08-25T00:00:00Z',
  collectedAt: '2026-08-25T00:00:00Z',
  source: 'SHFE (official, delayed)',
  fact: `${instrument} moved ${pct}%`,
});

test('1. one HRC signal → exactly one impact even though R1A and R1B both match', () => {
  const impacts = impactsFromMarket([signal('hrc', 2.5, 'HIGH')], {});
  assert.equal(impacts.length, 1);
  assert.deepEqual(impacts[0].mergedRuleIds.sort(), ['R1A_HRC_CRC', 'R1B_HRC_COATED']);
  // the second rule's business effect is preserved inside the single risk
  assert.equal(impacts[0].relatedEffects.length, 1);
  assert.equal(impacts[0].relatedEffects[0].ruleId, 'R1B_HRC_COATED');
  // product coverage is the union of both rules (CRC + coated)
  for (const p of ['CRC', 'GI', 'GL', 'COLOR']) assert.ok(impacts[0].products.includes(p));
});

test('2. one zinc signal → exactly one impact (R4A + R4C merged)', () => {
  const impacts = impactsFromMarket([signal('zinc', 2.5, 'HIGH')], {});
  assert.equal(impacts.length, 1);
  assert.deepEqual(impacts[0].mergedRuleIds.sort(), ['R4A_ZINC_GI', 'R4C_ZINC_GL']);
});

test('3. different signals stay separate — no over-merging across instruments', () => {
  const impacts = impactsFromMarket(
    [signal('hrc', 2.5, 'HIGH'), signal('zinc', 2.5, 'HIGH'), signal('aluminium', 2.1, 'HIGH')],
    {},
  );
  assert.equal(impacts.length, 3);
  const ids = new Set(impacts.map((i) => i.id));
  assert.equal(ids.size, 3);
});

test('1-B. AI impact sharing evidence + category with a rule impact is deduped; different category kept', () => {
  const ruleImpacts = [{
    ruleId: 'R6_STRAIT_DISRUPTION', riskType: 'Logistics', riskTypeKo: '물류·해운',
    evidence: [{ id: 'art-1' }, { id: 'art-2' }],
  }];
  const aiSame = {
    ruleId: 'RC_abc', riskType: '물류 리스크', riskTypeKo: '물류 리스크',
    evidence: [{ id: 'art-2' }],
  };
  const aiOtherCategory = {
    ruleId: 'RC_def', riskType: '환율', riskTypeKo: '환율',
    evidence: [{ id: 'art-1' }],
  };
  const aiOtherEvidence = {
    ruleId: 'RC_ghi', riskType: '물류 리스크', riskTypeKo: '물류 리스크',
    evidence: [{ id: 'art-99' }],
  };
  const kept = dedupAiAgainstRules(ruleImpacts, [aiSame, aiOtherCategory, aiOtherEvidence]);
  assert.deepEqual(kept.map((k) => k.ruleId).sort(), ['RC_def', 'RC_ghi']);
  assert.equal(ruleImpacts[0].corroboratedByAI, true);
});

test('13. severity counts come from the full list, not a top-15 slice', () => {
  const impacts = [
    ...Array.from({ length: 20 }, () => ({ severity: 'HIGH' })),
    ...Array.from({ length: 30 }, () => ({ severity: 'MEDIUM' })),
    ...Array.from({ length: 10 }, () => ({ severity: 'LOW' })),
  ];
  const counts = summarizeSeverity(impacts);
  assert.deepEqual(counts, { CRITICAL: 0, HIGH: 20, MEDIUM: 30, LOW: 10 });
  // a slice(0,15) of this list would report HIGH 15 / MEDIUM 0 — the bug we fixed
  const sliced = summarizeSeverity(impacts.slice(0, 15));
  assert.notDeepEqual(counts, sliced);
});

test('6. coverage alone (many publishers, fresh) is capped at MEDIUM', () => {
  const cluster = {
    id: 'EC_R6_STRAIT_DISRUPTION',
    ruleId: 'R6_STRAIT_DISRUPTION',
    confidence: 'HIGH', // 15 publishers within 72h — high corroboration
    articleCount: 18,
    publisherCount: 15,
    latestUpdate: new Date().toISOString(),
    evidence: [{ id: 'a', title: 't', source: 's', publishedAt: new Date().toISOString(), link: 'x' }],
  };
  const [impact] = impactsFromEvents([cluster]);
  assert.equal(impact.severity, 'MEDIUM');
  assert.equal(impact.confidence, 'HIGH'); // corroboration stays visible as confidence
});
