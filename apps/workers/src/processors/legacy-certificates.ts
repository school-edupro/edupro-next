import mysql from 'mysql2/promise';
import type { Db } from '@edupro/db';
import type { Logger } from '../logger';

/**
 * Reading the old certificate register for the move to EduPro (docs/design/87, phase F). Read only: nothing in the
 * old database is changed. The connection comes from the server's environment — LEGACY_CERT_DB_URL (or
 * LEGACY_CERT_DB_URL_<SCHOOL CODE>), else the leave cut-over's LEGACY_LEAVE_DB_URL when the modules share the old ERP
 * database — never from the code or the app; without it nothing is read and the page says so. The rows land in certificate_legacy_rows as they are; the API maps them. Only counts
 * go to the log, never a name.
 */
export function legacyCertUrlFromEnv(schoolCode: string, env: NodeJS.ProcessEnv = process.env) {
  const key = schoolCode.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return (
    env[`LEGACY_CERT_DB_URL_${key}`] ||
    env.LEGACY_CERT_DB_URL ||
    env[`LEGACY_LEAVE_DB_URL_${key}`] ||
    env.LEGACY_LEAVE_DB_URL ||
    null
  );
}

const PAGE = 1000;
/** the old register's setting of the TC book's last Sl. No. */
const BOOK_SETTING = { page: '/Admin/Certificate/CertificateManager.php', key: 'tc_last_sl_no' };

export async function readLegacyCertificates(db: Db, schoolId: string, log: Logger) {
  const ctx = { schoolId, userId: null, allowedSchoolIds: [schoolId] };
  const code =
    (
      await db.withTenant(ctx, (c) =>
        c.query<{ code: string }>(`SELECT code FROM schools WHERE id = app.current_school_id()`),
      )
    ).rows[0]?.code ?? '';
  const mark = (sql: string, args: unknown[]) =>
    db.withTenant(ctx, (c) =>
      c
        .query(
          `INSERT INTO certificate_cutover (school_id) VALUES (app.current_school_id()) ON CONFLICT (school_id) DO NOTHING`,
        )
        .then(() => c.query(sql, args)),
    );
  await mark(
    `UPDATE certificate_cutover SET read_started_at = now(), read_error = NULL, updated_at = now()`,
    [],
  );
  const url = legacyCertUrlFromEnv(code);
  if (!url) {
    await mark(`UPDATE certificate_cutover SET read_error = $1, updated_at = now()`, [
      'The server has no connection to the old database (LEGACY_CERT_DB_URL): ask IT to set it',
    ]);
    return 0;
  }
  const readId = Date.now();
  let conn: mysql.Connection | null = null;
  let n = 0;
  let bookLast: number | null = null;
  try {
    conn = await mysql.createConnection({
      uri: url,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    let last = 0;
    for (;;) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(
        // eslint-disable-next-line no-restricted-syntax -- PAGE is a constant; the value is bound
        `SELECT * FROM \`certificate_master\` WHERE \`srno\` > ? ORDER BY \`srno\` LIMIT ${String(PAGE)}`,
        [last],
      );
      if (rows.length)
        await db.withTenant(ctx, (c) =>
          c.query(
            `INSERT INTO certificate_legacy_rows (school_id, srno, payload, read_id)
             SELECT app.current_school_id(), x.srno, x.p, $1 FROM jsonb_to_recordset($2::jsonb) AS x(srno bigint, p jsonb)
             ON CONFLICT (school_id, srno) DO UPDATE SET payload = EXCLUDED.payload, read_id = EXCLUDED.read_id`,
            [readId, JSON.stringify(rows.map((r) => ({ srno: Number(r.srno), p: r })))],
          ),
        );
      n += rows.length;
      if (rows.length < PAGE) break;
      last = Number(rows[rows.length - 1]!.srno);
    }
    try {
      const [s] = await conn.query<mysql.RowDataPacket[]>(
        'SELECT `setting_value` FROM `tbl_module_settings` WHERE `page_url` = ? AND `setting_key` = ? LIMIT 1',
        [BOOK_SETTING.page, BOOK_SETTING.key],
      );
      const v = Number(s[0]?.setting_value);
      bookLast = Number.isInteger(v) && v >= 0 ? v : null;
    } catch {
      bookLast = null;
    }
    await mark(
      `UPDATE certificate_cutover SET read_at = now(), read_counts = $1::jsonb, book_last_sl = $2, read_error = NULL, updated_at = now()`,
      [JSON.stringify({ certificate_master: n }), bookLast],
    );
    log.info({ schoolId, rows: n }, 'old certificate register read');
    return n;
  } catch (e) {
    const msg =
      (e as { code?: string; message?: string }).code === 'ER_NO_SUCH_TABLE'
        ? 'The old database has no certificate register (certificate_master)'
        : 'The old database could not be read: check the connection';
    await mark(`UPDATE certificate_cutover SET read_error = $1, updated_at = now()`, [msg]);
    log.warn(
      { schoolId, code: (e as { code?: string }).code },
      'old certificate register not read',
    );
    return 0;
  } finally {
    await conn?.end().catch(() => undefined);
  }
}
