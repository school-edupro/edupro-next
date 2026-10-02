import { Injectable } from '@nestjs/common';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { PEOPLE } from './people.permissions';

export interface SectionRollRow {
  studentId: string;
  name: string;
  admissionNo: string;
  gender: string;
  rollNo: number | null;
}

/**
 * Roll numbers and section moves within a class. Class teachers renumber their own section; the
 * coordinator and admins also move a student to another section of the same class. Fees are set per
 * class, so neither changes a student's fees; a change of class is refused here.
 */
@Injectable()
export class SectionRollService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly audit: AuditService,
  ) {}

  /** Sections of the working year this user may renumber (a class teacher: their own). */
  async sections(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const allowed = await this.scopes.filter(tenant, PEOPLE.rollNoManage, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string; label: string; students: number }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS label,
                (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.status = 'active') AS students
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = app.current_academic_year_id() AND cs.status = 'active'
            AND ($1::bigint[] IS NULL OR cs.id = ANY($1::bigint[]))
          ORDER BY k.display_order, k.code, cs.name`,
        [allowed],
      );
      return { data: r.rows };
    });
  }

  async section(ctx: RequestContext, sectionId: string) {
    const tenant = requireTenant(ctx);
    await this.scopes.assert(tenant, PEOPLE.studentView, 'class_section', sectionId);
    return this.db.tenant(tenant, async (c) => {
      const sec = await c.query<{
        id: string;
        label: string;
        class_id: string;
        academic_year_id: string;
      }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS label, k.id::text AS class_id, cs.academic_year_id::text
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
        [sectionId],
      );
      const s = sec.rows[0];
      if (!s) throw new DomainError('not-found', 'Section not found');
      const students = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        gender: string;
        roll_no: number | null;
      }>(
        `SELECT st.id::text AS student_id, st.display_name AS name, st.admission_no, st.gender::text, e.roll_no
           FROM enrolments e JOIN students st ON st.id = e.student_id AND st.deleted_at IS NULL
          WHERE e.class_section_id = $1 AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, st.display_name`,
        [sectionId],
      );
      const siblings = await c.query<{ id: string; label: string }>(
        `SELECT cs.id::text, k.code || '-' || cs.name AS label FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.class_id = $1 AND cs.academic_year_id = $2 AND cs.id <> $3 AND cs.status = 'active' ORDER BY cs.name`,
        [s.class_id, s.academic_year_id, sectionId],
      );
      return {
        section: { id: s.id, label: s.label },
        students: students.rows.map((x): SectionRollRow => ({
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          gender: x.gender,
          rollNo: x.roll_no,
        })),
        otherSections: siblings.rows,
        canRenumber: ctx.permissions?.has(PEOPLE.rollNoManage) ?? false,
        canMove: ctx.permissions?.has(PEOPLE.enrolmentManage) ?? false,
      };
    });
  }

  /** Saves new roll numbers for a section; numbers must be unique and every student in the section. */
  async renumber(
    ctx: RequestContext,
    sectionId: string,
    rolls: Array<{ studentId: string; rollNo: number }>,
  ) {
    const tenant = requireTenant(ctx);
    await this.scopes.assert(tenant, PEOPLE.rollNoManage, 'class_section', sectionId);
    const nums = rolls.map((r) => r.rollNo);
    if (new Set(nums).size !== nums.length)
      throw new DomainError('validation-failed', 'Each student needs a different roll number', {
        status: 400,
      });
    return this.db.tenant(tenant, async (c) => {
      const cur = await c.query<{ student_id: string; roll_no: number | null }>(
        `SELECT student_id::text, roll_no FROM enrolments WHERE class_section_id = $1 AND status = 'active' FOR UPDATE`,
        [sectionId],
      );
      const inSection = new Set(cur.rows.map((r) => r.student_id));
      const stranger = rolls.find((r) => !inSection.has(r.studentId));
      if (stranger)
        throw new DomainError('validation-failed', 'A student is not in this section', {
          status: 400,
        });
      // clear first so swapped numbers never collide with the unique roll index
      await c.query(
        `UPDATE enrolments SET roll_no = NULL WHERE class_section_id = $1 AND status = 'active' AND student_id = ANY($2::bigint[])`,
        [sectionId, rolls.map((r) => r.studentId)],
      );
      for (const r of rolls)
        await c.query(
          `UPDATE enrolments SET roll_no = $3, updated_at = now(), updated_by = app.current_user_id()
            WHERE class_section_id = $1 AND student_id = $2 AND status = 'active'`,
          [sectionId, r.studentId, r.rollNo],
        );
      const before = Object.fromEntries(cur.rows.map((r) => [r.student_id, r.roll_no]));
      await this.audit.stage(ctx, c, {
        action: 'people.roll_no.renumber',
        entityType: 'class_sections',
        entityId: sectionId,
        before,
        after: Object.fromEntries(rolls.map((r) => [r.studentId, r.rollNo])),
      });
      return { updated: rolls.length };
    });
  }

  /** Moves a student to another section of the same class (fees unchanged); next free roll number. */
  async move(
    ctx: RequestContext,
    sectionId: string,
    dto: { studentId: string; toSectionId: string; rollNo?: number },
  ) {
    const tenant = requireTenant(ctx);
    await this.scopes.assert(tenant, PEOPLE.enrolmentManage, 'class_section', sectionId);
    await this.scopes.assert(tenant, PEOPLE.enrolmentManage, 'class_section', dto.toSectionId);
    return this.db.tenant(tenant, async (c) => {
      const pair = await c.query<{
        id: string;
        class_id: string;
        academic_year_id: string;
        label: string;
      }>(
        `SELECT cs.id::text, cs.class_id::text, cs.academic_year_id::text, k.code || '-' || cs.name AS label
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = ANY($1::bigint[])`,
        [[sectionId, dto.toSectionId]],
      );
      const from = pair.rows.find((x) => x.id === sectionId);
      const to = pair.rows.find((x) => x.id === dto.toSectionId);
      if (!from || !to) throw new DomainError('not-found', 'Section not found');
      if (from.class_id !== to.class_id || from.academic_year_id !== to.academic_year_id)
        throw new DomainError(
          'people.section.other_class',
          'A student moves only between sections of the same class here; a class change goes through promotion or the office',
          { status: 409 },
        );
      const e = await c.query<{ joined_on: string; roll_no: number | null }>(
        `SELECT joined_on::text, roll_no FROM enrolments WHERE student_id = $1 AND class_section_id = $2 AND status = 'active'`,
        [dto.studentId, sectionId],
      );
      if (!e.rows[0])
        throw new DomainError('validation-failed', 'The student is not in this section', {
          status: 400,
        });
      const roll =
        dto.rollNo ??
        (
          await c.query<{ n: number }>(
            `SELECT COALESCE(max(roll_no), 0)::int + 1 AS n FROM enrolments WHERE class_section_id = $1 AND status = 'active'`,
            [dto.toSectionId],
          )
        ).rows[0]!.n;
      await c.query(`SELECT app.enrol_student($1, $2, $3, $4, $5::date)`, [
        dto.studentId,
        to.academic_year_id,
        dto.toSectionId,
        roll,
        e.rows[0].joined_on,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'people.enrolment.move_section',
        entityType: 'enrolments',
        entityId: dto.studentId,
        before: { section: from.label, rollNo: e.rows[0].roll_no },
        after: { section: to.label, rollNo: roll },
      });
      return { section: to.label, rollNo: roll };
    });
  }
}
