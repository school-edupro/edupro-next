import {
  CERTIFICATE_BLOCK_CSS,
  certificateBlocks,
  certificateImageIds,
  renderTemplate,
  tenantForJob,
  type Db,
  type JobEnvelope,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';

/**
 * The certificates of a batch (docs/design/87, phase E): each its frozen data through its template version, one a
 * page, in the batch's order (roll numbers), with the logo, the signature images and its own QR.
 */
export async function renderCertificateBatchDoc(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
) {
  const batchId = String(params.batchId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const b = await c.query<{ ids: string[] }>(
      `SELECT certificate_ids::text[] AS ids FROM certificate_batches WHERE id = $1`,
      [batchId],
    );
    const ids = b.rows[0]?.ids ?? [];
    if (!ids.length) throw new Error(`certificate batch ${batchId} has no certificates`);
    const rows = await c.query<{
      id: string;
      data: Record<string, unknown>;
      copy_no: number;
      body_html: string | null;
      styles_css: string | null;
      page_width: string | null;
      page_height: string | null;
      version_id: string | null;
    }>(
      `SELECT x.id::text, x.data, x.copy_no, v.body_html, v.styles_css, v.page_width, v.page_height, v.id::text AS version_id
         FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, n)
         JOIN certificates x ON x.id = o.id
         LEFT JOIN document_template_versions v ON v.id = x.template_version_id
        ORDER BY o.n`,
      [ids],
    );
    const logoRow = await c.query<{ object_key: string; content_type: string | null }>(
      `SELECT f.object_key, f.content_type FROM schools s
         JOIN files f ON f.id::text = NULLIF(s.branding->>'logoFileId', '') AND f.deleted_at IS NULL
        WHERE s.id = app.current_school_id()`,
    );
    const read = async (key: string, type: string | null) => {
      try {
        const bytes = await storage.read(key);
        return `data:${type ?? 'image/png'};base64,${bytes.toString('base64')}`;
      } catch {
        return null;
      }
    };
    const logo = logoRow.rows[0]
      ? await read(logoRow.rows[0].object_key, logoRow.rows[0].content_type)
      : null;
    const allIds = [...new Set(rows.rows.flatMap((r) => certificateImageIds(r.data)))];
    const images: Record<string, string> = {};
    if (allIds.length) {
      const f = await c.query<{ id: string; object_key: string; content_type: string | null }>(
        `SELECT id::text, object_key, content_type FROM files WHERE id::text = ANY($1::text[]) AND deleted_at IS NULL`,
        [allIds],
      );
      for (const x of f.rows) {
        const uri = await read(x.object_key, x.content_type);
        if (uri) images[x.id] = uri;
      }
    }
    const first = rows.rows.find((r) => r.body_html);
    const width = first?.page_width ?? '210mm';
    const height = first?.page_height ?? '297mm';
    const css = new Map<string, string>();
    const pages: string[] = [];
    for (const r of rows.rows) {
      if (!r.body_html) continue;
      if (r.version_id && !css.has(r.version_id)) css.set(r.version_id, r.styles_css ?? '');
      const cert = (r.data.cert ?? {}) as Record<string, unknown>;
      const data: Record<string, unknown> = {
        ...r.data,
        logo,
        cert: { ...cert, copyNo: r.copy_no, duplicate: r.copy_no > 0 },
      };
      const qr = data.qr as { url: string; image: string } | undefined;
      data.blocks = certificateBlocks(data, { logo, images, qr: qr ?? null });
      pages.push(`<div class="eb-page">${renderTemplate(r.body_html, data)}</div>`);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${width} ${height}; margin: 0; }
  html, body { margin: 0; padding: 0; font-family: "Source Sans 3", "Noto Sans Devanagari", Arial, sans-serif; color: #1F2933; }
  .eb-page { width: ${width}; min-height: ${height}; box-sizing: border-box; padding: 18mm 16mm; page-break-after: always; break-after: page; }
  .eb-page:last-child { page-break-after: auto; break-after: auto; }
  ${CERTIFICATE_BLOCK_CSS}
  ${[...css.values()].join('\n')}
  </style></head><body>${pages.join('')}</body></html>`;
    return { html, width, height, count: pages.length };
  });
}
