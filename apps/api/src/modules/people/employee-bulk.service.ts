import { Injectable } from '@nestjs/common';
import {
  EMPLOYEE_FIELDS,
  EMPLOYEE_FIELD_BY_KEY,
  EMPLOYEE_QUICK_KEYS,
  EmployeeWriteError,
  decryptField,
  encryptField,
  loadEmployeeLists,
  maskValue,
  nextEmployeeCode,
  optionsOf,
  readEmployeeProfile,
  validateEmployeeChanges,
  writeEmployeeProfile,
  type EmployeeField,
  type PoolClient,
  type ProfileValue,
} from '@edupro/db';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readFile, type Cell } from '../masters/masters.service';
import type { BulkUploadDto, EmployeeBulkTemplateQueryDto } from './people.dto';
import { PEOPLE } from './people.permissions';

export type EmployeeBulkMode = 'update' | 'create';
const IMPORT_NAME: Record<EmployeeBulkMode, string> = {
  update: 'employee_profile_update',
  create: 'employee_profile_create',
};
const MAX_ROWS = 5000;
/** Typed into a cell to empty that field on purpose (a blank cell means "no change"). */
const CLEAR_WORD = 'CLEAR';
const NAME_COLUMN = { key: '__name', label: 'Employee Name (reference)' };
const LOGIN_COLUMN = { key: '__login', label: 'Create staff login (Yes/No)' };
/** Needed to onboard (the quick form's minimum). */
const REQUIRED_NEW = [
  'first_name',
  'gender',
  'mobile',
  'staff_type',
  'department',
  'designation',
  'joined_on',
];
/** What an upload may set: every field but the computed ones; the code identifies (update). */
const EDITABLE = EMPLOYEE_FIELDS.filter((f) => f.store.t !== 'auto');

export interface PayloadRow {
  row: number;
  code: string;
  name: string;
  employeeId?: string;
  login?: boolean;
  /** Values to write; sensitive ones stored encrypted (`enc:`) until commit. */
  values: Record<string, ProfileValue>;
  changes: Record<string, { from: ProfileValue; to: ProfileValue }>;
}
export interface Problem {
  row: number;
  code?: string;
  column: string;
  message: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'boolean') return c ? 'Yes' : 'No';
  return String(c).trim();
}
const dmy = (v: string) => `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`;

/**
 * Employees in bulk from Excel (docs/design/30-employee-master.md, part 3), as the student upload: a
 * template (update: the current values by employee code; create: empty, the code optional and given the
 * next number), a check that shows every change as old → new and every bad cell with the reason, and a
 * commit that applies only the valid rows, each in its own savepoint; new employees get the posting of
 * the year and, when asked, a staff login.
 */
@Injectable()
export class EmployeeBulkService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private allowed(ctx: RequestContext, mode: EmployeeBulkMode) {
    const need = mode === 'update' ? PEOPLE.employeeEdit : PEOPLE.employeeCreate;
    if (!ctx.permissions?.has(need) || !ctx.permissions.has(PEOPLE.importRun))
      throw new DomainError('forbidden', 'You cannot run this upload', { status: 403 });
  }

  private columns(mode: EmployeeBulkMode, keys?: string[]): EmployeeField[] {
    const chosen = (keys?.length ? EDITABLE.filter((f) => keys.includes(f.key)) : EDITABLE).filter(
      (f) => f.key !== 'employee_code',
    );
    if (mode === 'update') return chosen;
    // create: the onboarding fields first, then the rest in catalogue order
    const quick = EMPLOYEE_QUICK_KEYS.filter((k) => k !== 'employee_code').map((k) =>
      EMPLOYEE_FIELD_BY_KEY.get(k)!,
    );
    return [...quick, ...chosen.filter((f) => !quick.includes(f))];
  }

  async template(ctx: RequestContext, q: EmployeeBulkTemplateQueryDto) {
    this.allowed(ctx, q.mode);
    const keys = q.fields
      ?.split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const unknown = (keys ?? []).filter((k) => !EMPLOYEE_FIELD_BY_KEY.has(k));
    if (unknown.length)
      throw new DomainError('validation-failed', `Unknown field(s): ${unknown.join(', ')}`, {
        status: 400,
      });
    const cols = this.columns(q.mode, keys);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id())`);
      const lists = await loadEmployeeLists(c);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      const info = wb.addWorksheet('Instructions');
      [
        q.mode === 'update'
          ? 'Update employees by employee code'
          : 'Add new employees (one per row)',
        '',
        q.mode === 'update'
          ? '1. Employee Code identifies the employee. Do not change it.'
          : '1. The columns marked * are needed. Leave Employee Code empty to give the next number.',
        '2. Only the columns in the file are touched. A blank cell means "no change".',
        `3. Type ${CLEAR_WORD} in a cell to empty that field on purpose.`,
        '4. Dates as DD-MM-YYYY. Mobile numbers as 10 digits. Use the drop-downs for list columns.',
        '5. Approvers (ACR HOD, L1-L3): the employee code of the approver.',
        '6. Aadhaar, PAN and bank account numbers are not pre-filled; type a number only to replace it.',
        q.mode === 'create'
          ? '7. Create staff login: Yes (the default) makes a sign-in by a code to the mobile or email.'
          : '7. You may delete columns you do not need, but keep the header row as it is.',
        '8. Upload on People → Employees → Excel upload; check the preview, then commit.',
      ].forEach((l, i) => {
        info.getCell(i + 1, 1).value = l;
      });
      info.getCell(1, 1).font = { bold: true, size: 14 };
      info.getColumn(1).width = 110;

      const listSheet = wb.addWorksheet('Lists', { state: 'hidden' });
      const listRef = new Map<string, string>();
      const codes = [
        ...new Set(cols.map((f) => f.list).filter((l): l is string => Boolean(l))),
        'YesNo',
      ];
      codes.forEach((code, i) => {
        const opts = code === 'YesNo' ? ['Yes', 'No'] : optionsOf({ list: code }, lists);
        listSheet.getCell(1, i + 1).value = code;
        opts.forEach((o, j) => {
          listSheet.getCell(j + 2, i + 1).value = o;
        });
        const letter = listSheet.getColumn(i + 1).letter;
        listRef.set(code, `Lists!$${letter}$2:$${letter}$${String(Math.max(opts.length + 1, 2))}`);
      });

      const ws = wb.addWorksheet('Employees', {
        views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }],
      });
      const header: Array<{ key: string; label: string; required: boolean; list?: string }> = [
        { key: 'employee_code', label: 'Employee Code', required: q.mode === 'update' },
        ...(q.mode === 'update'
          ? [{ key: NAME_COLUMN.key, label: NAME_COLUMN.label, required: false }]
          : [{ key: LOGIN_COLUMN.key, label: LOGIN_COLUMN.label, required: false, list: 'YesNo' }]),
        ...cols.map((f) => ({
          key: f.key,
          label: f.label,
          required: q.mode === 'create' && REQUIRED_NEW.includes(f.key),
          list: f.list,
        })),
      ];
      header.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h.required ? `${h.label} *` : h.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A4A' } };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        const f = EMPLOYEE_FIELD_BY_KEY.get(h.key);
        const note = [
          f?.help,
          f?.type === 'employee' ? 'The employee code of the approver.' : null,
          f?.sensitive ? 'Not pre-filled; type a number only to replace it.' : null,
        ].filter(Boolean);
        if (note.length) cell.note = note.join(' ');
        ws.getColumn(i + 1).width = Math.min(Math.max(h.label.length + 4, 14), 36);
        ws.getColumn(i + 1).numFmt = '@'; // keep leading zeros (Aadhaar, PIN, account)
        if (h.list && listRef.has(h.list))
          for (let r = 2; r <= 1001; r += 1)
            ws.getCell(r, i + 1).dataValidation = {
              type: 'list',
              allowBlank: true,
              formulae: [listRef.get(h.list)!],
              showErrorMessage: false,
            };
      });
      ws.getRow(1).height = 32;

      if (q.mode === 'update') {
        const ids = await c.query<{ id: string; code: string; name: string }>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments (a row cap, FOR UPDATE); values are bound
          `SELECT id::text, employee_code AS code, display_name AS name FROM employees
            WHERE deleted_at IS NULL AND ($1::boolean OR status = 'active') ORDER BY display_name LIMIT ${String(MAX_ROWS)}`,
          [q.includeInactive],
        );
        let r = 2;
        for (const x of ids.rows) {
          const p = await readEmployeeProfile(c, x.id, false);
          if (!p) continue;
          ws.getCell(r, 1).value = x.code;
          ws.getCell(r, 2).value = x.name;
          cols.forEach((f, i) => {
            let v = p.values[f.key];
            if (v === null || v === undefined || f.sensitive) return;
            // approvers by their code
            if (f.type === 'employee')
              v = /\(([^()]+)\)\s*$/.exec(p.approvers[String(v)] ?? '')?.[1] ?? null;
            if (v === null) return;
            ws.getCell(r, i + 3).value = f.type === 'date' && typeof v === 'string' ? dmy(v) : v;
          });
          r += 1;
        }
      }
      const stamp = new Date().toISOString().slice(0, 10);
      return {
        fileName: `employees-${q.mode}-${stamp}.xlsx`,
        bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      };
    });
  }

  /** Dry run: parse, match by code, validate, compute the diff; keeps the result for commit. */
  async validate(ctx: RequestContext, dto: BulkUploadDto) {
    this.allowed(ctx, dto.mode);
    const { header, rows, rowNumbers } = await readFile(dto, {
      sheets: ['Employees'],
      isHeader: (cells) => cells.some((h) => norm(h.replace(/\*/g, '')) === 'employeecode'),
    });
    if (!rows.length)
      throw new DomainError('validation-failed', 'The file has no data rows', { status: 400 });
    if (rows.length > MAX_ROWS)
      throw new DomainError('validation-failed', `At most ${String(MAX_ROWS)} rows per upload`, {
        status: 400,
      });
    const byLabel = new Map<string, string>();
    for (const f of EDITABLE) {
      byLabel.set(norm(f.label), f.key);
      byLabel.set(norm(f.key), f.key);
    }
    for (const x of [NAME_COLUMN, LOGIN_COLUMN]) byLabel.set(norm(x.label), x.key);
    byLabel.set(norm('Create login'), LOGIN_COLUMN.key);
    const colKey = header.map((h) => byLabel.get(norm(h.replace(/\*/g, ''))) ?? null);
    if (!colKey.includes('employee_code'))
      throw new DomainError('validation-failed', 'The file needs an "Employee Code" column', {
        status: 400,
      });
    const ignored = header.filter(
      (h, i) => h.trim() && colKey[i] === null && !/^s\.?\s*no\.?$/i.test(h.trim()),
    );

    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.staff_masters_seed(app.current_school_id()), app.staff_profile_lists_seed(app.current_school_id())`);
      const lists = await loadEmployeeLists(c);
      const existing = new Map<string, string>();
      for (const x of (
        await c.query<{ id: string; code: string }>(
          `SELECT id::text, upper(employee_code) AS code FROM employees WHERE deleted_at IS NULL`,
        )
      ).rows)
        existing.set(x.code, x.id);
      // the next numbers for rows without a code (create)
      let next = await nextEmployeeCode(c);
      const bump = (code: string) => {
        const m = /^(.*?)(\d+)$/.exec(code);
        return m ? `${m[1]!}${String(Number(m[2]!) + 1).padStart(m[2]!.length, '0')}` : `${code}1`;
      };

      const problems: Problem[] = ignored.map((h) => ({
        row: 1,
        column: h,
        message: 'Column not recognised; ignored',
      }));
      const payload: PayloadRow[] = [];
      const seen = new Set<string>();
      let unchanged = 0;
      let counted = 0;
      for (let i = 0; i < rows.length; i += 1) {
        const rowNo = rowNumbers[i] ?? i + 2;
        const cells = rows[i]!;
        const raw: Record<string, string | null> = {};
        let code = '';
        let login = true;
        colKey.forEach((k, ci) => {
          if (!k) return;
          const t = cellText(cells[ci] ?? null);
          if (k === 'employee_code') code = t.toUpperCase();
          else if (k === NAME_COLUMN.key) return;
          else if (k === LOGIN_COLUMN.key) login = !/^(no|n|0|false)$/i.test(t);
          else if (t.toUpperCase() === CLEAR_WORD) raw[k] = null;
          else if (t !== '') {
            const f = EMPLOYEE_FIELD_BY_KEY.get(k);
            if (f?.sensitive && /^X{2,}/i.test(t)) return; // a masked number: no change
            raw[k] = t;
          }
        });
        if (!code && !Object.keys(raw).length) continue;
        counted += 1;
        const bad: Problem[] = [];
        const say = (column: string, message: string) =>
          bad.push({ row: rowNo, code: code || undefined, column, message });
        if (dto.mode === 'create' && !code) {
          // the next free number
          while (existing.has(next) || seen.has(next)) next = bump(next);
          code = next;
          next = bump(next);
        }
        if (!code) say('Employee Code', 'is required');
        if (code && seen.has(code)) say('Employee Code', 'appears twice in this file');
        seen.add(code);
        const employeeId = existing.get(code);
        if (dto.mode === 'update' && code && !employeeId)
          say('Employee Code', 'no employee with this code');
        if (dto.mode === 'create' && employeeId)
          say('Employee Code', 'already used; use the update template for existing employees');
        if (dto.mode === 'create') raw.employee_code = code;
        const { values, errors } = await validateEmployeeChanges(c, raw, lists, employeeId ?? null);
        for (const [k, msg] of Object.entries(errors))
          say(EMPLOYEE_FIELD_BY_KEY.get(k)?.label ?? k, msg.replace(/^[^:]+: /, ''));
        if (dto.mode === 'create')
          for (const k of REQUIRED_NEW)
            if ((values[k] === null || values[k] === undefined) && !errors[k])
              say(EMPLOYEE_FIELD_BY_KEY.get(k)!.label, 'is required');
        if (bad.length) {
          problems.push(...bad);
          continue;
        }
        const changes: PayloadRow['changes'] = {};
        let name = '';
        if (dto.mode === 'update') {
          const cur = await readEmployeeProfile(c, employeeId!, false);
          name = [cur?.values.first_name, cur?.values.last_name].filter(Boolean).join(' ');
          for (const [k, to] of Object.entries(values)) {
            const f = EMPLOYEE_FIELD_BY_KEY.get(k)!;
            const from = cur?.values[k] ?? null;
            if (from === to && (!f.sensitive || to === null)) continue;
            changes[k] = {
              from,
              to: f.sensitive && to !== null ? maskValue(String(to), f.type) : to,
            };
          }
          if (!Object.keys(changes).length) {
            unchanged += 1;
            continue;
          }
        } else {
          name = [values.first_name, values.last_name].filter(Boolean).join(' ').toUpperCase();
          for (const [k, to] of Object.entries(values)) {
            const f = EMPLOYEE_FIELD_BY_KEY.get(k)!;
            changes[k] = {
              from: null,
              to: f.sensitive && to !== null ? maskValue(String(to), f.type) : to,
            };
          }
        }
        const stored: Record<string, ProfileValue> = {};
        for (const [k, v] of Object.entries(values)) {
          if (dto.mode === 'update' && !(k in changes)) continue;
          const f = EMPLOYEE_FIELD_BY_KEY.get(k)!;
          stored[k] = f.sensitive && v !== null ? `enc:${encryptField(String(v))}` : v;
        }
        payload.push({
          row: rowNo,
          code,
          name,
          employeeId,
          login: dto.mode === 'create' ? login : undefined,
          values: stored,
          changes,
        });
      }
      const rejected = new Set(problems.filter((p) => p.row > 1).map((p) => p.row)).size;
      const imp = await c.query<{ id: string }>(
        `INSERT INTO master_imports (school_id, master, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, 'validated', $3, $4, $5, $6::jsonb, $7::jsonb, app.current_user_id(), $8)
         RETURNING id::text`,
        [
          IMPORT_NAME[dto.mode],
          dto.fileName ?? null,
          counted,
          payload.length,
          rejected,
          JSON.stringify(problems),
          JSON.stringify(payload),
          ctx.requestId,
        ],
      );
      return this.summaryIn(c, imp.rows[0]!.id, unchanged);
    });
  }

  async summary(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.summaryIn(c, id));
  }

  private async row(c: PoolClient, id: string, lock = false) {
    const r = await c.query<{
      master: string;
      file_name: string | null;
      status: string;
      total_rows: number;
      ok_rows: number;
      rejected_rows: number;
      inserted_rows: number;
      updated_rows: number;
      report: Problem[];
      payload: PayloadRow[];
      created_at: Date;
      committed_at: Date | null;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments (a row cap, FOR UPDATE); values are bound
      `SELECT master, file_name, status::text, total_rows, ok_rows, rejected_rows, inserted_rows, updated_rows, report, payload,
              created_at, committed_at
         FROM master_imports WHERE id = $1 AND master IN ('employee_profile_update', 'employee_profile_create')${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Upload not found');
    return r.rows[0];
  }

  private async summaryIn(c: PoolClient, id: string, unchangedKnown?: number) {
    const x = await this.row(c, id);
    return {
      id,
      mode: (x.master === 'employee_profile_create' ? 'create' : 'update') as EmployeeBulkMode,
      fileName: x.file_name,
      status: x.status,
      totalRows: x.total_rows,
      readyRows: x.ok_rows,
      rejectedRows: x.rejected_rows,
      unchangedRows: unchangedKnown ?? Math.max(x.total_rows - x.ok_rows - x.rejected_rows, 0),
      applied: x.inserted_rows + x.updated_rows,
      createdAt: x.created_at.toISOString(),
      committedAt: x.committed_at?.toISOString() ?? null,
      problems: x.report.slice(0, 1000),
      preview: x.payload.slice(0, 500).map((p) => ({
        row: p.row,
        code: p.code,
        name: p.name,
        login: p.login ?? null,
        changes: Object.entries(p.changes).map(([k, v]) => ({
          field: EMPLOYEE_FIELD_BY_KEY.get(k)?.label ?? k,
          from: v.from,
          to: v.to,
        })),
      })),
    };
  }

  private decode(values: Record<string, ProfileValue>): Record<string, ProfileValue> {
    const out: Record<string, ProfileValue> = {};
    for (const [k, v] of Object.entries(values))
      out[k] = typeof v === 'string' && v.startsWith('enc:') ? decryptField(v.slice(4)) : v;
    return out;
  }

  /** Applies the checked rows; each in a savepoint so one failure does not stop the rest. */
  async commit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = await this.row(c, id, true);
      const mode: EmployeeBulkMode = imp.master === 'employee_profile_create' ? 'create' : 'update';
      this.allowed(ctx, mode);
      if (imp.status !== 'validated')
        throw new DomainError('conflict', 'This upload was already committed', { status: 409 });
      if (Date.now() - imp.created_at.getTime() > 24 * 3600 * 1000)
        throw new DomainError(
          'validation-failed',
          'This check is older than a day; upload the file again',
          {
            status: 400,
          },
        );
      let done = 0;
      let logins = 0;
      const failures: Problem[] = [];
      for (const p of imp.payload) {
        await c.query('SAVEPOINT bulk_row');
        try {
          const values = this.decode(p.values);
          const empId = await writeEmployeeProfile(
            c,
            mode === 'create' ? null : p.employeeId!,
            values,
          );
          if (mode === 'create') {
            await c.query(
              `INSERT INTO postings (school_id, employee_id, academic_year_id, department, designation, valid_from, created_by)
               SELECT app.current_school_id(), $1, y.id, $2, $3, COALESCE($4::date, CURRENT_DATE), app.current_user_id()
                 FROM academic_years y WHERE y.status = 'active' ORDER BY y.start_date DESC LIMIT 1
               ON CONFLICT (employee_id, academic_year_id) DO NOTHING`,
              [empId, values.department, values.designation, values.joined_on],
            );
            await c.query(
              `INSERT INTO employee_remarks (school_id, employee_id, remark, source, created_by)
               VALUES (app.current_school_id(), $1, 'Onboarded (Excel upload)', 'system', app.current_user_id())`,
              [empId],
            );
            if (p.login) {
              await c.query('SAVEPOINT bulk_login');
              try {
                await c.query(`SELECT app.employee_create_login($1)`, [empId]);
                await c.query('RELEASE SAVEPOINT bulk_login');
                logins += 1;
              } catch {
                // no contact to sign in with: the employee is still added
                await c.query('ROLLBACK TO SAVEPOINT bulk_login');
              }
            }
          } else if (values.left_on !== undefined) {
            await c.query(
              `UPDATE employees SET status = CASE WHEN $2::date IS NOT NULL AND $2::date <= CURRENT_DATE THEN 'inactive'::row_status
                                                  WHEN $2::date IS NULL THEN 'active'::row_status ELSE status END WHERE id = $1`,
              [empId, values.left_on],
            );
          }
          await this.audit.stage(ctx, c, {
            action: mode === 'create' ? 'people.employee.onboard' : 'people.employee.profile',
            entityType: 'employees',
            entityId: empId,
            after: { changed: Object.keys(p.changes), bulkUpload: id },
          });
          await c.query('RELEASE SAVEPOINT bulk_row');
          done += 1;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT bulk_row');
          const e = error as { code?: string; message?: string };
          failures.push({
            row: p.row,
            code: p.code,
            column: 'Row',
            message:
              error instanceof EmployeeWriteError
                ? Object.values(error.errors).join('; ')
                : e.code === '23505'
                  ? 'the employee code is already used'
                  : (e.message ?? 'could not be saved'),
          });
        }
      }
      await c.query(
        `UPDATE master_imports SET status = 'committed', committed_at = now(), inserted_rows = $2, updated_rows = $3,
                report = report || $4::jsonb WHERE id = $1`,
        [id, mode === 'create' ? done : 0, mode === 'update' ? done : 0, JSON.stringify(failures)],
      );
      return { id, mode, applied: done, logins, failed: failures.length, failures };
    });
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        master: string;
        file_name: string | null;
        status: string;
        total_rows: number;
        ok_rows: number;
        rejected_rows: number;
        applied: number;
        created_at: Date;
        committed_at: Date | null;
        requested_by: string | null;
      }>(
        `SELECT m.id::text, m.master, m.file_name, m.status::text, m.total_rows, m.ok_rows, m.rejected_rows,
                m.inserted_rows + m.updated_rows AS applied, m.created_at, m.committed_at, u.display_name AS requested_by
           FROM master_imports m LEFT JOIN users u ON u.id = m.requested_by
          WHERE m.master IN ('employee_profile_update', 'employee_profile_create')
          ORDER BY m.created_at DESC LIMIT 20`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        mode: x.master === 'employee_profile_create' ? 'create' : 'update',
        fileName: x.file_name,
        status: x.status,
        totalRows: x.total_rows,
        readyRows: x.ok_rows,
        rejectedRows: x.rejected_rows,
        applied: x.applied,
        createdAt: x.created_at.toISOString(),
        committedAt: x.committed_at?.toISOString() ?? null,
        requestedBy: x.requested_by,
      }));
    });
  }

  /** Every row's outcome as an Excel file (check problems and commit failures). */
  async resultFile(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = await this.row(c, id);
      const failed = new Set(imp.report.map((p) => p.row));
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Result');
      ws.addRow(['Row', 'Employee Code', 'Employee', 'Outcome', 'Detail']);
      ws.getRow(1).font = { bold: true };
      for (const p of imp.payload)
        if (!failed.has(p.row))
          ws.addRow([
            p.row,
            p.code,
            p.name,
            imp.status === 'committed' ? 'Saved' : 'Ready',
            Object.entries(p.changes)
              .map(
                ([k, v]) =>
                  `${EMPLOYEE_FIELD_BY_KEY.get(k)?.label ?? k}: ${String(v.from ?? '—')} → ${String(v.to ?? '(cleared)')}`,
              )
              .join('; ')
              .slice(0, 32000),
          ]);
      for (const p of imp.report)
        ws.addRow([p.row, p.code ?? '', '', 'Not saved', `${p.column}: ${p.message}`]);
      [8, 16, 28, 12, 100].forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });
      return {
        fileName: `employee-upload-${id}-result.xlsx`,
        bytes: Buffer.from(await wb.xlsx.writeBuffer()),
      };
    });
  }
}
