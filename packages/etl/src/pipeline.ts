/**
 * Pipeline contracts and a small runner (docs/data/03-etl-framework.md section 2).
 * Domain scripts implement Step<TRaw, TRow> and a Loader; the runner does bookkeeping and reject capture.
 */
import type { PoolClient } from 'pg';
import type { Reject } from './reject';

export interface Source<TRaw> {
  /** Streams raw rows for one legacy table, optionally restricted to one legacy year. */
  rows(table: string, year?: string): AsyncIterable<TRaw>;
}

export interface Transformed<TRow> {
  row: TRow;
  legacyKey: string;
  legacyYear?: string;
}

export interface Step<TRaw, TRow> {
  legacyTable: string;
  /** Returns a transformed row, or a list of rejects for this raw row. */
  transform(raw: TRaw): Transformed<TRow> | Array<Reject & { column?: string; legacyKey?: string }>;
}

export interface Loader<TRow> {
  targetTable: string;
  /** Upserts one batch inside the given tenant transaction; returns target ids in input order. */
  load(client: PoolClient, rows: Array<Transformed<TRow>>): Promise<string[]>;
}

export interface ReconcileMeasure {
  measure: string;
  legacyValue: number | null;
  targetValue: number | null;
}

export interface RunReport {
  runId: string;
  extracted: number;
  loaded: number;
  rejected: number;
  blockingRejects: number;
  measures: ReconcileMeasure[];
}

export interface RunOptions {
  schoolId: string;
  domain: string;
  sourceLabel: string;
  batchSize?: number;
  /** Opens a tenant transaction for loading; the ETL role must be used. */
  withTenant<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  /** Bookkeeping connection (no tenant context needed; etl.* tables). */
  withBookkeeping<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export async function runStep<TRaw, TRow>(
  source: Source<TRaw>,
  step: Step<TRaw, TRow>,
  loader: Loader<TRow>,
  opts: RunOptions,
  year?: string,
): Promise<RunReport> {
  const batchSize = opts.batchSize ?? 500;

  const runId = await opts.withBookkeeping(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO etl.runs (school_id, domain, source_label) VALUES ($1, $2, $3) RETURNING id::text`,
      [opts.schoolId, opts.domain, opts.sourceLabel],
    );
    return r.rows[0]!.id;
  });

  let extracted = 0;
  let loaded = 0;
  let rejected = 0;
  let blockingRejects = 0;
  let batch: Array<Transformed<TRow>> = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    await opts.withTenant(async (c) => {
      const ids = await loader.load(c, rows);
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]!;
        await c.query(
          `INSERT INTO etl.legacy_map (school_id, legacy_table, legacy_key, legacy_year, target_table, target_id, run_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (school_id, legacy_table, legacy_key, legacy_year)
           DO UPDATE SET target_table = EXCLUDED.target_table, target_id = EXCLUDED.target_id, run_id = EXCLUDED.run_id, loaded_at = now()`,
          [
            opts.schoolId,
            step.legacyTable,
            row.legacyKey,
            row.legacyYear ?? '',
            loader.targetTable,
            ids[i],
            runId,
          ],
        );
      }
      loaded += rows.length;
    });
  };

  try {
    for await (const raw of source.rows(step.legacyTable, year)) {
      extracted += 1;
      const result = step.transform(raw);
      if (Array.isArray(result)) {
        rejected += 1;
        for (const rj of result) {
          if (rj.blocking) blockingRejects += 1;
          await opts.withBookkeeping((c) =>
            c.query(
              `INSERT INTO etl.rejects (run_id, school_id, legacy_table, legacy_key, column_name, reason, raw_value, blocking)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                runId,
                opts.schoolId,
                step.legacyTable,
                rj.legacyKey ?? null,
                rj.column ?? null,
                rj.reason,
                String(rj.raw ?? ''),
                rj.blocking,
              ],
            ),
          );
        }
        continue;
      }
      batch.push(result);
      if (batch.length >= batchSize) await flush();
    }
    await flush();

    await opts.withBookkeeping((c) =>
      c.query(
        `UPDATE etl.runs SET status = 'succeeded', finished_at = now(), counts = $2::jsonb WHERE id = $1`,
        [runId, JSON.stringify({ extracted, loaded, rejected, blockingRejects })],
      ),
    );
  } catch (error) {
    await opts.withBookkeeping((c) =>
      c.query(
        `UPDATE etl.runs SET status = 'failed', finished_at = now(), notes = $2 WHERE id = $1`,
        [runId, String(error)],
      ),
    );
    throw error;
  }

  return { runId, extracted, loaded, rejected, blockingRejects, measures: [] };
}

/** Records reconciliation measures for a run; the report generator reads them back. */
export async function recordMeasures(
  client: PoolClient,
  runId: string,
  schoolId: string,
  measures: ReconcileMeasure[],
): Promise<void> {
  for (const m of measures) {
    await client.query(
      `INSERT INTO etl.reconciliations (run_id, school_id, measure, legacy_value, target_value, status)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN COALESCE($4, 0) = COALESCE($5, 0) THEN 'match' ELSE 'unexplained' END)`,
      [runId, schoolId, m.measure, m.legacyValue, m.targetValue],
    );
  }
}
