import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  HostelSettingsDto,
  LeavesQueryDto,
  RollcallQueryDto,
  RollcallRegisterDto,
  RollcallReportDto,
  RollcallSaveDto,
  SessionDto,
} from './hostel.dto';
import { HostelService } from './hostel.service';
import { generatedOn, monthName, registerFile, schoolHead } from '../attendance/register-file';

type Row = Record<string, unknown>;

/** The register's mark of each status; '-' not marked, blank: not in the hostel that day. */
export const ROLL_CODE: Record<string, string> = {
  present: 'P',
  absent: 'A',
  on_leave: 'LV',
  sick: 'S',
};

/** A short, distinct column head for each session: M, N; Mo, Mi when two start alike. */
function shortNames(names: string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const clean = n.replace(/[^A-Za-z0-9]/g, '') || 'S';
    let len = 1;
    let pick = clean.slice(0, len).toUpperCase();
    while (out.includes(pick) && len < clean.length) {
      len += 1;
      pick = clean.charAt(0).toUpperCase() + clean.slice(1, len).toLowerCase();
    }
    out.push(out.includes(pick) ? `${pick}${String(out.length + 1)}` : pick);
  }
  return out;
}

/**
 * Hostel module H2: the school's hostel rules, roll-call sessions and the roll of a session on a day
 * (pupils away on hostel leave are marked so by the system; an absence tells the parent and the head
 * warden), and the hostel leave seen from the hostel: away now, overdue, to hand over, waiting.
 * Hostel leave itself is a gate pass (kinds hostel_home, hostel_outing) — see GatePassService.
 */
@Injectable()
export class HostelLifeService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly hostel: HostelService,
  ) {}

  // ---- settings ------------------------------------------------------------------------------------------
  async settings(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => this.readSettings(c));
  }

  private async readSettings(c: PoolClient) {
    const r = await c.query<{
      late_grace_minutes: number;
      escalate_after_hours: number;
      outing_return_by: string;
      alert_parent_absent: boolean;
    }>(
      `SELECT late_grace_minutes, escalate_after_hours, to_char(outing_return_by, 'HH24:MI') AS outing_return_by, alert_parent_absent
         FROM hostel_settings WHERE school_id = app.current_school_id()`,
    );
    const x = r.rows[0];
    return {
      lateGraceMinutes: x?.late_grace_minutes ?? 30,
      escalateAfterHours: x?.escalate_after_hours ?? 6,
      outingReturnBy: x?.outing_return_by ?? '19:00',
      alertParentAbsent: x?.alert_parent_absent ?? true,
    };
  }

  async saveSettings(ctx: RequestContext, dto: HostelSettingsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO hostel_settings (school_id, late_grace_minutes, escalate_after_hours, outing_return_by, alert_parent_absent, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::time, $4, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET late_grace_minutes = EXCLUDED.late_grace_minutes,
              escalate_after_hours = EXCLUDED.escalate_after_hours, outing_return_by = EXCLUDED.outing_return_by,
              alert_parent_absent = EXCLUDED.alert_parent_absent, updated_at = now(), updated_by = app.current_user_id()`,
        [dto.lateGraceMinutes, dto.escalateAfterHours, dto.outingReturnBy, dto.alertParentAbsent],
      );
      await this.audit.stage(ctx, c, {
        action: 'hostel.settings.save',
        entityType: 'hostel_settings',
        after: dto,
      });
      return this.readSettings(c);
    });
  }

  // ---- roll-call sessions ----------------------------------------------------------------------------------
  async sessions(ctx: RequestContext, hostelId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT s.id::text, s.hostel_id::text AS "hostelId", h.name AS hostel, s.name, to_char(s.at_time, 'HH24:MI') AS "atTime", s.active,
                (SELECT r.taken_at FROM hostel_rollcalls r WHERE r.session_id = s.id AND r.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date) AS "takenToday"
           FROM hostel_rollcall_sessions s JOIN hostels h ON h.id = s.hostel_id
          WHERE ($1::bigint IS NULL OR s.hostel_id = $1) AND ($2::bigint[] IS NULL OR s.hostel_id = ANY ($2::bigint[]))
          ORDER BY h.name, s.at_time`,
        [hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  async saveSession(ctx: RequestContext, dto: SessionDto, id?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE hostel_rollcall_sessions SET name = $2, at_time = $3::time, active = $4 WHERE id = $1 RETURNING id::text`,
              [id, dto.name, dto.atTime, dto.active],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO hostel_rollcall_sessions (school_id, hostel_id, name, at_time, active)
               VALUES (app.current_school_id(), $1, $2, $3::time, $4) RETURNING id::text`,
              [dto.hostelId, dto.name, dto.atTime, dto.active],
            );
        if (!r.rows[0]) throw new DomainError('not-found', 'Session not found', { status: 404 });
        await this.audit.stage(ctx, c, {
          action: 'hostel.session.save',
          entityType: 'hostel_rollcall_session',
          entityId: r.rows[0].id,
          after: dto,
        });
        return { id: r.rows[0].id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'hostel.session_taken',
            `This hostel already has a session called ${dto.name}`,
            {
              status: 409,
            },
          );
        throw e;
      }
    });
  }

  // ---- the roll of a session -------------------------------------------------------------------------------
  /** The session, and every pupil holding a bed in its hostel then, with the mark (taken or proposed). */
  private async roll(c: PoolClient, sessionId: string, on: string) {
    const s = (
      await c.query<{
        id: string;
        hostel_id: string;
        hostel: string;
        name: string;
        at_time: string;
      }>(
        `SELECT s.id::text, s.hostel_id::text, h.name AS hostel, s.name, to_char(s.at_time, 'HH24:MI') AS at_time
           FROM hostel_rollcall_sessions s JOIN hostels h ON h.id = s.hostel_id WHERE s.id = $1`,
        [sessionId],
      )
    ).rows[0];
    if (!s) throw new DomainError('not-found', 'Session not found', { status: 404 });
    const taken = (
      await c.query<{ id: string; taken_at: string; by: string | null }>(
        `SELECT r.id::text, r.updated_at AS taken_at, u.display_name AS by FROM hostel_rollcalls r
           LEFT JOIN users u ON u.id = r.taken_by WHERE r.session_id = $1 AND r.on_date = $2`,
        [sessionId, on],
      )
    ).rows[0];
    // the moment of the roll: the day at the session's time (India time); today's roll taken late counts
    // whoever is away now
    const slot = `${on}T${s.at_time}:00+05:30`;
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const at = on === today && Date.now() > Date.parse(slot) ? new Date().toISOString() : slot;
    const rows = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      room: string;
      bed_id: string;
      bed: string;
      mark: string | null;
      note: string | null;
      away: string | null;
      due: string | null;
    }>(
      `SELECT st.id::text AS student_id, st.display_name AS name, st.admission_no,
              COALESCE(bl.name || '-', '') || r.room_no AS room, b.id::text AS bed_id, b.label AS bed,
              m.status AS mark, m.note,
              -- away on hostel leave at the moment of the roll (out at the gate, not back in yet)
              (SELECT g.pass_no FROM gate_passes g WHERE g.student_id = st.id AND g.kind IN ('hostel_home', 'hostel_outing')
                  AND g.out_at <= $3::timestamptz AND (g.in_at IS NULL OR g.in_at > $3::timestamptz)
                  AND g.state IN ('out', 'returned') ORDER BY g.out_at DESC LIMIT 1) AS away,
              (SELECT to_char(g.return_by AT TIME ZONE 'Asia/Kolkata', 'DD-MM HH24:MI') FROM gate_passes g
                WHERE g.student_id = st.id AND g.kind IN ('hostel_home', 'hostel_outing')
                  AND g.out_at <= $3::timestamptz AND (g.in_at IS NULL OR g.in_at > $3::timestamptz)
                  AND g.state IN ('out', 'returned') ORDER BY g.out_at DESC LIMIT 1) AS due
         FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
         LEFT JOIN hostel_blocks bl ON bl.id = r.block_id
         JOIN students st ON st.id = a.student_id
         LEFT JOIN hostel_rollcall_marks m ON m.rollcall_id = $4::bigint AND m.student_id = st.id
        WHERE r.hostel_id = $1 AND a.from_date <= $2::date AND (a.to_date IS NULL OR a.to_date >= $2::date)
        ORDER BY bl.name NULLS FIRST, r.floor, r.room_no, b.label`,
      [s.hostel_id, on, at, taken?.id ?? null],
    );
    return {
      session: {
        id: s.id,
        hostelId: s.hostel_id,
        hostel: s.hostel,
        name: s.name,
        atTime: s.at_time,
      },
      on,
      taken: taken ? { at: taken.taken_at, by: taken.by } : null,
      pupils: rows.rows.map((x) => ({
        studentId: x.student_id,
        name: x.name,
        admissionNo: x.admission_no,
        room: x.room,
        bed: x.bed,
        bedId: x.bed_id,
        away: x.away,
        due: x.due,
        // the mark taken, else on leave when away, else present (the warden ticks the absentees)
        status: (x.mark ?? (x.away ? 'on_leave' : 'present')) as
          'present' | 'absent' | 'on_leave' | 'sick',
        note: x.note,
        marked: x.mark !== null,
      })),
    };
  }

  private async assertMine(ctx: RequestContext, c: PoolClient, hostelId: string) {
    const only = await this.hostel.scope(ctx, c);
    if (only && !only.includes(hostelId))
      throw new DomainError('permission-denied', 'You are not a warden of this hostel', {
        status: 403,
      });
  }

  async rollcall(ctx: RequestContext, q: RollcallQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const on =
        q.on ??
        (
          await c.query<{ d: string }>(
            `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`,
          )
        ).rows[0]!.d;
      const r = await this.roll(c, q.sessionId, on);
      await this.assertMine(ctx, c, r.session.hostelId);
      return r;
    });
  }

  /**
   * Save the roll. A pupil newly marked absent (and not away on leave) tells the head warden and, when the
   * school wants it, the parent — once per roll.
   */
  async saveRollcall(ctx: RequestContext, dto: RollcallSaveDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = (
        await c.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)
      ).rows[0]!.d;
      if (dto.on > today)
        throw new DomainError(
          'hostel.rollcall_future',
          'A roll-call cannot be taken for a later day',
          {
            status: 422,
          },
        );
      const roll = await this.roll(c, dto.sessionId, dto.on);
      await this.assertMine(ctx, c, roll.session.hostelId);
      const here = new Map(roll.pupils.map((p) => [p.studentId, p]));
      const stray = dto.marks.find((m) => !here.has(m.studentId));
      if (stray)
        throw new DomainError(
          'hostel.rollcall_stranger',
          'A pupil in the roll does not hold a bed in this hostel then',
          {
            status: 422,
          },
        );
      const rc = await c.query<{ id: string }>(
        `INSERT INTO hostel_rollcalls (school_id, session_id, on_date, taken_by)
         VALUES (app.current_school_id(), $1, $2, app.current_user_id())
         ON CONFLICT (session_id, on_date) DO UPDATE SET taken_by = EXCLUDED.taken_by, updated_at = now()
         RETURNING id::text`,
        [dto.sessionId, dto.on],
      );
      const rollId = rc.rows[0]!.id;
      for (const m of dto.marks) {
        const p = here.get(m.studentId)!;
        // a pupil away on leave stays on leave; nobody else can be put on leave by hand
        const status = p.away ? 'on_leave' : m.status === 'on_leave' ? 'absent' : m.status;
        await c.query(
          `INSERT INTO hostel_rollcall_marks (school_id, rollcall_id, student_id, bed_id, status, note)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)
           ON CONFLICT (rollcall_id, student_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note,
                bed_id = EXCLUDED.bed_id`,
          [rollId, m.studentId, p.bedId, status, m.note ?? null],
        );
      }
      const alerted = await this.alertAbsent(c, rollId, roll.session, dto.on);
      await this.audit.stage(ctx, c, {
        action: 'hostel.rollcall.take',
        entityType: 'hostel_rollcall',
        entityId: rollId,
        after: {
          session: roll.session.name,
          on: dto.on,
          absent: dto.marks.filter((m) => m.status === 'absent').length,
        },
      });
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM hostel_rollcall_marks WHERE rollcall_id = $1 GROUP BY status`,
        [rollId],
      );
      return {
        id: rollId,
        counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])),
        alerted,
      };
    });
  }

  /** Absent at a roll, not told yet: the head warden(s), and the parent when the school wants it. */
  private async alertAbsent(
    c: PoolClient,
    rollId: string,
    session: { hostelId: string; hostel: string; name: string },
    on: string,
  ) {
    const set = await this.readSettings(c);
    const who = await c.query<{ id: string; student_id: string; who: string; room: string }>(
      `SELECT m.id::text, m.student_id::text, s.display_name AS who, COALESCE(r.room_no, '') AS room
         FROM hostel_rollcall_marks m JOIN students s ON s.id = m.student_id
         LEFT JOIN hostel_beds b ON b.id = m.bed_id LEFT JOIN hostel_rooms r ON r.id = b.room_id
        WHERE m.rollcall_id = $1 AND m.status = 'absent' AND m.alerted_at IS NULL`,
      [rollId],
    );
    if (!who.rowCount) return 0;
    const base = (
      await c.query<{ school: string; warden: string }>(
        `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
                COALESCE((SELECT concat_ws(' ', e.display_name, e.mobile) FROM hostel_wardens w JOIN employees e ON e.id = w.employee_id
                           WHERE w.hostel_id = $1 ORDER BY w.is_head DESC, e.id LIMIT 1), '') AS warden`,
        [session.hostelId],
      )
    ).rows[0]!;
    const date = on.split('-').reverse().join('-');
    for (const x of who.rows) {
      const vars = JSON.stringify({
        who: x.who,
        room: x.room,
        session: session.name,
        hostel: session.hostel,
        date,
        warden: base.warden,
        school: base.school,
      });
      await c.query(
        `SELECT app.template_to_users('hostel_absent_warden', app.hostel_warden_users($1, true), $2::jsonb)`,
        [session.hostelId, vars],
      );
      if (set.alertParentAbsent)
        await c.query(
          `SELECT app.template_to_mobiles('hostel_absent', ARRAY(
              SELECT g.mobile FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
               WHERE sg.student_id = $1 AND sg.receives_notifications AND g.mobile IS NOT NULL), $2::jsonb)`,
          [x.student_id, vars],
        );
      await c.query(`UPDATE hostel_rollcall_marks SET alerted_at = now() WHERE id = $1`, [x.id]);
    }
    return who.rowCount ?? 0;
  }

  /** Roll-calls of a period: per day and session, present / absent / on leave / sick, and who took it. */
  async rollcallReport(ctx: RequestContext, q: RollcallReportDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const r = await c.query(
        `SELECT r.id::text, r.on_date::text AS "on", h.name AS hostel, s.name AS session, to_char(s.at_time, 'HH24:MI') AS "atTime",
                u.display_name AS "takenBy", r.updated_at AS "takenAt",
                count(*) FILTER (WHERE m.status = 'present')::int AS present,
                count(*) FILTER (WHERE m.status = 'absent')::int AS absent,
                count(*) FILTER (WHERE m.status = 'on_leave')::int AS "onLeave",
                count(*) FILTER (WHERE m.status = 'sick')::int AS sick,
                COALESCE(json_agg(json_build_object('name', st.display_name, 'admissionNo', st.admission_no, 'note', m.note))
                         FILTER (WHERE m.status = 'absent'), '[]') AS absentees
           FROM hostel_rollcalls r JOIN hostel_rollcall_sessions s ON s.id = r.session_id JOIN hostels h ON h.id = s.hostel_id
           LEFT JOIN users u ON u.id = r.taken_by
           LEFT JOIN hostel_rollcall_marks m ON m.rollcall_id = r.id LEFT JOIN students st ON st.id = m.student_id
          WHERE r.on_date BETWEEN $1::date AND $2::date AND ($3::bigint IS NULL OR h.id = $3)
            AND ($4::bigint[] IS NULL OR h.id = ANY ($4::bigint[]))
          GROUP BY r.id, h.name, s.name, s.at_time, u.display_name
          ORDER BY r.on_date DESC, h.name, s.at_time`,
        [q.from, q.to, q.hostelId ?? null, only],
      );
      return r.rows;
    });
  }

  /**
   * The roll-call register of one hostel for a month: the pupils down, each day with a column per session
   * (M morning, N night ...), the mark of each roll (P, A, LV, S; '-' not marked; blank when the pupil did
   * not hold a bed in the hostel that day), and each pupil's totals and present per cent (leave left out).
   * A warden sees their own hostels only.
   */
  async rollcallRegister(ctx: RequestContext, q: RollcallRegisterDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const hostels = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM hostels WHERE ($1::bigint[] IS NULL OR id = ANY ($1::bigint[])) ORDER BY name`,
        [only],
      );
      const hostel = q.hostelId ? hostels.rows.find((h) => h.id === q.hostelId) : hostels.rows[0];
      if (!hostel)
        throw new DomainError(
          q.hostelId ? 'permission-denied' : 'not-found',
          q.hostelId ? 'You see the register of your own hostel only' : 'No hostel is set up',
          { status: q.hostelId ? 403 : 404 },
        );
      const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const first = `${q.month}-01`;
      const end = new Date(Date.UTC(Number(q.month.slice(0, 4)), Number(q.month.slice(5, 7)), 0))
        .toISOString()
        .slice(0, 10);
      const last = end < today ? end : today;
      const days: string[] = [];
      for (let d = first; d <= last;) {
        days.push(d);
        const n = new Date(`${d}T00:00:00Z`);
        n.setUTCDate(n.getUTCDate() + 1);
        d = n.toISOString().slice(0, 10);
      }
      const sessions = await c.query<{ id: string; name: string; at: string }>(
        `SELECT s.id::text, s.name, to_char(s.at_time, 'HH24:MI') AS at FROM hostel_rollcall_sessions s
          WHERE s.hostel_id = $1 AND (s.active OR EXISTS (
                SELECT 1 FROM hostel_rollcalls r WHERE r.session_id = s.id AND r.on_date BETWEEN $2::date AND $3::date))
          ORDER BY s.at_time, s.id`,
        [hostel.id, first, end],
      );
      const short = shortNames(sessions.rows.map((s) => s.name));
      const pupils = days.length
        ? await c.query<Row>(
            `WITH pupils AS (
               SELECT DISTINCT a.student_id FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
                WHERE r.hostel_id = $1 AND a.from_date <= $3::date AND (a.to_date IS NULL OR a.to_date >= $2::date))
             SELECT s.id::text, s.display_name AS name, s.admission_no AS "admissionNo",
                    (SELECT k.code || '-' || cs.name FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                       JOIN classes k ON k.id = cs.class_id WHERE en.student_id = s.id AND en.status = 'active'
                      ORDER BY en.academic_year_id DESC LIMIT 1) AS section,
                    (SELECT r.room_no || '/' || b.label FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id
                       JOIN hostel_rooms r ON r.id = b.room_id
                      WHERE a.student_id = s.id AND r.hostel_id = $1 AND a.from_date <= $3::date ORDER BY a.from_date DESC LIMIT 1) AS bed,
                    ARRAY(SELECT d::date::text FROM generate_series($2::date, $3::date, '1 day') d
                           WHERE app.hostel_of(s.id, d::date) = $1) AS stay
               FROM pupils p JOIN students s ON s.id = p.student_id
              ORDER BY s.display_name, s.id`,
            [hostel.id, first, last],
          )
        : { rows: [] as Row[] };
      const marks = await c.query<{ sid: string; on: string; session: string; status: string }>(
        `SELECT m.student_id::text AS sid, r.on_date::text AS "on", r.session_id::text AS session, m.status
           FROM hostel_rollcalls r JOIN hostel_rollcall_sessions s ON s.id = r.session_id JOIN hostel_rollcall_marks m ON m.rollcall_id = r.id
          WHERE s.hostel_id = $1 AND r.on_date BETWEEN $2::date AND $3::date`,
        [hostel.id, first, last],
      );
      const taken = await c.query<{ on: string; session: string }>(
        `SELECT r.on_date::text AS "on", r.session_id::text AS session FROM hostel_rollcalls r
           JOIN hostel_rollcall_sessions s ON s.id = r.session_id
          WHERE s.hostel_id = $1 AND r.on_date BETWEEN $2::date AND $3::date`,
        [hostel.id, first, last],
      );
      const mark = new Map(marks.rows.map((m) => [`${m.sid}|${m.on}|${m.session}`, m.status]));
      const keys = days.flatMap((d) => sessions.rows.map((s) => ({ day: d, session: s.id })));
      const rows = pupils.rows.map((p) => {
        const stay = new Set(p.stay as string[]);
        const count = { present: 0, absent: 0, on_leave: 0, sick: 0 };
        const cells = keys.map((k) => {
          if (!stay.has(k.day)) return '';
          const st = mark.get(`${String(p.id)}|${k.day}|${k.session}`);
          if (!st) return '-';
          count[st as keyof typeof count] += 1;
          return ROLL_CODE[st] ?? '-';
        });
        const counted = count.present + count.absent + count.sick;
        return {
          studentId: String(p.id),
          name: String(p.name),
          admissionNo: (p.admissionNo as string | null) ?? '',
          section: (p.section as string | null) ?? '',
          bed: (p.bed as string | null) ?? '',
          cells,
          present: count.present,
          absent: count.absent,
          leave: count.on_leave,
          sick: count.sick,
          percent: counted ? Math.round((count.present * 1000) / counted) / 10 : null,
        };
      });
      const head = await schoolHead(c);
      return {
        school: head.name,
        address: head.address,
        hostel: { id: hostel.id, name: hostel.name },
        hostels: hostels.rows,
        month: q.month,
        days,
        sessions: sessions.rows.map((s, i) => ({ ...s, short: short[i]! })),
        /** Per column: was the roll taken, and how many were present. */
        columns: keys.map((k, i) => ({
          day: k.day,
          session: k.session,
          taken: taken.rows.some((t) => t.on === k.day && t.session === k.session),
          present: rows.filter((r) => r.cells[i] === 'P').length,
        })),
        rows,
      };
    });
  }

  async rollcallRegisterFile(ctx: RequestContext, q: RollcallRegisterDto, format: 'xlsx' | 'pdf') {
    const reg = await this.rollcallRegister(ctx, q);
    const many = reg.sessions.length > 1;
    const legend = [
      many ? reg.sessions.map((s) => `${s.short} ${s.name} (${s.at})`).join(' · ') : '',
      'P present · A absent · LV on leave · S sick · - not marked · blank: no bed in the hostel that day · % present leaves leave out',
    ]
      .filter(Boolean)
      .join(' · ');
    return registerFile(
      {
        school: reg.school,
        address: reg.address,
        report: 'Hostel roll-call register',
        details: [
          reg.hostel.name,
          many ? '' : (reg.sessions[0]?.name ?? ''),
          monthName(reg.month),
          generatedOn(),
        ].filter(Boolean),
        legend,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Pupil', width: 16 },
          { label: 'Adm. no.', width: 7 },
          { label: 'Class', width: 5 },
          { label: 'Room/bed', width: 8 },
          ...reg.columns.map((col, i) => {
            const s = reg.sessions[i % Math.max(1, reg.sessions.length)]!;
            return {
              label: many ? s.short : col.day.slice(8),
              width: 2.6,
              center: true,
              group: many ? col.day.slice(8) : undefined,
            };
          }),
          { label: 'P', width: 4, right: true },
          { label: 'A', width: 4, right: true },
          { label: 'LV', width: 4, right: true },
          { label: 'S', width: 4, right: true },
          { label: '% present', width: 6, right: true },
        ],
        rows: [
          ...reg.rows.map((r, i) => [
            i + 1,
            r.name,
            r.admissionNo,
            r.section,
            r.bed,
            ...r.cells,
            r.present,
            r.absent,
            r.leave,
            r.sick,
            r.percent === null ? '' : `${r.percent.toFixed(1)}`,
          ]),
          [
            '',
            'Present',
            '',
            '',
            '',
            ...reg.columns.map((col) => (col.taken ? col.present : '-')),
            reg.rows.reduce((n, r) => n + r.present, 0),
            reg.rows.reduce((n, r) => n + r.absent, 0),
            reg.rows.reduce((n, r) => n + r.leave, 0),
            reg.rows.reduce((n, r) => n + r.sick, 0),
            '',
          ],
        ],
        strong: [reg.rows.length],
        filename: `hostel-roll-register-${reg.month}`,
      },
      format,
    );
  }

  // ---- hostel leave, seen from the hostel ---------------------------------------------------------------
  async leaves(ctx: RequestContext, q: LeavesQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const set = await this.readSettings(c);
      const filter: Record<LeavesQueryDto['show'], string> = {
        out: `g.state = 'out'`,
        overdue: `g.state = 'out' AND g.return_by + make_interval(mins => $3::int) < now()`,
        handover: `g.state = 'approved' AND g.kind = 'hostel_home' AND g.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date`,
        pending: `g.state = 'pending'`,
        all: `true`,
      };
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the filter is one of the fixed strings above; values bound
        `SELECT g.id::text, COALESCE(g.pass_no, '#' || g.id) AS number, g.kind, g.state, s.id::text AS "studentId",
                s.display_name AS name, s.admission_no AS "admissionNo", h.id::text AS "hostelId", h.name AS hostel,
                g.on_date::text AS "onDate", to_char(g.at_time, 'HH24:MI') AS "atTime", g.return_by AS "returnBy",
                g.out_at AS "outAt", g.in_at AS "inAt", g.late_minutes AS "lateMinutes", g.reason,
                g.escort_name AS "escortName", g.escort_relation AS "escortRelation", g.escort_kind AS "escortKind",
                (g.state = 'out' AND g.return_by + make_interval(mins => $3::int) < now()) AS overdue,
                g.escalated_at IS NOT NULL AS escalated
           FROM gate_passes g JOIN students s ON s.id = g.student_id
           LEFT JOIN hostels h ON h.id = app.hostel_of(g.student_id, g.on_date)
          WHERE g.kind IN ('hostel_home', 'hostel_outing') AND ${filter[q.show]}
            AND ($1::bigint IS NULL OR h.id = $1) AND ($2::bigint[] IS NULL OR h.id = ANY ($2::bigint[]))
          ORDER BY CASE WHEN g.state = 'out' THEN g.return_by END NULLS LAST, g.on_date DESC, g.id DESC
          LIMIT 500`,
        [q.hostelId ?? null, only, set.lateGraceMinutes],
      );
      return r.rows;
    });
  }

  /** Today in numbers for the hostel desk: holders, away, overdue, to hand over, waiting, rolls taken. */
  async today(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const only = await this.hostel.scope(ctx, c);
      const set = await this.readSettings(c);
      const r = await c.query(
        `WITH hs AS (SELECT id FROM hostels WHERE status = 'active' AND ($1::bigint[] IS NULL OR id = ANY ($1::bigint[]))),
              leave AS (SELECT g.*, app.hostel_of(g.student_id, g.on_date) AS hostel_id FROM gate_passes g
                         WHERE g.kind IN ('hostel_home', 'hostel_outing') AND g.state IN ('pending', 'approved', 'out'))
         SELECT
           (SELECT count(*)::int FROM hostel_allotments a JOIN hostel_beds b ON b.id = a.bed_id JOIN hostel_rooms r ON r.id = b.room_id
             WHERE r.hostel_id IN (SELECT id FROM hs) AND a.from_date <= (now() AT TIME ZONE 'Asia/Kolkata')::date AND (a.to_date IS NULL OR a.to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)) AS boarders,
           (SELECT count(*)::int FROM leave WHERE state = 'out' AND hostel_id IN (SELECT id FROM hs)) AS away,
           (SELECT count(*)::int FROM leave WHERE state = 'out' AND hostel_id IN (SELECT id FROM hs)
               AND return_by + make_interval(mins => $2::int) < now()) AS overdue,
           (SELECT count(*)::int FROM leave WHERE state = 'approved' AND kind = 'hostel_home' AND on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
               AND hostel_id IN (SELECT id FROM hs)) AS "toHandOver",
           (SELECT count(*)::int FROM leave WHERE state = 'pending' AND hostel_id IN (SELECT id FROM hs)) AS waiting,
           (SELECT count(*)::int FROM hostel_rollcall_sessions s WHERE s.active AND s.hostel_id IN (SELECT id FROM hs)) AS sessions,
           (SELECT count(*)::int FROM hostel_rollcalls r JOIN hostel_rollcall_sessions s ON s.id = r.session_id
             WHERE r.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND s.hostel_id IN (SELECT id FROM hs)) AS "rollsTaken",
           (SELECT count(*)::int FROM hostel_rollcall_marks m JOIN hostel_rollcalls r ON r.id = m.rollcall_id
              JOIN hostel_rollcall_sessions s ON s.id = r.session_id
             WHERE r.on_date = (now() AT TIME ZONE 'Asia/Kolkata')::date AND m.status = 'absent' AND s.hostel_id IN (SELECT id FROM hs)) AS "absentToday"`,
        [only, set.lateGraceMinutes],
      );
      return r.rows[0];
    });
  }
}
