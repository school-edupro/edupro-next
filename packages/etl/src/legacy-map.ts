import type { PoolClient } from 'pg';

/** Key of a legacy row: table plus a natural or surrogate key expression, plus the legacy year when per-year. */
export interface LegacyKey {
  table: string;
  key: string; // e.g. 'sadmission=R24560' or 'srno=123'
  year?: string; // legacy FinancialYear string, '' when the row is not per year
}

export interface LegacyMapStore {
  get(k: LegacyKey): Promise<{ targetTable: string; targetId: string } | null>;
  set(k: LegacyKey, targetTable: string, targetId: string, runId?: string): Promise<void>;
}

const keyOf = (k: LegacyKey): string => `${k.table}|${k.key}|${k.year ?? ''}`;

/** For unit tests and dry runs. */
export class MemoryLegacyMap implements LegacyMapStore {
  private readonly items = new Map<string, { targetTable: string; targetId: string }>();

  async get(k: LegacyKey) {
    return this.items.get(keyOf(k)) ?? null;
  }

  async set(k: LegacyKey, targetTable: string, targetId: string) {
    this.items.set(keyOf(k), { targetTable, targetId });
  }

  get size(): number {
    return this.items.size;
  }
}

/** Backed by etl.legacy_map (migration 0008). The client must belong to a transaction on the ETL role. */
export class PgLegacyMap implements LegacyMapStore {
  constructor(
    private readonly client: PoolClient,
    private readonly schoolId: string,
  ) {}

  async get(k: LegacyKey) {
    const r = await this.client.query<{ target_table: string; target_id: string }>(
      `SELECT target_table, target_id::text FROM etl.legacy_map
        WHERE school_id = $1 AND legacy_table = $2 AND legacy_key = $3 AND legacy_year = $4`,
      [this.schoolId, k.table, k.key, k.year ?? ''],
    );
    const row = r.rows[0];
    return row ? { targetTable: row.target_table, targetId: row.target_id } : null;
  }

  async set(k: LegacyKey, targetTable: string, targetId: string, runId?: string) {
    await this.client.query(
      `INSERT INTO etl.legacy_map (school_id, legacy_table, legacy_key, legacy_year, target_table, target_id, run_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (school_id, legacy_table, legacy_key, legacy_year)
       DO UPDATE SET target_table = EXCLUDED.target_table, target_id = EXCLUDED.target_id, run_id = EXCLUDED.run_id, loaded_at = now()`,
      [this.schoolId, k.table, k.key, k.year ?? '', targetTable, targetId, runId ?? null],
    );
  }
}
