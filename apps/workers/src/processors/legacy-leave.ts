import mysql from 'mysql2/promise';
import type { Db } from '@edupro/db';
import type { Logger } from '../logger';

/**
 * Reading the earlier leave module's database for the cut-over (docs/design/85, phase E). Read only:
 * nothing in the old database is changed. The connection comes from the server's environment —
 * LEGACY_LEAVE_DB_URL, or LEGACY_LEAVE_DB_URL_<SCHOOL CODE> when schools have their own — never from the
 * code or the app; without it nothing is read and the cut-over page says so. The rows land in
 * staff_legacy_rows as they are (one row a table row); the API maps them.
 */
export function legacyUrlFromEnv(schoolCode: string, env: NodeJS.ProcessEnv = process.env) {
  const own = env[`LEGACY_LEAVE_DB_URL_${schoolCode.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  return own || env.LEGACY_LEAVE_DB_URL || null;
}

/**
 * The tables read and what of each: the set-up whole, the history from the financial year's start (`since`,
 * YYYY-MM-DD; the balance ledger by its year and month). Exported for the tests.
 */
export function legacyTables(
  since: string,
): Array<{ tbl: string; where: string; args: unknown[] }> {
  const ym = Number(since.slice(0, 4)) * 100 + Number(since.slice(5, 7));
  const all = { where: '1 = 1', args: [] as unknown[] };
  return [
    ...[
      'al_leave_type',
      'al_leave_policy',
      'al_weekoff_rule',
      'al_holiday_scope',
      'al_shift_master',
      'al_shift_assignment',
      'al_dept_timing',
      'al_emp_timing',
      'al_emp_timing_special',
      'al_approval_matrix',
      'al_employeetype_master',
      'al_month_lock',
    ].map((tbl) => ({ tbl, ...all })),
    {
      tbl: 'al_holiday_master',
      where: 'COALESCE(`HolidayToDate`, `HolidayDate`) >= ?',
      args: [since],
    },
    { tbl: 'al_leave_balance', where: '`BalYear` * 100 + `BalMonth` >= ?', args: [ym] },
    { tbl: 'al_leave_request', where: '`ToDate` >= ?', args: [since] },
    { tbl: 'al_leave_request_day', where: '`LeaveDate` >= ?', args: [since] },
    { tbl: 'al_attendance_daily', where: '`AttDate` >= ?', args: [since] },
    { tbl: 'al_late_mark', where: '`AttDate` >= ?', args: [since] },
    { tbl: 'al_forgot_punch', where: '`AttDate` >= ?', args: [since] },
    { tbl: 'al_regularization', where: '`AttDate` >= ?', args: [since] },
  ];
}

/** The settings pages read from tbl_module_settings: the module's settings and the reports' access lists. */
export const LEGACY_SETTING_PAGES = [
  'Admin/AttendanceLeave/attendance_settings.php',
  'Admin/AttendanceLeave/mis_reports.php',
];

const PAGE = 5000;
/** A message without the user and host an access error names. */
const clean = (m: string) => m.replace(/'[^']*'@'[^']*'/g, "'…'").slice(0, 480);

/** The financial year's first day (1 April) of a day. */
export const fyStartOf = (day: string) => {
  const y = Number(day.slice(0, 4));
  return Number(day.slice(5, 7)) >= 4 ? `${String(y)}-04-01` : `${String(y - 1)}-04-01`;
};

/** Read every table into the staging rows of a school; the cut-over record says when, how many, or why not. */
export async function readLegacyLeave(db: Db, schoolId: string, log: Logger) {
  const ctx = { schoolId, userId: null, allowedSchoolIds: [schoolId] };
  const info = await db.withTenant(ctx, (c) =>
    c.query<{ code: string; month: string | null }>(
      `SELECT s.code, c.parallel_month::text AS month FROM schools s LEFT JOIN staff_cutover c ON c.school_id = s.id
        WHERE s.id = app.current_school_id()`,
    ),
  );
  const code = info.rows[0]?.code ?? '';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const since = fyStartOf(info.rows[0]?.month ?? today);
  const mark = (sql: string, args: unknown[]) =>
    db.withTenant(ctx, (c) =>
      c
        .query(
          `INSERT INTO staff_cutover (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
        )
        .then(() => c.query(sql, args)),
    );
  await mark(`UPDATE staff_cutover SET read_started_at = now(), updated_at = now()`, []);
  const url = legacyUrlFromEnv(code);
  if (!url) {
    await mark(`UPDATE staff_cutover SET read_error = $1, updated_at = now()`, [
      'The server has no connection to the old database (LEGACY_LEAVE_DB_URL): ask IT to set it',
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
    const put = async (tbl: string, rows: Array<{ id: string; p: unknown }>) => {
      if (!rows.length) return;
      await db.withTenant(ctx, (c) =>
        c.query(
          `INSERT INTO staff_legacy_rows (school_id, tbl, legacy_id, payload, read_id)
           SELECT app.current_school_id(), $1, x.id, x.p, $2 FROM jsonb_to_recordset($3::jsonb) AS x(id text, p jsonb)
           ON CONFLICT (school_id, tbl, legacy_id) DO UPDATE SET payload = EXCLUDED.payload, read_id = EXCLUDED.read_id`,
          [tbl, readId, JSON.stringify(rows)],
        ),
      );
    };
    for (const t of legacyTables(since)) {
      let last = 0;
      let n = 0;
      try {
        for (;;) {
          const [rows] = await conn.query<mysql.RowDataPacket[]>(
            // eslint-disable-next-line no-restricted-syntax -- the table and the filter are fixed in legacyTables; values are bound
            `SELECT * FROM \`${t.tbl}\` WHERE \`srno\` > ? AND ${t.where} ORDER BY \`srno\` LIMIT ${String(PAGE)}`,
            [last, ...t.args],
          );
          await put(
            t.tbl,
            rows.map((r) => ({ id: String(r.srno), p: r })),
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
      // rows gone from the old database go from the staging area too
      await db.withTenant(ctx, (c) =>
        c.query(`DELETE FROM staff_legacy_rows WHERE tbl = $1 AND read_id <> $2`, [t.tbl, readId]),
      );
    }
    const [settings] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT `page_url`, `setting_key`, `setting_value` FROM `tbl_module_settings` WHERE `page_url` IN (?)',
      [LEGACY_SETTING_PAGES],
    );
    await put(
      'tbl_module_settings',
      settings.map((r) => ({
        id: `${String(r.page_url)}|${String(r.setting_key)}`.slice(0, 200),
        p: r,
      })),
    );
    await db.withTenant(ctx, (c) =>
      c.query(`DELETE FROM staff_legacy_rows WHERE tbl = 'tbl_module_settings' AND read_id <> $1`, [
        readId,
      ]),
    );
    counts.tbl_module_settings = settings.length;
    await mark(
      `UPDATE staff_cutover SET read_at = now(), read_error = NULL, read_counts = $1::jsonb, updated_at = now()`,
      [JSON.stringify(counts)],
    );
    log.info({ schoolId, counts }, 'old leave module read');
    return Object.values(counts).reduce((a, b) => a + Math.max(0, b), 0);
  } catch (e) {
    const m = clean(`${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`);
    await mark(`UPDATE staff_cutover SET read_error = $1, updated_at = now()`, [m]);
    log.warn({ schoolId, error: m }, 'old leave module read failed');
    return 0;
  } finally {
    await conn?.end();
  }
}
