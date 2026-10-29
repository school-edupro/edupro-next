import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ExamEntryService, MARKS } from './exam-entry.service';
import { EXAMS, type EntryStatusActionDto, type EntryStatusNoteDto } from './exams.dto';
import { MarkSchemesService } from './mark-schemes.service';

type Status = 'open' | 'submitted' | 'verified';

export interface EntryStatusRow {
  examId: string;
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
  /** the caller may verify / send back this one */
  canVerify: boolean;
}

/** One section × subject of the exams asked for, with how many take it and how many are entered. */
const ROWS = `
  SELECT e.id::text AS exam_id, e.code AS exam_code, es.id::text AS exam_subject_id, es.subject_id::text, sub.code AS subject_code,
         sub.name AS subject_name, cs.id::text AS class_section_id, k.code || '-' || cs.name AS section,
         (SELECT count(*)::int FROM enrolments en WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id
             AND en.status = 'active' AND app.student_subject_kind(en.student_id, e.academic_year_id, es.subject_id) IS NOT NULL) AS takers,
         (SELECT count(*)::int FROM enrolments en JOIN mark_entries m ON m.student_id = en.student_id AND m.exam_subject_id = es.id
           WHERE en.class_section_id = cs.id AND en.academic_year_id = e.academic_year_id AND en.status = 'active'
             AND app.student_subject_kind(en.student_id, e.academic_year_id, es.subject_id) IS NOT NULL) AS entered,
         COALESCE(st.status, 'open') AS status, su.display_name AS submitted_by, st.submitted_at, st.submitted_by::text AS submitted_by_id,
         vu.display_name AS verified_by, st.verified_at, st.remark
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
      section: r.section,
      takers: r.takers,
      entered: r.entered,
      status: r.status,
      submittedBy: r.submitted_by,
      submittedAt: r.submitted_at?.toISOString() ?? null,
      verifiedBy: r.verified_by,
      verifiedAt: r.verified_at?.toISOString() ?? null,
      remark: r.remark,
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
          ORDER BY k.display_order, k.code, cs.name, sub.display_order, sub.code`,
        [examId, classId ?? null, allowed],
      );
      const may = await this.verifiable(c, tenant, ctx, yearId);
      const rows = r.rows.map((x) => this.shape(x, may, ctx.user.id));
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
      const published = await c.query<{ name: string }>(
        `SELECT name FROM report_card_releases WHERE status = 'released' AND $1::bigint = ANY(exam_ids) LIMIT 1`,
        [examId],
      );
      if (published.rows[0])
        throw new DomainError(
          'exams.result_published',
          `The results are published in "${published.rows[0].name}": withdraw it (with a reason) before reopening marks`,
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
