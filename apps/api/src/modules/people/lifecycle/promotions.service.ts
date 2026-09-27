import { Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import type {
  ApplyPromotionsDto,
  ListPromotionsQueryDto,
  SetPromotionsDto,
  YearSectionsQueryDto,
} from './lifecycle.dto';

export interface PromotionRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  fromSection: string;
  rollNo: number | null;
  decisionId: string | null;
  decision: 'promote' | 'retain' | 'transfer_out' | 'graduate' | null;
  toClassSectionId: string | null;
  toSection: string | null;
  remarks: string | null;
  appliedAt: string | null;
}

/**
 * Promotion decisions (S7-02, legacy student_promotion): one decision per student and source year,
 * applied into the next year's enrolments by app.apply_promotion (which uses app.enrol_student).
 */
@Injectable()
export class PromotionsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private fromYear(ctx: RequestContext, given?: string): string {
    const tenant = requireTenant(ctx);
    const id = given ?? tenant.academicYearId;
    if (!id)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return id;
  }

  async list(ctx: RequestContext, q: ListPromotionsQueryDto): Promise<PromotionRow[]> {
    const fromYearId = this.fromYear(ctx, q.fromYearId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        student_id: string;
        student_name: string;
        admission_no: string;
        from_section: string;
        roll_no: number | null;
        decision_id: string | null;
        decision: PromotionRow['decision'];
        to_class_section_id: string | null;
        to_section: string | null;
        remarks: string | null;
        applied_at: Date | null;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS student_name, s.admission_no, c.code || '-' || cs.name AS from_section, e.roll_no,
                d.id::text AS decision_id, d.decision, d.to_class_section_id::text, tc.code || '-' || tcs.name AS to_section, d.remarks, d.applied_at
           FROM enrolments e
           JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           JOIN class_sections cs ON cs.id = e.class_section_id
           JOIN classes c ON c.id = cs.class_id
           LEFT JOIN promotion_decisions d ON d.student_id = s.id AND d.from_year_id = e.academic_year_id AND ($3::bigint IS NULL OR d.to_year_id = $3::bigint)
           LEFT JOIN class_sections tcs ON tcs.id = d.to_class_section_id
           LEFT JOIN classes tc ON tc.id = tcs.class_id
          WHERE e.academic_year_id = $1 AND cs.class_id = $2 AND e.status IN ('active', 'promoted')
          ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
        [fromYearId, q.classId, q.toYearId ?? null],
      );
      return r.rows.map((x) => ({
        studentId: x.student_id,
        studentName: x.student_name,
        admissionNo: x.admission_no,
        fromSection: x.from_section,
        rollNo: x.roll_no,
        decisionId: x.decision_id,
        decision: x.decision,
        toClassSectionId: x.to_class_section_id,
        toSection: x.to_section,
        remarks: x.remarks,
        appliedAt: x.applied_at ? x.applied_at.toISOString() : null,
      }));
    });
  }

  /** Sections of any year (the target year is usually planned, not the working year). */
  async sectionsOfYear(ctx: RequestContext, q: YearSectionsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; label: string; class_id: string; order: number }>(
        `SELECT cs.id::text, c.code || '-' || cs.name AS label, cs.class_id::text, c.display_order AS "order"
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY c.display_order, cs.name`,
        [q.yearId],
      );
      return r.rows.map((x) => ({ id: x.id, label: x.label, classId: x.class_id, order: x.order }));
    });
  }

  async set(ctx: RequestContext, dto: SetPromotionsDto): Promise<{ saved: number }> {
    const fromYearId = this.fromYear(ctx, dto.fromYearId);
    if (fromYearId === dto.toYearId)
      throw new DomainError(
        'promotion.same_year',
        'The target year must differ from the source year',
        {
          status: 409,
        },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sections = await c.query<{ id: string }>(
        `SELECT id::text FROM class_sections WHERE academic_year_id = $1 AND deleted_at IS NULL`,
        [dto.toYearId],
      );
      const valid = new Set(sections.rows.map((x) => x.id));
      let saved = 0;
      for (const d of dto.decisions) {
        if (d.toClassSectionId && !valid.has(d.toClassSectionId))
          throw new DomainError(
            'promotion.section_not_in_year',
            'The target section is not in the target year',
            {
              status: 409,
              extra: { studentId: d.studentId },
            },
          );
        const e = await c.query<{ id: string }>(
          `SELECT id::text FROM enrolments WHERE student_id = $1 AND academic_year_id = $2 ORDER BY id DESC LIMIT 1`,
          [d.studentId, fromYearId],
        );
        if (!e.rows[0])
          throw new DomainError(
            'promotion.not_enrolled',
            'The student is not enrolled in the source year',
            {
              status: 409,
              extra: { studentId: d.studentId },
            },
          );
        const r = await c.query(
          `INSERT INTO promotion_decisions (school_id, from_year_id, to_year_id, student_id, from_enrolment_id, decision, to_class_section_id, remarks, decided_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::promotion_decision, $6, $7, app.current_user_id())
           ON CONFLICT (from_year_id, student_id) DO UPDATE
             SET to_year_id = EXCLUDED.to_year_id, decision = EXCLUDED.decision, to_class_section_id = EXCLUDED.to_class_section_id,
                 remarks = EXCLUDED.remarks, decided_by = EXCLUDED.decided_by, decided_at = now()
             WHERE promotion_decisions.applied_at IS NULL`,
          [
            fromYearId,
            dto.toYearId,
            d.studentId,
            e.rows[0].id,
            d.decision,
            d.toClassSectionId ?? null,
            d.remarks ?? null,
          ],
        );
        saved += r.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'people.promotion.decide',
        entityType: 'promotion_decisions',
        after: { fromYearId, toYearId: dto.toYearId, saved, students: dto.decisions.length },
      });
      return { saved };
    });
  }

  async apply(
    ctx: RequestContext,
    dto: ApplyPromotionsDto,
  ): Promise<{ applied: number; skipped: number }> {
    const fromYearId = this.fromYear(ctx, dto.fromYearId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const pending = await c.query<{ id: string }>(
        `SELECT d.id::text FROM promotion_decisions d
           JOIN enrolments e ON e.id = d.from_enrolment_id JOIN class_sections cs ON cs.id = e.class_section_id
          WHERE d.from_year_id = $1 AND d.to_year_id = $2 AND d.applied_at IS NULL AND ($3::bigint IS NULL OR cs.class_id = $3::bigint)
          ORDER BY d.id`,
        [fromYearId, dto.toYearId, dto.classId ?? null],
      );
      let applied = 0;
      for (const d of pending.rows) {
        await c.query(`SELECT app.apply_promotion($1)`, [d.id]);
        applied += 1;
      }
      const skipped = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM promotion_decisions WHERE from_year_id = $1 AND to_year_id = $2 AND applied_at IS NOT NULL`,
        [fromYearId, dto.toYearId],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.promotion.apply',
        entityType: 'promotion_decisions',
        after: { fromYearId, toYearId: dto.toYearId, classId: dto.classId ?? null, applied },
      });
      return { applied, skipped: Number(skipped.rows[0]?.n ?? 0) - applied };
    });
  }
}
