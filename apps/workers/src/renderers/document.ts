import {
  documentHtml,
  loadDocumentData,
  renderTemplate,
  tenantForJob,
  type Db,
  type DocumentEntity,
  type JobEnvelope,
} from '@edupro/db';

export interface RenderedDocument {
  html: string;
  width: string;
  height: string;
}

/**
 * Sprint 7: fills a document template (transfer certificate, bonafide, letter) for one entity under the
 * requester's tenant context. The template's own page size wins over the renderer default.
 */
export async function renderDocument(
  db: Db,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
): Promise<RenderedDocument> {
  const templateId = String(params.templateId ?? '');
  const entity = String(params.entity ?? '') as DocumentEntity;
  const entityId = String(params.entityId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const t = await c.query<{
      body_html: string;
      styles_css: string;
      page_width: string;
      page_height: string;
    }>(
      `SELECT body_html, styles_css, page_width, page_height FROM document_templates WHERE id = $1 AND deleted_at IS NULL`,
      [templateId],
    );
    const template = t.rows[0];
    if (!template) throw new Error(`template ${templateId} not found`);
    const data = await loadDocumentData(c, entity, entityId);
    return {
      html: documentHtml({
        body: renderTemplate(template.body_html, data),
        css: template.styles_css,
        pageWidth: template.page_width,
        pageHeight: template.page_height,
      }),
      width: template.page_width,
      height: template.page_height,
    };
  });
}
