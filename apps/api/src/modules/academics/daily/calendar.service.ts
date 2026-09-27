import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type { CalendarQueryDto, CreateAlmanacEventDto, CreateHolidayDto } from './daily.dto';
import { DAILY } from './daily.permissions';
import { ViewerService } from './viewer.service';

export interface HolidayRow {
  id: string;
  name: string;
  kind: 'holiday' | 'vacation' | 'working_day';
  startsOn: string;
  endsOn: string;
  appliesTo: 'everyone' | 'students' | 'employees';
  campusId: string | null;
}

export interface AlmanacRow {
  id: string;
  title: string;
  kind: 'event' | 'exam' | 'meeting' | 'activity' | 'deadline';
  startsOn: string;
  endsOn: string;
  startsAt: string | null;
  description: string | null;
  audience: 'everyone' | 'students' | 'employees';
}

const HOLIDAY_COLS = `id::text, name, kind, starts_on::text AS "startsOn", ends_on::text AS "endsOn", applies_to AS "appliesTo", campus_id::text AS "campusId"`;
const EVENT_COLS = `id::text, title, kind, starts_on::text AS "startsOn", ends_on::text AS "endsOn", to_char(starts_at, 'HH24:MI') AS "startsAt", description, audience`;

/** Holidays and the almanac (S7-05): one calendar read for every app, audience-filtered for families and staff. */
@Injectable()
export class CalendarService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
  ) {}

  async calendar(
    ctx: RequestContext,
    q: CalendarQueryDto,
  ): Promise<{ holidays: HolidayRow[]; events: AlmanacRow[]; from: string; to: string }> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    const v = await this.viewer.resolve(ctx, DAILY.calendarView);
    const audiences = ctx.permissions?.has(DAILY.calendarManage)
      ? ['everyone', 'students', 'employees']
      : v.kind === 'family'
        ? ['everyone', 'students']
        : ['everyone', 'employees'];
    return this.db.tenant(tenant, async (c) => {
      const year = await c.query<{ start_date: string; end_date: string }>(
        `SELECT start_date::text, end_date::text FROM academic_years WHERE id = $1`,
        [yearId],
      );
      const from = q.from ?? year.rows[0]?.start_date ?? '1900-01-01';
      const to = q.to ?? year.rows[0]?.end_date ?? '2999-12-31';
      const holidays = await c.query<HolidayRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${HOLIDAY_COLS} FROM holidays WHERE academic_year_id = $1 AND ends_on >= $2::date AND starts_on <= $3::date
            AND applies_to = ANY($4::audience_kind[]) ORDER BY starts_on`,
        [yearId, from, to, audiences],
      );
      const events = await c.query<AlmanacRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `SELECT ${EVENT_COLS} FROM almanac_events WHERE academic_year_id = $1 AND deleted_at IS NULL AND ends_on >= $2::date AND starts_on <= $3::date
            AND audience = ANY($4::audience_kind[]) ORDER BY starts_on, starts_at NULLS FIRST`,
        [yearId, from, to, audiences],
      );
      return { holidays: holidays.rows, events: events.rows, from, to };
    });
  }

  async createHoliday(ctx: RequestContext, dto: CreateHolidayDto): Promise<HolidayRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const endsOn = dto.endsOn ?? dto.startsOn;
      const overlap = await c.query<{ name: string }>(
        `SELECT name FROM holidays WHERE academic_year_id = $1 AND starts_on <= $3::date AND ends_on >= $2::date
            AND campus_id IS NOT DISTINCT FROM $4::bigint AND (applies_to = 'everyone' OR $5::audience_kind = 'everyone' OR applies_to = $5::audience_kind)
          LIMIT 1`,
        [yearId, dto.startsOn, endsOn, dto.campusId ?? null, dto.appliesTo],
      );
      if (overlap.rows[0])
        throw new DomainError('holiday.overlap', `Overlaps "${overlap.rows[0].name}"`, {
          status: 409,
        });
      const r = await c.query<HolidayRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `INSERT INTO holidays (school_id, academic_year_id, campus_id, name, kind, starts_on, ends_on, applies_to, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::holiday_kind, $5::date, $6::date, $7::audience_kind, app.current_user_id())
         RETURNING ${HOLIDAY_COLS}`,
        [yearId, dto.campusId ?? null, dto.name, dto.kind, dto.startsOn, endsOn, dto.appliesTo],
      );
      const created = r.rows[0]!;
      await this.audit.stage(ctx, c, {
        action: 'academics.holiday.create',
        entityType: 'holidays',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async removeHoliday(ctx: RequestContext, id: string): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<HolidayRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `DELETE FROM holidays WHERE id = $1 RETURNING ${HOLIDAY_COLS}`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Holiday not found');
      await this.audit.stage(ctx, c, {
        action: 'academics.holiday.delete',
        entityType: 'holidays',
        entityId: id,
        before: r.rows[0],
      });
    });
  }

  async createEvent(ctx: RequestContext, dto: CreateAlmanacEventDto): Promise<AlmanacRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.viewer.requireYear(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<AlmanacRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `INSERT INTO almanac_events (school_id, academic_year_id, title, kind, starts_on, ends_on, starts_at, description, audience, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::almanac_kind, $4::date, $5::date, $6::time, $7, $8::audience_kind, app.current_user_id(), app.current_user_id())
         RETURNING ${EVENT_COLS}`,
        [
          yearId,
          dto.title,
          dto.kind,
          dto.startsOn,
          dto.endsOn ?? dto.startsOn,
          dto.startsAt ?? null,
          dto.description ?? null,
          dto.audience,
        ],
      );
      const created = r.rows[0]!;
      await this.audit.stage(ctx, c, {
        action: 'academics.almanac.create',
        entityType: 'almanac_events',
        entityId: created.id,
        after: created,
      });
      return created;
    });
  }

  async removeEvent(ctx: RequestContext, id: string): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<AlmanacRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
        `UPDATE almanac_events SET deleted_at = now(), updated_by = app.current_user_id() WHERE id = $1 AND deleted_at IS NULL RETURNING ${EVENT_COLS}`,
        [id],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Event not found');
      await this.audit.stage(ctx, c, {
        action: 'academics.almanac.delete',
        entityType: 'almanac_events',
        entityId: id,
        before: r.rows[0],
      });
    });
  }
}
