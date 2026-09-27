import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { parseCsv } from './csv';
import { IMPORT_COLUMNS, type ListImportsQueryDto, type ValidateImportDto } from './imports.dto';

export interface ImportIssue {
  row: number;
  field: string;
  message: string;
}

export interface ImportRow {
  id: string;
  kind: 'students' | 'employees';
  fileName: string | null;
  status: 'validated' | 'committed' | 'failed';
  totalRows: number;
  okRows: number;
  rejectedRows: number;
  report: ImportIssue[];
  requestedBy: string | null;
  createdAt: string;
  committedAt: string | null;
  /** First rows after validation, for the preview table. */
  preview: Array<Record<string, string>>;
}

interface ImportDb {
  id: string;
  kind: ImportRow['kind'];
  file_name: string | null;
  status: ImportRow['status'];
  total_rows: number;
  ok_rows: number;
  rejected_rows: number;
  report: ImportIssue[];
  requested_by: string | null;
  created_at: Date;
  committed_at: Date | null;
  preview: Array<Record<string, string>>;
}

const COLUMNS = `id::text, kind, file_name, status, total_rows, ok_rows, rejected_rows, report, requested_by::text, created_at, committed_at,
  (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT * FROM jsonb_array_elements(payload) LIMIT 20) t(x)) AS preview`;
const toRow = (r: ImportDb): ImportRow => ({
  id: r.id,
  kind: r.kind,
  fileName: r.file_name,
  status: r.status,
  totalRows: r.total_rows,
  okRows: r.ok_rows,
  rejectedRows: r.rejected_rows,
  report: r.report,
  requestedBy: r.requested_by,
  createdAt: r.created_at.toISOString(),
  committedAt: r.committed_at ? r.committed_at.toISOString() : null,
  preview: r.preview,
});

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (v: string): boolean => {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
const MOBILE = /^[6-9]\d{9}$/;
const GENDERS = new Set(['male', 'female', 'other', 'unspecified', '']);
const RELATIONS = new Set(['father', 'mother', 'guardian', 'grandparent', 'sibling', 'other', '']);
const EMPLOYEE_TYPES = new Set(['teaching', 'non_teaching', 'contract', 'visiting', '']);

/**
 * Bulk import framework (S6-05): validate a CSV into a report, then commit the validated rows in one
 * transaction. Nothing is written to people tables until commit, and a file with any rejected row cannot
 * be committed, so a partially imported roll never exists.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: RequestContext,
    q: ListImportsQueryDto,
  ): Promise<{ rows: ImportRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const total = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM imports`);
      const r = await c.query<ImportDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${COLUMNS} FROM imports ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  private async find(c: PoolClient, id: string): Promise<ImportDb | null> {
    const r = await c.query<ImportDb & { payload: Array<Record<string, string>> }>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${COLUMNS}, payload FROM imports WHERE id = $1`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  async get(ctx: RequestContext, id: string): Promise<ImportRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (!row) throw new DomainError('not-found', 'Import not found');
    return toRow(row);
  }

  async validate(ctx: RequestContext, dto: ValidateImportDto): Promise<ImportRow> {
    const tenant = requireTenant(ctx);
    const { header, rows } = parseCsv(dto.csv);
    const spec = IMPORT_COLUMNS[dto.kind];
    const issues: ImportIssue[] = [];
    for (const col of spec.required)
      if (!header.includes(col)) issues.push({ row: 0, field: col, message: 'missing column' });
    const known = new Set<string>([...spec.required, ...spec.optional]);
    for (const col of header)
      if (!known.has(col)) issues.push({ row: 0, field: col, message: 'unknown column ignored' });
    if (rows.length === 0) issues.push({ row: 0, field: '', message: 'no data rows' });

    const records = rows.map((r) => {
      const rec: Record<string, string> = {};
      header.forEach((h, i) => {
        if (known.has(h)) rec[h] = r[i] ?? '';
      });
      return rec;
    });

    return this.db.tenant(tenant, async (c) => {
      const sectionIds = new Map<string, string>();
      if (dto.kind === 'students' && tenant.academicYearId) {
        const s = await c.query<{ label: string; id: string }>(
          `SELECT c.code || '-' || cs.name AS label, cs.id::text AS id FROM class_sections cs JOIN classes c ON c.id = cs.class_id
            WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL`,
          [tenant.academicYearId],
        );
        for (const row of s.rows) sectionIds.set(row.label.toUpperCase(), row.id);
      }
      const keyColumn = dto.kind === 'students' ? 'admission_no' : 'employee_code';
      const keys = records.map((r) => r[keyColumn] ?? '').filter(Boolean);
      const existing = new Set<string>();
      if (keys.length > 0) {
        const table = dto.kind === 'students' ? 'students' : 'employees';
        const e = await c.query<{ k: string }>(
          // eslint-disable-next-line no-restricted-syntax -- table and column are chosen from two constants; values are bound parameters
          `SELECT ${keyColumn} AS k FROM ${table} WHERE ${keyColumn} = ANY($1::text[]) AND deleted_at IS NULL`,
          [keys],
        );
        for (const row of e.rows) existing.add(row.k);
      }

      const seen = new Set<string>();
      const bad = new Set<number>();
      const reject = (row: number, field: string, message: string) => {
        issues.push({ row, field, message });
        bad.add(row);
      };
      records.forEach((rec, i) => {
        const row = i + 2; // 1-based, after the header
        for (const col of spec.required) if (!rec[col]) reject(row, col, 'required');
        const key = rec[keyColumn];
        if (key) {
          if (seen.has(key)) reject(row, keyColumn, 'duplicate in file');
          if (existing.has(key)) reject(row, keyColumn, 'already exists');
          seen.add(key);
        }
        for (const col of ['dob', 'admitted_on', 'joined_on'])
          if (rec[col] && !isDate(rec[col]!)) reject(row, col, 'use a real date as YYYY-MM-DD');
        if (rec.gender !== undefined && !GENDERS.has(rec.gender.toLowerCase()))
          reject(row, 'gender', 'male, female, other or unspecified');
        for (const col of ['guardian_mobile', 'mobile'])
          if (rec[col] && !MOBILE.test(rec[col]!)) reject(row, col, '10 digits starting 6-9');
        if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email))
          reject(row, 'email', 'invalid');
        if (rec.guardian_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.guardian_email))
          reject(row, 'guardian_email', 'invalid');
        if (dto.kind === 'students') {
          if (
            rec.guardian_relation !== undefined &&
            !RELATIONS.has(rec.guardian_relation.toLowerCase())
          )
            reject(
              row,
              'guardian_relation',
              'father, mother, guardian, grandparent, sibling or other',
            );
          if (rec.guardian_name && !rec.guardian_mobile)
            reject(row, 'guardian_mobile', 'required with guardian_name');
          if (rec.section) {
            if (!tenant.academicYearId) reject(row, 'section', 'no working academic year');
            else if (!sectionIds.has(rec.section.toUpperCase()))
              reject(row, 'section', 'unknown section (use CLASS-SECTION, for example VI-A)');
          }
          if (rec.roll_no && !/^\d{1,3}$/.test(rec.roll_no)) reject(row, 'roll_no', 'number');
        } else if (
          rec.employee_type !== undefined &&
          !EMPLOYEE_TYPES.has(rec.employee_type.toLowerCase())
        )
          reject(row, 'employee_type', 'teaching, non_teaching, contract or visiting');
      });

      const structural = issues.some((x) => x.row === 0 && x.message !== 'unknown column ignored');
      const okRows = structural ? 0 : records.length - bad.size;
      const r = await c.query<ImportDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `INSERT INTO imports (school_id, kind, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1::import_kind, $2, $3::import_status, $4, $5, $6, $7::jsonb, $8::jsonb, app.current_user_id(), app.current_request_id())
         RETURNING ${COLUMNS}`,
        [
          dto.kind,
          dto.fileName ?? null,
          structural ? 'failed' : 'validated',
          records.length,
          okRows,
          structural ? records.length : bad.size,
          JSON.stringify(issues),
          JSON.stringify(structural ? [] : records),
        ],
      );
      return toRow(r.rows[0]!);
    });
  }

  async commit(ctx: RequestContext, id: string): Promise<ImportRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const imp = await this.find(c, id);
      if (!imp) throw new DomainError('not-found', 'Import not found');
      if (imp.status !== 'validated')
        throw new DomainError('import.not_validated', 'Only a validated import can be committed', {
          status: 409,
        });
      if (imp.rejected_rows > 0)
        throw new DomainError(
          'import.has_rejects',
          'Fix the rejected rows and upload the file again before committing',
          { status: 409 },
        );
      const payload = (imp as ImportDb & { payload: Array<Record<string, string>> }).payload;
      if (imp.kind === 'students') await this.commitStudents(c, tenant, payload);
      else await this.commitEmployees(c, payload);
      const r = await c.query<ImportDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `UPDATE imports SET status = 'committed', committed_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id],
      );
      const after = toRow(r.rows[0]!);
      await this.audit.stage(ctx, c, {
        action: `people.import.commit`,
        entityType: 'imports',
        entityId: id,
        after: { kind: after.kind, rows: after.okRows, fileName: after.fileName },
      });
      return after;
    });
  }

  private async commitStudents(
    c: PoolClient,
    tenant: TenantContext,
    rows: Array<Record<string, string>>,
  ): Promise<void> {
    const sectionIds = new Map<string, string>();
    if (tenant.academicYearId) {
      const s = await c.query<{ label: string; id: string }>(
        `SELECT c.code || '-' || cs.name AS label, cs.id::text AS id FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL`,
        [tenant.academicYearId],
      );
      for (const row of s.rows) sectionIds.set(row.label.toUpperCase(), row.id);
    }
    for (const r of rows) {
      const s = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, blood_group, house, admitted_on, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6, $7, $8, $9::date, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          r.admission_no,
          r.first_name,
          r.last_name || null,
          r.dob || null,
          (r.gender || 'unspecified').toLowerCase(),
          r.category || null,
          r.blood_group || null,
          r.house || null,
          r.admitted_on || null,
        ],
      );
      const studentId = s.rows[0]!.id;
      if (r.guardian_name && r.guardian_mobile) {
        const found = await c.query<{ id: string }>(
          `SELECT id::text FROM guardians WHERE mobile = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1`,
          [r.guardian_mobile],
        );
        let guardianId = found.rows[0]?.id;
        if (!guardianId) {
          const [first, ...rest] = r.guardian_name.split(/\s+/);
          const g = await c.query<{ id: string }>(
            `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, created_by, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
            [first, rest.join(' ') || null, r.guardian_mobile, r.guardian_email || null],
          );
          guardianId = g.rows[0]!.id;
        }
        await c.query(
          `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, created_by)
           VALUES (app.current_school_id(), $1, $2, $3::guardian_relation, true, app.current_user_id())`,
          [studentId, guardianId, (r.guardian_relation || 'guardian').toLowerCase()],
        );
      }
      const sectionId = r.section ? sectionIds.get(r.section.toUpperCase()) : undefined;
      if (sectionId && tenant.academicYearId) {
        await c.query(
          `SELECT app.enrol_student($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))`,
          [
            studentId,
            tenant.academicYearId,
            sectionId,
            r.roll_no ? Number(r.roll_no) : null,
            r.admitted_on || null,
          ],
        );
      }
    }
  }

  private async commitEmployees(c: PoolClient, rows: Array<Record<string, string>>): Promise<void> {
    for (const r of rows) {
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, dob, gender, employee_type, designation, department, joined_on, mobile, email, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6::employee_type, $7, $8, $9::date, $10, $11, app.current_user_id(), app.current_user_id())`,
        [
          r.employee_code,
          r.first_name,
          r.last_name || null,
          r.dob || null,
          (r.gender || 'unspecified').toLowerCase(),
          (r.employee_type || 'teaching').toLowerCase(),
          r.designation || null,
          r.department || null,
          r.joined_on || null,
          r.mobile || null,
          r.email || null,
        ],
      );
    }
  }
}
