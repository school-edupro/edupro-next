import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { MessagesService } from '../comms/messages.service';
import type { SendMessageDto } from '../comms/comms.dto';
import type { BulkCommitDto, BulkVerifyDto } from './attendance-plus.dto';
import { AttendanceGate } from './attendance-gate';
import { AttendanceService } from './attendance.service';

type Issue = 'not_found' | 'not_enrolled' | 'duplicate' | 'locked' | 'on_leave';

/** One row of the uploaded list, as checked against the records. */
export interface UploadRow {
  row: number;
  admissionNo: string;
  studentId: string | null;
  name: string | null;
  section: string | null;
  classSectionId: string | null;
  /** What is already marked for the day (null: nothing yet). */
  existing: string | null;
  issue: Issue | null;
}

export interface UploadSummary {
  id: string;
  date: string;
  code: 'P' | 'A';
  fileName: string | null;
  state: 'verified' | 'committed' | 'cancelled';
  totalRows: number;
  okRows: number;
  problemRows: number;
  replaceExisting: boolean;
  restPresent: boolean;
  marked: number;
  replaced: number;
  kept: number;
  restMarked: number;
  notifySms: boolean;
  notifyEmail: boolean;
  smsSent: number;
  emailSent: number;
  notifyNote: string | null;
  createdBy: string | null;
  createdAt: string;
  committedAt: string | null;
}

const HEADER = 'Admission no';
const SUMMARY = `SELECT u.id::text, u.on_date::text AS date, u.code::text, u.file_name, u.state, u.total_rows, u.ok_rows, u.problem_rows,
       u.replace_existing, u.rest_present, u.marked, u.replaced, u.kept, u.rest_marked, u.notify_sms, u.notify_email,
       u.sms_sent, u.email_sent, u.notify_note, usr.display_name AS created_by, u.created_at, u.committed_at
  FROM attendance_uploads u LEFT JOIN users usr ON usr.id = u.created_by`;

const toSummary = (x: Record<string, unknown>): UploadSummary => ({
  id: String(x.id),
  date: String(x.date),
  code: x.code as 'P' | 'A',
  fileName: (x.file_name as string | null) ?? null,
  state: x.state as UploadSummary['state'],
  totalRows: Number(x.total_rows),
  okRows: Number(x.ok_rows),
  problemRows: Number(x.problem_rows),
  replaceExisting: Boolean(x.replace_existing),
  restPresent: Boolean(x.rest_present),
  marked: Number(x.marked),
  replaced: Number(x.replaced),
  kept: Number(x.kept),
  restMarked: Number(x.rest_marked),
  notifySms: Boolean(x.notify_sms),
  notifyEmail: Boolean(x.notify_email),
  smsSent: Number(x.sms_sent),
  emailSent: Number(x.email_sent),
  notifyNote: (x.notify_note as string | null) ?? null,
  createdBy: (x.created_by as string | null) ?? null,
  createdAt: (x.created_at as Date).toISOString(),
  committedAt: x.committed_at ? (x.committed_at as Date).toISOString() : null,
});

/**
 * Attendance from an Excel list (0093). The file has admission numbers only; the user picks the date
 * and Present or Absent for the whole list. The list is checked and shown first (who each number is,
 * what is already marked, what is wrong); nothing is marked until it is confirmed. Parents of the
 * absent may then be told by SMS or e-mail, and every upload stays in the log.
 */
@Injectable()
export class AttendanceBulkService {
  private readonly logger = new Logger(AttendanceBulkService.name);

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly attendance: AttendanceService,
    private readonly gate: AttendanceGate,
    private readonly messages: MessagesService,
  ) {}

  private year(ctx: RequestContext): string {
    const id = requireTenant(ctx).academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  async template(): Promise<{ filename: string; bytes: Buffer }> {
    return {
      filename: 'attendance-upload-format.xlsx',
      bytes: await templateSheet({
        sheet: 'Attendance',
        columns: [{ header: HEADER, width: 20, required: true }],
        guide: [
          'Type one admission number in each row, in the first column. Nothing else is needed.',
          'On the upload screen choose the date and whether these students are Present or Absent.',
          'The list is shown for checking before anything is marked.',
        ],
      }),
    };
  }

  /** Reads the file and checks every number; the result is kept as a draft to confirm. */
  async verify(ctx: RequestContext, dto: BulkVerifyDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    const sheet = await readSheet(dto.fileBase64, [HEADER]);
    if (!sheet.length)
      throw new DomainError('validation-failed', 'The file has no admission numbers', {
        status: 400,
      });
    return this.db.tenant(tenant, async (c) => {
      await this.attendance.assertMarkableDate(c, dto.date, yearId);
      const numbers = sheet.map((r) => r.cells[HEADER]!.trim());
      const found = await c.query<{
        admission_no: string;
        id: string;
        name: string;
        class_section_id: string | null;
        section: string | null;
        existing: string | null;
        locked: boolean | null;
      }>(
        `SELECT s.admission_no, s.id::text, s.display_name AS name, e.class_section_id::text, k.code || '-' || cs.name AS section,
                m.code::text AS existing, a.locked
           FROM students s
           LEFT JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
           LEFT JOIN class_sections cs ON cs.id = e.class_section_id
           LEFT JOIN classes k ON k.id = cs.class_id
           LEFT JOIN attendance_sessions a ON a.class_section_id = e.class_section_id AND a.on_date = $3::date AND a.kind = 'day'
           LEFT JOIN attendance_marks m ON m.session_id = a.id AND m.student_id = s.id
          WHERE s.deleted_at IS NULL AND lower(s.admission_no) = ANY($1::text[])`,
        [numbers.map((n) => n.toLowerCase()), yearId, dto.date],
      );
      const by = new Map(found.rows.map((f) => [f.admission_no.toLowerCase(), f]));
      const leave = await this.gate.hints(
        c,
        found.rows.map((f) => f.id),
        dto.date,
      );
      const seen = new Set<string>();
      const rows: UploadRow[] = sheet.map((r) => {
        const admissionNo = r.cells[HEADER]!.trim();
        const key = admissionNo.toLowerCase();
        const f = by.get(key);
        const issue: Issue | null = seen.has(key)
          ? 'duplicate'
          : !f
            ? 'not_found'
            : !f.class_section_id
              ? 'not_enrolled'
              : f.locked
                ? 'locked'
                : leave.get(f.id)?.leave
                  ? 'on_leave'
                  : null;
        seen.add(key);
        return {
          row: r.row,
          admissionNo,
          studentId: f?.id ?? null,
          name: f?.name ?? null,
          section: f?.section ?? null,
          classSectionId: f?.class_section_id ?? null,
          existing: f?.existing ?? null,
          issue,
        };
      });
      const ok = rows.filter((r) => !r.issue).length;
      const ins = await c.query<{ id: string }>(
        `INSERT INTO attendance_uploads (school_id, academic_year_id, on_date, code, file_name, rows, total_rows, ok_rows, problem_rows, created_by)
         VALUES (app.current_school_id(), $1, $2::date, $3::attendance_code, $4, $5::jsonb, $6, $7, $8, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.date,
          dto.code,
          dto.fileName ?? null,
          JSON.stringify(rows),
          rows.length,
          ok,
          rows.length - ok,
        ],
      );
      return this.detailIn(c, ins.rows[0]!.id);
    });
  }

  private async detailIn(c: PoolClient, id: string) {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- SUMMARY is a constant; the id is bound
      `${SUMMARY.replace('u.committed_at', 'u.committed_at, u.rows')} WHERE u.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const rows = (r.rows[0].rows as UploadRow[]) ?? [];
    const good = rows.filter((x) => !x.issue);
    return {
      ...toSummary(r.rows[0]),
      rows,
      // what a confirmation would do, for the screen
      preview: {
        fresh: good.filter((x) => !x.existing).length,
        same: good.filter((x) => x.existing === r.rows[0]!.code).length,
        differs: good.filter((x) => x.existing && x.existing !== r.rows[0]!.code).length,
        sections: new Set(good.map((x) => x.classSectionId)).size,
      },
    };
  }

  detail(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.detailIn(c, id));
  }

  async list(ctx: RequestContext): Promise<UploadSummary[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- SUMMARY is a constant
        `${SUMMARY} WHERE u.academic_year_id = $1 ORDER BY u.created_at DESC LIMIT 100`,
        [this.year(ctx)],
      );
      return r.rows.map(toSummary);
    });
  }

  async cancel(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE attendance_uploads SET state = 'cancelled' WHERE id = $1 AND state = 'verified'`,
        [id],
      );
      if (!r.rowCount)
        throw new DomainError('attendance.upload_closed', 'This upload is already closed', {
          status: 409,
        });
      return this.detailIn(c, id);
    });
  }

  /** Marks the checked list; then tells the parents of the absent, as ticked. */
  async commit(ctx: RequestContext, id: string, dto: BulkCommitDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    const done = await this.db.tenant(tenant, async (c) => {
      const u = await c.query<{
        on_date: string;
        code: 'P' | 'A';
        state: string;
        rows: UploadRow[];
      }>(
        `SELECT on_date::text, code::text, state, rows FROM attendance_uploads WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const up = u.rows[0];
      if (!up) throw new DomainError('not-found', 'Upload not found', { status: 404 });
      if (up.state !== 'verified')
        throw new DomainError('attendance.upload_closed', 'This upload is already closed', {
          status: 409,
        });
      await this.attendance.assertMarkableDate(c, up.on_date, yearId);
      const good = up.rows.filter((r) => !r.issue && r.studentId && r.classSectionId);
      const sessions = new Map<string, string>();
      const sessionOf = async (sectionId: string): Promise<string | null> => {
        if (sessions.has(sectionId)) return sessions.get(sectionId)!;
        const ex = await c.query<{ id: string; locked: boolean }>(
          `SELECT id::text, locked FROM attendance_sessions
            WHERE class_section_id = $1 AND on_date = $2::date AND kind = 'day' AND subject_id IS NULL AND period_id IS NULL FOR UPDATE`,
          [sectionId, up.on_date],
        );
        if (ex.rows[0]?.locked) return null;
        const sid =
          ex.rows[0]?.id ??
          (
            await c.query<{ id: string }>(
              `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_by, marked_at, notes)
               VALUES (app.current_school_id(), $1, $2, $3::date, 'day', 'upload', app.current_user_id(), now(), $4) RETURNING id::text`,
              [yearId, sectionId, up.on_date, `Excel upload #${id}`],
            )
          ).rows[0]!.id;
        sessions.set(sectionId, sid);
        return sid;
      };
      let marked = 0;
      let replaced = 0;
      let kept = 0;
      const absentees: string[] = [];
      for (const r of good) {
        const sid = await sessionOf(r.classSectionId!);
        if (!sid) {
          kept += 1;
          continue;
        }
        const cur = await c.query<{ code: string }>(
          `SELECT code::text FROM attendance_marks WHERE session_id = $1 AND student_id = $2`,
          [sid, r.studentId],
        );
        const existing = cur.rows[0]?.code ?? null;
        if (existing && (existing === up.code || !dto.replace)) {
          kept += 1;
          continue;
        }
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, remarks, source, marked_by)
           VALUES (app.current_school_id(), $1, $2, $3::attendance_code, $4, 'upload', app.current_user_id())
           ON CONFLICT (session_id, student_id) DO UPDATE SET code = EXCLUDED.code, remarks = EXCLUDED.remarks, source = 'upload',
             marked_by = EXCLUDED.marked_by, updated_at = now()`,
          [sid, r.studentId, up.code, `Excel upload #${id}`],
        );
        if (existing) replaced += 1;
        else marked += 1;
        if (up.code === 'A') absentees.push(r.studentId!);
      }
      // the others of those classes, not yet marked, are present (an approved leave stays leave)
      let restMarked = 0;
      if (dto.restPresent && up.code === 'A') {
        const sections = [...new Set(good.map((r) => r.classSectionId!))];
        for (const sectionId of sections) {
          const sid = await sessionOf(sectionId);
          if (!sid) continue;
          const others = await c.query<{ id: string }>(
            `SELECT e.student_id::text AS id FROM enrolments e
              WHERE e.class_section_id = $1 AND e.academic_year_id = $2 AND e.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM attendance_marks m WHERE m.session_id = $3 AND m.student_id = e.student_id)`,
            [sectionId, yearId, sid],
          );
          const hints = await this.gate.hints(
            c,
            others.rows.map((o) => o.id),
            up.on_date,
          );
          for (const o of others.rows) {
            await c.query(
              `INSERT INTO attendance_marks (school_id, session_id, student_id, code, remarks, source, marked_by)
               VALUES (app.current_school_id(), $1, $2, $3::attendance_code, $4, 'upload', app.current_user_id())
               ON CONFLICT (session_id, student_id) DO NOTHING`,
              [sid, o.id, hints.get(o.id)?.leave ? 'LV' : 'P', `Excel upload #${id}`],
            );
            restMarked += 1;
          }
        }
      }
      for (const sid of sessions.values())
        await c.query(
          `UPDATE attendance_sessions SET marked_by = app.current_user_id(), marked_at = now(), updated_at = now() WHERE id = $1`,
          [sid],
        );
      await c.query(
        `UPDATE attendance_uploads SET state = 'committed', replace_existing = $2, rest_present = $3, marked = $4, replaced = $5,
                kept = $6, rest_marked = $7, notify_sms = $8, notify_email = $9, committed_by = app.current_user_id(), committed_at = now()
          WHERE id = $1`,
        [id, dto.replace, dto.restPresent, marked, replaced, kept, restMarked, dto.sms, dto.email],
      );
      await this.audit.stage(ctx, c, {
        action: 'attendance.bulk.upload',
        entityType: 'attendance_uploads',
        entityId: id,
        after: { date: up.on_date, code: up.code, marked, replaced, kept, restMarked },
      });
      return { date: up.on_date, absentees };
    });

    const told =
      (dto.sms || dto.email) && done.absentees.length
        ? await this.tell(ctx, id, done.date, done.absentees, dto)
        : { sms: 0, email: 0, note: null as string | null };
    return this.db.tenant(tenant, async (c) => {
      await c.query(
        `UPDATE attendance_uploads SET sms_sent = $2, email_sent = $3, notify_note = $4 WHERE id = $1`,
        [id, told.sms, told.email, told.note],
      );
      return this.detailIn(c, id);
    });
  }

  /** One SMS (template absent_alert, SMS) and / or one e-mail to the first guardian who takes notifications. */
  private async tell(
    ctx: RequestContext,
    uploadId: string,
    date: string,
    studentIds: string[],
    dto: BulkCommitDto,
  ): Promise<{ sms: number; email: number; note: string | null }> {
    const tenant = requireTenant(ctx);
    const people = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        student: string;
        section: string;
        mobile: string | null;
        email: string | null;
        user_id: string | null;
        school: string;
      }>(
        `SELECT s.display_name AS student, k.code || '-' || cs.name AS section, g.mobile, g.email, g.user_id::text,
                (SELECT name FROM schools WHERE id = app.current_school_id()) AS school
           FROM students s
           JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active'
           JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN LATERAL (
             SELECT g.mobile, g.email, g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
              WHERE sg.student_id = s.id AND sg.receives_notifications AND g.deleted_at IS NULL
              ORDER BY sg.is_primary DESC, sg.id LIMIT 1) g ON true
          WHERE s.id = ANY($1::bigint[])
            AND NOT EXISTS (SELECT 1 FROM student_attendance_rules r WHERE r.student_id = s.id AND r.alerts_muted
                             AND $3::date BETWEEN r.valid_from AND COALESCE(r.valid_to, $3::date))`,
        [studentIds, this.year(ctx), date],
      );
      return r.rows;
    });
    // the school's own e-mail template (code absent_alert) is used when there is one; else the standard card
    const ownMail = await this.db.tenant(tenant, async (c) => {
      const r = await c.query(
        `SELECT 1 FROM comms_templates WHERE code = 'absent_alert' AND channel = 'email' AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      );
      return (r.rowCount ?? 0) > 0;
    });
    // an SMS goes only when the school's SMS template is active and carries its DLT id
    const smsReady = await this.db.tenant(tenant, async (c) => {
      const r = await c.query(
        `SELECT 1 FROM comms_templates WHERE code = 'absent_alert' AND channel = 'sms' AND status = 'active' AND deleted_at IS NULL
            AND COALESCE(btrim(dlt_template_id), '') <> '' LIMIT 1`,
      );
      return (r.rowCount ?? 0) > 0;
    });
    let sms = 0;
    let email = 0;
    let smsProblem: string | null = smsReady ? null : 'not ready';
    const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', {
      timeZone: 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    for (const p of people) {
      if (dto.sms && p.mobile && !smsProblem)
        try {
          const row = await this.db.tenant(tenant, (c) =>
            this.messages.sendAlert(c, ctx, {
              templateCode: 'absent_alert',
              channel: 'sms',
              recipientAddress: p.mobile,
              variables: { student_name: p.student, section: p.section, date },
            } as SendMessageDto),
          );
          if (row) sms += 1;
        } catch (error) {
          // no SMS template in this school: attendance stays marked, the SMS is not sent
          smsProblem = (error as Error).message;
          this.logger.warn(`upload ${uploadId}: SMS not sent: ${smsProblem}`);
        }
      if (dto.email && p.email && ownMail) {
        const row = await this.db
          .tenant(tenant, (c) =>
            this.messages.sendAlert(c, ctx, {
              templateCode: 'absent_alert',
              channel: 'email',
              recipientAddress: p.email,
              variables: { student_name: p.student, section: p.section, date },
            } as SendMessageDto),
          )
          .catch(() => null);
        if (row) email += 1;
      } else if (dto.email && p.email)
        await this.db.tenant(tenant, async (c) => {
          await c.query(
            `SELECT app.queue_mail($1, $2, app.mail_card_html($3, $4, $5, $6, $7::jsonb, NULL, NULL, $8), '[]'::jsonb,
                                   jsonb_build_object('attendanceUpload', $9::text), $10::bigint)`,
            [
              p.email,
              `Absent today: ${p.student}`,
              p.school,
              'Marked absent',
              '#B26A00',
              `${p.student} was marked absent in school on ${pretty}.`,
              JSON.stringify([
                ['Student', p.student],
                ['Class', p.section],
                ['Date', pretty],
              ]),
              'If your child is on leave, please apply for leave from the parent portal. For any question, contact the class teacher.',
              uploadId,
              p.user_id,
            ],
          );
          email += 1;
        });
    }
    const note = smsProblem
      ? 'SMS not sent: the absence SMS template (code absent_alert) is not ready; it needs to be active with its DLT template id.'
      : null;
    return { sms, email, note };
  }
}
