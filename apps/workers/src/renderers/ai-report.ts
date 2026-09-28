import { documentHtml, tenantForJob, type Db, type JobEnvelope, type ReportFact } from '@edupro/db';

export interface RenderedReport {
  html: string;
  width: string;
  height: string;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (f: ReportFact): string => {
  if (f.value === null || f.value === undefined) return '—';
  if (f.unit === '₹') return `₹${Number(f.value).toLocaleString('en-IN')}`;
  if (f.unit === '%') return `${f.value}%`;
  return String(f.value);
};

const CSS = `
body { font-family: 'Source Sans 3', 'Segoe UI', sans-serif; color: #1a1f36; font-size: 11pt; }
h1 { font-size: 18pt; margin: 0 0 2mm; color: #0b2a5b; }
.meta { color: #5b6479; margin-bottom: 6mm; }
.narrative p { margin: 0 0 3mm; line-height: 1.45; }
cite { color: #0b7285; font-style: normal; font-size: 9pt; }
table { border-collapse: collapse; width: 100%; margin-top: 6mm; font-size: 9.5pt; }
th, td { border-bottom: 1px solid #d9dde7; padding: 1.6mm 2mm; text-align: left; vertical-align: top; }
th { background: #eef2f8; }
td.num { text-align: right; white-space: nowrap; }
.foot { margin-top: 8mm; color: #5b6479; font-size: 8.5pt; }
`;

/** Sprint 16: renders an ai_reports row (narrative with citations, then the facts table) to the A4 PDF page. */
export async function renderAiReport(
  db: Db,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
): Promise<RenderedReport> {
  const reportId = String(params.reportId ?? '');
  if (!/^\d{1,18}$/.test(reportId)) throw new Error('reportId is required');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const r = await c.query<{
      title: string;
      kind: string;
      department: string | null;
      period_from: string;
      period_to: string;
      narrative: string;
      facts: ReportFact[];
      citations: string[];
      provider: string;
      model: string;
      school: string;
      created_at: Date;
    }>(
      `SELECT a.title, a.kind, a.department, a.period_from::text, a.period_to::text, a.narrative, a.facts, a.citations, a.provider, a.model, a.created_at,
              (SELECT name FROM schools WHERE id = a.school_id) AS school
         FROM ai_reports a WHERE a.id = $1`,
      [reportId],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`ai report ${reportId} not found`);
    const paragraphs = row.narrative
      .split(/\n+/)
      .filter((p) => p.trim())
      .map((p) => `<p>${esc(p).replace(/\[([a-z_]+\.[a-z_]+)\]/g, '<cite>[$1]</cite>')}</p>`)
      .join('');
    const facts = (row.facts ?? [])
      .map(
        (f) =>
          `<tr><td><code>${esc(f.id)}</code></td><td>${esc(f.label)}</td><td class="num">${esc(fmt(f))}</td><td>${esc(
            Object.entries(f.detail ?? {})
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(' · '),
          )}</td></tr>`,
      )
      .join('');
    const body = `
      <h1>${esc(row.title)}</h1>
      <div class="meta">${esc(row.school)} · ${esc(row.period_from)} to ${esc(row.period_to)}${row.department ? ` · ${esc(row.department)}` : ''}</div>
      <div class="narrative">${paragraphs}</div>
      <table><thead><tr><th>Fact</th><th>What it measures</th><th>Value</th><th>Detail</th></tr></thead><tbody>${facts}</tbody></table>
      <div class="foot">Every figure comes from the named query; the text was written by ${esc(row.provider)} (${esc(row.model)}) on ${esc(
        row.created_at.toISOString().slice(0, 10),
      )}. Citations in brackets name the fact each sentence relies on.</div>`;
    return {
      html: documentHtml({ body, css: CSS, pageWidth: '210mm', pageHeight: '297mm' }),
      width: '210mm',
      height: '297mm',
    };
  });
}
