/**
 * Refresh orchestrator — replaces the `collect:A && collect:B && … && analyze`
 * npm-script chain, where one failing collector (e.g. SHFE market fetch)
 * silently skipped news/fx/freight AND the analysis step, leaving the
 * dashboard's analysis.json stale while the workflow still showed green.
 *
 * Behaviour:
 *  - Each collector runs independently; a failure is recorded, not propagated.
 *  - Collectors only write their JSON on success (they exit(1) before writing
 *    otherwise), so a failure automatically preserves last-known-good data —
 *    this orchestrator never truncates or rewrites the data files itself.
 *  - analyze.mjs always runs afterwards against whatever data exists on disk
 *    (freshly collected or last-known-good). AI failures inside analyze stay
 *    non-fatal as before.
 *  - Partial failures emit GitHub Actions `::warning::` annotations so a
 *    degraded run is visible in CI without failing it.
 *  - Exit code is non-zero only when analyze itself fails, or when EVERY
 *    collector failed (nothing at all could be refreshed).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url);

const COLLECTORS = [
  { name: 'market', script: 'collect-market.mjs' },
  { name: 'news', script: 'collect-news.mjs' },
  { name: 'fx', script: 'collect-fx.mjs' },
  { name: 'freight', script: 'collect-freight.mjs' },
];

/** Run one script as a child process; resolve with its exit code. */
function runStep(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL(script, HERE))], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/**
 * Run all collectors (sequentially, to keep external API pacing) and then the
 * analysis step. Returns a summary usable by tests and by main().
 */
export async function orchestrate({ run = runStep } = {}) {
  const results = [];

  for (const { name, script } of COLLECTORS) {
    const code = await run(script);
    results.push({ name, ok: code === 0 });
  }

  const failed = results.filter((r) => !r.ok);
  const analyzeCode = await run('analyze.mjs');
  results.push({ name: 'analysis', ok: analyzeCode === 0 });

  return {
    results,
    collectorsFailed: failed.map((r) => r.name),
    allCollectorsFailed: failed.length === COLLECTORS.length,
    analyzeOk: analyzeCode === 0,
  };
}

async function main() {
  const summary = await orchestrate();

  console.log('\n  refresh summary');
  for (const r of summary.results) {
    console.log(`    ${r.name.padEnd(9)} ${r.ok ? 'OK' : 'FAILED — using last known data'}`);
  }

  for (const name of summary.collectorsFailed) {
    // Visible in the GitHub Actions run as a warning annotation.
    console.log(`::warning::collector '${name}' failed — dashboard is serving last-known-good ${name} data`);
  }

  if (!summary.analyzeOk) {
    console.error('refresh: analysis step failed');
    process.exit(1);
  }
  if (summary.allCollectorsFailed) {
    console.error('refresh: every collector failed — nothing was refreshed');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('refresh failed:', err);
    process.exit(1);
  });
}
