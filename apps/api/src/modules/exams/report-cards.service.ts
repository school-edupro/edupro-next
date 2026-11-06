import { Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import {
  bandFor,
  loadReportCardData,
  reportCardDocument,
  sampleReportCardData,
  DEFAULT_LAYOUTS,
  READY_MADE_TEMPLATES,
  HPC_TEMPLATES,
  HPC_V1_LAYOUT,
  LEARNING_RECORD_KEY,
  LEARNING_RECORD_REMARKS,
  LEARNING_RECORD_SET,
  LR_ART_SLOTS,
  TEST_SLIP_TEMPLATES,
  learningRecordRows,
  type ClassBand,
  type LrArt,
  type ReportCardData,
} from '@edupro/db';
import { ENV, type Env } from '../../config/env';
import { AuditService } from '../../common/audit/audit.service';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { tablePdf } from '../engagement/table-pdf';
import { ReportsService } from '../reports/reports.service';
import { cardExportInSight, cardScopeOf, type CardScope } from './card-scope';
import { ReportCardSignaturesService } from './report-card-signatures.service';
import type {
  BulkHoldDto,
  CreateReleaseDto,
  CreateTemplateDto,
  GenerateCardsDto,
  HoldsFileDto,
  HoldsQueryDto,
  HoldsUploadDto,
  PreviewDto,
  RenderBatchDto,
  TemplateArtDto,
  TellDto,
  UpdateReleaseDto,
  UpdateTemplateDto,
} from './report-cards.dto';

/** a day as the school writes it (05 Nov 2026), in India's time */
const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

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
  /** docs/design/73: the design's pictures, slot → file id */
  assets: Record<string, string>;
}

export interface ReleaseRow {
  id: string;
  /** the release's working year (sent with its PDF jobs: a job has no year of its own) */
  academicYearId: string;
  /** exam card (PT1, PT2 …), term card or annual card (1 Nov 2026) */
  kind: 'exam' | 'term' | 'annual';
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

const T_COLS = `id::text, code, name, band::text, layout, body_html, styles_css, page_width, page_height, version, status::text, updated_at, assets`;
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
  assets: (r.assets as Record<string, string> | null) ?? {},
});

/**
 * The release columns. $2 (sections) and $3 (classes) narrow the counts to the classes a person sees
 * on Report cards (CardScope: cards and holds of the students in those sections); null counts all.
 */
const R_COLS = `r.id::text, r.academic_year_id::text AS academic_year_id, r.kind, r.term_code, r.name, r.exam_ids::text[] AS exam_ids, r.templates, r.hide_defaulters, r.defaulter_min::text, r.status, r.released_at, r.created_at,
  (SELECT jsonb_agg(jsonb_build_object('id', e.id::text, 'code', e.code, 'name', e.name) ORDER BY array_position(r.exam_ids, e.id)) FROM exams e WHERE e.id = ANY(r.exam_ids)) AS exams,
  (SELECT count(*) FROM report_cards c WHERE c.release_id = r.id AND c.rendered_at IS NOT NULL AND ($2::bigint[] IS NULL OR EXISTS (SELECT 1 FROM enrolments en WHERE en.student_id = c.student_id
       AND en.academic_year_id = r.academic_year_id AND en.status = 'active' AND en.class_section_id = ANY($2::bigint[]))))::int AS rendered,
  (SELECT count(*) FROM report_cards c WHERE c.release_id = r.id AND c.withheld AND ($2::bigint[] IS NULL OR EXISTS (SELECT 1 FROM enrolments en WHERE en.student_id = c.student_id
       AND en.academic_year_id = r.academic_year_id AND en.status = 'active' AND en.class_section_id = ANY($2::bigint[]))))::int AS withheld,
  r.submitted_at, r.withdrawn_reason, r.notified_count,
  (SELECT count(*) FROM report_card_holds h WHERE h.release_id = r.id AND ($2::bigint[] IS NULL OR EXISTS (SELECT 1 FROM enrolments en WHERE en.student_id = h.student_id
       AND en.academic_year_id = r.academic_year_id AND en.status = 'active' AND en.class_section_id = ANY($2::bigint[]))))::int AS held,
  (SELECT count(*) FROM exam_subjects es
     JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL AND cs.status = 'active'
     LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
    WHERE es.exam_id = ANY(r.exam_ids) AND COALESCE(st.status, 'open') <> 'verified'
      AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
      AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active'
                    AND app.student_exam_subject_kind(en.student_id, es.exam_id, es.subject_id) IS NOT NULL))::int AS unverified,
  (SELECT count(DISTINCT ec.class_id) FROM exam_classes ec WHERE ec.exam_id = ANY(r.exam_ids)
      AND ($3::bigint[] IS NULL OR ec.class_id = ANY($3::bigint[])))::int AS class_count,
  (SELECT count(*) FROM report_card_release_classes x WHERE x.release_id = r.id AND x.status = 'released'
      AND ($3::bigint[] IS NULL OR x.class_id = ANY($3::bigint[])))::int AS published_classes`;
const toRelease = (r: Record<string, unknown>): ReleaseRow => ({
  id: String(r.id),
  academicYearId: String(r.academic_year_id),
  kind: (r.kind as ReleaseRow['kind']) ?? 'term',
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
    @Inject(ENV) private readonly env: Env,
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
   * The ready-made cards (docs/design/65, part 4) or the HPC (part 5) as templates; one the school
   * already has stays.
   */
  async installReadyMade(
    ctx: RequestContext,
    which: 'ready_made' | 'hpc' = 'ready_made',
  ): Promise<TemplateRow[]> {
    const list = which === 'hpc' ? HPC_TEMPLATES : READY_MADE_TEMPLATES;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const t of list)
        await c.query(
          `INSERT INTO report_card_templates (school_id, code, name, band, layout)
           VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb)
           ON CONFLICT (school_id, code) DO NOTHING`,
          [t.code, t.name, t.band, JSON.stringify(t.layout)],
        );
      if (which === 'hpc') await this.installLearningRecord(c);
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

  /**
   * docs/design/73: the Holistic progress card as the A4 learning record — a copy still on the first
   * layout takes the new one (a changed copy stays, the new one beside it as "… v2"); the ready-made
   * Learning record (I–II) set, the areas it uses, its key's grade scale and the subjects' remark
   * categories, each only when the school has none.
   */
  private async installLearningRecord(c: PoolClient) {
    const t = HPC_TEMPLATES[0]!;
    const up = await c.query(
      `UPDATE report_card_templates SET layout = $2::jsonb, version = version + 1, updated_at = now()
        WHERE code = $1 AND deleted_at IS NULL AND layout = $3::jsonb`,
      [t.code, JSON.stringify(t.layout), JSON.stringify(HPC_V1_LAYOUT)],
    );
    if (!up.rowCount)
      await c.query(
        `INSERT INTO report_card_templates (school_id, code, name, band, layout)
         SELECT app.current_school_id(), $1, $2, $3::class_band, $4::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM report_card_templates WHERE code = $5 AND layout = $4::jsonb AND deleted_at IS NULL)
         ON CONFLICT (school_id, code) DO NOTHING`,
        [`${t.code}_v2`, `${t.name} v2`, t.band, JSON.stringify(t.layout), t.code],
      );
    // the areas, after the school's own, in the card's order
    const set = LEARNING_RECORD_SET;
    for (const a of set.areas)
      await c.query(
        `INSERT INTO indicator_areas (school_id, name, sort_order)
         SELECT app.current_school_id(), $1::text, COALESCE((SELECT max(sort_order) FROM indicator_areas), 0) + 10
          WHERE NOT EXISTS (SELECT 1 FROM indicator_areas WHERE lower(name) = lower($1::text))`,
        [a.area],
      );
    const have = await c.query(
      `SELECT 1 FROM indicator_sets WHERE code = $1 AND deleted_at IS NULL`,
      [set.code],
    );
    if (!have.rowCount) {
      const setId = (
        await c.query<{ id: string }>(
          `INSERT INTO indicator_sets (school_id, code, name, grades, kind, level_words, status, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::text[], 'hpc', $4::jsonb, 'active', app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [set.code, set.name, set.grades, JSON.stringify(set.levelWords)],
        )
      ).rows[0]!.id;
      const ids = new Map<string, string>();
      for (const r of learningRecordRows()) {
        const id = (
          await c.query<{ id: string }>(
            `INSERT INTO indicators (school_id, set_id, code, name, area, sort_order, parent_id, kind)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'level') RETURNING id::text`,
            [
              setId,
              r.code,
              r.name,
              r.area,
              r.sortOrder,
              r.parentCode ? ids.get(r.parentCode)! : null,
            ],
          )
        ).rows[0]!.id;
        ids.set(r.code, id);
      }
    }
    const key = LEARNING_RECORD_KEY;
    const scale = await c.query(
      `SELECT 1 FROM grade_scales WHERE code = $1 AND deleted_at IS NULL`,
      [key.code],
    );
    if (!scale.rowCount) {
      const scaleId = (
        await c.query<{ id: string }>(
          `INSERT INTO grade_scales (school_id, code, name, description, status)
           VALUES (app.current_school_id(), $1, $2, 'The evaluation key of the Learning record (I–II)', 'active')
           RETURNING id::text`,
          [key.code, key.name],
        )
      ).rows[0]!.id;
      for (const [i, b] of key.bands.entries())
        await c.query(
          `INSERT INTO grade_bands (school_id, scale_id, min_pct, max_pct, grade, remark, sort_order)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
          [scaleId, b.minPct, b.maxPct, b.grade, b.remark, i],
        );
    }
    // the subjects' remark categories (Balvatika to II), when the subject has none
    const early = (
      await c.query<{ id: string }>(
        `SELECT id::text FROM classes
          WHERE deleted_at IS NULL AND (band::text = 'pre_primary' OR upper(code) IN ('I', 'II', '1', '2'))`,
      )
    ).rows.map((x) => x.id);
    for (const [i, r] of LEARNING_RECORD_REMARKS.entries()) {
      const sub = await c.query<{ id: string }>(
        `SELECT id::text FROM subjects WHERE deleted_at IS NULL AND (upper(code) = ANY($1::text[]) OR lower(name) = ANY($2::text[]))
          ORDER BY (upper(code) = ANY($1::text[])) DESC, id LIMIT 1`,
        [r.subjects.map((x) => x.toUpperCase()), r.subjects.map((x) => x.toLowerCase())],
      );
      const subjectId = sub.rows[0]?.id ?? null;
      const exists = await c.query(
        `SELECT 1 FROM remark_categories WHERE code = $1 OR ($2::bigint IS NOT NULL AND subject_id = $2::bigint)`,
        [r.code, subjectId],
      );
      if (exists.rowCount) continue;
      await c.query(
        `INSERT INTO remark_categories (school_id, code, name, subject_id, class_ids, free_text, sort_order, status, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::bigint[], true, $5, 'active', app.current_user_id())`,
        [r.code, r.name, subjectId, early, 200 + i * 10],
      );
    }
  }

  /** docs/design/73: a design's pictures as data URIs, and the school's logo on the card. */
  private async pictures(
    c: PoolClient,
    t: Pick<TemplateRow, 'assets'>,
    data: ReportCardData,
  ): Promise<LrArt> {
    const art: LrArt = {};
    const slots = Object.entries(t.assets ?? {}).filter(([k]) =>
      (LR_ART_SLOTS as readonly string[]).includes(k),
    );
    if (slots.length) {
      const files = await c.query<{ id: string; object_key: string; content_type: string }>(
        `SELECT id::text, object_key, content_type FROM files WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
        [slots.map(([, id]) => id)],
      );
      const list = slots.map(([slot, id]) => {
        const f = files.rows.find((x) => x.id === id);
        return {
          slot,
          objectKey: f?.object_key ?? null,
          contentType: f?.content_type ?? null,
          dataUri: null as string | null,
        };
      });
      await this.signatures.fill(list);
      for (const x of list) art[x.slot as keyof LrArt] = x.dataUri;
    }
    if (!data.school.logoObjectKey) {
      const logo = await c.query<{ object_key: string; content_type: string }>(
        `SELECT f.object_key, f.content_type FROM schools s JOIN files f ON f.id::text = NULLIF(s.branding->>'logoFileId', '') AND f.deleted_at IS NULL
          WHERE s.id = app.current_school_id()`,
      );
      data.school.logoObjectKey = logo.rows[0]?.object_key ?? null;
      data.school.logoContentType = logo.rows[0]?.content_type ?? null;
    }
    const logo = {
      objectKey: data.school.logoObjectKey ?? null,
      contentType: data.school.logoContentType ?? null,
      dataUri: null as string | null,
    };
    await this.signatures.fill([logo]);
    data.school.logoDataUri = logo.dataUri;
    return art;
  }

  /** docs/design/73: a picture of a card design, set, shown or taken out (slot: cover_art, logo_2 …). */
  async setArt(ctx: RequestContext, id: string, slot: string, dto: TemplateArtDto) {
    if (!(LR_ART_SLOTS as readonly string[]).includes(slot))
      throw new DomainError('validation-failed', 'Not a picture of the card', { status: 400 });
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const t = await this.findTemplate(c, id);
      if (!t) throw new DomainError('not-found', 'Template not found', { status: 404 });
      const fileId = await this.signatures.storeImage(c, tenant.schoolId, dto, {
        maxBytes: 1_000_000,
        prefix: 'card-art',
        owner: 'report_card_template',
      });
      await c.query(
        `UPDATE report_card_templates SET assets = assets || jsonb_build_object($2::text, $3::text), updated_at = now() WHERE id = $1`,
        [id, slot, fileId],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.template_art',
        entityType: 'report_card_templates',
        entityId: id,
        after: { slot, fileId },
      });
      return (await this.findTemplate(c, id))!;
    });
  }

  async removeArt(ctx: RequestContext, id: string, slot: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.findTemplate(c, id);
      if (!t) throw new DomainError('not-found', 'Template not found', { status: 404 });
      await c.query(
        `UPDATE report_card_templates SET assets = assets - $2::text, updated_at = now() WHERE id = $1`,
        [id, slot],
      );
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.template_art_removed',
        entityType: 'report_card_templates',
        entityId: id,
        after: { slot },
      });
      return (await this.findTemplate(c, id))!;
    });
  }

  async artImage(ctx: RequestContext, id: string, slot: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.findTemplate(c, id);
      const fileId = t?.assets[slot];
      const img = fileId ? await this.signatures.fileImage(c, fileId) : null;
      if (!img) throw new DomainError('not-found', 'No picture', { status: 404 });
      return {
        filename: `${slot}.${img.contentType === 'image/png' ? 'png' : 'jpg'}`,
        ...img,
      };
    });
  }

  /** The periodic-test slips installed when missing (one the school changed stays); band → template id. */
  private async testSlips(c: PoolClient): Promise<Map<string, string>> {
    for (const t of TEST_SLIP_TEMPLATES)
      await c.query(
        `INSERT INTO report_card_templates (school_id, code, name, band, layout)
         VALUES (app.current_school_id(), $1, $2, $3::class_band, $4::jsonb)
         ON CONFLICT (school_id, code) DO NOTHING`,
        [t.code, t.name, t.band, JSON.stringify(t.layout)],
      );
    const r = await c.query<{ id: string; band: string }>(
      `SELECT id::text, band::text FROM report_card_templates
        WHERE code = ANY($1::text[]) AND status = 'active' AND deleted_at IS NULL`,
      [TEST_SLIP_TEMPLATES.map((t) => t.code)],
    );
    return new Map(r.rows.map((x) => [x.band, x.id]));
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
        const art = await this.pictures(c, t, data);
        return { html: reportCardDocument({ ...like, art }, [{ data }]) };
      }
      const sample = sampleReportCardData(dto.band ?? t.band);
      const art = await this.pictures(c, t, sample);
      return { html: reportCardDocument({ ...like, art }, [{ data: sample }]) };
    });
  }

  // ---- releases ----------------------------------------------------------------------------------
  /** The year's cards that carry a class the person sees, counted for those classes only. */
  async releases(ctx: RequestContext): Promise<ReleaseRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) =>
      this.releaseRows(c, null, await cardScopeOf(c, ctx)),
    );
  }

  async release(ctx: RequestContext, id: string): Promise<ReleaseRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.findRelease(c, id, await cardScopeOf(c, ctx));
      if (!row) throw new DomainError('not-found', 'Release not found', { status: 404 });
      return row;
    });
  }

  /** The classes and sections the person sees on Report cards, with their codes (the page's hint). */
  async myScope(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      if (scope.all) return { all: true, classes: [], sections: [] };
      const r = await c.query<{ id: string; class_id: string; code: string }>(
        `SELECT cs.id::text, cs.class_id::text, k.code || '-' || cs.name AS code
           FROM class_sections cs JOIN classes k ON k.id = cs.class_id
          WHERE cs.id = ANY($1::bigint[]) ORDER BY k.display_order, cs.name`,
        [scope.sections],
      );
      return {
        all: false,
        classes: scope.classes,
        sections: r.rows.map((x) => ({ id: x.id, classId: x.class_id, code: x.code })),
      };
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
      // an exam card prints the periodic-test slip of each band unless a design is chosen
      const templates = { ...dto.templates };
      if (dto.kind === 'exam')
        for (const [band, id] of await this.testSlips(c))
          if (!templates[band]) templates[band] = id;
      const r = await c
        .query<{ id: string }>(
          `INSERT INTO report_card_releases (school_id, academic_year_id, kind, term_code, name, exam_ids, templates, hide_defaulters, defaulter_min, created_by)
         VALUES (app.current_school_id(), app.current_academic_year_id(), $7, $1, $2, $3::bigint[], $4::jsonb, $5, $6, app.current_user_id()) RETURNING id::text`,
          [
            dto.termCode,
            dto.name,
            dto.examIds,
            JSON.stringify(templates),
            dto.hideDefaulters,
            dto.defaulterMin,
            dto.kind,
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
      const scope = await cardScopeOf(c, ctx);
      const before = await this.findRelease(c, id, scope);
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
      return (await this.findRelease(c, id, scope))!;
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
   * Opens the given classes of a release (every class it carries when null) that are not open yet. No
   * message goes (docs/design/82, 6 Nov 2026): the principal tells the families afterwards (`tell`).
   */
  private async openClasses(c: PoolClient, releaseId: string, classIds: string[] | null) {
    await c.query(
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
  }

  /**
   * A line of the Cards tab (the legacy Exam Report Card): a section or a whole class, the students with
   * the status chosen, then a range by position in roll order (taken in each section) or one admission
   * number. One student makes his own card; more make one PDF, a page each.
   */
  async generate(ctx: RequestContext, releaseId: string, dto: GenerateCardsDto) {
    // release() and cards() keep to the person's classes; a class teacher prints their own section
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
    // the classes were checked above: a class teacher (who may only view) prints their own section
    const exp =
      one && picked.length === 1
        ? await this.reports.createRenderedForOwner(
            ctx,
            {
              dataset: 'report_card',
              format: 'pdf',
              params: {
                releaseId,
                studentId: picked[0]!.studentId,
                academicYearId: rel.academicYearId,
              },
              title: `Report card · ${rel.name} · ${place} · ${picked[0]!.admissionNo} ${picked[0]!.name}`,
            },
            'exams.report_card.render',
          )
        : await this.reports.createRenderedForOwner(
            ctx,
            {
              dataset: 'report_card_batch',
              format: 'pdf',
              params: {
                releaseId,
                classId,
                studentIds: picked.map((x) => x.studentId),
                academicYearId: rel.academicYearId,
              },
              title: `Report cards · ${rel.name} · ${place} · ${RANGE_LABEL[dto.range ?? 'all']} (${String(picked.length)})`,
            },
            'exams.report_card.render_batch',
          );
    return { exportId: exp.id, status: exp.status, students: picked.length, title: exp.title };
  }

  /**
   * The cards of one class (the Report cards list's class view, 1 Nov 2026): every release of the year
   * that carries the class, with the class's publishing, students, PDFs made, holds and the papers not
   * verified yet; newest first.
   */
  async classCards(ctx: RequestContext, classId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      if (!scope.all && !scope.classes.includes(classId)) throw this.outOfSight();
      const r = await c.query<{
        id: string;
        kind: ReleaseRow['kind'];
        term_code: string;
        name: string;
        status: ReleaseRow['status'];
        publish: 'released' | 'withdrawn' | null;
        released_at: Date | null;
        withdrawn_at: Date | null;
        withdrawn_reason: string | null;
        notified: number | null;
        students: number;
        made: number;
        held: number;
        unverified: number;
      }>(
        `SELECT r.id::text, r.kind, r.term_code, r.name, r.status, x.status AS publish, x.released_at, x.withdrawn_at,
                x.withdrawn_reason, x.notified_count AS notified,
                (SELECT count(*) FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id
                  WHERE cs.class_id = $1 AND en.status = 'active' AND en.academic_year_id = r.academic_year_id
                    AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[])))::int AS students,
                (SELECT count(*) FROM report_cards rc JOIN enrolments en ON en.student_id = rc.student_id AND en.status = 'active' AND en.academic_year_id = r.academic_year_id
                   JOIN class_sections cs ON cs.id = en.class_section_id AND cs.class_id = $1
                  WHERE rc.release_id = r.id AND rc.rendered_at IS NOT NULL AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[])))::int AS made,
                (SELECT count(*) FROM report_card_holds h JOIN enrolments en ON en.student_id = h.student_id AND en.status = 'active' AND en.academic_year_id = r.academic_year_id
                   JOIN class_sections cs ON cs.id = en.class_section_id AND cs.class_id = $1
                  WHERE h.release_id = r.id AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[])))::int AS held,
                (SELECT count(*) FROM exam_subjects es
                   JOIN class_sections cs ON cs.class_id = es.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
                   LEFT JOIN exam_entry_status st ON st.exam_subject_id = es.id AND st.class_section_id = cs.id
                  WHERE es.exam_id = ANY(r.exam_ids) AND es.class_id = $1 AND COALESCE(st.status, 'open') <> 'verified'
                    AND ($2::bigint[] IS NULL OR cs.id = ANY($2::bigint[]))
                    AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active'
                                  AND app.student_exam_subject_kind(en.student_id, es.exam_id, es.subject_id) IS NOT NULL))::int AS unverified
           FROM report_card_releases r
           LEFT JOIN report_card_release_classes x ON x.release_id = r.id AND x.class_id = $1
          WHERE r.academic_year_id = app.current_academic_year_id()
            AND EXISTS (SELECT 1 FROM exam_classes ec WHERE ec.class_id = $1 AND ec.exam_id = ANY(r.exam_ids))
          ORDER BY r.created_at DESC, r.id DESC`,
        [classId, scope.all ? null : scope.sections],
      );
      return r.rows.map((x) => ({
        releaseId: x.id,
        kind: x.kind,
        termCode: x.term_code,
        name: x.name,
        status: x.status,
        publish: x.publish
          ? {
              status: x.publish,
              releasedAt: x.released_at?.toISOString() ?? null,
              withdrawnAt: x.withdrawn_at?.toISOString() ?? null,
              reason: x.withdrawn_reason,
              notified: x.notified ?? 0,
            }
          : null,
        students: x.students,
        made: x.made,
        held: x.held,
        unverified: x.unverified,
      }));
    });
  }

  /**
   * The Download Log: the PDFs the school made for this release, newest first (not the families' own).
   * A person who sees some classes gets the PDFs they made and those whose every pupil is theirs.
   */
  async exportsOf(ctx: RequestContext, releaseId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      if (!(await this.findRelease(c, releaseId, scope)))
        throw new DomainError('not-found', 'Release not found', { status: 404 });
      const r = await c.query<{
        id: string;
        title: string;
        status: string;
        error: string | null;
        requested_at: Date;
        finished_at: Date | null;
        by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- cardExportInSight is a fixed fragment around a bind placeholder
        `SELECT e.id::text, e.title, e.status::text, e.error, e.requested_at, e.finished_at, u.display_name AS by
           FROM exports e LEFT JOIN users u ON u.id = e.requested_by
          WHERE e.dataset IN ('report_card', 'report_card_batch') AND e.params->>'releaseId' = $1
            AND NOT EXISTS (SELECT 1 FROM guardians g WHERE g.user_id = e.requested_by)
            AND (e.requested_by = app.current_user_id() OR ${cardExportInSight('$2')})
          ORDER BY e.requested_at DESC, e.id DESC
          LIMIT 100`,
        [releaseId, scope.all ? null : scope.sections],
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
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      if (!scope.all && !scope.sections.includes(dto.classSectionId)) throw this.outOfSight();
    });
    await this.assertTemplateFor(ctx, rel, { classSectionId: dto.classSectionId });
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'report_card_batch',
        format: 'pdf',
        params: {
          releaseId,
          classSectionId: dto.classSectionId,
          academicYearId: rel.academicYearId,
        },
        title: `Report cards · ${rel.name}`,
      },
      'exams.report_card.render_batch',
    );
    return { exportId: exp.id, status: exp.status };
  }

  async renderOne(ctx: RequestContext, releaseId: string, studentId: string) {
    const rel = await this.release(ctx, releaseId);
    await this.db.tenant(requireTenant(ctx), async (c) =>
      this.assertStudentInSight(c, await cardScopeOf(c, ctx), studentId),
    );
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'report_card',
        format: 'pdf',
        params: { releaseId, studentId, academicYearId: rel.academicYearId },
        title: `Report card · ${rel.name}`,
      },
      'exams.report_card.render',
    );
    return { exportId: exp.id, status: exp.status };
  }

  /**
   * The words of the families' message (docs/design/81), the same for the messages and the preview: the
   * pupil's name and class ("I-A"), the release's exams ("Periodic Test 1 and Half Yearly"), the school,
   * the parent app's Results, and the release's name as {{term}} (the old word, kept).
   */
  private async messageWords(c: PoolClient, releaseId: string) {
    const r = await c.query<{ term: string; school: string; exams: string[] }>(
      `SELECT r.name AS term, (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
              COALESCE((SELECT array_agg(e.name ORDER BY array_position(r.exam_ids, e.id)) FROM exams e
                         WHERE e.id = ANY(r.exam_ids)), '{}') AS exams
         FROM report_card_releases r WHERE r.id = $1`,
      [releaseId],
    );
    const x = r.rows[0];
    const names = x?.exams ?? [];
    const exam =
      names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`
        : (names[0] ?? x?.term ?? '');
    const link = `${this.env.PARENT_APP_URL.replace(/\/+$/, '')}/results`;
    return (pupil: { name: string; class: string }): Record<string, string> => ({
      name: pupil.name,
      class: pupil.class,
      exam,
      school: x?.school ?? '',
      link,
      term: x?.term ?? '',
    });
  }

  /**
   * docs/design/81: the families' message of a release as it goes out — e-mail and SMS, each with its
   * template's state — filled for the release's first pupil in sight who has a family to tell (held
   * cards left out), else for sample words. A template not made yet shows the default words it is made
   * with on the first publish.
   */
  async parentMessage(ctx: RequestContext, releaseId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const words = await this.messageWords(c, releaseId);
      const pupil = await c.query<{ name: string; class: string }>(
        `SELECT s.display_name AS name, k.code || '-' || cs.name AS class
           FROM report_card_releases r
           JOIN exam_classes ec ON ec.exam_id = ANY(r.exam_ids)
           JOIN classes k ON k.id = ec.class_id
           JOIN class_sections cs ON cs.class_id = ec.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
           JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
           JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
          WHERE r.id = $1 AND ($2 OR cs.id = ANY($3::bigint[]))
            AND EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
                         WHERE sg.student_id = s.id AND sg.receives_notifications)
            AND NOT EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = s.id)
          ORDER BY k.display_order, cs.name, en.roll_no NULLS LAST, s.display_name
          LIMIT 1`,
        [releaseId, scope.all, scope.sections],
      );
      const sample = pupil.rows[0] ?? null;
      const vars = words(sample ?? { name: 'Aarav Sharma', class: 'VI-A' });
      const t = await c.query<{
        id: string | null;
        channel: 'email' | 'sms';
        status: string;
        subject: string | null;
        body: string;
        format: 'text' | 'html';
        dlt: string | null;
      }>(
        `SELECT t.id::text, d.channel, COALESCE(t.status::text, 'active') AS status,
                CASE WHEN t.id IS NULL THEN d.subject ELSE t.subject END AS subject,
                COALESCE(t.body, d.body) AS body, COALESCE(t.format, d.format) AS format, t.dlt_template_id AS dlt
           FROM app.exam_result_defaults() d
           LEFT JOIN comms_templates t ON t.code = 'result_published' AND t.channel::text = d.channel AND t.deleted_at IS NULL
          ORDER BY d.channel = 'email' DESC`,
      );
      const counts = this.toldCounts(await this.tellPupils(c, releaseId, null, scope));
      return {
        sample,
        told: rel.notifiedCount,
        ...counts,
        channels: t.rows.map((x) => ({
          channel: x.channel,
          templateId: x.id,
          state:
            x.status !== 'active'
              ? ('off' as const)
              : x.channel === 'sms' && !x.dlt?.trim()
                ? ('needs_dlt' as const)
                : ('ready' as const),
          format: x.format,
          ...fillTemplate(x, vars),
        })),
      };
    });
  }

  /**
   * The pupils of the release's published classes (every one, or those asked) as the families' message
   * sees them (docs/design/82): held, withheld for fees, whether a guardian who takes messages has an
   * e-mail or a 10-digit mobile, and whether the family was told on each channel. The counts on the
   * Publish tab and the send read the same rows.
   */
  private async tellPupils(
    c: PoolClient,
    releaseId: string,
    classIds: string[] | null,
    scope: CardScope,
  ) {
    const r = await c.query<TellPupil>(
      `SELECT DISTINCT ON (s.id) s.id::text AS student_id, s.display_name AS name, k.code || '-' || cs.name AS class,
              x.class_id::text, k.code AS class_code, k.display_order,
              EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = s.id) AS held,
              COALESCE(r.hide_defaulters AND (SELECT COALESCE(sum(d.balance), 0) FROM mart.fee_dues d
                WHERE d.student_id = s.id AND d.academic_year_id = r.academic_year_id AND d.due_on <= CURRENT_DATE) > r.defaulter_min, false) AS fee,
              EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
                       WHERE sg.student_id = s.id AND sg.receives_notifications AND COALESCE(btrim(g.email::text), '') <> '') AS has_email,
              EXISTS (SELECT 1 FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
                       WHERE sg.student_id = s.id AND sg.receives_notifications AND g.mobile ~ '^[6-9][0-9]{9}$') AS has_sms,
              EXISTS (SELECT 1 FROM report_card_told t WHERE t.release_id = r.id AND t.student_id = s.id AND t.channel = 'email') AS told_email,
              EXISTS (SELECT 1 FROM report_card_told t WHERE t.release_id = r.id AND t.student_id = s.id AND t.channel = 'sms') AS told_sms
         FROM report_card_releases r
         JOIN report_card_release_classes x ON x.release_id = r.id AND x.status = 'released'
         JOIN classes k ON k.id = x.class_id
         JOIN class_sections cs ON cs.class_id = x.class_id AND cs.academic_year_id = r.academic_year_id AND cs.deleted_at IS NULL
         JOIN enrolments en ON en.class_section_id = cs.id AND en.academic_year_id = r.academic_year_id AND en.status = 'active'
         JOIN students s ON s.id = en.student_id AND s.deleted_at IS NULL
        WHERE r.id = $1 AND ($2::bigint[] IS NULL OR x.class_id = ANY($2::bigint[]))
          AND ($3 OR cs.id = ANY($4::bigint[]))
        ORDER BY s.id, en.id DESC`,
      [releaseId, classIds, scope.all, scope.sections],
    );
    return r.rows;
  }

  /**
   * docs/design/82: the principal tells the families of the release's published classes (every one, or
   * those asked) on the channels picked — only the pupils not told yet on that channel, never a held card
   * or one withheld for fees — through the families' message (doc 81's words). Each pupil told is kept
   * per channel; the release and each class keep the count of messages queued.
   */
  async tell(ctx: RequestContext, releaseId: string, dto: TellDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const open = await c.query<{ class_id: string; code: string }>(
        `SELECT x.class_id::text, k.code FROM report_card_release_classes x JOIN classes k ON k.id = x.class_id
          WHERE x.release_id = $1 AND x.status = 'released'`,
        [releaseId],
      );
      const asked = dto.classIds?.length ? [...new Set(dto.classIds)] : null;
      if (!open.rowCount)
        throw new DomainError('report_card.status', 'No class of this release is published', {
          status: 409,
        });
      for (const id of asked ?? [])
        if (!open.rows.some((x) => x.class_id === id))
          throw new DomainError('report_card.status', 'Only a published class can be told', {
            status: 409,
          });
      await c.query(`SELECT app.exam_seed_templates(app.current_school_id())`);
      const channels = [...new Set(dto.channels)];
      const ready = await c.query<{ channel: 'email' | 'sms'; status: string; dlt: string | null }>(
        `SELECT channel::text AS channel, status::text AS status, dlt_template_id AS dlt FROM comms_templates
          WHERE code = 'result_published' AND channel::text = ANY($1::text[]) AND deleted_at IS NULL`,
        [channels],
      );
      for (const ch of channels) {
        const t = ready.rows.find((x) => x.channel === ch);
        if (!t || t.status !== 'active')
          throw new DomainError(
            'validation-failed',
            `The ${ch === 'email' ? 'e-mail' : 'SMS'} template "Exams: result published" is switched off under Communication → Templates`,
            { status: 400 },
          );
        if (ch === 'sms' && !t.dlt?.trim())
          throw new DomainError(
            'validation-failed',
            'The SMS needs its DLT template id under Communication → Templates ("Exams: result published")',
            { status: 400 },
          );
      }
      const pupils = await this.tellPupils(c, releaseId, asked, scope);
      const waiting = (ch: 'email' | 'sms') =>
        pupils.filter(
          (p) =>
            !p.held &&
            !p.fee &&
            (ch === 'email' ? p.has_email && !p.told_email : p.has_sms && !p.told_sms),
        );
      if (channels.every((ch) => !waiting(ch).length))
        throw new DomainError(
          'report_card.told',
          'Every family that can be told on this channel is told already',
          { status: 409 },
        );
      const ids = [...new Set(channels.flatMap((ch) => waiting(ch).map((p) => p.student_id)))];
      const g = await c.query<{
        student_id: string;
        mobile: string | null;
        email: string | null;
        user_id: string | null;
      }>(
        `SELECT DISTINCT ON (sg.student_id, g.id) sg.student_id::text, g.mobile, g.email::text AS email, g.user_id::text
           FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
          WHERE sg.student_id = ANY($1::bigint[]) AND sg.receives_notifications
          ORDER BY sg.student_id, g.id`,
        [ids],
      );
      const words = await this.messageWords(c, releaseId);
      const byClass = new Map<string, number>();
      const told = { email: 0, sms: 0 };
      let messages = 0;
      for (const ch of channels)
        for (const p of waiting(ch)) {
          const vars = JSON.stringify(words(p));
          let n = 0;
          for (const x of g.rows.filter((y) => y.student_id === p.student_id)) {
            const to =
              ch === 'email'
                ? x.email?.trim() || null
                : /^[6-9][0-9]{9}$/.test(x.mobile ?? '')
                  ? x.mobile
                  : null;
            if (!to) continue;
            const m = await c.query<{ id: string | null }>(
              `SELECT app.send_template('result_published', $1, $2, $3::jsonb, $4)::text AS id`,
              [ch, to, vars, x.user_id],
            );
            if (m.rows[0]?.id) n += 1;
          }
          if (!n) continue;
          await c.query(
            `INSERT INTO report_card_told (school_id, release_id, student_id, channel, messages, told_by)
             VALUES (app.current_school_id(), $1, $2, $3::comms_channel, $4, app.current_user_id())
             ON CONFLICT (release_id, student_id, channel) DO NOTHING`,
            [releaseId, p.student_id, ch, n],
          );
          told[ch] += 1;
          messages += n;
          byClass.set(p.class_id, (byClass.get(p.class_id) ?? 0) + n);
        }
      for (const [classId, n] of byClass)
        await c.query(
          `UPDATE report_card_release_classes SET notified_count = notified_count + $3 WHERE release_id = $1 AND class_id = $2`,
          [releaseId, classId, n],
        );
      if (messages)
        await c.query(
          `UPDATE report_card_releases SET notified_at = now(), notified_count = notified_count + $2 WHERE id = $1`,
          [releaseId, messages],
        );
      await this.audit.stage(ctx, c, {
        action: 'exams.report_card.tell',
        entityType: 'report_card_releases',
        entityId: releaseId,
        after: { classIds: asked, channels, told, messages },
      });
      return { told, messages };
    });
  }

  /** The Publish tab's counts (docs/design/82): per published class, who is told and who waits. */
  private toldCounts(pupils: TellPupil[]) {
    const by = new Map<string, TellPupil[]>();
    for (const p of pupils) by.set(p.class_id, [...(by.get(p.class_id) ?? []), p]);
    const count = (list: TellPupil[]) => {
      const send = list.filter((p) => !p.held && !p.fee);
      const of = (ch: 'email' | 'sms') => ({
        told: list.filter((p) => (ch === 'email' ? p.told_email : p.told_sms)).length,
        waiting: send.filter((p) =>
          ch === 'email' ? p.has_email && !p.told_email : p.has_sms && !p.told_sms,
        ).length,
        noAddress: send.filter((p) =>
          ch === 'email' ? !p.has_email && !p.told_email : !p.has_sms && !p.told_sms,
        ).length,
      });
      return {
        pupils: list.length,
        held: list.filter((p) => p.held).length,
        withheld: list.filter((p) => !p.held && p.fee).length,
        email: of('email'),
        sms: of('sms'),
      };
    };
    return {
      classes: [...by.values()]
        .sort(
          (a, b) =>
            a[0]!.display_order - b[0]!.display_order ||
            a[0]!.class_code.localeCompare(b[0]!.class_code),
        )
        .map((list) => ({ classId: list[0]!.class_id, code: list[0]!.class_code, ...count(list) })),
      total: count(pupils),
    };
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
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      await this.assertStudentInSight(c, scope, dto.studentId);
      if (dto.held)
        await c.query(
          `INSERT INTO report_card_holds (school_id, release_id, student_id, reason, held_by)
           VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
           ON CONFLICT (release_id, student_id) DO UPDATE SET reason = EXCLUDED.reason, held_by = EXCLUDED.held_by, held_at = now()`,
          [releaseId, dto.studentId, dto.reason!.trim()],
        );
      else {
        // shown again: no message (docs/design/82); the pupil waits in the Publish tab's "Not told yet"
        await c.query(`DELETE FROM report_card_holds WHERE release_id = $1 AND student_id = $2`, [
          releaseId,
          dto.studentId,
        ]);
      }
      await this.audit.stage(ctx, c, {
        action: dto.held ? 'exams.report_card.hold' : 'exams.report_card.unhold',
        entityType: 'report_card_releases',
        entityId: releaseId,
        after: dto,
      });
      return (await this.findRelease(c, releaseId, scope))!;
    });
  }

  // ---- holds in bulk (docs/design/75) ------------------------------------------------------------
  /** The held cards of a release in the person's sections; the fee rule's count beside them. */
  async holds(ctx: RequestContext, releaseId: string, q: HoldsQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      this.assertPlaceInSight(scope, q);
      return {
        data: await this.heldRows(c, releaseId, scope, q),
        /** cards the fee rule withholds today (null: the release has no fee rule) */
        feeWithheld: rel.hideDefaulters ? await this.feeWithheldCount(c, rel, scope, q) : null,
      };
    });
  }

  /** The held cards as Excel or an A4 PDF (the list as filtered on the Publish tab). */
  async holdsFile(ctx: RequestContext, releaseId: string, q: HoldsFileDto) {
    const { rel, rows, school, place } = await this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      this.assertPlaceInSight(scope, q);
      const s = await c.query<{ school: string; place: string | null }>(
        `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
                COALESCE((SELECT k.code || '-' || cs.name FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1::bigint),
                         (SELECT code FROM classes WHERE id = $2::bigint)) AS place`,
        [q.classSectionId ?? null, q.classId ?? null],
      );
      return {
        rel,
        rows: await this.heldRows(c, releaseId, scope, q),
        school: s.rows[0]?.school ?? '',
        place: s.rows[0]?.place ?? null,
      };
    });
    const title = `Held report cards · ${rel.name}`;
    const filters = [place ? `Class: ${place}` : 'All classes', q.q ? `Search: ${q.q}` : null]
      .filter(Boolean)
      .join(' · ');
    const made = `Made on ${dayText(new Date().toISOString())}`;
    const head = ['Sr', 'Admission no', 'Student', 'Class', 'Reason', 'Held by', 'Held on'];
    const body = rows.map((x, i) => [
      i + 1,
      x.admissionNo,
      x.name,
      x.section,
      x.reason,
      x.heldBy ?? '',
      dayText(x.heldAt),
    ]);
    const stem = `held-report-cards-${rel.termCode}${place ? `-${place}` : ''}`
      .toLowerCase()
      .replace(/[^\w.-]+/g, '-');
    if (q.format === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Held cards');
      ws.addRow([school]).font = { bold: true, size: 13 };
      ws.addRow([title]).font = { bold: true };
      ws.addRow([`${filters} · ${made}`]);
      ws.addRow([]);
      const h = ws.addRow(head);
      h.font = { bold: true };
      for (const r of body) ws.addRow(r);
      [6, 16, 30, 12, 48, 22, 14].forEach((w, k) => {
        ws.getColumn(k + 1).width = w;
      });
      ws.getColumn(5).alignment = { wrapText: true, vertical: 'top' };
      return {
        filename: `${stem}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      };
    }
    const bytes = await tablePdf({
      school,
      title,
      subtitle: [filters, made],
      columns: [
        { label: 'Sr', width: 0.5, center: true },
        { label: 'Admission no', width: 1.3 },
        { label: 'Student', width: 2.4 },
        { label: 'Class', width: 1 },
        { label: 'Reason', width: 3.6 },
        { label: 'Held by', width: 1.6 },
        { label: 'Held on', width: 1.1 },
      ],
      rows: body,
      wrap: true,
    });
    return {
      filename: `${stem}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  /**
   * Holds many students' cards with one reason (and, when asked, in the year's other published cards
   * whose classes they are in), or shows them again; a card shown again on a published class sends the
   * family the result message. Students outside the card's classes or the person's sections are refused
   * with the cause; nothing else is touched.
   */
  async bulkHolds(ctx: RequestContext, releaseId: string, dto: BulkHoldDto) {
    const reason = dto.reason?.trim() ?? '';
    if (dto.held && reason.length < 3)
      throw new DomainError('validation-failed', 'Give the reason for holding the cards', {
        status: 400,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const found = await this.holdCandidates(c, releaseId, scope, {
        ids: dto.studentIds ?? [],
        nos: dto.admissionNos ?? [],
      });
      const refused: Array<{ key: string; name: string | null; error: string }> = [];
      for (const id of new Set(dto.studentIds ?? []))
        if (!found.some((f) => f.studentId === id))
          refused.push({ key: id, name: null, error: 'Not a pupil of this year' });
      for (const no of new Set(dto.admissionNos ?? []))
        if (!found.some((f) => f.admissionNo.trim().toLowerCase() === no.trim().toLowerCase()))
          refused.push({ key: no, name: null, error: `No pupil with admission no ${no}` });
      for (const f of found)
        if (f.problem) refused.push({ key: f.admissionNo, name: f.name, error: f.problem });
      const ok = found.filter((f) => !f.problem);
      const view = (f: (typeof ok)[number]) => ({
        studentId: f.studentId,
        name: f.name,
        admissionNo: f.admissionNo,
        section: f.section,
        reason: f.heldReason,
      });
      let held = 0;
      let alsoHeld = 0;
      let lifted: string[] = [];
      // shown again: no message (docs/design/82); kept 0 for the callers
      const notified = 0;
      if (dto.held) {
        const also = await this.otherPublished(c, scope, rel, dto.alsoReleaseIds);
        held = await this.insertHolds(
          c,
          releaseId,
          ok.filter((f) => f.heldReason === null).map((f) => ({ studentId: f.studentId, reason })),
        );
        alsoHeld = await this.holdInOthers(c, also, ok, () => reason);
      } else {
        const gone = await c.query<{ student_id: string }>(
          `DELETE FROM report_card_holds WHERE release_id = $1 AND student_id = ANY($2::bigint[])
           RETURNING student_id::text`,
          [releaseId, ok.map((f) => f.studentId)],
        );
        lifted = gone.rows.map((x) => x.student_id);
      }
      if (held || alsoHeld || lifted.length)
        await this.audit.stage(ctx, c, {
          action: dto.held ? 'exams.report_card.hold_bulk' : 'exams.report_card.unhold_bulk',
          entityType: 'report_card_releases',
          entityId: releaseId,
          after: {
            studentIds: dto.held ? ok.map((f) => f.studentId) : lifted,
            ...(dto.held ? { reason, alsoReleaseIds: dto.alsoReleaseIds ?? [] } : {}),
          },
        });
      return {
        held,
        alsoHeld,
        lifted: lifted.length,
        notified,
        /** already as asked: held (with their reason) when holding, not held when showing again */
        unchanged: ok
          .filter((f) => (dto.held ? f.heldReason !== null : !lifted.includes(f.studentId)))
          .map(view),
        refused,
      };
    });
  }

  /** The Excel to fill: admission numbers and reasons (the names are only for the person's own check). */
  async holdsTemplate(ctx: RequestContext, releaseId: string) {
    const rel = await this.release(ctx, releaseId);
    const bytes = await templateSheet({
      sheet: 'Hold cards',
      columns: [
        { header: 'Admission no', width: 16, required: true, format: 'text' },
        { header: 'Student name', width: 28, note: 'Not read: for your own check.' },
        {
          header: 'Reason',
          width: 48,
          note: '3 to 300 letters. Empty: the reason typed on the screen is used.',
        },
      ],
      guide: [
        `Holding report cards back from the parent and student portal · ${rel.name}`,
        'One row per student: the admission number, and the reason the card is held.',
        'A row without a reason takes the reason typed on the screen before uploading.',
        "Only students of this card's classes (and of your own classes) can be held.",
        'Upload the sheet in Report cards → Publish → Hold cards; check the list, then save.',
        'Families see "held, contact the office"; the reason is kept for the school.',
      ],
    });
    return {
      filename: `hold-report-cards-${rel.termCode}.xlsx`.toLowerCase().replace(/[^\w.-]+/g, '-'),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  /**
   * An uploaded holds sheet: every row checked (a pupil of this year in one of the card's classes and of
   * the person's sections, once in the sheet, not held already, a reason of its own or the screen's);
   * `apply` holds the rows without a problem and leaves the rest.
   */
  async holdsUpload(ctx: RequestContext, releaseId: string, dto: HoldsUploadDto) {
    const rows = await readSheet(dto.file, ['Admission no'], ['Reason']);
    const fallback = dto.reason?.trim() ?? '';
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      const found = await this.holdCandidates(c, releaseId, scope, {
        ids: [],
        nos: rows.map((r) => r.cells['Admission no'] ?? '').filter(Boolean),
      });
      const byNo = new Map(found.map((f) => [f.admissionNo.trim().toLowerCase(), f]));
      const seen = new Set<string>();
      const checked = rows.map(({ row, cells }) => {
        const no = (cells['Admission no'] ?? '').trim();
        const f = no ? byNo.get(no.toLowerCase()) : undefined;
        const why = (cells.Reason ?? '').trim() || fallback;
        let error: string | null = null;
        if (!no) error = 'No admission no';
        else if (!f) error = `No pupil with admission no ${no} this year`;
        else if (seen.has(f.studentId)) error = 'In the sheet twice';
        else if (f.problem) error = f.problem;
        else if (f.heldReason !== null) error = `Held already: ${f.heldReason}`;
        else if (why.length < 3) error = 'Give the reason (in the sheet, or on the screen)';
        else if (why.length > 300) error = 'The reason is longer than 300 letters';
        if (f) seen.add(f.studentId);
        return { row, admissionNo: no, name: f ? `${f.name} (${f.section})` : null, error, f, why };
      });
      const good = checked.filter((x) => !x.error && x.f);
      let applied = false;
      if (dto.apply && good.length) {
        const also = await this.otherPublished(c, scope, rel, dto.alsoReleaseIds);
        await this.insertHolds(
          c,
          releaseId,
          good.map((x) => ({ studentId: x.f!.studentId, reason: x.why })),
        );
        const reasonOf = new Map(good.map((x) => [x.f!.studentId, x.why]));
        await this.holdInOthers(
          c,
          also,
          good.map((x) => x.f!),
          (id) => reasonOf.get(id)!,
        );
        await this.audit.stage(ctx, c, {
          action: 'exams.report_card.hold_upload',
          entityType: 'report_card_releases',
          entityId: releaseId,
          after: {
            studentIds: good.map((x) => x.f!.studentId),
            alsoReleaseIds: dto.alsoReleaseIds ?? [],
          },
        });
        applied = true;
      }
      return {
        rows: checked.map(({ row, admissionNo, name, error }) => ({
          row,
          admissionNo,
          name,
          error,
        })),
        ready: good.length,
        errors: checked.length - good.length,
        applied,
      };
    });
  }

  /** a class or section asked for must be in the person's sight */
  private assertPlaceInSight(scope: CardScope, q: { classId?: string; classSectionId?: string }) {
    if (
      !scope.all &&
      ((q.classSectionId && !scope.sections.includes(q.classSectionId)) ||
        (q.classId && !scope.classes.includes(q.classId)))
    )
      throw this.outOfSight();
  }

  /** the held cards of this year's active pupils, in class, section and roll order */
  private async heldRows(
    c: PoolClient,
    releaseId: string,
    scope: CardScope,
    q: { classId?: string; classSectionId?: string; q?: string },
  ) {
    const words = q.q ? `%${q.q.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const r = await c.query<{
      student_id: string;
      name: string;
      admission_no: string;
      roll_no: number | null;
      class_id: string;
      section_id: string;
      section: string;
      reason: string;
      held_by: string | null;
      held_at: Date;
    }>(
      `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no, cs.class_id::text,
              cs.id::text AS section_id, k.code || '-' || cs.name AS section, h.reason, u.display_name AS held_by, h.held_at
         FROM report_card_holds h
         JOIN students s ON s.id = h.student_id AND s.deleted_at IS NULL
         JOIN enrolments e ON e.student_id = s.id AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
         JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
         JOIN classes k ON k.id = cs.class_id
         LEFT JOIN users u ON u.id = h.held_by
        WHERE h.release_id = $1
          AND ($2::bigint IS NULL OR cs.class_id = $2::bigint)
          AND ($3::bigint IS NULL OR cs.id = $3::bigint)
          AND ($4::bigint[] IS NULL OR cs.id = ANY($4::bigint[]))
          AND ($5::text IS NULL OR lower(s.display_name) LIKE $5 OR lower(s.admission_no) LIKE $5 OR lower(h.reason) LIKE $5)
        ORDER BY k.display_order, k.code, cs.name, e.roll_no NULLS LAST, s.display_name`,
      [
        releaseId,
        q.classId ?? null,
        q.classSectionId ?? null,
        scope.all ? null : scope.sections,
        words,
      ],
    );
    return r.rows.map((x) => ({
      studentId: x.student_id,
      name: x.name,
      admissionNo: x.admission_no,
      rollNo: x.roll_no,
      classId: x.class_id,
      sectionId: x.section_id,
      section: x.section,
      reason: x.reason,
      heldBy: x.held_by,
      heldAt: new Date(x.held_at).toISOString(),
    }));
  }

  /** the active pupils of the release's classes (in the person's sections) the fee rule withholds today */
  private async feeWithheldCount(
    c: PoolClient,
    rel: ReleaseRow,
    scope: CardScope,
    q: { classId?: string; classSectionId?: string },
  ): Promise<number> {
    const r = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM report_card_releases r
         JOIN enrolments e ON e.academic_year_id = r.academic_year_id AND e.status = 'active'
         JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
        WHERE r.id = $1
          AND cs.class_id IN (SELECT ec.class_id FROM exam_classes ec WHERE ec.exam_id = ANY(r.exam_ids))
          AND ($2::bigint IS NULL OR cs.class_id = $2::bigint)
          AND ($3::bigint IS NULL OR cs.id = $3::bigint)
          AND ($4::bigint[] IS NULL OR cs.id = ANY($4::bigint[]))
          AND (SELECT COALESCE(sum(d.balance), 0) FROM mart.fee_dues d
                WHERE d.student_id = e.student_id AND d.academic_year_id = r.academic_year_id AND d.due_on <= CURRENT_DATE) > r.defaulter_min`,
      [rel.id, q.classId ?? null, q.classSectionId ?? null, scope.all ? null : scope.sections],
    );
    return r.rows[0]?.n ?? 0;
  }

  /** the classes a release carries (its exams' classes) */
  private async releaseClassIds(c: PoolClient, releaseId: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(
      `SELECT DISTINCT ec.class_id::text AS id FROM report_card_releases r
         JOIN exam_classes ec ON ec.exam_id = ANY(r.exam_ids) WHERE r.id = $1`,
      [releaseId],
    );
    return r.rows.map((x) => x.id);
  }

  /**
   * The pupils named (by id or admission no) among this year's active pupils, each with its hold on the
   * release and the reason it may not be held there: not in one of the card's classes, or not in the
   * person's sections.
   */
  private async holdCandidates(
    c: PoolClient,
    releaseId: string,
    scope: CardScope,
    by: { ids: string[]; nos: string[] },
  ) {
    const classes = await this.releaseClassIds(c, releaseId);
    const r = await c.query<{
      id: string;
      name: string;
      admission_no: string;
      class_id: string;
      section_id: string;
      section: string;
      held_reason: string | null;
    }>(
      `SELECT DISTINCT ON (s.id) s.id::text, s.display_name AS name, s.admission_no, cs.class_id::text,
              cs.id::text AS section_id, k.code || '-' || cs.name AS section, h.reason AS held_reason
         FROM enrolments e
         JOIN class_sections cs ON cs.id = e.class_section_id AND cs.deleted_at IS NULL
         JOIN classes k ON k.id = cs.class_id
         JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
         LEFT JOIN report_card_holds h ON h.release_id = $1 AND h.student_id = s.id
        WHERE e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
          AND (s.id = ANY($2::bigint[]) OR lower(btrim(s.admission_no)) = ANY($3::text[]))
        ORDER BY s.id, e.id DESC`,
      [releaseId, by.ids, by.nos.map((x) => x.trim().toLowerCase())],
    );
    return r.rows.map((x) => ({
      studentId: x.id,
      name: x.name,
      admissionNo: x.admission_no,
      classId: x.class_id,
      sectionId: x.section_id,
      section: x.section,
      heldReason: x.held_reason,
      problem: !classes.includes(x.class_id)
        ? `${x.section} is not one of this card's classes`
        : !scope.all && !scope.sections.includes(x.section_id)
          ? `${x.section} is not one of your classes`
          : null,
    }));
  }

  /** this year's other published cards asked for, each in the person's sight (else refused) */
  private async otherPublished(
    c: PoolClient,
    scope: CardScope,
    rel: ReleaseRow,
    ids: string[] | undefined,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const id of new Set(ids ?? [])) {
      if (id === rel.id) continue;
      const o = await this.findRelease(c, id, scope);
      if (!o || o.status !== 'released' || o.academicYearId !== rel.academicYearId)
        throw new DomainError(
          'validation-failed',
          "A card can also be held only in this year's published cards",
          { status: 400 },
        );
      out.push(id);
    }
    return out;
  }

  /** holds on one release, each with its reason; one held already is left as it is. Returns the new ones. */
  private async insertHolds(
    c: PoolClient,
    releaseId: string,
    items: Array<{ studentId: string; reason: string }>,
  ): Promise<number> {
    if (!items.length) return 0;
    const r = await c.query(
      `INSERT INTO report_card_holds (school_id, release_id, student_id, reason, held_by)
       SELECT app.current_school_id(), $1, x.sid, x.reason, app.current_user_id()
         FROM unnest($2::bigint[], $3::text[]) AS x(sid, reason)
       ON CONFLICT (release_id, student_id) DO NOTHING`,
      [releaseId, items.map((x) => x.studentId), items.map((x) => x.reason)],
    );
    return r.rowCount ?? 0;
  }

  /** the same students held in other releases too, where their class is one of that release's */
  private async holdInOthers(
    c: PoolClient,
    releaseIds: string[],
    students: Array<{ studentId: string; classId: string }>,
    reasonOf: (studentId: string) => string,
  ): Promise<number> {
    let n = 0;
    for (const id of releaseIds) {
      const classes = await this.releaseClassIds(c, id);
      n += await this.insertHolds(
        c,
        id,
        students
          .filter((s) => classes.includes(s.classId))
          .map((s) => ({ studentId: s.studentId, reason: reasonOf(s.studentId) })),
      );
    }
    return n;
  }

  /**
   * What a release still needs, class by class (docs/design/65; the workspace's Readiness and Cards):
   * the template each class prints with, its locked term result, and per section the students, the
   * PDFs made, the cards withheld for fees or held, the papers not verified (only subjects someone
   * takes) and the students without the remark or the attendance an exam takes.
   */
  async readiness(ctx: RequestContext, releaseId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // a coordinator's classes, a class teacher's own section (CardScope)
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
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
            AND ($2::bigint[] IS NULL OR k.id = ANY($2::bigint[]))
          ORDER BY k.display_order, k.code`,
        [rel.examIds, scope.all ? null : scope.classes],
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
            AND ($3::bigint[] IS NULL OR cs.id = ANY($3::bigint[]))
            AND EXISTS (SELECT 1 FROM enrolments en WHERE en.class_section_id = cs.id AND en.status = 'active')
          ORDER BY k.display_order, cs.name`,
        [releaseId, classIds, scope.all ? null : scope.sections],
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
        /** false: only the person's classes and sections are here (a coordinator, a class teacher) */
        allClasses: scope.all,
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
      const scope = await cardScopeOf(c, ctx);
      if (!(await this.findRelease(c, releaseId, scope)))
        throw new DomainError('not-found', 'Release not found', { status: 404 });
      if (
        !scope.all &&
        ((q.classSectionId && !scope.sections.includes(q.classSectionId)) ||
          (q.classId && !scope.classes.includes(q.classId)))
      )
        throw this.outOfSight();
      const r = await c.query<Record<string, unknown>>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, e.roll_no,
                cs.id::text AS section_id, cs.class_id::text AS class_id, k.code || '-' || cs.name AS section,
                e.status::text AS enrolment_status,
                rc.export_id::text, rc.withheld, rc.withheld_reason, rc.rendered_at, x.status AS export_status,
                h.reason AS held_reason,
                -- the fee rule as it stands today (docs/design/75: the hold window shows it)
                (SELECT rr.hide_defaulters AND (SELECT COALESCE(sum(d.balance), 0) FROM mart.fee_dues d
                    WHERE d.student_id = s.id AND d.academic_year_id = rr.academic_year_id AND d.due_on <= CURRENT_DATE) > rr.defaulter_min
                   FROM report_card_releases rr WHERE rr.id = $1) AS fee_due
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
            AND ($5::bigint[] IS NULL OR cs.id = ANY($5::bigint[]))
          ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
        [
          releaseId,
          q.classSectionId ?? null,
          q.classId ?? null,
          q.status ?? 'active',
          scope.all ? null : scope.sections,
        ],
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
        /** the fee rule withholds the card today (docs/design/75) */
        feeDue: Boolean(x.fee_due),
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
          `SELECT r.id::text, r.kind, r.term_code, r.name, r.hide_defaulters, r.defaulter_min::text, r.released_at,
                  (SELECT jsonb_agg(jsonb_build_object('code', e.code, 'name', e.name, 'pct', x.pct::text, 'grade', x.grade, 'result', x.result, 'rank', x.rank_in_section) ORDER BY array_position(r.exam_ids, e.id))
                     FROM exams e LEFT JOIN exam_results x ON x.exam_id = e.id AND x.student_id = $1 WHERE e.id = ANY(r.exam_ids) AND e.show_on_portal) AS exams,
                  rc.withheld, rc.export_id::text,
                  EXISTS (SELECT 1 FROM report_card_holds h WHERE h.release_id = r.id AND h.student_id = $1) AS held,
                  -- the fee rule as it stands today (the card's own record only knows the last PDF)
                  r.hide_defaulters AND (SELECT COALESCE(sum(d.balance), 0) FROM mart.fee_dues d
                     WHERE d.student_id = $1 AND d.academic_year_id = r.academic_year_id AND d.due_on <= CURRENT_DATE) > r.defaulter_min AS fee_due
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
            /** exam card, term card or annual card (1 Nov 2026) */
            kind: String(r.kind),
            termCode: String(r.term_code),
            name: String(r.name),
            releasedAt: r.released_at ? new Date(r.released_at as string).toISOString() : null,
            exams: r.held ? [] : ((r.exams as unknown[]) ?? []),
            withheld: Boolean(r.withheld) || Boolean(r.held) || Boolean(r.fee_due),
            /** withheld today by the fee rule: the card opens once the dues are cleared */
            feeDue: Boolean(r.fee_due),
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
    const { rel: info, pending } = await this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.familyCard(c, releaseId, studentId);
      // asked again while the PDF is still being made: the same one, not another in the queue
      const p = await c.query<{ id: string; status: string }>(
        `SELECT id::text, status::text FROM exports
          WHERE dataset = 'report_card' AND requested_by = app.current_user_id() AND status IN ('queued', 'running')
            AND params->>'releaseId' = $1 AND params->>'studentId' = $2
          ORDER BY id DESC LIMIT 1`,
        [releaseId, studentId],
      );
      return { rel, pending: p.rows[0] ?? null };
    });
    if (pending) return { exportId: pending.id, status: pending.status };
    const exp = await this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'report_card',
        format: 'pdf',
        params: { releaseId, studentId, academicYearId: info.academicYearId },
        title: `Report card · ${info.name}`,
      },
      'exams.report_card.render_family',
    );
    return { exportId: exp.id, status: exp.status };
  }

  /**
   * A family's own card as a page, at once (1 Nov 2026): the same checks as the PDF (published for the
   * child's class, not held, the fee rule), printed with the design the PDF uses; the browser prints or
   * saves it while the PDF is made in the background.
   */
  async myReportCardHtml(ctx: RequestContext, releaseId: string, studentId: string) {
    const v = await this.viewer.resolve(ctx, 'exams.family.view');
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Report card not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rel = await this.familyCard(c, releaseId, studentId);
      return { html: await this.studentCardHtml(c, rel, studentId) };
    });
  }

  /** The school's preview of one student's card in a release, with the design of the student's class. */
  async studentPreview(ctx: RequestContext, releaseId: string, studentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const scope = await cardScopeOf(c, ctx);
      const rel = await this.findRelease(c, releaseId, scope);
      if (!rel) throw new DomainError('not-found', 'Release not found', { status: 404 });
      await this.assertStudentInSight(c, scope, studentId);
      return { html: await this.studentCardHtml(c, rel, studentId) };
    });
  }

  /** A family may open the card: published for the child's class, not held, not withheld for fees. */
  private async familyCard(c: PoolClient, releaseId: string, studentId: string) {
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
  }

  /**
   * One student's card as HTML with the design the PDF uses: the one chosen for the student's class,
   * else the band's on the release, else the band's first active design (as the worker picks it).
   */
  private async studentCardHtml(c: PoolClient, rel: ReleaseRow, studentId: string) {
    const k = await c.query<{ band: string | null; display_order: number; class_id: string }>(
      `SELECT k.band::text, k.display_order, k.id::text AS class_id
         FROM enrolments en JOIN class_sections cs ON cs.id = en.class_section_id JOIN classes k ON k.id = cs.class_id
        WHERE en.student_id = $1 AND en.academic_year_id = app.current_academic_year_id()
        ORDER BY (en.status = 'active') DESC, en.id DESC LIMIT 1`,
      [studentId],
    );
    if (!k.rows[0])
      throw new DomainError('not-found', 'The pupil is not enrolled in the working year', {
        status: 404,
      });
    const band = bandFor(k.rows[0].band, k.rows[0].display_order);
    const chosen = rel.templates[`class_${k.rows[0].class_id}`] ?? rel.templates[band];
    const t = chosen
      ? await this.findTemplate(c, chosen)
      : await c
          .query<Record<string, unknown>>(
            // eslint-disable-next-line no-restricted-syntax -- T_COLS is a constant
            `SELECT ${T_COLS} FROM report_card_templates WHERE band = $1::class_band AND status = 'active' AND deleted_at IS NULL ORDER BY code LIMIT 1`,
            [band],
          )
          .then((r) => (r.rows[0] ? toTemplate(r.rows[0]) : null));
    if (!t)
      throw new DomainError(
        'report_card.no_template',
        `No active report-card template for the ${band} band; install the defaults or design one`,
        { status: 409 },
      );
    const data = await loadReportCardData(c, {
      studentId,
      examIds: rel.examIds,
      termCode: rel.termCode,
      termName: rel.name,
      defaulterMin: Number(rel.defaulterMin),
    });
    await this.signatures.fill(data.signatures ?? []);
    await this.signatures.fill(data.hpc?.portfolio ?? []);
    const art = await this.pictures(c, t, data);
    return reportCardDocument(
      {
        layout: t.layout,
        bodyHtml: t.bodyHtml,
        stylesCss: t.stylesCss,
        pageWidth: t.pageWidth,
        pageHeight: t.pageHeight,
        art,
      },
      [{ data }],
    );
  }

  async myExportStatus(ctx: RequestContext, exportId: string) {
    const own = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(`SELECT 1 FROM exports WHERE id = $1 AND requested_by = app.current_user_id()`, [
        exportId,
      ]),
    );
    if (!own.rowCount) throw new DomainError('not-found', 'Export not found', { status: 404 });
    return this.reports.statusForOwner(ctx, exportId);
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

  /** A release; with a scope, only one that carries a class in sight, counted for those classes. */
  private async findRelease(
    c: PoolClient,
    id: string,
    scope?: CardScope,
  ): Promise<ReleaseRow | null> {
    return (await this.releaseRows(c, id, scope))[0] ?? null;
  }

  /** One release (id) or the working year's (null), newest first, as findRelease narrows them. */
  private async releaseRows(
    c: PoolClient,
    id: string | null,
    scope?: CardScope,
  ): Promise<ReleaseRow[]> {
    const narrow = scope && !scope.all;
    const r = await c.query<Record<string, unknown>>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments (constant SELECT or registry names); values are bound
      `SELECT ${R_COLS} FROM report_card_releases r
        WHERE ($1::bigint IS NULL OR r.id = $1::bigint)
          AND ($1::bigint IS NOT NULL OR r.academic_year_id = app.current_academic_year_id())
          AND ($3::bigint[] IS NULL OR EXISTS (SELECT 1 FROM exam_classes ec
                WHERE ec.exam_id = ANY(r.exam_ids) AND ec.class_id = ANY($3::bigint[])))
        ORDER BY r.created_at DESC, r.id DESC`,
      [id, narrow ? scope.sections : null, narrow ? scope.classes : null],
    );
    return r.rows.map(toRelease);
  }

  private outOfSight(): DomainError {
    return new DomainError(
      'report_card.not_your_class',
      'This class is not yours: you see the classes you coordinate and the sections you are class teacher of',
      { status: 403 },
    );
  }

  /** A student's section this year must be in sight (a preview, a hold, a single card). */
  private async assertStudentInSight(c: PoolClient, scope: CardScope, studentId: string) {
    if (scope.all) return;
    const r = await c.query(
      `SELECT 1 FROM enrolments en WHERE en.student_id = $1 AND en.academic_year_id = app.current_academic_year_id()
          AND en.class_section_id = ANY($2::bigint[]) LIMIT 1`,
      [studentId, scope.sections],
    );
    if (!r.rowCount) throw this.outOfSight();
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

/**
 * A template filled as `app.send_template` fills it (docs/design/81): each word replaces its
 * {{placeholder}} in the subject and the body (HTML-escaped in an HTML template), runs of spaces become
 * one, and the subject is kept to 200 characters.
 */
export function fillTemplate(
  t: { subject: string | null; body: string; format: 'text' | 'html' },
  vars: Record<string, string>,
): { subject: string | null; body: string } {
  let subject = t.subject;
  let body = t.body;
  for (const [k, raw] of Object.entries(vars)) {
    const v =
      t.format === 'html'
        ? raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        : raw;
    body = body.replaceAll(`{{${k}}}`, v);
    subject = subject === null ? null : subject.replaceAll(`{{${k}}}`, v);
  }
  return {
    subject: subject === null ? null : subject.slice(0, 200),
    body: body.replace(/\s{2,}/g, ' ').trim(),
  };
}

/** a pupil of a published class as the families' message sees them (docs/design/82) */
interface TellPupil {
  student_id: string;
  name: string;
  class: string;
  class_id: string;
  class_code: string;
  display_order: number;
  held: boolean;
  fee: boolean;
  has_email: boolean;
  has_sms: boolean;
  told_email: boolean;
  told_sms: boolean;
}
