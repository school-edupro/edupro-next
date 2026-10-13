import ExcelJS from 'exceljs';
import { generatedOn } from '../attendance/register-file';
import { tablePdf } from '../engagement/table-pdf';
import type { MisBlock, MisColumn, MisReport, MisRow } from './fee-mis.service';

// the look of the school's own report sheets: a title band, a shaded header, shaded headings and
// subtotals, and a dark grand total
const FILL = {
  header: 'FFEEF1FB',
  heading: 'FFEEF1FB',
  subheading: 'FFE9ECFB',
  subtotal: 'FFF4F6FB',
  total: 'FFDFE4F7',
  grand: 'FF1C2A70',
};
const INK = { header: 'FF283897', sub: 'FF2A295C', total: 'FF1C2A70', white: 'FFFFFFFF' };
const MONEY = '#,##0.00';
const solid = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});
const thin = { style: 'thin' as const, color: { argb: 'FFC9D0E6' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };

/** How a row is dressed: a heading across the table, a subtotal, the grand total, or a plain line. */
function dress(r: MisRow): 'heading' | 'subheading' | 'subtotal' | 'total' | 'grand' | null {
  if (r.kind === 'group') return r.level === 2 ? 'subheading' : 'heading';
  if (r.kind === 'subtotal') return r.level === 1 ? 'total' : 'subtotal';
  if (r.kind === 'total') return 'grand';
  return null;
}

/** The closing line: the rule of the figures, and which columns were left out of this copy. */
const closing = (r: MisReport): string =>
  r.hidden && r.hidden.length > 0
    ? `${r.note} Columns left out of this copy: ${r.hidden.join(', ')}. The totals still include them.`
    : r.note;

const value = (r: MisRow, c: MisColumn): string | number => {
  const v = r.cells[c.key];
  if (v === null || v === undefined) return '';
  return c.type === 'number' && typeof v === 'number' ? Number(v.toFixed(2)) : v;
};

/** The Excel file: the same columns, headings, subtotals and totals as the screen, then the summary tables. */
export async function misXlsx(
  r: MisReport,
  school: { name: string; address: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  const ws = wb.addWorksheet(r.sheet ?? r.title.slice(0, 28).replace(/[\\/*?:[\]]/g, ' '));
  const cols = r.columns;
  const last = cols.length;
  // the label of a subtotal sits over the text columns before the first figure
  const firstNumber = cols.findIndex((c) => c.type === 'number' && c.key !== 'sr');
  const labelSpan = firstNumber > 0 ? firstNumber : 1;

  ws.addRow([school.name]);
  ws.mergeCells(1, 1, 1, last);
  ws.getRow(1).height = 38;
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.addRow([[r.title, ...r.filters, generatedOn()].join('  ·  ')]);
  ws.mergeCells(2, 1, 2, last);
  ws.getCell(2, 1).font = { bold: true, size: 10, color: { argb: INK.sub } };
  ws.getCell(2, 1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(2).height = 20;

  let top = 3;
  if (cols.some((c) => c.group)) {
    ws.addRow(cols.map((c) => c.group ?? ''));
    for (let i = 0; i < cols.length;) {
      const g = cols[i]!.group;
      let k = i + 1;
      while (g && k < cols.length && cols[k]!.group === g) k += 1;
      if (g && k - i > 1) ws.mergeCells(top, i + 1, top, k);
      i = k;
    }
    top += 1;
  }
  ws.addRow(cols.map((c) => c.label));
  for (let rr = 3; rr <= top; rr += 1) {
    ws.getRow(rr).height = rr === top ? 30 : 20;
    for (let c = 1; c <= last; c += 1) {
      const cell = ws.getCell(rr, c);
      cell.fill = solid(FILL.header);
      cell.font = { bold: true, size: 10, color: { argb: INK.header } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
    }
  }

  for (const row of r.rows) {
    const how = dress(row);
    const n = ws.rowCount + 1;
    if (how === 'heading' || how === 'subheading') {
      ws.addRow([row.label ?? '']);
      ws.mergeCells(n, 1, n, last);
      const cell = ws.getCell(n, 1);
      cell.fill = solid(FILL[how]);
      cell.font = { bold: true, color: { argb: how === 'heading' ? INK.header : INK.sub } };
      continue;
    }
    ws.addRow(cols.map((c) => value(row, c)));
    if (how && row.label) {
      ws.getCell(n, 1).value = row.label;
      if (labelSpan > 1) ws.mergeCells(n, 1, n, labelSpan);
    }
    for (let c = 1; c <= last; c += 1) {
      const cell = ws.getCell(n, c);
      const col = cols[c - 1]!;
      cell.border = BOX;
      if (col.type === 'number' && col.key !== 'sr' && typeof cell.value === 'number')
        cell.numFmt = MONEY;
      cell.alignment = { horizontal: col.type === 'number' ? 'right' : 'left', vertical: 'top' };
      if (how) {
        cell.fill = solid(FILL[how]);
        cell.font = {
          bold: true,
          color: { argb: how === 'grand' ? INK.white : how === 'total' ? INK.total : INK.sub },
        };
      }
    }
  }
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(6, c.width * 1.35);
  });

  // the summary tables, each on its own under the list, starting at the second column
  for (const b of r.blocks ?? []) {
    ws.addRow([]);
    ws.addRow([]);
    const at = ws.rowCount + 1;
    const start = Math.min(2, last);
    ws.getCell(at, start).value = b.title;
    ws.getCell(at, start).font = { bold: true, size: 12, color: { argb: INK.total } };
    const headAt = at + 1;
    b.columns.forEach((c, i) => {
      const cell = ws.getCell(headAt, start + i);
      cell.value = c.label;
      cell.fill = solid(FILL.header);
      cell.font = { bold: true, color: { argb: INK.header } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BOX;
    });
    b.rows.forEach((row, k) => {
      const how = dress(row);
      b.columns.forEach((c, i) => {
        const cell = ws.getCell(headAt + 1 + k, start + i);
        cell.value = how && i === 0 && row.label ? row.label : value(row, c);
        cell.border = BOX;
        if (c.type === 'number' && typeof cell.value === 'number' && c.key !== 'count')
          cell.numFmt = MONEY;
        cell.alignment = { horizontal: c.type === 'number' ? 'right' : 'left' };
        if (how) {
          cell.fill = solid(FILL.total);
          cell.font = { bold: true, color: { argb: INK.total } };
        }
      });
    });
  }

  ws.addRow([]);
  const noteAt = ws.rowCount + 1;
  ws.getCell(noteAt, 1).value = closing(r);
  ws.mergeCells(noteAt, 1, noteAt, Math.min(last, 12));
  ws.getCell(noteAt, 1).font = { italic: true, size: 9 };
  ws.getCell(noteAt, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(noteAt).height = 42;

  ws.views = [{ state: 'frozen', ySplit: top }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** The PDF: the same table with shaded headings and totals, the summary tables under it. */
export async function misPdf(
  r: MisReport,
  school: { name: string; address: string },
): Promise<Buffer> {
  const cols = r.columns;
  const firstText = cols.findIndex((c) => c.type === 'text');
  const strong: number[] = [];
  const shade: Record<number, 'heading' | 'subheading' | 'subtotal' | 'total' | 'grand'> = {};
  const cellOf = (row: MisRow, c: MisColumn): string | number => {
    const v = value(row, c);
    return typeof v === 'number' && c.type === 'number' && c.key !== 'sr' && c.key !== 'count'
      ? v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : v;
  };
  const rows = r.rows.map((row, i) => {
    const how = dress(row);
    if (how) {
      strong.push(i);
      shade[i] = how;
    }
    if (how === 'heading' || how === 'subheading') return [row.label ?? ''];
    return cols.map((c, k) =>
      how && row.label && k === Math.max(firstText, 0) ? row.label : cellOf(row, c),
    );
  });
  const block = (b: MisBlock) => ({
    title: b.title,
    columns: b.columns.map((c) => ({ label: c.label, width: c.width, right: c.type === 'number' })),
    rows: b.rows.map((row) =>
      b.columns.map((c, k) => (dress(row) && k === 0 && row.label ? row.label : cellOf(row, c))),
    ),
    total: b.rows.some((x) => x.kind === 'total'),
  });
  return tablePdf({
    school: school.name,
    address: school.address || undefined,
    title: r.title,
    subtitle: [[...r.filters, generatedOn()].join(' · ')],
    columns: cols.map((c) => ({
      label: c.label,
      width: c.width,
      right: c.type === 'number',
      group: c.group,
    })),
    rows,
    strong,
    shade,
    after: (r.blocks ?? []).map(block),
    footnote: closing(r),
    fontSize: cols.length > 40 ? 4.5 : cols.length > 28 ? 5.5 : cols.length > 18 ? 6.5 : 8,
    wrap: true,
  });
}
