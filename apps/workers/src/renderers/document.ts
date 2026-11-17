import {
  CERTIFICATE_MARK_CSS,
  certificateMarkHtml,
  documentHtml,
  loadDocumentData,
  markDate,
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
 * requester's tenant context. The template's own page size wins over the renderer default. A transfer certificate
 * that was cancelled prints CANCELLED across the page, with the day (17 Nov 2026).
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
    let mark = '';
    if (entity === 'transfer_certificate') {
      const tc = await c.query<{ status: string; cancelled_on: string | null }>(
        `SELECT status, (cancelled_at AT TIME ZONE 'Asia/Kolkata')::date::text AS cancelled_on
           FROM transfer_certificates WHERE id = $1`,
        [entityId],
      );
      if (tc.rows[0]?.status === 'cancelled')
        mark = certificateMarkHtml(
          'CANCELLED',
          `Cancelled on ${markDate(tc.rows[0].cancelled_on)}`,
        );
    }
    return {
      html: documentHtml({
        body: mark + renderTemplate(template.body_html, data),
        css: template.styles_css + (mark ? CERTIFICATE_MARK_CSS : ''),
        pageWidth: template.page_width,
        pageHeight: template.page_height,
      }),
      width: template.page_width,
      height: template.page_height,
    };
  });
}
