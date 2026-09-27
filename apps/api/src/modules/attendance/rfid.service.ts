import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateDeviceDto, RfidEventsQueryDto, RfidIngestDto } from './attendance.dto';

const publicTenant = (schoolId: string): TenantContext => ({
  schoolId,
  userId: null,
  allowedSchoolIds: [schoolId],
  academicYearId: null,
});
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * RFID ingestion v1 (S9-04): devices authenticate with a per-device key; taps map tags to students; the
 * first IN of the day marks present (late after the cutoff), the last OUT is recorded, repeated taps within
 * a minute are dropped, holidays and weekly offs are ignored, and a manual mark is never overwritten.
 */
@Injectable()
export class RfidService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async devices(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        code: string;
        name: string;
        campus: string | null;
        direction: string | null;
        status: string;
        last_seen_at: Date | null;
        events: number;
      }>(
        `SELECT d.id::text, d.code, d.name, ca.name AS campus, d.direction::text, d.status::text, d.last_seen_at,
                (SELECT count(*)::int FROM rfid_events e WHERE e.device_id = d.id AND e.occurred_at > now() - interval '1 day') AS events
           FROM rfid_devices d LEFT JOIN campuses ca ON ca.id = d.campus_id ORDER BY d.code`,
      );
      return r.rows.map((x) => ({
        id: x.id,
        code: x.code,
        name: x.name,
        campus: x.campus,
        direction: x.direction,
        status: x.status,
        lastSeenAt: x.last_seen_at ? x.last_seen_at.toISOString() : null,
        eventsToday: x.events,
      }));
    });
  }

  /** Registers a device and returns its key once; only the hash is stored. */
  async createDevice(ctx: RequestContext, dto: CreateDeviceDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const key = `dev_${randomBytes(24).toString('hex')}`;
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO rfid_devices (school_id, code, name, campus_id, direction, api_key_hash, created_by) VALUES (app.current_school_id(), $1, $2, $3, $4::rfid_direction, $5, app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.campusId ?? null, dto.direction ?? null, hashKey(key)],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Device "${dto.code}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'attendance.rfid.device_create',
        entityType: 'rfid_devices',
        entityId: id,
        after: { code: dto.code, name: dto.name },
      });
      return { id, code: dto.code, apiKey: key };
    });
  }

  async events(ctx: RequestContext, q: RfidEventsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        device: string;
        tag: string;
        student: string | null;
        occurred_at: Date;
        direction: string;
        outcome: string;
      }>(
        `SELECT e.id::text, d.code AS device, e.tag, s.display_name AS student, e.occurred_at, e.direction::text, e.outcome
           FROM rfid_events e JOIN rfid_devices d ON d.id = e.device_id LEFT JOIN students s ON s.id = e.student_id
          WHERE ($1::date IS NULL OR (e.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date)
          ORDER BY e.occurred_at DESC LIMIT $2`,
        [q.date ?? null, q.limit],
      );
      return r.rows.map((x) => ({
        id: x.id,
        device: x.device,
        tag: x.tag,
        student: x.student,
        occurredAt: x.occurred_at.toISOString(),
        direction: x.direction,
        outcome: x.outcome,
      }));
    });
  }

  async ingest(dto: RfidIngestDto, apiKey: string | undefined) {
    const lookup = await this.db.global(async (c) => {
      const r = await c.query<{
        school_id: string;
        device_id: string;
        api_key_hash: string;
        status: string;
        direction: string | null;
      }>(
        `SELECT school_id::text, device_id::text, api_key_hash, status::text, direction::text FROM app.rfid_device_lookup($1, $2)`,
        [dto.school, dto.device],
      );
      return r.rows[0] ?? null;
    });
    const given = Buffer.from(hashKey(apiKey ?? ''), 'utf8');
    const expected = Buffer.from(lookup?.api_key_hash ?? '0'.repeat(64), 'utf8');
    if (!lookup || given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new DomainError('device-unauthenticated', 'Unknown device or wrong key', {
        status: 401,
      });
    if (lookup.status !== 'active')
      throw new DomainError('device-inactive', 'The device is inactive', { status: 403 });
    return this.db.tenant(publicTenant(lookup.school_id), async (c) => {
      const outcomes: Record<string, number> = {};
      const settings = await c.query<{
        late_after: string | null;
        weekly_off: unknown;
        year_id: string | null;
      }>(
        `SELECT app.setting('attendance.rfid_late_after') #>> '{}' AS late_after, app.setting('attendance.weekly_off') AS weekly_off,
                (SELECT id::text FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1) AS year_id`,
      );
      const lateAfter = settings.rows[0]?.late_after ?? '09:00';
      const weeklyOff = Array.isArray(settings.rows[0]?.weekly_off)
        ? (settings.rows[0]!.weekly_off as number[])
        : [7];
      const yearId = settings.rows[0]?.year_id;
      for (const ev of dto.events) {
        const direction = ev.direction ?? lookup.direction ?? 'in';
        let outcome = 'ignored';
        let studentId: string | null = null;
        const st = await c.query<{ id: string; section_id: string | null }>(
          `SELECT s.id::text, (SELECT e.class_section_id::text FROM enrolments e WHERE e.student_id = s.id AND e.academic_year_id = $2::bigint AND e.status = 'active' LIMIT 1) AS section_id
             FROM students s WHERE s.rfid_tag = $1 AND s.deleted_at IS NULL AND s.status = 'active'`,
          [ev.tag, yearId ?? null],
        );
        if (!st.rows[0]) outcome = 'unknown_tag';
        else if (!st.rows[0].section_id || !yearId) {
          studentId = st.rows[0].id;
          outcome = 'no_enrolment';
        } else {
          studentId = st.rows[0].id;
          const day = await c.query<{
            date: string;
            time: string;
            dow: number;
            holiday: boolean;
            dup: boolean;
          }>(
            `SELECT to_char($1::timestamptz AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date, to_char($1::timestamptz AT TIME ZONE 'Asia/Kolkata', 'HH24:MI') AS time,
                    EXTRACT(ISODOW FROM ($1::timestamptz AT TIME ZONE 'Asia/Kolkata'))::int AS dow,
                    EXISTS (SELECT 1 FROM holidays h WHERE h.academic_year_id = $3 AND h.starts_on <= ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AND h.ends_on >= ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AND h.applies_to IN ('everyone', 'students') AND h.kind <> 'working_day') AS holiday,
                    EXISTS (SELECT 1 FROM rfid_events r WHERE r.student_id = $2 AND r.direction = $4::rfid_direction AND r.occurred_at BETWEEN $1::timestamptz - interval '60 seconds' AND $1::timestamptz + interval '60 seconds' AND r.outcome NOT IN ('duplicate')) AS dup`,
            [ev.at, studentId, yearId, direction],
          );
          const d = day.rows[0]!;
          if (d.dup) outcome = 'duplicate';
          else if (d.holiday || weeklyOff.includes(d.dow)) outcome = 'holiday';
          else {
            const session = await c.query<{ id: string; locked: boolean }>(
              `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_at)
               VALUES (app.current_school_id(), $1, $2, $3::date, 'day', 'rfid', now())
               ON CONFLICT (class_section_id, on_date, kind, (COALESCE(subject_id, 0)), (COALESCE(period_id, 0))) DO UPDATE SET updated_at = now()
               RETURNING id::text, locked`,
              [yearId, st.rows[0].section_id, d.date],
            );
            const sessionId = session.rows[0]!.id;
            const mark = await c.query<{ id: string; source: string; in_at: Date | null }>(
              `SELECT id::text, source::text, in_at FROM attendance_marks WHERE session_id = $1 AND student_id = $2`,
              [sessionId, studentId],
            );
            const existing = mark.rows[0];
            if (session.rows[0]!.locked) outcome = 'locked';
            else if (direction === 'in') {
              if (existing?.source === 'manual') outcome = 'manual_kept';
              else if (existing?.in_at) outcome = 'duplicate';
              else {
                const code = d.time <= lateAfter ? 'P' : 'L';
                await c.query(
                  `INSERT INTO attendance_marks (school_id, session_id, student_id, code, in_at, source) VALUES (app.current_school_id(), $1, $2, $3::attendance_code, $4::timestamptz, 'rfid')
                   ON CONFLICT (session_id, student_id) DO UPDATE SET code = EXCLUDED.code, in_at = EXCLUDED.in_at, source = 'rfid', updated_at = now()`,
                  [sessionId, studentId, code, ev.at],
                );
                outcome = code === 'P' ? 'marked_present' : 'marked_late';
              }
            } else {
              await c.query(
                `INSERT INTO attendance_marks (school_id, session_id, student_id, code, out_at, source) VALUES (app.current_school_id(), $1, $2, 'P', $3::timestamptz, 'rfid')
                 ON CONFLICT (session_id, student_id) DO UPDATE SET out_at = GREATEST(COALESCE(attendance_marks.out_at, EXCLUDED.out_at), EXCLUDED.out_at), updated_at = now()`,
                [sessionId, studentId, ev.at],
              );
              outcome = 'out_recorded';
            }
          }
        }
        await c.query(
          `INSERT INTO rfid_events (school_id, device_id, tag, student_id, occurred_at, direction, outcome, raw) VALUES (app.current_school_id(), $1, $2, $3, $4::timestamptz, $5::rfid_direction, $6, $7::jsonb)`,
          [lookup.device_id, ev.tag, studentId, ev.at, direction, outcome, JSON.stringify(ev)],
        );
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      await c.query(`UPDATE rfid_devices SET last_seen_at = now() WHERE id = $1`, [
        lookup.device_id,
      ]);
      return { received: dto.events.length, outcomes };
    });
  }
}
