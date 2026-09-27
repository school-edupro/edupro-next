import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { ReportsService } from '../reports/reports.service';
import type {
  AddDocumentDto,
  CreateStudentDto,
  EnrolDto,
  LinkGuardianDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from './people.dto';
import { PEOPLE } from './people.permissions';

export interface StudentRow {
  id: string;
  admissionNo: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  dob: string | null;
  gender: string;
  category: string | null;
  bloodGroup: string | null;
  house: string | null;
  admittedOn: string | null;
  leftOn: string | null;
  photoFileId: string | null;
  address: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'active' | 'inactive';
  updatedAt: string;
  /** Current enrolment in the working year, when any. */
  enrolment: EnrolmentRow | null;
}

export interface EnrolmentRow {
  id: string;
  academicYearId: string;
  academicYear: string;
  classSectionId: string;
  classCode: string;
  className: string;
  section: string;
  rollNo: number | null;
  status: string;
  joinedOn: string;
  endedOn: string | null;
}

export interface GuardianLink {
  linkId: string;
  guardianId: string;
  displayName: string;
  mobile: string | null;
  email: string | null;
  occupation: string | null;
  relation: string;
  isPrimary: boolean;
  receivesNotifications: boolean;
}

export interface DocumentRow {
  id: string;
  kind: string;
  fileId: string;
  fileName: string | null;
  contentType: string;
  title: string | null;
  number: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  verifiedAt: string | null;
}

interface StudentDbRow {
  id: string;
  admission_no: string;
  first_name: string;
  last_name: string | null;
  display_name: string;
  dob: string | null;
  gender: string;
  category: string | null;
  blood_group: string | null;
  house: string | null;
  admitted_on: string | null;
  left_on: string | null;
  photo_file_id: string | null;
  address: Record<string, unknown>;
  details: Record<string, unknown>;
  status: 'active' | 'inactive';
  updated_at: Date;
  enrolment_id: string | null;
  academic_year_id: string | null;
  academic_year: string | null;
  class_section_id: string | null;
  class_code: string | null;
  class_name: string | null;
  section: string | null;
  roll_no: number | null;
  enrolment_status: string | null;
  joined_on: string | null;
  ended_on: string | null;
}

const STUDENT_SELECT =
  'SELECT s.id::text, s.admission_no, s.first_name, s.last_name, s.display_name, s.dob::text, s.gender::text, s.category, s.blood_group, s.house,' +
  ' s.admitted_on::text, s.left_on::text, s.photo_file_id::text, s.address, s.details, s.status::text, s.updated_at,' +
  ' e.id::text AS enrolment_id, e.academic_year_id::text, y.code AS academic_year, e.class_section_id::text, c.code AS class_code, c.name AS class_name,' +
  ' cs.name AS section, e.roll_no, e.status::text AS enrolment_status, e.joined_on::text, e.ended_on::text' +
  ' FROM students s' +
  " LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'" +
  ' LEFT JOIN class_sections cs ON cs.id = e.class_section_id' +
  ' LEFT JOIN classes c ON c.id = cs.class_id' +
  ' LEFT JOIN academic_years y ON y.id = e.academic_year_id';

const toStudent = (x: StudentDbRow): StudentRow => ({
  id: x.id,
  admissionNo: x.admission_no,
  firstName: x.first_name,
  lastName: x.last_name,
  displayName: x.display_name,
  dob: x.dob,
  gender: x.gender,
  category: x.category,
  bloodGroup: x.blood_group,
  house: x.house,
  admittedOn: x.admitted_on,
  leftOn: x.left_on,
  photoFileId: x.photo_file_id,
  address: x.address,
  details: x.details,
  status: x.status,
  updatedAt: x.updated_at.toISOString(),
  enrolment: x.enrolment_id
    ? {
        id: x.enrolment_id,
        academicYearId: x.academic_year_id!,
        academicYear: x.academic_year!,
        classSectionId: x.class_section_id!,
        classCode: x.class_code!,
        className: x.class_name!,
        section: x.section!,
        rollNo: x.roll_no,
        status: x.enrolment_status!,
        joinedOn: x.joined_on!,
        endedOn: x.ended_on,
      }
    : null,
});

/**
 * Students, their guardians, enrolments and documents (S4-02, S4-04). Every mutation stages its audit row in
 * the same transaction. Class teachers see only students enrolled in their scoped sections.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly audit: AuditService,
    private readonly files: FilesService,
    private readonly reports: ReportsService,
  ) {}

  /** Section ids the caller may see, or null when unrestricted. */
  private scopeFilter(tenant: TenantContext): Promise<string[] | null> {
    return this.scopes.filter(tenant, PEOPLE.studentView, 'class_section');
  }

  async list(
    ctx: RequestContext,
    q: ListStudentsQueryDto,
  ): Promise<{ rows: StudentRow[]; total: number }> {
    const tenant = requireTenant(ctx);
    const allowed = await this.scopeFilter(tenant);
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE s.deleted_at IS NULL' +
        " AND ($1::text IS NULL OR s.search_text LIKE app.search_text($1::text) || '%' OR s.search_text % app.search_text($1::text) OR lower(s.admission_no) = lower($1::text))" +
        ' AND ($2::bigint IS NULL OR e.class_section_id = $2::bigint)' +
        ' AND ($3::row_status IS NULL OR s.status = $3::row_status)' +
        ' AND ($4::bigint[] IS NULL OR e.class_section_id = ANY($4::bigint[]))';
      const params: unknown[] = [q.q ?? null, q.classSectionId ?? null, q.status ?? null, allowed];
      const total = await c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM students s LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'" +
          where,
        params,
      );
      const r = await c.query<StudentDbRow>(
        STUDENT_SELECT +
          where +
          ' ORDER BY c.display_order NULLS LAST, cs.name, e.roll_no NULLS LAST, s.display_name LIMIT $5 OFFSET $6',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toStudent), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async find(tenant: TenantContext, id: string, client?: PoolClient): Promise<StudentRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<StudentDbRow>(
        STUDENT_SELECT + ' WHERE s.id = $1 AND s.deleted_at IS NULL',
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Student not found');
      return toStudent(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  /** The 360 view: record, guardians, enrolment history, documents and siblings. */
  async get(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const allowed = await this.scopeFilter(tenant);
    return this.db.tenant(tenant, async (c) => {
      const student = await this.find(tenant, id, c);
      if (
        allowed !== null &&
        (!student.enrolment || !allowed.includes(student.enrolment.classSectionId))
      ) {
        throw new DomainError('not-found', 'Student not found');
      }
      const guardians = await this.guardiansOf(c, id);
      const enrolments = await c.query<{
        id: string;
        academic_year_id: string;
        academic_year: string;
        class_section_id: string;
        class_code: string;
        class_name: string;
        section: string;
        roll_no: number | null;
        status: string;
        joined_on: string;
        ended_on: string | null;
      }>(
        `SELECT e.id::text, e.academic_year_id::text, y.code AS academic_year, e.class_section_id::text, c.code AS class_code, c.name AS class_name,
                cs.name AS section, e.roll_no, e.status::text, e.joined_on::text, e.ended_on::text
           FROM enrolments e
           JOIN academic_years y ON y.id = e.academic_year_id
           JOIN class_sections cs ON cs.id = e.class_section_id
           JOIN classes c ON c.id = cs.class_id
          WHERE e.student_id = $1 ORDER BY y.start_date DESC`,
        [id],
      );
      const documents = await this.documentsOf(c, 'student', id);
      const siblings = await c.query<{ id: string; display_name: string; admission_no: string }>(
        `SELECT DISTINCT s.id::text, s.display_name, s.admission_no FROM student_siblings ss JOIN students s ON s.id = ss.sibling_id
          WHERE ss.student_id = $1 AND s.deleted_at IS NULL ORDER BY s.display_name`,
        [id],
      );
      return {
        ...student,
        guardians,
        enrolments: enrolments.rows.map((e) => ({
          id: e.id,
          academicYearId: e.academic_year_id,
          academicYear: e.academic_year,
          classSectionId: e.class_section_id,
          classCode: e.class_code,
          className: e.class_name,
          section: e.section,
          rollNo: e.roll_no,
          status: e.status,
          joinedOn: e.joined_on,
          endedOn: e.ended_on,
        })),
        documents,
        siblings: siblings.rows.map((s) => ({
          id: s.id,
          displayName: s.display_name,
          admissionNo: s.admission_no,
        })),
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateStudentDto): Promise<StudentRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, dob, gender, category, blood_group, house, admitted_on, address, details, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::date, $5::gender, $6, $7, $8, $9::date, $10::jsonb, $11::jsonb, app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          dto.admissionNo,
          dto.firstName,
          dto.lastName ?? null,
          dto.dob ?? null,
          dto.gender,
          dto.category ?? null,
          dto.bloodGroup ?? null,
          dto.house ?? null,
          dto.admittedOn ?? null,
          JSON.stringify(dto.address),
          JSON.stringify(dto.details),
        ],
      );
      const id = r.rows[0]!.id;
      for (const g of dto.guardians) await this.link(c, id, g);
      if (dto.enrolment) await this.enrolWith(c, tenant, id, dto.enrolment);
      const created = await this.find(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'people.student.create',
        entityType: 'students',
        entityId: id,
        after: created,
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateStudentDto): Promise<StudentRow> {
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
      if (dto.category !== undefined) set('category', dto.category);
      if (dto.bloodGroup !== undefined) set('blood_group', dto.bloodGroup);
      if (dto.house !== undefined) set('house', dto.house);
      if (dto.admittedOn !== undefined) set('admitted_on', dto.admittedOn, '::date');
      if (dto.leftOn !== undefined) set('left_on', dto.leftOn, '::date');
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      if (dto.photoFileId !== undefined) {
        if (dto.photoFileId) await this.files.get(ctx, dto.photoFileId); // must exist in this school
        set('photo_file_id', dto.photoFileId);
      }
      if (dto.address !== undefined) set('address', JSON.stringify(dto.address), '::jsonb');
      if (dto.details !== undefined) set('details', JSON.stringify(dto.details), '::jsonb');
      params.push(id);
      await c.query(
        'UPDATE students SET ' +
          sets.join(', ') +
          ' WHERE id = $' +
          String(params.length) +
          ' AND deleted_at IS NULL',
        params,
      );
      const after = await this.find(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: 'people.student.edit',
        entityType: 'students',
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
      const live = await c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM enrolments WHERE student_id = $1 AND status = 'active'",
        [id],
      );
      if (Number(live.rows[0]?.n ?? 0) > 0) {
        throw new DomainError(
          'people.student.enrolled',
          'End the active enrolment before removing the student',
          { status: 409 },
        );
      }
      await c.query(
        "UPDATE students SET deleted_at = now(), status = 'inactive', updated_by = app.current_user_id() WHERE id = $1",
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.student.delete',
        entityType: 'students',
        entityId: id,
        before,
      });
    });
  }

  // ---- guardians -----------------------------------------------------------------------------------
  private async guardiansOf(c: PoolClient, studentId: string): Promise<GuardianLink[]> {
    const r = await c.query<{
      link_id: string;
      guardian_id: string;
      display_name: string;
      mobile: string | null;
      email: string | null;
      occupation: string | null;
      relation: string;
      is_primary: boolean;
      receives_notifications: boolean;
    }>(
      `SELECT sg.id::text AS link_id, g.id::text AS guardian_id, g.display_name, g.mobile, g.email::text, g.occupation, sg.relation::text, sg.is_primary, sg.receives_notifications
         FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
        WHERE sg.student_id = $1 AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, g.display_name`,
      [studentId],
    );
    return r.rows.map((x) => ({
      linkId: x.link_id,
      guardianId: x.guardian_id,
      displayName: x.display_name,
      mobile: x.mobile,
      email: x.email,
      occupation: x.occupation,
      relation: x.relation,
      isPrimary: x.is_primary,
      receivesNotifications: x.receives_notifications,
    }));
  }

  private async link(c: PoolClient, studentId: string, dto: LinkGuardianDto): Promise<string> {
    let guardianId = dto.guardianId;
    if (!guardianId) {
      const g = dto.guardian!;
      // Reuse a guardian of this school with the same mobile (siblings share a guardian).
      const existing = g.mobile
        ? await c.query<{ id: string }>(
            'SELECT id::text FROM guardians WHERE mobile = $1 AND deleted_at IS NULL ORDER BY id LIMIT 1',
            [g.mobile],
          )
        : { rows: [] as Array<{ id: string }> };
      if (existing.rows[0]) guardianId = existing.rows[0].id;
      else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO guardians (school_id, first_name, last_name, mobile, email, occupation, address, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [
            g.firstName,
            g.lastName ?? null,
            g.mobile ?? null,
            g.email ?? null,
            g.occupation ?? null,
            JSON.stringify(g.address),
          ],
        );
        guardianId = r.rows[0]!.id;
      }
    } else {
      const ok = await c.query('SELECT 1 FROM guardians WHERE id = $1 AND deleted_at IS NULL', [
        guardianId,
      ]);
      if ((ok.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Guardian not found');
    }
    if (dto.isPrimary)
      await c.query('UPDATE student_guardians SET is_primary = false WHERE student_id = $1', [
        studentId,
      ]);
    await c.query(
      `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary, receives_notifications, created_by)
       VALUES (app.current_school_id(), $1, $2, $3::guardian_relation, $4, $5, app.current_user_id())
       ON CONFLICT (student_id, guardian_id) DO UPDATE SET relation = EXCLUDED.relation, is_primary = EXCLUDED.is_primary, receives_notifications = EXCLUDED.receives_notifications`,
      [studentId, guardianId, dto.relation, dto.isPrimary, dto.receivesNotifications],
    );
    return guardianId;
  }

  async linkGuardian(
    ctx: RequestContext,
    studentId: string,
    dto: LinkGuardianDto,
  ): Promise<GuardianLink[]> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      await this.find(tenant, studentId, c);
      const guardianId = await this.link(c, studentId, dto);
      const after = await this.guardiansOf(c, studentId);
      await this.audit.stage(ctx, c, {
        action: 'people.guardian.link',
        entityType: 'student_guardians',
        entityId: studentId,
        after: { studentId, guardianId, relation: dto.relation, isPrimary: dto.isPrimary },
      });
      return after;
    });
  }

  async unlinkGuardian(
    ctx: RequestContext,
    studentId: string,
    guardianId: string,
  ): Promise<GuardianLink[]> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query(
        'DELETE FROM student_guardians WHERE student_id = $1 AND guardian_id = $2',
        [studentId, guardianId],
      );
      if ((r.rowCount ?? 0) === 0) throw new DomainError('not-found', 'Guardian link not found');
      await this.audit.stage(ctx, c, {
        action: 'people.guardian.unlink',
        entityType: 'student_guardians',
        entityId: studentId,
        before: { studentId, guardianId },
      });
      return this.guardiansOf(c, studentId);
    });
  }

  // ---- enrolments ----------------------------------------------------------------------------------
  private async enrolWith(
    c: PoolClient,
    tenant: TenantContext,
    studentId: string,
    dto: EnrolDto,
  ): Promise<string> {
    const yearId = dto.academicYearId ?? tenant.academicYearId;
    if (!yearId)
      throw new DomainError(
        'validation-failed',
        'academicYearId is required when no working year is selected',
        { status: 400 },
      );
    const r = await c.query<{ id: string }>(
      'SELECT app.enrol_student($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))::text AS id',
      [studentId, yearId, dto.classSectionId, dto.rollNo ?? null, dto.joinedOn ?? null],
    );
    return r.rows[0]!.id;
  }

  async enrol(ctx: RequestContext, studentId: string, dto: EnrolDto): Promise<StudentRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(tenant, studentId, c);
      const enrolmentId = await this.enrolWith(c, tenant, studentId, dto);
      const after = await this.find(tenant, studentId, c);
      await this.audit.stage(ctx, c, {
        action: 'people.enrolment.set',
        entityType: 'enrolments',
        entityId: enrolmentId,
        before: before.enrolment,
        after: after.enrolment,
      });
      return after;
    });
  }

  // ---- documents -----------------------------------------------------------------------------------
  private async documentsOf(
    c: PoolClient,
    personType: 'student' | 'employee' | 'guardian',
    personId: string,
  ): Promise<DocumentRow[]> {
    const r = await c.query<{
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
        WHERE d.person_type = $1::person_type AND d.person_id = $2 AND d.deleted_at IS NULL ORDER BY d.created_at DESC`,
      [personType, personId],
    );
    return r.rows.map((x) => ({
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
    }));
  }

  async addDocument(
    ctx: RequestContext,
    studentId: string,
    dto: AddDocumentDto,
  ): Promise<DocumentRow[]> {
    const tenant = requireTenant(ctx);
    const file = await this.files.get(ctx, dto.fileId);
    if (file.status !== 'ready')
      throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
        status: 409,
      });
    return this.db.tenant(tenant, async (c) => {
      await this.find(tenant, studentId, c);
      const r = await c.query<{ id: string }>(
        `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, number, issued_on, expires_on, created_by)
         VALUES (app.current_school_id(), 'student', $1, $2::document_kind, $3, $4, $5, $6::date, $7::date, app.current_user_id()) RETURNING id::text`,
        [
          studentId,
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
          'UPDATE students SET photo_file_id = $2, updated_by = app.current_user_id() WHERE id = $1',
          [studentId, dto.fileId],
        );
      await this.audit.stage(ctx, c, {
        action: 'people.document.add',
        entityType: 'person_documents',
        entityId: r.rows[0]!.id,
        after: {
          personType: 'student',
          personId: studentId,
          kind: dto.kind,
          fileId: dto.fileId,
          number: dto.number ?? null,
        },
      });
      return this.documentsOf(c, 'student', studentId);
    });
  }

  /** ID card as a rendered export (S4-04); the export centre serves the PDF. */
  async requestIdCard(ctx: RequestContext, studentId: string) {
    const tenant = requireTenant(ctx);
    const student = await this.find(tenant, studentId);
    return this.reports.create(
      ctx,
      {
        dataset: 'student_id_card',
        format: 'pdf',
        params: { studentId },
        title: `ID card ${student.admissionNo}`,
      },
      'people.student.id_card',
    );
  }
}
