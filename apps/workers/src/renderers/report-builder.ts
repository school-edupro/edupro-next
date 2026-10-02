import {
  loadStudentReportRows,
  shapeReport,
  tenantForJob,
  type Db,
  type JobEnvelope,
  type ReportResult,
  type ReportSpec,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';

/**
 * Report builder exports (saved student reports): the school's letterhead on every file. Excel gets a
 * header block (logo, school, address, affiliation, report name, academic year, filters, generated
 * on / by), a styled frozen header row with filters and print setup; PDF gets the same block, a header
 * row repeated on every page and page numbers.
 */

export interface ReportBuilderParams {
  definitionId: string;
  name: string;
  description: string | null;
  spec: ReportSpec;
  academicYearId: string;
  academicYear: string;
  sectionIds: string[] | null;
  showSensitive: boolean;
}

export interface Letterhead {
  name: string;
  address: string;
  affiliation: string | null;
  contact: string | null;
  logo: { dataUri: string; extension: 'png' | 'jpeg'; base64: string } | null;
}

export interface BuiltReport {
  result: ReportResult;
  letterhead: Letterhead;
  meta: { title: string; academicYear: string; generatedAt: Date; requestedBy: string | null };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function letterhead(
  db: Db,
  storage: StorageDriver,
  tenant: ReturnType<typeof tenantForJob>,
): Promise<Letterhead> {
  return db.withTenant(tenant, async (c) => {
    const r = await c.query<{
      name: string;
      affiliation_no: string | null;
      board: string;
      address: Record<string, unknown>;
      contact: Record<string, unknown>;
      branding: Record<string, unknown>;
    }>(
      `SELECT name, affiliation_no, board, address, contact, branding FROM schools WHERE id = app.current_school_id()`,
    );
    const s = r.rows[0]!;
    const a = s.address ?? {};
    const address = [a.line1, a.line2, a.line3, a.city, a.state, a.pin ?? a.pincode]
      .map(str)
      .filter(Boolean)
      .join(', ');
    const ct = s.contact ?? {};
    const contact =
      [str(ct.phone), str(ct.email), str(ct.website)].filter(Boolean).join(' · ') || null;
    let logo: Letterhead['logo'] = null;
    const logoId = str(s.branding?.logoFileId);
    if (/^\d{1,18}$/.test(logoId)) {
      const f = await c.query<{ object_key: string; content_type: string }>(
        `SELECT object_key, content_type FROM files WHERE id = $1 AND status = 'ready'`,
        [logoId],
      );
      const file = f.rows[0];
      if (file && /^image\/(png|jpe?g)$/.test(file.content_type)) {
        try {
          const bytes = await storage.read(file.object_key);
          if (bytes.length <= 2 * 1024 * 1024) {
            const base64 = bytes.toString('base64');
            logo = {
              dataUri: `data:${file.content_type};base64,${base64}`,
              extension: file.content_type === 'image/png' ? 'png' : 'jpeg',
              base64,
            };
          }
        } catch {
          logo = null; // a missing logo never fails a report
        }
      }
    }
    return {
      name: s.name,
      address,
      affiliation: s.affiliation_no ? `${s.board} Affiliation No. ${s.affiliation_no}` : null,
      contact,
      logo,
    };
  });
}

export async function buildReport(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: ReportBuilderParams,
  requestedBy: string | null,
): Promise<BuiltReport> {
  const tenant = tenantForJob(envelope, params.academicYearId);
  const rows = await db.withTenant(tenant, (c) =>
    loadStudentReportRows(c, {
      academicYearId: params.academicYearId,
      sectionIds: params.sectionIds,
      includeInactive: params.spec.options.includeInactive ?? false,
      showSensitive: params.showSensitive,
    }),
  );
  return {
    result: shapeReport(rows, params.spec),
    letterhead: await letterhead(db, storage, tenant),
    meta: {
      title: params.name,
      academicYear: params.academicYear,
      generatedAt: new Date(),
      requestedBy,
    },
  };
}

/** "30-09-2026 20:41 IST" */
export function istStamp(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')} IST`;
}

function landscape(spec: ReportSpec, columns: number): boolean {
  if (spec.options.orientation === 'landscape') return true;
  if (spec.options.orientation === 'portrait') return false;
  return columns > 7;
}

const NAVY = 'FF00265D';

export async function reportToXlsx(b: BuiltReport, spec: ReportSpec): Promise<Buffer> {
  const { result, letterhead: lh, meta } = b;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro';
  wb.created = meta.generatedAt;
  const ws = wb.addWorksheet(meta.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  const width = Math.max(result.columns.length, 4);
  let r = 1;
  const line = (text: string, font: Partial<ExcelJS.Font>, height?: number) => {
    ws.mergeCells(r, 1, r, width);
    const cell = ws.getCell(r, 1);
    cell.value = text;
    cell.font = font;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    if (height) ws.getRow(r).height = height;
    r += 1;
  };
  if (lh.logo) {
    const img = wb.addImage({ base64: lh.logo.base64, extension: lh.logo.extension });
    ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 56, height: 56 }, editAs: 'oneCell' });
  }
  line(lh.name, { bold: true, size: 16, color: { argb: NAVY } }, 30);
  if (lh.address) line(lh.address, { size: 10, color: { argb: 'FF52606D' } });
  const aff = [lh.affiliation, lh.contact].filter(Boolean).join(' · ');
  if (aff) line(aff, { size: 10, color: { argb: 'FF52606D' } });
  r += 0;
  line(meta.title, { bold: true, size: 14, color: { argb: NAVY } }, 24);
  line(
    `Academic year ${meta.academicYear} · Generated ${istStamp(meta.generatedAt)}${meta.requestedBy ? ` by ${meta.requestedBy}` : ''} · ${String(result.total)} student${result.total === 1 ? '' : 's'}`,
    { size: 10, color: { argb: 'FF52606D' } },
  );
  line(
    `Filters: ${result.filtersText.length ? result.filtersText.join('; ') : 'none (all students)'}`,
    { size: 10, italic: true, color: { argb: 'FF52606D' } },
  );
  const note = fieldNote(result);
  if (note) line(note, { size: 10, italic: true, color: { argb: 'FF52606D' } });
  r += 1;
  // detailed layout: a heading row above the fields of each stacked column
  if (result.layout === 'detailed' && result.groups?.length) {
    let col = 1;
    result.groups.forEach((g, gi) => {
      const span = g.keys.length;
      if (span > 1) ws.mergeCells(r, col, r, col + span - 1);
      const cell = ws.getCell(r, col);
      cell.value = g.label ?? (span > 1 ? `Column ${String(gi + 1)}` : '');
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4E89' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      col += span;
    });
    r += 1;
  }
  const headerRow = r;
  // detailed exports keep one field per Excel column, in the stacked order
  if (result.layout === 'detailed' && result.groups?.length) {
    const order = result.groups.flatMap((g) => g.keys);
    result.columns.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  }
  result.columns.forEach((c, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: NAVY } } };
    ws.getColumn(i + 1).width = c.width;
  });
  ws.getRow(headerRow).height = 30;
  result.rows.forEach((row, n) => {
    const excelRow = ws.getRow(headerRow + 1 + n);
    result.columns.forEach((c, i) => {
      const v = row[c.key];
      excelRow.getCell(i + 1).value =
        v === null || v === undefined ? null : c.type === 'number' ? Number(v) : String(v);
    });
    result.columns.forEach((c, i) => {
      if (c.highlight)
        excelRow.getCell(i + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3A3' },
        };
      else if (n % 2 === 1)
        excelRow.getCell(i + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF5F7FA' },
        };
    });
  });
  ws.views = [{ state: 'frozen', ySplit: headerRow }];
  if (result.columns.length)
    ws.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: result.columns.length },
    };
  ws.pageSetup = {
    // 9 = A4, 8 = A3 (Excel paper codes; the exceljs typings omit A3)
    paperSize: (spec.options.paper === 'A3' ? 8 : 9) as unknown as ExcelJS.PageSetup['paperSize'],
    orientation: landscape(spec, result.columns.length) ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${String(headerRow)}:${String(headerRow)}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
  };
  ws.headerFooter = {
    oddFooter: `&L${lh.name} · ${meta.title}&RPage &P of &N`,
  };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** "Excluded: …; highlighted: …" for the report header, as the office register prints it. */
function fieldNote(r: ReportResult): string | null {
  const parts = [
    r.excluded?.length ? `Excluded fields: ${r.excluded.join(', ')}` : null,
    r.highlighted?.length ? `Highlighted fields: ${r.highlighted.join(', ')}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Detailed (office-register) layout: S. No, then one column per stack, each field on its own line. */
function detailedTable(result: ReportResult): string {
  const byKey = new Map(result.columns.map((c) => [c.key, c]));
  const head = `<th class="num">S. No</th>${result.groups
    .map(
      (g) =>
        `<th>${g.label ? `<div class="glabel">${esc(g.label)}</div>` : ''}${g.keys
          .map((k) => `<div>${esc(byKey.get(k)?.header ?? k)}</div>`)
          .join('')}</th>`,
    )
    .join('')}`;
  const body = result.rows
    .map(
      (row, i) =>
        `<tr><td class="num">${String(i + 1)}</td>${result.groups
          .map(
            (g) =>
              `<td>${g.keys
                .map((k, j) => {
                  const v = row[k];
                  const text = v === null || v === undefined || v === '' ? '—' : esc(String(v));
                  const c = byKey.get(k);
                  return `<div class="${[j === 0 ? 'first' : '', c?.highlight ? 'hl' : ''].join(' ').trim()}">${text}</div>`;
                })
                .join('')}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('\n');
  return `<table class="detailed"><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table>`;
}

export function reportToHtml(b: BuiltReport, spec: ReportSpec): string {
  const { result, letterhead: lh, meta } = b;
  const detailed = result.layout === 'detailed' && (result.groups?.length ?? 0) > 0;
  const land = detailed
    ? spec.options.orientation === 'portrait'
      ? false
      : spec.options.orientation === 'landscape' || result.groups.length > 4
    : landscape(spec, result.columns.length);
  const head = result.columns
    .map((c) => `<th class="${c.type === 'number' ? 'num' : ''}">${esc(c.header)}</th>`)
    .join('');
  const body = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((c) => {
            const v = row[c.key];
            return `<td class="${[c.type === 'number' ? 'num' : '', c.highlight ? 'hl' : ''].join(' ').trim()}">${v === null || v === undefined ? '' : esc(String(v))}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('\n');
  const small =
    result.columns.length > 12 ? '8.5px' : result.columns.length > 8 ? '9.5px' : '10.5px';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(meta.title)}</title>
<style>
  @page {
    size: ${spec.options.paper} ${land ? 'landscape' : 'portrait'};
    margin: 12mm 10mm 14mm;
    @bottom-left { content: "${esc(lh.name).replace(/"/g, '')} · ${esc(meta.title).replace(/"/g, '')}"; font: 8px Arial, sans-serif; color: #52606D; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #52606D; }
  }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: ${small}; margin: 0; }
  .lh { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #00265D; padding-bottom: 8px; margin-bottom: 8px; }
  .lh img { height: 54px; width: auto; }
  .lh .school { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 17px; font-weight: 700; color: #00265D; }
  .lh .sub { color: #52606D; font-size: 10px; margin-top: 2px; }
  h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 14px; color: #00265D; margin: 4px 0 2px; }
  .meta, .filters { color: #52606D; font-size: 9.5px; margin-bottom: 3px; }
  .filters { margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #00265D; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; }
  td { border-bottom: 1px solid #E4E7EB; padding: 3px 5px; vertical-align: top; }
  tr:nth-child(even) td { background: #F5F7FA; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .hl { background: #FFF3A3 !important; }
  table.detailed th { vertical-align: bottom; line-height: 1.35; }
  table.detailed th .glabel { font-weight: 700; text-decoration: underline; margin-bottom: 2px; }
  table.detailed td { line-height: 1.45; padding: 4px 6px; }
  table.detailed td div.first { font-weight: 700; color: #00265D; }
  table.detailed td div.hl { display: inline-block; padding: 0 3px; }
  table.detailed tr:nth-child(even) td { background: #F8FAFC; }
</style></head>
<body>
  <div class="lh">
    ${lh.logo ? `<img src="${lh.logo.dataUri}" alt="" />` : ''}
    <div>
      <div class="school">${esc(lh.name)}</div>
      ${lh.address ? `<div class="sub">${esc(lh.address)}</div>` : ''}
      ${lh.affiliation || lh.contact ? `<div class="sub">${esc([lh.affiliation, lh.contact].filter(Boolean).join(' · '))}</div>` : ''}
    </div>
  </div>
  <h1>${esc(meta.title)}</h1>
  <div class="meta">Academic year ${esc(meta.academicYear)} · Generated ${esc(istStamp(meta.generatedAt))}${meta.requestedBy ? ` by ${esc(meta.requestedBy)}` : ''} · ${String(result.total)} student${result.total === 1 ? '' : 's'}</div>
  <div class="filters">Filters: ${result.filtersText.length ? esc(result.filtersText.join('; ')) : 'none (all students)'}${fieldNote(result) ? ` · ${esc(fieldNote(result)!)}` : ''}</div>
  ${
    detailed
      ? detailedTable(result)
      : `<table><thead><tr>${head}</tr></thead><tbody>
${body}
  </tbody></table>`
  }
</body></html>`;
}
