import {
  CERTIFICATE_MARK_CSS,
  certificateMarkHtml,
  documentHtml,
  loadDocumentData,
  markDate,
  renderTemplate,
  tenantForJob,
  type Db,
  type JobEnvelope,
} from '@edupro/db';

type Q = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

interface Template {
  body_html: string;
  styles_css: string;
  page_width: string;
  page_height: string;
}

async function template(c: Q, id: string): Promise<Template> {
  const t = await c.query<Template>(
    `SELECT body_html, styles_css, page_width, page_height FROM document_templates WHERE id = $1 AND kind = 'certificate' AND deleted_at IS NULL`,
    [id],
  );
  if (!t.rows[0]) throw new Error(`certificate template ${id} not found`);
  return t.rows[0];
}

/**
 * The register's word for achievement certificates (17 Nov 2026): one moved into the register (docs/design/87, phase E)
 * and cancelled there prints CANCELLED, with the day.
 */
async function marks(c: Q, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const r = await c.query<{ id: string; cancelled_on: string | null }>(
    `SELECT substr(legacy_ref, 13) AS id, (cancelled_at AT TIME ZONE 'Asia/Kolkata')::date::text AS cancelled_on
       FROM certificates
      WHERE legacy_ref = ANY($1::text[]) AND copy_no = 0 AND status = 'cancelled'`,
    [ids.map((x) => `achievement:${x}`)],
  );
  for (const x of r.rows)
    out.set(x.id, certificateMarkHtml('CANCELLED', `Cancelled on ${markDate(x.cancelled_on)}`));
  return out;
}

async function pupilBody(
  c: Q,
  t: Template,
  cert: {
    student_id: string;
    title: string;
    text: string | null;
    serial_no: string;
    issued_on: string;
  },
) {
  const data = await loadDocumentData(c as never, 'student', cert.student_id);
  return renderTemplate(t.body_html, {
    ...(data as Record<string, unknown>),
    certificate: {
      title: cert.title,
      text: cert.text ?? '',
      serialNo: cert.serial_no,
      issuedOn: cert.issued_on,
    },
  });
}

/** Sprint 19: one issued certificate (the family's download). */
export async function renderCertificate(
  db: Db,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
) {
  const certificateId = String(params.certificateId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const r = await c.query<{
      student_id: string;
      template_id: string;
      title: string;
      text: string | null;
      serial_no: string;
      issued_on: string;
    }>(
      `SELECT student_id::text, template_id::text, title, text, serial_no, issued_on::text FROM certificates_issued WHERE id = $1`,
      [certificateId],
    );
    const cert = r.rows[0];
    if (!cert) throw new Error(`certificate ${certificateId} not found`);
    const t = await template(c as Q, cert.template_id);
    const mark = (await marks(c as Q, [certificateId])).get(certificateId) ?? '';
    return {
      html: documentHtml({
        body: mark + (await pupilBody(c as Q, t, cert)),
        css: t.styles_css + CERTIFICATE_MARK_CSS,
        pageWidth: t.page_width,
        pageHeight: t.page_height,
      }),
      width: t.page_width,
      height: t.page_height,
    };
  });
}

/** Sprint 19: every certificate of one issue batch (the export id groups them), page break per pupil. */
export async function renderCertificateBatch(
  db: Db,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
  exportId: string,
) {
  const templateId = String(params.templateId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const t = await template(c as Q, templateId);
    const rows = await c.query<{
      id: string;
      student_id: string;
      title: string;
      text: string | null;
      serial_no: string;
      issued_on: string;
    }>(
      `SELECT id::text, student_id::text, title, text, serial_no, issued_on::text FROM certificates_issued WHERE export_id = $1 ORDER BY serial_no`,
      [exportId],
    );
    const marked = await marks(
      c as Q,
      rows.rows.map((x) => x.id),
    );
    const bodies: string[] = [];
    for (const cert of rows.rows) {
      const mark = marked.get(cert.id);
      const body = await pupilBody(c as Q, t, cert);
      // a cancelled one carries its word on its own page
      bodies.push(mark ? `<div class="eb-mark-host">${mark}${body}</div>` : body);
    }
    const body = bodies
      .map((b, i) =>
        i < bodies.length - 1
          ? `${b}<div class="page-break" style="page-break-after: always"></div>`
          : b,
      )
      .join('\n');
    return {
      html: documentHtml({
        body,
        css: t.styles_css + CERTIFICATE_MARK_CSS,
        pageWidth: t.page_width,
        pageHeight: t.page_height,
      }),
      width: t.page_width,
      height: t.page_height,
      count: rows.rows.length,
    };
  });
}
