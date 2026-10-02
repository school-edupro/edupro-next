import {
  buildStrengthReport,
  tenantForJob,
  type Db,
  type JobEnvelope,
  type StrengthParams,
  type StrengthTable,
} from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';
import { istStamp, letterhead, type Letterhead } from './report-builder';

/**
 * Student strength reports as files: the school letterhead, the report title and filters, a two-row
 * header where columns sit under a group (F / M / T), bold class subtotals and a grand total. Excel
 * freezes the header; PDF repeats it on every page with page numbers. The age report is wide, so it
 * prints landscape (A3 when it has many columns).
 */
export interface BuiltStrength {
  table: StrengthTable;
  letterhead: Letterhead;
  generatedAt: Date;
  requestedBy: string | null;
}

export async function buildStrength(
  db: Db,
  storage: StorageDriver,
  envelope: JobEnvelope,
  params: StrengthParams,
  requestedBy: string | null,
): Promise<BuiltStrength> {
  const tenant = tenantForJob(envelope, params.academicYearId);
  const table = await db.withTenant(tenant, (c) => buildStrengthReport(c, params));
  return {
    table,
    letterhead: await letterhead(db, storage, tenant),
    generatedAt: new Date(),
    requestedBy,
  };
}

const NAVY = 'FF00265D';
const MUTED = 'FF52606D';

/** Header groups in order: a run of columns with the same group becomes one spanning heading. */
function groups(t: StrengthTable): Array<{ label: string | null; span: number }> {
  const out: Array<{ label: string | null; span: number }> = [];
  for (const c of t.columns) {
    const last = out[out.length - 1];
    if (last && c.group && last.label === c.group) last.span += 1;
    else out.push({ label: c.group ?? null, span: 1 });
  }
  return out;
}

const twoRows = (t: StrengthTable) => t.columns.some((c) => c.group);

export async function strengthToXlsx(b: BuiltStrength): Promise<Buffer> {
  const { table: t, letterhead: lh } = b;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro';
  wb.created = b.generatedAt;
  const ws = wb.addWorksheet(t.title.slice(0, 31));
  const width = t.columns.length + 2;
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
    ws.addImage(img, { tl: { col: 0, row: 0 }, ext: { width: 52, height: 52 }, editAs: 'oneCell' });
  }
  line(lh.name, { bold: true, size: 16, color: { argb: NAVY } }, 28);
  if (lh.address) line(lh.address, { size: 10, color: { argb: MUTED } });
  line(t.title, { bold: true, size: 13, color: { argb: NAVY } }, 22);
  line(
    `${t.subtitle} · Generated ${istStamp(b.generatedAt)}${b.requestedBy ? ` by ${b.requestedBy}` : ''} · ${String(t.meta.students)} students`,
    { size: 10, color: { argb: MUTED } },
  );
  line(t.meta.filters.join('; '), { size: 10, italic: true, color: { argb: MUTED } });
  r += 1;

  const head = r;
  const header = (
    row: number,
    col: number,
    value: string,
    opts?: { mergeTo?: [number, number] },
  ) => {
    if (opts?.mergeTo) ws.mergeCells(row, col, opts.mergeTo[0], opts.mergeTo[1]);
    const cell = ws.getCell(row, col);
    cell.value = value;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { left: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  };
  const rows2 = twoRows(t);
  header(head, 1, 'Sr#', rows2 ? { mergeTo: [head + 1, 1] } : undefined);
  header(head, 2, 'Class', rows2 ? { mergeTo: [head + 1, 2] } : undefined);
  if (rows2) {
    let col = 3;
    for (const g of groups(t)) {
      if (g.label)
        header(head, col, g.label, g.span > 1 ? { mergeTo: [head, col + g.span - 1] } : undefined);
      col += g.span;
    }
    t.columns.forEach((c, i) => {
      if (c.group) header(head + 1, 3 + i, c.label);
      else header(head, 3 + i, c.label, { mergeTo: [head + 1, 3 + i] });
    });
  } else t.columns.forEach((c, i) => header(head, 3 + i, c.label));
  const first = head + (rows2 ? 2 : 1);
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 16;
  t.columns.forEach((c, i) => {
    ws.getColumn(3 + i).width = c.group ? 5.5 : Math.max(9, Math.min(22, c.label.length + 3));
  });
  let sr = 0;
  t.rows.forEach((row, n) => {
    const x = ws.getRow(first + n);
    if (row.kind === 'row') sr += 1;
    x.getCell(1).value = row.kind === 'row' ? sr : null;
    x.getCell(2).value = row.label;
    t.columns.forEach((c, i) => {
      x.getCell(3 + i).value = row.values[c.key] ?? 0;
      x.getCell(3 + i).alignment = { horizontal: 'center' };
    });
    if (row.kind !== 'row') {
      for (let i = 1; i <= width; i += 1) {
        const cell = x.getCell(i);
        cell.font = { bold: true, color: row.kind === 'total' ? { argb: 'FFFFFFFF' } : undefined };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: row.kind === 'total' ? NAVY : 'FFE6F4F8' },
        };
      }
    }
  });
  ws.views = [{ state: 'frozen', ySplit: first - 1, xSplit: 2 }];
  ws.pageSetup = {
    paperSize: (t.columns.length > 30 ? 8 : 9) as unknown as ExcelJS.PageSetup['paperSize'],
    orientation: t.columns.length > 10 ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${String(head)}:${String(first - 1)}`,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
  };
  ws.headerFooter = { oddFooter: `&L${lh.name} · ${t.title}&RPage &P of &N` };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function strengthToHtml(b: BuiltStrength): string {
  const { table: t, letterhead: lh } = b;
  const rows2 = twoRows(t);
  const paper = t.columns.length > 30 ? 'A3' : 'A4';
  const land = t.columns.length > 10;
  const font = t.columns.length > 45 ? '7px' : t.columns.length > 20 ? '8px' : '10px';
  const head1 = [
    `<th rowspan="${rows2 ? 2 : 1}">Sr#</th>`,
    `<th rowspan="${rows2 ? 2 : 1}" class="cls">Class</th>`,
    ...(rows2
      ? groups(t).map((g, gi) => {
          if (g.label) return `<th colspan="${String(g.span)}">${esc(g.label)}</th>`;
          const c =
            t.columns[
              groups(t)
                .slice(0, gi)
                .reduce((n, x) => n + x.span, 0)
            ]!;
          return `<th rowspan="2">${esc(c.label)}</th>`;
        })
      : t.columns.map((c) => `<th>${esc(c.label)}</th>`)),
  ].join('');
  const head2 = rows2
    ? `<tr>${t.columns
        .filter((c) => c.group)
        .map((c) => `<th class="sub">${esc(c.label)}</th>`)
        .join('')}</tr>`
    : '';
  let sr = 0;
  const body = t.rows
    .map((row) => {
      if (row.kind === 'row') sr += 1;
      return `<tr class="${row.kind}"><td class="num">${row.kind === 'row' ? String(sr) : ''}</td><td class="cls">${esc(row.label)}</td>${t.columns
        .map((c) => `<td class="num">${String(row.values[c.key] ?? 0)}</td>`)
        .join('')}</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>
  @page {
    size: ${paper} ${land ? 'landscape' : 'portrait'};
    margin: 10mm 8mm 12mm;
    @bottom-left { content: "${esc(lh.name).replace(/"/g, '')} · ${esc(t.title).replace(/"/g, '')}"; font: 8px Arial, sans-serif; color: #52606D; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #52606D; }
  }
  body { font-family: "Source Sans 3", "Segoe UI", Arial, sans-serif; color: #1F2933; font-size: ${font}; margin: 0; }
  .lh { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #00265D; padding-bottom: 6px; margin-bottom: 6px; }
  .lh img { height: 48px; width: auto; }
  .lh .school { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 16px; font-weight: 700; color: #00265D; }
  .lh .sub { color: #52606D; font-size: 9.5px; margin-top: 2px; }
  h1 { font-family: Poppins, "Segoe UI", Arial, sans-serif; font-size: 13px; color: #00265D; margin: 2px 0; text-align: center; }
  .meta { color: #52606D; font-size: 9px; text-align: center; margin-bottom: 6px; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  col.sr { width: 26px; } col.cl { width: 74px; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #00265D; color: #fff; padding: 3px 2px; font-weight: 600; border: 1px solid #fff; text-align: center; overflow-wrap: anywhere; }
  th.sub { background: #1D4E89; }
  td { border: 1px solid #D9DEE4; padding: 2px 3px; }
  .num { text-align: center; font-variant-numeric: tabular-nums; }
  .cls { text-align: left; white-space: nowrap; }
  tr.subtotal td { background: #E6F4F8; font-weight: 700; }
  tr.total td { background: #00265D; color: #fff; font-weight: 700; }
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
  <h1>${esc(t.title)}</h1>
  <div class="meta">${esc(t.subtitle)} · Generated ${esc(istStamp(b.generatedAt))}${b.requestedBy ? ` by ${esc(b.requestedBy)}` : ''} · ${String(t.meta.students)} students · ${esc(t.meta.filters.join('; '))}</div>
  <table><colgroup><col class="sr" /><col class="cl" />${t.columns.map(() => '<col />').join('')}</colgroup><thead><tr>${head1}</tr>${head2}</thead><tbody>
${body}
  </tbody></table>
</body></html>`;
}
