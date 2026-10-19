import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  AcrDecideDto,
  AcrLevelDto,
  AcrOfficeFactsDto,
  AcrReasonDto,
  AcrRepresentDto,
  AcrReviewersDto,
  AcrSelfDto,
} from './acr.dto';
import { AcrSetupService } from './acr-setup.service';
import { PEOPLE } from './people.permissions';

type Group = 'teaching' | 'non_teaching';
type Answer = number | string;
export interface Question {
  id: string;
  /** the section's title, id and weight (0191); questions without a section row keep their text */
  section: string;
  sectionId: string | null;
  sectionWeight: number;
  sectionHelp: string | null;
  text: string;
  kind: 'scale' | 'text' | 'yesno';
  weight: number;
  required: boolean;
}
/** A form as the sheet shows it (0191). */
export interface FormView {
  id: string;
  name: string;
  sections: Array<{
    id: string;
    title: string;
    help: string | null;
    weight: number;
    questions: Array<Pick<Question, 'id' | 'text' | 'kind' | 'weight' | 'required'>>;
  }>;
}
export type SectionScore = { id: string; title: string; weight: number; pct: number | null };
interface Band {
  min_pct: number;
  label: string;
  adverse: boolean;
}
interface ReportRow {
  id: string;
  cycle_id: string;
  employee_id: string;
  staff_group: Group;
  status: 'self' | 'review' | 'disclosed' | 'represented' | 'closed';
  current_level: number | null;
  self_answers: Record<string, Answer>;
  auto_facts: Record<string, unknown> | null;
  office_facts: Record<string, unknown>;
  self_pct: string | null;
  self_submitted_at: Date | null;
  self_form_id: string | null;
  score_pct: string | null;
  grade: string | null;
  adverse: boolean;
  disclosed_at: Date | null;
  object_by: string | null;
  acknowledged_at: Date | null;
  representation: string | null;
  represented_at: Date | null;
  decision: string | null;
  decision_note: string | null;
  decided_at: Date | null;
  closed_at: Date | null;
  cycle_status: 'draft' | 'open' | 'closed';
  self_from: string;
  self_to: string;
  academic_year_id: string;
}
interface ReviewRow {
  id: string;
  seq: number;
  label: string;
  action: 'rate' | 'review';
  reviewer_ids: string[];
  status: 'waiting' | 'pending' | 'done' | 'skipped';
  answers: Record<string, Answer>;
  remarks: string | null;
  score_pct: string | null;
  grade: string | null;
  grade_reason: string | null;
  agreement: string | null;
  filled_by_name: string | null;
  filled_at: Date | null;
  skipped_note: string | null;
  form_id: string | null;
}

const REPORT = `SELECT r.id::text, r.cycle_id::text, r.employee_id::text, r.staff_group, r.status, r.current_level,
       r.self_answers, r.auto_facts, r.office_facts, r.self_pct::text, r.self_submitted_at, r.self_form_id::text, r.score_pct::text,
       r.grade, r.adverse, r.disclosed_at, r.object_by::text, r.acknowledged_at, r.representation,
       r.represented_at, r.decision, r.decision_note, r.decided_at, r.closed_at,
       cy.status AS cycle_status, cy.self_from::text, cy.self_to::text, cy.academic_year_id::text
  FROM acr_reports r JOIN acr_cycles cy ON cy.id = r.cycle_id`;
const REVIEW_COLS = `SELECT id::text, seq, label, action, reviewer_ids::text[] AS reviewer_ids, status, answers,
       remarks, score_pct::text, grade, grade_reason, agreement, filled_by_name, filled_at, skipped_note, form_id::text FROM acr_reviews`;
// eslint-disable-next-line no-restricted-syntax -- fixed fragments, values are bound
const REVIEWS = `${REVIEW_COLS} WHERE report_id = $1 ORDER BY seq`;
// eslint-disable-next-line no-restricted-syntax -- fixed fragments, values are bound
const REVIEW_ONE = `${REVIEW_COLS} WHERE report_id = $1 AND seq = $2`;

const pct = (n: number) => Math.round(n * 100) / 100;

/**
 * The ACR flow (docs/design/32-employee-acr.md, part 2): a cycle starts an ACR for every active employee with
 * the people of each level; the employee fills the self-appraisal inside the window; each level in turn
 * rates or reviews (only its people), or sends it back one step; the score gives the grade; the employee
 * sees it, acknowledges or objects within the days set; the school decides.
 */
@Injectable()
export class AcrFlowService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly setup: AcrSetupService,
  ) {}

  // ---- helpers -----------------------------------------------------------------------------------

  private manager(ctx: RequestContext) {
    return ctx.permissions?.has(PEOPLE.acrManage) ?? false;
  }
  private viewer(ctx: RequestContext) {
    return this.manager(ctx) || (ctx.permissions?.has(PEOPLE.acrView) ?? false);
  }

  /** The signed-in person's employee record here (null for those who are not staff). */
  private async myEmployee(c: PoolClient): Promise<string | null> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    return r.rows[0]?.id ?? null;
  }

  private async event(
    c: PoolClient,
    ctx: RequestContext,
    reportId: string,
    what: string,
    note?: string | null,
  ) {
    await c.query(
      `INSERT INTO acr_events (school_id, report_id, what, note, by_user, by_name)
       VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4)`,
      [reportId, what, note ?? null, ctx.user.displayName],
    );
  }

  /** An ACR seen past its days to object without an objection is final. */
  private async sweep(c: PoolClient) {
    await c.query(
      `UPDATE acr_reports SET status = 'closed', closed_at = now(), updated_at = now()
        WHERE status = 'disclosed' AND object_by < CURRENT_DATE`,
    );
  }

  private async load(c: PoolClient, id: string): Promise<ReportRow> {
    // eslint-disable-next-line no-restricted-syntax -- a fixed fragment, the id is bound
    const r = await c.query<ReportRow>(`${REPORT} WHERE r.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'ACR not found', { status: 404 });
    return r.rows[0];
  }

  /** The active questions of a form (0191), in section and question order; nothing for no form. */
  private async formQuestions(c: PoolClient, formId: string | null): Promise<Question[]> {
    if (!formId) return [];
    const r = await c.query<{
      id: string;
      section: string;
      section_id: string | null;
      section_weight: string | null;
      section_help: string | null;
      text: string;
      kind: 'scale' | 'text' | 'yesno';
      weight: string;
      required: boolean;
    }>(
      `SELECT q.id::text, COALESCE(s.title, q.section) AS section, q.section_id::text, s.weight::text AS section_weight,
              s.help AS section_help, q.text, q.kind, q.weight::text, q.required
         FROM acr_questions q LEFT JOIN acr_form_sections s ON s.id = q.section_id
        WHERE q.form_id = $1 AND q.active
        ORDER BY s.sort_order NULLS LAST, q.sort_order, q.id`,
      [formId],
    );
    return r.rows.map((q) => ({
      id: q.id,
      section: q.section,
      sectionId: q.section_id,
      sectionWeight: q.section_weight ? Number(q.section_weight) : 1,
      sectionHelp: q.section_help,
      text: q.text,
      kind: q.kind,
      weight: Number(q.weight),
      required: q.required,
    }));
  }

  /** The self-appraisal form of a staff group: its own first, else one for both. */
  private async selfFormId(c: PoolClient, group: Group): Promise<string | null> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM acr_forms WHERE part = 'self' AND active AND staff_group IN ($1, 'both')
        ORDER BY (staff_group = $1) DESC, sort_order, id LIMIT 1`,
      [group],
    );
    return r.rows[0]?.id ?? null;
  }

  /** A form as the sheet shows it: its sections with help and weight, each with its questions. */
  private async formView(c: PoolClient, formId: string | null): Promise<FormView | null> {
    if (!formId) return null;
    const f = await c.query<{ id: string; name: string }>(
      'SELECT id::text, name FROM acr_forms WHERE id = $1',
      [formId],
    );
    if (!f.rows[0]) return null;
    const qs = await this.formQuestions(c, formId);
    const sections: FormView['sections'] = [];
    for (const q of qs) {
      const key = q.sectionId ?? q.section;
      let sec = sections.find((x) => x.id === key);
      if (!sec) {
        sec = {
          id: key,
          title: q.section,
          help: q.sectionHelp,
          weight: q.sectionWeight,
          questions: [],
        };
        sections.push(sec);
      }
      sec.questions.push({
        id: q.id,
        text: q.text,
        kind: q.kind,
        weight: q.weight,
        required: q.required,
      });
    }
    return { id: f.rows[0].id, name: f.rows[0].name, sections };
  }

  private async scale(
    c: PoolClient,
  ): Promise<{ labels: string[]; top: number; lateAfter: string; days: number }> {
    await this.setup.seed(c);
    const r = await c.query<{
      scale_labels: string[];
      staff_late_after: string;
      representation_days: number;
    }>('SELECT scale_labels, staff_late_after::text, representation_days FROM acr_settings');
    const s = r.rows[0]!;
    return {
      labels: s.scale_labels,
      top: s.scale_labels.length,
      lateAfter: s.staff_late_after,
      days: s.representation_days,
    };
  }

  private async bands(c: PoolClient): Promise<Band[]> {
    const r = await c.query<Band & { min_pct: string }>(
      'SELECT min_pct::text, label, adverse FROM acr_grade_bands ORDER BY min_pct DESC',
    );
    return r.rows.map((b) => ({ ...b, min_pct: Number(b.min_pct) }));
  }
  private gradeOf(bands: Band[], score: number): Band | null {
    return bands.find((b) => score >= b.min_pct) ?? bands[bands.length - 1] ?? null;
  }

  /** Checks a form's answers: every required question answered, ratings within the scale. */
  private check(
    qs: Question[],
    answers: Record<string, Answer>,
    top: number,
    strict: boolean,
  ): string[] {
    const errors: string[] = [];
    for (const q of qs) {
      const a = answers[q.id];
      const empty = a === undefined || a === null || (typeof a === 'string' && a.trim() === '');
      if (empty) {
        if (strict && q.required) errors.push(`Answer “${q.text}”`);
        continue;
      }
      if (q.kind === 'scale' && (typeof a !== 'number' || a < 1 || a > top))
        errors.push(`“${q.text}”: a rating from 1 to ${String(top)}`);
      if (q.kind === 'text' && typeof a !== 'string') errors.push(`“${q.text}”: a written answer`);
      if (q.kind === 'yesno' && a !== 'yes' && a !== 'no') errors.push(`“${q.text}”: yes or no`);
    }
    return errors;
  }
  /**
   * Weighted ratings as % of the top of the scale, by section (written and yes / no answers do not
   * count); the form's score weighs the sections that have ratings (0191).
   */
  private scoreOf(
    qs: Question[],
    answers: Record<string, Answer>,
    top: number,
  ): { pct: number | null; sections: SectionScore[] } {
    const sections: Array<{ id: string; title: string; weight: number; got: number; max: number }> =
      [];
    for (const q of qs) {
      const key = q.sectionId ?? q.section;
      let sec = sections.find((x) => x.id === key);
      if (!sec) {
        sec = { id: key, title: q.section, weight: q.sectionWeight, got: 0, max: 0 };
        sections.push(sec);
      }
      const a = answers[q.id];
      if (q.kind !== 'scale' || typeof a !== 'number') continue;
      sec.got += a * q.weight;
      sec.max += top * q.weight;
    }
    const out: SectionScore[] = sections.map((x) => ({
      id: x.id,
      title: x.title,
      weight: x.weight,
      pct: x.max ? pct((x.got / x.max) * 100) : null,
    }));
    const scored = out.filter((x) => x.pct !== null);
    const w = scored.reduce((n, x) => n + x.weight, 0);
    return {
      pct: w ? pct(scored.reduce((n, x) => n + x.weight * (x.pct ?? 0), 0) / w) : null,
      sections: out,
    };
  }
  private score(qs: Question[], answers: Record<string, Answer>, top: number): number | null {
    return this.scoreOf(qs, answers, top).pct;
  }
  /** Only the answers to these questions are kept. */
  private only(qs: Question[], answers: Record<string, Answer>) {
    const ids = new Set(qs.map((q) => q.id));
    return Object.fromEntries(Object.entries(answers).filter(([k]) => ids.has(k)));
  }

  /** The people of a level for one employee (never the employee). */
  private async resolve(
    c: PoolClient,
    level: {
      kind: string;
      role_code: string | null;
      designation: string | null;
      employee_id: string | null;
    },
    employee: { id: string; profile: Record<string, unknown> },
  ): Promise<string[]> {
    let ids: string[] = [];
    const byDesignation = async (designation: string) =>
      (
        await c.query<{ id: string }>(
          `SELECT id::text FROM employees WHERE deleted_at IS NULL AND status = 'active'
              AND lower(designation) = lower($1)`,
          [designation],
        )
      ).rows.map((x) => x.id);
    if (
      ['acr_hod', 'acr_reviewer', 'approver_l1', 'approver_l2', 'approver_l3'].includes(level.kind)
    ) {
      const v = employee.profile[level.kind];
      if (typeof v === 'string' && /^\d{1,18}$/.test(v)) ids = [v];
      if (typeof v === 'number') ids = [String(v)];
      // the reviewer level (0189): the designation on the level when nobody is set on the record
      if (!ids.length && level.kind === 'acr_reviewer' && level.designation)
        ids = await byDesignation(level.designation);
    } else if (level.kind === 'employee' && level.employee_id) ids = [level.employee_id];
    else if (level.kind === 'designation' && level.designation) {
      ids = await byDesignation(level.designation);
    } else if (level.kind === 'role' && level.role_code) {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT e.id::text FROM employees e
           JOIN user_roles ur ON ur.user_id = e.user_id AND ur.school_id = e.school_id AND ur.revoked_at IS NULL
           JOIN roles ro ON ro.id = ur.role_id AND ro.code = $1
          WHERE e.deleted_at IS NULL AND e.status = 'active'`,
        [level.role_code],
      );
      ids = r.rows.map((x) => x.id);
    }
    // only active staff of this school, never the employee
    if (!ids.length) return [];
    const ok = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL AND status = 'active'`,
      [ids],
    );
    return ok.rows.map((x) => x.id).filter((x) => x !== employee.id);
  }

  /**
   * A person on two levels in a row assesses once (0190): a level whose people are exactly those of the
   * level before it (the last one not skipped) is skipped with a note, and comes back when that changes.
   * Done levels stay. When the level the ACR waits on gets skipped, the ACR moves on; with nothing left
   * it is shown to the employee.
   */
  private async applySkips(c: PoolClient, ctx: RequestContext, reportId: string) {
    const rows = (await c.query<ReviewRow>(REVIEWS, [reportId])).rows;
    let prev: { seq: number; label: string; people: string[] } | null = null;
    for (const v of rows) {
      const people = [...v.reviewer_ids].sort();
      if (v.status === 'done') {
        prev = { seq: v.seq, label: v.label, people };
        continue;
      }
      const same =
        prev !== null &&
        people.length > 0 &&
        people.length === prev.people.length &&
        people.every((x, i) => x === prev!.people[i]);
      if (same) {
        if (v.status !== 'skipped')
          await c.query(
            `UPDATE acr_reviews SET status = 'skipped', skipped_note = $2 WHERE id = $1`,
            [v.id, `Same person as level ${String(prev!.seq)} (${prev!.label}); assessed there`],
          );
        continue; // the next level compares with the level before the skipped one
      }
      if (v.status === 'skipped')
        await c.query(
          `UPDATE acr_reviews SET status = 'waiting', skipped_note = NULL WHERE id = $1`,
          [v.id],
        );
      prev = { seq: v.seq, label: v.label, people };
    }
    const r = (
      await c.query<{ status: string; current_level: number | null }>(
        'SELECT status, current_level FROM acr_reports WHERE id = $1',
        [reportId],
      )
    ).rows[0];
    if (r?.status !== 'review' || !r.current_level) return;
    const now = (await c.query<ReviewRow>(REVIEWS, [reportId])).rows;
    const cur = now.find((x) => x.seq === r.current_level);
    if (!cur || cur.status !== 'skipped') return;
    const next = now.find((x) => x.seq > cur.seq && x.status !== 'skipped' && x.status !== 'done');
    if (next) {
      await c.query(`UPDATE acr_reviews SET status = 'pending' WHERE id = $1`, [next.id]);
      await c.query(`UPDATE acr_reports SET current_level = $2, updated_at = now() WHERE id = $1`, [
        reportId,
        next.seq,
      ]);
      return;
    }
    await this.finish(c, ctx, reportId, null);
  }

  /** After the last level: the score of the last rating, the grade of the last level; shown to the employee. */
  private async finish(c: PoolClient, ctx: RequestContext, id: string, grade: string | null) {
    const sc = await this.scale(c);
    const bands = await this.bands(c);
    const final = (await c.query<ReviewRow>(REVIEWS, [id])).rows;
    // the ACR's score: the average of the levels that rated (0191); the last level's grade stands
    const scored = final
      .filter((x) => x.status === 'done' && x.score_pct !== null)
      .map((x) => Number(x.score_pct));
    const finalScore = scored.length
      ? pct(scored.reduce((n, x) => n + x, 0) / scored.length)
      : null;
    const lastGrade =
      [...final].reverse().find((x) => x.status === 'done' && x.grade)?.grade ?? null;
    const finalGrade =
      grade ??
      lastGrade ??
      (finalScore === null ? null : (this.gradeOf(bands, finalScore)?.label ?? null));
    const adverse = bands.find((b) => b.label === finalGrade)?.adverse ?? false;
    await c.query(
      `UPDATE acr_reports SET status = 'disclosed', current_level = NULL, score_pct = $2, grade = $3, adverse = $4,
              disclosed_at = now(), object_by = CURRENT_DATE + $5::int, updated_at = now()
        WHERE id = $1`,
      [id, finalScore, finalGrade, adverse, sc.days],
    );
    await this.event(c, ctx, id, 'disclosed', finalGrade);
    await this.audit.stage(ctx, c, {
      action: 'people.acr.complete',
      entityType: 'acr_reports',
      entityId: id,
      after: { score: finalScore, grade: finalGrade, adverse },
    });
    return { status: 'disclosed' as const, grade: finalGrade };
  }

  // ---- cycles ------------------------------------------------------------------------------------

  /** Opens a cycle: an ACR for every active employee who has none (run again for later joiners). */
  async start(ctx: RequestContext, cycleId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.setup.seed(c);
      const cy = await c.query<{ status: string; academic_year_id: string }>(
        'SELECT status, academic_year_id::text FROM acr_cycles WHERE id = $1',
        [cycleId],
      );
      if (!cy.rows[0]) throw new DomainError('not-found', 'Cycle not found', { status: 404 });
      if (cy.rows[0].status === 'closed')
        throw new DomainError('acr.cycle_closed', 'This cycle is closed', { status: 409 });
      const levels = await c.query<{
        staff_group: Group;
        seq: number;
        label: string;
        kind: string;
        role_code: string | null;
        designation: string | null;
        employee_id: string | null;
        action: 'rate' | 'review';
        form_id: string | null;
      }>(
        `SELECT staff_group, seq, label, kind, role_code, designation, employee_id::text, action, form_id::text
           FROM acr_levels ORDER BY staff_group, seq`,
      );
      const staff = await c.query<{
        id: string;
        profile: Record<string, unknown>;
        side: string;
        teaches: boolean;
      }>(
        `SELECT e.id::text, e.profile, app.employee_staff_side(e.department, e.employee_type) AS side,
                EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.employee_id = e.id AND ta.academic_year_id = $2) AS teaches
           FROM employees e
          WHERE e.deleted_at IS NULL AND e.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM acr_reports r WHERE r.cycle_id = $1 AND r.employee_id = e.id)`,
        [cycleId, cy.rows[0].academic_year_id],
      );
      const unassigned: Array<{ employeeId: string; level: string }> = [];
      for (const e of staff.rows) {
        // contract staff of a department for both: teaching when they have classes this year
        const group: Group =
          e.side === 'teaching' || (e.side === 'both' && e.teaches) ? 'teaching' : 'non_teaching';
        const r = await c.query<{ id: string }>(
          `INSERT INTO acr_reports (school_id, cycle_id, employee_id, staff_group, self_form_id)
           VALUES (app.current_school_id(), $1, $2, $3, $4) RETURNING id::text`,
          [cycleId, e.id, group, await this.selfFormId(c, group)],
        );
        const rid = r.rows[0]!.id;
        for (const l of levels.rows.filter((x) => x.staff_group === group)) {
          const people = await this.resolve(c, l, e);
          if (!people.length) unassigned.push({ employeeId: e.id, level: l.label });
          await c.query(
            `INSERT INTO acr_reviews (school_id, report_id, seq, label, action, reviewer_ids, form_id)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::bigint[], $6)`,
            [rid, l.seq, l.label, l.action, people, l.form_id],
          );
        }
        await this.applySkips(c, ctx, rid);
        await this.event(c, ctx, rid, 'started');
      }
      await c.query(`UPDATE acr_cycles SET status = 'open' WHERE id = $1`, [cycleId]);
      await this.audit.stage(ctx, c, {
        action: 'people.acr.cycle.start',
        entityType: 'acr_cycles',
        entityId: cycleId,
        after: { added: staff.rows.length, unassigned: unassigned.length },
      });
      return { added: staff.rows.length, unassigned };
    });
  }

  /**
   * Reads the assessors again for an open cycle (0189): levels not yet done take the people the set-up
   * and the records give now. A level the office filled by hand keeps them when the record gives nobody.
   */
  async reresolve(ctx: RequestContext, cycleId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cy = await c.query<{ status: string }>('SELECT status FROM acr_cycles WHERE id = $1', [
        cycleId,
      ]);
      if (!cy.rows[0]) throw new DomainError('not-found', 'Cycle not found', { status: 404 });
      if (cy.rows[0].status !== 'open')
        throw new DomainError('acr.cycle_not_open', 'Only an open cycle is re-read', {
          status: 409,
        });
      const levels = await c.query<{
        staff_group: Group;
        seq: number;
        label: string;
        kind: string;
        role_code: string | null;
        designation: string | null;
        employee_id: string | null;
        action: 'rate' | 'review';
        form_id: string | null;
      }>(
        `SELECT staff_group, seq, label, kind, role_code, designation, employee_id::text, action, form_id::text FROM acr_levels ORDER BY staff_group, seq`,
      );
      const reports = await c.query<{
        id: string;
        employee_id: string;
        staff_group: Group;
        status: string;
        profile: Record<string, unknown>;
      }>(
        `SELECT r.id::text, r.employee_id::text, r.staff_group, r.status, e.profile
           FROM acr_reports r JOIN employees e ON e.id = r.employee_id
          WHERE r.cycle_id = $1 AND r.status IN ('self', 'review')`,
        [cycleId],
      );
      let changed = 0;
      const unassigned: Array<{ employeeId: string; level: string }> = [];
      for (const rep of reports.rows) {
        const chain = levels.rows.filter((x) => x.staff_group === rep.staff_group);
        if (rep.status === 'self') {
          // nothing filled yet: the chain itself follows the set-up (levels added or removed since the start)
          const have = (await c.query<ReviewRow>(REVIEWS, [rep.id])).rows;
          const sameShape =
            have.length === chain.length &&
            have.every(
              (v, i) =>
                v.label === chain[i]!.label &&
                v.action === chain[i]!.action &&
                (v.form_id ?? null) === (chain[i]!.form_id ?? null),
            );
          if (!sameShape) {
            await c.query('DELETE FROM acr_reviews WHERE report_id = $1', [rep.id]);
            for (const l of chain) {
              const people = await this.resolve(c, l, {
                id: rep.employee_id,
                profile: rep.profile,
              });
              await c.query(
                `INSERT INTO acr_reviews (school_id, report_id, seq, label, action, reviewer_ids, form_id)
                 VALUES (app.current_school_id(), $1, $2, $3, $4, $5::bigint[], $6)`,
                [rep.id, l.seq, l.label, l.action, people, l.form_id],
              );
              await c.query(`UPDATE acr_reports SET self_form_id = $2 WHERE id = $1`, [
                rep.id,
                await this.selfFormId(c, rep.staff_group),
              ]);
              if (!people.length) unassigned.push({ employeeId: rep.employee_id, level: l.label });
            }
            changed += chain.length;
            await this.applySkips(c, ctx, rep.id);
            continue;
          }
        }
        for (const l of chain) {
          const people = await this.resolve(c, l, { id: rep.employee_id, profile: rep.profile });
          if (!people.length) {
            const now = await c.query<{ n: number }>(
              `SELECT cardinality(reviewer_ids) AS n FROM acr_reviews WHERE report_id = $1 AND seq = $2`,
              [rep.id, l.seq],
            );
            if (!(now.rows[0]?.n ?? 0))
              unassigned.push({ employeeId: rep.employee_id, level: l.label });
            continue;
          }
          const upd = await c.query(
            `UPDATE acr_reviews SET reviewer_ids = $3::bigint[]
              WHERE report_id = $1 AND seq = $2 AND status <> 'done' AND reviewer_ids IS DISTINCT FROM $3::bigint[]`,
            [rep.id, l.seq, people],
          );
          changed += upd.rowCount ?? 0;
        }
        await this.applySkips(c, ctx, rep.id);
      }
      await this.audit.stage(ctx, c, {
        action: 'people.acr.cycle.reresolve',
        entityType: 'acr_cycles',
        entityId: cycleId,
        after: { changed, unassigned: unassigned.length },
      });
      return { changed, unassigned };
    });
  }

  async closeCycle(ctx: RequestContext, cycleId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE acr_cycles SET status = 'closed' WHERE id = $1 AND status = 'open'`,
        [cycleId],
      );
      if (!r.rowCount)
        throw new DomainError('acr.cycle_not_open', 'Only an open cycle is closed', {
          status: 409,
        });
      await this.audit.stage(ctx, c, {
        action: 'people.acr.cycle.close',
        entityType: 'acr_cycles',
        entityId: cycleId,
      });
      return { ok: true };
    });
  }

  // ---- lists -------------------------------------------------------------------------------------

  private async rows(c: PoolClient, where: string, args: unknown[]) {
    const r = await c.query<{
      id: string;
      cycle_id: string;
      cycle: string;
      employee_id: string;
      name: string;
      code: string;
      department: string | null;
      designation: string | null;
      staff_group: Group;
      status: string;
      current_level: number | null;
      level_label: string | null;
      waiting_on: string[] | null;
      self_pct: string | null;
      score_pct: string | null;
      grade: string | null;
      adverse: boolean;
      object_by: string | null;
      updated_at: Date;
    }>(
      // eslint-disable-next-line no-restricted-syntax -- the condition is one of the fixed ones below; values are bound
      `SELECT r.id::text, r.cycle_id::text, cy.name AS cycle, r.employee_id::text, e.display_name AS name,
              e.employee_code AS code, e.department, e.designation, r.staff_group, r.status, r.current_level,
              v.label AS level_label,
              (SELECT array_agg(x.display_name ORDER BY x.display_name) FROM employees x WHERE x.id = ANY(v.reviewer_ids)) AS waiting_on,
              r.self_pct::text, r.score_pct::text, r.grade, r.adverse, r.object_by::text, r.updated_at
         FROM acr_reports r
         JOIN acr_cycles cy ON cy.id = r.cycle_id
         JOIN employees e ON e.id = r.employee_id
         LEFT JOIN acr_reviews v ON v.report_id = r.id AND v.seq = r.current_level
        WHERE ${where}
        ORDER BY e.display_name, cy.id`,
      args,
    );
    return r.rows.map((x) => ({
      id: x.id,
      cycleId: x.cycle_id,
      cycle: x.cycle,
      employee: {
        id: x.employee_id,
        name: x.name,
        code: x.code,
        department: x.department,
        designation: x.designation,
      },
      staffGroup: x.staff_group,
      status: x.status,
      level: x.current_level
        ? { seq: x.current_level, label: x.level_label, waitingOn: x.waiting_on ?? [] }
        : null,
      selfPct: x.self_pct === null ? null : Number(x.self_pct),
      scorePct: x.score_pct === null ? null : Number(x.score_pct),
      grade: x.grade,
      adverse: x.adverse,
      objectBy: x.object_by,
      updatedAt: x.updated_at.toISOString(),
    }));
  }

  /** The progress board of a cycle (the latest when none is named). */
  async board(ctx: RequestContext, cycleId?: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sweep(c);
      const cy = cycleId
        ? await c.query<{ id: string }>('SELECT id::text FROM acr_cycles WHERE id = $1', [cycleId])
        : await c.query<{ id: string }>(
            `SELECT cy.id::text FROM acr_cycles cy JOIN academic_years y ON y.id = cy.academic_year_id
              ORDER BY y.start_date DESC LIMIT 1`,
          );
      const id = cy.rows[0]?.id;
      if (!id) return { cycleId: null, rows: [], counts: {} };
      const rows = await this.rows(c, 'r.cycle_id = $1', [id]);
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return { cycleId: id, rows, counts };
    });
  }

  /** One employee's ACRs, newest cycle first (the employee page). */
  async ofEmployee(ctx: RequestContext, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sweep(c);
      const rows = await this.rows(c, 'r.employee_id = $1', [employeeId]);
      return { data: rows.reverse() };
    });
  }

  /** My ACRs (the open cycle's, and earlier ones once shown to me). */
  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sweep(c);
      const me = await this.myEmployee(c);
      if (!me) return { data: [] };
      return {
        data: await this.rows(
          c,
          `r.employee_id = $1 AND (cy.status = 'open' OR r.status <> 'self')`,
          [me],
        ),
      };
    });
  }

  /** ACRs waiting on me at a level, and those I have filled. */
  async toAssess(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const me = await this.myEmployee(c);
      if (!me) return { waiting: [], done: [] };
      const waiting = await this.rows(
        c,
        `r.status = 'review' AND v.status = 'pending' AND $1::bigint = ANY(v.reviewer_ids)`,
        [me],
      );
      const done = await this.rows(
        c,
        `cy.status = 'open' AND EXISTS (SELECT 1 FROM acr_reviews d WHERE d.report_id = r.id AND d.status = 'done' AND $1::bigint = ANY(d.reviewer_ids))`,
        [me],
      );
      return { waiting, done };
    });
  }

  // ---- one ACR -----------------------------------------------------------------------------------

  /** Who may see an ACR and what: the school's ACR people all; the employee their own (the levels once
   * shown to them); the people of a level everything up to their level. */
  private async access(c: PoolClient, ctx: RequestContext, r: ReportRow, reviews: ReviewRow[]) {
    const me = await this.myEmployee(c);
    const self = me === r.employee_id;
    const myLevels = reviews.filter((v) => me && v.reviewer_ids.includes(me)).map((v) => v.seq);
    const upTo = myLevels.length ? Math.max(...myLevels) : 0;
    if (!this.viewer(ctx) && !self && !upTo)
      throw new DomainError('not-found', 'ACR not found', { status: 404 });
    return { me, self, upTo, manager: this.manager(ctx), viewer: this.viewer(ctx) };
  }

  async view(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.sweep(c);
      const r = await this.load(c, id);
      const reviews = (await c.query<ReviewRow>(REVIEWS, [id])).rows;
      const a = await this.access(c, ctx, r, reviews);
      const [selfForm, sc, bands, emp, events] = await Promise.all([
        this.formView(c, await this.selfFormOf(c, r)),
        this.scale(c),
        this.bands(c),
        c.query<{
          name: string;
          code: string;
          designation: string | null;
          department: string | null;
          joined_on: string | null;
        }>(
          `SELECT display_name AS name, employee_code AS code, designation, department, joined_on::text
             FROM employees WHERE id = $1`,
          [r.employee_id],
        ),
        c.query<{ at: Date; what: string; note: string | null; by_name: string | null }>(
          'SELECT at, what, note, by_name FROM acr_events WHERE report_id = $1 ORDER BY at',
          [id],
        ),
      ]);
      const shown = r.status === 'disclosed' || r.status === 'represented' || r.status === 'closed';
      // the employee sees the levels once the ACR is shown to them; a level's people up to their level
      const seeLevel = (seq: number) => a.viewer || (a.self ? shown : seq <= a.upTo);
      const names = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name AS name FROM employees WHERE id = ANY($1::bigint[])`,
        [reviews.flatMap((v) => v.reviewer_ids)],
      );
      const nameOf = new Map(names.rows.map((x) => [x.id, x.name]));
      const today = new Date().toISOString().slice(0, 10);
      const windowOpen = r.cycle_status === 'open' && today >= r.self_from && today <= r.self_to;
      const returned = await this.wasReturned(c, id);
      const pending = reviews.find((v) => v.seq === r.current_level && v.status === 'pending');
      const forms: Record<string, FormView> = {};
      if (selfForm) forms[selfForm.id] = selfForm;
      const levelSections = new Map<number, SectionScore[]>();
      for (const v of reviews) {
        if (!v.form_id || !seeLevel(v.seq)) continue;
        if (!forms[v.form_id]) {
          const fv = await this.formView(c, v.form_id);
          if (fv) forms[v.form_id] = fv;
        }
        if (v.status === 'done')
          levelSections.set(
            v.seq,
            this.scoreOf(await this.formQuestions(c, v.form_id), v.answers, sc.top).sections,
          );
      }
      return {
        id: r.id,
        employee: { id: r.employee_id, ...emp.rows[0]! },
        staffGroup: r.staff_group,
        status: r.status,
        currentLevel: r.current_level,
        cycle: { id: r.cycle_id, status: r.cycle_status, selfFrom: r.self_from, selfTo: r.self_to },
        scale: sc.labels,
        bands: bands.map((b) => ({ minPct: b.min_pct, label: b.label, adverse: b.adverse })),
        // 0191: the forms this ACR was made with; a level's once its people (or the employee, once shown) may see it
        forms,
        self: {
          formId: selfForm?.id ?? null,
          sections: selfForm
            ? this.scoreOf(await this.formQuestions(c, selfForm.id), r.self_answers, sc.top)
                .sections
            : [],
          answers: r.self_answers,
          pct: r.self_pct === null ? null : Number(r.self_pct),
          submittedAt: r.self_submitted_at?.toISOString() ?? null,
          // shown live while being filled, kept as they were at submission
          facts:
            r.auto_facts ?? (r.status === 'self' ? await this.facts(c, r, sc.lateAfter) : null),
          office: r.office_facts,
        },
        levels: reviews.map((v) =>
          seeLevel(v.seq)
            ? {
                seq: v.seq,
                label: v.label,
                action: v.action,
                status: v.status,
                people: v.reviewer_ids.map((x) => ({ id: x, name: nameOf.get(x) ?? '' })),
                formId: v.form_id,
                sections: levelSections.get(v.seq) ?? [],
                answers: v.answers,
                remarks: v.remarks,
                scorePct: v.score_pct === null ? null : Number(v.score_pct),
                grade: v.grade,
                gradeReason: v.grade_reason,
                agreement: v.agreement,
                filledBy: v.filled_by_name,
                filledAt: v.filled_at?.toISOString() ?? null,
                skippedNote: v.skipped_note,
              }
            : {
                seq: v.seq,
                label: v.label,
                action: v.action,
                status: v.status,
                hidden: true,
                skippedNote: v.skipped_note,
                formId: v.form_id,
              },
        ),
        result:
          shown || a.viewer
            ? {
                scorePct: r.score_pct === null ? null : Number(r.score_pct),
                grade: r.grade,
                adverse: r.adverse,
                disclosedAt: r.disclosed_at?.toISOString() ?? null,
                objectBy: r.object_by,
                acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
                representation: r.representation,
                representedAt: r.represented_at?.toISOString() ?? null,
                decision: r.decision,
                decisionNote: r.decision_note,
                decidedAt: r.decided_at?.toISOString() ?? null,
              }
            : null,
        events:
          a.viewer || a.upTo ? events.rows.map((e) => ({ ...e, at: e.at.toISOString() })) : [],
        can: {
          self: a.self && r.status === 'self' && (windowOpen || returned),
          level:
            pending && a.me && pending.reviewer_ids.includes(a.me)
              ? { seq: pending.seq, action: pending.action }
              : null,
          sendBack: Boolean(pending && a.me && pending.reviewer_ids.includes(a.me)),
          acknowledge: a.self && r.status === 'disclosed',
          represent:
            a.self &&
            r.status === 'disclosed' &&
            r.adverse &&
            !!r.object_by &&
            today <= r.object_by,
          decide: a.manager && r.status === 'represented',
          manage: a.manager && r.status !== 'closed',
        },
      };
    });
  }

  private async wasReturned(c: PoolClient, id: string) {
    const r = await c.query<{ x: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM acr_events WHERE report_id = $1 AND what = 'returned_to_employee') AS x`,
      [id],
    );
    return r.rows[0]!.x;
  }

  /**
   * What the school's records say for the year: days present and late arrivals (staff punches), the
   * results of the sections taught (latest exam with results), the profile (education, experience,
   * documents), the daily activity log.
   */
  private async facts(c: PoolClient, r: ReportRow, lateAfter: string) {
    const [year, punch, results, profile, log] = await Promise.all([
      c.query<{ start_date: string; end_date: string }>(
        'SELECT start_date::text, end_date::text FROM academic_years WHERE id = $1',
        [r.academic_year_id],
      ),
      c.query<{ days: number; late: number }>(
        `WITH d AS (
           SELECT (punched_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
                  min((punched_at AT TIME ZONE 'Asia/Kolkata')::time) AS first_in
             FROM punch_logs p JOIN academic_years y ON y.id = $2
            WHERE p.employee_id = $1 AND p.outcome = 'recorded'
              AND (punched_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN y.start_date AND y.end_date
            GROUP BY 1)
         SELECT count(*)::int AS days, count(*) FILTER (WHERE first_in > $3::time)::int AS late FROM d`,
        [r.employee_id, r.academic_year_id, lateAfter],
      ),
      c.query<{
        section: string;
        subjects: string | null;
        exam: string;
        students: number;
        avg: string;
        pass: string;
        distinction: number;
      }>(
        `WITH mine AS (
           SELECT ta.class_section_id, string_agg(DISTINCT s.name, ', ') AS subjects
             FROM teacher_assignments ta LEFT JOIN subjects s ON s.id = ta.subject_id
            WHERE ta.employee_id = $1 AND ta.academic_year_id = $2 GROUP BY ta.class_section_id),
         latest AS (
           SELECT DISTINCT ON (er.class_section_id) er.class_section_id, er.exam_id
             FROM exam_results er JOIN exams x ON x.id = er.exam_id AND x.academic_year_id = $2
            WHERE er.class_section_id IN (SELECT class_section_id FROM mine)
            ORDER BY er.class_section_id, x.ends_on DESC NULLS LAST, x.id DESC)
         SELECT k.code || '-' || cs.name AS section, m.subjects, x.name AS exam, count(*)::int AS students,
                round(avg(er.pct), 1)::text AS avg,
                round(100.0 * count(*) FILTER (WHERE er.pct >= 33) / NULLIF(count(*), 0), 1)::text AS pass,
                count(*) FILTER (WHERE er.pct >= 75)::int AS distinction
           FROM latest l
           JOIN mine m ON m.class_section_id = l.class_section_id
           JOIN exam_results er ON er.exam_id = l.exam_id AND er.class_section_id = l.class_section_id
           JOIN exams x ON x.id = l.exam_id
           JOIN class_sections cs ON cs.id = l.class_section_id JOIN classes k ON k.id = cs.class_id
          GROUP BY k.code, k.display_order, cs.name, m.subjects, x.name
          ORDER BY k.display_order, cs.name`,
        [r.employee_id, r.academic_year_id],
      ),
      c.query<{ education: string[] | null; experience: number; missing: number; on_file: number }>(
        `SELECT (SELECT array_agg(concat_ws(', ', qualification, institution, passing_year::text) ORDER BY passing_year DESC NULLS LAST)
                   FROM employee_education WHERE employee_id = $1) AS education,
                (SELECT count(*)::int FROM employee_experience WHERE employee_id = $1) AS experience,
                (SELECT count(*)::int FROM app.employee_documents_due($1) d WHERE d.required AND d.valid = 0) AS missing,
                (SELECT count(*)::int FROM employee_documents WHERE employee_id = $1) AS on_file`,
        [r.employee_id],
      ),
      c.query<{ submitted: number; late: number; returned: number }>(
        `SELECT count(*) FILTER (WHERE state IN ('submitted', 'reviewed'))::int AS submitted,
                count(*) FILTER (WHERE late)::int AS late,
                count(*) FILTER (WHERE state = 'returned')::int AS returned
           FROM activity_logs l JOIN academic_years y ON y.id = $2
          WHERE l.employee_id = $1 AND l.on_date BETWEEN y.start_date AND y.end_date`,
        [r.employee_id, r.academic_year_id],
      ),
    ]);
    const p = punch.rows[0]!;
    const pr = profile.rows[0]!;
    const lg = log.rows[0]!;
    return {
      period: { from: year.rows[0]?.start_date ?? null, to: year.rows[0]?.end_date ?? null },
      attendance: p.days
        ? { daysPresent: p.days, lateArrivals: p.late, lateAfter: lateAfter.slice(0, 5) }
        : null,
      results: results.rows.map((x) => ({
        section: x.section,
        subjects: x.subjects,
        exam: x.exam,
        students: x.students,
        averagePct: Number(x.avg),
        passPct: Number(x.pass),
        distinctions: x.distinction,
      })),
      profile: {
        education: pr.education ?? [],
        experienceRows: pr.experience,
        documentsOnFile: pr.on_file,
        requiredDocumentsMissing: pr.missing,
      },
      activityLog:
        lg.submitted || lg.late || lg.returned
          ? { daysSubmitted: lg.submitted, late: lg.late, returned: lg.returned }
          : null,
    };
  }

  // ---- the employee ------------------------------------------------------------------------------

  private async selfReport(c: PoolClient, id: string) {
    const r = await this.load(c, id);
    const me = await this.myEmployee(c);
    if (me !== r.employee_id) throw new DomainError('not-found', 'ACR not found', { status: 404 });
    if (r.status !== 'self')
      throw new DomainError('acr.self_done', 'The self-appraisal is already submitted', {
        status: 409,
      });
    const today = new Date().toISOString().slice(0, 10);
    const open = r.cycle_status === 'open' && today >= r.self_from && today <= r.self_to;
    if (!open && !(await this.wasReturned(c, id)))
      throw new DomainError(
        'acr.window_closed',
        today < r.self_from
          ? 'The self-appraisal has not opened yet'
          : 'The self-appraisal window is over',
        { status: 409 },
      );
    return r;
  }

  /** The self form an ACR was made with; one made before forms existed takes its group's form now. */
  private async selfFormOf(c: PoolClient, r: ReportRow): Promise<string | null> {
    if (r.self_form_id) return r.self_form_id;
    const id = await this.selfFormId(c, r.staff_group);
    if (id) await c.query('UPDATE acr_reports SET self_form_id = $2 WHERE id = $1', [r.id, id]);
    return id;
  }

  async saveSelf(ctx: RequestContext, id: string, dto: AcrSelfDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.selfReport(c, id);
      const qs = await this.formQuestions(c, await this.selfFormOf(c, r));
      const { top } = await this.scale(c);
      const answers = this.only(qs, { ...r.self_answers, ...dto.answers });
      const errors = this.check(qs, answers, top, false);
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('; '), { status: 400 });
      await c.query(
        `UPDATE acr_reports SET self_answers = $2::jsonb, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(answers)],
      );
      return { saved: true };
    });
  }

  async submitSelf(ctx: RequestContext, id: string, dto: AcrSelfDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.selfReport(c, id);
      const qs = await this.formQuestions(c, await this.selfFormOf(c, r));
      const sc = await this.scale(c);
      const answers = this.only(qs, { ...r.self_answers, ...dto.answers });
      const errors = this.check(qs, answers, sc.top, true);
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('; '), { status: 400 });
      const facts = await this.facts(c, r, sc.lateAfter);
      // the first level that is not skipped (a person on two levels in a row assesses once, 0190)
      const first =
        (await c.query<ReviewRow>(REVIEWS, [id])).rows.find((x) => x.status !== 'skipped') ?? null;
      await c.query(
        `UPDATE acr_reports SET self_answers = $2::jsonb, self_pct = $3, auto_facts = $4::jsonb,
                self_submitted_at = now(), status = 'review', current_level = $5, updated_at = now()
          WHERE id = $1`,
        [
          id,
          JSON.stringify(answers),
          this.score(qs, answers, sc.top),
          JSON.stringify(facts),
          first?.seq ?? 1,
        ],
      );
      await c.query(`UPDATE acr_reviews SET status = 'pending' WHERE report_id = $1 AND seq = $2`, [
        id,
        first?.seq ?? 1,
      ]);
      await this.event(c, ctx, id, 'self_submitted');
      await this.audit.stage(ctx, c, {
        action: 'people.acr.self_submit',
        entityType: 'acr_reports',
        entityId: id,
      });
      return { status: 'review' };
    });
  }

  // ---- the levels --------------------------------------------------------------------------------

  private async myLevel(c: PoolClient, id: string, seq: number) {
    const r = await this.load(c, id);
    const v = (await c.query<ReviewRow>(REVIEW_ONE, [id, seq])).rows[0];
    const me = await this.myEmployee(c);
    if (!v || !me || !v.reviewer_ids.includes(me))
      throw new DomainError('not-found', 'ACR not found', { status: 404 });
    if (r.status !== 'review' || r.current_level !== seq || v.status !== 'pending')
      throw new DomainError('acr.not_your_turn', 'This level is not waiting on you now', {
        status: 409,
      });
    return { r, v };
  }

  async saveLevel(ctx: RequestContext, id: string, seq: number, dto: AcrLevelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { v } = await this.myLevel(c, id, seq);
      const qs = await this.formQuestions(c, v.form_id);
      const { top } = await this.scale(c);
      const answers = this.only(qs, { ...v.answers, ...dto.answers });
      const errors = this.check(qs, answers, top, false);
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('; '), { status: 400 });
      await c.query(
        `UPDATE acr_reviews SET answers = $2::jsonb, remarks = $3, grade = $4, grade_reason = $5, agreement = $6
          WHERE id = $1`,
        [
          v.id,
          JSON.stringify(answers),
          dto.remarks ?? v.remarks,
          dto.grade ?? v.grade,
          dto.gradeReason ?? v.grade_reason,
          dto.agreement ?? v.agreement,
        ],
      );
      return { saved: true };
    });
  }

  async submitLevel(ctx: RequestContext, id: string, seq: number, dto: AcrLevelDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const { v } = await this.myLevel(c, id, seq);
      const qs = await this.formQuestions(c, v.form_id);
      const sc = await this.scale(c);
      const bands = await this.bands(c);
      const all = (await c.query<ReviewRow>(REVIEWS, [id])).rows;
      const remarks = (dto.remarks ?? v.remarks ?? '').trim();
      let score: number | null = null;
      let grade: string | null = null;
      let reason: string | null = null;
      let agreement: string | null = null;
      // every level answers its own questionnaire (0191); its ratings give the level's score
      const answers = this.only(qs, { ...v.answers, ...dto.answers });
      const errors = this.check(qs, answers, sc.top, true);
      if (errors.length)
        throw new DomainError('validation-failed', errors.join('; '), { status: 400 });
      score = this.score(qs, answers, sc.top);
      if (v.action === 'rate') {
        grade = score === null ? null : (this.gradeOf(bands, score)?.label ?? null);
      } else {
        // the grade the scores so far give (the average of the levels that rated, this one included);
        // the reviewer keeps it or gives another with a reason
        const scored = [
          ...all
            .filter((x) => x.seq < seq && x.status === 'done' && x.score_pct !== null)
            .map((x) => Number(x.score_pct)),
          ...(score === null ? [] : [score]),
        ];
        const average = scored.length
          ? pct(scored.reduce((n, x) => n + x, 0) / scored.length)
          : null;
        const lastGrade =
          [...all].reverse().find((x) => x.seq < seq && x.status === 'done' && x.grade)?.grade ??
          (average === null ? null : (this.gradeOf(bands, average)?.label ?? null));
        const given = (dto.grade ?? v.grade ?? lastGrade ?? '').trim();
        if (!bands.some((b) => b.label === given))
          throw new DomainError('validation-failed', 'Choose a grade', { status: 400 });
        grade = given;
        reason = (dto.gradeReason ?? v.grade_reason ?? '').trim() || null;
        if (lastGrade && given !== lastGrade && (!reason || reason.length < 5))
          throw new DomainError(
            'validation-failed',
            `Say why the grade differs from ${lastGrade}`,
            { status: 400 },
          );
        agreement = dto.agreement ?? v.agreement;
        if (!agreement)
          throw new DomainError(
            'validation-failed',
            'Say whether you agree with the level before',
            { status: 400 },
          );
        if (remarks.length < 3)
          throw new DomainError('validation-failed', 'Write your remarks', { status: 400 });
      }
      await c.query(
        `UPDATE acr_reviews SET answers = $2::jsonb, remarks = $3, score_pct = $4, grade = $5, grade_reason = $6,
                agreement = $7, status = 'done', filled_by = app.current_user_id(), filled_by_name = $8, filled_at = now()
          WHERE id = $1`,
        [
          v.id,
          JSON.stringify(answers),
          remarks || null,
          score,
          grade,
          reason,
          agreement,
          ctx.user.displayName,
        ],
      );
      await this.event(c, ctx, id, 'level_done', v.label);
      const next = all.find((x) => x.seq > seq && x.status !== 'skipped');
      if (next) {
        await c.query(`UPDATE acr_reviews SET status = 'pending' WHERE id = $1`, [next.id]);
        await c.query(
          `UPDATE acr_reports SET current_level = $2, updated_at = now() WHERE id = $1`,
          [id, next.seq],
        );
        return { status: 'review', next: next.label };
      }
      // the last level: the score of the last rating, the grade of the last level; shown to the employee
      return this.finish(c, ctx, id, grade);
    });
  }

  /** The person at the current level sends it back one step (to the employee from the first level). */
  async sendBack(ctx: RequestContext, id: string, dto: AcrReasonDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.status !== 'review' || !r.current_level)
        throw new DomainError('acr.not_in_review', 'Only an ACR at a level is sent back', {
          status: 409,
        });
      const { v } = await this.myLevel(c, id, r.current_level);
      await c.query(`UPDATE acr_reviews SET status = 'waiting' WHERE id = $1`, [v.id]);
      const before = [...(await c.query<ReviewRow>(REVIEWS, [id])).rows]
        .reverse()
        .find((x) => x.seq < r.current_level! && x.status !== 'skipped');
      if (!before) {
        await c.query(
          `UPDATE acr_reports SET status = 'self', current_level = NULL, self_submitted_at = NULL, auto_facts = NULL,
                  updated_at = now() WHERE id = $1`,
          [id],
        );
        await this.event(c, ctx, id, 'returned_to_employee', dto.reason);
        return { status: 'self' };
      }
      const prev = before.seq;
      await c.query(`UPDATE acr_reviews SET status = 'pending' WHERE report_id = $1 AND seq = $2`, [
        id,
        prev,
      ]);
      await c.query(`UPDATE acr_reports SET current_level = $2, updated_at = now() WHERE id = $1`, [
        id,
        prev,
      ]);
      await this.event(c, ctx, id, 'returned', dto.reason);
      return { status: 'review', level: prev };
    });
  }

  /** The school's ACR people put other people on a level (when the record gave none, or someone left). */
  async setReviewers(ctx: RequestContext, id: string, seq: number, dto: AcrReviewersDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (dto.employeeIds.includes(r.employee_id))
        throw new DomainError('acr.self_reviewer', 'An employee does not assess their own ACR', {
          status: 400,
        });
      const u = await c.query(
        `UPDATE acr_reviews SET reviewer_ids = $3::bigint[] WHERE report_id = $1 AND seq = $2 AND status <> 'done'`,
        [id, seq, dto.employeeIds],
      );
      if (!u.rowCount)
        throw new DomainError('acr.level_done', 'That level is already filled', { status: 409 });
      await this.applySkips(c, ctx, id);
      await this.event(c, ctx, id, 'reviewers_changed', `Level ${String(seq)}`);
      return { ok: true };
    });
  }

  /** The office's figures for the year (leave taken). */
  async officeFacts(ctx: RequestContext, id: string, dto: AcrOfficeFactsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.load(c, id);
      await c.query(
        `UPDATE acr_reports SET office_facts = $2::jsonb, updated_at = now() WHERE id = $1`,
        [id, JSON.stringify(dto)],
      );
      return { ok: true };
    });
  }

  // ---- after the levels --------------------------------------------------------------------------

  private async shownToMe(c: PoolClient, id: string) {
    const r = await this.load(c, id);
    if ((await this.myEmployee(c)) !== r.employee_id)
      throw new DomainError('not-found', 'ACR not found', { status: 404 });
    if (r.status !== 'disclosed')
      throw new DomainError('acr.not_disclosed', 'This ACR is not waiting for you', {
        status: 409,
      });
    return r;
  }

  async acknowledge(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.shownToMe(c, id);
      await c.query(
        `UPDATE acr_reports SET acknowledged_at = now(), status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.event(c, ctx, id, 'acknowledged');
      return { status: 'closed' };
    });
  }

  async represent(ctx: RequestContext, id: string, dto: AcrRepresentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.shownToMe(c, id);
      const today = new Date().toISOString().slice(0, 10);
      if (!r.adverse)
        throw new DomainError('acr.not_adverse', 'Only an adverse grade can be objected to', {
          status: 409,
        });
      if (!r.object_by || today > r.object_by)
        throw new DomainError('acr.objection_closed', 'The days to object are over', {
          status: 409,
        });
      await c.query(
        `UPDATE acr_reports SET representation = $2, represented_at = now(), status = 'represented', updated_at = now()
          WHERE id = $1`,
        [id, dto.text],
      );
      await this.event(c, ctx, id, 'represented');
      await this.audit.stage(ctx, c, {
        action: 'people.acr.represent',
        entityType: 'acr_reports',
        entityId: id,
      });
      return { status: 'represented' };
    });
  }

  async decide(ctx: RequestContext, id: string, dto: AcrDecideDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await this.load(c, id);
      if (r.status !== 'represented')
        throw new DomainError('acr.not_represented', 'No objection waits on this ACR', {
          status: 409,
        });
      const bands = await this.bands(c);
      const grade = dto.decision === 'revised' ? dto.grade! : r.grade;
      const band = bands.find((b) => b.label === grade);
      if (!band) throw new DomainError('validation-failed', 'Choose a grade', { status: 400 });
      await c.query(
        `UPDATE acr_reports SET decision = $2, decision_note = $3, grade = $4, adverse = $5, decided_by = app.current_user_id(),
                decided_at = now(), status = 'closed', closed_at = now(), updated_at = now() WHERE id = $1`,
        [id, dto.decision, dto.note, grade, band.adverse],
      );
      await this.event(
        c,
        ctx,
        id,
        dto.decision === 'revised' ? 'grade_revised' : 'grade_upheld',
        dto.note,
      );
      await this.audit.stage(ctx, c, {
        action: 'people.acr.decide',
        entityType: 'acr_reports',
        entityId: id,
        before: { grade: r.grade },
        after: { decision: dto.decision, grade },
      });
      return { status: 'closed', grade };
    });
  }
}
