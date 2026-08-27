/**
 * AI stage time budget — a stalled/rate-limited provider must never consume
 * the whole workflow step, because analyze.mjs can only save analysis.json
 * if the process survives long enough to reach its non-fatal AI catch.
 *
 * 2026-08-27 incident: Gemini returned 429 on every model; the retry backoff
 * burned the 15-minute step timeout, the process was killed before writing
 * analysis.json, and the build fell back to a committed copy that was 20
 * hours old — the live site went backwards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setAiDeadline, isBudgetExhausted, callTimeoutMs } from '../scripts/ai-analyze.mjs';

test('budget starts unexhausted and reports the remaining window', () => {
  setAiDeadline(60_000);
  assert.equal(isBudgetExhausted(), false);
  // per-request timeout is capped by what remains, not the 120s default
  assert.ok(callTimeoutMs(120_000) <= 60_000, 'timeout must not exceed remaining budget');
  assert.ok(callTimeoutMs(120_000) > 50_000, 'nearly the whole budget is still available');
});

test('an elapsed budget is reported as exhausted — the call gives up instead of retrying', () => {
  setAiDeadline(0);
  assert.equal(isBudgetExhausted(), true);
});

test('the 429 backoff check refuses a sleep that would run past the deadline', () => {
  setAiDeadline(20_000);           // 20s left
  const backoffMs = 30_000;        // first retry waits 30s
  // callGemini asks exactly this before sleeping; true ⇒ skip the retry
  assert.equal(isBudgetExhausted(Date.now() + backoffMs), true);
});

test('a backoff that fits inside the budget is still allowed', () => {
  setAiDeadline(120_000);          // 2 min left
  assert.equal(isBudgetExhausted(Date.now() + 30_000), false);
});

test('per-request timeout keeps a 10s floor so a nearly-spent budget still tries once', () => {
  setAiDeadline(1_000);
  assert.equal(callTimeoutMs(120_000), 10_000);
});

test('with a generous budget the original 120s timeout is unchanged', () => {
  setAiDeadline(600_000);          // 10 min
  assert.equal(callTimeoutMs(120_000), 120_000);
});

test('AI_BUDGET_MS default is long enough for a healthy run but under the step timeout', async () => {
  // collect.yml / digest.yml cap the refresh step at 12 min; deploy.yml at 15.
  // The budget must leave room for collectors (~5-7 min) and the final write.
  const src = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../scripts/ai-analyze.mjs', import.meta.url), 'utf8'));
  const m = src.match(/AI_BUDGET_MS\s*=\s*Number\(process\.env\.AI_BUDGET_MS\s*\|\|\s*([\d_]+)\)/);
  assert.ok(m, 'AI_BUDGET_MS default must be declared');
  const ms = Number(m[1].replace(/_/g, ''));
  assert.ok(ms >= 120_000, 'budget must allow a normal AI run');
  assert.ok(ms <= 480_000, 'budget must stay well under the 12-minute step timeout');
});
