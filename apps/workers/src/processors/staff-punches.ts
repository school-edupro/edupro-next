import mysql from 'mysql2/promise';
import type { Db } from '@edupro/db';
import type { Logger } from '../logger';

/**
 * Staff punches from the central device database (docs/design/85, phase C; the earlier module's "mini DB"
 * pull): every school's devices write to one MySQL table; each school reads only the rows of its own
 * device serials (Leave & attendance settings), after the last row id it read. Read only: nothing in the
 * source is changed. The connection and the table's column names come from the server's environment
 * (STAFF_PUNCH_DB_URL, STAFF_PUNCH_TABLE, STAFF_PUNCH_COL_ID / _EMP / _TIME / _DEVICE), never from the
 * code; without them nothing is pulled.
 */
const NAME = /^[A-Za-z0-9_]{1,64}$/;

export interface CentralSource {
  url: string;
  table: string;
  id: string;
  emp: string;
  time: string;
  device: string;
  batch: number;
}

export function centralSourceFromEnv(env: NodeJS.ProcessEnv = process.env): CentralSource | null {
  const url = env.STAFF_PUNCH_DB_URL;
  if (!url) return null;
  const s = {
    url,
    table: env.STAFF_PUNCH_TABLE ?? '',
    id: env.STAFF_PUNCH_COL_ID ?? 'id',
    emp: env.STAFF_PUNCH_COL_EMP ?? '',
    time: env.STAFF_PUNCH_COL_TIME ?? '',
    device: env.STAFF_PUNCH_COL_DEVICE ?? '',
    batch: Math.min(10000, Math.max(100, Number(env.STAFF_PUNCH_BATCH ?? 2000) || 2000)),
  };
  for (const k of ['table', 'id', 'emp', 'time', 'device'] as const)
    if (!NAME.test(s[k])) throw new Error(`STAFF_PUNCH ${k} is not a plain column or table name`);
  return s;
}

/** The SQL of one read (exported for the tests): rows of these devices after the mark, and the window's top. */
export function centralQueries(s: CentralSource) {
  const q = (n: string) => `\`${n}\``;
  return {
    // eslint-disable-next-line no-restricted-syntax -- the names are checked to be plain identifiers; values are bound
    rows: `SELECT ${q(s.id)} AS src_id, ${q(s.emp)} AS emp, DATE_FORMAT(${q(s.time)}, '%Y-%m-%d %H:%i:%s') AS dt, ${q(s.device)} AS dev
             FROM ${q(s.table)} WHERE ${q(s.id)} > ? AND ${q(s.device)} IN (?) ORDER BY ${q(s.id)} LIMIT ?`,
    // eslint-disable-next-line no-restricted-syntax -- the names are checked to be plain identifiers; values are bound
    top: `SELECT MAX(w.${q(s.id)}) AS top FROM (SELECT ${q(s.id)} FROM ${q(s.table)} WHERE ${q(s.id)} > ? ORDER BY ${q(s.id)} LIMIT ?) w`,
  };
}

/** Pull this school's new punches; the read mark moves past the rows scanned (other schools' rows too). */
export async function pullCentralPunches(
  db: Db,
  schoolId: string,
  source: CentralSource,
  log: Logger,
) {
  const ctx = { schoolId, userId: null, allowedSchoolIds: [schoolId] };
  const set = await db.withTenant(ctx, (c) =>
    c.query<{ serials: string[]; mark: string | null }>(
      `SELECT device_serials AS serials, punch_watermark AS mark FROM staff_leave_settings`,
    ),
  );
  const serials = set.rows[0]?.serials ?? [];
  if (!serials.length) return 0;
  const mark = Number(set.rows[0]?.mark ?? 0) || 0;
  const conn = await mysql.createConnection(source.url);
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const sql = centralQueries(source);
    const [rows] = await conn.query<mysql.RowDataPacket[]>(sql.rows, [mark, serials, source.batch]);
    const [top] = await conn.query<mysql.RowDataPacket[]>(sql.top, [mark, source.batch]);
    const scanned = Number(top[0]?.top ?? 0) || 0;
    const got = rows.length ? Math.max(...rows.map((r) => Number(r.src_id))) : 0;
    const next = Math.max(mark, scanned, got);
    await db.withTenant(ctx, async (c) => {
      for (const r of rows)
        await c.query(
          `INSERT INTO staff_punches (school_id, code, punched_at, source, device, ref)
           VALUES (app.current_school_id(), $1, $2::timestamp AT TIME ZONE 'Asia/Kolkata', 'central', $3, $4)
           ON CONFLICT DO NOTHING`,
          [
            String(r.emp).trim().slice(0, 60),
            String(r.dt),
            String(r.dev).slice(0, 60),
            String(r.src_id),
          ],
        );
      if (next !== mark)
        await c.query(`UPDATE staff_leave_settings SET punch_watermark = $1`, [String(next)]);
    });
    if (rows.length)
      log.info({ schoolId, rows: rows.length, mark: next }, 'central punches pulled');
    return rows.length;
  } finally {
    await conn.end();
  }
}
