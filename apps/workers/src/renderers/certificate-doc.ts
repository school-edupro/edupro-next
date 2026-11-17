import {
  CERTIFICATE_BLOCK_CSS,
  CERTIFICATE_MARK_CSS,
  certificateBlocks,
  certificateImageIds,
  certificateMarkHtml,
  documentHtml,
  markDate,
  renderTemplate,
  tenantForJob,
  type Db,
  type JobEnvelope,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';

/**
 * One certificate of the register (docs/design/87): its frozen data through the template version it was made with —
 * a reprint is the same paper whatever changed since — with the school's logo and, on a duplicate, DUPLICATE. A
 * cancelled one prints CANCELLED across every page, with the day (17 Nov 2026).
 */
export async function renderCertificateDoc(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
) {
  const certificateId = String(params.certificateId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const r = await c.query<{
      data: Record<string, unknown>;
      copy_no: number;
      status: string;
      cancelled_on: string | null;
      body_html: string | null;
      styles_css: string | null;
      page_width: string | null;
      page_height: string | null;
      logo_key: string | null;
      logo_type: string | null;
    }>(
      `SELECT x.data, x.copy_no, x.status, (x.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date::text AS cancelled_on, v.body_html, v.styles_css, v.page_width, v.page_height,
              f.object_key AS logo_key, f.content_type AS logo_type
         FROM certificates x
         LEFT JOIN document_template_versions v ON v.id = x.template_version_id
         LEFT JOIN schools s ON s.id = x.school_id
         LEFT JOIN files f ON f.id::text = NULLIF(s.branding->>'logoFileId', '') AND f.deleted_at IS NULL
        WHERE x.id = $1`,
      [certificateId],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`certificate ${certificateId} not found`);
    if (!row.body_html) throw new Error(`certificate ${certificateId} has no template version`);
    let logo: string | null = null;
    if (row.logo_key)
      try {
        const bytes = await storage.read(row.logo_key);
        logo = `data:${row.logo_type ?? 'image/png'};base64,${bytes.toString('base64')}`;
      } catch {
        logo = null;
      }
    const cert = (row.data.cert ?? {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {
      ...row.data,
      logo,
      cert: { ...cert, copyNo: row.copy_no, duplicate: row.copy_no > 0 },
    };
    // the signature images frozen with it (stored files never change: a new image is a new file)
    const ids = certificateImageIds(data);
    const images: Record<string, string> = {};
    if (ids.length) {
      const f = await c.query<{ id: string; object_key: string; content_type: string | null }>(
        `SELECT id::text, object_key, content_type FROM files WHERE id::text = ANY($1::text[]) AND deleted_at IS NULL`,
        [ids],
      );
      for (const x of f.rows)
        try {
          const bytes = await storage.read(x.object_key);
          images[x.id] = `data:${x.content_type ?? 'image/png'};base64,${bytes.toString('base64')}`;
        } catch {
          // an image that cannot be read prints an empty box
        }
    }
    // the QR of its own check link, frozen at issue (docs/design/87, phase D)
    const qr = data.qr as { url: string; image: string } | undefined;
    data.blocks = certificateBlocks(data, { logo, images, qr: qr ?? null });
    const width = row.page_width ?? '210mm';
    const height = row.page_height ?? '297mm';
    return {
      html: documentHtml({
        body:
          (row.status === 'cancelled'
            ? certificateMarkHtml('CANCELLED', `Cancelled on ${markDate(row.cancelled_on)}`)
            : '') + renderTemplate(row.body_html, data),
        css: CERTIFICATE_BLOCK_CSS + (row.styles_css ?? '') + CERTIFICATE_MARK_CSS,
        pageWidth: width,
        pageHeight: height,
      }),
      width,
      height,
    };
  });
}
