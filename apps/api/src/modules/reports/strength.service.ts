import { Injectable } from '@nestjs/common';
import {
  QUEUES,
  STRENGTH_REPORTS,
  buildStrengthReport,
  strengthStudents,
  type StrengthParams,
} from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import type { StrengthExportDto, StrengthQueryDto, StrengthStudentsQueryDto } from './strength.dto';

export const STRENGTH = { view: 'people.student.view' } as const;

/**
 * Student strength reports: class-wise with concessions, category F / M / T, one concession's count
 * and age as on a date. A user limited to some sections (a class teacher) sees only those.
 */
@Injectable()
export class StrengthReportsService {
  constructor(
    private readonly db: DbService,
    private readonly scopes: ScopePolicy,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private async params(ctx: RequestContext, q: StrengthQueryDto): Promise<StrengthParams> {
    const tenant = requireTenant(ctx);
    const academicYearId = q.academicYearId ?? tenant.academicYearId;
    if (!academicYearId)
      throw new DomainError('year.not_selected', 'Choose an academic year', { status: 409 });
    const allowed = await this.scopes.filter(tenant, STRENGTH.view, 'class_section');
    let sectionIds = q.sectionIds;
    if (allowed !== null) {
      const mine: string[] = allowed;
      sectionIds = (sectionIds ?? mine).filter((id: string) => mine.includes(id));
      if (!sectionIds.length) sectionIds = ['0'];
    }
    return {
      report: q.report,
      academicYearId,
      classIds: q.classIds,
      sectionIds,
      groupBy: q.groupBy,
      includeLeft: q.includeLeft,
      showEmpty: q.showEmpty,
      asOn: q.asOn,
      discountId: q.discountId,
    };
  }

  /** Classes with their sections and the concessions of the year, for the filters. */
  async options(ctx: RequestContext, academicYearId?: string) {
    const tenant = requireTenant(ctx);
    const yearId = academicYearId ?? tenant.academicYearId;
    return this.db.tenant(tenant, async (c) => {
      const years = await c.query<{ id: string; code: string; status: string }>(
        `SELECT id::text, code, status::text FROM academic_years WHERE status <> 'planned' ORDER BY start_date DESC`,
      );
      const sections = await c.query<{
        class_id: string;
        code: string;
        section_id: string;
        name: string;
      }>(
        `SELECT k.id::text AS class_id, k.code, cs.id::text AS section_id, cs.name
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.status = 'active'
          ORDER BY k.display_order, k.code, cs.name`,
        [yearId ?? null],
      );
      const discounts = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM fee_discounts WHERE academic_year_id = $1 AND status = 'active' ORDER BY name`,
        [yearId ?? null],
      );
      const classes = new Map<
        string,
        { id: string; code: string; sections: Array<{ id: string; name: string }> }
      >();
      for (const s of sections.rows) {
        const k = classes.get(s.class_id) ?? { id: s.class_id, code: s.code, sections: [] };
        k.sections.push({ id: s.section_id, name: s.name });
        classes.set(s.class_id, k);
      }
      return {
        reports: STRENGTH_REPORTS,
        academicYearId: yearId ?? null,
        years: years.rows,
        classes: [...classes.values()],
        discounts: discounts.rows,
      };
    });
  }

  async report(ctx: RequestContext, q: StrengthQueryDto) {
    const p = await this.params(ctx, q);
    return this.db.tenant(requireTenant(ctx), (c) => buildStrengthReport(c, p));
  }

  async students(ctx: RequestContext, q: StrengthStudentsQueryDto) {
    const p = await this.params(ctx, q);
    const data = await this.db.tenant(requireTenant(ctx), (c) =>
      strengthStudents(
        c,
        p,
        {
          classId: q.classId,
          classSectionId: q.classSectionId,
          ...(q.stream !== undefined ? { stream: q.stream || null } : {}),
        },
        q.column,
      ),
    );
    return { data };
  }

  /** Queues the branded Excel or PDF through the export pipeline (the worker rebuilds the same table). */
  async export(ctx: RequestContext, dto: StrengthExportDto) {
    const p = await this.params(ctx, dto);
    const title = STRENGTH_REPORTS.find((r) => r.id === p.report)!.title;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), 'strength_report', $1, $2::jsonb, $3, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [dto.format, JSON.stringify(p), title],
      );
      const exportId = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId });
      await this.audit.stage(ctx, c, {
        action: 'reports.strength.export',
        entityType: 'exports',
        entityId: exportId,
        after: { report: p.report, format: dto.format, groupBy: p.groupBy },
      });
      return { exportId, format: dto.format };
    });
  }
}
