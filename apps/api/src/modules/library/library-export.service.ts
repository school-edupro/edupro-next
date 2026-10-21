import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { BookExportDto, BookFilter, BookLayoutDto } from './library-books.dto';
import { bookFilter, bookSort } from './library-filter';
import { REGISTER_FROM, registerViewText, registerWhere } from './library-register';
import { LIBRARY } from './library.dto';

const REPORT = 'library.books';
const LAST = 'library.books.export.last';
const LIMIT = 20000;
type Level = 'copy' | 'title';
type Cell = string | number | Date | null;
type Row = Record<string, unknown>;
/** India time as Excel shows it (a workbook has no time zone). */
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const day = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v));
const STATUS: Record<string, string> = {
  available: 'On the shelf',
  issued: 'Issued',
  lost: 'Lost',
  damaged: 'Damaged',
  withdrawn: 'Withdrawn',
  sold: 'Sold',
};

/** A column the librarian can pick: its group, the rows it fits (copies, titles or both), how it fills. */
interface ColDef {
  key: string;
  group: string;
  header: string;
  width: number;
  date?: 'day';
  levels: Level[];
  value: (r: Row) => Cell;
}
const GROUPS: Array<{ id: string; title: string; levels: Level[] }> = [
  { id: 'title', title: 'The book', levels: ['copy', 'title'] },
  { id: 'publication', title: 'Publication', levels: ['copy', 'title'] },
  { id: 'copy', title: 'The copy', levels: ['copy'] },
  { id: 'source', title: 'How it came', levels: ['copy'] },
  { id: 'loan', title: 'Loan', levels: ['copy'] },
  { id: 'counts', title: 'Copies of the title', levels: ['title'] },
];
const BOTH: Level[] = ['copy', 'title'];
const COPY: Level[] = ['copy'];
const TITLE: Level[] = ['title'];
const col = (
  key: string,
  group: string,
  header: string,
  width: number,
  levels: Level[],
  value: ColDef['value'],
  date?: 'day',
): ColDef => ({ key, group, header, width, levels, value, ...(date ? { date } : {}) });

const CATALOGUE: ColDef[] = [
  col('title.code', 'title', 'Catalogue code', 12, BOTH, (r) => str(r.code)),
  col('title.title', 'title', 'Title', 36, BOTH, (r) => str(r.title)),
  col('title.subtitle', 'title', 'Subtitle', 30, BOTH, (r) => str(r.subtitle)),
  col('title.authors', 'title', 'Authors', 28, BOTH, (r) => str(r.author)),
  col('title.others', 'title', 'Editors and others', 28, BOTH, (r) => str(r.others)),
  col('title.material', 'title', 'Material type', 14, BOTH, (r) => str(r.material)),
  col('title.subject', 'title', 'Subject', 18, BOTH, (r) => str(r.subject)),
  col('title.sub_subject', 'title', 'Sub-subject', 18, BOTH, (r) => str(r.sub_subject)),
  col('title.call_no', 'title', 'Call number', 14, BOTH, (r) => str(r.call_no)),
  col('title.class', 'title', 'For class', 12, BOTH, (r) => str(r.class)),
  col('title.keywords', 'title', 'Keywords', 24, BOTH, (r) =>
    (r.keywords as string[] | null)?.length ? (r.keywords as string[]).join(', ') : null,
  ),
  col('title.reference', 'title', 'Reference only', 10, BOTH, (r) => (r.not_issued ? 'Yes' : 'No')),
  col('title.notes', 'title', 'Notes', 30, BOTH, (r) => str(r.notes)),
  col('pub.publisher', 'publication', 'Publisher', 24, BOTH, (r) => str(r.publisher)),
  col('pub.place', 'publication', 'Place of publication', 16, BOTH, (r) =>
    str(r.publication_place),
  ),
  col('pub.year', 'publication', 'Year', 8, BOTH, (r) => num(r.year)),
  col('pub.edition', 'publication', 'Edition', 10, BOTH, (r) => str(r.edition)),
  col('pub.volume', 'publication', 'Volume', 10, BOTH, (r) => str(r.volume)),
  col('pub.pages', 'publication', 'Pages', 8, BOTH, (r) => num(r.pages)),
  col('pub.isbn', 'publication', 'ISBN', 16, BOTH, (r) => str(r.isbn)),
  col('pub.language', 'publication', 'Language', 12, BOTH, (r) => str(r.language)),
  col('pub.price', 'publication', 'Price as printed (₹)', 12, BOTH, (r) => num(r.title_price)),
  col('copy.accession', 'copy', 'Accession no.', 14, COPY, (r) => str(r.accession_no)),
  col('copy.library', 'copy', 'Library', 18, COPY, (r) => str(r.library)),
  col('copy.shelf', 'copy', 'Shelf', 10, COPY, (r) => str(r.shelf)),
  col('copy.rack', 'copy', 'Rack', 8, COPY, (r) => str(r.rack)),
  col('copy.barcode', 'copy', 'Barcode', 14, COPY, (r) => str(r.barcode)),
  col('copy.status', 'copy', 'Status', 14, COPY, (r) => STATUS[String(r.status)] ?? str(r.status)),
  col('copy.status_on', 'copy', 'Status date', 12, COPY, (r) => day(r.status_on), 'day'),
  col('copy.status_reason', 'copy', 'Status reason', 30, COPY, (r) => str(r.status_reason)),
  col('copy.checked', 'copy', 'Last stock check', 12, COPY, (r) => day(r.last_verified_on), 'day'),
  col('copy.remarks', 'copy', 'Remarks', 24, COPY, (r) => str(r.remarks)),
  col(
    'src.accessioned',
    'source',
    'Date of accession',
    12,
    COPY,
    (r) => day(r.accessioned_on),
    'day',
  ),
  col('src.acquisition', 'source', 'Purchase or donation', 12, COPY, (r) => str(r.acquisition)),
  col('src.vendor', 'source', 'Vendor', 22, COPY, (r) => str(r.vendor)),
  col('src.donor', 'source', 'Donated by', 22, COPY, (r) => str(r.donor)),
  col('src.bill_no', 'source', 'Bill no.', 12, COPY, (r) => str(r.bill_no)),
  col('src.bill_date', 'source', 'Bill date', 12, COPY, (r) => day(r.bill_date), 'day'),
  col('src.po_no', 'source', 'Purchase order no.', 14, COPY, (r) => str(r.po_no)),
  col('src.price', 'source', 'Copy price (₹)', 12, COPY, (r) => num(r.copy_price)),
  col('loan.borrower', 'loan', 'Issued to', 24, COPY, (r) => str(r.borrower)),
  col('loan.ref', 'loan', 'Admission or employee no.', 14, COPY, (r) => str(r.borrower_ref)),
  col('loan.issued', 'loan', 'Issued on', 12, COPY, (r) => day(r.issued_on), 'day'),
  col('loan.due', 'loan', 'Due on', 12, COPY, (r) => day(r.due_on), 'day'),
  col('loan.overdue', 'loan', 'Days overdue', 10, COPY, (r) => num(r.overdue)),
  col('loan.times', 'loan', 'Times issued', 10, COPY, (r) => num(r.times)),
  col('count.copies', 'counts', 'Copies', 8, TITLE, (r) => num(r.copies)),
  col('count.available', 'counts', 'On the shelf', 8, TITLE, (r) => num(r.available)),
  col('count.issued', 'counts', 'Issued', 8, TITLE, (r) => num(r.issued)),
  col('count.lost', 'counts', 'Lost', 8, TITLE, (r) => num(r.lost)),
  col('count.damaged', 'counts', 'Damaged', 8, TITLE, (r) => num(r.damaged)),
  col('count.withdrawn', 'counts', 'Withdrawn', 8, TITLE, (r) => num(r.withdrawn)),
  col('count.value', 'counts', 'Value of the copies (₹)', 12, TITLE, (r) => num(r.value)),
  col('count.times', 'counts', 'Times issued', 10, TITLE, (r) => num(r.times)),
];
/** Every field of a level, in the catalogue's order (Notes, Remarks and the bill details are left out). */
const FULL: Record<Level, string[]> = {
  copy: CATALOGUE.filter(
    (d) =>
      d.levels.includes('copy') && !['title.notes', 'title.keywords', 'src.po_no'].includes(d.key),
  ).map((d) => d.key),
  title: CATALOGUE.filter(
    (d) => d.levels.includes('title') && !['title.notes', 'title.keywords'].includes(d.key),
  ).map((d) => d.key),
};
const TITLE_COLS = `t.id AS title_id, t.code, t.title, t.subtitle, t.author, m.name AS material, s.name::text AS subject,
       t.sub_subject, t.call_no, cl.name AS class, t.keywords, (t.is_reference OR COALESCE(NOT m.issuable, false)) AS not_issued,
       t.notes, t.publisher, t.publication_place, t.year, t.edition, t.volume, t.pages, t.isbn, t.language,
       t.price::text AS title_price,
       (SELECT string_agg(ta.role || ': ' || a.name, '; ' ORDER BY ta.position) FROM library_title_authors ta
          JOIN library_authors a ON a.id = ta.author_id WHERE ta.title_id = t.id AND ta.role <> 'Author') AS others`;
const TITLE_JOINS = `LEFT JOIN library_material_types m ON m.id = t.material_type_id
  LEFT JOIN library_subjects s ON s.id = t.subject_id
  LEFT JOIN classes cl ON cl.id = t.class_id`;

/**
 * The book list as Excel (docs/design/36-library.md, part 3): the list as filtered and sorted, one row
 * per copy (the accession register) or per title (with its copies counted); every field of that level,
 * or the fields picked in the order arranged (a layout the school keeps, or the user's last choice);
 * "About this export" says what was taken and when. Every export is in the audit log.
 */
@Injectable()
export class LibraryExportService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private canManage(ctx: RequestContext) {
    return ctx.permissions?.has(LIBRARY.manage) ?? false;
  }

  /** The picker: the fields by group (with the rows each fits), the levels, the layouts, my last. */
  async setup(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const layouts = await c.query<{
        id: string;
        name: string;
        columns: string[];
        options: { level?: Level };
        created_by: string | null;
        created_by_name: string | null;
        updated_at: Date;
      }>(
        `SELECT id::text, name, columns, options, created_by::text, created_by_name, updated_at
           FROM report_layouts WHERE report = $1 ORDER BY lower(name)`,
        [REPORT],
      );
      const last = await c.query<{ value: { columns?: string[]; level?: Level } }>(
        `SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2`,
        [ctx.user.id, LAST],
      );
      const known = new Set(CATALOGUE.map((d) => d.key));
      const keep = (keys: string[] | undefined) => (keys ?? []).filter((k) => known.has(k));
      return {
        levels: [
          { value: 'copy', label: 'One row per copy (the accession register)' },
          { value: 'title', label: 'One row per title, its copies counted' },
        ],
        groups: GROUPS.map((g) => ({
          ...g,
          columns: CATALOGUE.filter((d) => d.group === g.id).map((d) => ({
            key: d.key,
            label: d.header,
          })),
        })),
        sheets: [],
        full: FULL.copy,
        fullByLevel: FULL,
        layouts: layouts.rows.map((l) => ({
          id: l.id,
          name: l.name,
          columns: keep(l.columns),
          sheets: [],
          level: l.options.level ?? 'copy',
          by: l.created_by_name,
          updatedAt: l.updated_at.toISOString(),
          canEdit: l.created_by === ctx.user.id || this.canManage(ctx),
        })),
        last: last.rows[0]
          ? {
              columns: keep(last.rows[0].value.columns),
              sheets: [],
              level: last.rows[0].value.level ?? 'copy',
            }
          : null,
      };
    });
  }

  private columnsOf(keys: string[], level: Level) {
    const by = new Map(CATALOGUE.map((d) => [d.key, d]));
    return [...new Set(keys)]
      .map((k) => by.get(k))
      .filter((d): d is ColDef => Boolean(d) && d!.levels.includes(level));
  }

  /** A named layout saved: a new name makes one; the same name changes it (its maker or the manager). */
  async saveLayout(ctx: RequestContext, dto: BookLayoutDto) {
    const columns = this.columnsOf(dto.columns, dto.level).map((d) => d.key);
    if (!columns.length)
      throw new DomainError('validation-failed', 'Pick at least one field', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const name = dto.name.trim();
      const had = await c.query<{ id: string; created_by: string | null }>(
        `SELECT id::text, created_by::text FROM report_layouts WHERE report = $1 AND lower(name) = lower($2)`,
        [REPORT, name],
      );
      if (had.rows[0]) {
        if (had.rows[0].created_by !== ctx.user.id && !this.canManage(ctx))
          throw new DomainError(
            'library.layout_taken',
            'A layout of this name is someone else’s: give yours another name',
            { status: 409 },
          );
        await c.query(
          `UPDATE report_layouts SET name = $2, columns = $3, options = $4::jsonb, updated_at = now() WHERE id = $1`,
          [had.rows[0].id, name, columns, JSON.stringify({ level: dto.level })],
        );
        return { id: had.rows[0].id, updated: true };
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO report_layouts (school_id, report, name, columns, options, created_by, created_by_name)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6) RETURNING id::text`,
        [
          REPORT,
          name,
          columns,
          JSON.stringify({ level: dto.level }),
          ctx.user.id,
          ctx.user.displayName,
        ],
      );
      return { id: r.rows[0]!.id, updated: false };
    });
  }

  async deleteLayout(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Layout not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const had = await c.query<{ created_by: string | null }>(
        `SELECT created_by::text FROM report_layouts WHERE id = $1 AND report = $2`,
        [id, REPORT],
      );
      if (!had.rows[0]) throw new DomainError('not-found', 'Layout not found', { status: 404 });
      if (had.rows[0].created_by !== ctx.user.id && !this.canManage(ctx))
        throw new DomainError(
          'permission-denied',
          'Only its maker or the library manager may remove it',
          { status: 403 },
        );
      await c.query(`DELETE FROM report_layouts WHERE id = $1`, [id]);
      return { deleted: true };
    });
  }

  /** The rows of a level, as filtered and sorted. */
  private async rows(c: import('pg').PoolClient, q: BookExportDto, level: Level) {
    const f = bookFilter(q);
    // the Books page's list: its filters, search and status choose the rows
    if (q.view) {
      const where = registerWhere(level, { ...q.view, columns: [], sort: [] }, f.args);
      // eslint-disable-next-line no-restricted-syntax -- the register catalogue's fragments; values are bound
      const ids = `(SELECT ${level === 'copy' ? 'x.id' : 't.id'} FROM ${REGISTER_FROM[level]} WHERE ${where})`;
      if (level === 'copy') f.copy = f.copy ? `${f.copy} AND x.id IN ${ids}` : `x.id IN ${ids}`;
      else f.title = `${f.title} AND t.id IN ${ids}`;
    }
    if (level === 'copy')
      return (
        await c.query<Row>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments of bookFilter and bookSort; values are bound
          `SELECT ${TITLE_COLS}, x.accession_no, l.name AS library, sh.code AS shelf, x.rack, x.barcode, x.status::text,
                  x.status_on::text, x.status_reason, x.last_verified_on::text, x.remarks, x.accessioned_on::text,
                  x.acquisition, v.name AS vendor, x.donor, x.bill_no, x.bill_date::text, x.po_no,
                  COALESCE(x.price, t.price)::text AS copy_price,
                  ln.borrower, ln.borrower_ref, ln.issued_on::text, ln.due_on::text,
                  CASE WHEN ln.due_on < CURRENT_DATE THEN CURRENT_DATE - ln.due_on END AS overdue,
                  (SELECT count(*) FROM library_loans z WHERE z.copy_id = x.id)::int AS times
             FROM library_copies x
             JOIN library_titles t ON t.id = x.title_id
             JOIN library_libraries l ON l.id = x.library_id
             LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
             LEFT JOIN library_vendors v ON v.id = x.vendor_id
             ${TITLE_JOINS}
             LEFT JOIN LATERAL (
               SELECT COALESCE(st.display_name, e.display_name) AS borrower,
                      COALESCE(st.admission_no, e.employee_code) AS borrower_ref, lo.issued_on, lo.due_on
                 FROM library_loans lo
                 LEFT JOIN students st ON lo.borrower_kind = 'student' AND st.id = lo.borrower_id
                 LEFT JOIN employees e ON lo.borrower_kind = 'employee' AND e.id = lo.borrower_id
                WHERE lo.copy_id = x.id AND lo.returned_on IS NULL LIMIT 1) ln ON true
            WHERE ${f.title}${f.copy ? ` AND ${f.copy}` : ''}
            ORDER BY ${bookSort(q, 'copy')}
            LIMIT ${String(LIMIT)}`,
          f.args,
        )
      ).rows;
    const inCopies = `x.title_id = t.id AND x.status <> 'sold'${f.copy ? ` AND ${f.copy}` : ''}`;
    const where = f.copy
      ? // eslint-disable-next-line no-restricted-syntax -- fragments of bookFilter; values are bound
        `${f.title} AND EXISTS (SELECT 1 FROM library_copies x WHERE ${inCopies})`
      : f.title;
    return (
      await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments of bookFilter and bookSort; values are bound
        `SELECT ${TITLE_COLS},
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status <> 'withdrawn')::int AS copies,
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status = 'available')::int AS available,
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status = 'issued')::int AS issued,
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status = 'lost')::int AS lost,
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status = 'damaged')::int AS damaged,
                (SELECT count(*) FROM library_copies x WHERE ${inCopies} AND x.status = 'withdrawn')::int AS withdrawn,
                (SELECT sum(COALESCE(x.price, t.price)) FROM library_copies x WHERE ${inCopies} AND x.status NOT IN ('withdrawn', 'lost'))::text AS value,
                (SELECT count(*) FROM library_loans z JOIN library_copies x ON x.id = z.copy_id WHERE ${inCopies})::int AS times
           FROM library_titles t
           ${TITLE_JOINS}
          WHERE ${where}
          ORDER BY ${bookSort(q, 'title')}
          LIMIT ${String(LIMIT)}`,
        f.args,
      )
    ).rows;
  }

  /** What the filters were, in words, for the About sheet. */
  private async filtersText(c: import('pg').PoolClient, q: BookFilter) {
    const name = async (table: string, id: string | undefined, col = 'name') =>
      id
        ? ((
            await c.query<{ n: string }>(
              // eslint-disable-next-line no-restricted-syntax -- fixed table and column names from this method
              `SELECT ${col}::text AS n FROM ${table} WHERE id = $1`,
              [id],
            )
          ).rows[0]?.n ?? id)
        : null;
    const parts = [
      q.q ? `Find: ${q.q}` : null,
      q.libraryId ? `Library: ${(await name('library_libraries', q.libraryId))!}` : null,
      q.materialTypeId
        ? `Material: ${(await name('library_material_types', q.materialTypeId))!}`
        : null,
      q.subjectId ? `Subject: ${(await name('library_subjects', q.subjectId))!}` : null,
      q.languageId ? `Language: ${(await name('library_languages', q.languageId))!}` : null,
      q.classId ? `Class: ${(await name('classes', q.classId))!}` : null,
      q.shelfId
        ? `Shelf: ${(await name('library_shelves', q.shelfId, 'code'))!}${q.rack ? ` rack ${q.rack}` : ''}`
        : null,
      q.author ? `Author: ${q.author}` : null,
      q.publisher ? `Publisher: ${q.publisher}` : null,
      q.status ? `Copies: ${STATUS[q.status] ?? q.status}` : null,
      q.acquisition ? `By ${q.acquisition.toLowerCase()}` : null,
      q.vendorId ? `Vendor: ${(await name('library_vendors', q.vendorId))!}` : null,
      q.accessionFrom || q.accessionTo
        ? `Accession nos.: ${q.accessionFrom ?? '…'} to ${q.accessionTo ?? '…'}`
        : null,
      q.accessionedFrom || q.accessionedTo
        ? `Accessioned: ${q.accessionedFrom ?? '…'} to ${q.accessionedTo ?? '…'}`
        : null,
      q.yearFrom || q.yearTo
        ? `Year: ${String(q.yearFrom ?? '…')} to ${String(q.yearTo ?? '…')}`
        : null,
      q.stock === 'never'
        ? 'Never stock-checked'
        : q.stock === 'checked'
          ? `Stock-checked${q.checkedSince ? ` since ${q.checkedSince}` : ''}`
          : null,
    ];
    return parts.filter(Boolean).join('; ') || 'Every book';
  }

  async export(ctx: RequestContext, q: BookExportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const level = q.level;
      const custom = Boolean(q.columns?.length);
      const chosen = custom
        ? this.columnsOf(q.columns!, level)
        : this.columnsOf(FULL[level], level);
      if (!chosen.length)
        throw new DomainError('validation-failed', 'Pick at least one field', { status: 400 });
      if (custom)
        await c.query(
          `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb)
           ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [ctx.user.id, LAST, JSON.stringify({ columns: chosen.map((d) => d.key), level })],
        );
      const rows = await this.rows(c, q, level);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      wb.created = new Date();
      const name = level === 'copy' ? 'Copies' : 'Titles';
      const ws = wb.addWorksheet(name);
      ws.columns = chosen.map((d) => ({ header: d.header, width: d.width }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: Math.min(1, chosen.length) }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: chosen.length } };
      for (const r of rows) ws.addRow(chosen.map((d) => d.value(r)));
      chosen.forEach((d, i) => {
        if (d.date) ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
      });
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const filters = q.view
        ? `As on the Books page: ${registerViewText(level, q.view)}`
        : await this.filtersText(c, q);
      const about = wb.addWorksheet('About this export');
      (
        [
          ['School', school],
          ['Exported on', ist(new Date())],
          ['By', ctx.user.displayName],
          [
            'Rows',
            `${String(rows.length)} (${level === 'copy' ? 'one per copy' : 'one per title'})`,
          ],
          ['Books', filters],
          [
            'Fields',
            custom
              ? `${String(chosen.length)} picked${q.layout ? ` (layout: ${q.layout})` : ''}`
              : 'Every field',
          ],
          ...(rows.length === LIMIT
            ? [['Note', `Only the first ${String(LIMIT)} are in this file: narrow the filters.`]]
            : []),
        ] as Array<[string, Cell]>
      ).forEach(([k, val]) => {
        const r = about.addRow([k, val]);
        r.getCell(1).font = { bold: true };
        if (val instanceof Date) r.getCell(2).numFmt = 'dd-mm-yyyy hh:mm';
      });
      about.getColumn(1).width = 16;
      about.getColumn(2).width = 80;
      await this.audit.stage(ctx, c, {
        action: 'library.export',
        entityType: 'library_titles',
        entityId: requireTenant(ctx).schoolId,
        after: {
          rows: rows.length,
          level,
          filters,
          fields: custom ? chosen.map((d) => d.key) : 'all',
        },
      });
      const stamp = ist(new Date()).toISOString().slice(0, 10);
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `Library-${level === 'copy' ? 'accession-register' : 'titles'}-${stamp}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
        rows: rows.length,
      };
    });
  }
}
