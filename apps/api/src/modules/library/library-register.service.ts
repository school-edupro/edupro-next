import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import type { RegisterExportDto, RegisterGridDto } from './library-books.dto';
import {
  COPY_STATUS_LABEL,
  PRIMARY,
  REGISTER_FROM,
  REGISTER_SECTIONS,
  fieldsOf,
  registerOrder,
  registerSelect,
  registerViewText,
  registerWhere,
  type RegisterLevel,
  type RegisterView,
} from './library-register';

const LIMIT = 20000;
type Cell = string | number | null;
export interface RegisterPage {
  columns: Array<{ key: string; header: string; type: string }>;
  rows: Array<Record<string, Cell>>;
  total: number;
  page: number;
  pages: number;
  stats: Record<string, number>;
}
/** India time as a workbook shows it (a workbook has no time zone). */
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
/** Always sent with each row: the first column, the lines under it, the status. */
const IDENTITY: Record<RegisterLevel, string[]> = {
  copy: ['accession_no', 'title', 'authors', 'library', 'copy_status'],
  title: ['title', 'authors', 'catalogue_code', 'material', 'copies', 'on_shelf'],
};

/**
 * The Books page's two lists as the Employees list (docs/design/36-library.md): the titles and the
 * copies (the accession register), any field as a column or a filter, the search, a status, the sort and
 * pages, counts for the school; the same view as Excel or PDF. Every query runs in the database under the
 * school's row-level security.
 */
@Injectable()
export class LibraryRegisterService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Every field of a level that can be a column or a filter, with the filters' suggestions. */
  async fields(ctx: RequestContext, level: RegisterLevel) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const list = async (sql: string) => (await c.query<{ v: string }>(sql)).rows.map((r) => r.v);
      // one after another: one connection runs one query at a time
      const material = await list(
        `SELECT name AS v FROM library_material_types WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const subject = await list(
        `SELECT name::text AS v FROM library_subjects WHERE status = 'active' ORDER BY name`,
      );
      const klass = await list(
        `SELECT name AS v FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code`,
      );
      const library = await list(
        `SELECT name AS v FROM library_libraries WHERE status = 'active' ORDER BY code`,
      );
      const shelf = await list(
        `SELECT DISTINCT code AS v FROM library_shelves WHERE status = 'active' ORDER BY code LIMIT 500`,
      );
      const vendor = await list(
        `SELECT name AS v FROM library_vendors WHERE status = 'active' ORDER BY name LIMIT 500`,
      );
      const language = await list(
        `SELECT name::text AS v FROM library_languages WHERE status = 'active' ORDER BY name`,
      );
      const options: Record<string, string[]> = {
        material,
        subject,
        class: klass,
        library,
        shelf,
        vendor,
        language,
        status: Object.values(COPY_STATUS_LABEL),
        acquisition: ['Purchase', 'Donation'],
        yesno: ['Yes', 'No'],
        borrower: ['Student', 'Staff'],
      };
      const fields = fieldsOf(level);
      return {
        sections: REGISTER_SECTIONS.filter((s) => fields.some((x) => x.section === s.id)),
        fields: fields.map((x) => ({
          key: x.key,
          label: x.label,
          section: x.section,
          type: x.type,
          options: x.options ? (options[x.options] ?? null) : null,
          masked: false,
        })),
      };
    });
  }

  private view(
    dto: Pick<RegisterGridDto, 'columns' | 'filters' | 'sort' | 'search' | 'status'>,
  ): RegisterView {
    return {
      columns: dto.columns,
      filters: dto.filters,
      sort: dto.sort,
      search: dto.search,
      status: dto.status,
    };
  }

  /** A page of a level's rows for a view, and the school's counts. */
  async grid(
    ctx: RequestContext,
    level: RegisterLevel,
    dto: RegisterGridDto,
  ): Promise<RegisterPage> {
    const v = this.view(dto);
    const keys = [...IDENTITY[level], ...v.columns.map((x) => x.key)];
    const args: unknown[] = [];
    const where = registerWhere(level, v, args);
    const select = registerSelect(level, keys);
    const order = registerOrder(level, v);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const n = args.length;
      const r = await c.query<Record<string, string | number | null> & { __total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- expressions from the register catalogue; values are bound
        `SELECT ${select}, count(*) OVER () AS __total FROM ${REGISTER_FROM[level]}
          WHERE ${where} ORDER BY ${order} LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...args, dto.size, (dto.page - 1) * dto.size],
      );
      const total = Number(r.rows[0]?.__total ?? 0);
      // a page past the end (the list shrank): the last page instead
      if (!r.rows.length && dto.page > 1) {
        const all = await c.query<{ n: string }>(
          // eslint-disable-next-line no-restricted-syntax -- the catalogue's fixed fragments; values bound
          `SELECT count(*)::text AS n FROM ${REGISTER_FROM[level]} WHERE ${where}`,
          args,
        );
        const pages = Math.max(1, Math.ceil(Number(all.rows[0]!.n) / dto.size));
        if (pages < dto.page) return this.grid(ctx, level, { ...dto, page: pages });
      }
      const fields = new Map(fieldsOf(level).map((x) => [x.key, x]));
      return {
        columns: v.columns.map((x) => ({
          key: x.key,
          header: x.label || fields.get(x.key)!.label,
          type: fields.get(x.key)!.type,
        })),
        rows: r.rows.map(({ __total: _t, ...row }) => row),
        total,
        page: dto.page,
        pages: Math.max(1, Math.ceil(total / dto.size)),
        stats: await this.stats(c, level),
      };
    });
  }

  /** The counts line: the school's books, whatever the filters. */
  private async stats(c: import('pg').PoolClient, level: RegisterLevel) {
    if (level === 'copy') {
      const r = await c.query<Record<string, number>>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE x.status = 'available')::int AS available,
                count(*) FILTER (WHERE x.status = 'issued')::int AS issued,
                count(*) FILTER (WHERE x.status = 'issued' AND EXISTS (
                  SELECT 1 FROM library_loans lo WHERE lo.copy_id = x.id AND lo.returned_on IS NULL AND lo.due_on < CURRENT_DATE))::int AS overdue,
                count(*) FILTER (WHERE x.status = 'damaged')::int AS damaged,
                count(*) FILTER (WHERE x.status = 'lost')::int AS lost,
                count(*) FILTER (WHERE x.status = 'withdrawn')::int AS withdrawn
           FROM library_copies x JOIN library_titles t ON t.id = x.title_id
          WHERE t.status = 'active' AND x.status <> 'sold'`,
      );
      return r.rows[0]!;
    }
    const r = await c.query<Record<string, number>>(
      // eslint-disable-next-line no-restricted-syntax -- the catalogue's fixed fragment
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE k.available > 0)::int AS available,
              count(*) FILTER (WHERE k.copies > 0 AND k.available = 0)::int AS out,
              count(*) FILTER (WHERE k.copies = 0)::int AS none
         FROM ${REGISTER_FROM.title} WHERE t.status = 'active'`,
    );
    return r.rows[0]!;
  }

  /** The view as Excel or PDF: the first column, the columns as on screen, the status (copies). */
  async export(ctx: RequestContext, level: RegisterLevel, dto: RegisterExportDto) {
    const v = this.view(dto);
    const fields = new Map(fieldsOf(level).map((x) => [x.key, x]));
    const cols = [
      { key: PRIMARY[level], label: fields.get(PRIMARY[level])!.label },
      ...v.columns
        .filter((x) => x.key !== PRIMARY[level] && x.key !== 'copy_status')
        .map((x) => ({ key: x.key, label: x.label || fields.get(x.key)!.label })),
      ...(level === 'copy' ? [{ key: 'copy_status', label: 'Status' }] : []),
    ];
    if (dto.format === 'pdf' && cols.length > 25)
      throw new DomainError(
        'validation-failed',
        'Too many columns for a PDF page (25 at most): use Excel',
        { status: 400 },
      );
    const args: unknown[] = [];
    const where = registerWhere(level, v, args);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<Record<string, string | number | null>>(
          // eslint-disable-next-line no-restricted-syntax -- expressions from the register catalogue; values are bound
          `SELECT ${registerSelect(
            level,
            cols.map((x) => x.key),
          )} FROM ${REGISTER_FROM[level]} WHERE ${where} ORDER BY ${registerOrder(level, v)} LIMIT ${String(LIMIT)}`,
          args,
        )
      ).rows;
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const words = registerViewText(level, v);
      const name = level === 'copy' ? 'Accession register' : 'Library titles';
      const stamp = ist(new Date());
      const day = stamp.toISOString().slice(0, 10);
      const ddmmyyyy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
      await this.audit.stage(ctx, c, {
        action: 'library.register.export',
        entityType: level === 'copy' ? 'library_copies' : 'library_titles',
        entityId: requireTenant(ctx).schoolId,
        after: {
          level,
          format: dto.format,
          rows: rows.length,
          view: words,
          columns: cols.map((x) => x.key),
        },
      });
      const base = `${level === 'copy' ? 'Library-accession-register' : 'Library-titles'}-${day}`;
      if (dto.format === 'pdf') {
        const bytes = await tablePdf({
          school,
          title: name,
          subtitle: [
            `${String(rows.length)} ${level === 'copy' ? 'copies' : 'titles'} · ${words}`,
            `${ddmmyyyy(day)} · ${ctx.user.displayName}${rows.length === LIMIT ? ` · first ${String(LIMIT)} only` : ''}`,
          ],
          columns: cols.map((x) => ({
            label: x.label,
            width: fields.get(x.key)!.type === 'text' ? 3 : 1.4,
            right: fields.get(x.key)!.type === 'number',
          })),
          rows: rows.map((r) =>
            cols.map((x) => {
              const val = r[x.key];
              if (val === null || val === undefined) return '';
              return fields.get(x.key)!.type === 'date' ? ddmmyyyy(String(val)) : val;
            }),
          ),
          fontSize: cols.length > 12 ? 7 : 8.5,
          wrap: true,
        });
        return {
          filename: `${base}.pdf`,
          contentType: 'application/pdf',
          base64: bytes.toString('base64'),
          rows: rows.length,
        };
      }
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      wb.created = new Date();
      const ws = wb.addWorksheet(level === 'copy' ? 'Copies' : 'Titles');
      ws.columns = cols.map((x) => ({
        header: x.label,
        width: fields.get(x.key)!.type === 'text' ? 24 : 12,
      }));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
      for (const r of rows)
        ws.addRow(
          cols.map((x) => {
            const val = r[x.key];
            if (val === null || val === undefined) return null;
            return fields.get(x.key)!.type === 'date' ? new Date(`${String(val)}T00:00:00Z`) : val;
          }),
        );
      cols.forEach((x, i) => {
        if (fields.get(x.key)!.type === 'date') ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
      });
      const about = wb.addWorksheet('About this export');
      (
        [
          ['School', school],
          ['Exported on', stamp],
          ['By', ctx.user.displayName],
          [
            'Rows',
            `${String(rows.length)} (${level === 'copy' ? 'one per copy' : 'one per title'})`,
          ],
          ['Books', words],
          ...(rows.length === LIMIT
            ? [['Note', `Only the first ${String(LIMIT)} are in this file: narrow the filters.`]]
            : []),
        ] as Array<[string, string | Date]>
      ).forEach(([k, val]) => {
        const row = about.addRow([k, val]);
        row.getCell(1).font = { bold: true };
        if (val instanceof Date) row.getCell(2).numFmt = 'dd-mm-yyyy hh:mm';
      });
      about.getColumn(1).width = 16;
      about.getColumn(2).width = 80;
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `${base}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
        rows: rows.length,
      };
    });
  }
}
