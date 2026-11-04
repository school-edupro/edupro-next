import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { AccessService } from '../../access/access.service';
import { codeOf, readSheet, templateSheet } from '../../../common/excel/sheet';
import { generatedOn, registerFile, schoolHead } from '../../attendance/register-file';
import type {
  BulkTeacherAssignmentDto,
  CreateTeacherAssignmentDto,
  ListTeacherAssignmentsQueryDto,
} from './academics.dto';
import { ACADEMICS } from './academics.permissions';

export interface TeacherAssignmentRow {
  id: string;
  academicYearId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  userId: string | null;
  classSectionId: string;
  classId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  kind: 'class_teacher' | 'subject_teacher' | 'coordinator' | 'indicator' | 'remarks';
  canMarkAttendance: boolean;
  canPostHomework: boolean;
  canAnswerQueries: boolean;
  /** A class teacher: the actual one of the section, or a co-class teacher. */
  isActual: boolean;
  validFrom: string;
  validTo: string | null;
  /** an Indicator assignment: the indicator areas the teacher rates (none named: every area) */
  indicatorAreas: Array<{ id: string; name: string }>;
  /** and single indicators of those areas (none named: every indicator of the areas; docs/design/71) */
  indicators: Array<{ id: string; code: string; name: string; area: string | null }>;
  /** a Remarks assignment: the remark categories the teacher writes */
  remarkCategories: Array<{ id: string; code: string; name: string }>;
}

interface AssignmentDb {
  id: string;
  academic_year_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  user_id: string | null;
  class_section_id: string;
  class_id: string;
  class_code: string;
  section: string;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  kind: TeacherAssignmentRow['kind'];
  can_mark_attendance: boolean;
  can_post_homework: boolean;
  can_answer_queries: boolean;
  is_actual: boolean;
  valid_from: string;
  valid_to: string | null;
  areas: Array<{ id: string; name: string }> | null;
  indicators: TeacherAssignmentRow['indicators'] | null;
  categories: TeacherAssignmentRow['remarkCategories'] | null;
}

const SELECT = `SELECT ta.id::text, ta.academic_year_id::text, ta.employee_id::text, e.employee_code, e.display_name AS employee_name,
        e.user_id::text, ta.class_section_id::text, cs.class_id::text, c.code AS class_code, cs.name AS section,
        ta.subject_id::text, s.code AS subject_code, s.name AS subject_name, ta.kind,
        ta.can_mark_attendance, ta.can_post_homework, ta.can_answer_queries, ta.is_actual, ta.valid_from::text, ta.valid_to::text,
        (SELECT jsonb_agg(jsonb_build_object('id', ia.id::text, 'name', ia.name) ORDER BY ia.sort_order, ia.name)
           FROM indicator_areas ia WHERE ia.id = ANY(ta.indicator_area_ids)) AS areas,
        (SELECT jsonb_agg(jsonb_build_object('id', i.id::text, 'code', i.code, 'name', i.name, 'area', i.area) ORDER BY i.area, i.sort_order, i.code)
           FROM indicators i WHERE i.id = ANY(ta.indicator_ids)) AS indicators,
        (SELECT jsonb_agg(jsonb_build_object('id', rc.id::text, 'code', rc.code, 'name', rc.name) ORDER BY rc.sort_order, rc.code)
           FROM remark_categories rc WHERE rc.id = ANY(ta.remark_category_ids)) AS categories
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
  classId: r.class_id,
  classCode: r.class_code,
  section: r.section,
  subjectId: r.subject_id,
  subjectCode: r.subject_code,
  subjectName: r.subject_name,
  kind: r.kind,
  canMarkAttendance: r.can_mark_attendance,
  canPostHomework: r.can_post_homework,
  canAnswerQueries: r.can_answer_queries,
  isActual: r.is_actual,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  indicatorAreas: r.areas ?? [],
  indicators: r.indicators ?? [],
  remarkCategories: r.categories ?? [],
});

/** What an Indicator or Remarks assignment names (docs/design/71); empty for the other kinds. */
interface Mapping {
  areaIds: string[];
  indicatorIds: string[];
  categoryIds: string[];
}
const NO_MAPPING: Mapping = { areaIds: [], indicatorIds: [], categoryIds: [] };

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

  /** The list with the filters on screen, as Excel or PDF with the school's header. */
  async exportFile(ctx: RequestContext, q: ListTeacherAssignmentsQueryDto, format: 'xlsx' | 'pdf') {
    const rows = await this.list(ctx, q);
    const head = await this.db.tenant(requireTenant(ctx), (c) => schoolHead(c));
    const KIND: Record<string, string> = {
      class_teacher: 'Class teacher',
      subject_teacher: 'Subject teacher',
      coordinator: 'Coordinator',
      indicator: 'Indicator',
      remarks: 'Remarks',
    };
    const one = <T>(pick: (r: TeacherAssignmentRow) => T) => (rows[0] ? pick(rows[0]) : null);
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Teacher assignments',
        details: [
          q.classSectionId
            ? `Class ${one((r) => `${r.classCode}-${r.section}`) ?? ''}`
            : 'All classes',
          q.employeeId
            ? `Teacher ${one((r) => `${r.employeeName} (${r.employeeCode})`) ?? ''}`
            : 'All teachers',
          q.kind ? `Type ${KIND[q.kind] ?? q.kind}` : 'All types',
          q.includeEnded ? 'Ended ones included' : '',
          generatedOn(),
        ].filter(Boolean),
        legend: `${String(rows.length)} assignment(s)`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Emp. code', width: 7 },
          { label: 'Teacher', width: 16 },
          { label: 'Type', width: 10 },
          { label: 'Class', width: 6 },
          { label: 'Subject / what', width: 14 },
          { label: 'Since', width: 7 },
          { label: 'Status', width: 8 },
        ],
        rows: rows.map((r, i) => [
          i + 1,
          r.employeeCode,
          r.employeeName,
          r.kind === 'class_teacher' && !r.isActual ? 'Co-class teacher' : (KIND[r.kind] ?? r.kind),
          `${r.classCode}-${r.section}`,
          r.subjectName
            ? `${r.subjectName} (${r.subjectCode ?? ''})`
            : r.kind === 'indicator'
              ? [
                  r.indicatorAreas.map((a) => a.name).join('; ') || 'Every area',
                  r.indicators.map((i) => i.code).join(', '),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : r.kind === 'remarks'
                ? r.remarkCategories.map((k) => k.name).join('; ')
                : '',
          r.validFrom,
          r.validTo ? `Ended ${r.validTo}` : 'Active',
        ]),
        filename: `teacher-assignments-${new Date().toISOString().slice(0, 10)}`,
      },
      format,
    );
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

  /**
   * What an Indicator or Remarks assignment names, checked (docs/design/71): areas of the school; single
   * indicators that lie in those areas (any area when none is named); remark categories, at least one for
   * Remarks. Other kinds name nothing.
   */
  private async mapping(
    c: PoolClient,
    kind: TeacherAssignmentRow['kind'],
    m: Mapping,
  ): Promise<Mapping> {
    const uniq = (a: string[]) => [...new Set(a)];
    if (kind === 'remarks') {
      const ids = uniq(m.categoryIds);
      if (!ids.length)
        throw new DomainError('validation-failed', 'Pick at least one remark category', {
          status: 400,
        });
      const k = await c.query<{ id: string }>(
        `SELECT id::text FROM remark_categories WHERE id = ANY($1::bigint[]) AND status = 'active'`,
        [ids],
      );
      if (k.rows.length !== ids.length)
        throw new DomainError('validation-failed', 'A remark category is not of this school', {
          status: 400,
        });
      return { ...NO_MAPPING, categoryIds: ids };
    }
    if (kind !== 'indicator') return NO_MAPPING;
    const areaIds = uniq(m.areaIds);
    const indicatorIds = uniq(m.indicatorIds);
    const areas = await c.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM indicator_areas WHERE id = ANY($1::bigint[])`,
      [areaIds],
    );
    if (areas.rows.length !== areaIds.length)
      throw new DomainError('validation-failed', 'An indicator area is not of this school', {
        status: 400,
      });
    if (indicatorIds.length) {
      const ind = await c.query<{ id: string; code: string; area: string | null }>(
        `SELECT id::text, code, area FROM indicators WHERE id = ANY($1::bigint[])`,
        [indicatorIds],
      );
      if (ind.rows.length !== indicatorIds.length)
        throw new DomainError('validation-failed', 'An indicator is not of this school', {
          status: 400,
        });
      const names = new Set(areas.rows.map((a) => a.name.trim().toLowerCase()));
      const outside = names.size
        ? ind.rows.filter((i) => !names.has((i.area ?? '').trim().toLowerCase()))
        : [];
      if (outside.length)
        throw new DomainError(
          'assignment.indicator_outside_areas',
          `${outside.map((i) => i.code).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in the areas picked`,
          { status: 400 },
        );
    }
    return { areaIds, indicatorIds, categoryIds: [] };
  }

  /** A remark category the section's class does not take: why it is left out, else null. */
  private async categoriesOff(
    c: PoolClient,
    sectionId: string,
    categoryIds: string[],
  ): Promise<string | null> {
    if (!categoryIds.length) return null;
    const r = await c.query<{ name: string; class_name: string }>(
      `SELECT rc.name, k.name AS class_name FROM remark_categories rc, class_sections cs JOIN classes k ON k.id = cs.class_id
        WHERE cs.id = $1 AND rc.id = ANY($2::bigint[])
          AND cardinality(rc.class_ids) > 0 AND NOT cs.class_id = ANY(rc.class_ids)`,
      [sectionId, categoryIds],
    );
    return r.rows.length
      ? `${r.rows.map((x) => `"${x.name}"`).join(', ')} ${r.rows.length === 1 ? 'is' : 'are'} not set for ${r.rows[0]!.class_name} (Exams → Remark categories)`
      : null;
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
      const map = await this.mapping(c, dto.kind, {
        areaIds: dto.areaIds,
        indicatorIds: dto.indicatorIds,
        categoryIds: dto.remarkCategoryIds,
      });
      const off = await this.categoriesOff(c, dto.classSectionId, map.categoryIds);
      if (off) throw new DomainError('assignment.category_not_for_class', off, { status: 409 });
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind,
                    can_mark_attendance, can_post_homework, can_answer_queries, valid_from, is_actual,
                    indicator_area_ids, indicator_ids, remark_category_ids, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::teacher_assignment_kind, $6, $7, $8, COALESCE($9::date, CURRENT_DATE),
                   $10, $11::bigint[], $12::bigint[], $13::bigint[], app.current_user_id(), app.current_user_id())
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
            dto.kind !== 'class_teacher' || dto.isActual,
            map.areaIds,
            map.indicatorIds,
            map.categoryIds,
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

  // ---- many at once: the form (one teacher, many classes and subjects) and the Excel sheet ----------
  /**
   * One line of a bulk save. Returns null when saved, else why it was left out (already there, the
   * section has its class teacher, the subject is not taught in the class).
   */
  private async place(
    c: PoolClient,
    yearId: string,
    x: {
      employeeId: string;
      kind: TeacherAssignmentRow['kind'];
      sectionId: string;
      subjectId: string | null;
      isActual: boolean;
      map?: Mapping;
    },
  ): Promise<string | null> {
    const map = x.map ?? NO_MAPPING;
    const off = await this.categoriesOff(c, x.sectionId, map.categoryIds);
    if (off) return off;
    if (x.subjectId) {
      const taught = await c.query<{ any: boolean; has: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM class_subjects cs2 JOIN class_sections s ON s.class_id = cs2.class_id WHERE s.id = $1 AND cs2.academic_year_id = $3 AND cs2.status = 'active') AS any,
                EXISTS (SELECT 1 FROM class_subjects cs2 JOIN class_sections s ON s.class_id = cs2.class_id WHERE s.id = $1 AND cs2.academic_year_id = $3 AND cs2.status = 'active' AND cs2.subject_id = $2) AS has`,
        [x.sectionId, x.subjectId, yearId],
      );
      if (taught.rows[0]!.any && !taught.rows[0]!.has)
        return 'the subject is not taught in this class';
    }
    if (x.kind === 'class_teacher' && x.isActual) {
      const other = await c.query<{ name: string; mine: boolean }>(
        `SELECT e.display_name AS name, (ta.employee_id = $2) AS mine FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
          WHERE ta.class_section_id = $1 AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL AND ta.is_actual LIMIT 1`,
        [x.sectionId, x.employeeId],
      );
      if (other.rows[0])
        return other.rows[0].mine
          ? 'already assigned'
          : `${other.rows[0].name} is the class teacher; end that first, or save this one as a co-class teacher`;
    }
    const r = await c.query(
      `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind, is_actual,
                    indicator_area_ids, indicator_ids, remark_category_ids, created_by, updated_by)
       SELECT app.current_school_id(), $1, $2, $3, $4, $5::teacher_assignment_kind, $6, $7::bigint[], $8::bigint[], $9::bigint[],
              app.current_user_id(), app.current_user_id()
        WHERE NOT EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.academic_year_id = $1 AND ta.employee_id = $2 AND ta.class_section_id = $3
                             AND ta.kind = $5::teacher_assignment_kind AND COALESCE(ta.subject_id, 0) = COALESCE($4::bigint, 0) AND ta.valid_to IS NULL)`,
      [
        yearId,
        x.employeeId,
        x.sectionId,
        x.subjectId,
        x.kind,
        x.kind !== 'class_teacher' || x.isActual,
        x.kind === 'indicator' ? map.areaIds : [],
        x.kind === 'indicator' ? map.indicatorIds : [],
        x.kind === 'remarks' ? map.categoryIds : [],
      ],
    );
    return r.rowCount
      ? null
      : x.kind === 'indicator' || x.kind === 'remarks'
        ? `already assigned: change what it names on its row`
        : 'already assigned';
  }

  /** What a bulk save writes: a class teacher's classes (and the subjects taught there), else every class with every subject. */
  private lines(dto: {
    kind: TeacherAssignmentRow['kind'];
    classSectionIds: string[];
    subjectIds: string[];
  }): Array<{ kind: TeacherAssignmentRow['kind']; sectionId: string; subjectId: string | null }> {
    const out: Array<{
      kind: TeacherAssignmentRow['kind'];
      sectionId: string;
      subjectId: string | null;
    }> = [];
    for (const sectionId of dto.classSectionIds) {
      if (dto.kind !== 'subject_teacher') out.push({ kind: dto.kind, sectionId, subjectId: null });
      if (dto.kind === 'class_teacher' || dto.kind === 'subject_teacher')
        for (const subjectId of dto.subjectIds)
          out.push({ kind: 'subject_teacher', sectionId, subjectId });
    }
    return out;
  }

  async bulk(ctx: RequestContext, dto: BulkTeacherAssignmentDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'academics')`, [yearId]);
      const emp = await c.query<{ user_id: string | null }>(
        `SELECT user_id::text FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.employeeId],
      );
      if (!emp.rows[0]) throw new DomainError('not-found', 'Employee not found');
      const names = await c.query<{ id: string; name: string }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS name FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.id = ANY($1::bigint[]) AND cs.academic_year_id = $2 AND cs.deleted_at IS NULL`,
        [dto.classSectionIds, yearId],
      );
      if (names.rows.length !== new Set(dto.classSectionIds).size)
        throw new DomainError('not-found', 'A class is not of this academic year');
      const subjects = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM subjects WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active'`,
        [dto.subjectIds],
      );
      if (subjects.rows.length !== new Set(dto.subjectIds).size)
        throw new DomainError('not-found', 'Subject not found');
      const map = await this.mapping(c, dto.kind, {
        areaIds: dto.areaIds,
        indicatorIds: dto.indicatorIds,
        categoryIds: dto.remarkCategoryIds,
      });
      const label = (sectionId: string, subjectId: string | null) =>
        [
          names.rows.find((n) => n.id === sectionId)?.name,
          subjectId ? subjects.rows.find((s) => s.id === subjectId)?.name : null,
        ]
          .filter(Boolean)
          .join(' · ');
      let created = 0;
      const skipped: Array<{ what: string; why: string }> = [];
      for (const line of this.lines(dto)) {
        const why = await this.place(c, yearId, {
          ...line,
          employeeId: dto.employeeId,
          isActual: dto.isActual,
          map,
        });
        if (why) skipped.push({ what: label(line.sectionId, line.subjectId), why });
        else created += 1;
      }
      if (created) {
        await c.query(`SELECT app.sync_teacher_scopes($1, $2)`, [dto.employeeId, yearId]);
        await this.audit.stage(ctx, c, {
          action: 'academics.teacher_assignment.bulk',
          entityType: 'employees',
          entityId: dto.employeeId,
          after: { ...dto, created },
        });
        if (emp.rows[0].user_id)
          await this.access.invalidateUser(tenant.schoolId, emp.rows[0].user_id);
      }
      return { created, skipped };
    });
  }

  private static readonly HEADERS = [
    'Employee',
    'Teacher type',
    'Class',
    'Subject',
    'Actual class teacher',
  ];
  private static readonly KINDS: Record<string, TeacherAssignmentRow['kind']> = {
    'class teacher': 'class_teacher',
    'subject teacher': 'subject_teacher',
    coordinator: 'coordinator',
    indicator: 'indicator',
    remarks: 'remarks',
  };
  /** columns of the format added later (docs/design/71): read when the sheet has them */
  private static readonly MAPPING = ['Indicator areas', 'Indicators', 'Remark categories'];

  private async lists(c: PoolClient, yearId: string) {
    const [staff, sections, subjects] = await Promise.all([
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name`,
      ),
      c.query<{ id: string; name: string; class_id: string }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS name, cs.class_id::text FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY k.display_order, cs.name`,
        [yearId],
      ),
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM subjects WHERE deleted_at IS NULL AND status = 'active' ORDER BY name`,
      ),
    ]);
    const [areas, indicators, categories] = await Promise.all([
      c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM indicator_areas WHERE status = 'active' ORDER BY sort_order, name`,
      ),
      // an indicator by its code within the sets a class uses (codes repeat across sets)
      c.query<{ id: string; code: string; area: string | null; class_ids: string[] }>(
        `SELECT i.id::text, i.code, i.area, COALESCE(array_agg(m.class_id::text) FILTER (WHERE m.class_id IS NOT NULL), '{}') AS class_ids
           FROM indicators i JOIN indicator_sets s ON s.id = i.set_id AND s.deleted_at IS NULL
           LEFT JOIN indicator_set_classes m ON m.set_id = s.id
          GROUP BY i.id, i.code, i.area`,
      ),
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM remark_categories WHERE status = 'active' ORDER BY sort_order, code`,
      ),
    ]);
    return {
      staff: staff.rows,
      sections: sections.rows,
      subjects: subjects.rows,
      areas: areas.rows,
      indicators: indicators.rows,
      categories: categories.rows,
    };
  }

  /** The Excel format: one row per teacher, type, class and subject, with drop-downs. */
  async template(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    const l = await this.db.tenant(tenant, (c) => this.lists(c, yearId));
    return {
      bytes: await templateSheet({
        sheet: 'Teacher assignments',
        columns: [
          {
            header: 'Employee',
            width: 34,
            required: true,
            options: l.staff.map((e) => `${e.code} · ${e.name}`),
          },
          {
            header: 'Teacher type',
            width: 18,
            required: true,
            options: ['Class teacher', 'Subject teacher', 'Coordinator', 'Indicator'],
          },
          { header: 'Class', width: 14, required: true, options: l.sections.map((s) => s.name) },
          { header: 'Subject', width: 30, options: l.subjects.map((s) => `${s.code} · ${s.name}`) },
          { header: 'Actual class teacher', width: 20, options: ['Yes', 'No'] },
          {
            header: 'Indicator areas',
            width: 34,
            note: 'Indicator only: the areas the teacher rates, separated by ;  Empty: every area.',
          },
          {
            header: 'Indicators',
            width: 24,
            note: 'Indicator only, optional: single indicator codes of those areas, separated by ;',
          },
          {
            header: 'Remark categories',
            width: 28,
            note: 'Remarks only: the categories the teacher writes (code or name), separated by ;',
          },
        ],
        guide: [
          'One row for each teacher, teacher type, class and subject. Pick every value from its drop-down.',
          'Class teacher: leave Subject empty. "Actual class teacher" Yes = the class teacher of the section (one per section); No = a co-class teacher. Empty means Yes.',
          'Subject teacher: Subject is needed. A teacher who teaches two subjects in a class has two rows.',
          'Coordinator, Indicator and Remarks: Subject may be left empty.',
          `Indicator: "Indicator areas" names the areas the teacher rates (empty: every area), e.g. ${l.areas
            .slice(0, 2)
            .map((a) => a.name)
            .join('; ')}. "Indicators" may narrow them to single indicator codes.`,
          `Remarks: "Remark categories" names the categories the teacher writes, e.g. ${l.categories
            .slice(0, 2)
            .map((k) => k.code)
            .join('; ')}.`,
          'A row that is already assigned is left as it is. Nothing is removed by an upload.',
        ],
      }),
      filename: 'teacher-assignments-format.xlsx',
    };
  }

  async import(ctx: RequestContext, fileBase64: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    const rows = await readSheet(
      fileBase64,
      TeacherAssignmentsService.HEADERS,
      TeacherAssignmentsService.MAPPING,
    );
    if (!rows.length)
      throw new DomainError('validation-failed', 'The sheet has no filled row', { status: 400 });
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'academics')`, [yearId]);
      const l = await this.lists(c, yearId);
      const errors: Array<{ row: number; message: string }> = [];
      const ready: Array<{
        row: number;
        employeeId: string;
        kind: TeacherAssignmentRow['kind'];
        sectionId: string;
        subjectId: string | null;
        isActual: boolean;
        map: Mapping;
      }> = [];
      const list = (cell: string | undefined, sep: RegExp) =>
        (cell ?? '')
          .split(sep)
          .map((x) => x.trim())
          .filter(Boolean);
      for (const { row, cells } of rows) {
        const empCode = codeOf(cells.Employee!).toLowerCase();
        const emp = l.staff.find(
          (e) => e.code.toLowerCase() === empCode || e.name.toLowerCase() === empCode,
        );
        const kind = TeacherAssignmentsService.KINDS[cells['Teacher type']!.toLowerCase()];
        const section = l.sections.find((s) => s.name.toLowerCase() === cells.Class!.toLowerCase());
        const subjCode = codeOf(cells.Subject!).toLowerCase();
        const subject = subjCode
          ? l.subjects.find(
              (s) => s.code.toLowerCase() === subjCode || s.name.toLowerCase() === subjCode,
            )
          : null;
        const actual = cells['Actual class teacher']!.toLowerCase();
        // the mapping of an Indicator / Remarks row (docs/design/71); area names may hold commas
        const areaNames = list(cells['Indicator areas'], /[;\n]/);
        const areas = areaNames.map(
          (n) => l.areas.find((a) => a.name.toLowerCase() === n.toLowerCase())?.id,
        );
        const codes = list(cells.Indicators, /[;,\n]/).map(codeOf);
        const indicators = codes.map((code) => {
          const hits = l.indicators.filter(
            (i) =>
              i.code.toLowerCase() === code.toLowerCase() &&
              (!section || i.class_ids.includes(section.class_id)),
          );
          return hits.length === 1 ? hits[0]!.id : undefined;
        });
        const catNames = list(cells['Remark categories'], /[;\n]/).map(codeOf);
        const cats = catNames.map(
          (n) =>
            l.categories.find(
              (k) =>
                k.code.toLowerCase() === n.toLowerCase() ||
                k.name.toLowerCase() === n.toLowerCase(),
            )?.id,
        );
        const problems = [
          emp ? null : `Employee "${cells.Employee!}" is not on the list`,
          kind ? null : `Teacher type "${cells['Teacher type']!}" is not on the list`,
          section ? null : `Class "${cells.Class!}" is not on the list`,
          subjCode && !subject ? `Subject "${cells.Subject!}" is not on the list` : null,
          kind === 'subject_teacher' && !subjCode
            ? 'Subject is needed for a subject teacher'
            : null,
          ['', 'yes', 'no'].includes(actual) ? null : 'Actual class teacher must be Yes or No',
          areas.some((a) => !a)
            ? `Indicator area "${areaNames[areas.findIndex((a) => !a)]!}" is not on the list`
            : null,
          indicators.some((i) => !i)
            ? `Indicator "${codes[indicators.findIndex((i) => !i)]!}" is not one of the class's sets`
            : null,
          cats.some((k) => !k)
            ? `Remark category "${catNames[cats.findIndex((k) => !k)]!}" is not on the list`
            : null,
          kind === 'remarks' && !catNames.length
            ? 'Remark categories are needed for Remarks'
            : null,
          kind !== 'indicator' && (areaNames.length || codes.length)
            ? 'Indicator areas and Indicators are for an Indicator row'
            : null,
          kind !== 'remarks' && catNames.length ? 'Remark categories are for a Remarks row' : null,
        ].filter(Boolean);
        if (problems.length) errors.push({ row, message: problems.join('; ') });
        else
          ready.push({
            row,
            employeeId: emp!.id,
            kind: kind!,
            sectionId: section!.id,
            subjectId: kind === 'class_teacher' ? null : (subject?.id ?? null),
            isActual: actual !== 'no',
            map: {
              areaIds: areas as string[],
              indicatorIds: indicators as string[],
              categoryIds: cats as string[],
            },
          });
      }
      // a sheet with a wrong row is not half-saved: correct it and upload again
      if (errors.length) return { created: 0, skipped: [], errors };
      let created = 0;
      const skipped: Array<{ what: string; why: string }> = [];
      for (const x of ready) {
        let why: string | null;
        try {
          why = await this.place(c, yearId, { ...x, map: await this.mapping(c, x.kind, x.map) });
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          why = e.message;
        }
        if (why) skipped.push({ what: `Row ${String(x.row)}`, why });
        else created += 1;
      }
      const touched = [...new Set(ready.map((x) => x.employeeId))];
      for (const employeeId of touched)
        await c.query(`SELECT app.sync_teacher_scopes($1, $2)`, [employeeId, yearId]);
      const users = await c.query<{ user_id: string }>(
        `SELECT user_id::text FROM employees WHERE id = ANY($1::bigint[]) AND user_id IS NOT NULL`,
        [touched],
      );
      for (const u of users.rows) await this.access.invalidateUser(tenant.schoolId, u.user_id);
      await this.audit.stage(ctx, c, {
        action: 'academics.teacher_assignment.import',
        entityType: 'teacher_assignments',
        entityId: yearId,
        after: { rows: rows.length, created, skipped: skipped.length },
      });
      return { created, skipped, errors };
    });
  }

  /**
   * The indicator areas an Indicator assignment covers (docs/design/69), and optionally single indicators
   * of them (docs/design/71): the teacher enters only these in the section, and a grade register run "as
   * per mapping" shows only these areas; none named covers every area.
   */
  async setAreas(
    ctx: RequestContext,
    id: string,
    areaIds: string[],
    indicatorIds: string[] = [],
  ): Promise<TeacherAssignmentRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Assignment not found');
      if (before.kind !== 'indicator')
        throw new DomainError(
          'assignment.not_indicator',
          'Only an Indicator assignment names indicator areas',
          { status: 409 },
        );
      const map = await this.mapping(c, 'indicator', { ...NO_MAPPING, areaIds, indicatorIds });
      await c.query(
        `UPDATE teacher_assignments SET indicator_area_ids = $2::bigint[], indicator_ids = $3::bigint[], updated_at = now(),
                updated_by = app.current_user_id() WHERE id = $1`,
        [id, map.areaIds, map.indicatorIds],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.teacher_assignment.areas',
        entityType: 'teacher_assignments',
        entityId: id,
        before: { areas: before.indicatorAreas, indicators: before.indicators },
        after: { areas: after.indicatorAreas, indicators: after.indicators },
      });
      return after;
    });
  }

  /** The remark categories a Remarks assignment names (docs/design/71): the teacher writes these. */
  async setCategories(
    ctx: RequestContext,
    id: string,
    categoryIds: string[],
  ): Promise<TeacherAssignmentRow> {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Assignment not found');
      if (before.kind !== 'remarks')
        throw new DomainError(
          'assignment.not_remarks',
          'Only a Remarks assignment names remark categories',
          { status: 409 },
        );
      const map = await this.mapping(c, 'remarks', { ...NO_MAPPING, categoryIds });
      const off = await this.categoriesOff(c, before.classSectionId, map.categoryIds);
      if (off) throw new DomainError('assignment.category_not_for_class', off, { status: 409 });
      await c.query(
        `UPDATE teacher_assignments SET remark_category_ids = $2::bigint[], updated_at = now(), updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, map.categoryIds],
      );
      const after = (await this.find(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.teacher_assignment.categories',
        entityType: 'teacher_assignments',
        entityId: id,
        before: { categories: before.remarkCategories },
        after: { categories: after.remarkCategories },
      });
      return after;
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
