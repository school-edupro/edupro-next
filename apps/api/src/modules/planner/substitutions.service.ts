import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import type {
  CreateSubstitutionDto,
  FreeTeachersQueryDto,
  SubstitutionQueryDto,
} from './planner.dto';

export interface SubstitutionRow {
  id: string;
  onDate: string;
  classSectionId: string;
  section: string;
  periodId: string;
  periodNumber: number;
  periodName: string;
  absentEmployeeId: string | null;
  absentTeacher: string | null;
  substituteEmployeeId: string;
  substitute: string;
  subjectId: string | null;
  subject: string | null;
  reason: string | null;
  note: string | null;
}

const SELECT = `SELECT ts.id::text, ts.on_date::text, ts.class_section_id::text, k.code || '-' || cs.name AS section, ts.period_id::text, p.number AS period_number, p.name AS period_name,
        ts.absent_employee_id::text, a.display_name AS absent_teacher, ts.substitute_employee_id::text, b.display_name AS substitute, ts.subject_id::text, s.name AS subject, ts.reason, ts.note
   FROM timetable_substitutions ts JOIN class_sections cs ON cs.id = ts.class_section_id JOIN classes k ON k.id = cs.class_id JOIN timetable_periods p ON p.id = ts.period_id
   LEFT JOIN employees a ON a.id = ts.absent_employee_id JOIN employees b ON b.id = ts.substitute_employee_id LEFT JOIN subjects s ON s.id = ts.subject_id`;

/**
 * Timetable substitutions (S11): for a date, section and period the regular teacher is replaced; the
 * substitute must be free (no regular slot that weekday and period, no other substitution that date and
 * period). Teachers see their substitutions in "My classes"; families see who takes the period.
 */
@Injectable()
export class SubstitutionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
  ) {}

  async list(ctx: RequestContext, q: SubstitutionQueryDto) {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, 'academics.substitution.view');
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [];
      const where: string[] = [];
      if (q.date) {
        params.push(q.date);
        where.push(`ts.on_date = $${params.length}::date`);
      } else where.push(`ts.on_date >= CURRENT_DATE - 7`);
      if (q.employeeId) {
        params.push(q.employeeId);
        where.push(
          `(ts.substitute_employee_id = $${params.length} OR ts.absent_employee_id = $${params.length})`,
        );
      }
      if (v.kind === 'family') {
        params.push(v.students.map((s) => s.classSectionId).filter(Boolean));
        where.push(`ts.class_section_id = ANY($${params.length}::bigint[])`);
      }
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; where holds fixed fragments with numbered placeholders; values are bound parameters
        `${SELECT} WHERE ${where.join(' AND ')} ORDER BY ts.on_date, p.number, k.display_order, cs.name`,
        params,
      );
      return { data: r.rows.map(toRow) };
    });
  }

  /** The signed-in teacher's substitutions (as substitute or as the absent teacher) for the coming week. */
  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant
        `${SELECT} WHERE ts.on_date BETWEEN CURRENT_DATE - 1 AND CURRENT_DATE + 7 AND (b.user_id = app.current_user_id() OR a.user_id = app.current_user_id()) ORDER BY ts.on_date, p.number`,
      );
      return { data: r.rows.map(toRow) };
    });
  }

  /** Teachers free at a period on a date: no regular slot that weekday, no substitution that date; the absent teacher excluded. */
  async freeTeachers(ctx: RequestContext, q: FreeTeachersQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        id: string;
        name: string;
        designation: string | null;
        load: number;
      }>(
        `SELECT e.id::text, e.display_name AS name, e.designation,
                (SELECT count(*)::int FROM timetable_slots x WHERE x.employee_id = e.id AND x.academic_year_id = $1 AND x.weekday = EXTRACT(ISODOW FROM $2::date)) AS load
           FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active' AND e.employee_type = 'teaching' AND e.id <> COALESCE($4::bigint, 0)
            AND NOT EXISTS (SELECT 1 FROM timetable_slots x WHERE x.employee_id = e.id AND x.academic_year_id = $1 AND x.weekday = EXTRACT(ISODOW FROM $2::date) AND x.period_id = $3)
            AND NOT EXISTS (SELECT 1 FROM timetable_substitutions y WHERE y.substitute_employee_id = e.id AND y.on_date = $2::date AND y.period_id = $3)
          ORDER BY load, e.display_name`,
        [yearId, q.date, q.periodId, q.absentEmployeeId ?? null],
      );
      return { data: r.rows };
    });
  }

  async create(ctx: RequestContext, dto: CreateSubstitutionDto): Promise<SubstitutionRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const slot = await c.query<{
        id: string;
        employee_id: string | null;
        subject_id: string | null;
      }>(
        `SELECT id::text, employee_id::text, subject_id::text FROM timetable_slots WHERE academic_year_id = $1 AND class_section_id = $2 AND period_id = $3 AND weekday = EXTRACT(ISODOW FROM $4::date)`,
        [yearId, dto.classSectionId, dto.periodId, dto.onDate],
      );
      const regular = slot.rows[0] ?? null;
      if (regular?.employee_id === dto.substituteEmployeeId)
        throw new DomainError(
          'substitution.same_teacher',
          'The substitute is the regular teacher of this period',
          { status: 409 },
        );
      const busy = await c.query<{ where: string }>(
        `SELECT 'slot' AS where FROM timetable_slots x WHERE x.employee_id = $1 AND x.academic_year_id = $2 AND x.weekday = EXTRACT(ISODOW FROM $3::date) AND x.period_id = $4
         UNION ALL
         SELECT 'substitution' FROM timetable_substitutions y WHERE y.substitute_employee_id = $1 AND y.on_date = $3::date AND y.period_id = $4`,
        [dto.substituteEmployeeId, yearId, dto.onDate, dto.periodId],
      );
      if (busy.rowCount)
        throw new DomainError(
          'substitution.conflict',
          `The substitute already teaches in that period (${busy.rows[0]!.where})`,
          { status: 409, extra: { where: busy.rows[0]!.where } },
        );
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO timetable_substitutions (school_id, academic_year_id, on_date, class_section_id, period_id, slot_id, absent_employee_id, substitute_employee_id, subject_id, reason, note, created_by)
           VALUES (app.current_school_id(), $1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, app.current_user_id()) RETURNING id::text`,
          [
            yearId,
            dto.onDate,
            dto.classSectionId,
            dto.periodId,
            regular?.id ?? null,
            regular?.employee_id ?? null,
            dto.substituteEmployeeId,
            regular?.subject_id ?? null,
            dto.reason ?? null,
            dto.note ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'substitution.exists',
            'This period already has a substitution on that date',
            { status: 409 },
          );
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'planner.substitution.create',
        entityType: 'timetable_substitutions',
        entityId: id,
        after: {
          onDate: dto.onDate,
          sectionId: dto.classSectionId,
          periodId: dto.periodId,
          substitute: dto.substituteEmployeeId,
        },
      });
      return this.find(c, id);
    });
  }

  async remove(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      await c.query(`DELETE FROM timetable_substitutions WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'planner.substitution.delete',
        entityType: 'timetable_substitutions',
        entityId: id,
        before: { onDate: before.onDate, section: before.section },
      });
      return { ok: true };
    });
  }

  private async find(c: PoolClient, id: string): Promise<SubstitutionRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a constant; the id is a bound parameter
    const r = await c.query<Record<string, unknown>>(`${SELECT} WHERE ts.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Substitution not found', { status: 404 });
    return toRow(r.rows[0]);
  }
}

const toRow = (x: Record<string, unknown>): SubstitutionRow => ({
  id: x.id as string,
  onDate: x.on_date as string,
  classSectionId: x.class_section_id as string,
  section: x.section as string,
  periodId: x.period_id as string,
  periodNumber: x.period_number as number,
  periodName: x.period_name as string,
  absentEmployeeId: (x.absent_employee_id as string) ?? null,
  absentTeacher: (x.absent_teacher as string) ?? null,
  substituteEmployeeId: x.substitute_employee_id as string,
  substitute: x.substitute as string,
  subjectId: (x.subject_id as string) ?? null,
  subject: (x.subject as string) ?? null,
  reason: (x.reason as string) ?? null,
  note: (x.note as string) ?? null,
});
