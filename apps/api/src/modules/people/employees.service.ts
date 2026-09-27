import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { ReportsService } from '../reports/reports.service';
import type {
  AddDocumentDto,
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
  UpsertPostingDto,
} from './people.dto';

export interface PostingRow {
  id: string;
  academicYearId: string;
  academicYear: string;
  campusId: string | null;
  campus: string | null;
  department: string | null;
  designation: string | null;
  reportsToEmployeeId: string | null;
  reportsTo: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  dob: string | null;
  gender: string;
  employeeType: string;
  designation: string | null;
  department: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  mobile: string | null;
  email: string | null;
  photoFileId: string | null;
  address: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'active' | 'inactive';
  updatedAt: string;
  posting: PostingRow | null;
}

interface EmployeeDbRow {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string | null;
  display_name: string;
  dob: string | null;
  gender: string;
  employee_type: string;
  designation: string | null;
  department: string | null;
  joined_on: string | null;
  left_on: string | null;
  mobile: string | null;
  email: string | null;
  photo_file_id: string | null;
  address: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'active' | 'inactive';
  updated_at: Date;
  posting_id: string | null;
  academic_year_id: string | null;
  academic_year: string | null;
  campus_id: string | null;
  campus: string | null;
  p_department: string | null;
  p_designation: string | null;
  reports_to_employee_id: string | null;
  reports_to: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

const SELECT =
  'SELECT em.id::text, em.employee_code, em.first_name, em.last_name, em.display_name, em.dob::text, em.gender::text, em.employee_type::text, em.designation, em.department,' +
  ' em.joined_on::text, em.left_on::text, em.mobile, em.email::text, em.photo_file_id::text, em.address, em.details, em.status::text, em.updated_at,' +
  ' p.id::text AS posting_id, p.academic_year_id::text, y.code AS academic_year, p.campus_id::text, ca.name AS campus, p.department AS p_department,' +
  ' p.designation AS p_designation, p.reports_to_employee_id::text, mgr.display_name AS reports_to, p.valid_from::text, p.valid_to::text' +
  ' FROM employees em' +
  ' LEFT JOIN postings p ON p.employee_id = em.id AND p.academic_year_id = app.current_academic_year_id()' +
  ' LEFT JOIN academic_years y ON y.id = p.academic_year_id' +
  ' LEFT JOIN campuses ca ON ca.id = p.campus_id' +
  ' LEFT JOIN employees mgr ON mgr.id = p.reports_to_employee_id';

const toRow = (x: EmployeeDbRow): EmployeeRow => ({
  id: x.id,
  employeeCode: x.employee_code,
  firstName: x.first_name,
  lastName: x.last_name,
  displayName: x.display_name,
  dob: x.dob,
  gender: x.gender,
  employeeType: x.employee_type,
  designation: x.designation,
  department: x.department,
  joinedOn: x.joined_on,
  leftOn: x.left_on,
  mobile: x.mobile,
  email: x.email,
  photoFileId: x.photo_file_id,
  address: x.address,
  details: x.details,
  status: x.status,
  updatedAt: x.updated_at.toISOString(),
  posting: x.posting_id
    ? {
        id: x.posting_id,
        academicYearId: x.academic_year_id!,
        academicYear: x.academic_year!,
        campusId: x.campus_id,
        campus: x.campus,
        department: x.p_department,
        designation: x.p_designation,
        reportsToEmployeeId: x.reports_to_employee_id,
        reportsTo: x.reports_to,
        validFrom: x.valid_from!,
        validTo: x.valid_to,
      }
    : null,
});

/** Employees and their per-year postings (S4-03), documents and ID cards (S4-04). */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly reports: ReportsService,
  ) {}

  list(
    tenant: TenantContext,
    q: ListEmployeesQueryDto,
  ): Promise<{ rows: EmployeeRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE em.deleted_at IS NULL' +
        " AND ($1::text IS NULL OR em.search_text LIKE app.search_text($1::text) || '%' OR em.search_text % app.search_text($1::text) OR lower(em.employee_code) = lower($1::text))" +
        ' AND ($2::employee_type IS NULL OR em.employee_type = $2::employee_type)' +
        ' AND ($3::row_status IS NULL OR em.status = $3::row_status)';
      const params: unknown[] = [q.q ?? null, q.employeeType ?? null, q.status ?? null];
      const total = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM employees em' + where,
        params,
      );
      const r = await c.query<EmployeeDbRow>(
        SELECT + where + ' ORDER BY em.display_name LIMIT $4 OFFSET $5',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async find(tenant: TenantContext, id: string, client?: PoolClient): Promise<EmployeeRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<EmployeeDbRow>(
        SELECT + ' WHERE em.id = $1 AND em.deleted_at IS NULL',
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Employee not found');
      return toRow(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async get(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const employee = await this.find(tenant, id, c);
      const postings = await c.query<{
        id: string;
        academic_year_id: string;
        academic_year: string;
        campus_id: string | null;
        campus: string | null;
        department: string | null;
        designation: string | null;
        reports_to_employee_id: string | null;
        reports_to: string | null;
        valid_from: string;
        valid_to: string | null;
      }>(
        `SELECT p.id::text, p.academic_year_id::text, y.code AS academic_year, p.campus_id::text, ca.name AS campus, p.department, p.designation,
                p.reports_to_employee_id::text, mgr.display_name AS reports_to, p.valid_from::text, p.valid_to::text
           FROM postings p JOIN academic_years y ON y.id = p.academic_year_id
           LEFT JOIN campuses ca ON ca.id = p.campus_id LEFT JOIN employees mgr ON mgr.id = p.reports_to_employee_id
          WHERE p.employee_id = $1 ORDER BY y.start_date DESC`,
        [id],
      );
      const documents = await c.query<{
        id: string;
        kind: string;
        file_id: string;
        file_name: string | null;
        content_type: string;
        title: string | null;
        number: string | null;
        issued_on: string | null;
        expires_on: string | null;
        verified_at: Date | null;
      }>(
        `SELECT d.id::text, d.kind::text, d.file_id::text, f.original_name AS file_name, f.content_type, d.title, d.number, d.issued_on::text, d.expires_on::text, d.verified_at
           FROM person_documents d JOIN files f ON f.id = d.file_id
          WHERE d.person_type = 'employee' AND d.person_id = $1 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
        [id],
      );
      const reports = await c.query<{
        id: string;
        display_name: string;
        designation: string | null;
      }>(
        `SELECT em.id::text, em.display_name, em.designation FROM postings p JOIN employees em ON em.id = p.employee_id
          WHERE p.reports_to_employee_id = $1 AND p.academic_year_id = app.current_academic_year_id() AND em.deleted_at IS NULL ORDER BY em.display_name`,
        [id],
      );
      return {
        ...employee,
        postings: postings.rows.map((p) => ({
          id: p.id,
          academicYearId: p.academic_year_id,
          academicYear: p.academic_year,
          campusId: p.campus_id,
          campus: p.campus,
          department: p.department,
          designation: p.designation,
          reportsToEmployeeId: p.reports_to_employee_id,
          reportsTo: p.reports_to,
          validFrom: p.valid_from,
          validTo: p.valid_to,
        })),
        documents: documents.rows.map((x) => ({
          id: x.id,
          kind: x.kind,
          fileId: x.file_id,
          fileName: x.file_name,
          contentType: x.content_type,
          title: x.title,
          number: x.number,
          issuedOn: x.issued_on,
          expiresOn: x.expires_on,
          verifiedAt: x.verified_at ? x.verified_at.toISOString() : null,
        })),
        directReports: reports.rows.map((r) => ({
          id: r.id,
          displayName: r.display_name,
          designation: r.designation,
        })),
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateEmployeeDto): Promise<EmployeeRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, dob, gender, employee_type, designation, department, joined_on, mobile, email, address, details, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6::employee_type, $7, $8, $9::date, $10, $11, $12::jsonb, $13::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.employeeCode,
          dto.firstName,
          dto.lastName ?? null,
          dto.dob ?? null,
          dto.gender,
          dto.employeeType,
          dto.designation ?? null,
          dto.department ?? null,
          dto.joinedOn ?? null,
          dto.mobile ?? null,
          dto.email ?? null,
          JSON.stringify(dto.address),
          JSON.stringify(dto.details),
        ],
      );
      const id = r.rows[0]!.id;
      if (dto.posting)
        await this.upsert(c, tenant, id, {
          department: dto.department,
          designation: dto.designation,
          ...dto.posting,
        });
      const created = await this.find(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'people.employee.create',
        entityType: 'employees',
        entityId: id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateEmployeeDto): Promise<EmployeeRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(tenant, id, c);
      const sets: string[] = ['updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(col + ' = $' + String(params.length) + cast);
      };
      if (dto.firstName !== undefined) set('first_name', dto.firstName);
      if (dto.lastName !== undefined) set('last_name', dto.lastName);
      if (dto.dob !== undefined) set('dob', dto.dob, '::date');
      if (dto.gender !== undefined) set('gender', dto.gender, '::gender');
      if (dto.employeeType !== undefined) set('employee_type', dto.employeeType, '::employee_type');
      if (dto.designation !== undefined) set('designation', dto.designation);
      if (dto.department !== undefined) set('department', dto.department);
      if (dto.joinedOn !== undefined) set('joined_on', dto.joinedOn, '::date');
      if (dto.leftOn !== undefined) set('left_on', dto.leftOn, '::date');
      if (dto.mobile !== undefined) set('mobile', dto.mobile);
      if (dto.email !== undefined) set('email', dto.email);
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      if (dto.photoFileId !== undefined) {
        if (dto.photoFileId) await this.files.get(ctx, dto.photoFileId);
        set('photo_file_id', dto.photoFileId);
      }
      if (dto.address !== undefined) set('address', JSON.stringify(dto.address), '::jsonb');
      if (dto.details !== undefined) set('details', JSON.stringify(dto.details), '::jsonb');
      params.push(id);
      await c.query(
        'UPDATE employees SET ' +
          sets.join(', ') +
          ' WHERE id = $' +
          String(params.length) +
          ' AND deleted_at IS NULL',
        params,
      );
      const after = await this.find(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'people.employee.edit',
        entityType: 'employees',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const before = await this.find(tenant, id, c);
      await c.query(
        "UPDATE employees SET deleted_at = now(), status = 'inactive', updated_by = app.current_user_id() WHERE id = $1",
        [id],
      );
      await c.query(
        'UPDATE postings SET valid_to = LEAST(COALESCE(valid_to, CURRENT_DATE), CURRENT_DATE) WHERE employee_id = $1 AND (valid_to IS NULL OR valid_to > CURRENT_DATE)',
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.employee.delete',
        entityType: 'employees',
        entityId: id,
        before,
      });
    });
  }

  private async upsert(
    c: PoolClient,
    tenant: TenantContext,
    employeeId: string,
    dto: UpsertPostingDto,
  ): Promise<string> {
    const yearId = dto.academicYearId ?? tenant.academicYearId;
    if (!yearId)
      throw new DomainError(
        'validation-failed',
        'academicYearId is required when no working year is selected',
        { status: 400 },
      );
    if (dto.reportsToEmployeeId) {
      if (dto.reportsToEmployeeId === employeeId)
        throw new DomainError('validation-failed', 'An employee cannot report to themselves', {
          status: 400,
        });
      const mgr = await c.query('SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL', [
        dto.reportsToEmployeeId,
      ]);
      if ((mgr.rowCount ?? 0) === 0)
        throw new DomainError('not-found', 'Reporting manager not found');
    }
    const r = await c.query<{ id: string }>(
      `INSERT INTO postings (school_id, employee_id, academic_year_id, campus_id, department, designation, reports_to_employee_id, valid_from, valid_to, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8::date, app.current_user_id(), app.current_user_id())
       ON CONFLICT (employee_id, academic_year_id) DO UPDATE
         SET campus_id = COALESCE(EXCLUDED.campus_id, postings.campus_id), department = COALESCE(EXCLUDED.department, postings.department),
             designation = COALESCE(EXCLUDED.designation, postings.designation), reports_to_employee_id = COALESCE(EXCLUDED.reports_to_employee_id, postings.reports_to_employee_id),
             valid_from = COALESCE($7::date, postings.valid_from), valid_to = $8::date, updated_at = now(), updated_by = app.current_user_id()
       RETURNING id::text`,
      [
        employeeId,
        yearId,
        dto.campusId ?? null,
        dto.department ?? null,
        dto.designation ?? null,
        dto.reportsToEmployeeId ?? null,
        dto.validFrom ?? null,
        dto.validTo ?? null,
      ],
    );
    return r.rows[0]!.id;
  }

  async upsertPosting(
    ctx: RequestContext,
    employeeId: string,
    dto: UpsertPostingDto,
  ): Promise<EmployeeRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(tenant, employeeId, c);
      const postingId = await this.upsert(c, tenant, employeeId, dto);
      const after = await this.find(tenant, employeeId, c);
      await this.audit.stage(ctx, c, {
        action: 'people.posting.set',
        entityType: 'postings',
        entityId: postingId,
        before: before.posting,
        after: after.posting,
      });
      return after;
    });
  }

  async addDocument(ctx: RequestContext, employeeId: string, dto: AddDocumentDto) {
    const tenant = requireTenant(ctx);
    const file = await this.files.get(ctx, dto.fileId);
    if (file.status !== 'ready')
      throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      await this.find(tenant, employeeId, c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, number, issued_on, expires_on, created_by)
         VALUES (app.current_school_id(), 'employee', $1, $2::document_kind, $3, $4, $5, $6::date, $7::date, app.current_user_id()) RETURNING id::text`,
        [
          employeeId,
          dto.kind,
          dto.fileId,
          dto.title ?? null,
          dto.number ?? null,
          dto.issuedOn ?? null,
          dto.expiresOn ?? null,
        ],
      );
      if (dto.kind === 'photo')
        await c.query(
          'UPDATE employees SET photo_file_id = $2, updated_by = app.current_user_id() WHERE id = $1',
          [employeeId, dto.fileId],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.document.add',
        entityType: 'person_documents',
        entityId: r.rows[0]!.id,
        after: {
          personType: 'employee',
          personId: employeeId,
          kind: dto.kind,
          fileId: dto.fileId,
          number: dto.number ?? null,
        },
      });
      return (await this.get(ctx, employeeId)).documents;
    });
  }

  async requestIdCard(ctx: RequestContext, employeeId: string) {
    const tenant = requireTenant(ctx);
    const employee = await this.find(tenant, employeeId);
    return this.reports.create(
      ctx,
      {
        dataset: 'employee_id_card',
        format: 'pdf',
        params: { employeeId },
        title: `ID card ${employee.employeeCode}`,
      },
      'people.employee.id_card',
    );
  }
}
