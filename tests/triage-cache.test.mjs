/**
 * Regression tests A-D — TRIAGE cache poisoning. A Gemini API failure during
 * triage must never mark unjudged new articles as analyzed: they have to be
 * re-triaged on the next refresh, or the early-warning system silently drops
 * real events (false negatives).
 *
 * mergeAnalyzedFingerprints(prev, articles, consumed) is the single decision
 * point both aiAnalyze() cache writes go through:
 *  - consumed = fingerprints from SUCCEEDED triage chunks only
 *  - a failed chunk contributes nothing to `consumed`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAnalyzedFingerprints } from '../scripts/ai-analyze.mjs';

const art = (fp) => ({ articleFingerprint: fp });
const fps = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

test('A. 10 new articles + total TRIAGE API failure → nothing enters the cache', () => {
  const articles = fps('new', 10).map(art);
  // every chunk failed → consumed is empty
  const next = mergeAnalyzedFingerprints([], articles, []);
  assert.deepEqual(next, []);
});

test('B. 10 new articles + TRIAGE succeeded with 0 candidates → all cached', () => {
  const articles = fps('new', 10).map(art);
  // the chunk succeeded (a real judgment of "no candidates") → all consumed
  const next = mergeAnalyzedFingerprints([], articles, fps('new', 10));
  assert.deepEqual(next.sort(), fps('new', 10).sort());
});

test('C. mixed old+new articles + TRIAGE failure → old fingerprints kept, new ones NOT added', () => {
  const oldFps = fps('old', 5);
  const newFps = fps('new', 5);
  const articles = [...oldFps, ...newFps].map(art);
  const next = mergeAnalyzedFingerprints(oldFps, articles, []); // failed run: consumed empty
  assert.deepEqual(next.sort(), oldFps.sort()); // previously analyzed survive
  for (const fp of newFps) assert.ok(!next.includes(fp), `${fp} must stay un-cached`);
});

test('D. next run with API recovered → previously failed articles are triaged and then cached', () => {
  const oldFps = fps('old', 5);
  const newFps = fps('new', 5);
  const articles = [...oldFps, ...newFps].map(art);

  // run 1: triage fails — new articles stay out of the cache
  const afterFailure = mergeAnalyzedFingerprints(oldFps, articles, []);
  const stillNew = articles.filter((a) => !new Set(afterFailure).has(a.articleFingerprint));
  assert.deepEqual(stillNew.map((a) => a.articleFingerprint).sort(), newFps.sort(),
    'the failed articles must be selected as NEW again on the next run');

  // run 2: API recovered, chunk succeeds — those articles are consumed and cached
  const afterRecovery = mergeAnalyzedFingerprints(afterFailure, articles, newFps);
  assert.deepEqual(afterRecovery.sort(), [...oldFps, ...newFps].sort());
});

test('articles that dropped out of the feed are evicted (previous replacement semantics kept)', () => {
  const articles = fps('current', 3).map(art);
  const next = mergeAnalyzedFingerprints(['gone1', 'gone2', 'current1'], articles, ['current2']);
  assert.deepEqual(next.sort(), ['current1', 'current2']);
});
