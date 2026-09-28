import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import {
  bandFor,
  loadReportCardData,
  reportCardDocument,
  sampleReportCardData,
  DEFAULT_LAYOUTS,
  type ClassBand,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { ReportsService } from '../reports/reports.service';
import type {
  CreateReleaseDto,
  CreateTemplateDto,
  PreviewDto,
  RenderBatchDto,
  UpdateReleaseDto,
  UpdateTemplateDto,
} from './report-cards.dto';

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  band: ClassBand;
  layout: Record<string, unknown>;
  bodyHtml: string | null;
  stylesCss: string;
  pageWidth: string;
  pageHeight: string;
  version: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

export interface ReleaseRow {
  id: string;
  termCode: string;
  name: string;
  examIds: string[];
  exams: Array<{ id: string; code: string; name: string }>;
  templates: Record<string, string>;
  hideDefaulters: boolean;
  defaulterMin: string;
  status: 'draft' | 'released' | 'withdrawn';
  releasedAt: string | null;
  createdAt: string;
  cards: { rendered: number; withheld: number };
}

const T_COLS = `id::text, code, name, band::text, layout, body_html, styles_css, page_width, page_height, version, status::text, updated_at`;
const toTemplate = (r: Record<string, unknown>): TemplateRow => ({
  id: String(r.id),
  code: String(r.code),
  name: String(r.name),
  band: r.band as ClassBand,
  layout: (r.layout as Record<string, unknown>) ?? {},
  bodyHtml: (r.body_html as string | null) ?? null,
  stylesCss: String(r.styles_css ?? ''),
  pageWidth: String(r.page_width),
  pageHeight: String(r.page_height),
  version: Number(r.version),
  status: r.status as TemplateRow['status'],
  updatedAt: new Date(r.updated_at as string).toISOString(),
});

const R_COLS = `r.id::text, r.term_code, r.name, r.exam_ids::text[] AS exam_ids, r.templates, r.hide_defaulters, r.defaulter_min::text, r.status, r.released_at, r.created_at,
  (SELECT jsonb_agg(jsonb_build_object('id', e.id::text, 'code', e.code, 'name', e.name) ORDER BY array_position(r.exam_ids, e.id)) FROM exams e WHERE e.id = ANY(r.exam_ids)) AS exams,
  (SELECT count(*) FROM report_cards c WHERE c.release_id = r.id AND c.rendered_at IS NOT NULL)::int AS rendered,
  (SELECT count(*) FROM report_cards c WHERE c.release_id = r.id AND c.withheld)::int AS withheld`;
const toRelease = (r: Record<string, unknown>): ReleaseRow => ({
  id: String(r.id),
  termCode: String(r.term_code),
  name: String(r.name),
  examIds: (r.exam_ids as string[]) ?? [],
  exams: (r.exams as ReleaseRow['exams']) ?? [],
  templates: (r.templates as Record<string, string>) ?? {},
  hideDefaulters: Boolean(r.hide_defaulters),
  defaulterMin: String(r.defaulter_min),
  status: r.status as ReleaseRow['status'],
  releasedAt: r.released_at ? new Date(r.released_at as string).toISOString() : null,
  createdAt: new Date(r.created_at as string).toISOString(),
  cards: { rendered: Number(r.rendered), withheld: Number(r.withheld) },
});

/**
 * Sprint 17: report-card templates (a JSON layout per class band, optionally a custom HTML body),
 * term releases (which exams, which template per band, the fee-defaulter visibility rule), batch
 * rendering through the export service and the family's read of released results.
 */
@Injectable()
export class ReportCardsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly viewer: ViewerService,
  ) {}

  // ---- templates ---------------------------------------------------------------------------------
  async templates(ctx: RequestContext): Promise<TemplateRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
        `SELECT ${T_COLS} FROM report_card_templates WHERE deleted_at IS NULL ORDER BY band, code`,
      );
      return r.rows.map(toTemplate);
    });
  }

  async installDefaults(ctx: RequestContext): Promise<TemplateRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const band of ['primary', 'middle', 'secondary', 'senior'] as ClassBand[]) {
        await c.query(
          `INSERT INTO report_card_templates (school_id, code, name, band, layout)
           VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb)
           ON CONFLICT (school_id, code) DO NOTHING`,
          [
            `${band}_default`,
            `${band[0]!.toUpperCase()}${band.slice(1)} report card`,
            band,
            JSON.stringify(DEFAULT_LAYOUTS[band]),
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.defaults',
        entityType: 'report_card_templates',
      });
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
        `SELECT ${T_COLS} FROM report_card_templates WHERE deleted_at IS NULL ORDER BY band, code`,
      );
      return r.rows.map(toTemplate);
    });
  }

  async createTemplate(ctx: RequestContext, dto: CreateTemplateDto): Promise<TemplateRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c
        .query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
          `INSERT INTO report_card_templates (school_id, code, name, band, layout, body_html, styles_css, page_width, page_height)
         VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb, $5, $6, $7, $8) RETURNING ${T_COLS}`,
          [
            dto.code,
            dto.name,
            dto.band,
            JSON.stringify(dto.layout ?? DEFAULT_LAYOUTS[dto.band]),
            dto.bodyHtml ?? null,
            dto.stylesCss,
            dto.pageWidth,
            dto.pageHeight,
          ],
        )
        .catch((e: { code?: string }) => {
          if (e.code === '23505')
            throw new DomainError('conflict', 'A template with this code exists', { status: 409 });
          throw e;
        });
      const row = toTemplate(r.rows[0]!);
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.template_create',
        entityType: 'report_card_templates',
        entityId: row.id,
        after: dto,
      });
      return row;
    });
  }

  async updateTemplate(
    ctx: RequestContext,
    id: string,
    dto: UpdateTemplateDto,
  ): Promise<TemplateRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sets: string[] = ['updated_at = now()', 'version = version + 1'];
      const params: unknown[] = [];
      const add = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) add('name', dto.name);
      if (dto.band !== undefined) add('band', dto.band, '::class_band');
      if (dto.layout !== undefined) add('layout', JSON.stringify(dto.layout), '::jsonb');
      if (dto.bodyHtml !== undefined) add('body_html', dto.bodyHtml);
      if (dto.stylesCss !== undefined) add('styles_css', dto.stylesCss);
      if (dto.pageWidth !== undefined) add('page_width', dto.pageWidth);
      if (dto.pageHeight !== undefined) add('page_height', dto.pageHeight);
      if (dto.status !== undefined) add('status', dto.status, '::row_status');
      params.push(id);
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed column assignments; values are bound
        `UPDATE report_card_templates SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${T_COLS}`,
        params,
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Template not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.template_update',
        entityType: 'report_card_templates',
        entityId: id,
        after: dto,
      });
      return toTemplate(r.rows[0]);
    });
  }

  /** HTML of one card: a real pupil of a release, or the sample data of a band. */
  async preview(
    ctx: RequestContext,
    templateId: string,
    dto: PreviewDto,
  ): Promise<{ html: string }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.findTemplate(c, templateId);
      if (!t) throw new DomainError('not-found', 'Template not found', { status: 404 });
      const like = {
        layout: t.layout,
        bodyHtml: t.bodyHtml,
        stylesCss: t.stylesCss,
        pageWidth: t.pageWidth,
        pageHeight: t.pageHeight,
      };
      if (dto.studentId && dto.releaseId) {
        const rel = await this.findRelease(c, dto.releaseId);
        if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
        const data = await loadReportCardData(c, {
          studentId: dto.studentId,
          examIds: rel.examIds,
          termCode: rel.termCode,
          termName: rel.name,
          defaulterMin: Number(rel.defaulterMin),
        }).catch(() => {
          throw new DomainError('not-found', 'The pupil is not enrolled in the working year', {
            status: 404,
          });
        });
        return { html: reportCardDocument(like, [{ data }]) };
      }
      return {
        html: reportCardDocument(like, [{ data: sampleReportCardData(dto.band ?? t.band) }]),
      };
    });
  }

  // ---- releases ----------------------------------------------------------------------------------
  async releases(ctx: RequestContext): Promise<ReleaseRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
        `SELECT ${R_COLS} FROM report_card_releases r WHERE r.academic_year_id = app.current_academic_year_id() ORDER BY r.created_at DESC`,
      );
      return r.rows.map(toRelease);
    });
  }

  async release(ctx: RequestContext, id: string): Promise<ReleaseRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findRelease(c, id);
      if (!row) throw new DomainError('not-found', 'Release not found', { status: 404 });
      return row;
    });
  }

  async createRelease(ctx: RequestContext, dto: CreateReleaseDto): Promise<ReleaseRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ex = await c.query(
        `SELECT 1 FROM exams WHERE id = ANY($1::bigint[]) AND academic_year_id = app.current_academic_year_id() AND deleted_at IS NULL`,
        [dto.examIds],
      );
      if (ex.rowCount !== dto.examIds.length)
        throw new DomainError('validation-failed', 'Every exam must belong to the working year', {
          status: 400,
        });
      const r = await c
        .query<{ id: string }>(
          `INSERT INTO report_card_releases (school_id, academic_year_id, term_code, name, exam_ids, templates, hide_defaulters, defaulter_min, created_by)
         VALUES (app.current_school_id(), app.current_academic_year_id(), $1, $2, $3::bigint[], $4::jsonb, $5, $6, app.current_user_id()) RETURNING id::text`,
          [
            dto.termCode,
            dto.name,
            dto.examIds,
            JSON.stringify(dto.templates),
            dto.hideDefaulters,
            dto.defaulterMin,
          ],
        )
        .catch((e: { code?: string }) => {
          if (e.code === '23505')
            throw new DomainError('conflict', 'This term already has a release', { status: 409 });
          throw e;
        });
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.release_create',
        entityType: 'report_card_releases',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return (await this.findRelease(c, r.rows[0]!.id))!;
    });
  }

  async updateRelease(ctx: RequestContext, id: string, dto: UpdateReleaseDto): Promise<ReleaseRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [];
      const add = (col: string, v: unknown, cast = '') => {
        params.push(v);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) add('name', dto.name);
      if (dto.examIds !== undefined) add('exam_ids', dto.examIds, '::bigint[]');
      if (dto.templates !== undefined) add('templates', JSON.stringify(dto.templates), '::jsonb');
      if (dto.hideDefaulters !== undefined) add('hide_defaulters', dto.hideDefaulters);
      if (dto.defaulterMin !== undefined) add('defaulter_min', dto.defaulterMin);
      if (dto.status !== undefined) {
        add('status', dto.status);
        if (dto.status === 'released')
          sets.push('released_at = now()', 'released_by = app.current_user_id()');
      }
      params.push(id);
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed column assignments; values are bound
        `UPDATE report_card_releases SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (r.rowCount === 0)
        throw new DomainError('not-found', 'Release not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `exams.report_card.release_${dto.status ?? 'update'}`,
        entityType: 'report_card_releases',
        entityId: id,
        after: dto,
      });
      return (await this.findRelease(c, id))!;
    });
  }

  /** Queues one PDF for a whole section (page break per pupil); the worker records each card. */
  async renderBatch(ctx: RequestContext, releaseId: string, dto: RenderBatchDto) {
    const rel = await this.release(ctx, releaseId);
    await this.assertTemplateFor(ctx, rel, dto.classSectionId);
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'report_card_batch',
        format: 'pdf',
        params: { releaseId, classSectionId: dto.classSectionId },
        title: `Report cards · ${rel.name}`,
      },
      'exams.report_card.render_batch',
    );
    return { exportId: exp.id, status: exp.status };
  }

  async renderOne(ctx: RequestContext, releaseId: string, studentId: string) {
    const rel = await this.release(ctx, releaseId);
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'report_card',
        format: 'pdf',
        params: { releaseId, studentId },
        title: `Report card · ${rel.name}`,
      },
      'exams.report_card.render',
    );
    return { exportId: exp.id, status: exp.status };
  }

  /** Per-pupil status of a release for one section (rendered, withheld, export id). */
  async cards(ctx: RequestContext, releaseId: string, classSectionId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                rc.export_id::text, rc.withheld, rc.withheld_reason, rc.rendered_at, x.status AS export_status
           FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN report_cards rc ON rc.release_id = $1 AND rc.student_id = s.id
           LEFT JOIN exports x ON x.id = rc.export_id
          WHERE e.class_section_id = $2 AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
          ORDER BY e.roll_no NULLS LAST, s.display_name`,
        [releaseId, classSectionId],
      );
      return r.rows.map((x) => ({
        studentId: String(x.student_id),
        name: String(x.name),
        admissionNo: String(x.admission_no),
        rollNo: (x.roll_no as number | null) ?? null,
        exportId: (x.export_id as string | null) ?? null,
        exportStatus: (x.export_status as string | null) ?? null,
        withheld: Boolean(x.withheld),
        withheldReason: (x.withheld_reason as string | null) ?? null,
        renderedAt: x.rendered_at ? new Date(x.rendered_at as string).toISOString() : null,
      }));
    });
  }

  // ---- family ------------------------------------------------------------------------------------
  /** Released terms of the caller's children with the term summary (no marks detail: that is the card). */
  async mine(ctx: RequestContext) {
    const v = await this.viewer.resolve(ctx, 'exams.family.view');
    if (v.kind !== 'family') return { children: [] };
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const children = [];
      for (const s of v.students) {
        const rel = await c.query<Record<string, unknown>>(
          `SELECT r.id::text, r.term_code, r.name, r.hide_defaulters, r.defaulter_min::text, r.released_at,
                  (SELECT jsonb_agg(jsonb_build_object('code', e.code, 'name', e.name, 'pct', x.pct::text, 'grade', x.grade, 'result', x.result, 'rank', x.rank_in_section) ORDER BY array_position(r.exam_ids, e.id))
                     FROM exams e LEFT JOIN exam_results x ON x.exam_id = e.id AND x.student_id = $1 WHERE e.id = ANY(r.exam_ids) AND e.show_on_portal) AS exams,
                  rc.withheld, rc.export_id::text
             FROM report_card_releases r
             LEFT JOIN report_cards rc ON rc.release_id = r.id AND rc.student_id = $1
            WHERE r.academic_year_id = app.current_academic_year_id() AND r.status = 'released'
            ORDER BY r.released_at DESC`,
          [s.id],
        );
        children.push({
          student: { id: s.id, name: s.name, section: s.section },
          terms: rel.rows.map((r) => ({
            releaseId: String(r.id),
            termCode: String(r.term_code),
            name: String(r.name),
            releasedAt: r.released_at ? new Date(r.released_at as string).toISOString() : null,
            exams: (r.exams as unknown[]) ?? [],
            withheld: Boolean(r.withheld),
          })),
        });
      }
      return { children };
    });
  }

  /** A family's own card: refused while the fee rule withholds it. */
  async myReportCardPdf(ctx: RequestContext, releaseId: string, studentId: string) {
    const v = await this.viewer.resolve(ctx, 'exams.family.view');
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Report card not found', { status: 404 });
    const info = await this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.findRelease(c, releaseId);
      if (!rel || rel.status !== 'released')
        throw new DomainError('not-found', 'Report card not found', { status: 404 });
      if (rel.hideDefaulters) {
        const data = await loadReportCardData(c, {
          studentId,
          examIds: rel.examIds,
          termCode: rel.termCode,
          termName: rel.name,
          defaulterMin: Number(rel.defaulterMin),
        });
        if (data.fees.defaulter)
          throw new DomainError(
            'report_card.withheld',
            'The report card is available once the fee dues are cleared',
            {
              status: 409,
              extra: { balance: data.fees.balance },
            },
          );
      }
      return rel;
    });
    const exp = await this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'report_card',
        format: 'pdf',
        params: { releaseId, studentId },
        title: `Report card · ${info.name}`,
      },
      'exams.report_card.render_family',
    );
    return { exportId: exp.id, status: exp.status };
  }

  async myExportStatus(ctx: RequestContext, exportId: string) {
    const own = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(`SELECT 1 FROM exports WHERE id = $1 AND requested_by = app.current_user_id()`, [
        exportId,
      ]),
    );
    if (!own.rowCount) throw new DomainError('not-found', 'Export not found', { status: 404 });
    return this.reports.status(ctx, exportId);
  }

  // ---- helpers -----------------------------------------------------------------------------------
  private async findTemplate(c: PoolClient, id: string): Promise<TemplateRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
      `SELECT ${T_COLS} FROM report_card_templates WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toTemplate(r.rows[0]) : null;
  }

  private async findRelease(c: PoolClient, id: string): Promise<ReleaseRow | null> {
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
      `SELECT ${R_COLS} FROM report_card_releases r WHERE r.id = $1`,
      [id],
    );
    return r.rows[0] ? toRelease(r.rows[0]) : null;
  }

  /** The section's band must have a template (the release's, or the band's active default). */
  private async assertTemplateFor(
    ctx: RequestContext,
    rel: ReleaseRow,
    classSectionId: string,
  ): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await c.query<{ band: string | null; display_order: number }>(
        `SELECT k.band::text, k.display_order FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
        [classSectionId],
      );
      if (!k.rows[0]) throw new DomainError('not-found', 'Section not found', { status: 404 });
      const band = bandFor(k.rows[0].band, k.rows[0].display_order);
      const t = rel.templates[band]
        ? await c.query(
            `SELECT 1 FROM report_card_templates WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
            [rel.templates[band]],
          )
        : await c.query(
            `SELECT 1 FROM report_card_templates WHERE band = $1::class_band AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
            [band],
          );
      if (!t.rowCount)
        throw new DomainError(
          'report_card.no_template',
          `No active report-card template for the ${band} band; install the defaults or design one`,
          { status: 409 },
        );
    });
  }
}
