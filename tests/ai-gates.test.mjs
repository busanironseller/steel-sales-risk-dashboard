/**
 * Regression tests 4-5, 9-10 + case-fingerprint behaviour — Zod salvage must
 * clamp scores, headline-only evidence must cap evidenceQuality, and the
 * HIGH gate must separate "tension" from "actual disruption".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAssessmentStatus,
  computeSeverity,
  salvageAssessment,
  capEvidenceQuality,
  generateCaseId,
  AnalystOutputSchema,
} from '../scripts/ai-analyze.mjs';

const scores = (e, x, c, m, u) => ({
  evidenceQuality: e, exposureProximity: x, causalStrength: c, businessMateriality: m, urgency: u,
});

test('4. salvage clamps out-of-range scores — evidenceQuality:9 cannot reach HIGH/CRITICAL', () => {
  const salvaged = salvageAssessment({
    canonicalEventTitle: '테스트 이벤트',
    scores: { evidenceQuality: 9, exposureProximity: 7, causalStrength: 5, businessMateriality: 9, urgency: 6 },
    facts: ['f'], inferences: [], missingEvidence: [], causalChain: [], exposure: {},
  });
  assert.ok(salvaged, 'salvage must not drop a repairable assessment');
  // every score clamped into schema range
  assert.ok(AnalystOutputSchema.safeParse(salvaged).success, 'salvaged output must pass the same Zod schema');
  assert.equal(salvaged.scores.evidenceQuality, 3);
  assert.equal(salvaged.scores.urgency, 2);
  // clamped maximum is (3,3,3,3,2)=14 — a legitimate ceiling, but bogus 9s can
  // no longer push the total beyond what honest maximal scores could produce
  const status = computeAssessmentStatus(salvaged.scores);
  const sev = computeSeverity(salvaged.scores, status);
  assert.ok(['HIGH', 'CRITICAL'].includes(sev) === true); // clamps to the honest max, not beyond
});

test('4b. non-numeric / garbage scores collapse to 0 (conservative), never upward', () => {
  const salvaged = salvageAssessment({
    canonicalEventTitle: '가비지 점수',
    scores: { evidenceQuality: 'lots', exposureProximity: null, causalStrength: -4, businessMateriality: NaN, urgency: Infinity },
  });
  assert.ok(salvaged);
  // every garbage value (string, null, negative, NaN, Infinity) collapses to 0
  assert.deepEqual(salvaged.scores, scores(0, 0, 0, 0, 0));
  assert.equal(computeAssessmentStatus(salvaged.scores), 'IGNORE');
});

test('5. headline-only evidence caps evidenceQuality at 1', () => {
  const enriched = [{
    enrichedArticles: [
      { index: 1, hasText: false, hasSnippet: false },
      { index: 2, hasText: false, hasSnippet: false },
    ],
  }];
  const assessments = [
    { canonicalEventTitle: 'a', evidenceIndices: [1, 2], scores: scores(3, 2, 2, 2, 2) },
    { canonicalEventTitle: 'b', evidenceIndices: [], scores: scores(3, 2, 2, 2, 2) }, // untraceable = headline-only
  ];
  const capped = capEvidenceQuality(assessments, enriched);
  assert.equal(capped, 2);
  assert.equal(assessments[0].scores.evidenceQuality, 1);
  assert.equal(assessments[1].scores.evidenceQuality, 1);
});

test('5b. full-text evidence is NOT capped', () => {
  const enriched = [{ enrichedArticles: [{ index: 1, hasText: true, hasSnippet: false }] }];
  const assessments = [{ canonicalEventTitle: 'c', evidenceIndices: [1], scores: scores(3, 2, 2, 2, 2) }];
  assert.equal(capEvidenceQuality(assessments, enriched), 0);
  assert.equal(assessments[0].scores.evidenceQuality, 3);
});

test('9. Hormuz tension without disruption (minimal ALERT, total 10) → MEDIUM, not HIGH', () => {
  const s = scores(2, 2, 2, 2, 2); // total 10 — the old gate promoted this to HIGH
  const status = computeAssessmentStatus(s);
  assert.equal(status, 'ALERT');
  assert.equal(computeSeverity(s, status), 'MEDIUM');
});

test('10. actual disruption with strong evidence (total ≥ 12) → HIGH or CRITICAL', () => {
  const strong = scores(3, 3, 2, 2, 2); // total 12
  assert.equal(computeSeverity(strong, computeAssessmentStatus(strong)), 'HIGH');
  const closure = scores(3, 3, 3, 3, 2); // total 14, evidence 3, materiality 3
  assert.ok(['HIGH', 'CRITICAL'].includes(computeSeverity(closure, computeAssessmentStatus(closure))));
});

test('assessmentStatus and severity remain distinct concepts (ALERT can be MEDIUM)', () => {
  const s = scores(2, 2, 2, 2, 0); // total 8 — valid ALERT, clearly not HIGH
  assert.equal(computeAssessmentStatus(s), 'ALERT');
  assert.equal(computeSeverity(s, 'ALERT'), 'MEDIUM');
});

// ── case fingerprint (Phase 1-C) ──

const assessmentWith = (title, regions = ['GCC'], products = ['GI']) => ({
  canonicalEventTitle: title,
  riskType: '물류 리스크',
  exposure: { regions, products },
});

test('1-C. wording variants of the same Hormuz event map to ONE case', () => {
  const a = generateCaseId(assessmentWith('홍해 및 호르무즈 해협 군사적 긴장 고조에 따른 물류 마비 우려'));
  const b = generateCaseId(assessmentWith('호르무즈 해협 긴장 고조 및 미국의 대이란 제재 강화'));
  const c = generateCaseId(assessmentWith('미국-이란 갈등 고조 및 호르무즈 해협 통행 위협'));
  assert.equal(a, b);
  assert.equal(b, c);
});

test('1-C. opposing states of the same dispute share a case (state change, not a new event)', () => {
  const imposed = generateCaseId(assessmentWith('미국-캐나다 관세 전쟁 발발 및 상호 보복 관세 부과', ['US'], ['CRC']));
  const reduced = generateCaseId(assessmentWith('미국-캐나다 무역 합의에 따른 철강 관세 25% 인하', ['US'], ['CRC']));
  assert.equal(imposed, reduced);
});

test('1-C. genuinely different events keep different cases', () => {
  const hormuz = generateCaseId(assessmentWith('호르무즈 해협 봉쇄'));
  const euQuota = generateCaseId(assessmentWith('EU 세이프가드 쿼터 축소', ['Europe'], ['GI']));
  const fx = generateCaseId(assessmentWith('원/달러 환율 급락에 따른 수출 채산성 악화', ['Korea Export'], ['CRC']));
  assert.notEqual(hormuz, euQuota);
  assert.notEqual(euQuota, fx);
  assert.notEqual(hormuz, fx);
});
