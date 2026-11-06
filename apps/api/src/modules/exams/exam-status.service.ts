import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService, MARKS } from './exam-entry.service';
import {
  EXAMS,
  type EntryStatusActionDto,
  type EntryStatusNoteDto,
  type ExamLockDto,
} from './exams.dto';
import { MarkSchemesService } from './mark-schemes.service';
import { impactWords, reopenExamMarks, reopenImpact, takeBackCards } from './exam-reopen';

type Status = 'open' | 'submitted' | 'verified';

export interface EntryStatusRow {
  examId: string;
  /** the section's class (the status grid: a block per class) */
  classId: string;
  examCode: string;
  examSubjectId: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classSectionId: string;
  section: string;
  takers: number;
  entered: number;
  status: Status;
  submittedBy: string | null;
  submittedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  remark: string | null;
  /** 6 Nov 2026: opened for entry by the admin while the exam or its class is locked */
  entryOpen: boolean;
  /** the caller may verify / send back this one */
  canVerify: boolean;
}

/** One section × subject of the exams asked for, with how many take it and how many are entered. */
const ROWS = `
  SELECT e.id::text AS exam_id, e.code AS exam_code, es.id::text AS exam_subject_id, es.subject_id::text, sub.code AS subject_code,
         sub.name AS subject_name, cs.id::text AS class_section_id, cs.class_id::text AS class_id, k.code || '-' || cs.name AS section,
         (SELECT count(*)::int FROM enrolments en WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id
             AND en.status = 'active' AND app.student_exam_subject_kind(en.student_id, e.id, es.subject_id) IS NOT NULL) AS takers,
         (SELECT count(*)::int FROM enrolments en JOIN mark_entries m ON m.student_id = en.student_id AND m.exam_subject_id = es.id
           WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
             AND app.student_exam_subject_kind(en.student_id, e.id, es.subject_id) IS NOT NULL) AS entered,
         COALESCE(st.status, 'open') AS status, su.display_name AS submitted_by, st.submitted_at, st.submitted_by::text AS submitted_by_id,
         vu.display_name AS verified_by, st.verified_at, st.remark,
         COALESCE(st.entry_open AND (e.marks_locked OR es.entry_locked), false) AS entry_open
    FROM exams e
    JOIN exam_classes ec ON ec.exam_id = e.id
    JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = e.academic_year_id AND cs.deleted_at IS NULL AND cs.status = 'active'
    JOIN classes k ON k.id = cs.class_id
    JOIN exam_subjects es ON es.exam_id = e.id AND es.class_id = ec.class_id
    JOIN subjects sub ON sub.id = es.subject_id
    LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
    LEFT JOIN users su ON su.id = st.submitted_by
    LEFT JOIN users vu ON vu.id = st.verified_by`;

interface Raw {
  exam_id: string;
  exam_code: string;
  exam_subject_id: string;
  subject_id: string;
  subject_code: string;
  subject_name: string;
  class_section_id: string;
  class_id: string;
  section: string;
  takers: number;
  entered: number;
  status: Status;
  submitted_by: string | null;
  submitted_at: Date | null;
  submitted_by_id: string | null;
  verified_by: string | null;
  verified_at: Date | null;
  remark: string | null;
  entry_open: boolean;
}

/**
 * Submit, verify, publish (docs/design/65, part 2). The marks of one subject in one section are entered
 * while open; the teacher submits them once every student who takes the subject has a mark or a code;
 * the class teacher (or a coordinator of the section, or anyone with the verify right: HOD, exam office)
 * verifies them, which locks them and works the exam's results out again, or sends them back with a
 * remark. Reopening a submitted or verified subject needs the unlock right and a reason; once a release
 * with the exam is published, it is withdrawn first. Every change is kept in the history.
 */
@Injectable()
export class ExamStatusService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
    private readonly entry: ExamEntryService,
    private readonly schemes: MarkSchemesService,
  ) {}

  /** Sections whose marks the caller verifies: null = every section (the verify right, unscoped). */
  private async verifiable(
    c: PoolClient,
    tenant: TenantContext,
    ctx: RequestContext,
    yearId: string,
  ): Promise<{ all: boolean; sections: Set<string> }> {
    const sections = new Set<string>();
    if (ctx.permissions?.has(EXAMS.marksVerify)) {
      const allowed = await this.scopes.filter(tenant, EXAMS.marksVerify, 'class_section');
      if (allowed === null) return { all: true, sections };
      for (const id of allowed) sections.add(String(id));
    }
    const mine = await c.query<{ id: string }>(
      `SELECT DISTINCT ta.class_section_id::text AS id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.academic_year_id = $1 AND ta.valid_to IS NULL
          AND ta.kind IN ('class_teacher', 'coordinator')`,
      [yearId],
    );
    for (const r of mine.rows) sections.add(r.id);
    return { all: false, sections };
  }

  private shape(r: Raw, may: { all: boolean; sections: Set<string> }, me: string): EntryStatusRow {
    return {
      examId: r.exam_id,
      examCode: r.exam_code,
      examSubjectId: r.exam_subject_id,
      subjectId: r.subject_id,
      subjectCode: r.subject_code,
      subjectName: r.subject_name,
      classSectionId: r.class_section_id,
      classId: r.class_id,
      section: r.section,
      takers: r.takers,
      entered: r.entered,
      status: r.status,
      submittedBy: r.submitted_by,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at?.toISOString() ?? null,
      remark: r.remark,
      entryOpen: r.entry_open,
      // the one who submitted verifies their own only with the verify right
      canVerify:
        (may.all || may.sections.has(r.class_section_id)) && (r.submitted_by_id !== me || may.all),
    };
  }

  /** Every section × subject of an exam (optionally one class): who takes it, entered, the status. */
  async overview(ctx: RequestContext, examId: string, classId?: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const r = await c.query<Raw>(
        // eslint-disable-next-line no-restricted-syntax -- ROWS is a constant; values are bound parameters
        `${ROWS} WHERE e.id = $1 AND ($2::bigint IS NULL OR ec.class_id = $2::bigint)
            AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
          ORDER BY k.display_order, k.code, cs.name, app.subject_seq(es.class_id, e.academic_year_id, es.subject_id), sub.code`,
        [examId, classId ?? null, allowed],
      );
      const may = await this.verifiable(c, tenant, ctx, yearId);
      // each section × subject's subject teachers (Academics → Teacher assignments), 6 Nov 2026
      const shaped = r.rows.map((x) => this.shape(x, may, ctx.user.id));
      const t = await c.query<{ section: string; subject: string; names: string[] }>(
        `SELECT ta.class_section_id::text AS section, ta.subject_id::text AS subject,
                array_agg(DISTINCT COALESCE(e.display_name, concat_ws(' ', e.first_name, e.last_name))) AS names
           FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
          WHERE ta.academic_year_id = $1 AND ta.class_section_id = ANY($2::bigint[]) AND ta.valid_to IS NULL
            AND ta.kind = 'subject_teacher' AND ta.subject_id IS NOT NULL
          GROUP BY 1, 2`,
        [yearId, [...new Set(shaped.map((x) => x.classSectionId))]],
      );
      const teachers = new Map(t.rows.map((x) => [`${x.section}|${x.subject}`, x.names.sort()]));
      const rows = shaped.map((x) => ({
        ...x,
        teachers: teachers.get(`${x.classSectionId}|${x.subjectId}`) ?? [],
      }));
      const count = (s: Status) => rows.filter((x) => x.status === s).length;
      return {
        data: rows,
        counts: {
          total: rows.length,
          open: count('open'),
          submitted: count('submitted'),
          verified: count('verified'),
          /** open with students still without marks */
          missing: rows.filter((x) => x.status === 'open' && x.entered < x.takers).length,
        },
      };
    });
  }

  /** Submitted marks across the year's exams that the caller verifies. */
  async waiting(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const may = await this.verifiable(c, tenant, ctx, yearId);
      if (!may.all && !may.sections.size) return { data: [] as EntryStatusRow[] };
      const r = await c.query<Raw>(
        // eslint-disable-next-line no-restricted-syntax -- ROWS is a constant; values are bound parameters
        `${ROWS} WHERE e.academic_year_id = $1 AND e.deleted_at IS NULL AND st.status = 'submitted'
            AND ($2 OR cs.id = ANY($3::bigint[]))
          ORDER BY st.submitted_at`,
        [yearId, may.all, [...may.sections]],
      );
      return {
        data: r.rows.map((x) => this.shape(x, may, ctx.user.id)).filter((x) => x.canVerify),
      };
    });
  }

  private async move(
    c: PoolClient,
    esId: string,
    sectionId: string,
    from: Status,
    to: Status,
    note: string | null,
  ) {
    await c.query(
      `INSERT INTO exam_entry_status (school_id, exam_subject_id, class_section_id, status, submitted_by, submitted_at, verified_by, verified_at, remark)
       VALUES (app.current_school_id(), $1, $2, $3,
               CASE WHEN $3 = 'submitted' THEN app.current_user_id() END, CASE WHEN $3 = 'submitted' THEN now() END,
               CASE WHEN $3 = 'verified' THEN app.current_user_id() END, CASE WHEN $3 = 'verified' THEN now() END, $4)
       ON CONFLICT (exam_subject_id, class_section_id) DO UPDATE SET status = EXCLUDED.status,
         submitted_by = CASE WHEN EXCLUDED.status = 'submitted' THEN app.current_user_id()
                             WHEN EXCLUDED.status = 'open' THEN NULL ELSE exam_entry_status.submitted_by END,
         submitted_at = CASE WHEN EXCLUDED.status = 'submitted' THEN now()
                             WHEN EXCLUDED.status = 'open' THEN NULL ELSE exam_entry_status.submitted_at END,
         verified_by = CASE WHEN EXCLUDED.status = 'verified' THEN app.current_user_id() END,
         verified_at = CASE WHEN EXCLUDED.status = 'verified' THEN now() END,
         -- a sheet opened for entry closes again once it is submitted (6 Nov 2026)
         entry_open = CASE WHEN EXCLUDED.status = 'open' THEN exam_entry_status.entry_open ELSE false END,
         remark = EXCLUDED.remark, updated_at = now()`,
      [esId, sectionId, to, note],
    );
    await c.query(
      `INSERT INTO exam_entry_status_log (school_id, exam_subject_id, class_section_id, from_status, to_status, note, actor_user_id)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id())`,
      [esId, sectionId, from, to, note],
    );
  }

  private async place(
    c: PoolClient,
    tenant: TenantContext,
    examId: string,
    sectionId: string,
    subjectId: string,
  ) {
    const yearId = this.entry.year(tenant);
    await this.entry.exam(c, examId, yearId);
    const section = await this.entry.section(c, sectionId, yearId, examId);
    const es = await this.entry.examSubject(c, examId, section.class_id, subjectId);
    const r = await c.query<Raw>(
      // eslint-disable-next-line no-restricted-syntax -- ROWS is a constant; values are bound parameters
      `${ROWS} WHERE es.id = $1 AND cs.id = $2 FOR UPDATE OF e`,
      [es.id, section.id],
    );
    return { yearId, section, es, row: r.rows[0]! };
  }

  async submit(ctx: RequestContext, examId: string, dto: EntryStatusActionDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const { yearId, section, es, row } = await this.place(
        c,
        tenant,
        examId,
        dto.classSectionId,
        dto.subjectId,
      );
      await this.entry.assertMayEnter(c, tenant, yearId, section.id, MARKS, dto.subjectId);
      if (row.status !== 'open')
        throw new DomainError('exams.entry_submitted', `The marks are already ${row.status}`, {
          status: 409,
        });
      if (row.entered < row.takers)
        throw new DomainError(
          'exams.marks_missing',
          `${String(row.takers - row.entered)} of ${String(row.takers)} students have no marks or code yet`,
          { status: 409, extra: { missing: row.takers - row.entered } },
        );
      await this.move(c, es.id, section.id, 'open', 'submitted', dto.remark?.trim() || null);
      await this.audit.stage(ctx, c, {
        action: 'exams.marks.submit',
        entityType: 'exam_subjects',
        entityId: es.id,
        after: { classSectionId: section.id },
      });
      return this.one(c, tenant, ctx, es.id, section.id, yearId);
    });
  }

  async verify(ctx: RequestContext, examId: string, dto: EntryStatusActionDto) {
    return this.decide(ctx, examId, dto, 'verified', dto.remark?.trim() || null);
  }

  async sendBack(ctx: RequestContext, examId: string, dto: EntryStatusNoteDto) {
    return this.decide(ctx, examId, dto, 'open', dto.note);
  }

  private async decide(
    ctx: RequestContext,
    examId: string,
    dto: { classSectionId: string; subjectId: string },
    to: 'verified' | 'open',
    note: string | null,
  ) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const { yearId, section, es, row } = await this.place(
        c,
        tenant,
        examId,
        dto.classSectionId,
        dto.subjectId,
      );
      const may = await this.verifiable(c, tenant, ctx, yearId);
      if (!this.shape(row, may, ctx.user.id).canVerify)
        throw new DomainError(
          'exams.not_verifier',
          row.submitted_by_id === ctx.user.id && may.sections.has(section.id)
            ? 'You submitted these marks: another verifier (or one with the verify right) checks them'
            : 'Only the class teacher, a coordinator of the section or one with the verify right verifies these marks',
          { status: 403 },
        );
      if (row.status !== 'submitted')
        throw new DomainError(
          'exams.not_submitted',
          row.status === 'verified'
            ? 'The marks are already verified'
            : 'The marks are not submitted yet',
          { status: 409 },
        );
      await this.move(c, es.id, section.id, 'submitted', to, note);
      // verified marks make the results: worked out again at once
      if (to === 'verified') {
        await c.query(`SELECT app.compute_exam_results($1)`, [examId]);
        // and the term results of the locked result schemes that read the exam (docs/design/65)
        await this.schemes.recomputeForExam(c, yearId, examId);
      }
      await this.audit.stage(ctx, c, {
        action: to === 'verified' ? 'exams.marks.verify' : 'exams.marks.send_back',
        entityType: 'exam_subjects',
        entityId: es.id,
        after: { classSectionId: section.id, note },
      });
      return this.one(c, tenant, ctx, es.id, section.id, yearId);
    });
  }

  /**
   * 6 Nov 2026: the whole exam locked (no one enters) or unlocked by the school admin. Unlocking also
   * reopens every submitted and verified sheet and takes the classes' published cards back, with the
   * reason (exam-reopen.ts), so every teacher can enter again.
   */
  async lockWhole(ctx: RequestContext, examId: string, dto: ExamLockDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      const impact = dto.locked ? [] : await reopenImpact(c, examId, null);
      const reason = dto.reason?.trim() ?? '';
      if (impact.length && reason.length < 3)
        throw new DomainError(
          'validation-failed',
          `Unlocking reopens ${impactWords(impact)}: give the reason`,
          { status: 400, extra: { impact } },
        );
      if (impact.some((x) => x.cards.length) && !ctx.permissions?.has(EXAMS.resultPublish))
        throw new DomainError(
          'permission-denied',
          'Taking a published card back needs exams.result.publish',
          { status: 403 },
        );
      await c.query(
        `UPDATE exams SET marks_locked = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [examId, dto.locked],
      );
      await c.query(
        `UPDATE exam_subjects SET entry_locked = $2, locked_by = CASE WHEN $2 THEN app.current_user_id() END,
                locked_at = CASE WHEN $2 THEN now() END WHERE exam_id = $1`,
        [examId, dto.locked],
      );
      // the sheets opened for entry one by one close: the whole exam is locked or open now
      await c.query(
        `UPDATE exam_entry_status st SET entry_open = false, updated_at = now()
           FROM exam_subjects es WHERE es.id = st.exam_subject_id AND es.exam_id = $1 AND st.entry_open`,
        [examId],
      );
      const done = impact.length
        ? await reopenExamMarks(c, examId, null, reason, 'Reopened with the exam')
        : { reopened: 0, revoked: [] as string[] };
      await this.audit.stage(ctx, c, {
        action: dto.locked ? 'exams.exam.lock' : 'exams.exam.unlock',
        entityType: 'exams',
        entityId: examId,
        after: { locked: dto.locked, ...done, ...(reason ? { reason } : {}) },
      });
      return { locked: dto.locked, ...done };
    });
  }

  /**
   * 6 Nov 2026 (asked): the school admin reopens ONE sheet (an exam × section × subject) for entry while
   * the exam or its class stays locked — submitted or verified marks go back to open, the class's
   * published card is taken back (as a class opened), and the sheet is marked open for entry: only its
   * subject teacher (else the section's class teacher) enters, and it closes when submitted.
   */
  async openEntry(ctx: RequestContext, examId: string, dto: EntryStatusNoteDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const { yearId, section, es, row } = await this.place(
        c,
        tenant,
        examId,
        dto.classSectionId,
        dto.subjectId,
      );
      const lock = await c.query<{ locked: boolean; open: boolean }>(
        `SELECT (e.marks_locked OR es.entry_locked) AS locked,
                COALESCE((SELECT st.entry_open FROM exam_entry_status st
                           WHERE st.exam_subject_id = es.id AND st.class_section_id = $2), false) AS open
           FROM exam_subjects es JOIN exams e ON e.id = es.exam_id WHERE es.id = $1`,
        [es.id, section.id],
      );
      const { locked, open } = lock.rows[0]!;
      if (row.status === 'open' && (!locked || open))
        throw new DomainError('exams.entry_open', 'This sheet is open for entry already', {
          status: 409,
        });
      const cards = (await reopenImpact(c, examId, section.class_id)).some((x) => x.cards.length);
      if (cards && !ctx.permissions?.has(EXAMS.resultPublish))
        throw new DomainError(
          'permission-denied',
          'Taking a published card back needs exams.result.publish',
          { status: 403 },
        );
      const revoked = cards ? await takeBackCards(c, examId, section.class_id, dto.note) : [];
      if (row.status !== 'open')
        await this.move(
          c,
          es.id,
          section.id,
          row.status,
          'open',
          `Reopened for entry: ${dto.note}`,
        );
      if (locked) {
        await c.query(
          `INSERT INTO exam_entry_status (school_id, exam_subject_id, class_section_id, status, entry_open, remark)
           VALUES (app.current_school_id(), $1, $2, 'open', true, $3)
           ON CONFLICT (exam_subject_id, class_section_id) DO UPDATE SET entry_open = true, remark = EXCLUDED.remark, updated_at = now()`,
          [es.id, section.id, `Opened for entry: ${dto.note}`],
        );
        if (row.status === 'open')
          await c.query(
            `INSERT INTO exam_entry_status_log (school_id, exam_subject_id, class_section_id, from_status, to_status, note, actor_user_id)
             VALUES (app.current_school_id(), $1, $2, 'open', 'open', $3, app.current_user_id())`,
            [es.id, section.id, `Opened for entry: ${dto.note}`],
          );
      }
      if (row.status !== 'open') await c.query(`SELECT app.compute_exam_results($1)`, [examId]);
      await this.audit.stage(ctx, c, {
        action: 'exams.marks.open_entry',
        entityType: 'exam_subjects',
        entityId: es.id,
        before: { status: row.status, locked },
        after: { classSectionId: section.id, reason: dto.note, revoked },
      });
      return { ...(await this.one(c, tenant, ctx, es.id, section.id, yearId)), revoked };
    });
  }

  /** 6 Nov 2026: what opening the exam or a class would reopen and take back (for the admin's dialog) */
  async lockImpact(ctx: RequestContext, examId: string, classId?: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.entry.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await this.entry.exam(c, examId, yearId);
      return { data: await reopenImpact(c, examId, classId ?? null) };
    });
  }

  async reopen(ctx: RequestContext, examId: string, dto: EntryStatusNoteDto) {
    if (!ctx.permissions?.has(EXAMS.marksUnlock))
      throw new DomainError('permission-denied', 'Reopening marks needs exams.marks.unlock', {
        status: 403,
      });
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const { yearId, section, es, row } = await this.place(
        c,
        tenant,
        examId,
        dto.classSectionId,
        dto.subjectId,
      );
      if (row.status === 'open')
        throw new DomainError('exams.not_submitted', 'The marks are open already', { status: 409 });
      // published class by class (docs/design/65, 1 Nov): only this section's class blocks reopening
      const published = await c.query<{ name: string }>(
        `SELECT r.name FROM report_card_releases r
           JOIN report_card_release_classes x ON x.release_id = r.id AND x.status = 'released' AND x.class_id = $2
          WHERE $1::bigint = ANY(r.exam_ids) LIMIT 1`,
        [examId, section.class_id],
      );
      if (published.rows[0])
        throw new DomainError(
          'exams.result_published',
          `The results of this class are published in "${published.rows[0].name}": revoke the class (with a reason) before reopening marks`,
          { status: 409 },
        );
      await this.move(c, es.id, section.id, row.status, 'open', `Reopened: ${dto.note}`);
      await c.query(`SELECT app.compute_exam_results($1)`, [examId]);
      await this.audit.stage(ctx, c, {
        action: 'exams.marks.reopen',
        entityType: 'exam_subjects',
        entityId: es.id,
        before: { status: row.status },
        after: { classSectionId: section.id, reason: dto.note },
      });
      return this.one(c, tenant, ctx, es.id, section.id, yearId);
    });
  }

  /** One section × subject with its history. */
  private async one(
    c: PoolClient,
    tenant: TenantContext,
    ctx: RequestContext,
    esId: string,
    sectionId: string,
    yearId: string,
  ) {
    const r = await c.query<Raw>(
      // eslint-disable-next-line no-restricted-syntax -- ROWS is a constant; values are bound parameters
      `${ROWS} WHERE es.id = $1 AND cs.id = $2`,
      [esId, sectionId],
    );
    const log = await c.query<{
      from_status: string;
      to_status: string;
      note: string | null;
      by: string | null;
      at: Date;
    }>(
      `SELECT l.from_status, l.to_status, l.note, u.display_name AS by, l.at FROM exam_entry_status_log l
         LEFT JOIN users u ON u.id = l.actor_user_id
        WHERE l.exam_subject_id = $1 AND l.class_section_id = $2 ORDER BY l.at DESC, l.id DESC LIMIT 50`,
      [esId, sectionId],
    );
    const may = await this.verifiable(c, tenant, ctx, yearId);
    return {
      ...this.shape(r.rows[0]!, may, ctx.user.id),
      history: log.rows.map((x) => ({
        from: x.from_status,
        to: x.to_status,
        note: x.note,
        by: x.by,
        at: x.at.toISOString(),
      })),
    };
  }
}
