import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../../common/access/scope.policy';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { CreatePeriodDto, SetSlotDto, TimetableQueryDto } from './academics.dto';
import { ACADEMICS } from './academics.permissions';

export interface PeriodRow {
  id: string;
  campusId: string | null;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  kind: 'teaching' | 'break' | 'assembly' | 'activity';
}

export interface SlotRow {
  id: string;
  classSectionId: string;
  classCode: string;
  section: string;
  weekday: number;
  periodId: string;
  periodNumber: number;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  employeeId: string | null;
  employeeName: string | null;
  room: string | null;
}

interface PeriodDb {
  id: string;
  campus_id: string | null;
  number: number;
  name: string;
  starts_at: string;
  ends_at: string;
  kind: PeriodRow['kind'];
}

interface SlotDb {
  id: string;
  class_section_id: string;
  class_code: string;
  section: string;
  weekday: number;
  period_id: string;
  period_number: number;
  subject_id: string | null;
  subject_code: string | null;
  subject_name: string | null;
  employee_id: string | null;
  employee_name: string | null;
  room: string | null;
}

const PERIOD_COLUMNS = `id::text, campus_id::text, number, name, to_char(starts_at, 'HH24:MI') AS starts_at, to_char(ends_at, 'HH24:MI') AS ends_at, kind`;
const toPeriod = (r: PeriodDb): PeriodRow => ({
  id: r.id,
  campusId: r.campus_id,
  number: r.number,
  name: r.name,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  kind: r.kind,
});

const SLOT_SELECT = `SELECT ts.id::text, ts.class_section_id::text, c.code AS class_code, cs.name AS section, ts.weekday, ts.period_id::text,
        p.number AS period_number, ts.subject_id::text, s.code AS subject_code, s.name AS subject_name,
        ts.employee_id::text, e.display_name AS employee_name, ts.room
   FROM timetable_slots ts
   JOIN class_sections cs ON cs.id = ts.class_section_id
   JOIN classes c ON c.id = cs.class_id
   JOIN timetable_periods p ON p.id = ts.period_id
   LEFT JOIN subjects s ON s.id = ts.subject_id
   LEFT JOIN employees e ON e.id = ts.employee_id`;
const toSlot = (r: SlotDb): SlotRow => ({
  id: r.id,
  classSectionId: r.class_section_id,
  classCode: r.class_code,
  section: r.section,
  weekday: r.weekday,
  periodId: r.period_id,
  periodNumber: r.period_number,
  subjectId: r.subject_id,
  subjectCode: r.subject_code,
  subjectName: r.subject_name,
  employeeId: r.employee_id,
  employeeName: r.employee_name,
  room: r.room,
});

/**
 * Periods and timetable slots (S6-03). The unique index timetable_slots_teacher_conflict makes a
 * double-booked teacher impossible at the database; the service turns that into a 409 problem.
 */
@Injectable()
export class TimetableService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
  ) {}

  private requireYear(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  // ---- periods --------------------------------------------------------------------------------
  async listPeriods(ctx: RequestContext): Promise<PeriodRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<PeriodDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant
        `SELECT ${PERIOD_COLUMNS} FROM timetable_periods ORDER BY campus_id NULLS FIRST, number`,
      );
      return r.rows.map(toPeriod);
    });
  }

  async createPeriod(ctx: RequestContext, dto: CreatePeriodDto): Promise<PeriodRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let row: PeriodDb;
      try {
        const r = await c.query<PeriodDb>(
          // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
          `INSERT INTO timetable_periods (school_id, campus_id, number, name, starts_at, ends_at, kind, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::time, $5::time, $6::period_kind, app.current_user_id())
           RETURNING ${PERIOD_COLUMNS}`,
          [dto.campusId ?? null, dto.number, dto.name, dto.startsAt, dto.endsAt, dto.kind],
        );
        row = r.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Period ${dto.number} already exists`);
        throw error;
      }
      const created = toPeriod(row);
      await this.audit.stage(ctx, c, {
        action: 'academics.period.create',
        entityType: 'timetable_periods',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async removePeriod(ctx: RequestContext, id: string): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<PeriodDb>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${PERIOD_COLUMNS} FROM timetable_periods WHERE id = $1`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Period not found');
      const used = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM timetable_slots WHERE period_id = $1`,
        [id],
      );
      if (Number(used.rows[0]?.n ?? 0) > 0)
        throw new DomainError('timetable.period_in_use', 'The period still has timetable slots', {
          status: 409,
        });
      await c.query(`DELETE FROM timetable_periods WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'academics.period.delete',
        entityType: 'timetable_periods',
        entityId: id,
        before: toPeriod(r.rows[0]),
      });
    });
  }

  // ---- slots ----------------------------------------------------------------------------------
  async slots(ctx: RequestContext, q: TimetableQueryDto): Promise<SlotRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    if (q.classSectionId)
      await this.scopes.assert(tenant, ACADEMICS.timetableView, 'class_section', q.classSectionId);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId];
      let filter: string;
      if (q.classSectionId) {
        params.push(q.classSectionId);
        filter = `ts.class_section_id = $2`;
      } else {
        params.push(q.employeeId);
        filter = `ts.employee_id = $2`;
      }
      const r = await c.query<SlotDb>(
        // eslint-disable-next-line no-restricted-syntax -- SLOT_SELECT is a constant; filter is one of two fixed fragments; values are bound parameters
        `${SLOT_SELECT} WHERE ts.academic_year_id = $1 AND ${filter} ORDER BY ts.weekday, p.number`,
        params,
      );
      return r.rows.map(toSlot);
    });
  }

  /** The signed-in teacher's own week, from the employee record linked to the user. */
  async mine(ctx: RequestContext): Promise<SlotRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<SlotDb>(
        // eslint-disable-next-line no-restricted-syntax -- SLOT_SELECT is a constant; values are bound parameters
        `${SLOT_SELECT} WHERE ts.academic_year_id = $1 AND e.user_id = app.current_user_id() ORDER BY ts.weekday, p.number`,
        [yearId],
      );
      return r.rows.map(toSlot);
    });
  }

  private async findSlot(c: PoolClient, id: string): Promise<SlotRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- SLOT_SELECT is a constant; values are bound parameters
    const r = await c.query<SlotDb>(`${SLOT_SELECT} WHERE ts.id = $1`, [id]);
    return r.rows[0] ? toSlot(r.rows[0]) : null;
  }

  async setSlot(ctx: RequestContext, dto: SetSlotDto): Promise<SlotRow> {
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
      const period = await c.query<{ kind: string }>(
        `SELECT kind::text FROM timetable_periods WHERE id = $1`,
        [dto.periodId],
      );
      if (!period.rows[0]) throw new DomainError('not-found', 'Period not found');
      if (period.rows[0].kind !== 'teaching' && (dto.subjectId || dto.employeeId))
        throw new DomainError(
          'timetable.not_teaching_period',
          'Subjects and teachers can only be placed in teaching periods',
          { status: 409 },
        );
      if (dto.employeeId) {
        // Checked before the write so the unique index (the safety net) never aborts the transaction.
        const clash = await c.query<{ label: string }>(
          `SELECT c.code || '-' || cs.name AS label FROM timetable_slots ts
             JOIN class_sections cs ON cs.id = ts.class_section_id JOIN classes c ON c.id = cs.class_id
            WHERE ts.academic_year_id = $1 AND ts.employee_id = $2 AND ts.weekday = $3 AND ts.period_id = $4
              AND ts.class_section_id <> $5`,
          [yearId, dto.employeeId, dto.weekday, dto.periodId, dto.classSectionId],
        );
        if (clash.rows[0])
          throw new DomainError(
            'timetable.teacher_conflict',
            `The teacher already takes ${clash.rows[0].label} in this period`,
            { status: 409, extra: { section: clash.rows[0].label } },
          );
      }
      const existing = await c.query<{ id: string }>(
        `SELECT id::text FROM timetable_slots WHERE class_section_id = $1 AND weekday = $2 AND period_id = $3`,
        [dto.classSectionId, dto.weekday, dto.periodId],
      );
      const before = existing.rows[0] ? await this.findSlot(c, existing.rows[0].id) : null;
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO timetable_slots (school_id, academic_year_id, class_section_id, weekday, period_id, subject_id, employee_id, room, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id(), app.current_user_id())
           ON CONFLICT (class_section_id, weekday, period_id) DO UPDATE
             SET subject_id = EXCLUDED.subject_id, employee_id = EXCLUDED.employee_id, room = EXCLUDED.room,
                 updated_at = now(), updated_by = app.current_user_id()
           RETURNING id::text`,
          [
            yearId,
            dto.classSectionId,
            dto.weekday,
            dto.periodId,
            dto.subjectId ?? null,
            dto.employeeId ?? null,
            dto.room ?? null,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        const pg = error as { code?: string; constraint?: string };
        if (pg.code === '23505' && pg.constraint === 'timetable_slots_teacher_conflict')
          throw new DomainError(
            'timetable.teacher_conflict',
            'The teacher already takes another section in this period',
            { status: 409 },
          );
        throw error;
      }
      const after = (await this.findSlot(c, id))!;
      await this.audit.stage(ctx, c, {
        action: 'academics.timetable.set',
        entityType: 'timetable_slots',
        entityId: id,
        before: before ?? undefined,
        after,
      });
      return after;
    });
  }

  async removeSlot(ctx: RequestContext, id: string): Promise<void> {
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, async (c) => {
      const before = await this.findSlot(c, id);
      if (!before) throw new DomainError('not-found', 'Slot not found');
      await c.query(`DELETE FROM timetable_slots WHERE id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'academics.timetable.clear',
        entityType: 'timetable_slots',
        entityId: id,
        before,
      });
    });
  }
}
