import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TEMPLATES,
  documentHtml,
  loadDocumentData,
  renderTemplate,
  sampleDocumentData,
  templatePlaceholders,
  type DocumentEntity,
  type PoolClient,
} from '@edupro/db';
import { AuditService } from '../../../common/audit/audit.service';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../../common/http/request-context';
import { ReportsService } from '../../reports/reports.service';
import type {
  CreateTemplateDto,
  PreviewTemplateDto,
  RenderTemplateDto,
  UpdateTemplateDto,
} from './templates.dto';

export interface TemplateRow {
  id: string;
  code: string;
  name: string;
  kind: 'transfer_certificate' | 'bonafide' | 'letter';
  pageWidth: string;
  pageHeight: string;
  bodyHtml: string;
  stylesCss: string;
  placeholders: string[];
  version: number;
  status: 'active' | 'inactive';
  updatedAt: string;
}

interface Db {
  id: string;
  code: string;
  name: string;
  kind: TemplateRow['kind'];
  page_width: string;
  page_height: string;
  body_html: string;
  styles_css: string;
  version: number;
  status: TemplateRow['status'];
  updated_at: Date;
}

const COLS = `id::text, code, name, kind, page_width, page_height, body_html, styles_css, version, status, updated_at`;
const toRow = (r: Db): TemplateRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  kind: r.kind,
  pageWidth: r.page_width,
  pageHeight: r.page_height,
  bodyHtml: r.body_html,
  stylesCss: r.styles_css,
  placeholders: templatePlaceholders(r.body_html),
  version: r.version,
  status: r.status,
  updatedAt: r.updated_at.toISOString(),
});

/** Entity a template kind is filled from. */
export const ENTITY_FOR_KIND: Record<TemplateRow['kind'], DocumentEntity> = {
  transfer_certificate: 'transfer_certificate',
  bonafide: 'student',
  letter: 'student',
};

/** Document templates (S7-01): editable HTML with placeholders, rendered to PDF by the export service. */
@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  async list(ctx: RequestContext): Promise<TemplateRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant
        `SELECT ${COLS} FROM document_templates WHERE deleted_at IS NULL ORDER BY kind, name`,
      );
      return r.rows.map(toRow);
    });
  }

  private async find(c: PoolClient, id: string): Promise<TemplateRow | null> {
    const r = await c.query<Db>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${COLS} FROM document_templates WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async get(ctx: RequestContext, id: string): Promise<TemplateRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.find(c, id));
    if (!row) throw new DomainError('not-found', 'Template not found');
    return row;
  }

  /** The active template of a kind, used when a caller does not name one. */
  async activeOfKind(c: PoolClient, kind: TemplateRow['kind']): Promise<TemplateRow | null> {
    const r = await c.query<Db>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
      `SELECT ${COLS} FROM document_templates WHERE kind = $1::template_kind AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
      [kind],
    );
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async create(ctx: RequestContext, dto: CreateTemplateDto): Promise<TemplateRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let row: Db;
      try {
        const r = await c.query<Db>(
          // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
          `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::template_kind, $4, $5, $6, $7, $8::jsonb, app.current_user_id(), app.current_user_id())
           RETURNING ${COLS}`,
          [
            dto.code,
            dto.name,
            dto.kind,
            dto.pageWidth,
            dto.pageHeight,
            dto.bodyHtml,
            dto.stylesCss,
            JSON.stringify(templatePlaceholders(dto.bodyHtml)),
          ],
        );
        row = r.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Template code "${dto.code}" already exists`);
        throw error;
      }
      const created = toRow(row);
      await this.audit.stage(ctx, c, {
        action: 'platform.template.create',
        entityType: 'document_templates',
        entityId: created.id,
        after: { code: created.code, name: created.name, kind: created.kind },
      });
      return created;
    });
  }

  async update(ctx: RequestContext, id: string, dto: UpdateTemplateDto): Promise<TemplateRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Template not found');
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.kind !== undefined) set('kind', dto.kind, '::template_kind');
      if (dto.pageWidth !== undefined) set('page_width', dto.pageWidth);
      if (dto.pageHeight !== undefined) set('page_height', dto.pageHeight);
      if (dto.bodyHtml !== undefined) {
        set('body_html', dto.bodyHtml);
        set('variables', JSON.stringify(templatePlaceholders(dto.bodyHtml)), '::jsonb');
        sets.push('version = version + 1');
      }
      if (dto.stylesCss !== undefined) set('styles_css', dto.stylesCss);
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      params.push(id);
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE document_templates SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`,
        params,
      );
      const after = toRow(r.rows[0]!);
      await this.audit.stage(ctx, c, {
        action: 'platform.template.edit',
        entityType: 'document_templates',
        entityId: id,
        before: { version: before.version, status: before.status, name: before.name },
        after: { version: after.version, status: after.status, name: after.name },
      });
      return after;
    });
  }

  async remove(ctx: RequestContext, id: string): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.find(c, id);
      if (!before) throw new DomainError('not-found', 'Template not found');
      await c.query(
        `UPDATE document_templates SET deleted_at = now(), status = 'inactive', updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'platform.template.delete',
        entityType: 'document_templates',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  /** Installs the platform defaults the school does not have yet (by code). */
  async installDefaults(ctx: RequestContext): Promise<TemplateRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      for (const t of DEFAULT_TEMPLATES)
        await c.query(
          `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables, created_by, updated_by)
           SELECT app.current_school_id(), $1, $2, $3::template_kind, $4, $5, $6, $7, $8::jsonb, app.current_user_id(), app.current_user_id()
            WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE code = $1 AND deleted_at IS NULL)`,
          [
            t.code,
            t.name,
            t.kind,
            t.pageWidth,
            t.pageHeight,
            t.bodyHtml,
            t.stylesCss,
            JSON.stringify(templatePlaceholders(t.bodyHtml)),
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'platform.template.install_defaults',
        entityType: 'document_templates',
        after: { codes: DEFAULT_TEMPLATES.map((t) => t.code) },
      });
      const r = await c.query<Db>(
        // eslint-disable-next-line no-restricted-syntax -- column list constant
        `SELECT ${COLS} FROM document_templates WHERE deleted_at IS NULL ORDER BY kind, name`,
      );
      return r.rows.map(toRow);
    });
  }

  /** HTML preview with sample data or a real entity (never stored, never a PDF). */
  async preview(
    ctx: RequestContext,
    id: string,
    dto: PreviewTemplateDto,
  ): Promise<{ html: string }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const t = await this.find(c, id);
      if (!t) throw new DomainError('not-found', 'Template not found');
      const entity = (dto.entity as DocumentEntity | undefined) ?? ENTITY_FOR_KIND[t.kind];
      const data = dto.entityId
        ? await loadDocumentData(c, entity, dto.entityId).catch(() => {
            throw new DomainError('not-found', 'Entity not found for the preview');
          })
        : sampleDocumentData(entity);
      return {
        html: documentHtml({
          body: renderTemplate(t.bodyHtml, data),
          css: t.stylesCss,
          pageWidth: t.pageWidth,
          pageHeight: t.pageHeight,
        }),
      };
    });
  }

  /** Queues a PDF of the template for one entity through the export service. */
  async render(ctx: RequestContext, id: string, dto: RenderTemplateDto) {
    const t = await this.get(ctx, id);
    if (t.status !== 'active')
      throw new DomainError('template.inactive', 'The template is inactive', { status: 409 });
    return this.reports.create(
      ctx,
      {
        dataset: 'document',
        format: 'pdf',
        params: { templateId: id, entity: dto.entity, entityId: dto.entityId },
        title: dto.title ?? t.name,
      },
      'platform.template.render',
    );
  }
}
