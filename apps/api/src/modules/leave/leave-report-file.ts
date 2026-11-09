import ExcelJS from 'exceljs';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import type { SignBox } from '../purchase/purchase-doc-sign';

/** A column of a leave report: text, a count, a date (YYYY-MM-DD) or a time / hours already in words. */
export interface ReportCol {
  label: string;
  type?: 'text' | 'number' | 'date';
  /** share of the width (PDF) and the Excel width / 7 */
  width?: number;
  /** a heading over this and the next columns of the same group (CL over credited, taken, closing) */
  group?: string;
  center?: boolean;
}
export type ReportCell = string | number | null;

/** What a report builder returns: the table, with the rows that are a heading across it and page breaks. */
export interface ReportTable {
  columns: ReportCol[];
  rows: ReportCell[][];
  /** rows (by position) that are a heading across the table: an employee's name and figures */
  headings?: number[];
  /** rows (by position) printed in bold (an employee's status line in a grid) */
  strong?: number[];
  /** rows (by position) a printed page starts with: one employee a page */
  breaks?: number[];
  /** the link of each row on screen (an employee's day, a leave) */
  links?: Array<string | null>;
  /** the figures over the table (daily attendance, yesterday OUT / today IN) */
  kpis?: Array<{ label: string; value: string | number }>;
  /** the columns the PDF keeps (by position), when the page is narrower than the screen */
  pdfColumns?: number[];
  paper?: { portrait?: boolean; a3?: boolean; fontSize?: number };
  /** a line under the table: how the figures are counted */
  note?: string;
  /** what "Records" counts when it is not the rows: the employees of a grid or a card a page */
  records?: number;
}

const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const sheetName = (s: string) =>
  s
    .replace(/[*?:\\/[\]]/g, ' -')
    .replace(/\s+/g, ' ')
    .slice(0, 31);
const show = (c: ReportCol, v: ReportCell) =>
  v === null || v === ''
    ? ''
    : c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))
      ? dmy(String(v))
      : String(v);

/**
 * A leave & attendance report as Excel or PDF (docs/design/85, phase D), as the school's earlier MIS printed
 * them: the letterhead (logo; school, address, the report, the filters, the financial year, when it was made
 * and how many rows), the table — an employee's heading across it, a page each where the report is one —
 * and the Prepared by / Checked by / Principal boxes (Prepared by filled from the system).
 */
export async function leaveReportFile(x: {
  format: 'xlsx' | 'pdf';
  head: { school: string; address: string; logo: LetterheadLogo | null; generatedOn: string };
  name: string;
  slug: string;
  /** the filters in words, the financial year */
  words: string;
  table: ReportTable;
  signs: SignBox[];
}): Promise<{ filename: string; contentType: string; base64: string; rows: number }> {
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const base = `${x.slug}-${day}`;
  const t = x.table;
  const heads = new Set(t.headings ?? []);
  const count = t.records ?? t.rows.length - heads.size;
  const details = `${x.words} · Generated on ${x.head.generatedOn} · Records: ${String(count)}`;

  if (x.format === 'pdf') {
    const keep = t.pdfColumns ?? t.columns.map((_, i) => i);
    const cols = keep.map((i) => t.columns[i]!);
    const rows = t.rows.map((r) => keep.map((i) => show(t.columns[i]!, r[i] ?? null)));
    const shade: Record<number, 'subheading'> = {};
    for (const h of heads) shade[h] = 'subheading';
    const bytes = await tablePdf({
      school: x.head.school,
      address: x.head.address,
      title: x.name,
      letterhead: { logo: x.head.logo, details },
      columns: cols.map((c) => ({
        label: c.label,
        width: c.width ?? (c.type === 'text' || !c.type ? 3 : 1.2),
        right: c.type === 'number',
        center: c.center,
        group: c.group,
      })),
      rows,
      wrap: true,
      fontSize: t.paper?.fontSize ?? (cols.length > 30 ? 5.5 : cols.length > 14 ? 7 : 8),
      shade,
      strong: t.strong,
      rowCount: count,
      breakBefore: t.breaks,
      portrait: t.paper?.portrait,
      a3: t.paper?.a3,
      footnote: t.note,
      signs: x.signs,
      signsEachBreak: !!t.breaks?.length,
    });
    return {
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
      rows: count,
    };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro';
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName(x.name), {
    pageSetup: {
      orientation: t.paper?.portrait ? 'portrait' : 'landscape',
      // 8: A3, 9: A4
      paperSize: (t.paper?.a3 ? 8 : 9) as unknown as ExcelJS.PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });
  const n = Math.max(t.columns.length, 3);
  ws.columns = t.columns.map((c) => ({
    width: c.width ? Math.max(6, c.width * 7) : c.type === 'text' || !c.type ? 22 : 9,
  }));
  if (x.head.logo && /^image\/(png|jpe?g)$/.test(x.head.logo.contentType)) {
    const id = wb.addImage({
      buffer: x.head.logo.bytes as unknown as ExcelJS.Buffer,
      extension: x.head.logo.contentType === 'image/png' ? 'png' : 'jpeg',
    });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 70, height: 46 } });
  }
  for (const [text, bold, size] of [
    [x.head.school, true, 14],
    [x.head.address, false, 10],
    [x.name, true, 12],
    [details, false, 10],
  ] as Array<[string, boolean, number]>) {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, n);
    r.getCell(1).alignment = { horizontal: 'center' };
    r.getCell(1).font = { bold, size };
  }
  ws.addRow([]);
  // the group headings over their columns (CL over credited, taken …)
  if (t.columns.some((c) => c.group)) {
    const g = ws.addRow(t.columns.map((c) => c.group ?? ''));
    let i = 0;
    while (i < t.columns.length) {
      let k = i + 1;
      while (
        k < t.columns.length &&
        t.columns[k]!.group &&
        t.columns[k]!.group === t.columns[i]!.group
      )
        k += 1;
      if (t.columns[i]!.group && k - i > 1) ws.mergeCells(g.number, i + 1, g.number, k);
      i = k;
    }
    g.font = { bold: true };
    g.alignment = { horizontal: 'center' };
  }
  const head = ws.addRow(t.columns.map((c) => c.label));
  head.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  ws.views = [{ state: 'frozen', ySplit: head.number, xSplit: Math.min(2, t.columns.length) }];
  const strong = new Set(t.strong ?? []);
  t.rows.forEach((r, i) => {
    if (heads.has(i)) {
      const row = ws.addRow([String(r.find((v) => v !== null && v !== '') ?? '')]);
      ws.mergeCells(row.number, 1, row.number, n);
      row.font = { bold: true };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
      return;
    }
    const row = ws.addRow(
      t.columns.map((c, j) => {
        const v = r[j] ?? null;
        if (v === null || v === '') return null;
        if (c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v)))
          return new Date(`${String(v)}T00:00:00Z`);
        return c.type === 'number' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      }),
    );
    if (strong.has(i)) row.font = { bold: true };
  });
  t.columns.forEach((c, i) => {
    if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
  });
  if (t.note) {
    ws.addRow([]);
    const r = ws.addRow([t.note]);
    ws.mergeCells(r.number, 1, r.number, n);
    r.getCell(1).font = { italic: true, size: 9 };
  }
  // the signatures four rows under the data, the width in thirds
  for (let k = 0; k < 3; k += 1) ws.addRow([]);
  const third = Math.max(1, Math.floor(n / 3));
  const at = (k: number) => 1 + k * third;
  const lines = [
    x.signs.map((s) => s.name ?? ''),
    x.signs.map((s) =>
      [s.code ? `Emp. ID ${s.code}` : '', s.designation ?? ''].filter(Boolean).join(' · '),
    ),
    x.signs.map((s) => s.when ?? ''),
    x.signs.map((s) => s.as),
  ];
  lines.forEach((cells, li) => {
    const row = ws.addRow([]);
    cells.slice(0, 3).forEach((v, k) => {
      const from = at(k);
      const to = k === 2 ? n : at(k + 1) - 1;
      row.getCell(from).value = v;
      if (to > from) ws.mergeCells(row.number, from, row.number, to);
      if (li === 3) {
        row.getCell(from).font = { bold: true };
        row.getCell(from).border = { top: { style: 'thin' } };
      }
    });
  });
  const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return {
    filename: `${base}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
    rows: count,
  };
}
