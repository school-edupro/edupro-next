import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { codeOf, readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type {
  CoverageQueryDto,
  MarkTopicDto,
  SaveChapterDto,
  SaveTopicDto,
  SyllabusReportDto,
} from './planner.dto';

const MANAGE = 'academics.syllabus.manage';
const REPORT = 'academics.syllabus.report';
const PLAN = 'academics.lesson_plan.manage';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEADERS = [
  'Class code',
  'Subject code',
  'Chapter no',
  'Chapter name',
  'Term',
  'Planned month',
  'Topic no',
  'Topic name',
  'Periods',
];

export interface CoverageRow {
  classSectionId: string;
  section: string;
  classId: string;
  subjectId: string;
  subject: string;
  teacher: string | null;
  employeeId: string | null;
  chapters: number;
  topics: number;
  done: number;
  partial: number;
  /** Topics of the chapters whose planned month is over. */
  due: number;
  /** Done (a partly done topic counts half) as a share of all topics. */
  percent: number;
  /** Topics due by now that are not done: 0 when on track. */
  behind: number;
}

/**
 * The syllabus and its coverage (0094): chapters and topics per class and subject, a topic marked done
 * per section by the teacher who teaches it, and coverage against what was planned by now.
 */
@Injectable()
export class SyllabusService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
  ) {}

  private year(ctx: RequestContext): string {
    const id = requireTenant(ctx).academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  private need(ctx: RequestContext, permission: string) {
    if (!ctx.permissions?.has(permission))
      throw new DomainError('permission-denied', `This needs ${permission}`, { status: 403 });
  }

  // ---- the master ---------------------------------------------------------------------------------
  /** Every class and subject of the session with how much syllabus is entered. */
  async index(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        class_id: string;
        class_name: string;
        subject_id: string;
        subject: string;
        chapters: number;
        topics: number;
      }>(
        `SELECT k.id::text AS class_id, k.name AS class_name, s.id::text AS subject_id, s.name AS subject,
                count(DISTINCT ch.id)::int AS chapters, count(t.id)::int AS topics
           FROM classes k
           JOIN class_subjects x ON x.class_id = k.id AND x.academic_year_id = $1
           JOIN subjects s ON s.id = x.subject_id AND s.deleted_at IS NULL
           LEFT JOIN syllabus_chapters ch ON ch.class_id = k.id AND ch.subject_id = s.id AND ch.academic_year_id = $1
           LEFT JOIN syllabus_topics t ON t.chapter_id = ch.id
          WHERE k.deleted_at IS NULL
          GROUP BY k.id, k.name, k.display_order, s.id, s.name, s.display_order
          ORDER BY k.display_order, k.name, s.display_order, s.name`,
        [yearId],
      );
      return r.rows.map((x) => ({
        classId: x.class_id,
        className: x.class_name,
        subjectId: x.subject_id,
        subject: x.subject,
        chapters: x.chapters,
        topics: x.topics,
      }));
    });
  }

  /** The chapters and topics of a class and subject; with a section, what is done there. */
  async tree(ctx: RequestContext, classId: string, subjectId: string, classSectionId?: string) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.treeIn(c, yearId, classId, subjectId, classSectionId),
    );
  }

  private async treeIn(
    c: PoolClient,
    yearId: string,
    classId: string,
    subjectId: string,
    classSectionId?: string,
  ) {
    const r = await c.query<{
      chapter_id: string;
      ch_no: number;
      chapter: string;
      term: string | null;
      planned_month: number | null;
      topic_id: string | null;
      t_no: number | null;
      topic: string | null;
      planned_periods: number | null;
      status: string | null;
      done_on: string | null;
      reason: string | null;
    }>(
      `SELECT ch.id::text AS chapter_id, ch.number AS ch_no, ch.name AS chapter, ch.term, ch.planned_month,
              t.id::text AS topic_id, t.number AS t_no, t.name AS topic, t.planned_periods,
              p.status, p.done_on::text, p.reason
         FROM syllabus_chapters ch
         LEFT JOIN syllabus_topics t ON t.chapter_id = ch.id
         LEFT JOIN syllabus_progress p ON p.topic_id = t.id AND p.class_section_id = $4::bigint
        WHERE ch.academic_year_id = $1 AND ch.class_id = $2 AND ch.subject_id = $3
        ORDER BY ch.number, t.number`,
      [yearId, classId, subjectId, classSectionId ?? null],
    );
    const chapters = new Map<
      string,
      {
        id: string;
        number: number;
        name: string;
        term: string | null;
        plannedMonth: number | null;
        topics: Array<{
          id: string;
          number: number;
          name: string;
          plannedPeriods: number;
          status: 'done' | 'partial' | 'not_done' | null;
          doneOn: string | null;
          reason: string | null;
        }>;
      }
    >();
    for (const x of r.rows) {
      const ch = chapters.get(x.chapter_id) ?? {
        id: x.chapter_id,
        number: x.ch_no,
        name: x.chapter,
        term: x.term,
        plannedMonth: x.planned_month,
        topics: [],
      };
      if (x.topic_id)
        ch.topics.push({
          id: x.topic_id,
          number: x.t_no!,
          name: x.topic!,
          plannedPeriods: x.planned_periods ?? 1,
          status: (x.status as 'done' | 'partial' | 'not_done' | null) ?? null,
          doneOn: x.done_on,
          reason: x.reason,
        });
      chapters.set(x.chapter_id, ch);
    }
    return {
      classId,
      subjectId,
      classSectionId: classSectionId ?? null,
      chapters: [...chapters.values()],
    };
  }

  async saveChapter(ctx: RequestContext, dto: SaveChapterDto) {
    this.need(ctx, MANAGE);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = dto.id
          ? await c.query<{ id: string }>(
              `UPDATE syllabus_chapters SET number = $2, name = $3, term = $4, planned_month = $5, updated_at = now(), updated_by = app.current_user_id()
                WHERE id = $1 AND academic_year_id = $6 RETURNING id::text`,
              [dto.id, dto.number, dto.name, dto.term ?? null, dto.plannedMonth ?? null, yearId],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO syllabus_chapters (school_id, academic_year_id, class_id, subject_id, number, name, term, planned_month, created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id(), app.current_user_id()) RETURNING id::text`,
              [
                yearId,
                dto.classId,
                dto.subjectId,
                dto.number,
                dto.name,
                dto.term ?? null,
                dto.plannedMonth ?? null,
              ],
            );
        if (!r.rows[0]) throw new DomainError('not-found', 'Chapter not found', { status: 404 });
        return { id: r.rows[0].id };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'validation-failed',
            `Chapter ${String(dto.number)} already exists for this class and subject`,
            { status: 400 },
          );
        throw error;
      }
    });
  }

  async removeChapter(ctx: RequestContext, id: string) {
    this.need(ctx, MANAGE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = await c.query(
        `SELECT 1 FROM syllabus_progress p JOIN syllabus_topics t ON t.id = p.topic_id WHERE t.chapter_id = $1 LIMIT 1`,
        [id],
      );
      if (used.rowCount)
        throw new DomainError(
          'syllabus.in_use',
          'A teacher has already marked topics of this chapter; it cannot be removed',
          { status: 409 },
        );
      await c.query(`DELETE FROM syllabus_chapters WHERE id = $1`, [id]);
      return { removed: true };
    });
  }

  async saveTopic(ctx: RequestContext, dto: SaveTopicDto) {
    this.need(ctx, MANAGE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      try {
        const r = dto.id
          ? await c.query<{ id: string }>(
              `UPDATE syllabus_topics SET number = $2, name = $3, planned_periods = $4 WHERE id = $1 RETURNING id::text`,
              [dto.id, dto.number, dto.name, dto.plannedPeriods],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO syllabus_topics (school_id, chapter_id, number, name, planned_periods)
               VALUES (app.current_school_id(), $1, $2, $3, $4) RETURNING id::text`,
              [dto.chapterId, dto.number, dto.name, dto.plannedPeriods],
            );
        if (!r.rows[0]) throw new DomainError('not-found', 'Topic not found', { status: 404 });
        return { id: r.rows[0].id };
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError(
            'validation-failed',
            `Topic ${String(dto.number)} already exists in this chapter`,
            { status: 400 },
          );
        throw error;
      }
    });
  }

  async removeTopic(ctx: RequestContext, id: string) {
    this.need(ctx, MANAGE);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const used = await c.query(`SELECT 1 FROM syllabus_progress WHERE topic_id = $1 LIMIT 1`, [
        id,
      ]);
      if (used.rowCount)
        throw new DomainError(
          'syllabus.in_use',
          'A teacher has already marked this topic; it cannot be removed',
          { status: 409 },
        );
      await c.query(`DELETE FROM syllabus_topics WHERE id = $1`, [id]);
      return { removed: true };
    });
  }

  async template(ctx: RequestContext) {
    this.need(ctx, MANAGE);
    const lists = await this.db.tenant(requireTenant(ctx), async (c) => ({
      classes: (
        await c.query<{ v: string }>(
          `SELECT code || ' · ' || name AS v FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code`,
        )
      ).rows.map((x) => x.v),
      subjects: (
        await c.query<{ v: string }>(
          `SELECT code || ' · ' || name AS v FROM subjects WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_order, name`,
        )
      ).rows.map((x) => x.v),
    }));
    return {
      filename: 'syllabus-format.xlsx',
      bytes: await templateSheet({
        sheet: 'Syllabus',
        columns: [
          { header: HEADERS[0]!, width: 18, options: lists.classes, required: true },
          { header: HEADERS[1]!, width: 24, options: lists.subjects, required: true },
          { header: HEADERS[2]!, width: 10, required: true },
          { header: HEADERS[3]!, width: 30, required: true },
          { header: HEADERS[4]!, width: 10 },
          { header: HEADERS[5]!, width: 14, options: MONTHS },
          { header: HEADERS[6]!, width: 10, required: true },
          { header: HEADERS[7]!, width: 40, required: true },
          { header: HEADERS[8]!, width: 8 },
        ],
        guide: [
          'One row for each topic. Repeat the class, subject, chapter number and chapter name on every row of the chapter.',
          'Planned month: the month the chapter should be finished in. Periods: how many periods the topic needs (1 when empty).',
          'Uploading again updates the names; nothing is removed.',
        ],
      }),
    };
  }

  /** Chapters and topics from the filled format: a row that is wrong is reported, the rest are saved. */
  async import(ctx: RequestContext, fileBase64: string) {
    this.need(ctx, MANAGE);
    const yearId = this.year(ctx);
    const rows = await readSheet(fileBase64, HEADERS);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const classes = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, lower(code) AS code FROM classes WHERE deleted_at IS NULL`,
          )
        ).rows.map((x) => [x.code, x.id]),
      );
      const subjects = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, lower(code) AS code FROM subjects WHERE deleted_at IS NULL`,
          )
        ).rows.map((x) => [x.code, x.id]),
      );
      const problems: Array<{ row: number; message: string }> = [];
      let chapters = 0;
      let topics = 0;
      const seenChapter = new Set<string>();
      for (const r of rows) {
        const cell = (i: number) => r.cells[HEADERS[i]!]!.trim();
        const classId = classes.get(codeOf(cell(0)).toLowerCase());
        const subjectId = subjects.get(codeOf(cell(1)).toLowerCase());
        const chNo = Number(cell(2));
        const tNo = Number(cell(6));
        const month = cell(5)
          ? MONTHS.findIndex((m) => cell(5).toLowerCase().startsWith(m.toLowerCase())) + 1
          : 0;
        const periods = cell(8) ? Number(cell(8)) : 1;
        const bad = !classId
          ? 'Class code is not a class of the school'
          : !subjectId
            ? 'Subject code is not a subject of the school'
            : !Number.isInteger(chNo) || chNo < 1 || chNo > 200
              ? 'Chapter no must be a number from 1 to 200'
              : !cell(3)
                ? 'Chapter name is empty'
                : !Number.isInteger(tNo) || tNo < 1 || tNo > 500
                  ? 'Topic no must be a number from 1 to 500'
                  : !cell(7)
                    ? 'Topic name is empty'
                    : cell(5) && !month
                      ? 'Planned month must be a month, like Jul'
                      : !Number.isInteger(periods) || periods < 1 || periods > 60
                        ? 'Periods must be a number from 1 to 60'
                        : null;
        if (bad) {
          problems.push({ row: r.row, message: bad });
          continue;
        }
        const ch = await c.query<{ id: string }>(
          `INSERT INTO syllabus_chapters (school_id, academic_year_id, class_id, subject_id, number, name, term, planned_month, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, app.current_user_id(), app.current_user_id())
           ON CONFLICT (academic_year_id, class_id, subject_id, number) DO UPDATE SET name = EXCLUDED.name,
             term = COALESCE(EXCLUDED.term, syllabus_chapters.term), planned_month = COALESCE(EXCLUDED.planned_month, syllabus_chapters.planned_month),
             updated_at = now(), updated_by = app.current_user_id()
           RETURNING id::text`,
          [yearId, classId, subjectId, chNo, cell(3).slice(0, 200), cell(4) || null, month || null],
        );
        const chapterId = ch.rows[0]!.id;
        if (!seenChapter.has(chapterId)) chapters += 1;
        seenChapter.add(chapterId);
        await c.query(
          `INSERT INTO syllabus_topics (school_id, chapter_id, number, name, planned_periods)
           VALUES (app.current_school_id(), $1, $2, $3, $4)
           ON CONFLICT (chapter_id, number) DO UPDATE SET name = EXCLUDED.name, planned_periods = EXCLUDED.planned_periods`,
          [chapterId, tNo, cell(7).slice(0, 300), periods],
        );
        topics += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'academics.syllabus.import',
        entityType: 'syllabus_chapters',
        entityId: yearId,
        after: { chapters, topics, problems: problems.length },
      });
      return { chapters, topics, problems };
    });
  }

  // ---- the teacher marks ------------------------------------------------------------------------------
  /** The sections and subjects the caller teaches, each with its coverage. */
  async mine(ctx: RequestContext): Promise<CoverageRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.coverageIn(c, yearId, {}, 'app.current_user_id()'),
    );
  }

  async mark(ctx: RequestContext, dto: MarkTopicDto) {
    this.need(ctx, PLAN);
    const tenant = requireTenant(ctx);
    const yearId = this.year(ctx);
    const allowed = await this.scopes.filter(tenant, PLAN, 'class_section');
    if (allowed !== null && !allowed.includes(dto.classSectionId))
      throw new DomainError('scope-denied', 'This class is not assigned to you', { status: 403 });
    return this.db.tenant(tenant, async (c) => {
      const t = await c.query<{ subject_id: string; ok: boolean }>(
        `SELECT ch.subject_id::text, (ch.class_id = cs.class_id AND ch.academic_year_id = $3) AS ok
           FROM syllabus_topics t JOIN syllabus_chapters ch ON ch.id = t.chapter_id, class_sections cs
          WHERE t.id = $1 AND cs.id = $2`,
        [dto.topicId, dto.classSectionId, yearId],
      );
      if (!t.rows[0]?.ok)
        throw new DomainError('not-found', 'This topic is not of that class', { status: 404 });
      if (allowed !== null) {
        // a teacher marks the subjects given to them in the class (a coordinator any)
        const mine = await c.query(
          `SELECT 1 FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
            WHERE e.user_id = app.current_user_id() AND ta.class_section_id = $1 AND ta.academic_year_id = $2 AND ta.valid_to IS NULL
              AND (ta.kind = 'coordinator' OR ta.subject_id = $3) LIMIT 1`,
          [dto.classSectionId, yearId, t.rows[0].subject_id],
        );
        if (!mine.rowCount)
          throw new DomainError(
            'daily.subject_not_assigned',
            'This subject is not assigned to you in this class',
            { status: 403 },
          );
      }
      if (dto.status === 'not_done' && !dto.reason)
        throw new DomainError('validation-failed', 'Write why the topic was not done', {
          status: 400,
        });
      await c.query(
        `INSERT INTO syllabus_progress (school_id, topic_id, class_section_id, status, done_on, reason, employee_id, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, CASE WHEN $3 = 'not_done' THEN NULL ELSE COALESCE($4::date, CURRENT_DATE) END, $5,
                 (SELECT id FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1), app.current_user_id())
         ON CONFLICT (topic_id, class_section_id) DO UPDATE SET status = EXCLUDED.status, done_on = EXCLUDED.done_on, reason = EXCLUDED.reason,
           employee_id = EXCLUDED.employee_id, updated_at = now(), updated_by = app.current_user_id()`,
        [dto.topicId, dto.classSectionId, dto.status, dto.doneOn ?? null, dto.reason ?? null],
      );
      return { saved: true };
    });
  }

  // ---- coverage ------------------------------------------------------------------------------------
  private async coverageIn(
    c: PoolClient,
    yearId: string,
    q: { classId?: string; subjectId?: string; employeeId?: string },
    ownUserSql?: string,
  ): Promise<CoverageRow[]> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- ownUserSql is a fixed fragment chosen in code; values are bound
      `WITH yr AS (SELECT EXTRACT(MONTH FROM start_date)::int AS m0,
                          LEAST(GREATEST(CURRENT_DATE, start_date), end_date) AS today FROM academic_years WHERE id = $1),
            pairs AS (
              SELECT cs.id AS section_id, k.code || '-' || cs.name AS section, k.id AS class_id, k.display_order, cs.name AS sec_name,
                     s.id AS subject_id, s.name AS subject, s.display_order AS s_order
                FROM class_sections cs JOIN classes k ON k.id = cs.class_id
                JOIN (SELECT DISTINCT class_id, subject_id FROM syllabus_chapters WHERE academic_year_id = $1) x ON x.class_id = k.id
                JOIN subjects s ON s.id = x.subject_id
               WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL
                 AND ($2::bigint IS NULL OR k.id = $2) AND ($3::bigint IS NULL OR s.id = $3))
       SELECT p.section_id::text, p.section, p.class_id::text, p.subject_id::text, p.subject, tch.name AS teacher, tch.id::text AS employee_id,
              count(DISTINCT ch.id)::int AS chapters, count(t.id)::int AS topics,
              count(*) FILTER (WHERE pr.status = 'done')::int AS done,
              count(*) FILTER (WHERE pr.status = 'partial')::int AS partial,
              count(t.id) FILTER (WHERE ch.planned_month IS NOT NULL
                AND ((ch.planned_month - yr.m0 + 12) % 12) < ((EXTRACT(MONTH FROM yr.today)::int - yr.m0 + 12) % 12))::int AS due,
              count(t.id) FILTER (WHERE ch.planned_month IS NOT NULL AND pr.status IS DISTINCT FROM 'done'
                AND ((ch.planned_month - yr.m0 + 12) % 12) < ((EXTRACT(MONTH FROM yr.today)::int - yr.m0 + 12) % 12))::int AS behind
         FROM pairs p CROSS JOIN yr
         JOIN syllabus_chapters ch ON ch.class_id = p.class_id AND ch.subject_id = p.subject_id AND ch.academic_year_id = $1
         LEFT JOIN syllabus_topics t ON t.chapter_id = ch.id
         LEFT JOIN syllabus_progress pr ON pr.topic_id = t.id AND pr.class_section_id = p.section_id
         LEFT JOIN LATERAL (
           SELECT e.id, e.display_name AS name, e.user_id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
            WHERE ta.class_section_id = p.section_id AND ta.subject_id = p.subject_id AND ta.academic_year_id = $1 AND ta.valid_to IS NULL
            ORDER BY (ta.kind = 'subject_teacher') DESC, ta.id LIMIT 1) tch ON true
        WHERE ($4::bigint IS NULL OR tch.id = $4)
          ${ownUserSql ? `AND tch.user_id = ${ownUserSql}` : ''}
        GROUP BY p.section_id, p.section, p.class_id, p.display_order, p.sec_name, p.subject_id, p.subject, p.s_order, tch.name, tch.id
        ORDER BY p.display_order, p.sec_name, p.s_order, p.subject`,
      [yearId, q.classId ?? null, q.subjectId ?? null, q.employeeId ?? null],
    );
    return r.rows.map((x) => {
      const topics = Number(x.topics);
      const done = Number(x.done);
      const partial = Number(x.partial);
      return {
        classSectionId: String(x.section_id),
        section: String(x.section),
        classId: String(x.class_id),
        subjectId: String(x.subject_id),
        subject: String(x.subject),
        teacher: (x.teacher as string | null) ?? null,
        employeeId: (x.employee_id as string | null) ?? null,
        chapters: Number(x.chapters),
        topics,
        done,
        partial,
        due: Number(x.due),
        percent: topics ? Math.round(((done + partial / 2) / topics) * 100) : 0,
        behind: Number(x.behind),
      };
    });
  }

  async coverage(ctx: RequestContext, q: CoverageQueryDto): Promise<CoverageRow[]> {
    this.need(ctx, REPORT);
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) => this.coverageIn(c, yearId, q));
  }

  /** Teachers (anyone with a class assigned) who uploaded no lesson in the week. */
  private async missingIn(c: PoolClient, yearId: string, weekStart: string) {
    const r = await c.query<{ teacher: string; code: string; department: string }>(
      `SELECT e.display_name AS teacher, e.employee_code AS code, COALESCE(e.department, '') AS department
         FROM employees e
        WHERE e.deleted_at IS NULL AND e.status = 'active'
          AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = e.id AND ta.academic_year_id = $1 AND ta.valid_to IS NULL)
          AND NOT EXISTS (SELECT 1 FROM lesson_uploads l WHERE l.employee_id = e.id AND l.academic_year_id = $1 AND l.deleted_at IS NULL
                           AND l.on_date BETWEEN $2::date AND $2::date + 6)
        ORDER BY e.display_name`,
      [yearId, weekStart],
    );
    return r.rows.map((x) => ({
      teacher: x.teacher,
      employeeCode: x.code,
      department: x.department,
    }));
  }

  /** The Monday of this week (school time), or of the week a date falls in. */
  private monday(date?: string): string {
    const d = date ? new Date(`${date}T00:00:00Z`) : new Date(Date.now() + 5.5 * 3_600_000);
    const back = (d.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back))
      .toISOString()
      .slice(0, 10);
  }

  /** The planner's dashboard: coverage by class, subject and teacher, who lags, and the week's plans. */
  async dashboard(ctx: RequestContext, week?: string) {
    this.need(ctx, REPORT);
    const yearId = this.year(ctx);
    const weekStart = this.monday(week);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await this.coverageIn(c, yearId, {});
      const missing = await this.missingIn(c, yearId, weekStart);
      const plans = await c.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM lesson_uploads WHERE academic_year_id = $1 AND on_date BETWEEN $2::date AND $2::date + 6 AND deleted_at IS NULL GROUP BY 1`,
        [yearId, weekStart],
      );
      const group = (key: (r: CoverageRow) => string) => {
        const m = new Map<string, { topics: number; score: number; behind: number }>();
        for (const r of rows) {
          const g = m.get(key(r)) ?? { topics: 0, score: 0, behind: 0 };
          g.topics += r.topics;
          g.score += r.done + r.partial / 2;
          g.behind += r.behind;
          m.set(key(r), g);
        }
        return [...m.entries()].map(([label, g]) => ({
          label,
          percent: g.topics ? Math.round((g.score / g.topics) * 100) : 0,
          behind: g.behind,
        }));
      };
      const topics = rows.reduce((n, r) => n + r.topics, 0);
      const score = rows.reduce((n, r) => n + r.done + r.partial / 2, 0);
      const count = (s: string) => plans.rows.find((p) => p.status === s)?.n ?? 0;
      return {
        weekStart,
        kpis: {
          percent: topics ? Math.round((score / topics) * 100) : 0,
          topics,
          done: rows.reduce((n, r) => n + r.done, 0),
          sections: rows.length,
          lagging: rows.filter((r) => r.behind > 0).length,
          noTeacher: rows.filter((r) => !r.teacher).length,
          plansApproved: count('acknowledged'),
          plansWaiting: count('pending'),
          plansMissing: missing.length,
        },
        byClass: group((r) => r.section.split('-')[0]!),
        bySubject: group((r) => r.subject),
        byTeacher: group((r) => r.teacher ?? 'No teacher assigned').sort(
          (a, b) => a.percent - b.percent,
        ),
        lagging: rows
          .filter((r) => r.behind > 0)
          .sort((a, b) => b.behind - a.behind)
          .slice(0, 15),
        missing: missing.slice(0, 15),
      };
    });
  }

  /** Coverage, the topic-wise status of a class and subject, or the week's missing plans, as Excel or PDF. */
  async reportFile(ctx: RequestContext, q: SyllabusReportDto) {
    this.need(ctx, REPORT);
    const yearId = this.year(ctx);
    const tenant = requireTenant(ctx);
    const head = await this.db.tenant(tenant, (c) => schoolHead(c));
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.report === 'missing') {
      const weekStart = this.monday(q.week);
      const rows = await this.db.tenant(tenant, (c) => this.missingIn(c, yearId, weekStart));
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Teachers who uploaded no lesson',
          details: [`Week starting ${weekStart}`, generatedOn()],
          legend: `${String(rows.length)} teacher(s)`,
          columns: [
            { label: 'Sl.', width: 3, right: true },
            { label: 'Emp. code', width: 8 },
            { label: 'Teacher', width: 20 },
            { label: 'Department', width: 14 },
          ],
          rows: rows.map((r, i) => [i + 1, r.employeeCode, r.teacher, r.department]),
          filename: `lessons-not-uploaded-${weekStart}`,
        },
        q.format,
      );
    }
    if (q.report === 'topics') {
      if (!q.classSectionId || !q.subjectId)
        throw new DomainError('validation-failed', 'Choose the class and the subject', {
          status: 400,
        });
      const data = await this.db.tenant(tenant, async (c) => {
        const sec = await c.query<{ class_id: string; section: string; subject: string }>(
          `SELECT cs.class_id::text, k.code || '-' || cs.name AS section, (SELECT name FROM subjects WHERE id = $2) AS subject
             FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
          [q.classSectionId, q.subjectId],
        );
        if (!sec.rows[0]) throw new DomainError('not-found', 'Class not found', { status: 404 });
        return {
          ...sec.rows[0],
          tree: await this.treeIn(c, yearId, sec.rows[0].class_id, q.subjectId!, q.classSectionId),
        };
      });
      const STATUS = { done: 'Done', partial: 'Partly done', not_done: 'Not done' };
      const lines = data.tree.chapters.flatMap((ch) =>
        ch.topics.map((t) => [
          `${String(ch.number)}. ${ch.name}`,
          ch.plannedMonth ? MONTHS[ch.plannedMonth - 1]! : '',
          `${String(ch.number)}.${String(t.number)} ${t.name}`,
          t.plannedPeriods,
          t.status ? STATUS[t.status] : 'Pending',
          t.doneOn ?? '',
          t.reason ?? '',
        ]),
      );
      return registerFile(
        {
          school: head.name,
          address: head.address,
          report: 'Syllabus status, topic by topic',
          details: [`Class ${data.section}`, `Subject ${data.subject}`, generatedOn()],
          legend: `${String(lines.length)} topic(s)`,
          columns: [
            { label: 'Chapter', width: 18 },
            { label: 'Planned', width: 5 },
            { label: 'Topic', width: 26 },
            { label: 'Periods', width: 4, right: true },
            { label: 'Status', width: 7 },
            { label: 'Done on', width: 7 },
            { label: 'Reason', width: 16 },
          ],
          rows: lines,
          filename: `syllabus-status-${stamp}`,
        },
        q.format,
      );
    }
    const rows = await this.db.tenant(tenant, (c) => this.coverageIn(c, yearId, q));
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Syllabus coverage',
        details: [generatedOn()],
        legend: `${String(rows.length)} class and subject line(s) · behind = topics planned by last month and not done`,
        columns: [
          { label: 'Sl.', width: 3, right: true },
          { label: 'Class', width: 6 },
          { label: 'Subject', width: 16 },
          { label: 'Teacher', width: 16 },
          { label: 'Chapters', width: 5, right: true },
          { label: 'Topics', width: 5, right: true },
          { label: 'Done', width: 5, right: true },
          { label: 'Partly', width: 5, right: true },
          { label: 'Coverage %', width: 6, right: true },
          { label: 'Due by now', width: 6, right: true },
          { label: 'Behind', width: 5, right: true },
        ],
        rows: rows.map((r, i) => [
          i + 1,
          r.section,
          r.subject,
          r.teacher ?? 'Not assigned',
          r.chapters,
          r.topics,
          r.done,
          r.partial,
          r.percent,
          r.due,
          r.behind,
        ]),
        filename: `syllabus-coverage-${stamp}`,
      },
      q.format,
    );
  }
}
