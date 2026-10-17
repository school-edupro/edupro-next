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
  type IncidentNoteDto,
  type IncidentsFileDto,
  type IncidentsQueryDto,
  type SickbayDto,
} from './hostel.dto';
import { HostelService } from './hostel.service';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';

type Row = Record<string, unknown>;
const STATUS: Record<string, string> = {
  open: 'Open',
  follow_up: 'In follow-up',
  closed: 'Closed',
};

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
      if (dto.closeNow && dto.severity === 'serious')
        throw new DomainError(
          'hostel.incident_serious_open',
          'A serious incident stays open until it is closed with a remark',
          { status: 422 },
        );
      await this.helpdesk.checkFiles(c, dto.fileIds);
      const r = await c.query<{ id: string; who: string; school: string; at: string }>(
        `INSERT INTO hostel_incidents (school_id, student_id, hostel_id, occurred_at, category, severity, what, action, tell_parent, recorded_by,
                                       file_ids, status, closed_at, closed_by, closing_remark)
         VALUES (app.current_school_id(), $1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8, app.current_user_id(),
                 $9::bigint[], CASE WHEN $10 THEN 'closed' ELSE 'open' END, CASE WHEN $10 THEN now() END,
                 CASE WHEN $10 THEN app.current_user_id() END, CASE WHEN $10 THEN COALESCE($7, 'Dealt with when recorded') END)
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
          dto.fileIds,
          dto.closeNow,
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
      return {
        id: x.id,
        parentTold: dto.tellParent,
        principalTold: dto.severity === 'serious',
        status: dto.closeNow ? 'closed' : 'open',
      };
    });
  }

  /** The incidents the person sees, filtered (the open ones first when no status is asked). */
  private async incidentRows(
    ctx: RequestContext,
    c: PoolClient,
    q: Omit<IncidentsQueryDto, 'page' | 'size'>,
    page?: { page: number; size: number },
  ) {
    const only = await this.hostel.scope(ctx, c);
    const params = [
      q.hostelId ?? null,
      q.studentId ?? null,
      q.category ?? null,
      q.from ?? null,
      only,
      q.severity ?? null,
      q.status ?? null,
      q.to ?? null,
      q.q ?? null,
    ];
    const where = `FROM hostel_incidents i JOIN students s ON s.id = i.student_id JOIN hostels h ON h.id = i.hostel_id
          WHERE ($1::bigint IS NULL OR i.hostel_id = $1) AND ($2::bigint IS NULL OR i.student_id = $2)
            AND ($3::text IS NULL OR i.category = $3)
            AND ($4::date IS NULL OR (i.occurred_at AT TIME ZONE 'Asia/Kolkata')::date >= $4::date)
            AND ($5::bigint[] IS NULL OR i.hostel_id = ANY ($5::bigint[]))
            AND ($6::text IS NULL OR i.severity = $6)
            AND ($7::text IS NULL OR i.status = $7 OR ($7 = 'not_closed' AND i.status <> 'closed'))
            AND ($8::date IS NULL OR (i.occurred_at AT TIME ZONE 'Asia/Kolkata')::date <= $8::date)
            AND ($9::text IS NULL OR s.search_text LIKE '%' || app.search_text($9) || '%')`;
    const counts = await c.query<{ status: string; n: number }>(
      // eslint-disable-next-line no-restricted-syntax -- the FROM/WHERE is a constant; values bound
      `SELECT i.status, count(*)::int AS n ${where} GROUP BY i.status`,
      params,
    );
    const limit = page
      ? // eslint-disable-next-line no-restricted-syntax -- LIMIT/OFFSET from validated numbers
        `LIMIT ${String(page.size)} OFFSET ${String((page.page - 1) * page.size)}`
      : 'LIMIT 5000';
    const r = await c.query<Row>(
      // eslint-disable-next-line no-restricted-syntax -- the FROM/WHERE is a constant, LIMIT from numbers; values bound
      `SELECT i.id::text, i.student_id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
              h.id::text AS "hostelId", h.name AS hostel, i.occurred_at AS "occurredAt", i.category, i.severity, i.what, i.action,
              i.tell_parent AS "tellParent", i.parent_told_at AS "parentToldAt", i.principal_told_at AS "principalToldAt",
              (SELECT u.display_name FROM users u WHERE u.id = i.recorded_by) AS "recordedBy",
              i.status, i.closed_at AS "closedAt", i.closing_remark AS "closingRemark",
              (SELECT u.display_name FROM users u WHERE u.id = i.closed_by) AS "closedBy",
              cardinality(i.file_ids) + (SELECT COALESCE(sum(cardinality(n.file_ids)), 0)::int FROM hostel_incident_notes n WHERE n.incident_id = i.id) AS files,
              (SELECT count(*)::int FROM hostel_incident_notes n WHERE n.incident_id = i.id) AS notes
       ${where}
       ORDER BY CASE WHEN $7::text IS NULL AND i.status <> 'closed' THEN 0 ELSE 1 END, i.occurred_at DESC, i.id DESC ${limit}`,
      params,
    );
    const by = Object.fromEntries(counts.rows.map((x) => [x.status, x.n]));
    return {
      data: r.rows,
      total: counts.rows.reduce((n, x) => n + x.n, 0),
      counts: { open: by.open ?? 0, follow_up: by.follow_up ?? 0, closed: by.closed ?? 0 },
    };
  }

  async incidents(ctx: RequestContext, q: IncidentsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => ({
      ...(await this.incidentRows(ctx, c, q, { page: q.page, size: q.size })),
      page: q.page,
      size: q.size,
    }));
  }

  /** One incident with its follow-up notes and files (a warden of its hostel, or the office). */
  private async incidentOf(ctx: RequestContext, c: PoolClient, id: string) {
    const r = await c.query<Row>(
      `SELECT i.id::text, i.student_id::text AS "studentId", s.display_name AS name, s.admission_no AS "admissionNo",
              h.id::text AS "hostelId", h.name AS hostel, i.occurred_at AS "occurredAt", i.category, i.severity, i.what, i.action,
              i.tell_parent AS "tellParent", i.parent_told_at AS "parentToldAt", i.principal_told_at AS "principalToldAt",
              (SELECT u.display_name FROM users u WHERE u.id = i.recorded_by) AS "recordedBy", i.created_at AS "recordedAt",
              i.status, i.closed_at AS "closedAt", i.closing_remark AS "closingRemark",
              (SELECT u.display_name FROM users u WHERE u.id = i.closed_by) AS "closedBy", i.file_ids::text[] AS "fileIds"
         FROM hostel_incidents i JOIN students s ON s.id = i.student_id JOIN hostels h ON h.id = i.hostel_id WHERE i.id = $1`,
      [id],
    );
    const x = r.rows[0];
    const only = await this.hostel.scope(ctx, c);
    if (!x || (only && !only.includes(String(x.hostelId))))
      throw new DomainError('not-found', 'Incident not found', { status: 404 });
    const notes = await c.query<Row>(
      `SELECT n.id::text, n.body, n.status_to AS "statusTo", n.file_ids::text[] AS "fileIds", n.at,
              COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = n.by_user LIMIT 1), u.display_name) AS by
         FROM hostel_incident_notes n LEFT JOIN users u ON u.id = n.by_user WHERE n.incident_id = $1 ORDER BY n.at, n.id`,
      [id],
    );
    return { ...x, status: String(x.status), notes: notes.rows };
  }

  async incident(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.incidentOf(ctx, c, id));
  }

  /**
   * A follow-up note; it may move the incident: to follow-up, back to open, or closed (the note is the
   * closing remark). A closed incident takes a note only when it is reopened.
   */
  async addIncidentNote(ctx: RequestContext, id: string, dto: IncidentNoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const i = await this.incidentOf(ctx, c, id);
      if (i.status === 'closed' && (!dto.statusTo || dto.statusTo === 'closed'))
        throw new DomainError(
          'hostel.incident_closed',
          'This incident is closed: reopen it (open or follow-up) to add a note',
          { status: 409 },
        );
      await this.helpdesk.checkFiles(c, dto.fileIds);
      const to = dto.statusTo && dto.statusTo !== i.status ? dto.statusTo : null;
      await c.query(
        `INSERT INTO hostel_incident_notes (school_id, incident_id, body, status_to, file_ids, by_user)
         VALUES (app.current_school_id(), $1, $2, $3, $4::bigint[], app.current_user_id())`,
        [id, dto.body, to, dto.fileIds],
      );
      if (to)
        await c.query(
          `UPDATE hostel_incidents SET status = $2, updated_at = now(),
                  closed_at = CASE WHEN $2 = 'closed' THEN now() END,
                  closed_by = CASE WHEN $2 = 'closed' THEN app.current_user_id() END,
                  closing_remark = CASE WHEN $2 = 'closed' THEN $3 END
            WHERE id = $1`,
          [id, to, dto.body],
        );
      await this.audit.stage(ctx, c, {
        action: to === 'closed' ? 'hostel.incident.close' : 'hostel.incident.note',
        entityType: 'hostel_incident',
        entityId: id,
        after: { statusTo: to, files: dto.fileIds.length },
      });
      return this.incidentOf(ctx, c, id);
    });
  }

  async incidentsFile(ctx: RequestContext, q: IncidentsFileDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.incidentRows(ctx, c, q);
      const head = await schoolHead(c);
      const day = (v: unknown) =>
        v instanceof Date
          ? v.toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            })
          : '';
      const dmy = (d?: string) => (d ? d.split('-').reverse().join('-') : '');
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Hostel incident register',
          details: [
            q.hostelId ? String(r.data[0]?.hostel ?? '') : 'All hostels',
            q.from || q.to ? `${dmy(q.from) || '...'} to ${dmy(q.to) || '...'}` : '',
            `${String(r.total)} incident(s): ${String(r.counts.open)} open, ${String(r.counts.follow_up)} in follow-up, ${String(r.counts.closed)} closed`,
            generatedOn(),
          ].filter(Boolean),
          legend:
            'Parent: told by message and shown in the parent app. Principal: a serious incident is sent to the principal and school admins.',
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'When', width: 9 },
            { label: 'Pupil', width: 12 },
            { label: 'Adm. no.', width: 6 },
            { label: 'Hostel', width: 8 },
            { label: 'Category', width: 6 },
            { label: 'Severity', width: 5 },
            { label: 'What happened', width: 22 },
            { label: 'Action taken', width: 16 },
            { label: 'Parent', width: 4 },
            { label: 'Status', width: 6 },
            { label: 'Closing remark', width: 14 },
            { label: 'Recorded by', width: 8 },
          ],
          rows: r.data.map((x, i) => [
            i + 1,
            day(x.occurredAt),
            String(x.name),
            String(x.admissionNo ?? ''),
            String(x.hostel),
            CATEGORY[String(x.category)] ?? String(x.category),
            x.severity === 'serious' ? 'Serious' : 'Minor',
            String(x.what),
            String(x.action ?? ''),
            x.tellParent ? 'Told' : '',
            STATUS[String(x.status)] ?? String(x.status),
            String(x.closingRemark ?? ''),
            String(x.recordedBy ?? ''),
          ]),
          fontSize: 7,
          filename: 'hostel-incident-register',
        },
        q.format,
      );
    });
  }

  /** What the family was told: the incidents of the child the warden chose to share. */
  async familyIncidents(ctx: RequestContext, studentId: string) {
    const v = await this.viewer.resolve(ctx, HOSTEL_H3.family);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Pupil not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT i.id::text, i.occurred_at AS "occurredAt", i.category, i.what, i.action, h.name AS hostel, i.status
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
