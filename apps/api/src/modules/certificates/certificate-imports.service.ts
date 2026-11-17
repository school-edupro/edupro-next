import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readSheet, templateSheet, type TemplateColumn } from '../../common/excel/sheet';
import { CertificateBulkService, type BulkTarget } from './certificate-bulk.service';
import { fieldsOf, type FieldSpec } from './certificate-fields';
import { printedDetails, type PersonSpec } from './certificate-person';
import {
  BULK_MAX,
  type BulkPreviewDto,
  type ImportReuploadDto,
  type ImportUploadDto,
} from './certificates.dto';
import { CertificatesService, type TypeRow } from './certificates.service';

/**
 * Certificates from an Excel sheet (docs/design/87, 17 Nov 2026; e.g. the Class XII TCs after the board result). The
 * office chooses a certificate and who it is for and downloads a sheet built for that certificate: one row a person,
 * filled from the records — the certificate's own details (a TC's reason, struck-off date, conduct …) and the person's
 * details its layouts print (name, parents, date of birth …; a change prints on that certificate only). The upload is
 * kept as a draft; each row is checked as the Issue page checks it. The rows that are ready are issued in one run (a
 * batch a section or department, with its PDFs); the others keep what to fix, for an errors file to correct and upload
 * again into the same draft. A TC row whose student has no withdrawal yet says so (the page starts them in bulk).
 */

/** A column of a certificate sheet: what it holds and how it is written and read. */
interface SheetColumn extends TemplateColumn {
  kind: 'key' | 'ref' | 'issuedOn' | 'purpose' | 'layout' | 'field' | 'person';
  /** a field's key, or a person detail's path */
  ref?: string;
  /** a field or person detail of kind date / number / list */
  type?: 'text' | 'date' | 'number' | 'list';
}

export interface ImportRow {
  /** the upload it came with and its row in that file */
  upload: number;
  row: number;
  /** the cells as read, by heading (the errors file writes them back) */
  cells: Record<string, string>;
  key: string;
  personId: string | null;
  name: string;
  /** a student's section (an employee's department) and its name: a batch each */
  group: string | null;
  groupLabel: string | null;
  status: 'ready' | 'attention' | 'issued' | 'issuing';
  problems: string[];
  /** a TC whose student has no withdrawal yet: one may be started from the upload */
  startWithdrawal: boolean;
  withdrawal: { id: string; status: string } | null;
  /** what it is issued with */
  issue: {
    fields: Record<string, string | number>;
    person: Record<string, string>;
    purpose?: string;
    issuedOn?: string;
    variant?: string;
  };
  certificateId: string | null;
  number: string | null;
}

const KEY = { STUDENT: 'Admission no.', STAFF: 'Employee code' } as const;
const NAME = { STUDENT: 'Student', STAFF: 'Employee' } as const;
const PLACE = { STUDENT: 'Class', STAFF: 'Department' } as const;
const FIX = 'What to fix';

const pad = (n: number) => String(n).padStart(2, '0');
/** A date as typed or as Excel keeps it — yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy — as yyyy-mm-dd, or null. */
export function isoDate(v: string): string | null {
  const t = v.trim();
  let y: number;
  let mo: number;
  let d: number;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t)))
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return `${String(y)}-${pad(mo)}-${pad(d)}`;
}
/** A date for a sheet's date cell (Excel shows it dd-mm-yyyy), from yyyy-mm-dd or dd-mm-yyyy. */
const cellDate = (v: unknown): Date | string | null => {
  if (typeof v !== 'string' || !v) return v === undefined || v === null ? null : String(v);
  const iso = isoDate(v);
  return iso ? new Date(`${iso}T00:00:00Z`) : v;
};

@Injectable()
export class CertificateImportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly certificates: CertificatesService,
    private readonly bulk: CertificateBulkService,
  ) {}

  // ---- the sheet ------------------------------------------------------------------------------------------------------
  /**
   * The columns of a type's sheet: who (the key, then the name and class to help), the date of issue, the purpose
   * (not for a TC), the layout (a type with more than one), the type's own details, then the person's details its
   * layouts print. Headings are kept apart (a detail named like a field gets "(as printed)").
   */
  private async columnsOf(c: PoolClient, type: TypeRow): Promise<SheetColumn[]> {
    const audience = type.audience === 'STAFF' ? 'STAFF' : 'STUDENT';
    const layouts = await this.certificates.layoutsOf(c, type);
    const specs: FieldSpec[] = fieldsOf(type.code, type.fields);
    const details: PersonSpec[] = [];
    for (const l of layouts)
      for (const d of printedDetails(l.body, audience))
        if (!details.some((x) => x.path === d.path)) details.push(d);
    const used = new Set<string>();
    const unique = (h: string) => {
      let out = h;
      if (used.has(out.toLowerCase())) out = `${h} (as printed)`;
      used.add(out.toLowerCase());
      return out;
    };
    const cols: SheetColumn[] = [
      {
        kind: 'key',
        header: unique(KEY[audience]),
        width: 16,
        required: true,
        format: 'text',
        note: 'Who it is for: the sheet finds the person by this.',
      },
      {
        kind: 'ref',
        header: unique(NAME[audience]),
        width: 26,
        note: 'To help you; not read on upload.',
      },
      {
        kind: 'ref',
        header: unique(PLACE[audience]),
        width: 16,
        note: 'To help you; not read on upload.',
      },
      {
        kind: 'issuedOn',
        header: unique('Date of issue'),
        width: 14,
        format: 'date',
        type: 'date',
        note: 'Empty: the day it is issued.',
      },
    ];
    if (type.code !== 'TC')
      cols.push({
        kind: 'purpose',
        header: unique('Purpose'),
        width: 24,
        note: 'Printed on the certificate (e.g. bank account). May be left empty.',
      });
    if (layouts.length > 1)
      cols.push({
        kind: 'layout',
        header: unique('Layout'),
        width: 22,
        options: layouts.map((l) => l.label),
        type: 'list',
        note: 'Which layout it prints with. Empty: the first.',
      });
    for (const f of specs)
      cols.push({
        kind: 'field',
        ref: f.key,
        header: unique(f.label),
        width: f.kind === 'text' ? 28 : 16,
        required: !!f.required,
        type: f.kind,
        ...(f.kind === 'date' ? { format: 'date' as const } : {}),
        ...(f.kind === 'number' ? { format: 'whole' as const } : {}),
        ...(f.kind === 'list' && f.options ? { options: f.options } : {}),
        ...(f.hint ? { note: f.hint } : {}),
      });
    for (const d of details)
      cols.push({
        kind: 'person',
        ref: d.path,
        header: unique(d.label),
        width: d.kind === 'date' ? 14 : 24,
        type: d.kind,
        ...(d.kind === 'date' ? { format: 'date' as const } : {}),
        note: 'From the record. A change prints on this certificate only; the record stays as it is.',
      });
    return cols;
  }

  private guide(type: TypeRow): string[] {
    const staff = type.audience === 'STAFF';
    const who = staff ? 'employee' : 'student';
    return [
      `One row a ${who}: the ${staff ? 'employee code' : 'admission number'} says who it is for; the name and ${staff ? 'department' : 'class'} are there to help and are not read.`,
      'The sheet is filled from the records: correct what is wrong and fill what is empty. A cell left empty prints as the record has it.',
      'Red headings are required. Pick list answers (conduct, whether failed …) from the drop-down. Dates as dd-mm-yyyy.',
      `The ${who}'s details the certificate prints (name, parents, date of birth …): a change prints on that certificate only — the record stays as it is.`,
      'Date of issue empty: the day it is issued. Delete the rows of those who should not get one.',
      `Upload it on Certificates → Bulk issue → From Excel. Every row is checked as the Issue page checks it before anything is issued; the rows ready are issued, the others come back with what to fix.`,
      `${type.name}: numbered in the register as issued, a PDF for each ${staff ? 'department' : 'section'}.`,
    ];
  }

  /** A sheet for a type and a scope, one row a person, filled from the records. */
  async sheet(ctx: RequestContext, dto: BulkPreviewDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      const staff = type.audience === 'STAFF';
      if (staff !== !!dto.departments?.length)
        throw new DomainError(
          'validation-failed',
          staff ? 'Choose the departments' : 'Choose the classes and sections, or the leavers',
          { status: 400 },
        );
      const people = await this.bulk.targets(c, dto);
      if (!people.length)
        throw new DomainError('validation-failed', `No ${staff ? 'employees' : 'students'} here`, {
          status: 400,
        });
      if (people.length > BULK_MAX)
        throw new DomainError(
          'validation-failed',
          `At most ${String(BULK_MAX)} in one sheet: choose fewer sections`,
          { status: 400 },
        );
      const cols = await this.columnsOf(c, type);
      const layouts = await this.certificates.layoutsOf(c, type);
      const rows: Array<Array<string | number | Date | null>> = [];
      for (const p of people) {
        const s = await this.certificates.sheetData(
          c,
          ctx,
          type,
          staff ? { employeeId: p.id } : { studentId: p.id },
        );
        rows.push(
          cols.map((col) => {
            switch (col.kind) {
              case 'key':
                return p.admissionNo;
              case 'ref':
                return col.header === NAME[staff ? 'STAFF' : 'STUDENT']
                  ? p.name
                  : (p.classLabel ?? '');
              case 'issuedOn':
                return dto.issuedOn ? cellDate(dto.issuedOn) : null;
              case 'purpose':
                return dto.purpose ?? '';
              case 'layout':
                return layouts[0]?.label ?? '';
              case 'field': {
                const v = s.fields[col.ref!];
                if (v === undefined || v === null || v === '') return null;
                return col.type === 'date' ? cellDate(String(v)) : v;
              }
              case 'person': {
                const [who, key] = col.ref!.split('.') as [string, string];
                const v = (s.data[who] as Record<string, unknown> | undefined)?.[key];
                if (v === undefined || v === null || v === '' || typeof v === 'object') return null;
                return col.type === 'date' ? cellDate(String(v)) : String(v);
              }
            }
          }),
        );
      }
      const bytes = await templateSheet({
        sheet: type.name,
        columns: cols,
        guide: this.guide(type),
        rows: rows as Array<Array<string | number | null>>,
        hideLists: true,
      });
      return {
        filename: `${type.code.toLowerCase()}-sheet.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  // ---- reading and checking -------------------------------------------------------------------------------------------
  /** The rows of an uploaded sheet: each cell read as its column says, with what is wrong in the cells themselves. */
  private async read(
    fileBase64: string,
    cols: SheetColumn[],
    layouts: Array<{ templateId: string; label: string }>,
    upload: number,
  ): Promise<ImportRow[]> {
    const key = cols.find((x) => x.kind === 'key')!;
    const others = cols.filter((x) => x.kind !== 'key').map((x) => x.header);
    const read = await readSheet(fileBase64, [key.header], others);
    return read.map(({ row, cells }) => {
      const problems: string[] = [];
      const fields: Record<string, string | number> = {};
      const person: Record<string, string> = {};
      let purpose: string | undefined;
      let issuedOn: string | undefined;
      let variant: string | undefined;
      for (const col of cols) {
        const v = (cells[col.header] ?? '').trim();
        if (!v || col.kind === 'key' || col.kind === 'ref') continue;
        if (col.kind === 'issuedOn') {
          const iso = isoDate(v);
          if (iso) issuedOn = iso;
          else problems.push(`${col.header}: a date, like 31-03-2027`);
        } else if (col.kind === 'purpose') purpose = v.slice(0, 200);
        else if (col.kind === 'layout') {
          const l = layouts.find((x) => x.label.toLowerCase() === v.toLowerCase());
          if (l) variant = l.templateId;
          else problems.push(`${col.header}: one of ${layouts.map((x) => x.label).join(', ')}`);
        } else if (col.type === 'date') {
          const iso = isoDate(v);
          if (!iso) problems.push(`${col.header}: a date, like 31-03-2027`);
          else if (col.kind === 'field') fields[col.ref!] = iso;
          else person[col.ref!] = iso;
        } else if (col.type === 'number' && col.kind === 'field') {
          if (/^\d{1,4}(\.0+)?$/.test(v)) fields[col.ref!] = Number.parseInt(v, 10);
          else problems.push(`${col.header}: a whole number`);
        } else if (col.type === 'list' && col.kind === 'field') {
          const o = col.options?.find((x) => x.toLowerCase() === v.toLowerCase());
          if (o) fields[col.ref!] = o;
          else problems.push(`${col.header}: one of ${(col.options ?? []).join(', ')}`);
        } else if (col.kind === 'field') fields[col.ref!] = v.slice(0, 500);
        else person[col.ref!] = v.slice(0, 300);
      }
      return {
        upload,
        row,
        cells,
        key: (cells[key.header] ?? '').trim(),
        personId: null,
        name: '',
        group: null,
        groupLabel: null,
        status: 'attention' as const,
        problems,
        startWithdrawal: false,
        withdrawal: null,
        issue: {
          fields,
          person,
          ...(purpose ? { purpose } : {}),
          ...(issuedOn ? { issuedOn } : {}),
          ...(variant ? { variant } : {}),
        },
        certificateId: null,
        number: null,
      };
    });
  }

  /**
   * Finds each row's person and checks it as the Issue page would: the person, the checks, the details, a second row of
   * the same person. A TC row without a withdrawal says it may be started. Rows issued are left as they are.
   */
  private async check(ctx: RequestContext, type: TypeRow, rows: ImportRow[]) {
    const tenant = requireTenant(ctx);
    const staff = type.audience === 'STAFF';
    const open = rows.filter((r) => r.status !== 'issued');
    const keys = [...new Set(open.map((r) => r.key.toLowerCase()).filter(Boolean))];
    const found = await this.db.tenant(tenant, async (c) => {
      if (staff) {
        const e = await c.query<{
          id: string;
          name: string;
          code: string;
          department: string;
        }>(
          `SELECT e.id::text, e.display_name AS name, e.employee_code AS code,
                  COALESCE(NULLIF(btrim(e.department), ''), '') AS department
             FROM employees e WHERE e.deleted_at IS NULL AND lower(e.employee_code) = ANY($1::text[])`,
          [keys],
        );
        return new Map(
          e.rows.map((x) => [
            x.code.toLowerCase(),
            { id: x.id, name: x.name, group: x.department, label: x.department || 'No department' },
          ]),
        );
      }
      const s = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        section_id: string | null;
        class_label: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no, en.class_section_id::text AS section_id,
                k.name || ' – ' || cs.name AS class_label
           FROM students s
           LEFT JOIN LATERAL (SELECT e.class_section_id FROM enrolments e JOIN academic_years y ON y.id = e.academic_year_id
                               WHERE e.student_id = s.id AND e.status <> 'cancelled'
                               ORDER BY y.start_date DESC, e.id DESC LIMIT 1) en ON true
           LEFT JOIN class_sections cs ON cs.id = en.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
          WHERE s.deleted_at IS NULL AND lower(s.admission_no) = ANY($1::text[])`,
        [keys],
      );
      return new Map(
        s.rows.map((x) => [
          x.admission_no.toLowerCase(),
          { id: x.id, name: x.name, group: x.section_id, label: x.class_label },
        ]),
      );
    });
    const withdrawals = staff
      ? new Map<string, { id: string; status: string }>()
      : await this.db.tenant(tenant, async (c) => {
          const ids = [...found.values()].map((x) => x.id);
          const w = await c.query<{ student_id: string; id: string; status: string }>(
            `SELECT DISTINCT ON (student_id) student_id::text, id::text, status::text FROM student_withdrawals
              WHERE student_id = ANY($1::bigint[]) AND status NOT IN ('cancelled', 'revoked')
                AND kind IS DISTINCT FROM 'admission_cancelled'
              ORDER BY student_id, created_at DESC`,
            [ids],
          );
          return new Map(w.rows.map((x) => [x.student_id, { id: x.id, status: x.status }]));
        });
    const issuedPeople = new Set(
      rows.filter((r) => r.status === 'issued' && r.personId).map((r) => r.personId!),
    );
    const seen = new Map<string, number>();
    for (const r of open) {
      const readProblems = r.problems.filter((p) => !p.startsWith('· '));
      const problems = [...readProblems];
      const p = r.key ? found.get(r.key.toLowerCase()) : undefined;
      r.personId = p?.id ?? null;
      r.name = p?.name ?? r.cells[NAME[staff ? 'STAFF' : 'STUDENT']] ?? '';
      r.group = p?.group ?? null;
      r.groupLabel = p?.label ?? null;
      r.withdrawal = p ? (withdrawals.get(p.id) ?? null) : null;
      r.startWithdrawal = false;
      if (!r.key) problems.push(`· ${KEY[staff ? 'STAFF' : 'STUDENT']} is empty`);
      else if (!p)
        problems.push(
          `· No ${staff ? 'employee with code' : 'student with admission no.'} ${r.key}`,
        );
      else if (issuedPeople.has(p.id)) problems.push('· Already issued from this upload');
      else if (seen.has(p.id)) problems.push(`· Also on row ${String(seen.get(p.id))}`);
      if (p && !seen.has(p.id)) seen.set(p.id, r.row);
      if (p && !problems.some((x) => x.startsWith('· '))) {
        try {
          const a = await this.certificates.assess(ctx, {
            typeCode: type.code,
            ...(staff ? { employeeId: p.id } : { studentId: p.id }),
            fields: r.issue.fields,
            person: r.issue.person,
            ...(r.issue.purpose ? { purpose: r.issue.purpose } : {}),
            ...(r.issue.issuedOn ? { issuedOn: r.issue.issuedOn } : {}),
            ...(r.issue.variant ? { variant: r.issue.variant } : {}),
          });
          for (const x of a.problems) problems.push(`· ${x}`);
          for (const x of a.checks.filter((k) => !k.ok)) problems.push(`· ${x.label}: ${x.detail}`);
          // a TC whose student has not started a withdrawal: one may be started from the upload
          r.startWithdrawal =
            type.rules.state === 'leaving' &&
            a.checks.some((k) => k.key === 'state' && !k.ok) &&
            !r.withdrawal;
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          problems.push(`· ${e.message}`);
        }
      }
      // what is wrong with the cells first, then what the person's checks found (marked "· " so a re-check redoes them)
      r.problems = problems;
      r.status = problems.length ? 'attention' : 'ready';
    }
  }

  // ---- the draft ------------------------------------------------------------------------------------------------------
  /** A new upload: read, checked, kept as a draft. */
  async upload(ctx: RequestContext, dto: ImportUploadDto) {
    const tenant = requireTenant(ctx);
    const { type, cols, layouts } = await this.db.tenant(tenant, async (c) => {
      await this.certificates.ensureSetup(c);
      const type = await this.certificates.typeOf(c, dto.typeCode);
      return {
        type,
        cols: await this.columnsOf(c, type),
        layouts: await this.certificates.layoutsOf(c, type),
      };
    });
    const rows = await this.read(dto.fileBase64, cols, layouts, 1);
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no rows', { status: 400 });
    if (rows.length > BULK_MAX)
      throw new DomainError(
        'validation-failed',
        `At most ${String(BULK_MAX)} rows in one upload: split the sheet`,
        { status: 400 },
      );
    await this.check(ctx, type, rows);
    const id = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO certificate_imports (school_id, type_id, title, scope, file_name, columns, rows, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          type.id,
          (dto.title?.trim() || `${type.name} · ${dto.fileName}`).slice(0, 200),
          JSON.stringify(dto.scope ?? {}),
          dto.fileName.slice(0, 200),
          JSON.stringify(cols),
          JSON.stringify(rows),
        ],
      );
      const newId = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'certificate.import.upload',
        entityType: 'certificate_imports',
        entityId: newId,
        after: {
          type: type.code,
          file: dto.fileName,
          rows: rows.length,
          ready: rows.filter((x) => x.status === 'ready').length,
        },
      });
      return newId;
    });
    return this.get(ctx, id);
  }

  private async load(c: PoolClient, id: string, lock = false) {
    if (!/^\d{1,18}$/.test(id)) throw new DomainError('not-found', 'Upload not found');
    const r = await c.query<{
      id: string;
      type_code: string;
      type_name: string;
      audience: string;
      title: string;
      scope: Record<string, unknown>;
      file_name: string | null;
      uploads: number;
      columns: SheetColumn[];
      rows: ImportRow[];
      run_ids: string[];
      by: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- the lock is a fixed fragment; values are bound parameters
      `SELECT i.id::text, t.code AS type_code, t.name AS type_name, t.audience::text, i.title, i.scope, i.file_name,
              i.uploads, i.columns, i.rows, i.run_ids::text[] AS run_ids, u.display_name AS by, i.created_at, i.updated_at
         FROM certificate_imports i JOIN certificate_types t ON t.id = i.type_id LEFT JOIN users u ON u.id = i.created_by
        WHERE i.id = $1 ${lock ? 'FOR UPDATE OF i' : ''}`,
      [id],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Upload not found');
    return x;
  }

  /** The rows written back (and a run made from it added). */
  private async save(c: PoolClient, id: string, rows: ImportRow[], runId: string | null = null) {
    await c.query(
      `UPDATE certificate_imports SET rows = $2::jsonb, updated_by = app.current_user_id(), updated_at = now(),
              run_ids = CASE WHEN $3::uuid IS NULL THEN run_ids ELSE array_append(run_ids, $3::uuid) END
        WHERE id = $1`,
      [id, JSON.stringify(rows), runId],
    );
  }

  /** An upload with its figures and rows. */
  async get(ctx: RequestContext, id: string) {
    const x = await this.db.tenant(requireTenant(ctx), (c) => this.load(c, id));
    const count = (s: ImportRow['status']) => x.rows.filter((r) => r.status === s).length;
    return {
      id: x.id,
      title: x.title,
      type: { code: x.type_code, name: x.type_name, audience: x.audience },
      scope: x.scope,
      fileName: x.file_name,
      uploads: x.uploads,
      by: x.by,
      createdAt: x.created_at.toISOString(),
      updatedAt: x.updated_at.toISOString(),
      runIds: x.run_ids,
      figures: {
        rows: x.rows.length,
        ready: count('ready'),
        attention: count('attention'),
        issued: count('issued'),
        startWithdrawal: x.rows.filter((r) => r.status === 'attention' && r.startWithdrawal).length,
      },
      rows: x.rows.map((r) => ({
        upload: r.upload,
        row: r.row,
        key: r.key,
        personId: r.personId,
        name: r.name,
        groupLabel: r.groupLabel,
        status: r.status,
        problems: r.problems.map((p) => p.replace(/^· /, '')),
        startWithdrawal: r.startWithdrawal,
        withdrawal: r.withdrawal,
        issue: r.issue,
        certificateId: r.certificateId,
        number: r.number,
      })),
    };
  }

  /** The uploads, newest first, with their figures. */
  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        type_name: string;
        file_name: string | null;
        uploads: number;
        total: number;
        ready: number;
        attention: number;
        issued: number;
        by: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT i.id::text, i.title, t.name AS type_name, i.file_name, i.uploads,
                jsonb_array_length(i.rows)::int AS total,
                (SELECT count(*)::int FROM jsonb_array_elements(i.rows) x WHERE x->>'status' = 'ready') AS ready,
                (SELECT count(*)::int FROM jsonb_array_elements(i.rows) x WHERE x->>'status' = 'attention') AS attention,
                (SELECT count(*)::int FROM jsonb_array_elements(i.rows) x WHERE x->>'status' = 'issued') AS issued,
                u.display_name AS by, i.created_at, i.updated_at
           FROM certificate_imports i JOIN certificate_types t ON t.id = i.type_id LEFT JOIN users u ON u.id = i.created_by
          ORDER BY i.updated_at DESC LIMIT 50`,
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          title: x.title,
          typeName: x.type_name,
          fileName: x.file_name,
          uploads: x.uploads,
          total: x.total,
          ready: x.ready,
          attention: x.attention,
          issued: x.issued,
          by: x.by,
          createdAt: x.created_at.toISOString(),
          updatedAt: x.updated_at.toISOString(),
        })),
      };
    });
  }

  /**
   * A corrected sheet into the same draft: each of its rows takes the place of the row of the same person that is not
   * issued yet (or is added); rows issued stay; rows not in the file stay as they were. Then every row not issued is
   * checked again.
   */
  async reupload(ctx: RequestContext, id: string, dto: ImportReuploadDto) {
    const tenant = requireTenant(ctx);
    const x = await this.db.tenant(tenant, (c) => this.load(c, id));
    const { type, layouts } = await this.db.tenant(tenant, async (c) => {
      const type = await this.certificates.typeOf(c, x.type_code);
      return { type, layouts: await this.certificates.layoutsOf(c, type) };
    });
    const upload = x.uploads + 1;
    const fresh = await this.read(dto.fileBase64, x.columns, layouts, upload);
    if (!fresh.length)
      throw new DomainError('validation-failed', 'The sheet has no rows', { status: 400 });
    // the people of the new rows, to put them in place of their earlier rows
    await this.check(ctx, type, fresh);
    const rows = [...x.rows];
    for (const n of fresh) {
      const at = rows.findIndex(
        (r) =>
          r.status !== 'issued' &&
          ((n.personId && r.personId === n.personId) ||
            (!n.personId && r.key.toLowerCase() === n.key.toLowerCase())),
      );
      if (at >= 0) rows[at] = n;
      else rows.push(n);
    }
    if (rows.length > BULK_MAX)
      throw new DomainError(
        'validation-failed',
        `At most ${String(BULK_MAX)} rows in one upload: start a new one`,
        { status: 400 },
      );
    await this.check(ctx, type, rows);
    await this.db.tenant(tenant, async (c) => {
      await this.load(c, id, true);
      await c.query(
        `UPDATE certificate_imports SET rows = $2::jsonb, uploads = $3, file_name = $4,
                updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(rows), upload, dto.fileName.slice(0, 200)],
      );
      await this.audit.stage(ctx, c, {
        action: 'certificate.import.upload',
        entityType: 'certificate_imports',
        entityId: id,
        after: { file: dto.fileName, upload, rows: fresh.length },
      });
    });
    return this.get(ctx, id);
  }

  /** Every row not issued checked again (after withdrawals, fees or the records were put right). */
  async verify(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const x = await this.db.tenant(tenant, (c) => this.load(c, id));
    const type = await this.db.tenant(tenant, (c) => this.certificates.typeOf(c, x.type_code));
    const rows = x.rows;
    await this.check(ctx, type, rows);
    await this.db.tenant(tenant, async (c) => {
      await this.load(c, id, true);
      await this.save(c, id, rows);
    });
    return this.get(ctx, id);
  }

  /** The rows that need attention as a sheet to correct (with what to fix) and upload again. */
  async errors(ctx: RequestContext, id: string) {
    const x = await this.db.tenant(requireTenant(ctx), (c) => this.load(c, id));
    const bad = x.rows.filter((r) => r.status === 'attention');
    if (!bad.length)
      throw new DomainError('validation-failed', 'No row needs attention', { status: 400 });
    const cols: SheetColumn[] = [
      ...x.columns,
      {
        kind: 'ref',
        header: FIX,
        width: 60,
        note: 'Why the row was not issued. Not read on upload.',
      },
    ];
    const rows = bad.map((r) =>
      cols.map((col) => {
        if (col.header === FIX) return r.problems.map((p) => p.replace(/^· /, '')).join('; ');
        const v = r.cells[col.header] ?? '';
        if (!v) return null;
        return col.type === 'date' || col.kind === 'issuedOn' ? cellDate(v) : v;
      }),
    );
    const type = await this.db.tenant(requireTenant(ctx), (c) =>
      this.certificates.typeOf(c, x.type_code),
    );
    const bytes = await templateSheet({
      sheet: x.type_name,
      columns: cols,
      guide: [
        'These rows were not issued: "What to fix" (the last column) says why.',
        'Correct them here — or put right the record, the fees or the withdrawal — then upload this sheet again into the same upload. The other rows stay as they are.',
        ...this.guide(type).slice(1, 4),
      ],
      rows: rows as Array<Array<string | number | null>>,
      hideLists: true,
    });
    return {
      filename: `${x.type_code.toLowerCase()}-to-fix-${x.id}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  // ---- the issue ------------------------------------------------------------------------------------------------------
  /**
   * The rows that are ready, issued in one run: a batch for each section (or department), each certificate with its own
   * details, numbered as issued. A row refused at issue (its checks changed) goes back to needing attention with why.
   */
  async issue(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    // the ready rows taken in one step, so a second press finds none
    const taken = await this.db.tenant(tenant, async (c) => {
      const x = await this.load(c, id, true);
      const ready = x.rows.filter((r) => r.status === 'ready' && r.personId);
      if (!ready.length)
        throw new DomainError('validation-failed', 'No row is ready to issue', { status: 400 });
      for (const r of ready) r.status = 'issuing';
      await this.save(c, id, x.rows);
      return { x, ready };
    });
    const type = await this.db.tenant(tenant, (c) =>
      this.certificates.typeOf(c, taken.x.type_code),
    );
    const staff = type.audience === 'STAFF';
    const runId = randomUUID();
    const made = new Map<string, string>();
    const groups: Array<{
      scope: Record<string, unknown>;
      label: string;
      items: Array<{
        student: BulkTarget;
        dto: Parameters<CertificatesService['issue']>[1];
        after?: (certificateId: string) => Promise<void>;
      }>;
    }> = [];
    for (const r of taken.ready) {
      const g0 = r.group ?? '';
      let g = groups.find((x) => (x.scope.group ?? '') === g0);
      if (!g) {
        g = {
          scope: staff
            ? { department: g0, importId: id, group: g0 }
            : { sectionId: r.group, importId: id, group: g0 },
          label: r.groupLabel ?? (staff ? 'No department' : 'No section'),
          items: [],
        };
        groups.push(g);
      }
      const personId = r.personId!;
      g.items.push({
        student: {
          id: personId,
          name: r.name,
          admissionNo: r.key,
          rollNo: null,
          classLabel: r.groupLabel,
          sectionId: r.group,
          kind: staff ? 'employee' : 'student',
        },
        dto: {
          typeCode: type.code,
          ...(staff ? { employeeId: personId } : { studentId: personId }),
          fields: r.issue.fields,
          person: r.issue.person,
          ...(r.issue.purpose ? { purpose: r.issue.purpose } : {}),
          ...(r.issue.issuedOn ? { issuedOn: r.issue.issuedOn } : {}),
          ...(r.issue.variant ? { variant: r.issue.variant } : {}),
        },
        after: (certificateId: string) => {
          made.set(personId, certificateId);
          return Promise.resolve();
        },
      });
    }
    let batches: Awaited<ReturnType<CertificateBulkService['issueInGroups']>> = [];
    try {
      batches = await this.bulk.issueInGroups(ctx, type, runId, groups, null);
    } finally {
      // whatever happened, each row taken is settled: issued, or back with why
      const skipped = new Map(
        batches.flatMap((b) => b.skipped.map((s) => [s.studentId, s.reason] as const)),
      );
      const numbers = made.size
        ? await this.db.tenant(tenant, async (c) => {
            const q = await c.query<{ id: string; number: string }>(
              `SELECT id::text, number FROM certificates WHERE id = ANY($1::bigint[])`,
              [[...made.values()]],
            );
            return new Map(q.rows.map((x) => [x.id, x.number]));
          })
        : new Map<string, string>();
      await this.db.tenant(tenant, async (c) => {
        const x = await this.load(c, id, true);
        for (const r of x.rows) {
          if (r.status !== 'issuing') continue;
          const cert = r.personId ? made.get(r.personId) : undefined;
          if (cert) {
            r.status = 'issued';
            r.certificateId = cert;
            r.number = numbers.get(cert) ?? null;
            r.problems = [];
          } else {
            r.status = 'attention';
            r.problems = [
              `· ${(r.personId && skipped.get(r.personId)) || 'Not issued: check it again'}`,
            ];
          }
        }
        await this.save(c, id, x.rows, made.size ? runId : null);
        await this.audit.stage(ctx, c, {
          action: 'certificate.import.issue',
          entityType: 'certificate_imports',
          entityId: id,
          after: { runId, issued: made.size, skipped: taken.ready.length - made.size },
        });
      });
    }
    return { runId: made.size ? runId : null, upload: await this.get(ctx, id) };
  }
}
