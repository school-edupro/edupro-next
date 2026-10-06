import { Injectable, Logger } from '@nestjs/common';
import { AttendanceGate, suggest, type Hint, type WindowState } from './attendance-gate';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import type { SendMessageDto } from '../comms/comms.dto';
import { MessagesService } from '../comms/messages.service';
import type {
  LockDto,
  MarkSessionDto,
  MineQueryDto,
  SessionQueryDto,
  StudentRangeQueryDto,
  SummaryQueryDto,
} from './attendance.dto';

export type Code = 'P' | 'A' | 'L' | 'SR' | 'H' | 'OD' | 'SB' | 'LV';

export interface RosterRow {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  code: Code | null;
  remarks: string | null;
  inAt: string | null;
  outAt: string | null;
  source: string | null;
  /** An approved leave or a gate pass of the day. */
  hint: Hint | null;
  /** What the roster pre-fills while nobody has marked the pupil (from the leave or the gate pass). */
  suggested: string | null;
  /** On approved leave: marked as leave, and only a coordinator or admin may change it. */
  locked: boolean;
}

export interface SessionRow {
  id: string | null;
  classSectionId: string;
  section: string;
  date: string;
  kind: 'day' | 'subject';
  subjectId: string | null;
  subjectName: string | null;
  source: string | null;
  markedBy: string | null;
  markedAt: string | null;
  locked: boolean;
  markedLate: boolean;
  /** The marking window for the person asking. */
  window: WindowState;
  roster: RosterRow[];
  counts: Record<string, number>;
}

/**
 * Attendance sessions and marks (S9-04): weekday and holiday rules, class-section scope, subject attendance,
 * absent alerts through the notification service. RFID ingestion writes the same tables (see RfidService).
 */
@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly viewer: ViewerService,
    private readonly messages: MessagesService,
    private readonly gate: AttendanceGate,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  /** Not in the future, not a weekly off, not a holiday for students, and the year's attendance stage open. */
  async assertMarkableDate(c: PoolClient, date: string, yearId: string): Promise<void> {
    await c.query(`SELECT app.assert_year_open($1, 'attendance')`, [yearId]);
    const check = await c.query<{
      future: boolean;
      dow: number;
      weekly_off: unknown;
      holiday: string | null;
    }>(
      `SELECT $1::date > CURRENT_DATE AS future, EXTRACT(ISODOW FROM $1::date)::int AS dow, app.setting('attendance.weekly_off') AS weekly_off,
              (SELECT name FROM holidays WHERE academic_year_id = $2 AND starts_on <= $1::date AND ends_on >= $1::date AND applies_to IN ('everyone', 'students') AND kind <> 'working_day' LIMIT 1) AS holiday`,
      [date, yearId],
    );
    const row = check.rows[0]!;
    if (row.future)
      throw new DomainError(
        'attendance.future_date',
        'Attendance cannot be marked for a future date',
        { status: 409 },
      );
    const weeklyOff = Array.isArray(row.weekly_off) ? (row.weekly_off as number[]) : [7];
    if (weeklyOff.includes(row.dow))
      throw new DomainError('attendance.weekly_off', 'That day is a weekly off', { status: 409 });
    if (row.holiday)
      throw new DomainError('attendance.holiday', `That day is a holiday (${row.holiday})`, {
        status: 409,
        extra: { holiday: row.holiday },
      });
  }

  /** Coordinators and admins (not scoped to sections) run attendance: the teacher's window does not bind them. */
  private async isManager(tenant: TenantContext): Promise<boolean> {
    return (await this.scopes.filter(tenant, 'attendance.session.mark', 'class_section')) === null;
  }

  /** A scoped teacher may mark only sections assigned to them with the attendance flag (subject teachers their subject). */
  private async assertMayMark(
    c: PoolClient,
    tenant: TenantContext,
    yearId: string,
    sectionId: string,
    kind: 'day' | 'subject',
    subjectId?: string,
  ): Promise<void> {
    await this.scopes.assert(tenant, 'attendance.session.mark', 'class_section', sectionId);
    const allowed = await this.scopes.filter(tenant, 'attendance.session.mark', 'class_section');
    if (allowed === null) return;
    const r = await c.query(
      `SELECT 1 FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL AND ta.can_mark_attendance
          AND (ta.kind IN ('class_teacher', 'coordinator') OR ($3 = 'subject' AND ta.kind = 'subject_teacher' AND ta.subject_id = $4::bigint))
        LIMIT 1`,
      [sectionId, yearId, kind, subjectId ?? null],
    );
    if (r.rowCount === 0)
      throw new DomainError(
        'attendance.not_assigned',
        'You are not assigned to mark attendance for this section (or subject)',
        { status: 403 },
      );
  }

  private async roster(
    c: PoolClient,
    yearId: string,
    sectionId: string,
    sessionId: string | null,
  ): Promise<RosterRow[]> {
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
      code: Code | null;
      remarks: string | null;
      in_at: Date | null;
      out_at: Date | null;
      source: string | null;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no, m.code::text, m.remarks, m.in_at, m.out_at, m.source::text
         FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         LEFT JOIN attendance_marks m ON m.student_id = s.id AND m.session_id = $3::bigint
        WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
        ORDER BY e.roll_no NULLS LAST, s.display_name`,
      [sectionId, yearId, sessionId],
    );
    return r.rows.map((x) => ({
      studentId: x.student_id,
      name: x.name,
      admissionNo: x.admission_no,
      rollNo: x.roll_no,
      code: x.code,
      remarks: x.remarks,
      inAt: x.in_at ? x.in_at.toISOString() : null,
      outAt: x.out_at ? x.out_at.toISOString() : null,
      source: x.source,
      hint: null,
      suggested: null,
      locked: false,
    }));
  }

  private counts(roster: RosterRow[]): Record<string, number> {
    const counts: Record<string, number> = { strength: roster.length, unmarked: 0 };
    for (const r of roster) {
      if (!r.code) counts.unmarked = (counts.unmarked ?? 0) + 1;
      else counts[r.code] = (counts[r.code] ?? 0) + 1;
    }
    return counts;
  }

  async sessionWith(
    c: PoolClient,
    yearId: string,
    q: {
      classSectionId: string;
      date: string;
      kind: 'day' | 'subject';
      subjectId?: string;
      periodId?: string;
    },
    /** The person asking runs attendance (not bound to the teacher's window). */
    manager = false,
  ): Promise<SessionRow> {
    const s = await c.query<{
      id: string;
      section: string;
      subject_id: string | null;
      subject_name: string | null;
      source: string;
      marked_by: string | null;
      marked_at: Date | null;
      locked: boolean;
      marked_late: boolean;
    }>(
      `SELECT a.id::text, a.marked_late, c.code || '-' || cs.name AS section, a.subject_id::text, sub.name AS subject_name, a.source::text, COALESCE((SELECT trim(e.first_name || ' ' || COALESCE(e.last_name, '')) FROM employees e WHERE e.user_id = a.marked_by LIMIT 1), u.display_name) AS marked_by, a.marked_at, a.locked
         FROM attendance_sessions a JOIN class_sections cs ON cs.id = a.class_section_id JOIN classes c ON c.id = cs.class_id
         LEFT JOIN subjects sub ON sub.id = a.subject_id LEFT JOIN users u ON u.id = a.marked_by
        WHERE a.class_section_id = $1 AND a.on_date = $2::date AND a.kind = $3::attendance_kind AND COALESCE(a.subject_id, 0) = COALESCE($4::bigint, 0) AND COALESCE(a.period_id, 0) = COALESCE($5::bigint, 0)`,
      [q.classSectionId, q.date, q.kind, q.subjectId ?? null, q.periodId ?? null],
    );
    const row = s.rows[0];
    const label = await c.query<{ section: string }>(
      `SELECT c.code || '-' || cs.name AS section FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = $1`,
      [q.classSectionId],
    );
    if (!label.rows[0]) throw new DomainError('not-found', 'Section not found');
    const roster = await this.roster(c, yearId, q.classSectionId, row?.id ?? null);
    if (q.kind === 'day') {
      const hints = await this.gate.hints(
        c,
        roster.map((x) => x.studentId),
        q.date,
      );
      for (const x of roster) {
        x.hint = hints.get(x.studentId) ?? null;
        x.suggested = x.code ? null : suggest(x.hint ?? undefined, 'class');
        x.locked = Boolean(x.hint?.leave) && !manager;
        if (x.locked && x.code !== 'LV') x.suggested = 'LV';
      }
    }
    const window = await this.gate.state(
      c,
      { scope: 'class', classSectionId: q.classSectionId },
      q.date,
      manager,
    );
    return {
      id: row?.id ?? null,
      classSectionId: q.classSectionId,
      section: label.rows[0].section,
      date: q.date,
      kind: q.kind,
      subjectId: q.subjectId ?? null,
      subjectName: row?.subject_name ?? null,
      source: row?.source ?? null,
      markedBy: row?.marked_by ?? null,
      markedAt: row?.marked_at ? row.marked_at.toISOString() : null,
      locked: row?.locked ?? false,
      markedLate: row?.marked_late ?? false,
      window,
      roster,
      counts: this.counts(roster),
    };
  }

  async session(ctx: RequestContext, q: SessionQueryDto): Promise<SessionRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    await this.scopes.assert(tenant, 'attendance.session.view', 'class_section', q.classSectionId);
    const manager = await this.isManager(tenant);
    return this.db.tenant(tenant, (c) => this.sessionWith(c, yearId, q, manager));
  }

  async mark(
    ctx: RequestContext,
    dto: MarkSessionDto,
  ): Promise<SessionRow & { alertsSent: number }> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const result = await this.db.tenant(tenant, async (c) => {
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
      await this.assertMayMark(c, tenant, yearId, dto.classSectionId, dto.kind, dto.subjectId);
      await this.assertMarkableDate(c, dto.date, yearId);
      // the school's marking window: a teacher inside it; later the coordinator marks or reopens the day
      const manager = await this.isManager(tenant);
      const window = await this.gate.assertOpen(
        c,
        { scope: 'class', classSectionId: dto.classSectionId },
        dto.date,
        manager,
      );
      const existing = await c.query<{ id: string; locked: boolean }>(
        `SELECT id::text, locked FROM attendance_sessions WHERE class_section_id = $1 AND on_date = $2::date AND kind = $3::attendance_kind AND COALESCE(subject_id, 0) = COALESCE($4::bigint, 0) AND COALESCE(period_id, 0) = COALESCE($5::bigint, 0) FOR UPDATE`,
        [dto.classSectionId, dto.date, dto.kind, dto.subjectId ?? null, dto.periodId ?? null],
      );
      if (existing.rows[0]?.locked)
        throw new DomainError('attendance.locked', 'This session is locked', { status: 409 });
      let sessionId = existing.rows[0]?.id;
      if (!sessionId) {
        const ins = await c.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, subject_id, period_id, source, marked_by, marked_at, notes, marked_late)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4::attendance_kind, $5, $6, 'manual', app.current_user_id(), now(), $7, $8) RETURNING id::text`,
          [
            yearId,
            dto.classSectionId,
            dto.date,
            dto.kind,
            dto.subjectId ?? null,
            dto.periodId ?? null,
            dto.notes ?? null,
            window.late,
          ],
        );
        sessionId = ins.rows[0]!.id;
      } else {
        await c.query(
          `UPDATE attendance_sessions SET marked_by = app.current_user_id(), marked_at = now(), notes = COALESCE($2, notes), updated_at = now(),
                  marked_late = marked_late OR $3 WHERE id = $1`,
          [sessionId, dto.notes ?? null, window.late],
        );
      }
      const enrolled = await c.query<{ id: string }>(
        `SELECT student_id::text AS id FROM enrolments WHERE class_section_id = $1 AND academic_year_id = $2 AND status = 'active'`,
        [dto.classSectionId, yearId],
      );
      const allowed = new Set(enrolled.rows.map((x) => x.id));
      // an approved leave stands: the teacher's entry for that pupil is kept as leave (a coordinator or admin may change it)
      const onLeave =
        dto.kind === 'day' && !manager
          ? await this.gate.hints(
              c,
              dto.marks.map((m) => m.studentId),
              dto.date,
            )
          : null;
      for (const m of dto.marks) {
        if (!allowed.has(m.studentId))
          throw new DomainError(
            'attendance.student_not_in_section',
            'A student in the list is not enrolled in this section',
            { status: 422, extra: { studentId: m.studentId } },
          );
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, remarks, source, marked_by)
           VALUES (app.current_school_id(), $1, $2, $3::attendance_code, $4, 'manual', app.current_user_id())
           ON CONFLICT (session_id, student_id) DO UPDATE SET code = EXCLUDED.code, remarks = EXCLUDED.remarks, source = 'manual', marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [
            sessionId,
            m.studentId,
            onLeave?.get(m.studentId)?.leave ? 'LV' : m.code,
            m.remarks ?? null,
          ],
        );
      }
      const session = await this.sessionWith(c, yearId, dto, manager);
      await this.audit.stage(ctx, c, {
        action: 'attendance.session.mark',
        entityType: 'attendance_sessions',
        entityId: sessionId,
        after: {
          date: dto.date,
          section: session.section,
          kind: dto.kind,
          counts: session.counts,
          late: window.late,
        },
      });
      return { session, sessionId };
    });
    const alertsSent =
      dto.kind === 'day' ? await this.sendAbsentAlerts(ctx, tenant, result.sessionId, dto.date) : 0;
    return { ...result.session, alertsSent };
  }

  /** One WhatsApp per absent student per day to the primary guardian (template absent_alert), never twice. */
  private async sendAbsentAlerts(
    ctx: RequestContext,
    tenant: TenantContext,
    sessionId: string,
    date: string,
  ): Promise<number> {
    const pending = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        mark_id: string;
        student: string;
        section: string;
        mobile: string | null;
      }>(
        `SELECT m.id::text AS mark_id, s.display_name AS student, c.code || '-' || cs.name AS section,
                (SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id WHERE sg.student_id = s.id AND sg.receives_notifications ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS mobile
           FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id JOIN students s ON s.id = m.student_id
           JOIN class_sections cs ON cs.id = a.class_section_id JOIN classes c ON c.id = cs.class_id
          WHERE m.session_id = $1 AND m.code = 'A' AND m.alert_sent_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM student_attendance_rules r WHERE r.student_id = s.id AND r.alerts_muted AND a.on_date BETWEEN r.valid_from AND COALESCE(r.valid_to, a.on_date))`,
        [sessionId],
      );
      return r.rows;
    });
    let sent = 0;
    for (const p of pending) {
      if (!p.mobile) continue;
      try {
        const sentRow = await this.db.tenant(tenant, async (c) => {
          const row = await this.messages.sendAlert(c, ctx, {
            templateCode: 'absent_alert',
            channel: 'whatsapp',
            recipientAddress: p.mobile,
            variables: { student_name: p.student, section: p.section, date },
          } as SendMessageDto);
          if (row)
            await c.query(`UPDATE attendance_marks SET alert_sent_at = now() WHERE id = $1`, [
              p.mark_id,
            ]);
          return row;
        });
        if (sentRow) sent += 1;
        else this.logger.warn(`absent alert throttled for mark ${p.mark_id}`);
      } catch (error) {
        // no template in this school (or an inactive one): attendance is still recorded, the alert is skipped
        this.logger.warn(`absent alert skipped for mark ${p.mark_id}: ${(error as Error).message}`);
      }
    }
    return sent;
  }

  async lock(
    ctx: RequestContext,
    sessionId: string,
    dto: LockDto,
  ): Promise<{ id: string; locked: boolean }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; locked: boolean }>(
        `UPDATE attendance_sessions SET locked = $2, updated_at = now() WHERE id = $1 RETURNING id::text, locked`,
        [sessionId, dto.locked],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Session not found');
      await this.audit.stage(ctx, c, {
        action: dto.locked ? 'attendance.session.lock' : 'attendance.session.unlock',
        entityType: 'attendance_sessions',
        entityId: sessionId,
        after: dto,
      });
      return r.rows[0];
    });
  }

  /** Per-section picture of one day (scoped for teachers). */
  async summary(ctx: RequestContext, q: SummaryQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const allowed = await this.scopes.filter(tenant, 'attendance.session.view', 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId, q.date ?? null];
      let scope = '';
      if (allowed !== null) {
        params.push(allowed);
        scope = `AND cs.id = ANY($3::bigint[])`;
      }
      const r = await c.query<{
        section_id: string;
        section: string;
        strength: number;
        session_id: string | null;
        source: string | null;
        locked: boolean | null;
        marked_by: string | null;
        codes: Record<string, number> | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- scope is a fixed fragment chosen by scope presence; values are bound parameters
        `SELECT cs.id::text AS section_id, c.code || '-' || cs.name AS section,
                (SELECT count(*)::int FROM enrolments e WHERE e.class_section_id = cs.id AND e.academic_year_id = $1 AND e.status = 'active') AS strength,
                a.id::text AS session_id, a.source::text, a.locked, COALESCE((SELECT trim(e.first_name || ' ' || COALESCE(e.last_name, '')) FROM employees e WHERE e.user_id = a.marked_by LIMIT 1), u.display_name) AS marked_by,
                (SELECT jsonb_object_agg(code, n) FROM (SELECT m.code::text AS code, count(*)::int AS n FROM attendance_marks m WHERE m.session_id = a.id GROUP BY m.code) t) AS codes
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id
           LEFT JOIN attendance_sessions a ON a.class_section_id = cs.id AND a.on_date = COALESCE($2::date, CURRENT_DATE) AND a.kind = 'day'
           LEFT JOIN users u ON u.id = a.marked_by
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ${scope}
          ORDER BY c.display_order, cs.name`,
        params,
      );
      const date = q.date ?? new Date().toISOString().slice(0, 10);
      return {
        date,
        sections: r.rows.map((x) => ({
          classSectionId: x.section_id,
          section: x.section,
          strength: x.strength,
          sessionId: x.session_id,
          source: x.source,
          locked: x.locked ?? false,
          markedBy: x.marked_by,
          present:
            (x.codes?.P ?? 0) +
            (x.codes?.L ?? 0) +
            (x.codes?.H ?? 0) +
            (x.codes?.OD ?? 0) +
            (x.codes?.SB ?? 0) +
            (x.codes?.SR ?? 0),
          absent: x.codes?.A ?? 0,
          leave: x.codes?.LV ?? 0,
          late: x.codes?.L ?? 0,
          codes: x.codes ?? {},
        })),
      };
    });
  }

  /** A student's marks in a range (families see their own children, teachers their sections). */
  async student(ctx: RequestContext, studentId: string, q: StudentRangeQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const v = await this.viewer.resolve(ctx, 'attendance.session.view');
    if (v.kind === 'family' && !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Student not found');
    return this.db.tenant(tenant, async (c) => {
      const exists = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        studentId,
      ]);
      if (!exists.rowCount)
        throw new DomainError('not-found', 'Student not found', { status: 404 });
      if (v.kind === 'staff' && v.sectionIds !== null) {
        const e = await c.query(
          `SELECT 1 FROM enrolments WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active' AND class_section_id = ANY($3::bigint[])`,
          [studentId, yearId, v.sectionIds],
        );
        if (e.rowCount === 0) throw new DomainError('not-found', 'Student not found');
      }
      const r = await c.query<{
        date: string;
        kind: string;
        subject: string | null;
        code: Code;
        remarks: string | null;
        in_at: Date | null;
        out_at: Date | null;
        source: string;
      }>(
        `SELECT a.on_date::text AS date, a.kind::text, sub.name AS subject, m.code::text, m.remarks, m.in_at, m.out_at, m.source::text
           FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id LEFT JOIN subjects sub ON sub.id = a.subject_id
          WHERE m.student_id = $1 AND a.academic_year_id = $2 AND a.on_date >= COALESCE($3::date, CURRENT_DATE - 60) AND a.on_date <= COALESCE($4::date, CURRENT_DATE)
          ORDER BY a.on_date DESC, a.kind`,
        [studentId, yearId, q.from ?? null, q.to ?? null],
      );
      const marks = r.rows.map((x) => ({
        date: x.date,
        kind: x.kind,
        subject: x.subject,
        code: x.code,
        remarks: x.remarks,
        inAt: x.in_at ? x.in_at.toISOString() : null,
        outAt: x.out_at ? x.out_at.toISOString() : null,
        source: x.source,
      }));
      const days = marks.filter((m) => m.kind === 'day');
      const present = days.filter((m) => m.code !== 'A' && m.code !== 'LV').length;
      const leave = days.filter((m) => m.code === 'LV').length;
      return {
        studentId,
        marks,
        summary: {
          days: days.length,
          present,
          absent: days.length - present - leave,
          leave,
          percent: days.length ? Math.round((present / days.length) * 1000) / 10 : null,
        },
      };
    });
  }

  /** Family view: each child's month at a glance. */
  async mine(ctx: RequestContext, q: MineQueryDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const v = await this.viewer.resolve(ctx, 'attendance.session.view');
    const month = q.month ?? new Date().toISOString().slice(0, 7);
    const from = `${month}-01`;
    return this.db.tenant(tenant, async (c) => {
      const children = [];
      for (const s of v.students) {
        const r = await c.query<{
          date: string;
          code: Code;
          in_at: Date | null;
          out_at: Date | null;
        }>(
          `SELECT a.on_date::text AS date, m.code::text, m.in_at, m.out_at FROM attendance_marks m JOIN attendance_sessions a ON a.id = m.session_id
            WHERE m.student_id = $1 AND a.academic_year_id = $2 AND a.kind = 'day' AND a.on_date >= $3::date AND a.on_date < ($3::date + interval '1 month') ORDER BY a.on_date`,
          [s.id, yearId, from],
        );
        const days = r.rows.map((x) => ({
          date: x.date,
          code: x.code,
          inAt: x.in_at ? x.in_at.toISOString() : null,
          outAt: x.out_at ? x.out_at.toISOString() : null,
        }));
        const present = days.filter((d) => d.code !== 'A' && d.code !== 'LV').length;
        const leave = days.filter((d) => d.code === 'LV').length;
        children.push({
          ...s,
          month,
          days,
          summary: { days: days.length, present, absent: days.length - present - leave, leave },
        });
      }
      return { month, children };
    });
  }
}
