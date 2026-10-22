import ExcelJS from 'exceljs';
import { DomainError } from '../../common/errors/domain-error';
import { tablePdf } from '../engagement/table-pdf';

/** A column of a library report file: text, a number (₹ or a count) or a day (YYYY-MM-DD). */
export interface FileColumn {
  label: string;
  type?: 'text' | 'number' | 'money' | 'date';
  width?: number;
}
export type FileCell = string | number | null | undefined;

const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000);
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;

/** A sheet of a report file: its columns and rows; `headings` are rows written across the sheet in bold. */
export interface FileSheet {
  name: string;
  columns: FileColumn[];
  rows: FileCell[][];
  totals?: FileCell[];
  /** the rows (by position) that are a heading across the sheet: their first cell is the words */
  headings?: number[];
}

const cellOf = (c: FileColumn, v: FileCell) =>
  v === null || v === undefined || v === ''
    ? null
    : c.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))
      ? new Date(`${String(v).slice(0, 10)}T00:00:00Z`)
      : c.type === 'number' || c.type === 'money'
        ? Number(v)
        : v;

function addSheet(wb: ExcelJS.Workbook, x: FileSheet) {
  // a sheet's name may not have * ? : \ / [ ] and is at most 31 characters
  const ws = wb.addWorksheet(
    x.name
      .replace(/[*?:\\/[\]]/g, ' -')
      .replace(/\s+/g, ' ')
      .slice(0, 31),
  );
  ws.columns = x.columns.map((c) => ({
    header: c.label,
    width: c.width ? c.width * 7 : c.type === 'text' || !c.type ? 24 : 12,
  }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (!x.headings?.length)
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: x.columns.length } };
  const headings = new Set(x.headings ?? []);
  x.rows.forEach((r, i) => {
    if (headings.has(i)) {
      const row = ws.addRow([r[0] ?? '']);
      row.font = { bold: true };
      ws.mergeCells(row.number, 1, row.number, x.columns.length);
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF6' } };
    } else ws.addRow(x.columns.map((c, j) => cellOf(c, r[j])));
  });
  if (x.totals) ws.addRow(x.columns.map((c, i) => cellOf(c, x.totals![i]))).font = { bold: true };
  x.columns.forEach((c, i) => {
    if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
    if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
  });
}

/**
 * A library report as Excel (the rows, then "About this report": the school, when, who, the filters in
 * words) or as a PDF (A4 landscape, the school band, the filters under the title); made at once.
 */
export async function libraryFile(x: {
  format: 'xlsx' | 'pdf';
  name: string;
  /** for the file name, e.g. Library-fines-collected */
  slug: string;
  school: string;
  by: string;
  /** the filters in words */
  words: string;
  columns: FileColumn[];
  rows: FileCell[][];
  /** a last line of totals, by column (empty where none) */
  totals?: FileCell[];
  /** more sheets after the first (Excel only), e.g. each person's books under a heading row */
  more?: FileSheet[];
}): Promise<{ filename: string; contentType: string; base64: string; rows: number }> {
  const stamp = ist(new Date());
  const day = stamp.toISOString().slice(0, 10);
  const base = `${x.slug}-${day}`;
  if (x.format === 'pdf') {
    if (x.columns.length > 25)
      throw new DomainError('validation-failed', 'Too many columns for a PDF page: use Excel', {
        status: 400,
      });
    const show = (c: FileColumn, v: FileCell) =>
      v === null || v === undefined || v === ''
        ? ''
        : c.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))
          ? dmy(String(v))
          : c.type === 'money'
            ? Number(v).toFixed(2)
            : v;
    const rows = x.rows.map((r) => x.columns.map((c, i) => show(c, r[i])));
    const bytes = await tablePdf({
      school: x.school,
      title: x.name,
      subtitle: [`${String(x.rows.length)} rows · ${x.words}`, `${dmy(day)} · ${x.by}`],
      columns: x.columns.map((c) => ({
        // the PDF's built-in fonts have no rupee sign
        label: c.label.replace(/₹/g, 'Rs.'),
        width: c.width ?? (c.type === 'text' || !c.type ? 3 : 1.4),
        right: c.type === 'number' || c.type === 'money',
      })),
      rows: x.totals ? [...rows, x.columns.map((c, i) => show(c, x.totals![i]))] : rows,
      strong: x.totals ? [rows.length] : undefined,
      rowCount: rows.length,
      fontSize: x.columns.length > 10 ? 7.5 : 8.5,
      wrap: true,
    });
    return {
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
      rows: x.rows.length,
    };
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro';
  wb.created = new Date();
  addSheet(wb, { name: x.name, columns: x.columns, rows: x.rows, totals: x.totals });
  for (const m of x.more ?? []) addSheet(wb, m);
  const about = wb.addWorksheet('About this report');
  (
    [
      ['School', x.school],
      ['Report', x.name],
      ['Made on', stamp],
      ['By', x.by],
      ['Rows', String(x.rows.length)],
      ['Filters', x.words],
    ] as Array<[string, string | Date]>
  ).forEach(([k, v]) => {
    const r = about.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    if (v instanceof Date) r.getCell(2).numFmt = 'dd-mm-yyyy hh:mm';
  });
  about.getColumn(1).width = 14;
  about.getColumn(2).width = 80;
  const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return {
    filename: `${base}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
    rows: x.rows.length,
  };
}
