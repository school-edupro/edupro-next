import {
  documentHtml,
  loadDocumentData,
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
    return {
      html: documentHtml({
        body: await pupilBody(c as Q, t, cert),
        css: t.styles_css,
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
      student_id: string;
      title: string;
      text: string | null;
      serial_no: string;
      issued_on: string;
    }>(
      `SELECT student_id::text, title, text, serial_no, issued_on::text FROM certificates_issued WHERE export_id = $1 ORDER BY serial_no`,
      [exportId],
    );
    const bodies: string[] = [];
    for (const cert of rows.rows) bodies.push(await pupilBody(c as Q, t, cert));
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
        css: t.styles_css,
        pageWidth: t.page_width,
        pageHeight: t.page_height,
      }),
      width: t.page_width,
      height: t.page_height,
      count: rows.rows.length,
    };
  });
}
