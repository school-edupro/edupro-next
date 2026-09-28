import {
  bandFor,
  loadReportCardData,
  reportCardDocument,
  tenantForJob,
  type Db,
  type JobEnvelope,
  type ReportCardData,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';

interface TemplateLike {
  id: string;
  layout: Record<string, unknown>;
  bodyHtml: string | null;
  stylesCss: string;
  pageWidth: string;
  pageHeight: string;
}

interface Release {
  id: string;
  termCode: string;
  name: string;
  examIds: string[];
  templates: Record<string, string>;
  hideDefaulters: boolean;
  defaulterMin: number;
}

async function photoDataUri(storage: StorageDriver, key: string | null, type: string | null) {
  if (!key) return null;
  try {
    const bytes = await storage.read(key);
    return `data:${type ?? 'image/jpeg'};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

type Q = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
};

async function loadRelease(c: Q, id: string): Promise<Release> {
  const r = await c.query<{
    id: string;
    term_code: string;
    name: string;
    exam_ids: string[];
    templates: Record<string, string>;
    hide_defaulters: boolean;
    defaulter_min: string;
  }>(
    `SELECT id::text, term_code, name, exam_ids::text[] AS exam_ids, templates, hide_defaulters, defaulter_min::text FROM report_card_releases WHERE id = $1`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new Error(`release ${id} not found`);
  return {
    id: row.id,
    termCode: row.term_code,
    name: row.name,
    examIds: row.exam_ids,
    templates: row.templates ?? {},
    hideDefaulters: row.hide_defaulters,
    defaulterMin: Number(row.defaulter_min),
  };
}

async function templateFor(c: Q, rel: Release, band: string): Promise<TemplateLike> {
  const byId = rel.templates[band];
  const r = await c.query<{
    id: string;
    layout: Record<string, unknown>;
    body_html: string | null;
    styles_css: string;
    page_width: string;
    page_height: string;
  }>(
    byId
      ? `SELECT id::text, layout, body_html, styles_css, page_width, page_height FROM report_card_templates WHERE id = $1 AND deleted_at IS NULL`
      : `SELECT id::text, layout, body_html, styles_css, page_width, page_height FROM report_card_templates WHERE band = $1::class_band AND status = 'active' AND deleted_at IS NULL ORDER BY code LIMIT 1`,
    [byId ?? band],
  );
  const t = r.rows[0];
  if (!t) throw new Error(`no report-card template for band ${band}`);
  return {
    id: t.id,
    layout: t.layout,
    bodyHtml: t.body_html,
    stylesCss: t.styles_css,
    pageWidth: t.page_width,
    pageHeight: t.page_height,
  };
}

async function pupilCard(
  c: Q,
  storage: StorageDriver,
  rel: Release,
  studentId: string,
): Promise<{ data: ReportCardData; withheld: string | null }> {
  const data = await loadReportCardData(c as never, {
    studentId,
    examIds: rel.examIds,
    termCode: rel.termCode,
    termName: rel.name,
    defaulterMin: rel.defaulterMin,
  });
  data.student.photoDataUri = await photoDataUri(
    storage,
    data.student.photoObjectKey,
    data.student.photoContentType,
  );
  const withheld =
    rel.hideDefaulters && data.fees.defaulter
      ? `Report card withheld: fee dues of ₹${data.fees.balance} are pending. Please contact the accounts office.`
      : null;
  return { data, withheld };
}

async function recordCard(
  c: Q,
  rel: Release,
  studentId: string,
  exportId: string,
  withheld: string | null,
) {
  await c.query(
    `INSERT INTO report_cards (school_id, release_id, student_id, export_id, withheld, withheld_reason, rendered_at)
     VALUES (app.current_school_id(), $1, $2, $3, $4, $5, now())
     ON CONFLICT (release_id, student_id) DO UPDATE SET export_id = EXCLUDED.export_id, withheld = EXCLUDED.withheld, withheld_reason = EXCLUDED.withheld_reason, rendered_at = now()`,
    [rel.id, studentId, exportId, withheld !== null, withheld],
  );
}

/** Sprint 17: one pupil's card. */
export async function renderReportCard(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
  exportId: string,
): Promise<{ html: string; width: string; height: string }> {
  const releaseId = String(params.releaseId ?? '');
  const studentId = String(params.studentId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const rel = await loadRelease(c as Q, releaseId);
    const card = await pupilCard(c as Q, storage, rel, studentId);
    const t = await templateFor(c as Q, rel, card.data.student.band);
    await recordCard(c as Q, rel, studentId, exportId, card.withheld);
    return { html: reportCardDocument(t, [card]), width: t.pageWidth, height: t.pageHeight };
  });
}

/** Sprint 17: every pupil of a section in one PDF, page break per pupil; withheld cards print the notice. */
export async function renderReportCardBatch(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: Record<string, unknown>,
  exportId: string,
): Promise<{ html: string; width: string; height: string; pupils: number; withheld: number }> {
  const releaseId = String(params.releaseId ?? '');
  const classSectionId = String(params.classSectionId ?? '');
  return db.withTenant(tenantForJob(envelope), async (c) => {
    const rel = await loadRelease(c as Q, releaseId);
    const k = await c.query<{ band: string | null; display_order: number }>(
      `SELECT k.band::text, k.display_order FROM class_sections cs JOIN classes k ON k.id = cs.class_id WHERE cs.id = $1`,
      [classSectionId],
    );
    if (!k.rows[0]) throw new Error(`section ${classSectionId} not found`);
    const t = await templateFor(c as Q, rel, bandFor(k.rows[0].band, k.rows[0].display_order));
    const pupils = await c.query<{ id: string }>(
      `SELECT s.id::text FROM enrolments e JOIN students s ON s.id = e.student_id AND s.deleted_at IS NULL
        WHERE e.class_section_id = $1 AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
        ORDER BY e.roll_no NULLS LAST, s.display_name`,
      [classSectionId],
    );
    const cards: Array<{ data: ReportCardData; withheld: string | null }> = [];
    let withheld = 0;
    for (const p of pupils.rows) {
      const card = await pupilCard(c as Q, storage, rel, p.id);
      if (card.withheld) withheld += 1;
      await recordCard(c as Q, rel, p.id, exportId, card.withheld);
      cards.push(card);
    }
    return {
      html: reportCardDocument(t, cards),
      width: t.pageWidth,
      height: t.pageHeight,
      pupils: cards.length,
      withheld,
    };
  });
}
