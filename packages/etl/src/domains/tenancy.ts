/**
 * Domain 1 (docs/data/03-etl-framework.md section 4): FYmaster to academic_years and financial_years.
 * One FYmaster row describes one session; the same row feeds both year tables (ADR-003: years are
 * dimensions, never row copies).
 */
import type { PoolClient } from 'pg';
import type { Loader, Step, Transformed } from '../pipeline';
import { normaliseYearCode, yesNoToBoolean } from '../transforms';
import type { Reject } from '../reject';

export interface RawFyMaster extends Record<string, unknown> {
  srno?: number | string;
  financialyear?: string;
  year?: string;
  Status?: unknown;
  FinancialYearName?: string;
}

export interface YearRow {
  code: string; // '2025-26'
  name: string;
  startDate: string; // YYYY-MM-DD, Indian session starts 1 April
  endDate: string;
  status: 'planned' | 'active' | 'locked' | 'closed';
  legacyRef: string;
}

function yearStatus(raw: RawFyMaster, startYear: number, today = new Date()): YearRow['status'] {
  const flag = yesNoToBoolean(raw.Status);
  const active = flag.kind === 'ok' && flag.value === true;
  if (active) return 'active';
  const currentStart = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return startYear < currentStart ? 'closed' : 'planned';
}

export const tenancyStep: Step<RawFyMaster, YearRow> = {
  legacyTable: 'FYmaster',
  transform(raw): Transformed<YearRow> | Array<Reject & { column?: string; legacyKey?: string }> {
    const legacyKey = `financialyear=${String(raw.financialyear ?? raw.year ?? raw.srno ?? '')}`;
    const code = normaliseYearCode(raw.financialyear ?? raw.year);
    if (code.kind === 'reject') return [{ ...code, column: 'financialyear', legacyKey }];
    const startYear = Number(code.value.slice(0, 4));
    const name =
      typeof raw.FinancialYearName === 'string' && raw.FinancialYearName.trim()
        ? raw.FinancialYearName.trim()
        : `Session ${code.value}`;
    return {
      legacyKey,
      row: {
        code: code.value,
        name,
        startDate: `${startYear}-04-01`,
        endDate: `${startYear + 1}-03-31`,
        status: yearStatus(raw, startYear),
        legacyRef: String(raw.financialyear ?? raw.year ?? ''),
      },
    };
  },
};

/** Upserts by (school, code); a second run updates names and status and never duplicates. */
export class YearsLoader implements Loader<YearRow> {
  readonly targetTable: 'academic_years' | 'financial_years';
  constructor(private readonly kind: 'academic' | 'financial') {
    this.targetTable = kind === 'academic' ? 'academic_years' : 'financial_years';
  }

  async load(client: PoolClient, rows: Array<Transformed<YearRow>>): Promise<string[]> {
    const ids: string[] = [];
    const sql =
      this.kind === 'academic'
        ? `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status, legacy_ref)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5::year_status, $6)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, legacy_ref = EXCLUDED.legacy_ref, updated_at = now()
           RETURNING id::text`
        : `INSERT INTO financial_years (school_id, code, name, start_date, end_date, status, legacy_ref)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5::year_status, $6)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, legacy_ref = EXCLUDED.legacy_ref, updated_at = now()
           RETURNING id::text`;
    for (const { row } of rows) {
      const code = this.kind === 'academic' ? row.code : `FY${row.code}`;
      const name = this.kind === 'academic' ? row.name : `Financial year ${row.code}`;
      const r = await client.query<{ id: string }>(sql, [
        code,
        name,
        row.startDate,
        row.endDate,
        row.status,
        row.legacyRef,
      ]);
      ids.push(r.rows[0]!.id);
    }
    return ids;
  }
}
