import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { ClinicService } from '../engagement/clinic.service';
import { HelpdeskService } from '../engagement/helpdesk.service';
import {
  HOSTEL_H3,
  type ComplaintDto,
  type ComplaintsQueryDto,
  type DashboardQueryDto,
  type IncidentDto,
  type IncidentsQueryDto,
  type SickbayDto,
} from './hostel.dto';
import { HostelService } from './hostel.service';

const CATEGORY: Record<string, string> = {
  discipline: 'Discipline',
  health: 'Health',
  safety: 'Safety',
  property: 'Property',
  other: 'Other',
};

/**
 * Hostel module H4: the incident register (the parent told when the warden ticks it, a serious one to the
 * principal and school admins too), the warden's sick-bay note as a clinic visit, and the hostel dashboard
 * (today, the last days per hostel, and the hostel fee of the session).
 */
@Injectable()
export class HostelCareService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly hostel: HostelService,
    private readonly clinic: ClinicService,
    private readonly helpdesk: HelpdeskService,
  ) {}

  // ---- complaints (the helpdesk's hostel desk) ---------------------------------------------------------------
  private async familyChild(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
  }

  /** The heads of the hostel desk (Electrical, Plumbing …) for the complaint forms. */
  async complaintHeads(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.helpdesk_ensure_defaults()`);
      const r = await c.query(
        `SELECT code, name FROM query_categories WHERE desk = 'hostel' AND status = 'active' ORDER BY sort_order, name`,
      );
      return r.rows;
    });
  }

  async familyRaise(ctx: RequestContext, dto: ComplaintDto) {
    await this.familyChild(ctx, dto.studentId);
    return this.helpdesk.raiseHostelForFamily(ctx, dto);
  }

  private complaintRows(c: PoolClient, where: string, params: unknown[]) {
    return c.query(
      // eslint-disable-next-line no-restricted-syntax -- the filter is a fixed string of the callers; values bound
      `SELECT q.id::text, q.number, q.status::text, q.subject, q.body, COALESCE(k.name, q.category_code) AS head,
              h.name AS hostel, r.room_no AS room, s.display_name AS pupil, q.opened_at AS "openedAt", q.closed_at AS "closedAt",
              q.due_at AS "dueAt", q.level, q.resolution, q.rating, u.display_name AS "assignedTo",
              (q.status::text IN ('open', 'in_progress') AND q.due_at < now()) AS overdue
         FROM parent_queries q JOIN hostels h ON h.id = q.hostel_id
         LEFT JOIN hostel_rooms r ON r.id = q.hostel_room_id LEFT JOIN students s ON s.id = q.student_id
         LEFT JOIN query_categories k ON k.school_id = q.school_id AND k.desk = 'hostel' AND k.code = q.category_code
         LEFT JOIN users u ON u.id = q.assigned_user_id
        WHERE q.desk = 'hostel' AND ${where}
        ORDER BY q.opened_at DESC LIMIT 300`,
      params,
    );
  }

  async familyComplaints(ctx: RequestContext, studentId: string) {
    await this.familyChild(ctx, studentId);
    return this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.complaintRows(c, `q.student_id = $1`, [studentId])).rows,
    );
  }

  async complaints(ctx: RequestContext, q: ComplaintsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const status =
        q.show === 'open'
          ? `q.status::text <> 'closed'`
          : q.show === 'closed'
            ? `q.status::text = 'closed'`
            : `true`;
      return (
        await this.complaintRows(
          c,
          `${status} AND ($1::bigint IS NULL OR q.hostel_id = $1) AND ($2::bigint[] IS NULL OR q.hostel_id = ANY ($2::bigint[]))`,
          [q.hostelId ?? null, only],
        )
      ).rows;
    });
  }

  /** The hostel the pupil boards in today, refused when the user is a warden of another. */
  private async boardsIn(ctx: RequestContext, c: PoolClient, studentId: string) {
    const h = (
      await c.query<{ id: string | null; name: string | null }>(
        `SELECT h.id::text, h.name FROM hostels h WHERE h.id = app.hostel_of($1, (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
        [studentId],
      )
    ).rows[0];
    if (!h?.id)
      throw new DomainError('hostel.not_boarder', 'The pupil holds no hostel bed today', {
        status: 409,
      });
    const only = await this.hostel.scope(ctx, c);
    if (only && !only.includes(h.id))
      throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
        status: 403,
      });
    return { id: h.id, name: h.name! };
  }

  // ---- incidents ---------------------------------------------------------------------------------------------
  async recordIncident(ctx: RequestContext, dto: IncidentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.boardsIn(ctx, c, dto.studentId);
      const r = await c.query<{ id: string; who: string; school: string; at: string }>(
        `INSERT INTO hostel_incidents (school_id, student_id, hostel_id, occurred_at, category, severity, what, action, tell_parent, recorded_by)
         VALUES (app.current_school_id(), $1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8, app.current_user_id())
         RETURNING id::text, (SELECT display_name FROM students WHERE id = $1) AS who,
                   (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
                   to_char(occurred_at AT TIME ZONE 'Asia/Kolkata', 'DD-MM-YYYY HH24:MI') AS at`,
        [
          dto.studentId,
          h.id,
          dto.occurredAt ? `${dto.occurredAt.replace(' ', 'T')}:00+05:30` : null,
          dto.category,
          dto.severity,
          dto.what,
          dto.action ?? null,
          dto.tellParent,
        ],
      );
      const x = r.rows[0]!;
      const vars = JSON.stringify({
        who: x.who,
        hostel: h.name,
        category: CATEGORY[dto.category] ?? dto.category,
        when: x.at,
        what: dto.what.slice(0, 120),
        school: x.school ?? '',
      });
      if (dto.tellParent) {
        await c.query(
          `SELECT app.template_to_mobiles('hostel_incident_parent', ARRAY(
              SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
               WHERE sg.student_id = $1 AND sg.receives_notifications AND g.mobile IS NOT NULL), $2::jsonb)`,
          [dto.studentId, vars],
        );
        await c.query(`UPDATE hostel_incidents SET parent_told_at = now() WHERE id = $1`, [x.id]);
      }
      if (dto.severity === 'serious') {
        await c.query(
          `SELECT app.template_to_users('hostel_incident_serious', ARRAY(
              SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               WHERE ur.school_id = app.current_school_id() AND r.code = 'school_admin' AND ur.revoked_at IS NULL
                 AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
              UNION
              SELECT e.user_id FROM employees e
               WHERE lower(btrim(e.designation)) = 'principal' AND e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL), $1::jsonb)`,
          [vars],
        );
        await c.query(`UPDATE hostel_incidents SET principal_told_at = now() WHERE id = $1`, [
          x.id,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: 'hostel.incident.record',
        entityType: 'hostel_incident',
        entityId: x.id,
        after: dto,
      });
      return { id: x.id, parentTold: dto.tellParent, principalTold: dto.severity === 'serious' };
    });
  }

  async incidents(ctx: RequestContext, q: IncidentsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT i.id::text, i.student_id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
                h.name AS hostel, i.occurred_at AS "occurredAt", i.category, i.severity, i.what, i.action,
                i.tell_parent AS "tellParent", i.parent_told_at AS "parentToldAt", i.principal_told_at AS "principalToldAt",
                u.display_name AS "recordedBy"
           FROM hostel_incidents i JOIN students s ON s.id = i.student_id JOIN hostels h ON h.id = i.hostel_id
           LEFT JOIN users u ON u.id = i.recorded_by
          WHERE ($1::bigint IS NULL OR i.hostel_id = $1) AND ($2::bigint IS NULL OR i.student_id = $2)
            AND ($3::text IS NULL OR i.category = $3) AND ($4::date IS NULL OR i.occurred_at >= $4::date)
            AND ($5::bigint[] IS NULL OR i.hostel_id = ANY ($5::bigint[]))
          ORDER BY i.occurred_at DESC LIMIT 500`,
        [q.hostelId ?? null, q.studentId ?? null, q.category ?? null, q.from ?? null, only],
      );
      return r.rows;
    });
  }

  /** What the family was told: the incidents of the child the warden chose to share. */
  async familyIncidents(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT i.id::text, i.occurred_at AS "occurredAt", i.category, i.what, i.action, h.name AS hostel
           FROM hostel_incidents i JOIN hostels h ON h.id = i.hostel_id
          WHERE i.student_id = $1 AND i.tell_parent ORDER BY i.occurred_at DESC LIMIT 100`,
        [studentId],
      );
      return r.rows;
    });
  }

  // ---- sick bay ---------------------------------------------------------------------------------------------
  /** The warden's sick-bay note, recorded as a clinic visit (the clinic tells the family by its own rule). */
  async sickbay(ctx: RequestContext, dto: SickbayDto) {
    const hostelName = await this.db.tenant(
      requireTenant(ctx),
      async (c) => (await this.boardsIn(ctx, c, dto.studentId)).name,
    );
    const visit = await this.clinic.createVisit(ctx, {
      audience: 'student',
      studentId: dto.studentId,
      complaint: dto.complaint,
      temperatureC: dto.temperatureC,
      treatment: dto.treatment ?? '',
      remark: `Hostel sick bay (${hostelName})${dto.remark ? `: ${dto.remark}` : ''}`,
      outcome: dto.outcome,
      referredTo: dto.referredTo ?? '',
      diseaseIds: [],
      medicines: [],
    } as Parameters<ClinicService['createVisit']>[1]);
    return {
      id: (visit as { id: string }).id,
      notified: (visit as { notified?: unknown }).notified ?? null,
    };
  }

  /** Sick-bay notes of the boarders (the last days), from the clinic record. */
  async sickbayList(ctx: RequestContext, days: number) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT v.id::text, s.display_name AS name, s.admission_no AS "admissionNo", h.name AS hostel, v.in_at AS "inAt",
                v.complaint, v.temperature_c AS "temperatureC", v.treatment, v.outcome, v.referred_to AS "referredTo", v.remark
           FROM clinic_visits v JOIN students s ON s.id = v.student_id
           JOIN hostels h ON h.id = app.hostel_of(v.student_id, (v.in_at AT TIME ZONE 'Asia/Kolkata')::date)
          WHERE v.in_at >= now() - make_interval(days => $1::int)
            AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
          ORDER BY v.in_at DESC LIMIT 300`,
        [days, only],
      );
      return r.rows;
    });
  }

  // ---- dashboard --------------------------------------------------------------------------------------------
  async dashboard(ctx: RequestContext, q: DashboardQueryDto) {
    const yearId = requireTenant(ctx).academicYearId ?? null;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const grace = (
        await c.query<{ g: number }>(
          `SELECT COALESCE((SELECT late_grace_minutes FROM hostel_settings WHERE school_id = app.current_school_id()), 30) AS g`,
        )
      ).rows[0]!.g;
      const today = await c.query(
        `WITH hs AS (SELECT id, name FROM hostels WHERE status = 'active' AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[]))),
              d AS (SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS t)
         SELECT hs.id::text, hs.name,
           (SELECT count(*)::int FROM hostel_beds b JOIN hostel_rooms r ON r.id = b.room_id
             WHERE r.hostel_id = hs.id AND r.status = 'active' AND b.status = 'active') AS beds,
           (SELECT count(*)::int FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
             WHERE r.hostel_id = hs.id AND a.from_date <= d.t AND (a.to_date IS NULL OR a.to_date >= d.t)) AS boarders,
           (SELECT count(*)::int FROM gate_passes g WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.state = 'out'
             AND app.hostel_of(g.student_id, g.on_date) = hs.id) AS away,
           (SELECT count(*)::int FROM gate_passes g WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.state = 'out'
             AND g.return_by + make_interval(mins => $2::int) < now() AND app.hostel_of(g.student_id, g.on_date) = hs.id) AS overdue,
           (SELECT count(*)::int FROM hostel_rollcall_sessions s WHERE s.hostel_id = hs.id AND s.active) AS sessions,
           (SELECT count(*)::int FROM hostel_rollcalls r JOIN hostel_rollcall_sessions s ON s.id = r.session_id
             WHERE s.hostel_id = hs.id AND r.on_date = d.t) AS "rollsTaken",
           (SELECT count(*)::int FROM hostel_rollcall_marks m JOIN hostel_rollcalls r ON r.id = m.rollcall_id
              JOIN hostel_rollcall_sessions s ON s.id = r.session_id
             WHERE s.hostel_id = hs.id AND r.on_date = d.t AND m.status = 'absent') AS "absentToday",
           (SELECT count(*)::int FROM visitor_log v WHERE v.hostel_id = hs.id AND v.state = 'waiting') AS "visitorsWaiting",
           (SELECT count(*)::int FROM visitor_log v WHERE v.hostel_id = hs.id
             AND (v.created_at AT TIME ZONE 'Asia/Kolkata')::date = d.t) AS "visitsToday",
           (SELECT count(*)::int FROM hostel_meals m WHERE m.hostel_id = hs.id AND m.active) AS meals,
           (SELECT count(*)::int FROM hostel_meal_marks k JOIN hostel_meals m ON m.id = k.meal_id
             WHERE m.hostel_id = hs.id AND k.on_date = d.t) AS "mealsMarked",
           (SELECT count(*)::int FROM hostel_visitors v WHERE v.status = 'pending'
             AND app.hostel_of(v.student_id, d.t) = hs.id) AS "visitorsToApprove",
           (SELECT count(*)::int FROM parent_queries pq WHERE pq.desk = 'hostel' AND pq.hostel_id = hs.id
             AND pq.status::text IN ('open', 'in_progress')) AS "openComplaints",
           (SELECT count(*)::int FROM parent_queries pq WHERE pq.desk = 'hostel' AND pq.hostel_id = hs.id
             AND pq.status::text IN ('open', 'in_progress') AND pq.due_at < now()) AS "complaintsOverdue"
         FROM hs, d ORDER BY hs.name`,
        [only, grace],
      );
      const trends = await c.query(
        `WITH hs AS (SELECT id FROM hostels WHERE status = 'active' AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[]))),
              days AS (SELECT generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ($2::int - 1),
                                              (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day')::date AS d)
         SELECT days.d::text AS day,
           (SELECT count(*)::int FROM hostel_rollcall_marks m JOIN hostel_rollcalls r ON r.id = m.rollcall_id
              JOIN hostel_rollcall_sessions s ON s.id = r.session_id
             WHERE r.on_date = days.d AND m.status = 'absent' AND s.hostel_id IN (SELECT id FROM hs)) AS absences,
           (SELECT count(*)::int FROM gate_passes g WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.late_minutes IS NOT NULL
             AND (g.in_at AT TIME ZONE 'Asia/Kolkata')::date = days.d AND app.hostel_of(g.student_id, g.on_date) IN (SELECT id FROM hs)) AS "lateReturns",
           (SELECT count(*)::int FROM gate_passes g WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.out_at IS NOT NULL
             AND (g.out_at AT TIME ZONE 'Asia/Kolkata')::date = days.d AND app.hostel_of(g.student_id, g.on_date) IN (SELECT id FROM hs)) AS leaves,
           (SELECT count(*)::int FROM visitor_log v WHERE v.hostel_id IN (SELECT id FROM hs)
             AND (v.created_at AT TIME ZONE 'Asia/Kolkata')::date = days.d) AS visits,
           (SELECT count(*)::int FROM parent_queries pq WHERE pq.desk = 'hostel' AND pq.hostel_id IN (SELECT id FROM hs)
             AND (pq.opened_at AT TIME ZONE 'Asia/Kolkata')::date = days.d) AS "complaintsRaised",
           (SELECT count(*)::int FROM hostel_meal_skips k JOIN hostel_meal_marks mk ON mk.id = k.mark_id JOIN hostel_meals m ON m.id = mk.meal_id
             WHERE mk.on_date = days.d AND m.hostel_id IN (SELECT id FROM hs)) AS "mealsSkipped",
           (SELECT count(*)::int FROM hostel_incidents i WHERE i.hostel_id IN (SELECT id FROM hs)
             AND (i.occurred_at AT TIME ZONE 'Asia/Kolkata')::date = days.d) AS incidents
         FROM days ORDER BY days.d`,
        [only, q.days],
      );
      // the hostel fee of the session for the pupils boarding in each hostel today
      const fee = yearId
        ? await c.query(
            `WITH hs AS (SELECT id, name FROM hostels WHERE status = 'active' AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[]))),
                  b AS (SELECT a.student_id, r.hostel_id FROM hostel_allotments a JOIN hostel_beds bd ON bd.id = a.bed_id
                          JOIN hostel_rooms r ON r.id = bd.room_id
                         WHERE a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
                           AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date))
             SELECT hs.id::text, hs.name,
                    COALESCE(sum(d.net), 0)::text AS demand, COALESCE(sum(d.paid), 0)::text AS paid,
                    COALESCE(sum(d.net - d.paid) FILTER (WHERE d.due_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date), 0)::text AS "dueNow"
               FROM hs LEFT JOIN b ON b.hostel_id = hs.id
               LEFT JOIN fee_demands d ON d.student_id = b.student_id AND d.academic_year_id = $2 AND d.ledger = 'hostel'
                    AND d.status IN ('pending', 'partial', 'paid')
              GROUP BY hs.id, hs.name ORDER BY hs.name`,
            [only, yearId],
          )
        : { rows: [] };
      return { days: q.days, hostels: today.rows, trends: trends.rows, fee: fee.rows };
    });
  }
}
