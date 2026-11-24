import { Injectable } from '@nestjs/common';
import {
  familyHiddenScreens,
  familyScreens,
  staffScreens,
  type Audience,
  type StaffWaiting,
} from '@edupro/menus';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import { FamilyLayoutService } from '../platform/family-layout.service';
import {
  STAFF_STANDARD_HEADINGS,
  STAFF_STANDARD_QUESTIONS,
  STANDARD_HEADINGS,
  STANDARD_QUESTIONS,
  helpPageAllowed,
  helpPages,
  type FamilyHelpHeadingDto,
  type FamilyHelpQuestionDto,
  type HelpApp,
} from './family-help.dto';

export interface QuestionRow {
  id: string;
  app: HelpApp;
  headingId: string | null;
  question: string;
  questionHi: string | null;
  answer: string;
  answerHi: string | null;
  audience: 'both' | 'parent' | 'student';
  page: string | null;
  hidden: boolean;
  position: number;
  standard: boolean;
  yes: number;
  no: number;
  myVote: boolean | null;
  updatedAt: string;
}
export interface HeadingRow {
  id: string;
  app: HelpApp;
  title: string;
  titleHi: string | null;
  position: number;
  standard: boolean;
}

const pageLabels: Record<HelpApp, Map<string, string>> = {
  family: new Map(helpPages('family').map((p) => [p.href, p.label])),
  staff: new Map(helpPages('staff').map((p) => [p.href, p.label])),
};
const standardOf = (app: HelpApp) =>
  app === 'staff'
    ? { headings: STAFF_STANDARD_HEADINGS, questions: STAFF_STANDARD_QUESTIONS }
    : { headings: STANDARD_HEADINGS, questions: STANDARD_QUESTIONS };
/** For the staff's Help: a screen opened only when work waits counts as one the person can open. */
const ANY_WAITING: StaffWaiting = {
  approvals: 1,
  profileChanges: 1,
  exits: 1,
  noDues: 1,
  admissions: 1,
  purchase: 1,
  requisitions: 1,
  orders: 1,
  receipts: 1,
  issues: 1,
  assets: 1,
  staffLeave: 1,
  staffRegularisations: 1,
  leaveReports: 1,
  team: 1,
};

/**
 * The Help pages kept by the school: the families' (0406) and the staff's (0422), each its own headings and
 * questions in the same tables (`app`). Helpdesk set-up edits them (order, shown or hidden, for parents / students /
 * both on the families' Help, the screen each is about); a reader sees only what is for them and the screens they can
 * open, and says whether an answer helped.
 */
@Injectable()
export class FamilyHelpService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly layouts: FamilyLayoutService,
  ) {}

  // ---------------------------------------------------------------------------------------- reading

  /** A Help as the office edits it: every heading and question, with the Yes / No counts. */
  async setup(ctx: RequestContext, app: HelpApp = 'family') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seeded(c, app);
      const headings = await this.headings(c, app);
      const questions = await this.questions(c, app);
      const standard = standardOf(app);
      return {
        app,
        headings,
        questions,
        pages: helpPages(app),
        // the standard headings and questions the school deleted (Restore puts them back)
        standardMissing:
          Math.max(0, standard.headings.length - headings.filter((h) => h.standard).length) +
          Math.max(0, standard.questions.length - questions.filter((q) => q.standard).length),
      };
    });
  }

  /**
   * The Help page of a parent or a student: the shown questions for them, without those about a screen they cannot
   * open, under their headings in the school's order ("Other questions" last); each with the person's own vote.
   */
  async family(ctx: RequestContext, as?: Audience) {
    const tenant = requireTenant(ctx);
    const permissions = [...(await this.access.effectivePermissions(tenant))];
    return this.db.tenant(tenant, async (c) => {
      await this.seeded(c, 'family');
      const audience = as ?? (await this.audienceOf(c));
      // the screens the person may open and the school does not hide (docs/design/90)
      const published = await this.layouts.published(ctx, audience);
      const hidden = published ? familyHiddenScreens(audience, published) : new Set<string>();
      const open = new Set(
        familyScreens(audience, permissions)
          .flatMap((g) => g.items.map((i) => i.href))
          .filter((h) => !hidden.has(h)),
      );
      const questions = (await this.questions(c, 'family')).filter(
        (q) =>
          !q.hidden &&
          (q.audience === 'both' || q.audience === audience) &&
          (q.page === null || open.has(q.page)),
      );
      return { audience, groups: this.grouped(await this.headings(c, 'family'), questions) };
    });
  }

  /**
   * The Help page of a staff member (0422): the shown staff questions, without those about a staff screen their
   * rights do not open, under their headings in the school's order ("Other questions" last). Staff only.
   */
  async staff(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const permissions = [...(await this.access.effectivePermissions(tenant))];
    const open = new Set(
      staffScreens(permissions, ANY_WAITING).flatMap((g) => g.items.map((i) => i.href)),
    );
    return this.db.tenant(tenant, async (c) => {
      // the staff's Help is for the school's staff (a parent may raise queries too, but reads the families' Help)
      const staff = await c.query<{ ok: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM user_school_memberships
                         WHERE user_id = app.current_user_id() AND school_id = app.current_school_id()
                           AND person_type::text = 'employee') AS ok`,
      );
      if (!staff.rows[0]?.ok)
        throw new DomainError('forbidden', 'Help for staff is for the school’s staff', {
          status: 403,
        });
      await this.seeded(c, 'staff');
      const questions = (await this.questions(c, 'staff')).filter(
        (q) => !q.hidden && (q.page === null || open.has(q.page)),
      );
      return {
        audience: 'staff',
        groups: this.grouped(await this.headings(c, 'staff'), questions),
      };
    });
  }

  /** The reader's groups: each heading with its questions, then "Other questions"; empty groups left out. */
  private grouped(headings: HeadingRow[], questions: QuestionRow[]) {
    const shape = (q: QuestionRow) => ({
      id: q.id,
      question: q.question,
      questionHi: q.questionHi,
      answer: q.answer,
      answerHi: q.answerHi,
      page: q.page,
      pageLabel: q.page ? (pageLabels[q.app].get(q.page) ?? null) : null,
      myVote: q.myVote,
    });
    return [
      ...headings.map((h) => ({
        id: h.id as string | null,
        title: h.title,
        titleHi: h.titleHi,
        questions: questions.filter((q) => q.headingId === h.id).map(shape),
      })),
      {
        id: null,
        title: 'Other questions',
        titleHi: 'अन्य प्रश्न',
        questions: questions.filter((q) => q.headingId === null).map(shape),
      },
    ].filter((g) => g.questions.length > 0);
  }

  /** A parent or student says whether an answer helped (once per question; a second answer replaces the first). */
  async vote(ctx: RequestContext, id: string, helpful: boolean) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = await c.query(
        `SELECT 1 FROM family_help_questions WHERE id = $1 AND deleted_at IS NULL AND NOT hidden`,
        [id],
      );
      if (!q.rowCount) throw new DomainError('not-found', 'Question not found', { status: 404 });
      await c.query(
        `INSERT INTO family_help_votes (school_id, question_id, user_id, helpful)
         VALUES (app.current_school_id(), $1, app.current_user_id(), $2)
         ON CONFLICT (question_id, user_id) DO UPDATE SET helpful = EXCLUDED.helpful, voted_at = now()`,
        [id, helpful],
      );
      return { ok: true, helpful };
    });
  }

  // ---------------------------------------------------------------------------------------- the office

  async addHeading(ctx: RequestContext, dto: FamilyHelpHeadingDto, app: HelpApp = 'family') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seeded(c, app);
      const r = await c.query<{ id: string }>(
        `INSERT INTO family_help_headings (school_id, app, title, title_hi, position, created_by, updated_by)
         VALUES (app.current_school_id(), $3, $1, $2,
                 (SELECT COALESCE(max(position), 0) + 1 FROM family_help_headings WHERE app = $3 AND deleted_at IS NULL),
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [dto.title, dto.titleHi ?? null, app],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${app}_help.heading_added`,
        entityType: 'family_help_headings',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  async editHeading(ctx: RequestContext, id: string, dto: FamilyHelpHeadingDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.heading(c, id);
      await c.query(
        `UPDATE family_help_headings SET title = $2, title_hi = $3, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [id, dto.title, dto.titleHi ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${before.app}_help.heading_changed`,
        entityType: 'family_help_headings',
        entityId: id,
        before: { title: before.title, titleHi: before.titleHi },
        after: dto,
      });
      return { ok: true };
    });
  }

  /** A heading goes; its questions stay, under "Other questions" at the end. */
  async deleteHeading(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.heading(c, id);
      const moved = await c.query(
        `UPDATE family_help_questions SET heading_id = NULL,
                position = (SELECT COALESCE(max(position), 0) FROM family_help_questions
                             WHERE app = $2 AND heading_id IS NULL AND deleted_at IS NULL) + position,
                updated_by = app.current_user_id(), updated_at = now()
          WHERE heading_id = $1 AND deleted_at IS NULL`,
        [id, before.app],
      );
      await c.query(
        `UPDATE family_help_headings SET deleted_at = now(), updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${before.app}_help.heading_deleted`,
        entityType: 'family_help_headings',
        entityId: id,
        before: { title: before.title, questionsMoved: moved.rowCount ?? 0 },
      });
      return { ok: true, questionsMoved: moved.rowCount ?? 0 };
    });
  }

  async moveHeading(ctx: RequestContext, id: string, direction: 'up' | 'down') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const h = await this.heading(c, id);
      const order = (await this.headings(c, h.app)).map((x) => x.id);
      await this.reorder(c, 'family_help_headings', order, id, direction);
      return { ok: true };
    });
  }

  async addQuestion(ctx: RequestContext, dto: FamilyHelpQuestionDto, app: HelpApp = 'family') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seeded(c, app);
      const headingId = dto.headingId ?? null;
      await this.checkQuestion(c, app, headingId, dto.page ?? null);
      const r = await c.query<{ id: string }>(
        `INSERT INTO family_help_questions (school_id, app, heading_id, question, question_hi, answer, answer_hi,
                audience, page, hidden, position, created_by, updated_by)
         VALUES (app.current_school_id(), $9, $1, $2, $3, $4, $5, $6, $7, $8,
                 (SELECT COALESCE(max(position), 0) + 1 FROM family_help_questions
                   WHERE app = $9 AND heading_id IS NOT DISTINCT FROM $1::bigint AND deleted_at IS NULL),
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          headingId,
          dto.question,
          dto.questionHi ?? null,
          dto.answer,
          dto.answerHi ?? null,
          // a staff question is for every staff member
          app === 'staff' ? 'both' : dto.audience,
          dto.page ?? null,
          dto.hidden,
          app,
        ],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${app}_help.question_added`,
        entityType: 'family_help_questions',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  /** A question changed; a new heading puts it last there; a new answer starts the Yes / No counts again. */
  async editQuestion(ctx: RequestContext, id: string, dto: FamilyHelpQuestionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.question(c, id);
      const headingId = dto.headingId ?? null;
      await this.checkQuestion(c, before.app, headingId, dto.page ?? null);
      const answerChanged =
        before.answer !== dto.answer || (before.answerHi ?? null) !== (dto.answerHi ?? null);
      await c.query(
        `UPDATE family_help_questions
            SET question = $2, question_hi = $3, answer = $4, answer_hi = $5, audience = $6, page = $7, hidden = $8,
                position = CASE WHEN heading_id IS NOT DISTINCT FROM $9::bigint THEN position ELSE
                  (SELECT COALESCE(max(position), 0) + 1 FROM family_help_questions
                    WHERE app = $11 AND heading_id IS NOT DISTINCT FROM $9::bigint AND deleted_at IS NULL) END,
                heading_id = $9::bigint,
                answer_changed_at = CASE WHEN $10::boolean THEN now() ELSE answer_changed_at END,
                updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.question,
          dto.questionHi ?? null,
          dto.answer,
          dto.answerHi ?? null,
          before.app === 'staff' ? 'both' : dto.audience,
          dto.page ?? null,
          dto.hidden,
          headingId,
          answerChanged,
          before.app,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${before.app}_help.question_changed`,
        entityType: 'family_help_questions',
        entityId: id,
        before: {
          headingId: before.headingId,
          question: before.question,
          answer: before.answer,
          audience: before.audience,
          page: before.page,
          hidden: before.hidden,
        },
        after: dto,
      });
      return { ok: true, countsRestarted: answerChanged };
    });
  }

  async deleteQuestion(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.question(c, id);
      await c.query(
        `UPDATE family_help_questions SET deleted_at = now(), updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${before.app}_help.question_deleted`,
        entityType: 'family_help_questions',
        entityId: id,
        before: { question: before.question, answer: before.answer },
      });
      return { ok: true };
    });
  }

  /** Up or down among the questions under the same heading. */
  async moveQuestion(ctx: RequestContext, id: string, direction: 'up' | 'down') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const q = await this.question(c, id);
      const order = (await this.questions(c, q.app))
        .filter((x) => x.headingId === q.headingId)
        .map((x) => x.id);
      await this.reorder(c, 'family_help_questions', order, id, direction);
      return { ok: true };
    });
  }

  /** Puts back the standard headings and questions the school deleted (each last in its place). */
  async restore(ctx: RequestContext, app: HelpApp = 'family') {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.seeded(c, app);
      const added = await this.addStandard(c, app);
      await this.audit.stage(ctx, c, {
        action: `helpdesk.${app}_help.restored`,
        entityType: 'family_help_questions',
        after: added,
      });
      return added;
    });
  }

  // ---------------------------------------------------------------------------------------- helpers

  /** The standard headings and questions on a school's first use of this Help (once). */
  private async seeded(c: PoolClient, app: HelpApp) {
    const r = await c.query(
      app === 'staff'
        ? `INSERT INTO staff_help_settings (school_id) VALUES (app.current_school_id())
           ON CONFLICT (school_id) DO NOTHING RETURNING school_id`
        : `INSERT INTO family_help_settings (school_id) VALUES (app.current_school_id())
           ON CONFLICT (school_id) DO NOTHING RETURNING school_id`,
    );
    if (r.rowCount) await this.addStandard(c, app);
  }

  /** The standard headings and questions not there (or deleted), each added last in its place. */
  private async addStandard(c: PoolClient, app: HelpApp) {
    let headings = 0;
    let questions = 0;
    const headingIds = new Map<string, string>();
    const standard = standardOf(app);
    for (const h of standard.headings) {
      const found = await c.query<{ id: string }>(
        `SELECT id::text FROM family_help_headings WHERE standard_key = $1 AND app = $2 AND deleted_at IS NULL`,
        [h.key, app],
      );
      if (found.rows[0]) {
        headingIds.set(h.key, found.rows[0].id);
        continue;
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO family_help_headings (school_id, app, title, title_hi, position, standard_key)
         VALUES (app.current_school_id(), $4, $1, $2,
                 (SELECT COALESCE(max(position), 0) + 1 FROM family_help_headings WHERE app = $4 AND deleted_at IS NULL), $3)
         RETURNING id::text`,
        [h.title, h.titleHi, h.key, app],
      );
      headingIds.set(h.key, r.rows[0]!.id);
      headings += 1;
    }
    for (const q of standard.questions) {
      const found = await c.query(
        `SELECT 1 FROM family_help_questions WHERE standard_key = $1 AND app = $2 AND deleted_at IS NULL`,
        [q.key, app],
      );
      if (found.rowCount) continue;
      const headingId = headingIds.get(q.heading) ?? null;
      await c.query(
        `INSERT INTO family_help_questions (school_id, app, heading_id, question, question_hi, answer, answer_hi,
                audience, page, position, standard_key)
         VALUES (app.current_school_id(), $9, $1, $2, $3, $4, $5, $6, $7,
                 (SELECT COALESCE(max(position), 0) + 1 FROM family_help_questions
                   WHERE app = $9 AND heading_id IS NOT DISTINCT FROM $1::bigint AND deleted_at IS NULL), $8)`,
        [headingId, q.question, q.questionHi, q.answer, q.answerHi, q.audience, q.page, q.key, app],
      );
      questions += 1;
    }
    return { headings, questions };
  }

  private async headings(c: PoolClient, app: HelpApp): Promise<HeadingRow[]> {
    const r = await c.query<HeadingRow>(
      `SELECT id::text, app, title, title_hi AS "titleHi", position, standard_key IS NOT NULL AS standard
         FROM family_help_headings WHERE app = $1 AND deleted_at IS NULL ORDER BY position, id`,
      [app],
    );
    return r.rows;
  }

  private async questions(c: PoolClient, app: HelpApp): Promise<QuestionRow[]> {
    const r = await c.query<QuestionRow>(
      `SELECT q.id::text, q.app, q.heading_id::text AS "headingId", q.question, q.question_hi AS "questionHi", q.answer,
              q.answer_hi AS "answerHi", q.audience, q.page, q.hidden, q.position, q.standard_key IS NOT NULL AS standard,
              (SELECT count(*)::int FROM family_help_votes v WHERE v.question_id = q.id AND v.helpful AND v.voted_at >= q.answer_changed_at) AS yes,
              (SELECT count(*)::int FROM family_help_votes v WHERE v.question_id = q.id AND NOT v.helpful AND v.voted_at >= q.answer_changed_at) AS no,
              (SELECT v.helpful FROM family_help_votes v WHERE v.question_id = q.id AND v.user_id = app.current_user_id()) AS "myVote",
              q.updated_at AS "updatedAt"
         FROM family_help_questions q
         LEFT JOIN family_help_headings h ON h.id = q.heading_id
        WHERE q.app = $1 AND q.deleted_at IS NULL
        ORDER BY h.position NULLS LAST, q.heading_id NULLS LAST, q.position, q.id`,
      [app],
    );
    return r.rows;
  }

  private async heading(c: PoolClient, id: string): Promise<HeadingRow> {
    const r = await c.query<HeadingRow>(
      `SELECT id::text, app, title, title_hi AS "titleHi", position, standard_key IS NOT NULL AS standard
         FROM family_help_headings WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Heading not found', { status: 404 });
    return r.rows[0];
  }

  private async question(c: PoolClient, id: string) {
    const r = await c.query<
      Pick<
        QuestionRow,
        'app' | 'headingId' | 'question' | 'answer' | 'answerHi' | 'audience' | 'page' | 'hidden'
      >
    >(
      `SELECT app, heading_id::text AS "headingId", question, answer, answer_hi AS "answerHi", audience, page, hidden
         FROM family_help_questions WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Question not found', { status: 404 });
    return r.rows[0];
  }

  /** A question's heading is one of the same Help, and its screen one of that Help's menu. */
  private async checkQuestion(
    c: PoolClient,
    app: HelpApp,
    headingId: string | null,
    page: string | null,
  ) {
    if (headingId && (await this.heading(c, headingId)).app !== app)
      throw new DomainError('validation-failed', 'That heading belongs to the other Help', {
        status: 400,
      });
    if (page && !helpPageAllowed(app, page))
      throw new DomainError(
        'validation-failed',
        app === 'staff'
          ? 'Choose a screen of the staff menu'
          : 'Choose a screen of the families’ menu',
        { status: 400 },
      );
  }

  /** Swaps a row with its neighbour in `order` and numbers the list 1, 2, 3 … again. */
  private async reorder(
    c: PoolClient,
    table: 'family_help_headings' | 'family_help_questions',
    order: string[],
    id: string,
    direction: 'up' | 'down',
  ) {
    const i = order.indexOf(id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- `table` is one of the two fixed table names of the type above
      `UPDATE ${table} t SET position = o.n, updated_by = app.current_user_id(), updated_at = now()
         FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n) WHERE t.id = o.id`,
      [order],
    );
  }

  /** A login that is a student here (no guardian or staff membership in the school) reads the students' Help. */
  private async audienceOf(c: PoolClient): Promise<Audience> {
    const r = await c.query<{ student: boolean }>(
      `SELECT COALESCE(bool_and(person_type::text = 'student'), false) AS student
         FROM user_school_memberships WHERE user_id = app.current_user_id() AND school_id = app.current_school_id()`,
    );
    return r.rows[0]?.student ? 'student' : 'parent';
  }
}
