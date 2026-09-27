import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { AccessService } from '../../access/access.service';
import type { CreateTeacherAssignmentDto, ListTeacherAssignmentsQueryDto } from './academics.dto';
import { ACADEMICS } from './academics.permissions';

export interface TeacherAssignmentRow {
  id: string;
  academicYearId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId: string | null;
  classSectionId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  kind: 'class_teacher' | 'subject_teacher' | 'coordinator' | 'indicator';
  canMarkAttendance: boolean;
  canPostHomework: boolean;
  canAnswerQueries: boolean;
  validFrom: string;
  validTo: string | null;
}

interface AssignmentDb {
  id: string;
  academic_year_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  user_id: string | null;
  class_section_id: string;
  class_code: string;
  section: string;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  kind: TeacherAssignmentRow['kind'];
  can_mark_attendance: boolean;
  can_post_homework: boolean;
  can_answer_queries: boolean;
  valid_from: string;
  valid_to: string | null;
}

const SELECT = `SELECT ta.id::text, ta.academic_year_id::text, ta.employee_id::text, e.employee_code, e.display_name AS employee_name,
        e.user_id::text, ta.class_section_id::text, c.code AS class_code, cs.name AS section,
        ta.subject_id::text, s.code AS subject_code, s.name AS subject_name, ta.kind,
        ta.can_mark_attendance, ta.can_post_homework, ta.can_answer_queries, ta.valid_from::text, ta.valid_to::text
   FROM teacher_assignments ta
   JOIN employees e ON e.id = ta.employee_id
   JOIN class_sections cs ON cs.id = ta.class_section_id
   JOIN classes c ON c.id = cs.class_id
   LEFT JOIN subjects s ON s.id = ta.subject_id`;

const toRow = (r: AssignmentDb): TeacherAssignmentRow => ({
  id: r.id,
  academicYearId: r.academic_year_id,
  employeeId: r.employee_id,
  employeeCode: r.employee_code,
  employeeName: r.employee_name,
  userId: r.user_id,
  classSectionId: r.class_section_id,
  classCode: r.class_code,
  section: r.section,
  subjectId: r.subject_id,
  subjectCode: r.subject_code,
  subjectName: r.subject_name,
  kind: r.kind,
  canMarkAttendance: r.can_mark_attendance,
  canPostHomework: r.can_post_homework,
  canAnswerQueries: r.can_answer_queries,
  validFrom: r.valid_from,
  validTo: r.valid_to,
});

/**
 * Teacher assignments (S6-02). Each assignment is the source of truth for who teaches what; the database
 * routine app.sync_teacher_scopes turns it into template roles and class_section scopes (ADR-004), so the
 * permission guard and every scoped list follow automatically.
 */
@Injectable()
export class TeacherAssignmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly access: AccessService,
  ) {}

  private requireYear(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async list(
    ctx: RequestContext,
    q: ListTeacherAssignmentsQueryDto,
  ): Promise<TeacherAssignmentRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    const allowed = await this.scopes.filter(tenant, ACADEMICS.assignmentView, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const where: string[] = ['ta.academic_year_id = $1'];
      const params: unknown[] = [yearId];
      if (!q.includeEnded) where.push('ta.valid_to IS NULL');
      if (q.employeeId) {
        params.push(q.employeeId);
        where.push(`ta.employee_id = $${params.length}`);
      }
      if (q.classSectionId) {
        params.push(q.classSectionId);
        where.push(`ta.class_section_id = $${params.length}`);
      }
      if (q.kind) {
        params.push(q.kind);
        where.push(`ta.kind = $${params.length}::teacher_assignment_kind`);
      }
      if (allowed !== null) {
        params.push(allowed);
        where.push(`ta.class_section_id = ANY($${params.length}::bigint[])`);
      }
      const r = await c.query<AssignmentDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where holds fixed fragments; values are bound parameters
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY c.display_order, cs.name, ta.kind, e.display_name`,
        params,
      );
      return r.rows.map(toRow);
    });
  }

  /** Assignments of the signed-in user's own employee record (teacher app "my classes"). */
  async mine(ctx: RequestContext): Promise<TeacherAssignmentRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<AssignmentDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
        `${SELECT} WHERE ta.academic_year_id = $1 AND ta.valid_to IS NULL AND e.user_id = app.current_user_id()
          ORDER BY c.display_order, cs.name, ta.kind`,
        [yearId],
      );
      return r.rows.map(toRow);
    });
  }

  private async find(c: PoolClient, id: string): Promise<TeacherAssignmentRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; values are bound parameters
    const r = await c.query<AssignmentDb>(`${SELECT} WHERE ta.id = $1`, [id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async create(
    ctx: RequestContext,
    dto: CreateTeacherAssignmentDto,
  ): Promise<TeacherAssignmentRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'academics')`, [yearId]);
      const section = await c.query<{ academic_year_id: string }>(
        `SELECT academic_year_id::text FROM class_sections WHERE id = $1 AND deleted_at IS NULL`,
        [dto.classSectionId],
      );
      if (!section.rows[0]) throw new DomainError('not-found', 'Section not found');
      if (section.rows[0].academic_year_id !== yearId)
        throw new DomainError(
          'assignment.section_year_mismatch',
          'The section belongs to another academic year',
          { status: 409 },
        );
      const emp = await c.query(
        `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.employeeId],
      );
      if (emp.rowCount === 0) throw new DomainError('not-found', 'Employee not found');
      if (dto.subjectId) {
        const subj = await c.query(
          `SELECT 1 FROM subjects WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [dto.subjectId],
        );
        if (subj.rowCount === 0) throw new DomainError('not-found', 'Subject not found');
      }
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind,
                    can_mark_attendance, can_post_homework, can_answer_queries, valid_from, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::teacher_assignment_kind, $6, $7, $8, COALESCE($9::date, CURRENT_DATE),
                   app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [
            yearId,
            dto.employeeId,
            dto.classSectionId,
            dto.subjectId ?? null,
            dto.kind,
            dto.canMarkAttendance,
            dto.canPostHomework,
            dto.canAnswerQueries,
            dto.validFrom ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint === 'teacher_assignments_one_class_teacher')
          throw new DomainError(
            'assignment.class_teacher_exists',
            'The section already has a class teacher; end that assignment first',
            { status: 409 },
          );
        if (pg.code === '23505')
          throw new DomainError('conflict', 'This assignment already exists');
        throw error;
      }
      await c.query(`SELECT app.sync_teacher_scopes($1, $2)`, [dto.employeeId, yearId]);
      const created = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.teacher_assignment.create',
        entityType: 'teacher_assignments',
        entityId: id,
        after: created,
      });
      if (created.userId) await this.access.invalidateUser(tenant.schoolId, created.userId);
      return created;
    });
  }

  /** Ends an assignment today and re-synchronises the teacher's roles and scopes. */
  async end(ctx: RequestContext, id: string): Promise<TeacherAssignmentRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Assignment not found');
      if (before.validTo)
        throw new DomainError('assignment.already_ended', 'The assignment has already ended', {
          status: 409,
        });
      await c.query(
        `UPDATE teacher_assignments SET valid_to = GREATEST(CURRENT_DATE, valid_from), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await c.query(`SELECT app.sync_teacher_scopes($1, $2)`, [
        before.employeeId,
        before.academicYearId,
      ]);
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.teacher_assignment.end',
        entityType: 'teacher_assignments',
        entityId: id,
        before,
        after,
      });
      if (after.userId) await this.access.invalidateUser(tenant.schoolId, after.userId);
      return after;
    });
  }
}
