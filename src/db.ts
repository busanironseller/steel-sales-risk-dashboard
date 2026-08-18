/**
 * Issue store — PGlite (WASM PostgreSQL) persisted to IndexedDB.
 *
 * The spec forbids React state or localStorage as the system of record. This is
 * real PostgreSQL running in the browser, so the schema and queries below are
 * the same ones a managed Postgres would run; moving to Neon/Supabase later is a
 * connection-string change, not a rewrite.
 */
import { PGlite } from '@electric-sql/pglite';
import type { Impact, Issue, IssueStatus } from './types';

let dbPromise: Promise<PGlite> | null = null;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS issues (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    impact_id   TEXT NOT NULL,
    rule_id     TEXT NOT NULL,
    risk_type   TEXT NOT NULL,
    region      TEXT NOT NULL,
    products    TEXT NOT NULL,
    action      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'NEW',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS issues_status_idx ON issues (status);
`;

export function getDb(): Promise<PGlite> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = new PGlite('idb://steel-sales-risk');
      await db.exec(SCHEMA);
      return db;
    })();
  }
  return dbPromise;
}

export async function listIssues(): Promise<Issue[]> {
  const db = await getDb();
  const res = await db.query<Issue>(
    `SELECT id, title, impact_id, rule_id, risk_type, region, products, action, status,
            created_at::text AS created_at, updated_at::text AS updated_at
       FROM issues
      ORDER BY CASE status
                 WHEN 'ACTION_REQUIRED' THEN 0
                 WHEN 'NEW' THEN 1
                 WHEN 'REVIEWING' THEN 2
                 ELSE 3
               END,
               created_at DESC`,
  );
  return res.rows;
}

/** Returns null when the impact already has an open issue, so the UI can say so. */
export async function createIssue(impact: Impact, region: string, action: string): Promise<Issue | null> {
  const db = await getDb();
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM issues WHERE impact_id = $1 AND region = $2 AND status <> 'RESOLVED' LIMIT 1`,
    [impact.id, region],
  );
  if (existing.rows.length > 0) return null;

  const res = await db.query<Issue>(
    `INSERT INTO issues (title, impact_id, rule_id, risk_type, region, products, action)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, title, impact_id, rule_id, risk_type, region, products, action, status,
               created_at::text AS created_at, updated_at::text AS updated_at`,
    [
      `${region} · ${impact.products.join('/')} — ${impact.riskType}`,
      impact.id,
      impact.ruleId,
      impact.riskType,
      region,
      impact.products.join('/'),
      action,
    ],
  );
  return res.rows[0];
}

export async function updateIssueStatus(id: number, status: IssueStatus): Promise<void> {
  const db = await getDb();
  await db.query(`UPDATE issues SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
}

export async function deleteIssue(id: number): Promise<void> {
  const db = await getDb();
  await db.query(`DELETE FROM issues WHERE id = $1`, [id]);
}
