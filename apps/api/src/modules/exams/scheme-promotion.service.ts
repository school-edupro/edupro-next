import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { EXAMS, type SchemePromotionQueryDto, type SendPromotionsDto } from './exams.dto';

type Decision = 'promote' | 'retain' | 'graduate' | 'review';
interface Scheme {
  id: string;
  name: string;
  term_code: string;
  status: string;
  purpose: string;
  academic_year_id: string;
  exam_ids: string[];
}

/**
 * Promotion proposals from the term results (docs/design/65, part 7). A locked result scheme of the
 * final term proposes for each student: passed, promote to the next class; compartment, held for
 * review (the card says "Class VII, subject to compartment"; promoted after the supplementary
 * result); failed, retain; absent or incomplete, review; the last class, passed out. The coordinator
 * changes what is needed, picks next year's section and sends it: the decisions go to People →
 * Promotions (applied there into next year's enrolments, as before) and the cards' "Promoted to" is
 * filled at the same time.
 */
@Injectable()
export class SchemePromotionService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scopes: ScopePolicy,
  ) {}

  private async scheme(c: PoolClient, id: string): Promise<Scheme> {
    const r = await c.query<Scheme>(
      `SELECT m.id::text, m.name, m.term_code, m.status, m.purpose, m.academic_year_id::text,
              ARRAY(SELECT (x->>'examId') FROM jsonb_array_elements(m.def->'exams') x) AS exam_ids
         FROM mark_schemes m WHERE m.id = $1 AND m.deleted_at IS NULL`,
      [id],
    );
    const s = r.rows[0];
    if (!s || s.purpose !== 'result')
      throw new DomainError('not-found', 'Result scheme not found', { status: 404 });
    if (s.status !== 'locked')
      throw new DomainError(
        'exams.scheme_not_locked',
        'Promotion is proposed from a locked result scheme: lock it and work out the term results',
        { status: 409 },
      );
    return s;
  }

  /** The exam whose remark row carries the card's "Promoted to": the scheme's last exam. */
  private async cardExam(c: PoolClient, s: Scheme): Promise<string | null> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM exams WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL
        ORDER BY starts_on DESC NULLS LAST, array_position($1::bigint[], id) DESC LIMIT 1`,
      [s.exam_ids],
    );
    return r.rows[0]?.id ?? null;
  }

  private async nextYear(c: PoolClient, fromYearId: string, given?: string | null) {
    const r = await c.query<{ id: string; code: string }>(
      given
        ? `SELECT id::text, code FROM academic_years WHERE id = $2 AND id <> $1`
        : `SELECT y.id::text, y.code FROM academic_years y, academic_years f
            WHERE f.id = $1 AND y.start_date > f.start_date ORDER BY y.start_date LIMIT 1`,
      given ? [fromYearId, given] : [fromYearId],
    );
    return r.rows[0] ?? null;
  }

  async proposals(ctx: RequestContext, schemeId: string, q: SchemePromotionQueryDto) {
    const tenant = requireTenant(ctx);
    const allowed = await this.scopes.filter(tenant, EXAMS.marksView, 'class_section');
    return this.db.tenant(tenant, async (c) => {
      const s = await this.scheme(c, schemeId);
      const to = await this.nextYear(c, s.academic_year_id, q.toYearId);
      if (q.toYearId && !to)
        throw new DomainError('promotion.same_year', 'Choose a year other than the scheme’s', {
          status: 409,
        });
      const years = await c.query<{ id: string; code: string }>(
        `SELECT y.id::text, y.code FROM academic_years y, academic_years f
          WHERE f.id = $1 AND y.start_date > f.start_date ORDER BY y.start_date`,
        [s.academic_year_id],
      );
      const examId = await this.cardExam(c, s);
      const r = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        roll_no: number | null;
        class_section_id: string;
        section: string;
        section_name: string;
        class_id: string;
        class_name: string;
        class_order: number;
        pct: string | null;
        division: string | null;
        result: string;
        failed: string[];
        rank_in_class: number | null;
        next_class_id: string | null;
        next_class_name: string | null;
        decision: string | null;
        to_class_section_id: string | null;
        to_section: string | null;
        applied_at: Date | null;
        promoted_to: string | null;
      }>(
        `SELECT t.student_id::text, st.display_name AS name, st.admission_no, en.roll_no, cs.id::text AS class_section_id,
                k.code || '-' || cs.name AS section, cs.name AS section_name, k.id::text AS class_id, k.name AS class_name,
                k.display_order AS class_order, t.pct::text, t.division, t.result, t.failed, t.rank_in_class,
                nk.id::text AS next_class_id, nk.name AS next_class_name,
                d.decision::text, d.to_class_section_id::text, tk.code || '-' || tcs.name AS to_section, d.applied_at,
                rm.promoted_to
           FROM term_results t
           JOIN students st ON st.id = t.student_id
           JOIN class_sections cs ON cs.id = t.class_section_id JOIN classes k ON k.id = cs.class_id
           LEFT JOIN enrolments en ON en.student_id = t.student_id AND en.class_section_id = cs.id AND en.academic_year_id = t.academic_year_id
           LEFT JOIN LATERAL (SELECT n.id, n.name FROM classes n
                               WHERE n.display_order > k.display_order AND n.status = 'active' AND n.deleted_at IS NULL
                               ORDER BY n.display_order, n.code LIMIT 1) nk ON true
           LEFT JOIN promotion_decisions d ON d.student_id = t.student_id AND d.from_year_id = t.academic_year_id
           LEFT JOIN class_sections tcs ON tcs.id = d.to_class_section_id LEFT JOIN classes tk ON tk.id = tcs.class_id
           LEFT JOIN exam_remarks rm ON rm.exam_id = $5::bigint AND rm.student_id = t.student_id
          WHERE t.scheme_id = $1 AND ($2::bigint IS NULL OR t.class_id = $2::bigint)
            AND ($3::bigint IS NULL OR t.class_section_id = $3::bigint) AND ($4::bigint[] IS NULL OR t.class_section_id = ANY($4::bigint[]))
          ORDER BY k.display_order, cs.name, en.roll_no NULLS LAST, st.display_name`,
        [schemeId, q.classId ?? null, q.classSectionId ?? null, allowed, examId],
      );
      const sections = to
        ? (
            await c.query<{ id: string; label: string; class_id: string; name: string }>(
              `SELECT cs.id::text, k.code || '-' || cs.name AS label, cs.class_id::text, cs.name
                 FROM class_sections cs JOIN classes k ON k.id = cs.class_id
                WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY k.display_order, cs.name`,
              [to.id],
            )
          ).rows
        : [];
      // next year's section of a class: the same letter, else its first
      const sectionOf = (classId: string | null, name: string) => {
        if (!classId) return null;
        const of = sections.filter((x) => x.class_id === classId);
        return (of.find((x) => x.name === name) ?? of[0])?.id ?? null;
      };
      const rows = r.rows.map((x) => {
        const failed = x.failed.length ? x.failed.join(', ') : '';
        let proposal: Decision;
        let reason: string;
        let card: string | null;
        if (x.result === 'pass' && !x.next_class_id) {
          proposal = 'graduate';
          reason = 'Passed the last class';
          card = null;
        } else if (x.result === 'pass') {
          proposal = 'promote';
          reason = x.division ? `Passed · ${x.division}` : 'Passed';
          card = x.next_class_name;
        } else if (x.result === 'compartment') {
          proposal = 'review';
          reason = `Compartment${failed ? ` in ${failed}` : ''}: promoted once it is cleared`;
          card = x.next_class_name ? `${x.next_class_name}, subject to compartment` : null;
        } else if (x.result === 'fail') {
          proposal = 'retain';
          reason = `Failed${failed ? ` in ${failed}` : ''}`;
          card = `Retained in ${x.class_name}`;
        } else {
          proposal = 'review';
          reason = x.result === 'absent' ? 'Absent in an exam of the term' : 'Marks incomplete';
          card = null;
        }
        const toSection =
          proposal === 'promote'
            ? sectionOf(x.next_class_id, x.section_name)
            : proposal === 'retain'
              ? sectionOf(x.class_id, x.section_name)
              : null;
        return {
          studentId: x.student_id,
          name: x.name,
          admissionNo: x.admission_no,
          rollNo: x.roll_no,
          classSectionId: x.class_section_id,
          section: x.section,
          pct: x.pct === null ? null : Number(x.pct),
          division: x.division,
          result: x.result,
          failed: x.failed,
          rankInClass: x.rank_in_class,
          proposal,
          reason,
          proposedSectionId: toSection,
          proposedCard: card ? card.slice(0, 40) : null,
          /** what is there now */
          decision: x.decision
            ? {
                decision: x.decision,
                toClassSectionId: x.to_class_section_id,
                toSection: x.to_section,
                applied: Boolean(x.applied_at),
              }
            : null,
          promotedTo: x.promoted_to,
        };
      });
      const count = (d: Decision) => rows.filter((x) => x.proposal === d).length;
      return {
        scheme: { id: s.id, name: s.name, termCode: s.term_code },
        cardExamId: examId,
        toYear: to,
        years: years.rows,
        sections: sections.map((x) => ({ id: x.id, label: x.label, classId: x.class_id })),
        totals: {
          promote: count('promote'),
          review: count('review'),
          retain: count('retain'),
          graduate: count('graduate'),
        },
        rows,
      };
    });
  }

  /** The decisions to People → Promotions (not applied ones only) and the cards' "Promoted to". */
  async send(ctx: RequestContext, schemeId: string, dto: SendPromotionsDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const s = await this.scheme(c, schemeId);
      const to = dto.toYearId ? await this.nextYear(c, s.academic_year_id, dto.toYearId) : null;
      if (dto.toYearId && !to)
        throw new DomainError('promotion.same_year', 'Choose a year other than the scheme’s', {
          status: 409,
        });
      const examId = await this.cardExam(c, s);
      const known = await c.query<{ student_id: string }>(
        `SELECT student_id::text FROM term_results WHERE scheme_id = $1`,
        [schemeId],
      );
      const ids = new Set(known.rows.map((x) => x.student_id));
      const valid = to
        ? new Set(
            (
              await c.query<{ id: string }>(
                `SELECT id::text FROM class_sections WHERE academic_year_id = $1 AND deleted_at IS NULL`,
                [to.id],
              )
            ).rows.map((x) => x.id),
          )
        : new Set<string>();
      let decisions = 0;
      let cards = 0;
      for (const r of dto.rows) {
        if (!ids.has(r.studentId))
          throw new DomainError(
            'exams.not_in_term_results',
            'A student has no term result in this scheme',
            { status: 409, extra: { studentId: r.studentId } },
          );
        const needs = r.decision === 'promote' || r.decision === 'retain';
        if (to && needs && !r.toClassSectionId)
          throw new DomainError(
            'promotion.section_required',
            'Choose next year’s section to promote or retain',
            { status: 400, extra: { studentId: r.studentId } },
          );
        if (to && r.toClassSectionId && !valid.has(r.toClassSectionId))
          throw new DomainError(
            'promotion.section_not_in_year',
            'The target section is not in the target year',
            { status: 409, extra: { studentId: r.studentId } },
          );
        if (to && r.decision !== 'review') {
          const e = await c.query<{ id: string }>(
            `SELECT id::text FROM enrolments WHERE student_id = $1 AND academic_year_id = $2 ORDER BY id DESC LIMIT 1`,
            [r.studentId, s.academic_year_id],
          );
          const u = await c.query(
            `INSERT INTO promotion_decisions (school_id, from_year_id, to_year_id, student_id, from_enrolment_id, decision, to_class_section_id, remarks, decided_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::promotion_decision, $6, $7, app.current_user_id())
             ON CONFLICT (from_year_id, student_id) DO UPDATE
               SET to_year_id = EXCLUDED.to_year_id, decision = EXCLUDED.decision, to_class_section_id = EXCLUDED.to_class_section_id,
                   remarks = EXCLUDED.remarks, decided_by = EXCLUDED.decided_by, decided_at = now()
               WHERE promotion_decisions.applied_at IS NULL`,
            [
              s.academic_year_id,
              to.id,
              r.studentId,
              e.rows[0]?.id ?? null,
              r.decision,
              needs ? r.toClassSectionId : null,
              `From ${s.name} (${s.term_code})`,
            ],
          );
          decisions += u.rowCount ?? 0;
        }
        if (examId && r.promotedTo !== undefined) {
          const text = r.promotedTo?.trim() || null;
          if (text) {
            const u = await c.query(
              `INSERT INTO exam_remarks (school_id, exam_id, student_id, promoted_to, entered_by)
               VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
               ON CONFLICT (exam_id, student_id) DO UPDATE SET promoted_to = EXCLUDED.promoted_to, entered_by = app.current_user_id()
               WHERE exam_remarks.promoted_to IS DISTINCT FROM EXCLUDED.promoted_to`,
              [examId, r.studentId, text],
            );
            cards += u.rowCount ?? 0;
          } else {
            // nothing else on the row: it goes; else only "Promoted to" is cleared
            const d = await c.query(
              `DELETE FROM exam_remarks WHERE exam_id = $1 AND student_id = $2 AND remark IS NULL AND participation IS NULL`,
              [examId, r.studentId],
            );
            const u = await c.query(
              `UPDATE exam_remarks SET promoted_to = NULL WHERE exam_id = $1 AND student_id = $2 AND promoted_to IS NOT NULL`,
              [examId, r.studentId],
            );
            cards += (d.rowCount ?? 0) + (u.rowCount ?? 0);
          }
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.promotion.send',
        entityType: 'mark_schemes',
        entityId: schemeId,
        after: { toYearId: to?.id ?? null, rows: dto.rows.length, decisions, cards },
      });
      return { decisions, cards, toYear: to };
    });
  }
}
