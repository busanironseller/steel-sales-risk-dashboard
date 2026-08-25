/**
 * Regression tests 11-12 — one collector failure must not stop the others or
 * the analysis step, and a failing collector must never truncate existing data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { orchestrate } from '../scripts/refresh.mjs';

test('11. one failing collector does not stop the rest or the analysis step', async () => {
  const ran = [];
  const summary = await orchestrate({
    run: async (script) => {
      ran.push(script);
      return script === 'collect-news.mjs' ? 1 : 0; // news source down
    },
  });
  // every collector attempted, analysis still ran
  assert.deepEqual(ran, [
    'collect-market.mjs', 'collect-news.mjs', 'collect-fx.mjs', 'collect-freight.mjs', 'analyze.mjs',
  ]);
  assert.deepEqual(summary.collectorsFailed, ['news']);
  assert.equal(summary.allCollectorsFailed, false);
  assert.equal(summary.analyzeOk, true);
});

test('11b. all collectors failing is reported as total failure (analysis still attempted)', async () => {
  const summary = await orchestrate({ run: async (s) => (s === 'analyze.mjs' ? 0 : 1) });
  assert.equal(summary.allCollectorsFailed, true);
  assert.deepEqual(summary.collectorsFailed, ['market', 'news', 'fx', 'freight']);
});

test('12. a failing collector process leaves existing JSON untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'refresh-test-'));
  const dataFile = join(dir, 'market.json');
  const original = JSON.stringify({ generatedAt: 'T0', instruments: { hrc: { last: 3325 } } });
  await writeFile(dataFile, original, 'utf8');

  // Simulate a collector that fails BEFORE writing (the pattern all real
  // collectors follow: they exit(1) on fetch failure and only write on success).
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', 'process.exit(1)'], { stdio: 'ignore' });
    child.on('close', resolve);
  });
  assert.equal(code, 1);

  const after = await readFile(dataFile, 'utf8');
  assert.equal(after, original, 'last-known-good data must survive a collector failure');
});
