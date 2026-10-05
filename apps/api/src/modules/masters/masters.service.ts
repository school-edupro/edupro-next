import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import {
  hasSoftDelete,
  MASTERS,
  masterOrNull,
  masterColumns,
  upsertSql,
  writableFields,
  type MasterDefinition,
  type MasterField,
} from '@edupro/db';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { tablePdf } from '../engagement/table-pdf';
import { parseCsv } from '../people/csv';
import type { BulkUpdateDto, CloneDto, RowsQueryDto, SaveRowDto, UploadDto } from './masters.dto';

export interface MasterRow extends Record<string, unknown> {
  id: string;
}

export interface MasterImportRow {
  id: string;
  master: string;
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  insertedRows: number;
  updatedRows: number;
  report: Array<{ row: number; column: string; message: string }>;
  requestedBy: string | null;
  createdAt: string;
  committedAt: string | null;
}

export type Cell = string | number | boolean | Date | null;
type Reject = { row: number; column: string; message: string };

const IMPORT_COLUMNS = `id::text, master, file_name, status::text, total_rows, ok_rows, rejected_rows, inserted_rows, updated_rows, report,
  requested_by::text, created_at, committed_at`;

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

/**
 * One service for every master in the registry. The definitions say what a master is; this service
 * gives each of them the same grid, upload, bulk update and clone. Everything runs under the caller's
 * tenant, so masters never cross schools.
 */
type MasterLookupOption = {
  id: string;
  value: string;
  parent: string | null;
  label: string | null;
};

@Injectable()
export class MastersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---- registry ----------------------------------------------------------------------------------
  private def(id: string): MasterDefinition {
    const d = masterOrNull(id);
    if (!d) throw new DomainError('not-found', `Unknown master ${id}`, { status: 404 });
    return d;
  }

  private assertPermission(ctx: RequestContext, def: MasterDefinition, manage = false) {
    const needed = manage ? def.permission.manage : def.permission.view;
    if (!ctx.permissions?.has(needed))
      throw new DomainError('permission-denied', `${def.title} requires ${needed}`, {
        status: 403,
        extra: { permission: needed },
      });
  }

  /** Masters the caller may see, with what they may do on each. */
  registry(ctx: RequestContext) {
    const held = ctx.permissions ?? new Set<string>();
    return MASTERS.filter((m) => held.has(m.permission.view)).map((m) => ({
      id: m.id,
      title: m.title,
      group: m.group,
      yearScoped: m.yearScoped === true,
      hidden: m.hidden === true,
      canManage: held.has(m.permission.manage),
      canClone: m.clone !== undefined && held.has(m.permission.manage),
      naturalKey: m.naturalKey,
      status: m.status ?? null,
      fields: m.fields,
      columns: masterColumns(m),
      uploadHelp: m.uploadHelp ?? null,
      alsoIn: m.alsoIn ?? [],
      order: m.order ?? 500,
      detail: m.detail ?? null,
      dataset: `master_${m.id}`,
    }));
  }

  // ---- grid ----------------------------------------------------------------------------------------
  async rows(
    ctx: RequestContext,
    id: string,
    query: RowsQueryDto,
  ): Promise<{ data: MasterRow[]; page: { number: number; size: number; total: number } }> {
    const def = this.def(id);
    this.assertPermission(ctx, def);
    const tenant = requireTenant(ctx);
    const inner = def.list({
      q: query.q ?? null,
      status: query.status ?? null,
      academicYearId: def.yearScoped ? (tenant.academicYearId ?? null) : null,
      filters: query.filters ?? {},
    });
    const offset = (query.page - 1) * query.size;
    return this.db.tenant(tenant, async (c) => {
      const n = inner.values.length;
      const r = await c.query<MasterRow & { __total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragment from the registry or a constant column list; values are bound
        `SELECT t.*, count(*) OVER () AS __total FROM (${inner.text}) t LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...inner.values, query.size, offset],
      );
      const total = Number(r.rows[0]?.__total ?? 0);
      return {
        data: r.rows.map(({ __total: _t, ...row }) => row),
        page: { number: query.page, size: query.size, total },
      };
    });
  }

  // ---- template ------------------------------------------------------------------------------------
  /**
   * Excel template: the accepted columns in row 1, ready to fill. Every column with fixed choices (a
   * status, yes / no, a trip) or that points at another master (a slab, a route, a vehicle, a crew
   * member) is a drop-down fed from the Lists sheet; numbers and dates are checked as they are typed.
   * The Notes sheet has the rule of every column.
   */
  async template(ctx: RequestContext, id: string): Promise<{ fileName: string; bytes: Buffer }> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    const refs = def.fields.some((f) => f.type === 'ref') ? await this.lookups(ctx, id) : {};
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EduPro Next';
    const ws = wb.addWorksheet(def.title.slice(0, 31));
    const fields = writableFields(def);
    const columns = [...fields.map((f) => ({ f, header: f.header, key: f.key }))];
    ws.columns = [
      ...columns.map((x) => ({
        header: x.header,
        key: x.key,
        width: Math.max(14, x.f.width ?? 18),
      })),
      ...(def.status ? [{ header: 'Status', key: def.status.column, width: 12 }] : []),
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const lists = wb.addWorksheet('Lists');
    const ROWS = 1000;
    const letter = (n: number) => {
      let out = '';
      for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
        out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
      return out;
    };
    let listCol = 0;
    const listOf = (title: string, values: string[]): string => {
      listCol += 1;
      const col = letter(listCol);
      lists.getCell(`${col}1`).value = title;
      lists.getCell(`${col}1`).font = { bold: true };
      values.forEach((v, i) => {
        lists.getCell(`${col}${String(i + 2)}`).value = v;
      });
      lists.getColumn(listCol).width = 30;
      return `Lists!$${col}$2:$${col}$${String(Math.max(2, values.length + 1))}`;
    };
    const all = [
      ...fields,
      ...(def.status
        ? [
            {
              key: def.status.column,
              header: 'Status',
              type: 'select',
              options: def.status.values,
            } as MasterField,
          ]
        : []),
    ];
    all.forEach((f, i) => {
      const col = letter(i + 1);
      const each = (make: () => ExcelJS.DataValidation) => {
        for (let r = 2; r <= ROWS + 1; r += 1)
          ws.getCell(`${col}${String(r)}`).dataValidation = make();
      };
      const refuse = (title: string, error: string) => ({
        allowBlank: !f.required,
        showErrorMessage: true,
        errorStyle: 'error' as const,
        errorTitle: title,
        error,
      });
      if (f.type === 'ref' && f.lookup) {
        const options = (refs[f.key] ?? []).map((o) =>
          f.lookup!.showLabel && o.label ? `${o.value} · ${o.label}` : o.value,
        );
        if (!options.length || options.length > 1500) return;
        const range = listOf(f.header, options);
        each(() => ({
          type: 'list',
          formulae: [range],
          ...refuse(
            f.header,
            'Choose from the drop-down. A new one is added in its own master first.',
          ),
        }));
      } else if (f.type === 'select' && f.options?.length) {
        const range = listOf(f.header, [...f.options]);
        each(() => ({
          type: 'list',
          formulae: [range],
          ...refuse(f.header, 'Choose from the drop-down.'),
        }));
      } else if (f.type === 'boolean') {
        const range = listOf(f.header, ['yes', 'no']);
        each(() => ({ type: 'list', formulae: [range], ...refuse(f.header, 'Choose yes or no.') }));
      } else if (f.type === 'date') {
        ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd';
        each(() => ({
          type: 'date',
          operator: 'greaterThan',
          formulae: [new Date('1990-01-01')],
          ...refuse(f.header, 'A date like 2027-03-31.'),
        }));
      } else if (f.type === 'number') {
        const whole = (f.scale ?? 0) === 0;
        const min = f.min ?? -999999999;
        const max = f.max ?? 999999999;
        each(() => ({
          type: whole ? 'whole' : 'decimal',
          operator: 'between',
          formulae: [min, max],
          ...refuse(
            f.header,
            `${whole ? 'A whole number' : 'A number'} from ${String(min)} to ${String(max)}.`,
          ),
        }));
      } else if (f.type === 'text' && f.maxLength && !f.array) {
        // text stays text (a mobile number or a code keeps its leading zero and is not turned into a number)
        ws.getColumn(i + 1).numFmt = '@';
        each(() => ({
          type: 'textLength',
          operator: 'lessThanOrEqual',
          formulae: [f.maxLength!],
          ...refuse(
            f.header,
            `At most ${String(f.maxLength)} characters. ${f.patternHelp ? `Must be ${f.patternHelp}.` : ''}`,
          ),
        }));
      }
    });
    if (listCol === 0) wb.removeWorksheet(lists.id);
    const notes = wb.addWorksheet('Notes');
    notes.columns = [
      { header: 'Column', key: 'c', width: 26 },
      { header: 'Required', key: 'r', width: 10 },
      { header: 'Type', key: 't', width: 12 },
      { header: 'Rule', key: 'u', width: 90 },
    ];
    notes.getRow(1).font = { bold: true };
    for (const f of fields) notes.addRow([f.header, f.required ? 'yes' : '', f.type, ruleFor(f)]);
    notes.addRow([]);
    notes.addRow([
      'Key',
      '',
      '',
      `Rows are matched on ${def.naturalKey.join(' + ')}: an existing row is updated, a new one inserted. Rows are never deleted by an upload.`,
    ]);
    notes.addRow([
      'Fill',
      '',
      '',
      'Type from row 2 of the first sheet. Leave no example rows behind.',
    ]);
    if (def.yearScoped)
      notes.addRow(['Year', '', '', 'Rows belong to the academic year selected in the header.']);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return { fileName: `${def.id}-template.xlsx`, bytes };
  }

  // ---- export, at once --------------------------------------------------------------------------------
  /** The list as on screen (search and status filter kept) as Excel or PDF, made on the spot. */
  async export(
    ctx: RequestContext,
    id: string,
    q: { q?: string; status?: string; format: 'xlsx' | 'pdf' },
  ): Promise<{ fileName: string; bytes: Buffer; contentType: string }> {
    const def = this.def(id);
    this.assertPermission(ctx, def);
    const tenant = requireTenant(ctx);
    const inner = def.list({
      q: q.q?.trim() || null,
      status: q.status ?? null,
      academicYearId: def.yearScoped ? (tenant.academicYearId ?? null) : null,
      filters: {},
    });
    const max = def.maxRows ?? 20_000;
    const { rows, school } = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<MasterRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragment from the registry; values are bound
        `SELECT t.* FROM (${inner.text}) t LIMIT ${String(max)}`,
        inner.values,
      );
      const s = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return { rows: r.rows, school: s.rows[0]?.name ?? '' };
    });
    const cols = masterColumns(def);
    const cellOf = (row: MasterRow, key: string): string => {
      const v = row[key];
      return v === null || v === undefined
        ? ''
        : v === 'true'
          ? 'yes'
          : v === 'false'
            ? 'no'
            : String(v);
    };
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'pdf') {
      const bytes = await tablePdf({
        school,
        title: def.title,
        subtitle: `${String(rows.length)} row(s)${q.q ? ` · search "${q.q}"` : ''}${q.status ? ` · ${q.status}` : ''} · ${stamp}`,
        columns: cols.map((c) => ({
          label: c.header,
          width: c.width ?? 16,
          right: c.type === 'number',
        })),
        rows: rows.map((r) => cols.map((c) => cellOf(r, c.key))),
      });
      return { fileName: `${def.id}-${stamp}.pdf`, bytes, contentType: 'application/pdf' };
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EduPro Next';
    const ws = wb.addWorksheet(def.title.slice(0, 31));
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows)
      ws.addRow(
        cols.map((c) => {
          const v = cellOf(r, c.key);
          return c.type === 'number' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
        }),
      );
    return {
      fileName: `${def.id}-${stamp}.xlsx`,
      bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // ---- upload: validate then commit ----------------------------------------------------------------
  async validate(ctx: RequestContext, id: string, dto: UploadDto): Promise<MasterImportRow> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    const tenant = requireTenant(ctx);
    if (def.yearScoped && !tenant.academicYearId)
      throw new DomainError('validation-failed', 'Select an academic year first', { status: 400 });
    const { header, rows } = await readFile(dto);
    if (rows.length === 0)
      throw new DomainError('validation-failed', 'The file has no data rows', { status: 400 });
    if (rows.length > 5000)
      throw new DomainError('validation-failed', 'At most 5,000 rows per upload', { status: 400 });
    const fields = writableFields(def);
    const columnIndex = mapHeader(header, fields);
    const missingRequired = fields
      .filter((f) => f.required && columnIndex[f.key] === undefined)
      .map((f) => f.header);
    if (missingRequired.length)
      throw new DomainError(
        'validation-failed',
        `Missing column(s): ${missingRequired.join(', ')}. Download the template for the accepted headers.`,
        { status: 400 },
      );
    return this.db.tenant(tenant, async (c) => {
      const lookups = await this.resolveLookups(c, tenant, fields, rows, columnIndex);
      const rejects: Reject[] = [];
      const payload: Array<Record<string, unknown>> = [];
      const seen = new Set<string>();
      rows.forEach((cells, i) => {
        const rowNo = i + 2;
        const out: Record<string, unknown> = {};
        let ok = true;
        for (const f of fields) {
          const idx = columnIndex[f.key];
          const raw = idx === undefined ? null : (cells[idx] ?? null);
          const { value, error } = coerce(f, raw, lookups);
          if (error) {
            rejects.push({ row: rowNo, column: f.header, message: error });
            ok = false;
          } else if (value !== undefined) out[f.key] = value;
        }
        for (const e of crossChecks(fields, out)) {
          rejects.push({ row: rowNo, ...e });
          ok = false;
        }
        const key = def.naturalKey.map((k) => String(out[k] ?? '')).join('\u0000');
        if (ok && seen.has(key)) {
          rejects.push({
            row: rowNo,
            column: def.naturalKey.join('+'),
            message: 'Duplicate of an earlier row in the file',
          });
          ok = false;
        }
        seen.add(key);
        if (ok) payload.push(out);
      });
      const status = rejects.length ? 'failed' : 'validated';
      const r = await c.query<{ id: string }>(
        `INSERT INTO master_imports (school_id, master, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::import_status, $4, $5, $6, $7::jsonb, $8::jsonb, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [
          def.id,
          dto.fileName ?? null,
          status,
          rows.length,
          payload.length,
          rejects.length,
          JSON.stringify(rejects.slice(0, 500)),
          JSON.stringify(status === 'validated' ? payload : []),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'masters.upload.validate',
        entityType: 'master_imports',
        entityId: r.rows[0]!.id,
        after: { master: def.id, rows: rows.length, rejected: rejects.length },
      });
      return (await this.getImport(c, r.rows[0]!.id))!;
    });
  }

  async commit(ctx: RequestContext, id: string, importId: string): Promise<MasterImportRow> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const imp = await c.query<{ status: string; payload: Array<Record<string, unknown>> }>(
        'SELECT status::text, payload FROM master_imports WHERE id = $1 AND master = $2',
        [importId, def.id],
      );
      const row = imp.rows[0];
      if (!row) throw new DomainError('not-found', 'Upload not found', { status: 404 });
      if (row.status !== 'validated')
        throw new DomainError(
          'conflict',
          `Upload is ${row.status}; only a validated upload commits`,
          {
            status: 409,
          },
        );
      let inserted = 0;
      let updated = 0;
      for (const values of row.payload) {
        const res = await this.upsert(c, def, tenant, values);
        if (res.inserted) inserted += 1;
        else updated += 1;
      }
      await c.query(
        `UPDATE master_imports SET status = 'committed', committed_at = now(), inserted_rows = $2, updated_rows = $3 WHERE id = $1`,
        [importId, inserted, updated],
      );
      await this.audit.stage(ctx, c, {
        action: 'masters.upload.commit',
        entityType: def.table,
        entityId: importId,
        after: { master: def.id, inserted, updated },
      });
      return (await this.getImport(c, importId))!;
    });
  }

  async imports(ctx: RequestContext, id: string): Promise<MasterImportRow[]> {
    const def = this.def(id);
    this.assertPermission(ctx, def);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragment from the registry or a constant column list; values are bound
        `SELECT ${IMPORT_COLUMNS} FROM master_imports WHERE master = $1 ORDER BY created_at DESC LIMIT 20`,
        [def.id],
      );
      return r.rows.map(toImport);
    });
  }

  // ---- single row (the grid's add / edit form) ----------------------------------------------------
  async save(ctx: RequestContext, id: string, dto: SaveRowDto): Promise<MasterRow> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    const tenant = requireTenant(ctx);
    if (def.yearScoped && !tenant.academicYearId)
      throw new DomainError('validation-failed', 'Select an academic year first', { status: 400 });
    const fields = writableFields(def);
    // the form sends field keys; refs arrive as their lookup value (a class code), like an upload row
    const header = fields.map((f) => f.key);
    const cells = fields.map((f) => {
      const v = dto.values[f.key];
      return v === undefined || v === null ? null : (v as Cell);
    });
    return this.db.tenant(tenant, async (c) => {
      const columnIndex = Object.fromEntries(header.map((h, i) => [h, i]));
      const lookups = await this.resolveLookups(c, tenant, fields, [cells], columnIndex);
      const out: Record<string, unknown> = {};
      const errors: string[] = [];
      for (const f of fields) {
        const { value, error } = coerce(f, cells[columnIndex[f.key]!] ?? null, lookups);
        if (error) errors.push(`${f.header}: ${error}`);
        else if (value !== undefined) out[f.key] = value;
      }
      errors.push(...crossChecks(fields, out).map((e) => `${e.column}: ${e.message}`));
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('; '), { status: 400 });
      if (dto.id) {
        // editing: the natural key must stay what the row has
        const cur = await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- table and key columns come from the registry
          `SELECT ${def.naturalKey.join(', ')} FROM ${def.table} WHERE id = $1`,
          [dto.id],
        );
        if (!cur.rows[0]) throw new DomainError('not-found', 'Row not found', { status: 404 });
        for (const k of def.naturalKey) out[k] = cur.rows[0][k];
      }
      const res = await this.upsert(c, def, tenant, out);
      await this.audit.stage(ctx, c, {
        action: dto.id ? 'masters.row.update' : 'masters.row.create',
        entityType: def.table,
        entityId: res.id,
        after: out,
      });
      return { id: res.id, ...out };
    });
  }

  async setStatus(ctx: RequestContext, id: string, rowId: string, status: string): Promise<void> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    if (!def.status || !def.status.values.includes(status))
      throw new DomainError('validation-failed', 'This master has no such status', { status: 400 });
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table and status column come from the registry; the value is bound
        `UPDATE ${def.table} SET ${def.status!.column} = $2 WHERE id = $1`,
        [rowId, status],
      );
      if (r.rowCount === 0) throw new DomainError('not-found', 'Row not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'masters.row.status',
        entityType: def.table,
        entityId: rowId,
        after: { status },
      });
    });
  }

  // ---- bulk update -------------------------------------------------------------------------------
  async bulk(ctx: RequestContext, id: string, dto: BulkUpdateDto): Promise<{ updated: number }> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    const tenant = requireTenant(ctx);
    const field = def.fields.find(
      (f) => f.key === dto.field && f.bulk && !f.readOnly && !f.identity,
    );
    if (!field)
      throw new DomainError('validation-failed', 'This column cannot be updated in bulk', {
        status: 400,
      });
    return this.db.tenant(tenant, async (c) => {
      const lookups = await this.resolveLookups(c, tenant, [field], [[dto.value as Cell]], {
        [field.key]: 0,
      });
      const { value, error } = coerce(field, dto.value as Cell, lookups);
      if (error)
        throw new DomainError('validation-failed', `${field.header}: ${error}`, { status: 400 });
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table and column come from the registry; ids and value are bound
        `UPDATE ${def.table} SET ${field.key} = $2 WHERE id = ANY($1::bigint[])`,
        [dto.ids, value],
      );
      await this.audit.stage(ctx, c, {
        action: 'masters.bulk.update',
        entityType: def.table,
        after: { master: def.id, field: field.key, value, rows: r.rowCount },
      });
      return { updated: r.rowCount ?? 0 };
    });
  }

  // ---- clone -------------------------------------------------------------------------------------
  async clone(ctx: RequestContext, id: string, dto: CloneDto): Promise<{ copied: number }> {
    const def = this.def(id);
    this.assertPermission(ctx, def, true);
    if (!def.clone)
      throw new DomainError('validation-failed', 'This master cannot be cloned', { status: 400 });
    if (dto.fromYearId === dto.toYearId)
      throw new DomainError('validation-failed', 'Choose two different years', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = def.clone!(dto.fromYearId, dto.toYearId);
      const r = await c.query(q.text, q.values);
      await this.audit.stage(ctx, c, {
        action: 'masters.clone',
        entityType: def.table,
        after: {
          master: def.id,
          fromYearId: dto.fromYearId,
          toYearId: dto.toYearId,
          rows: r.rowCount,
        },
      });
      return { copied: r.rowCount ?? 0 };
    });
  }

  // ---- helpers -----------------------------------------------------------------------------------
  private async upsert(
    c: PoolClient,
    def: MasterDefinition,
    tenant: TenantContext,
    values: Record<string, unknown>,
  ): Promise<{ id: string; inserted: boolean }> {
    const keys = Object.keys(values);
    const q = upsertSql(def, keys);
    const params = keys.map((k) => values[k]);
    if (def.yearScoped) params.push(tenant.academicYearId);
    try {
      const r = await c.query<{ id: string; inserted: boolean }>(q.text, params);
      return r.rows[0]!;
    } catch (error) {
      // a table constraint the field rules did not cover (a CHECK across columns, a not-null default
      // the file left blank on a new row): the row is refused, not the request
      const e = error as { code?: string; message?: string };
      if (e.code && e.code.startsWith('23'))
        throw new DomainError(
          'validation-failed',
          `${def.title}: ${e.message ?? 'constraint failed'}`,
          {
            status: 400,
          },
        );
      throw error;
    }
  }

  private async getImport(c: PoolClient, id: string): Promise<MasterImportRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragment from the registry or a constant column list; values are bound
      `SELECT ${IMPORT_COLUMNS} FROM master_imports WHERE id = $1`,
      [id],
    );
    return r.rows[0] ? toImport(r.rows[0]) : null;
  }

  /** Datalist options per ref field: value, id and the parent's value when the lookup declares one. */
  async lookups(ctx: RequestContext, id: string): Promise<Record<string, MasterLookupOption[]>> {
    const def = this.def(id);
    this.assertPermission(ctx, def, false);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const out: Record<string, MasterLookupOption[]> = {};
      for (const f of def.fields) {
        if (f.type !== 'ref' || !f.lookup) continue;
        const l = f.lookup;
        const parentJoin = l.parent
          ? // eslint-disable-next-line no-restricted-syntax -- table and column names come from the master registry
            `LEFT JOIN ${l.parent.table} p ON p.id = t.${l.parent.column}`
          : '';
        const parentCol = l.parent ? `p.${l.parent.valueColumn}::text` : 'NULL';
        const r = await c.query<{
          id: string;
          value: string;
          parent: string | null;
          label: string | null;
        }>(
          // eslint-disable-next-line no-restricted-syntax -- table and column names come from the registry; the year is bound
          `SELECT t.id::text, t.${l.column}::text AS value, ${parentCol} AS parent, to_jsonb(t) ->> '${l.labelColumn ?? 'name'}' AS label
            FROM ${l.table} t ${parentJoin}
            WHERE 1 = 1${hasSoftDelete(l.table) ? ' AND t.deleted_at IS NULL' : ''}${l.yearScoped ? ' AND t.academic_year_id = $1' : ''}${l.filter ? ` AND (${l.filter})` : ''}
            ORDER BY 2 LIMIT 2000`,
          l.yearScoped ? [tenant.academicYearId] : [],
        );
        out[f.key] = r.rows;
        if (l.parent) {
          const pr = await c.query<{
            id: string;
            value: string;
            parent: string | null;
            label: string | null;
          }>(
            // eslint-disable-next-line no-restricted-syntax -- names come from the registry
            `SELECT p.id::text, p.${l.parent.valueColumn}::text AS value, NULL AS parent, to_jsonb(p) ->> 'name' AS label
              FROM ${l.parent.table} p${hasSoftDelete(l.parent.table) ? ' WHERE p.deleted_at IS NULL' : ''} ORDER BY 2 LIMIT 2000`,
          );
          out[`${f.key}__parent`] = pr.rows;
        }
      }
      return out;
    });
  }

  /** For every ref field, the map lookup value → id within the tenant (and year, when scoped). */
  private async resolveLookups(
    c: PoolClient,
    tenant: TenantContext,
    fields: MasterField[],
    rows: Cell[][],
    columnIndex: Record<string, number>,
  ): Promise<Record<string, Map<string, string>>> {
    const out: Record<string, Map<string, string>> = {};
    for (const f of fields) {
      if (f.type !== 'ref' || !f.lookup) continue;
      const idx = columnIndex[f.key];
      const wanted = new Set<string>();
      if (idx !== undefined)
        for (const r of rows) {
          const v = r[idx];
          if (v !== null && v !== undefined && String(v).trim() !== '')
            wanted.add(String(v).trim());
        }
      const map = new Map<string, string>();
      if (wanted.size) {
        // a cell may carry the value (a code), what the grid shows ("code · name"), or just the name
        const asked = new Set<string>();
        for (const w of wanted) {
          asked.add(w);
          const head = w.split(' · ')[0]!.trim();
          if (head) asked.add(head);
        }
        const label = f.lookup.labelColumn ?? 'name';
        const r = await c.query<{ id: string; v: string; label: string | null }>(
          // eslint-disable-next-line no-restricted-syntax -- table, columns and the fixed filter come from the registry; values bound
          `SELECT t.id::text, t.${f.lookup.column}::text AS v, to_jsonb(t) ->> '${label}' AS label FROM ${f.lookup.table} t
            WHERE (t.${f.lookup.column}::text = ANY($1::text[]) OR lower(to_jsonb(t) ->> '${label}') = ANY($2::text[]))
              ${hasSoftDelete(f.lookup.table) ? 'AND t.deleted_at IS NULL' : ''}
              ${f.lookup.yearScoped ? 'AND t.academic_year_id = $3' : ''}
              ${f.lookup.filter ? `AND (${f.lookup.filter})` : ''}`,
          f.lookup.yearScoped
            ? [[...asked], [...asked].map((x) => x.toLowerCase()), tenant.academicYearId]
            : [[...asked], [...asked].map((x) => x.toLowerCase())],
        );
        const byLabel = new Map<string, string[]>();
        for (const x of r.rows) {
          map.set(norm(x.v), x.id);
          if (x.label) byLabel.set(norm(x.label), [...(byLabel.get(norm(x.label)) ?? []), x.id]);
        }
        // a name stands for the row only when one row carries it
        for (const [k, ids] of byLabel) if (ids.length === 1 && !map.has(k)) map.set(k, ids[0]!);
      }
      out[f.key] = map;
    }
    return out;
  }
}

// ---- pure helpers ---------------------------------------------------------------------------------
function toImport(r: Record<string, unknown>): MasterImportRow {
  return {
    id: String(r.id),
    master: String(r.master),
    fileName: (r.file_name as string | null) ?? null,
    status: r.status as MasterImportRow['status'],
    totalRows: Number(r.total_rows),
    okRows: Number(r.ok_rows),
    rejectedRows: Number(r.rejected_rows),
    insertedRows: Number(r.inserted_rows),
    updatedRows: Number(r.updated_rows),
    report: (r.report as MasterImportRow['report']) ?? [],
    requestedBy: (r.requested_by as string | null) ?? null,
    createdAt: new Date(r.created_at as string).toISOString(),
    committedAt: r.committed_at ? new Date(r.committed_at as string).toISOString() : null,
  };
}

/** Rules across two fields of a row: a date that may not be before another. */
function crossChecks(
  fields: MasterField[],
  out: Record<string, unknown>,
): Array<{ column: string; message: string }> {
  const errors: Array<{ column: string; message: string }> = [];
  for (const f of fields) {
    if (!f.notBefore) continue;
    const a = out[f.notBefore];
    const b = out[f.key];
    if (typeof a === 'string' && typeof b === 'string' && b < a)
      errors.push({
        column: f.header,
        message: `Cannot be before ${fields.find((x) => x.key === f.notBefore)?.header ?? f.notBefore}`,
      });
  }
  return errors;
}

function ruleFor(f: MasterField): string {
  const parts: string[] = [];
  if (f.identity) parts.push('identifies the row');
  if (f.options?.length) parts.push(`one of ${f.options.join(' | ')}`);
  if (f.type === 'number')
    parts.push(
      `${f.scale === 0 || f.scale === undefined ? 'whole number' : `number with up to ${f.scale} decimals`}${f.min !== undefined ? `, at least ${f.min}` : ''}${f.max !== undefined ? `, at most ${f.max}` : ''}`,
    );
  if (f.type === 'date') parts.push('YYYY-MM-DD or an Excel date');
  if (f.type === 'boolean') parts.push('yes / no');
  if (f.type === 'ref' && f.lookup)
    parts.push(`the ${f.lookup.column} of an existing ${f.lookup.table} row`);
  if (f.maxLength) parts.push(`up to ${f.maxLength} characters`);
  if (f.help) parts.push(f.help);
  return parts.join('; ');
}

/** Header cells matched to fields by header text or key, case- and punctuation-insensitive. */
function mapHeader(header: string[], fields: MasterField[]): Record<string, number> {
  const out: Record<string, number> = {};
  header.forEach((h, i) => {
    const n = norm(String(h ?? ''));
    if (!n) return;
    const f = fields.find((x) => norm(x.header) === n || norm(x.key) === n);
    if (f && out[f.key] === undefined) out[f.key] = i;
  });
  return out;
}

function coerce(
  f: MasterField,
  raw: Cell,
  lookups: Record<string, Map<string, string>>,
): { value?: unknown; error?: string } {
  const empty = raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
  if (empty) {
    if (f.required) return { error: 'Required' };
    // a blank optional cell leaves the column alone: defaults on insert, the current value on update
    return {};
  }
  switch (f.type) {
    case 'text':
    case 'select': {
      const s = String(raw).trim();
      // a field with its own form (a mobile, a GSTIN) says what it must be, not just "too long"
      if (f.pattern && !f.array && !f.options && !new RegExp(f.pattern).test(s))
        return {
          error: f.patternHelp ? `Must be ${f.patternHelp}` : 'Is not in the expected form',
        };
      if (f.maxLength && s.length > f.maxLength)
        return { error: `Longer than ${f.maxLength} characters` };
      if (f.array) {
        const parts = s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (parts.length === 0) return { error: 'Required' };
        return { value: parts };
      }
      if (f.options && !f.options.includes(s)) {
        const hit = f.options.find((o) => norm(o) === norm(s));
        if (!hit) return { error: `Must be one of ${f.options.join(', ')}` };
        return { value: hit };
      }
      if (f.pattern && !new RegExp(f.pattern).test(s))
        return {
          error: f.patternHelp ? `Must be ${f.patternHelp}` : 'Is not in the expected form',
        };
      return { value: s };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s₹]/g, ''));
      if (!Number.isFinite(n)) return { error: 'Not a number' };
      if ((f.scale ?? 0) === 0 && !Number.isInteger(n)) return { error: 'Must be a whole number' };
      if (f.min !== undefined && n < f.min) return { error: `Below ${f.min}` };
      if (f.max !== undefined && n > f.max) return { error: `Above ${f.max}` };
      return { value: f.scale ? Number(n.toFixed(f.scale)) : n };
    }
    case 'date': {
      if (raw instanceof Date) return { value: raw.toISOString().slice(0, 10) };
      const s = String(raw).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? dmy(s);
      if (!m) return { error: 'Not a date (use YYYY-MM-DD)' };
      return { value: `${m[1]}-${m[2]}-${m[3]}` };
    }
    case 'boolean': {
      const s = String(raw).trim().toLowerCase();
      if (['yes', 'y', 'true', '1'].includes(s) || raw === true) return { value: true };
      if (['no', 'n', 'false', '0'].includes(s) || raw === false) return { value: false };
      return { error: 'Use yes or no' };
    }
    case 'ref': {
      const text = String(raw).trim();
      const idv =
        lookups[f.key]?.get(norm(text)) ?? lookups[f.key]?.get(norm(text.split(' · ')[0] ?? ''));
      if (!idv) return { error: `"${text}" is not on the list: choose one from the drop-down` };
      return { value: idv };
    }
    default:
      return { value: raw };
  }
}

/** DD-MM-YYYY or DD/MM/YYYY, the legacy sheets' habit. */
function dmy(s: string): RegExpExecArray | null {
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (!m) return null;
  const out = [
    s,
    m[3]!,
    m[2]!.padStart(2, '0'),
    m[1]!.padStart(2, '0'),
  ] as unknown as RegExpExecArray;
  return out;
}

/** xlsx (first sheet) or csv, as header + rows of cells. */
export interface ReadFileOptions {
  /** Sheets to try in order (e.g. ['Students', 'Student Data Entry']); otherwise the first sheet. */
  sheets?: string[];
  /**
   * Picks the header row among the first rows (a sheet with a title or a section band above the
   * field names); row 1 when absent or when nothing matches.
   */
  isHeader?: (cells: string[]) => boolean;
}

export async function readFile(
  dto: Pick<UploadDto, 'csv' | 'contentBase64'>,
  /** Sheet name to prefer, or options. */
  opts?: string | ReadFileOptions,
): Promise<{ header: string[]; rows: Cell[][]; rowNumbers: number[] }> {
  const o: ReadFileOptions = typeof opts === 'string' ? { sheets: [opts] } : (opts ?? {});
  if (dto.csv) {
    const p = parseCsv(dto.csv);
    return { header: p.header, rows: p.rows, rowNumbers: p.rows.map((_, i) => i + 2) };
  }
  if (!dto.contentBase64)
    throw new DomainError('validation-failed', 'Send csv text or an xlsx file', { status: 400 });
  const buf = Buffer.from(dto.contentBase64, 'base64');
  if (buf.length > 4 * 1024 * 1024)
    throw new DomainError('validation-failed', 'File larger than 4 MB', { status: 400 });
  let wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    // Files re-saved by LibreOffice, Google Sheets or openpyxl with cell notes trip an exceljs bug
    // ("reading 'comments'"): drop the notes and try once more; the data cells are untouched.
    try {
      wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await withoutNotes(buf)) as unknown as ArrayBuffer);
    } catch {
      throw new DomainError('validation-failed', 'Not a readable .xlsx file', { status: 400 });
    }
  }
  const ws =
    (o.sheets ?? []).map((n) => wb.getWorksheet(n)).find((w) => w !== undefined) ??
    wb.worksheets[0];
  if (!ws) throw new DomainError('validation-failed', 'The workbook has no sheet', { status: 400 });
  const all: Array<{ n: number; cells: Cell[] }> = [];
  let width = 0;
  ws.eachRow((row, n) => {
    width = Math.max(width, row.cellCount);
    const cells: Cell[] = [];
    for (let i = 1; i <= Math.max(row.cellCount, width); i += 1)
      cells.push(cellValue(row.getCell(i).value));
    all.push({ n, cells });
  });
  const text = (cells: Cell[]) => cells.map((c) => (c === null ? '' : String(c)));
  let headerAt = 0;
  if (o.isHeader) {
    const found = all.slice(0, 6).findIndex((r) => o.isHeader!(text(r.cells)));
    if (found >= 0) headerAt = found;
  }
  const header = all[headerAt] ? text(all[headerAt]!.cells) : [];
  const rows: Cell[][] = [];
  const rowNumbers: number[] = [];
  for (const r of all.slice(headerAt + 1)) {
    if (r.cells.some((c) => c !== null && String(c).trim() !== '')) {
      rows.push(r.cells);
      rowNumbers.push(r.n);
    }
  }
  return { header, rows, rowNumbers };
}

/** Removes cell notes (comments and their VML drawings) from an .xlsx package. */
async function withoutNotes(buf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buf);
  for (const name of Object.keys(zip.files)) {
    if (/^xl\/comments\d*\.xml$/.test(name) || /^xl\/drawings\/vmlDrawing\d*\.vml$/.test(name))
      zip.remove(name);
  }
  for (const name of Object.keys(zip.files)) {
    const file = zip.file(name);
    if (!file) continue;
    if (/^xl\/worksheets\/_rels\/.+\.rels$/.test(name)) {
      const xml = await file.async('string');
      zip.file(name, xml.replace(/<Relationship[^>]*(comments|vmlDrawing)[^>]*\/>/g, ''));
    } else if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
      const xml = await file.async('string');
      zip.file(name, xml.replace(/<legacyDrawing[^>]*\/>/g, ''));
    } else if (name === '[Content_Types].xml') {
      const xml = await file.async('string');
      zip.file(name, xml.replace(/<Override[^>]*comments\d*\.xml[^>]*\/>/g, ''));
    }
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue((v as ExcelJS.CellFormulaValue).result ?? null);
    if ('richText' in v)
      return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    return String(v);
  }
  return v as Cell;
}
