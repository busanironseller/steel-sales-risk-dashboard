/**
 * Regression tests A-F — Korean title translation must be best-effort
 * enrichment, never the freshness critical path: fresh news.json is written
 * BEFORE translation, translation respects a hard time budget, previous
 * translations are reused by fingerprint, and analyze picks up the fresh
 * generatedAt regardless of translation health.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { translateTitles, finalizeAndWrite, applyPreviousTranslations, fingerprint } from '../scripts/collect-news.mjs';

const makeArticles = (n, { withKo = false } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${i + 1}`,
    title: `Steel headline number ${i + 1} about tariffs`,
    source: 'TestWire',
    publishedAt: '2026-08-25T00:00:00.000Z',
    articleFingerprint: `fp-${i + 1}`,
    titleKo: withKo ? `한국어 제목 ${i + 1}` : null,
  }));

const tmpOut = async () => pathToFileURL(join(await mkdtemp(join(tmpdir(), 'news-test-')), 'news.json'));

test('A. collection succeeds + translation fails entirely → fresh news.json still written, no throw', async () => {
  const out = await tmpOut();
  const articles = makeArticles(10);
  const { translation } = await finalizeAndWrite(
    articles,
    { counts: { collected: 10, afterDedupe: 10, written: 10 }, failures: [], generatedAt: '2026-08-25T01:00:00.000Z' },
    { translate: async () => null, throttleMs: 0, budgetMs: 5_000, outUrl: out },
  );
  const written = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(written.generatedAt, '2026-08-25T01:00:00.000Z'); // fresh collection time
  assert.equal(written.articles.length, 10);
  assert.ok(written.articles.every((a) => a.titleKo === null)); // English-only is fine
  assert.equal(translation.newlyTranslated, 0);
});

test('B. slow translation hits the budget → collector finishes fast, fresh file intact', async () => {
  const out = await tmpOut();
  const articles = makeArticles(50);
  const slowTranslate = async () => { await new Promise((r) => setTimeout(r, 60)); return '느린 번역'; };
  const t0 = Date.now();
  const { translation } = await finalizeAndWrite(
    articles,
    { counts: { collected: 50, afterDedupe: 50, written: 50 }, failures: [], generatedAt: '2026-08-25T02:00:00.000Z' },
    { translate: slowTranslate, throttleMs: 0, budgetMs: 300, outUrl: out }, // 300ms budget vs 50×60ms work
  );
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 3_000, `must stop near the budget, took ${elapsed}ms`);
  assert.ok(translation.skippedByBudget > 0, 'articles past the deadline are skipped');
  const written = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(written.generatedAt, '2026-08-25T02:00:00.000Z');
  assert.equal(written.articles.length, 50);
});

test('C. same-fingerprint articles reuse previous titleKo without calling the translator', async () => {
  const articles = makeArticles(5);
  const reuse = new Map([['fp-1', '재사용 번역 1'], ['fp-3', '재사용 번역 3']]);
  const reused = applyPreviousTranslations(articles, reuse);
  assert.equal(reused, 2);
  assert.equal(articles[0].titleKo, '재사용 번역 1');
  assert.equal(articles[2].titleKo, '재사용 번역 3');

  let calls = 0;
  await translateTitles(articles, {
    translate: async () => { calls++; return '새 번역'; },
    deadlineAt: Date.now() + 5_000,
    throttleMs: 0,
  });
  assert.equal(calls, 3, 'only the 3 untranslated articles hit the translator');
});

test('D. partial translation success → successes saved, failures stay null and system stays healthy', async () => {
  const out = await tmpOut();
  const articles = makeArticles(6);
  const { translation } = await finalizeAndWrite(
    articles,
    { counts: { collected: 6, afterDedupe: 6, written: 6 }, failures: [], generatedAt: '2026-08-25T03:00:00.000Z' },
    {
      // even-indexed titles translate, odd ones fail
      translate: async (title) => (Number(title.match(/number (\d+)/)[1]) % 2 === 0 ? '짝수 번역' : null),
      throttleMs: 0, budgetMs: 5_000, outUrl: out,
    },
  );
  assert.ok(translation.newlyTranslated >= 3);
  const written = JSON.parse(await readFile(out, 'utf8'));
  const withKo = written.articles.filter((a) => a.titleKo).length;
  const withoutKo = written.articles.filter((a) => !a.titleKo).length;
  assert.ok(withKo >= 3 && withoutKo >= 1, `partial state persisted (ko:${withKo}, null:${withoutKo})`);
});

test('E. translation total failure does not throw → refresh orchestrator can reach analyze', async () => {
  const out = await tmpOut();
  // finalizeAndWrite resolving (not rejecting) is what lets collect-news exit 0,
  // and tests/refresh.test.mjs already proves analyze runs after collector success.
  await assert.doesNotReject(finalizeAndWrite(
    makeArticles(3),
    { counts: { collected: 3, afterDedupe: 3, written: 3 }, failures: [], generatedAt: '2026-08-25T04:00:00.000Z' },
    { translate: async () => { throw new Error('gtx down'); }, throttleMs: 0, budgetMs: 1_000, outUrl: out },
  ));
  const written = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(written.articles.length, 3);
});

test('F. analyze reads newsGeneratedAt from the freshly written news.json (translation-independent)', async () => {
  const out = await tmpOut();
  await finalizeAndWrite(
    makeArticles(4),
    { counts: { collected: 4, afterDedupe: 4, written: 4 }, failures: [], generatedAt: '2026-08-25T05:00:00.000Z' },
    { translate: async () => null, throttleMs: 0, budgetMs: 1_000, outUrl: out },
  );
  const news = JSON.parse(await readFile(out, 'utf8'));
  // analyze.mjs propagates this verbatim: inputs.newsGeneratedAt = news.generatedAt
  const analyzeSrc = await readFile(new URL('../scripts/analyze.mjs', import.meta.url), 'utf8');
  assert.ok(analyzeSrc.includes('newsGeneratedAt: news.generatedAt'), 'propagation line must exist');
  assert.equal(news.generatedAt, '2026-08-25T05:00:00.000Z'); // fresh despite zero translations
});

test('fingerprint stays stable across runs (reuse key)', () => {
  const a = fingerprint('Some Steel Title', 'Reuters', '2026-08-25T00:00:00Z');
  const b = fingerprint('Some Steel Title', 'Reuters', '2026-08-25T09:30:00Z'); // same date, later time
  assert.equal(a, b);
});
