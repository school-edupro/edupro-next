import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import {
  bandFor,
  loadReportCardData,
  reportCardDocument,
  sampleReportCardData,
  DEFAULT_LAYOUTS,
  DPS_NOIDA_TEMPLATES,
  HPC_TEMPLATES,
  type ClassBand,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { ReportsService } from '../reports/reports.service';
import { ReportCardSignaturesService } from './report-card-signatures.service';
import type {
  CreateReleaseDto,
  CreateTemplateDto,
  GenerateCardsDto,
  PreviewDto,
  RenderBatchDto,
  UpdateReleaseDto,
  UpdateTemplateDto,
} from './report-cards.dto';

/** the legacy ranges, in the titles of the PDFs (the Download Log) */
const RANGE_LABEL: Record<string, string> = {
  first10: '1–10',
  '11-20': '11–20',
  '21-30': '21–30',
  '31-40': '31–40',
  above40: '41 onwards',
  '1-2': '1–2',
  all: 'whole class',
};

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
  status: 'draft' | 'submitted' | 'released' | 'withdrawn';
  releasedAt: string | null;
  createdAt: string;
  cards: { rendered: number; withheld: number };
  /** docs/design/65 part 2: sent to the principal, withdrawn with a reason, families told, holds */
  submittedAt: string | null;
  withdrawnReason: string | null;
  notifiedCount: number;
  held: number;
  /** sections × subjects of the release's exams whose marks are not verified yet */
  unverified: number;
  /** the classes the release carries, and how many are published (class-wise, 1 Nov 2026) */
  classCount: number;
  publishedClasses: number;
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
  (SELECT count(*) FROM report_cards c WHERE c.release_id = r.id AND c.withheld)::int AS withheld,
  r.submitted_at, r.withdrawn_reason, r.notified_count,
  (SELECT count(*) FROM report_card_holds h WHERE h.release_id = r.id)::int AS held,
  (SELECT count(*) FROM exam_subjects es
     JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL AND cs.status = 'active'
     LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
    WHERE es.exam_id = ANY(r.exam_ids) AND COALESCE(st.status, 'open') <> 'verified'
      AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active'
                    AND app.student_exam_subject_kind(en.student_id, es.exam_id, es.subject_id) IS NOT NULL))::int AS unverified,
  (SELECT count(DISTINCT ec.class_id) FROM exam_classes ec WHERE ec.exam_id = ANY(r.exam_ids))::int AS class_count,
  (SELECT count(*) FROM report_card_release_classes x WHERE x.release_id = r.id AND x.status = 'released')::int AS published_classes`;
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
  submittedAt: r.submitted_at ? new Date(r.submitted_at as string).toISOString() : null,
  withdrawnReason: (r.withdrawn_reason as string | null) ?? null,
  notifiedCount: Number(r.notified_count ?? 0),
  held: Number(r.held ?? 0),
  unverified: Number(r.unverified ?? 0),
  classCount: Number(r.class_count ?? 0),
  publishedClasses: Number(r.published_classes ?? 0),
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
    private readonly signatures: ReportCardSignaturesService,
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
      for (const band of [
        'pre_primary',
        'primary',
        'middle',
        'secondary',
        'senior',
      ] as ClassBand[]) {
        await c.query(
          `INSERT INTO report_card_templates (school_id, code, name, band, layout)
           VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb)
           ON CONFLICT (school_id, code) DO NOTHING`,
          [
            `${band}_default`,
            `${band === 'pre_primary' ? 'Pre-primary' : `${band[0]!.toUpperCase()}${band.slice(1)}`} report card`,
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

  /**
   * The DPS Noida cards (docs/design/65, part 4) or the HPC (part 5) as templates; one the school
   * already has stays.
   */
  async installDps(ctx: RequestContext, which: 'dps' | 'hpc' = 'dps'): Promise<TemplateRow[]> {
    const list = which === 'hpc' ? HPC_TEMPLATES : DPS_NOIDA_TEMPLATES;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const t of list)
        await c.query(
          `INSERT INTO report_card_templates (school_id, code, name, band, layout)
           VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb)
           ON CONFLICT (school_id, code) DO NOTHING`,
          [t.code, t.name, t.band, JSON.stringify(t.layout)],
        );
      await this.audit.stage(ctx, c, {
        action: `exams.report_card.templates_${which}`,
        entityType: 'report_card_templates',
        entityId: which,
        after: { codes: list.map((t) => t.code) },
      });
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- T_COLS is a constant
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
        await this.signatures.fill(data.signatures ?? []);
        await this.signatures.fill(data.hpc?.portfolio ?? []);
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
    // docs/design/65 part 2: the principal publishes and withdraws (with a reason); the office sends it on
    if (
      (dto.status === 'released' || dto.status === 'withdrawn') &&
      !ctx.permissions?.has('exams.result.publish')
    )
      throw new DomainError(
        'permission-denied',
        'Publishing and withdrawing results needs exams.result.publish (the principal)',
        { status: 403 },
      );
    if (dto.status === 'withdrawn' && !dto.reason?.trim())
      throw new DomainError('validation-failed', 'Give the reason for withdrawing the results', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.findRelease(c, id);
      if (!before) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const from: Record<string, ReleaseRow['status'][]> = {
        submitted: ['draft', 'withdrawn'],
        released: ['draft', 'submitted', 'withdrawn'],
        withdrawn: ['released'],
        draft: ['submitted', 'withdrawn', 'draft'],
      };
      if (dto.status && dto.status !== before.status && !from[dto.status]!.includes(before.status))
        throw new DomainError(
          'report_card.status',
          `A ${before.status} release cannot become ${dto.status}`,
          { status: 409 },
        );
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
        if (dto.status === 'released' && before.status !== 'released')
          sets.push('released_at = now()', 'released_by = app.current_user_id()');
        if (dto.status === 'submitted')
          sets.push('submitted_at = now()', 'submitted_by = app.current_user_id()');
        if (dto.status === 'withdrawn') {
          sets.push('withdrawn_at = now()', 'withdrawn_by = app.current_user_id()');
          add('withdrawn_reason', dto.reason!.trim());
        }
      }
      params.push(id);
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- fixed column assignments; values are bound
        `UPDATE report_card_releases SET ${sets.join(', ')} WHERE id = $${params.length}`,
        params,
      );
      if (r.rowCount === 0)
        throw new DomainError('not-found', 'Release not found', { status: 404 });
      // published: every class not open yet opens now and only its families are told; withdrawn:
      // every published class is revoked with the same reason (class by class: setClassStatus)
      if (dto.status === 'released') await this.openClasses(c, id, null);
      if (dto.status === 'withdrawn')
        await c.query(
          `UPDATE report_card_release_classes SET status = 'withdrawn', withdrawn_at = now(),
                  withdrawn_by = app.current_user_id(), withdrawn_reason = $2
            WHERE release_id = $1 AND status = 'released'`,
          [id, dto.reason!.trim()],
        );
      await this.audit.stage(ctx, c, {
        action: `exams.report_card.release_${dto.status ?? 'update'}`,
        entityType: 'report_card_releases',
        entityId: id,
        after: dto,
      });
      return (await this.findRelease(c, id))!;
    });
  }

  /**
   * One class of a release published to its families, or revoked with a reason (docs/design/65, 1 Nov
   * 2026). The first class published makes the release published; revoking the last one withdraws it.
   */
  async setClassStatus(
    ctx: RequestContext,
    releaseId: string,
    classId: string,
    dto: { status: 'released' | 'withdrawn'; reason?: string },
  ): Promise<ReleaseRow> {
    if (!ctx.permissions?.has('exams.result.publish'))
      throw new DomainError(
        'permission-denied',
        'Publishing and revoking results needs exams.result.publish (the principal)',
        { status: 403 },
      );
    const reason = dto.reason?.trim() ?? '';
    if (dto.status === 'withdrawn' && reason.length < 3)
      throw new DomainError('validation-failed', 'Give the reason for revoking the results', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.findRelease(c, releaseId);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const k = await c.query<{ code: string; status: string | null }>(
        `SELECT k.code, x.status
           FROM classes k LEFT JOIN report_card_release_classes x ON x.release_id = $1 AND x.class_id = k.id
          WHERE k.id = $2 AND EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.class_id = k.id AND ec.exam_id = ANY($3::bigint[]))`,
        [releaseId, classId, rel.examIds],
      );
      if (!k.rows[0])
        throw new DomainError('not-found', 'The release does not carry this class', {
          status: 404,
        });
      const now = k.rows[0].status;
      if (dto.status === 'released' && now === 'released')
        throw new DomainError('report_card.status', `${k.rows[0].code} is published already`, {
          status: 409,
        });
      if (dto.status === 'withdrawn' && now !== 'released')
        throw new DomainError('report_card.status', `${k.rows[0].code} is not published`, {
          status: 409,
        });
      if (dto.status === 'released') {
        await this.openClasses(c, releaseId, [classId]);
        if (rel.status !== 'released')
          await c.query(
            `UPDATE report_card_releases SET status = 'released', released_at = now(), released_by = app.current_user_id(), updated_at = now()
              WHERE id = $1`,
            [releaseId],
          );
      } else {
        await c.query(
          `UPDATE report_card_release_classes SET status = 'withdrawn', withdrawn_at = now(),
                  withdrawn_by = app.current_user_id(), withdrawn_reason = $3
            WHERE release_id = $1 AND class_id = $2`,
          [releaseId, classId, reason],
        );
        // the last class revoked: the release is withdrawn with that reason
        await c.query(
          `UPDATE report_card_releases SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = app.current_user_id(),
                  withdrawn_reason = $2, updated_at = now()
            WHERE id = $1 AND status = 'released'
              AND NOT EXISTS (SELECT 1 FROM report_card_release_classes x WHERE x.release_id = $1 AND x.status = 'released')`,
          [releaseId, reason],
        );
      }
      await this.audit.stage(ctx, c, {
        action: `exams.report_card.class_${dto.status}`,
        entityType: 'report_card_releases',
        entityId: releaseId,
        after: { classId, ...dto },
      });
      return (await this.findRelease(c, releaseId))!;
    });
  }

  /**
   * Opens the given classes of a release (every class it carries when null) that are not open yet, and
   * tells only those classes' families; the release and each class keep the count of messages queued.
   */
  private async openClasses(c: PoolClient, releaseId: string, classIds: string[] | null) {
    const opened = await c.query<{ class_id: string }>(
      `INSERT INTO report_card_release_classes (school_id, release_id, class_id, status, released_at, released_by)
       SELECT DISTINCT app.current_school_id(), r.id, ec.class_id, 'released', now(), app.current_user_id()
         FROM report_card_releases r JOIN exam_classes ec ON ec.exam_id = ANY(r.exam_ids)
        WHERE r.id = $1 AND ($2::bigint[] IS NULL OR ec.class_id = ANY($2::bigint[]))
       ON CONFLICT (release_id, class_id) DO UPDATE
          SET status = 'released', released_at = now(), released_by = app.current_user_id(),
              withdrawn_at = NULL, withdrawn_by = NULL, withdrawn_reason = NULL
        WHERE report_card_release_classes.status <> 'released'
       RETURNING class_id::text`,
      [releaseId, classIds],
    );
    const ids = opened.rows.map((x) => x.class_id);
    if (!ids.length) return;
    const told = await this.tellFamilies(c, releaseId, ids);
    for (const [classId, n] of told)
      await c.query(
        `UPDATE report_card_release_classes SET notified_count = notified_count + $3 WHERE release_id = $1 AND class_id = $2`,
        [releaseId, classId, n],
      );
    const total = [...told.values()].reduce((a, n) => a + n, 0);
    await c.query(
      `UPDATE report_card_releases SET notified_at = now(), notified_count = notified_count + $2 WHERE id = $1`,
      [releaseId, total],
    );
  }

  /**
   * A line of the Cards tab (the legacy Exam Report Card): a section or a whole class, the students with
   * the status chosen, then a range by position in roll order (taken in each section) or one admission
   * number. One student makes his own card; more make one PDF, a page each.
   */
  async generate(ctx: RequestContext, releaseId: string, dto: GenerateCardsDto) {
    const rel = await this.release(ctx, releaseId);
    const list = await this.cards(ctx, releaseId, dto);
    const one = dto.admissionNo?.toLowerCase();
    let picked: typeof list;
    if (one) picked = list.filter((x) => x.admissionNo.toLowerCase() === one);
    else {
      const [from, to] = {
        first10: [0, 10],
        '11-20': [10, 20],
        '21-30': [20, 30],
        '31-40': [30, 40],
        above40: [40, Infinity],
        '1-2': [0, 2],
        all: [0, Infinity],
      }[dto.range!];
      const bySection = new Map<string, typeof list>();
      for (const x of list) bySection.set(x.sectionId, [...(bySection.get(x.sectionId) ?? []), x]);
      picked = [...bySection.values()].flatMap((xs) => xs.slice(from, to));
    }
    if (!picked.length)
      throw new DomainError(
        'report_card.no_students',
        one
          ? `No student with admission number ${dto.admissionNo} in the class chosen`
          : 'No students in that range',
        { status: 409 },
      );
    const classId = picked[0]!.classId;
    await this.assertTemplateFor(ctx, rel, { classId });
    const place = dto.classId
      ? `${picked[0]!.section.split('-')[0]} (all sections)`
      : picked[0]!.section;
    const exp =
      one && picked.length === 1
        ? await this.reports.create(
            ctx,
            {
              dataset: 'report_card',
              format: 'pdf',
              params: { releaseId, studentId: picked[0]!.studentId },
              title: `Report card · ${rel.name} · ${place} · ${picked[0]!.admissionNo} ${picked[0]!.name}`,
            },
            'exams.report_card.render',
          )
        : await this.reports.create(
            ctx,
            {
              dataset: 'report_card_batch',
              format: 'pdf',
              params: { releaseId, classId, studentIds: picked.map((x) => x.studentId) },
              title: `Report cards · ${rel.name} · ${place} · ${RANGE_LABEL[dto.range ?? 'all']} (${String(picked.length)})`,
            },
            'exams.report_card.render_batch',
          );
    return { exportId: exp.id, status: exp.status, students: picked.length, title: exp.title };
  }

  /** The Download Log: the PDFs the school made for this release, newest first (not the families' own). */
  async exportsOf(ctx: RequestContext, releaseId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        id: string;
        title: string;
        status: string;
        error: string | null;
        requested_at: Date;
        finished_at: Date | null;
        by: string | null;
      }>(
        `SELECT e.id::text, e.title, e.status::text, e.error, e.requested_at, e.finished_at, u.display_name AS by
           FROM exports e LEFT JOIN users u ON u.id = e.requested_by
          WHERE e.dataset IN ('report_card', 'report_card_batch') AND e.params->>'releaseId' = $1
            AND NOT EXISTS (SELECT 1 FROM guardians g WHERE g.user_id = e.requested_by)
          ORDER BY e.requested_at DESC, e.id DESC
          LIMIT 100`,
        [releaseId],
      );
      return r.rows.map((x) => ({
        id: x.id,
        title: x.title,
        status: x.status,
        error: x.error,
        requestedAt: x.requested_at.toISOString(),
        finishedAt: x.finished_at?.toISOString() ?? null,
        by: x.by,
      }));
    });
  }

  /** Queues one PDF for a whole section (page break per pupil); the worker records each card. */
  async renderBatch(ctx: RequestContext, releaseId: string, dto: RenderBatchDto) {
    const rel = await this.release(ctx, releaseId);
    await this.assertTemplateFor(ctx, rel, { classSectionId: dto.classSectionId });
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

  /**
   * The families of the release's classes (guardians who take notifications), but not those whose card
   * is held, get the result message by SMS and e-mail. Returns the messages queued.
   */
  private async tellFamilies(
    c: PoolClient,
    releaseId: string,
    classIds: string[],
  ): Promise<Map<string, number>> {
    await c.query(`SELECT app.exam_seed_templates(app.current_school_id())`);
    const r = await c.query<{
      name: string;
      term: string;
      school: string;
      mobile: string | null;
      email: string | null;
      user_id: string | null;
      class_id: string;
    }>(
      `SELECT DISTINCT ON (s.id, g.id) s.display_name AS name, r.name AS term, cs.class_id::text,
              (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
              g.mobile, g.email::text AS email, g.user_id::text
         FROM report_card_releases r
         JOIN exam_classes ec ON ec.exam_id = ANY(r.exam_ids)
         JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
         JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
         JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
         JOIN student_guardians sg ON sg.student_id = s.id AND sg.receives_notifications
         JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
        WHERE r.id = $1 AND cs.class_id = ANY($2::bigint[])
          AND NOT EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = s.id)
        ORDER BY s.id, g.id`,
      [releaseId, classIds],
    );
    const n = new Map<string, number>();
    for (const x of r.rows) {
      const vars = JSON.stringify({ name: x.name, term: x.term, school: x.school });
      for (const [channel, to] of [
        ['sms', /^[6-9][0-9]{9}$/.test(x.mobile ?? '') ? x.mobile : null],
        ['email', x.email],
      ] as const) {
        if (!to) continue;
        const m = await c.query<{ id: string | null }>(
          `SELECT app.send_template('result_published', $1, $2, $3::jsonb, $4)::text AS id`,
          [channel, to, vars, x.user_id],
        );
        if (m.rows[0]?.id) n.set(x.class_id, (n.get(x.class_id) ?? 0) + 1);
      }
    }
    return n;
  }

  /** One student's card held back by the school (the old "Report Card Hide"), or shown again. */
  async setHold(
    ctx: RequestContext,
    releaseId: string,
    dto: { studentId: string; held: boolean; reason?: string },
  ) {
    if (dto.held && !(dto.reason && dto.reason.trim().length >= 3))
      throw new DomainError('validation-failed', 'Give the reason for holding the card', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.findRelease(c, releaseId);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      if (dto.held)
        await c.query(
          `INSERT INTO report_card_holds (school_id, release_id, student_id, reason, held_by)
           VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
           ON CONFLICT (release_id, student_id) DO UPDATE SET reason = EXCLUDED.reason, held_by = EXCLUDED.held_by, held_at = now()`,
          [releaseId, dto.studentId, dto.reason!.trim()],
        );
      else
        await c.query(`DELETE FROM report_card_holds WHERE release_id = $1 AND student_id = $2`, [
          releaseId,
          dto.studentId,
        ]);
      await this.audit.stage(ctx, c, {
        action: dto.held ? 'exams.report_card.hold' : 'exams.report_card.unhold',
        entityType: 'report_card_releases',
        entityId: releaseId,
        after: dto,
      });
      return (await this.findRelease(c, releaseId))!;
    });
  }

  /**
   * What a release still needs, class by class (docs/design/65; the workspace's Readiness and Cards):
   * the template each class prints with, its locked term result, and per section the students, the
   * PDFs made, the cards withheld for fees or held, the papers not verified (only subjects someone
   * takes) and the students without the remark or the attendance an exam takes.
   */
  async readiness(ctx: RequestContext, releaseId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.findRelease(c, releaseId);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const classes = await c.query<{
        id: string;
        code: string;
        name: string;
        band: string | null;
        display_order: number;
      }>(
        `SELECT DISTINCT k.id::text, k.code, k.name, k.band::text, k.display_order
           FROM exam_classes ec JOIN classes k ON k.id = ec.class_id
          WHERE ec.exam_id = ANY($1::bigint[]) AND k.deleted_at IS NULL
          ORDER BY k.display_order, k.code`,
        [rel.examIds],
      );
      const classIds = classes.rows.map((k) => k.id);
      const sections = await c.query<{
        id: string;
        class_id: string;
        code: string;
        students: number;
        made: number;
        withheld: number;
        held: number;
      }>(
        `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code,
                (SELECT count(*) FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active')::int AS students,
                (SELECT count(*) FROM report_cards rc JOIN enrolments en ON en.student_id = rc.student_id AND en.class_section_id = cs.id AND en.status = 'active'
                  WHERE rc.release_id = $1 AND rc.rendered_at IS NOT NULL)::int AS made,
                (SELECT count(*) FROM report_cards rc JOIN enrolments en ON en.student_id = rc.student_id AND en.class_section_id = cs.id AND en.status = 'active'
                  WHERE rc.release_id = $1 AND rc.withheld)::int AS withheld,
                (SELECT count(*) FROM report_card_holds h JOIN enrolments en ON en.student_id = h.student_id AND en.class_section_id = cs.id AND en.status = 'active'
                  WHERE h.release_id = $1)::int AS held
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.class_id = ANY($2::bigint[]) AND cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active')
          ORDER BY k.display_order, cs.name`,
        [releaseId, classIds],
      );
      // papers (section × subject) someone takes that are not verified yet
      const open = await c.query<{ section: string; exam: string; open: number; papers: number }>(
        `SELECT cs.id::text AS section, es.exam_id::text AS exam,
                count(*) FILTER (WHERE COALESCE(st.status, 'open') <> 'verified')::int AS open, count(*)::int AS papers
           FROM exam_subjects es
           JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL
           LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
          WHERE es.exam_id = ANY($1::bigint[])
            AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active'
                          AND app.student_exam_subject_kind(en.student_id, es.exam_id, es.subject_id) IS NOT NULL)
          GROUP BY 1, 2`,
        [rel.examIds],
      );
      // students without the remark or the attendance an exam takes
      const gaps = await c.query<{
        section: string;
        exam: string;
        remarks: number | null;
        attendance: number | null;
      }>(
        `SELECT cs.id::text AS section, e.id::text AS exam,
                CASE WHEN 'remarks' = ANY(e.areas) THEN count(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM exam_remarks r WHERE r.exam_id = e.id AND r.student_id = en.student_id AND btrim(coalesce(r.remark, '')) <> '')
                  AND NOT EXISTS (SELECT 1 FROM exam_remark_items ri WHERE ri.exam_id = e.id AND ri.student_id = en.student_id))::int END AS remarks,
                CASE WHEN 'attendance' = ANY(e.areas) THEN count(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM exam_attendance a WHERE a.exam_id = e.id AND a.student_id = en.student_id))::int END AS attendance
           FROM exams e JOIN exam_classes ec ON ec.exam_id = e.id
           JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL
           JOIN enrolments en ON en.class_section_id = cs.id AND en.status = 'active'
          WHERE e.id = ANY($1::bigint[])
          GROUP BY cs.id, e.id, e.areas`,
        [rel.examIds],
      );
      const schemes = await c.query<{
        id: string;
        name: string;
        class_ids: string[];
        computed_at: Date | null;
        results: number;
      }>(
        `SELECT m.id::text, m.name, m.class_ids::text[] AS class_ids, m.computed_at,
                (SELECT count(*) FROM term_results t WHERE t.scheme_id = m.id)::int AS results
           FROM mark_schemes m
          WHERE m.academic_year_id = app.current_academic_year_id() AND m.purpose = 'result' AND m.status = 'locked'
            AND m.deleted_at IS NULL AND m.term_code = $1`,
        [rel.termCode],
      );
      const templates = await c.query<{ id: string; name: string; band: string }>(
        `SELECT id::text, name, band::text FROM report_card_templates WHERE status = 'active' AND deleted_at IS NULL ORDER BY name`,
      );
      const published = await c.query<{
        class_id: string;
        status: 'released' | 'withdrawn';
        released_at: Date | null;
        withdrawn_at: Date | null;
        withdrawn_reason: string | null;
        notified_count: number;
      }>(
        `SELECT class_id::text, status, released_at, withdrawn_at, withdrawn_reason, notified_count
           FROM report_card_release_classes WHERE release_id = $1`,
        [releaseId],
      );
      const exams = rel.exams;
      return {
        release: rel,
        templates: templates.rows,
        classes: classes.rows.map((k) => {
          const band = bandFor(k.band, k.display_order);
          const own = rel.templates[`class_${k.id}`];
          const chosen = own ?? rel.templates[band];
          const t = chosen
            ? templates.rows.find((x) => x.id === chosen)
            : templates.rows.find((x) => x.band === band);
          const scheme = schemes.rows.find((m) => m.class_ids.includes(k.id));
          const secs = sections.rows.filter((x) => x.class_id === k.id);
          const pub = published.rows.find((x) => x.class_id === k.id);
          return {
            classId: k.id,
            code: k.code,
            name: k.name,
            band,
            /** published to the class's families, or revoked (null: never published) */
            publish: pub
              ? {
                  status: pub.status,
                  releasedAt: pub.released_at?.toISOString() ?? null,
                  withdrawnAt: pub.withdrawn_at?.toISOString() ?? null,
                  reason: pub.withdrawn_reason,
                  notified: pub.notified_count,
                }
              : null,
            template: t
              ? { id: t.id, name: t.name, from: own ? 'class' : chosen ? 'band' : 'default' }
              : null,
            termResult: scheme
              ? {
                  schemeId: scheme.id,
                  name: scheme.name,
                  computedAt: scheme.computed_at?.toISOString() ?? null,
                  results: scheme.results,
                }
              : null,
            sections: secs.map((x) => ({
              id: x.id,
              code: x.code,
              students: x.students,
              made: x.made,
              withheld: x.withheld,
              held: x.held,
              unverified: open.rows
                .filter((o) => o.section === x.id)
                .reduce((a, o) => a + o.open, 0),
              remarksMissing: gaps.rows
                .filter((g) => g.section === x.id)
                .reduce((a, g) => a + (g.remarks ?? 0), 0),
              attendanceMissing: gaps.rows
                .filter((g) => g.section === x.id)
                .reduce((a, g) => a + (g.attendance ?? 0), 0),
            })),
            exams: exams.map((e) => {
              const mine = (rows: Array<{ section: string; exam: string }>) =>
                rows.filter((r) => r.exam === e.id && secs.some((x) => x.id === r.section));
              const g = mine(gaps.rows) as typeof gaps.rows;
              return {
                examId: e.id,
                code: e.code,
                name: e.name,
                unverified: (mine(open.rows) as typeof open.rows).reduce((a, o) => a + o.open, 0),
                papers: (mine(open.rows) as typeof open.rows).reduce((a, o) => a + o.papers, 0),
                remarksMissing: g.some((x) => x.remarks !== null)
                  ? g.reduce((a, x) => a + (x.remarks ?? 0), 0)
                  : null,
                attendanceMissing: g.some((x) => x.attendance !== null)
                  ? g.reduce((a, x) => a + (x.attendance ?? 0), 0)
                  : null,
              };
            }),
          };
        }),
      };
    });
  }

  /**
   * Per-pupil status of a release for a section or a whole class (rendered, withheld, held, export id),
   * section by section in roll order; status picks the active pupils, the inactive (left, transferred)
   * or all of the year's.
   */
  async cards(
    ctx: RequestContext,
    releaseId: string,
    q: { classSectionId?: string; classId?: string; status?: 'active' | 'inactive' | 'all' },
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                cs.id::text AS section_id, cs.class_id::text AS class_id, k.code || '-' || cs.name AS section,
                e.status::text AS enrolment_status,
                rc.export_id::text, rc.withheld, rc.withheld_reason, rc.rendered_at, x.status AS export_status,
                h.reason AS held_reason
           FROM enrolments e
           JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
           JOIN classes k ON k.id = cs.class_id
           JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
           LEFT JOIN report_cards rc ON rc.release_id = $1 AND rc.student_id = s.id
           LEFT JOIN report_card_holds h ON h.release_id = $1 AND h.student_id = s.id
           LEFT JOIN exports x ON x.id = rc.export_id
          WHERE ($2::bigint IS NULL OR e.class_section_id = $2::bigint)
            AND ($3::bigint IS NULL OR cs.class_id = $3::bigint)
            AND e.academic_year_id = app.current_academic_year_id()
            AND ($4 = 'all' OR ($4 = 'active') = (e.status = 'active'))
          ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
        [releaseId, q.classSectionId ?? null, q.classId ?? null, q.status ?? 'active'],
      );
      return r.rows.map((x) => ({
        studentId: String(x.student_id),
        name: String(x.name),
        admissionNo: String(x.admission_no),
        rollNo: (x.roll_no as number | null) ?? null,
        sectionId: String(x.section_id),
        classId: String(x.class_id),
        section: String(x.section),
        active: x.enrolment_status === 'active',
        exportId: (x.export_id as string | null) ?? null,
        exportStatus: (x.export_status as string | null) ?? null,
        withheld: Boolean(x.withheld),
        withheldReason: (x.withheld_reason as string | null) ?? null,
        renderedAt: x.rendered_at ? new Date(x.rendered_at as string).toISOString() : null,
        /** held back by the school for this student (docs/design/65) */
        heldReason: (x.held_reason as string | null) ?? null,
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
                  rc.withheld, rc.export_id::text,
                  EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = $1) AS held
             FROM report_card_releases r
             LEFT JOIN report_cards rc ON rc.release_id = r.id AND rc.student_id = $1
            WHERE r.academic_year_id = app.current_academic_year_id() AND r.status = 'released'
              -- published class by class: the child's class must be open (docs/design/65, 1 Nov)
              AND EXISTS (SELECT 1 FROM report_card_release_classes rcl
                      JOIN class_sections ocs ON ocs.class_id = rcl.class_id AND ocs.academic_year_id = r.academic_year_id
                      JOIN enrolments oen ON oen.class_section_id = ocs.id AND oen.student_id = $1 AND oen.status = 'active'
                     WHERE rcl.release_id = r.id AND rcl.status = 'released')
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
            exams: r.held ? [] : ((r.exams as unknown[]) ?? []),
            withheld: Boolean(r.withheld) || Boolean(r.held),
            /** held back by the school: the office tells the family why (docs/design/65) */
            held: Boolean(r.held),
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
      const open = await c.query(
        `SELECT 1 FROM report_card_releases r WHERE r.id = $2 AND EXISTS (SELECT 1 FROM report_card_release_classes rcl
           JOIN class_sections ocs ON ocs.class_id = rcl.class_id AND ocs.academic_year_id = r.academic_year_id
           JOIN enrolments oen ON oen.class_section_id = ocs.id AND oen.student_id = $1 AND oen.status = 'active'
          WHERE rcl.release_id = r.id AND rcl.status = 'released')`,
        [studentId, releaseId],
      );
      if (!open.rowCount)
        throw new DomainError('not-found', 'Report card not found', { status: 404 });
      const held = await c.query(
        `SELECT 1 FROM report_card_holds WHERE release_id = $1 AND student_id = $2`,
        [releaseId, studentId],
      );
      if (held.rowCount)
        throw new DomainError(
          'report_card.held',
          'The school has held this report card: please contact the class teacher or the office',
          { status: 409 },
        );
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
    place: { classSectionId?: string; classId?: string },
  ): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await c.query<{ band: string | null; display_order: number; class_id: string }>(
        `SELECT k.band::text, k.display_order, k.id::text AS class_id FROM classes k
          WHERE k.id = COALESCE($2::bigint, (SELECT cs.class_id FROM class_sections cs WHERE cs.id = $1::bigint))`,
        [place.classSectionId ?? null, place.classId ?? null],
      );
      if (!k.rows[0]) throw new DomainError('not-found', 'Section not found', { status: 404 });
      const band = bandFor(k.rows[0].band, k.rows[0].display_order);
      // the class's own template first (docs/design/65), then the band's
      const chosen = rel.templates[`class_${k.rows[0].class_id}`] ?? rel.templates[band];
      const t = chosen
        ? await c.query(
            `SELECT 1 FROM report_card_templates WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
            [chosen],
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
