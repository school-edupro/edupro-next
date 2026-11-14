import mysql from 'mysql2/promise';
import type { Db } from '@edupro/db';
import type { Logger } from '../logger';

/**
 * Reading the old payroll module's database for the go-live (docs/design/86, phase G). Read only: nothing in the old
 * database is changed. The connection comes from the server's environment — LEGACY_PAYROLL_DB_URL (or
 * LEGACY_PAYROLL_DB_URL_<SCHOOL CODE>), else the leave cut-over's LEGACY_LEAVE_DB_URL when both modules share the old
 * ERP database — never from the code or the app. The encrypted PAN and bank copies and the calculation traces are never
 * read: PAN and bank come from the employee record. The rows land in payroll_legacy_rows as they are; the API maps them.
 */
export function payrollUrlFromEnv(schoolCode: string, env: NodeJS.ProcessEnv = process.env) {
  const key = schoolCode.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return (
    env[`LEGACY_PAYROLL_DB_URL_${key}`] ||
    env.LEGACY_PAYROLL_DB_URL ||
    env[`LEGACY_LEAVE_DB_URL_${key}`] ||
    env.LEGACY_LEAVE_DB_URL ||
    null
  );
}

/** The columns never read: encrypted copies and the bulky traces. */
export const NEVER_READ = ['PanEnc', 'BankAccountEnc', 'CalcTrace', 'NetInWords'];

/**
 * The tables read: the people whole (they are small); the runs and their records, lines and side lines whole too — the
 * cut-over brings the current and last financial year and keeps the older years as an archive file.
 */
export function payrollTables(): Array<{ tbl: string; key: string }> {
  return [
    'payroll_pay_head',
    'payroll_employee_profile',
    'payroll_nominee',
    'payroll_structure',
    'payroll_loan',
    'payroll_third_party',
    'payroll_recurring_deduction',
    'payroll_esi_coverage',
    'payroll_prev_employer_income',
    'payroll_investment_declaration',
    'payroll_tds_challan',
    'payroll_attendance_summary',
    'payroll_run',
    'payroll_salary_record',
    'payroll_salary_record_line',
    'payroll_pf_line',
    'payroll_nps_line',
    'payroll_lwf_line',
  ].map((tbl) => ({ tbl, key: 'srno' }));
}

const PAGE = 5000;
/** A message without the user and host an access error names. */
const clean = (m: string) => m.replace(/'[^']*'@'[^']*'/g, "'…'").slice(0, 480);

/** Read every table into the holding area of a school; the cut-over record says when, how many, or why not. */
export async function readLegacyPayroll(db: Db, schoolId: string, log: Logger) {
  const ctx = { schoolId, userId: null, allowedSchoolIds: [schoolId] };
  const code =
    (
      await db.withTenant(ctx, (c) =>
        c.query<{ code: string }>(`SELECT code FROM schools WHERE id = app.current_school_id()`),
      )
    ).rows[0]?.code ?? '';
  const mark = (sql: string, args: unknown[]) => db.withTenant(ctx, (c) => c.query(sql, args));
  await mark(`UPDATE payroll_cutover SET read_started_at = now(), updated_at = now()`, []);
  const url = payrollUrlFromEnv(code);
  if (!url) {
    await mark(`UPDATE payroll_cutover SET read_error = $1, updated_at = now()`, [
      'The server has no connection to the old payroll database (LEGACY_PAYROLL_DB_URL): ask IT to set it',
    ]);
    return 0;
  }
  const readId = Date.now();
  const counts: Record<string, number> = {};
  let conn: mysql.Connection | null = null;
  try {
    conn = await mysql.createConnection({
      uri: url,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    for (const t of payrollTables()) {
      let last = 0;
      let n = 0;
      try {
        for (;;) {
          const [rows] = await conn.query<mysql.RowDataPacket[]>(
            // eslint-disable-next-line no-restricted-syntax -- the table is a fixed name from payrollTables; values are bound
            `SELECT * FROM \`${t.tbl}\` WHERE \`srno\` > ? ORDER BY \`srno\` LIMIT ${String(PAGE)}`,
            [last],
          );
          const clean = rows.map((r) => {
            const p: Record<string, unknown> = { ...r };
            for (const k of NEVER_READ) delete p[k];
            return { id: String(r.srno), p };
          });
          if (clean.length)
            await db.withTenant(ctx, (c) =>
              c.query(
                `INSERT INTO payroll_legacy_rows (school_id, tbl, legacy_id, payload, read_id)
                 SELECT app.current_school_id(), $1, x.id, x.p, $2 FROM jsonb_to_recordset($3::jsonb) AS x(id text, p jsonb)
                 ON CONFLICT (school_id, tbl, legacy_id) DO UPDATE SET payload = EXCLUDED.payload, read_id = EXCLUDED.read_id`,
                [t.tbl, readId, JSON.stringify(clean)],
              ),
            );
          n += rows.length;
          if (rows.length < PAGE) break;
          last = Number(rows[rows.length - 1]!.srno);
        }
        counts[t.tbl] = n;
      } catch (e) {
        // an older install without this table: nothing of it to bring
        if ((e as { code?: string }).code === 'ER_NO_SUCH_TABLE') counts[t.tbl] = -1;
        else throw e;
      }
      // rows gone from the old database go from the holding area too
      await db.withTenant(ctx, (c) =>
        c.query(`DELETE FROM payroll_legacy_rows WHERE tbl = $1 AND read_id <> $2`, [
          t.tbl,
          readId,
        ]),
      );
    }
    await mark(
      `UPDATE payroll_cutover SET read_at = now(), read_id = $2, read_error = NULL, read_counts = $1::jsonb, updated_at = now()`,
      [JSON.stringify(counts), readId],
    );
    log.info({ schoolId, counts }, 'old payroll module read');
    return Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);
  } catch (e) {
    const m = clean(`${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`);
    await mark(`UPDATE payroll_cutover SET read_error = $1, updated_at = now()`, [m]);
    log.warn({ schoolId, error: m }, 'old payroll module not read');
    return 0;
  } finally {
    await conn?.end().catch(() => undefined);
  }
}
