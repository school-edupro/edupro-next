import ExcelJS from 'exceljs';
import { DomainError } from '../errors/domain-error';

export interface TemplateColumn {
  header: string;
  width: number;
  /** A drop-down on the cell: only these values are accepted (unless `allowNew`). */
  options?: string[];
  required?: boolean;
  /** The drop-down suggests; a value not in the list only warns (the import adds it). */
  allowNew?: boolean;
  /** Shown as a note on the heading cell. */
  note?: string;
  /** Cell format for the column: text keeps leading zeros (accession nos.), date as dd-mm-yyyy. */
  format?: 'text' | 'date' | 'number';
}
const ROWS = 500;

/**
 * An Excel sheet to fill and upload: a header row, drop-downs on the columns that take a value from a
 * list (kept on a second sheet, so a long list works), and a "How to fill" sheet.
 */
export async function templateSheet(t: {
  sheet: string;
  columns: TemplateColumn[];
  guide: string[];
  /** Rows already there, so the sheet can be corrected and uploaded again. */
  rows?: Array<Array<string | number | null>>;
  /** Filled-in sample rows, put on their own "Example" sheet (never read on upload). */
  examples?: Array<Array<string | number | null>>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.sheet);
  const lists = wb.addWorksheet('Lists');
  const guide = wb.addWorksheet('How to fill');
  const head = (sheet: ExcelJS.Worksheet) => {
    const row = sheet.addRow(t.columns.map((c) => (c.required ? `${c.header} *` : c.header)));
    row.height = 30;
    row.eachCell((cell, n) => {
      const col = t.columns[n - 1]!;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: col.required ? 'FFB42318' : 'FF1B3A6B' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF8899AA' } } };
      const tips = [
        col.required ? 'Required.' : '',
        col.note ?? '',
        col.options
          ? col.allowNew
            ? 'Pick from the list, or type a new name.'
            : 'Pick from the list.'
          : '',
      ].filter(Boolean);
      if (tips.length) cell.note = tips.join(' ');
    });
  };
  head(ws);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  (t.rows ?? []).forEach((r) => ws.addRow(r));
  let listCol = 0;
  t.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.format === 'text') ws.getColumn(i + 1).numFmt = '@';
    if (c.format === 'date') ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
    if (c.format === 'number') ws.getColumn(i + 1).numFmt = '0.##';
    if (!c.options) return;
    listCol += 1;
    const letter = lists.getColumn(listCol).letter;
    lists.getCell(`${letter}1`).value = c.header;
    lists.getCell(`${letter}1`).font = { bold: true };
    c.options.forEach((o, k) => {
      lists.getCell(`${letter}${String(k + 2)}`).value = o;
    });
    lists.getColumn(listCol).width = Math.max(18, c.width);
    const range = `Lists!$${letter}$2:$${letter}$${String(Math.max(2, c.options.length + 1))}`;
    const col = ws.getColumn(i + 1).letter;
    for (let r = 2; r <= ROWS + 1; r += 1)
      ws.getCell(`${col}${String(r)}`).dataValidation = {
        type: 'list',
        allowBlank: !c.required,
        formulae: [range],
        showErrorMessage: true,
        errorStyle: c.allowNew ? 'warning' : 'stop',
        errorTitle: c.header,
        error: c.allowNew
          ? 'Not in the list yet. Keep it to add it to the set-up on upload, or pick from the list.'
          : 'Pick a value from the list',
      };
  });
  lists.getRow(1).font = { bold: true };
  lists.views = [{ state: 'frozen', ySplit: 1 }];
  if (t.examples?.length) {
    const ex = wb.addWorksheet('Example');
    head(ex);
    t.examples.forEach((r) => ex.addRow(r));
    t.columns.forEach((c, i) => {
      ex.getColumn(i + 1).width = c.width;
    });
    ex.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const g = guide.addRow(['How to fill']);
  g.font = { bold: true, size: 13 };
  t.guide.forEach((line, n) => guide.addRow([`${String(n + 1)}. ${line}`]));
  guide.addRow([]);
  guide.addRow(['Columns marked * (red heading) are required. Hover a heading for its note.']);
  if (t.examples?.length)
    guide.addRow(['See the "Example" sheet for filled-in rows (it is not read on upload).']);
  guide.getColumn(1).width = 110;
  guide.getColumn(1).alignment = { wrapText: true, vertical: 'top' };
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: Array<{ text: string }> };
    if (o.richText)
      return o.richText
        .map((x) => x.text)
        .join('')
        .trim();
    if (o.text !== undefined) return String(o.text).trim();
    if (o.result !== undefined) return String(o.result).trim();
    return '';
  }
  return String(v).trim();
};

/** The filled rows of an uploaded sheet, keyed by header (without the "*"), with the Excel row number. */
export async function readSheet(
  fileBase64: string,
  headers: string[],
): Promise<Array<{ row: number; cells: Record<string, string> }>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(fileBase64, 'base64') as unknown as ArrayBuffer);
  } catch {
    throw new DomainError('validation-failed', 'The file is not an Excel (.xlsx) file', {
      status: 400,
    });
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new DomainError('validation-failed', 'The file has no sheet', { status: 400 });
  const found = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) =>
    cellText(v)
      .replace(/\s*\*$/, '')
      .toLowerCase(),
  );
  const at = headers.map((h) => found.indexOf(h.toLowerCase()));
  const missing = headers.filter((_, i) => at[i] === -1);
  if (missing.length)
    throw new DomainError(
      'validation-failed',
      `The sheet has no column "${missing.join('", "')}". Download the format and fill that.`,
      { status: 400 },
    );
  const out: Array<{ row: number; cells: Record<string, string> }> = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const cells: Record<string, string> = {};
    headers.forEach((h, i) => {
      cells[h] = cellText(row.getCell(at[i]! + 1).value);
    });
    if (Object.values(cells).some((v) => v !== '')) out.push({ row: n, cells });
  });
  if (out.length > 2000)
    throw new DomainError('validation-failed', 'More than 2,000 rows; split the file', {
      status: 400,
    });
  return out;
}

/** The code of a "CODE · Name" cell (a drop-down value), or the cell as typed. */
export const codeOf = (cell: string): string => cell.split(' · ')[0]!.trim();
