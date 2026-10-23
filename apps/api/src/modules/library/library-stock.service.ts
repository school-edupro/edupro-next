import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { likeEscape } from './library-borrower-sql';
import { withEveryLibrary } from './library-staff.service';
import { libraryFile, type FileCell, type FileColumn } from './library-file';
import type {
  StockCancelDto,
  StockCloseDto,
  StockCycleDto,
  StockItemsExportDto,
  StockItemsQueryDto,
} from './library.dto';

type Method = 'scan' | 'excel' | 'manual';
type Entry = { no: string; remark?: string | null; row?: number };
type Classified = {
  no: string;
  row: number | null;
  remark: string | null;
  copyId: string | null;
  accessionNo: string | null;
  title: string | null;
  library: string | null;
  shelf: string | null;
  copyStatus: string | null;
  /** verify: in the cycle, not yet verified; already: verified before; outside: a copy not in the cycle */
  kind: 'verify' | 'already' | 'outside' | 'unknown' | 'repeated';
};

const MAX_FILE = 5 * 1024 * 1024;
const MAX_ROWS = 20000;
/** A copy's place in a cycle: verified, still to find, on loan, lost, withdrawn or sold since, missing. */
/** A cycle of my libraries (one over every library, or another's, is not there for someone limited). */
const MINE = `(app.my_libraries() IS NULL OR (cardinality(k.library_ids) > 0 AND k.library_ids <@ app.my_libraries()))`;
const STATE = `CASE WHEN i.outcome = 'found' THEN 'verified'
  WHEN i.outcome IN ('missing', 'on_loan', 'gone') THEN i.outcome
  WHEN x.status = 'issued' THEN 'on_loan'
  WHEN x.status IN ('lost', 'withdrawn', 'sold') THEN 'gone'
  ELSE 'pending' END`;
export const STOCK_STATE_LABEL: Record<string, string> = {
  verified: 'Verified',
  pending: 'Pending',
  on_loan: 'On loan',
  missing: 'Missing',
  gone: 'Lost, withdrawn or sold since',
};
const LIST_TITLE: Record<StockItemsQueryDto['state'], string> = {
  all: 'Stock check: every copy',
  verified: 'Stock check: verified',
  pending: 'Stock check: pending',
  on_loan: 'Stock check: on loan',
  missing: 'Stock check: missing',
  gone: 'Stock check: lost, withdrawn or sold since',
  extras: 'Stock check: numbers not in the cycle',
};
const ALIAS_NO = [
  'accession no',
  'accession number',
  'accession',
  'acc no',
  'book no',
  'book number',
  'barcode',
  'accessionno',
  'bookcode',
  'book code',
];
const ALIAS_REMARK = ['remark', 'remarks', 'note', 'notes', 'condition'];
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return v.result === undefined || v.result === null ? '' : String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
};

/**
 * Stock verification in cycles (docs/design/36-library.md, "Library reports", part 3): a cycle covers the
 * libraries, shelves and material types chosen and lists their copies on the shelves or on loan; a copy is
 * verified by a scan, a file of book numbers (checked before it is applied) or by hand; at the close the
 * copies not found are missing (marked lost if asked), those on loan are counted as on loan.
 */
@Injectable()
export class LibraryStockService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- cycles ------------------------------------------------------------------------------------
  private async cycle(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Stock cycle not found', { status: 404 });
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- MINE is a fixed fragment; values are bound
      `SELECT k.id::text, k.name, k.status, k.started_on::text, k.finished_on::text, k.note, k.cancel_reason,
              k.missing_marked_lost, k.reopened, k.reopen_log, k.closed_at, COALESCE(k.started_by_name, su.display_name) AS started_by,
              COALESCE(k.closed_by_name, cu.display_name) AS closed_by, k.library_ids::text[] AS library_ids,
              k.shelf_ids::text[] AS shelf_ids, k.material_type_ids::text[] AS material_type_ids,
              (SELECT jsonb_agg(jsonb_build_object('id', l.id::text, 'name', l.name) ORDER BY l.name)
                 FROM library_libraries l WHERE l.id = ANY(k.library_ids)) AS libraries,
              (SELECT jsonb_agg(jsonb_build_object('id', s.id::text, 'code', s.code, 'library', l.name) ORDER BY l.name, s.code)
                 FROM library_shelves s JOIN library_libraries l ON l.id = s.library_id WHERE s.id = ANY(k.shelf_ids)) AS shelves,
              (SELECT jsonb_agg(jsonb_build_object('id', m.id::text, 'name', m.name) ORDER BY m.name)
                 FROM library_material_types m WHERE m.id = ANY(k.material_type_ids)) AS types
         FROM library_stock_checks k
         LEFT JOIN users su ON su.id = k.started_by LEFT JOIN users cu ON cu.id = k.closed_by
        WHERE k.id = $1 AND ${MINE}`,
      [id],
    );
    const k = r.rows[0];
    if (!k) throw new DomainError('not-found', 'Stock cycle not found', { status: 404 });
    const n = await c.query<Record<string, string>>(
      // eslint-disable-next-line no-restricted-syntax -- the fixed state expression of this service
      `SELECT count(*)::text AS total,
              count(*) FILTER (WHERE z.state = 'verified')::text AS verified,
              count(*) FILTER (WHERE z.state = 'pending')::text AS pending,
              count(*) FILTER (WHERE z.state = 'on_loan')::text AS on_loan,
              count(*) FILTER (WHERE z.state = 'missing')::text AS missing,
              count(*) FILTER (WHERE z.state = 'gone')::text AS gone,
              (SELECT count(*) FROM library_stock_check_extras e WHERE e.check_id = $1 AND e.kind = 'outside')::text AS outside,
              (SELECT count(*) FROM library_stock_check_extras e WHERE e.check_id = $1 AND e.kind = 'unknown')::text AS unknown
         FROM (SELECT ${STATE} AS state FROM library_stock_check_items i JOIN library_copies x ON x.id = i.copy_id
                WHERE i.check_id = $1) z`,
      [id],
    );
    const m = n.rows[0]!;
    const counts = {
      total: Number(m.total),
      verified: Number(m.verified),
      pending: Number(m.pending),
      onLoan: Number(m.on_loan),
      missing: Number(m.missing),
      gone: Number(m.gone),
      outside: Number(m.outside),
      unknown: Number(m.unknown),
    };
    const libraries = (k.libraries as Array<{ id: string; name: string }> | null) ?? [];
    const shelves =
      (k.shelves as Array<{ id: string; code: string; library: string }> | null) ?? [];
    const types = (k.types as Array<{ id: string; name: string }> | null) ?? [];
    const accounted = counts.verified + counts.onLoan + counts.gone;
    return {
      id: String(k.id),
      name: String(k.name),
      status: String(k.status) as 'open' | 'closed' | 'cancelled',
      startedOn: String(k.started_on),
      finishedOn: k.finished_on as string | null,
      startedBy: k.started_by as string | null,
      closedBy: k.closed_by as string | null,
      note: k.note as string | null,
      cancelReason: k.cancel_reason as string | null,
      missingMarkedLost: Boolean(k.missing_marked_lost),
      reopened: Number(k.reopened ?? 0),
      reopenLog:
        (k.reopen_log as Array<{ at: string; by: string; reason: string; restored: number }>) ?? [],
      reopen:
        k.status === 'closed' ? await this.reopenCheck(c, String(k.id), String(k.name)) : null,
      scope: {
        libraries,
        shelves,
        materialTypes: types,
        words: [
          libraries.length ? libraries.map((x) => x.name).join(', ') : 'Every library',
          shelves.length ? `shelves ${shelves.map((x) => x.code).join(', ')}` : 'every shelf',
          types.length ? types.map((x) => x.name).join(', ') : 'every material type',
        ].join(' · '),
      },
      counts,
      done: counts.total ? Math.round((accounted / counts.total) * 1000) / 10 : 0,
    };
  }

  async cycles(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- MINE is a fixed fragment; values are bound
        `SELECT k.id::text FROM library_stock_checks k WHERE ${MINE}
          ORDER BY (k.status = 'open') DESC, k.started_on DESC, k.id DESC LIMIT 50`,
      );
      const out = [];
      for (const x of r.rows) out.push(await this.cycle(c, x.id));
      return out;
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.cycle(c, id));
  }

  /** A new cycle: the copies of its scope on the shelves, damaged or on loan; none may be in another open cycle. */
  async create(ctx: RequestContext, dto: StockCycleDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // one cycle made at a time per school, so two cannot take the same copies
      await c.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('library.stock.' || app.current_school_id()::text, 0))`,
      );
      // someone working in some libraries only: a cycle over every library is one over theirs
      const mine = (
        await c.query<{ ids: string[] | null }>(`SELECT app.my_libraries()::text[] AS ids`)
      ).rows[0]!.ids;
      const libs = dto.libraryIds.length || !mine ? dto.libraryIds : mine;
      const shelves = dto.shelfIds;
      const types = dto.materialTypeIds;
      const known = await c.query<{ l: string; s: string; m: string }>(
        `SELECT (SELECT count(*) FROM library_libraries WHERE id = ANY($1::bigint[]))::text AS l,
                (SELECT count(*) FROM library_shelves WHERE id = ANY($2::bigint[]))::text AS s,
                (SELECT count(*) FROM library_material_types WHERE id = ANY($3::bigint[]))::text AS m`,
        [libs, shelves, types],
      );
      const k = known.rows[0]!;
      if (
        Number(k.l) !== new Set(libs).size ||
        Number(k.s) !== new Set(shelves).size ||
        Number(k.m) !== new Set(types).size
      )
        throw new DomainError(
          'validation-failed',
          'A library, shelf or material type was not found',
          {
            status: 400,
          },
        );
      const scope = `FROM library_copies x JOIN library_titles t ON t.id = x.title_id
        WHERE x.status IN ('available', 'issued', 'damaged')
          AND (cardinality($1::bigint[]) = 0 OR x.library_id = ANY($1::bigint[]))
          AND (cardinality($2::bigint[]) = 0 OR x.shelf_id = ANY($2::bigint[]))
          AND (cardinality($3::bigint[]) = 0 OR t.material_type_id = ANY($3::bigint[]))`;
      const clash = await c.query<{ name: string; n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- the fixed scope of this service; values are bound
        `SELECT k.name, count(*)::text AS n FROM library_stock_check_items i
           JOIN library_stock_checks k ON k.id = i.check_id AND k.status = 'open'
          WHERE i.copy_id IN (SELECT x.id ${scope}) GROUP BY k.name ORDER BY k.name`,
        [libs, shelves, types],
      );
      if (clash.rows.length)
        throw new DomainError(
          'library.stock_overlap',
          `${clash.rows.map((x) => `${x.n} of these copies are in the open cycle "${x.name}"`).join('; ')}: close it, or choose other libraries, shelves or types`,
          { status: 409 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_stock_checks (school_id, name, started_by, started_by_name, note, library_ids, shelf_ids, material_type_ids)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2, $3, $4::bigint[], $5::bigint[], $6::bigint[])
         RETURNING id::text`,
        [dto.name, ctx.user.displayName, dto.note ?? null, libs, shelves, types],
      );
      const id = r.rows[0]!.id;
      const items = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the fixed scope of this service; values are bound
        `INSERT INTO library_stock_check_items (school_id, check_id, copy_id, outcome)
         SELECT app.current_school_id(), $4, x.id, 'pending' ${scope}`,
        [libs, shelves, types, id],
      );
      if (!items.rowCount)
        throw new DomainError(
          'library.stock_empty',
          'No copy on the shelves or on loan in these libraries, shelves and types',
          { status: 400 },
        );
      await c.query(`UPDATE library_stock_checks SET expected = $2 WHERE id = $1`, [
        id,
        items.rowCount,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'library.stock.start',
        entityType: 'library_stock_checks',
        entityId: id,
        after: { ...dto, copies: items.rowCount },
      });
      return this.cycle(c, id);
    });
  }

  private async open(c: PoolClient, id: string, lock = false) {
    const k = await this.cycle(c, id);
    if (k.status !== 'open')
      throw new DomainError('library.stock_closed', `The cycle "${k.name}" is ${k.status}`, {
        status: 409,
      });
    if (lock) await c.query(`SELECT 1 FROM library_stock_checks WHERE id = $1 FOR UPDATE`, [id]);
    return k;
  }

  // ---- verifying ---------------------------------------------------------------------------------
  /** What each number is to the cycle: a copy to verify, verified already, outside the cycle, unknown, repeated. */
  private async classify(c: PoolClient, id: string, entries: Entry[]): Promise<Classified[]> {
    if (!entries.length) return [];
    // a book of another library is named as such, not as unknown
    const r = await withEveryLibrary(c, () =>
      c.query<Record<string, unknown>>(
        `SELECT e.ord, e.no, x.id::text AS copy_id, x.accession_no, t.title, x.status::text AS copy_status,
              lib.name AS library, sh.code AS shelf, i.outcome
         FROM unnest($2::text[]) WITH ORDINALITY e(no, ord)
         LEFT JOIN LATERAL (SELECT app.library_copy_by_number(e.no) AS id) cp ON true
         LEFT JOIN library_copies x ON x.id = cp.id
         LEFT JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_libraries lib ON lib.id = x.library_id
         LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
         LEFT JOIN library_stock_check_items i ON i.check_id = $1 AND i.copy_id = x.id
        ORDER BY e.ord`,
        [id, entries.map((e) => e.no)],
      ),
    );
    const seen = new Set<string>();
    return r.rows.map((x, i) => {
      const e = entries[i]!;
      const copyId = x.copy_id as string | null;
      const key = copyId ?? `?${e.no.toUpperCase()}`;
      const kind: Classified['kind'] = seen.has(key)
        ? 'repeated'
        : !copyId
          ? 'unknown'
          : !x.outcome
            ? 'outside'
            : x.outcome === 'found'
              ? 'already'
              : 'verify';
      seen.add(key);
      return {
        no: e.no,
        row: e.row ?? null,
        remark: e.remark ?? null,
        copyId,
        accessionNo: x.accession_no as string | null,
        title: x.title as string | null,
        library: x.library as string | null,
        shelf: x.shelf as string | null,
        copyStatus: x.copy_status as string | null,
        kind,
      };
    });
  }

  /** The numbers applied: copies verified (with who, when, how), the rest kept as numbers outside the cycle. */
  private async apply(
    c: PoolClient,
    ctx: RequestContext,
    id: string,
    list: Classified[],
    method: Method,
  ) {
    const verify = list.filter((x) => x.kind === 'verify');
    if (verify.length)
      await c.query(
        `WITH v AS (SELECT * FROM unnest($2::bigint[], $3::text[]) AS v(copy_id, remark))
         UPDATE library_stock_check_items i
            SET outcome = 'found', found_on = CURRENT_DATE, found_at = now(), found_by = app.current_user_id(),
                found_by_name = $4, method = $5, remark = NULLIF(v.remark, '')
           FROM v WHERE i.check_id = $1 AND i.copy_id = v.copy_id AND i.outcome = 'pending'`,
        [
          id,
          verify.map((x) => x.copyId),
          verify.map((x) => x.remark ?? ''),
          ctx.user.displayName,
          method,
        ],
      );
    if (verify.length)
      await c.query(
        `UPDATE library_copies SET last_verified_on = CURRENT_DATE, updated_at = now() WHERE id = ANY($1::bigint[])`,
        [verify.map((x) => x.copyId)],
      );
    const extras = list.filter((x) => x.kind === 'outside' || x.kind === 'unknown');
    if (extras.length)
      await c.query(
        `INSERT INTO library_stock_check_extras (school_id, check_id, typed, copy_id, kind, method, remark, by_user, by_name)
         SELECT app.current_school_id(), $1, e.typed, e.copy_id, e.kind, $6, NULLIF(e.remark, ''), app.current_user_id(), $7
           FROM unnest($2::text[], $3::bigint[], $4::text[], $5::text[]) AS e(typed, copy_id, kind, remark)
         ON CONFLICT (check_id, upper(typed)) DO NOTHING`,
        [
          id,
          extras.map((x) => x.no),
          extras.map((x) => x.copyId),
          extras.map((x) => x.kind),
          extras.map((x) => x.remark ?? ''),
          method,
          ctx.user.displayName,
        ],
      );
    const pick = (k: Classified['kind']) =>
      list
        .filter((x) => x.kind === k)
        .map((x) => ({
          no: x.no,
          row: x.row,
          accessionNo: x.accessionNo,
          title: x.title,
          library: x.library,
          shelf: x.shelf,
        }));
    return {
      verified: pick('verify'),
      already: pick('already'),
      outside: pick('outside'),
      unknown: pick('unknown'),
      repeated: pick('repeated'),
      // verified on the shelf while the system has them on loan: their return was missed
      issued: verify
        .filter((x) => x.copyStatus === 'issued')
        .map((x) => ({ accessionNo: x.accessionNo, title: x.title })),
    };
  }

  /** Book numbers scanned or typed at the shelves. */
  async verify(ctx: RequestContext, id: string, numbers: string[], remark?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, id, true);
      const list = await this.classify(
        c,
        id,
        numbers.map((no) => ({ no: no.trim(), remark: remark ?? null })).filter((e) => e.no),
      );
      const result = await this.apply(c, ctx, id, list, 'scan');
      await this.audit.stage(ctx, c, {
        action: 'library.stock.scan',
        entityType: 'library_stock_checks',
        entityId: id,
        after: {
          numbers: numbers.length,
          verified: result.verified.length,
          outside: result.outside.length,
          unknown: result.unknown.length,
        },
      });
      return { ...result, cycle: await this.cycle(c, id) };
    });
  }

  /** One copy verified by hand (from the pending list), or taken back to pending. */
  async mark(ctx: RequestContext, id: string, copyId: string, found: boolean, remark?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, id, true);
      if (!/^\d{1,18}$/.test(copyId))
        throw new DomainError('not-found', 'Copy not in this cycle', { status: 404 });
      const r = found
        ? await c.query(
            `UPDATE library_stock_check_items SET outcome = 'found', found_on = CURRENT_DATE, found_at = now(),
                    found_by = app.current_user_id(), found_by_name = $3, method = 'manual', remark = $4
              WHERE check_id = $1 AND copy_id = $2 AND outcome = 'pending'`,
            [id, copyId, ctx.user.displayName, remark ?? null],
          )
        : await c.query(
            `UPDATE library_stock_check_items SET outcome = 'pending', found_on = NULL, found_at = NULL, found_by = NULL,
                    found_by_name = NULL, method = NULL, remark = NULL
              WHERE check_id = $1 AND copy_id = $2 AND outcome = 'found'`,
            [id, copyId],
          );
      if (!r.rowCount)
        throw new DomainError(
          'library.stock_item',
          found
            ? 'The copy is not pending in this cycle'
            : 'The copy is not verified in this cycle',
          { status: 409 },
        );
      // the copy's last check: today, or the one before when taken back
      await c.query(
        `UPDATE library_copies x SET last_verified_on = CASE WHEN $2 THEN CURRENT_DATE ELSE
                (SELECT max(i.found_on) FROM library_stock_check_items i WHERE i.copy_id = x.id AND i.outcome = 'found') END,
                updated_at = now()
          WHERE x.id = $1`,
        [copyId, found],
      );
      await this.audit.stage(ctx, c, {
        action: found ? 'library.stock.verify' : 'library.stock.unverify',
        entityType: 'library_stock_checks',
        entityId: id,
        after: { copyId, remark: remark ?? null },
      });
      return this.cycle(c, id);
    });
  }

  // ---- a file of book numbers --------------------------------------------------------------------
  /** The book numbers of an .xlsx, .csv or .txt: a column headed Accession no. (or Book no., Barcode), else the first. */
  private async parse(fileName: string, body: Buffer): Promise<Entry[]> {
    const out: Entry[] = [];
    const take = (rows: string[][], firstRow: number) => {
      let at = 0;
      let remarkAt = -1;
      let start = 0;
      for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
        const cells = rows[i]!.map((x) => norm(x));
        const n = cells.findIndex((x) => ALIAS_NO.includes(x));
        if (n >= 0) {
          at = n;
          remarkAt = cells.findIndex((x) => ALIAS_REMARK.includes(x));
          start = i + 1;
          break;
        }
      }
      rows.slice(start).forEach((cells, i) => {
        const no = (cells[at] ?? '').trim();
        if (!no) return;
        out.push({
          no: no.slice(0, 40),
          remark: remarkAt >= 0 ? (cells[remarkAt] ?? '').trim().slice(0, 200) || null : null,
          row: firstRow + start + i,
        });
      });
    };
    if (/\.(csv|txt)$/i.test(fileName)) {
      const lines = body.toString('utf8').replace(/^﻿/, '').split(/\r?\n/);
      take(
        lines.map((l) => l.split(/[,\t;]/).map((x) => x.replace(/^"|"$/g, ''))),
        1,
      );
    } else {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(body as unknown as ArrayBuffer);
      } catch {
        throw new DomainError('validation-failed', 'Not a readable .xlsx file', { status: 400 });
      }
      const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
      if (!ws) throw new DomainError('validation-failed', 'The file is empty', { status: 400 });
      const rows: string[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        if (n > MAX_ROWS + 10) return;
        const cells: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cells[col - 1] = cellText(cell.value).trim();
        });
        rows[n - 1] = cells;
      });
      take(
        Array.from(rows, (r) => r ?? []),
        1,
      );
    }
    if (!out.length)
      throw new DomainError('validation-failed', 'No book numbers in the file', { status: 400 });
    if (out.length > MAX_ROWS)
      throw new DomainError(
        'validation-failed',
        `More than ${String(MAX_ROWS)} numbers: split the file`,
        { status: 400 },
      );
    return out;
  }

  /** A file checked against the cycle and kept until applied or discarded. */
  async upload(ctx: RequestContext, id: string, fileName: string, body: unknown) {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Send the file as the request body', {
        status: 400,
      });
    if (body.length > MAX_FILE)
      throw new DomainError('validation-failed', 'File larger than 5 MB: split it', {
        status: 400,
      });
    if (!/\.(xlsx|csv|txt)$/i.test(fileName))
      throw new DomainError('validation-failed', 'An .xlsx, .csv or .txt file, please', {
        status: 400,
      });
    const entries = await this.parse(fileName, body);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, id);
      const r = await c.query<{ id: string }>(
        `INSERT INTO library_stock_uploads (school_id, check_id, file_name, rows, by_user, by_name)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id(), $4) RETURNING id::text`,
        [id, fileName.slice(0, 200), JSON.stringify(entries), ctx.user.displayName],
      );
      return this.uploadIn(c, r.rows[0]!.id);
    });
  }

  private async uploadIn(c: PoolClient, uploadId: string) {
    if (!/^\d{1,18}$/.test(uploadId))
      throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const r = await c.query<{
      id: string;
      check_id: string;
      file_name: string;
      rows: Entry[];
      status: string;
      result: Record<string, unknown> | null;
      by_name: string | null;
      at: string;
    }>(
      `SELECT id::text, check_id::text, file_name, rows, status, result, by_name, at::text
         FROM library_stock_uploads WHERE id = $1`,
      [uploadId],
    );
    const u = r.rows[0];
    if (!u) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const list = u.status === 'checked' ? await this.classify(c, u.check_id, u.rows) : [];
    const of = (k: Classified['kind']) => list.filter((x) => x.kind === k);
    const show = (k: Classified['kind']) =>
      of(k)
        .slice(0, 300)
        .map((x) => ({
          row: x.row,
          no: x.no,
          accessionNo: x.accessionNo,
          title: x.title,
          library: x.library,
          shelf: x.shelf,
        }));
    return {
      id: u.id,
      cycleId: u.check_id,
      fileName: u.file_name,
      status: u.status,
      by: u.by_name,
      at: u.at,
      numbers: u.rows.length,
      counts:
        u.status === 'checked'
          ? {
              verify: of('verify').length,
              already: of('already').length,
              outside: of('outside').length,
              unknown: of('unknown').length,
              repeated: of('repeated').length,
            }
          : ((u.result?.counts as Record<string, number> | undefined) ?? null),
      lists:
        u.status === 'checked'
          ? {
              verify: show('verify'),
              already: show('already'),
              outside: show('outside'),
              unknown: show('unknown'),
              repeated: show('repeated'),
            }
          : null,
    };
  }

  async getUpload(ctx: RequestContext, uploadId: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.uploadIn(c, uploadId));
  }

  /** The checked file applied to its cycle as it stands now. */
  async applyUpload(ctx: RequestContext, uploadId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.uploadIn(c, uploadId);
      if (u.status !== 'checked')
        throw new DomainError('library.stock_upload', `The file is ${u.status} already`, {
          status: 409,
        });
      await this.open(c, u.cycleId, true);
      const rows = (
        await c.query<{ rows: Entry[] }>(`SELECT rows FROM library_stock_uploads WHERE id = $1`, [
          uploadId,
        ])
      ).rows[0]!.rows;
      const list = await this.classify(c, u.cycleId, rows);
      const result = await this.apply(c, ctx, u.cycleId, list, 'excel');
      const counts = {
        verify: result.verified.length,
        already: result.already.length,
        outside: result.outside.length,
        unknown: result.unknown.length,
        repeated: result.repeated.length,
      };
      await c.query(
        `UPDATE library_stock_uploads SET status = 'applied', applied_at = now(), result = $2::jsonb WHERE id = $1`,
        [uploadId, JSON.stringify({ counts })],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.upload',
        entityType: 'library_stock_checks',
        entityId: u.cycleId,
        after: { uploadId, fileName: u.fileName, ...counts },
      });
      return { ...result, counts, cycle: await this.cycle(c, u.cycleId) };
    });
  }

  async discardUpload(ctx: RequestContext, uploadId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.uploadIn(c, uploadId);
      if (u.status !== 'checked')
        throw new DomainError('library.stock_upload', `The file is ${u.status} already`, {
          status: 409,
        });
      await c.query(`UPDATE library_stock_uploads SET status = 'discarded' WHERE id = $1`, [
        uploadId,
      ]);
      return { id: uploadId, cycleId: u.cycleId, status: 'discarded' };
    });
  }

  /** The upload layout: Accession no. and Remarks, with a note on what else is read. */
  async template() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EduPro';
    const ws = wb.addWorksheet('Stock check');
    ws.columns = [
      { header: 'Accession no.', width: 18 },
      { header: 'Remarks', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.addRow(['B00001', 'Spine torn']);
    ws.addRow(['B00002', '']);
    const about = wb.addWorksheet('How to fill');
    [
      'One book number a row under "Accession no." (an old accession number or the barcode is found too).',
      'Remarks are kept with the copy in the cycle (optional).',
      'A scanner file without a heading works too: the first column is read.',
      'A .csv or .txt file with one number a line works the same.',
      'The file is checked first: you see what is verified, verified already, outside the cycle or unknown, then apply it.',
    ].forEach((l) => about.addRow([l]));
    about.getColumn(1).width = 110;
    const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    return {
      filename: 'Stock-check-upload.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  // ---- the lists ---------------------------------------------------------------------------------
  private async itemRows(
    c: PoolClient,
    id: string,
    q: StockItemsQueryDto,
    limit: number,
    offset = 0,
  ) {
    const args: unknown[] = [id];
    const arg = (v: unknown) => {
      args.push(v);
      return `$${String(args.length)}`;
    };
    if (q.state === 'extras') {
      const r = await c.query<Record<string, unknown>>(
        `SELECT e.typed, e.kind, e.method, e.remark, e.by_name, e.at::date::text AS on_day, x.accession_no, t.title,
                lib.name AS library, sh.code AS shelf, x.status::text AS copy_status, count(*) OVER () AS __total
           FROM library_stock_check_extras e
           LEFT JOIN library_copies x ON x.id = e.copy_id LEFT JOIN library_titles t ON t.id = x.title_id
           LEFT JOIN library_libraries lib ON lib.id = x.library_id LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
          WHERE e.check_id = $1 AND ($2::text IS NULL OR e.typed ILIKE $2 OR t.title ILIKE $2)
          ORDER BY e.kind, e.at DESC LIMIT $3 OFFSET $4`,
        [id, q.q ? likeEscape(q.q) : null, limit, offset],
      );
      return {
        rows: r.rows.map((x) => ({
          kind: 'extra' as const,
          typed: String(x.typed),
          extra: String(x.kind),
          method: String(x.method),
          remark: x.remark as string | null,
          by: x.by_name as string | null,
          on: x.on_day as string | null,
          accessionNo: x.accession_no as string | null,
          title: x.title as string | null,
          library: x.library as string | null,
          shelf: x.shelf as string | null,
          copyStatus: x.copy_status as string | null,
        })),
        total: Number(r.rows[0]?.__total ?? 0),
      };
    }
    const where: string[] = ['i.check_id = $1'];
    if (q.state !== 'all') where.push(`(${STATE}) = ${arg(q.state)}`);
    if (q.libraryId) where.push(`x.library_id = ${arg(q.libraryId)}::bigint`);
    if (q.shelfId) where.push(`x.shelf_id = ${arg(q.shelfId)}::bigint`);
    if (q.materialTypeId) where.push(`t.material_type_id = ${arg(q.materialTypeId)}::bigint`);
    if (q.q) {
      const p = arg(likeEscape(q.q));
      where.push(
        `(x.accession_no ILIKE ${p} OR t.title ILIKE ${p} OR t.author ILIKE ${p} OR x.barcode ILIKE ${p})`,
      );
    }
    const n = args.length;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed expressions of this service; values are bound
      `SELECT x.id::text AS copy_id, x.accession_no, t.id::text AS title_id, t.title, t.author, lib.name AS library,
              sh.code AS shelf, x.rack, m.name AS material, x.status::text AS copy_status, ${STATE} AS state,
              i.found_on::text AS found_on, i.found_by_name, i.method, i.remark,
              ln.borrower, ln.ref, ln.due_on::text AS due_on, count(*) OVER () AS __total
         FROM library_stock_check_items i
         JOIN library_copies x ON x.id = i.copy_id JOIN library_titles t ON t.id = x.title_id
         LEFT JOIN library_libraries lib ON lib.id = x.library_id
         LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
         LEFT JOIN library_material_types m ON m.id = t.material_type_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(st.display_name, e.display_name) AS borrower, COALESCE(st.admission_no, e.employee_code) AS ref, lo.due_on
             FROM library_loans lo
             LEFT JOIN students st ON lo.borrower_kind = 'student' AND st.id = lo.borrower_id
             LEFT JOIN employees e ON lo.borrower_kind = 'employee' AND e.id = lo.borrower_id
            WHERE lo.copy_id = x.id AND lo.returned_on IS NULL LIMIT 1) ln ON true
        WHERE ${where.join(' AND ')}
        ORDER BY lib.name, sh.code NULLS LAST, x.rack NULLS LAST,
                 regexp_replace(x.accession_no, '[0-9]+$', ''), NULLIF(substring(x.accession_no FROM '[0-9]+$'), '')::numeric,
                 x.accession_no
        LIMIT $${n + 1} OFFSET $${n + 2}`,
      [...args, limit, offset],
    );
    return {
      rows: r.rows.map((x) => ({
        kind: 'copy' as const,
        copyId: String(x.copy_id),
        accessionNo: String(x.accession_no),
        titleId: String(x.title_id),
        title: String(x.title),
        author: x.author as string | null,
        library: x.library as string | null,
        shelf: x.shelf as string | null,
        rack: x.rack as string | null,
        material: x.material as string | null,
        copyStatus: String(x.copy_status),
        state: String(x.state),
        foundOn: x.found_on as string | null,
        foundBy: x.found_by_name as string | null,
        method: x.method as string | null,
        remark: x.remark as string | null,
        borrower: x.borrower as string | null,
        borrowerRef: x.ref as string | null,
        dueOn: x.due_on as string | null,
      })),
      total: Number(r.rows[0]?.__total ?? 0),
    };
  }

  async items(ctx: RequestContext, id: string, q: StockItemsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.cycle(c, id);
      const page = await this.itemRows(c, id, q, q.size, (q.page - 1) * q.size);
      return { ...page, page: q.page, pages: Math.max(1, Math.ceil(page.total / q.size)) };
    });
  }

  async itemsExport(ctx: RequestContext, id: string, q: StockItemsExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.cycle(c, id);
      const { rows } = await this.itemRows(c, id, q, 50000);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      let columns: FileColumn[];
      let cells: FileCell[][];
      if (q.state === 'extras') {
        columns = [
          { label: 'Number scanned', width: 1.6 },
          { label: 'What', width: 1.6 },
          { label: 'Book no.', width: 1.4 },
          { label: 'Book' },
          { label: 'Library', width: 1.6 },
          { label: 'Shelf', width: 1.2 },
          { label: 'Status', width: 1.2 },
          { label: 'On', type: 'date' },
          { label: 'By', width: 1.6 },
          { label: 'How', width: 1 },
          { label: 'Remarks', width: 2 },
        ];
        cells = rows.map((r) =>
          r.kind === 'extra'
            ? [
                r.typed,
                r.extra === 'outside' ? 'Not in this cycle' : 'No such book',
                r.accessionNo,
                r.title,
                r.library,
                r.shelf,
                r.copyStatus,
                r.on,
                r.by,
                r.method,
                r.remark,
              ]
            : [],
        );
      } else {
        columns = [
          { label: 'Book no.', width: 1.4 },
          { label: 'Book' },
          { label: 'Author', width: 2 },
          { label: 'Material', width: 1.4 },
          { label: 'Library', width: 1.6 },
          { label: 'Shelf', width: 1.1 },
          { label: 'Rack', width: 1 },
          { label: 'Stock check', width: 1.6 },
          { label: 'Verified on', type: 'date' },
          { label: 'By', width: 1.6 },
          { label: 'How', width: 1 },
          { label: 'Remarks', width: 2 },
          { label: 'On loan to', width: 2 },
          { label: 'Due on', type: 'date' },
        ];
        cells = rows.map((r) =>
          r.kind === 'copy'
            ? [
                r.accessionNo,
                r.title,
                r.author,
                r.material,
                r.library,
                r.shelf,
                r.rack,
                STOCK_STATE_LABEL[r.state] ?? r.state,
                r.foundOn,
                r.foundBy,
                r.method,
                r.remark,
                r.borrower ? `${r.borrower} (${r.borrowerRef ?? ''})` : null,
                r.dueOn,
              ]
            : [],
        );
      }
      const words = [
        `${k.name} (${k.scope.words})`,
        q.libraryId || q.shelfId || q.materialTypeId ? 'one library, shelf or type' : null,
        q.q ? `search "${q.q}"` : null,
      ]
        .filter(Boolean)
        .join('; ');
      await this.audit.stage(ctx, c, {
        action: 'library.stock.export',
        entityType: 'library_stock_checks',
        entityId: id,
        after: { state: q.state, format: q.format, rows: rows.length },
      });
      return libraryFile({
        format: q.format,
        name: LIST_TITLE[q.state],
        slug: `Stock-check-${q.state}`,
        school,
        by: ctx.user.displayName,
        words,
        columns,
        rows: cells,
      });
    });
  }

  // ---- closing -----------------------------------------------------------------------------------
  /** The cycle closed: copies not found are missing (lost if asked), those on loan counted as on loan. */
  async close(ctx: RequestContext, id: string, dto: StockCloseDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.open(c, id, true);
      await c.query(
        `UPDATE library_stock_check_items i
            SET outcome = CASE WHEN x.status = 'issued' THEN 'on_loan'
                               WHEN x.status IN ('lost', 'withdrawn', 'sold') THEN 'gone' ELSE 'missing' END
           FROM library_copies x WHERE x.id = i.copy_id AND i.check_id = $1 AND i.outcome = 'pending'`,
        [id],
      );
      if (dto.markMissingLost) {
        const why = `Missing at the stock check "${k.name}"`;
        // the status each copy had is kept on its event, so a reopened cycle can give it back
        const lost = await c.query<{ id: string; was: string }>(
          `WITH old AS (
             SELECT x.id, x.status::text AS was FROM library_copies x JOIN library_stock_check_items i ON i.copy_id = x.id
              WHERE i.check_id = $1 AND i.outcome = 'missing' AND x.status IN ('available', 'damaged') FOR UPDATE OF x)
           UPDATE library_copies x SET status = 'lost', status_on = CURRENT_DATE, status_reason = $2, updated_at = now()
             FROM old WHERE old.id = x.id
            RETURNING x.id::text, old.was`,
          [id, why],
        );
        if (lost.rows.length)
          await c.query(
            `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, on_date, reason, by_user, by_name)
             SELECT app.current_school_id(), u.id, 'lost', u.was, 'lost', CURRENT_DATE, $3, app.current_user_id(), $4
               FROM unnest($1::bigint[], $2::text[]) AS u(id, was)`,
            [lost.rows.map((x) => x.id), lost.rows.map((x) => x.was), why, ctx.user.displayName],
          );
      }
      await c.query(
        `UPDATE library_stock_checks SET status = 'closed', finished_on = CURRENT_DATE, closed_at = now(), closed_by = app.current_user_id(),
                closed_by_name = $3, note = COALESCE($2, note), missing_marked_lost = $4,
                found = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'found'),
                missing = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'missing'),
                on_loan = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'on_loan'),
                gone = (SELECT count(*) FROM library_stock_check_items WHERE check_id = $1 AND outcome = 'gone')
          WHERE id = $1`,
        [id, dto.note ?? null, ctx.user.displayName, dto.markMissingLost],
      );
      await c.query(
        `UPDATE library_stock_uploads SET status = 'discarded' WHERE check_id = $1 AND status = 'checked'`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.close',
        entityType: 'library_stock_checks',
        entityId: id,
        after: dto,
      });
      return this.cycle(c, id);
    });
  }

  /**
   * Whether a closed cycle may be reopened now: within the school's days of closing, and no later
   * cycle (open, or started after this one closed) holding any of its books.
   */
  private async reopenCheck(c: PoolClient, id: string, name: string) {
    const r = await c.query<{ days: number; until: string | null; blocked: string[] | null }>(
      `SELECT COALESCE((app.setting('library.stock_reopen_days') #>> '{}')::int, 7) AS days,
              (k.finished_on + COALESCE((app.setting('library.stock_reopen_days') #>> '{}')::int, 7))::text AS until,
              (SELECT array_agg(DISTINCT o.name ORDER BY o.name)
                 FROM library_stock_check_items i
                 JOIN library_stock_check_items j ON j.copy_id = i.copy_id AND j.check_id <> i.check_id
                 JOIN library_stock_checks o ON o.id = j.check_id
                WHERE i.check_id = k.id AND o.status <> 'cancelled'
                  AND (o.status = 'open' OR o.created_at > COALESCE(k.closed_at, k.finished_on::timestamp AT TIME ZONE 'Asia/Kolkata'))) AS blocked
         FROM library_stock_checks k WHERE k.id = $1`,
      [id],
    );
    const x = r.rows[0]!;
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const why =
      x.days === 0
        ? 'This school does not allow reopening a closed cycle (Library settings: days to reopen = 0).'
        : x.until && x.until < today
          ? `It can be reopened only up to ${String(x.days)} days after closing (until ${x.until.slice(8, 10)}-${x.until.slice(5, 7)}-${x.until.slice(0, 4)}). Start a new cycle instead.`
          : x.blocked?.length
            ? `Its books are now in ${x.blocked.map((b) => `"${b}"`).join(', ')}: close or cancel that cycle first, or start a new one.`
            : null;
    return { allowed: why === null, why, until: x.until, name };
  }

  /** A closed cycle reopened (with the reason): outcomes back to pending, copies it marked lost restored. */
  async reopen(ctx: RequestContext, id: string, dto: StockCancelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.cycle(c, id);
      if (k.status !== 'closed')
        throw new DomainError('library.stock_not_closed', `The cycle "${k.name}" is ${k.status}`, {
          status: 409,
        });
      await c.query(`SELECT 1 FROM library_stock_checks WHERE id = $1 FOR UPDATE`, [id]);
      const check = await this.reopenCheck(c, id, k.name);
      if (!check.allowed)
        throw new DomainError(
          'library.stock_reopen_refused',
          check.why ?? 'It cannot be reopened',
          {
            status: 409,
          },
        );
      // copies the close marked lost, still lost for that reason, get their earlier status back
      const why = `Missing at the stock check "${k.name}"`;
      const back = await c.query<{ id: string; was: string }>(
        `WITH x AS (
           SELECT y.id,
                  COALESCE((SELECT e.from_status FROM library_copy_events e
                             WHERE e.copy_id = y.id AND e.what = 'lost' AND e.reason = $2 ORDER BY e.at DESC, e.id DESC LIMIT 1), 'available') AS was
             FROM library_copies y JOIN library_stock_check_items i ON i.copy_id = y.id
            WHERE i.check_id = $1 AND y.status = 'lost' AND y.status_reason = $2 FOR UPDATE OF y)
         UPDATE library_copies y SET status = x.was::library_copy_status, status_on = CURRENT_DATE, status_reason = NULL, updated_at = now()
           FROM x WHERE x.id = y.id
         RETURNING y.id::text, x.was`,
        [id, why],
      );
      if (back.rows.length)
        await c.query(
          `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, on_date, reason, by_user, by_name)
           SELECT app.current_school_id(), u.id, 'available', 'lost', u.was, CURRENT_DATE, $3, app.current_user_id(), $4
             FROM unnest($1::bigint[], $2::text[]) AS u(id, was)`,
          [
            back.rows.map((x) => x.id),
            back.rows.map((x) => x.was),
            `Stock check "${k.name}" reopened: ${dto.reason}`,
            ctx.user.displayName,
          ],
        );
      await c.query(
        `UPDATE library_stock_check_items SET outcome = 'pending'
          WHERE check_id = $1 AND outcome IN ('missing', 'on_loan', 'gone')`,
        [id],
      );
      await c.query(
        `UPDATE library_stock_checks
            SET status = 'open', finished_on = NULL, closed_at = NULL, closed_by = NULL, closed_by_name = NULL,
                missing_marked_lost = false, found = 0, missing = 0, on_loan = 0, gone = 0, reopened = reopened + 1,
                reopen_log = reopen_log || jsonb_build_array(jsonb_build_object('at', now(), 'by', $2::text, 'reason', $3::text,
                               'restored', $4::int, 'closedOn', $5::text))
          WHERE id = $1`,
        [id, ctx.user.displayName, dto.reason, back.rows.length, k.finishedOn],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.reopen',
        entityType: 'library_stock_checks',
        entityId: id,
        before: {
          status: 'closed',
          finishedOn: k.finishedOn,
          missingMarkedLost: k.missingMarkedLost,
        },
        after: { reason: dto.reason, restored: back.rows.length },
      });
      return this.cycle(c, id);
    });
  }

  /** An open cycle made by mistake: cancelled with the reason (its copies are free for another cycle). */
  async cancel(ctx: RequestContext, id: string, dto: StockCancelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.open(c, id, true);
      await c.query(
        `UPDATE library_stock_checks SET status = 'cancelled', finished_on = CURRENT_DATE, closed_by = app.current_user_id(),
                closed_by_name = $3, cancel_reason = $2 WHERE id = $1`,
        [id, dto.reason, ctx.user.displayName],
      );
      await c.query(
        `UPDATE library_stock_uploads SET status = 'discarded' WHERE check_id = $1 AND status = 'checked'`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.stock.cancel',
        entityType: 'library_stock_checks',
        entityId: id,
        after: dto,
      });
      return this.cycle(c, id);
    });
  }
}
