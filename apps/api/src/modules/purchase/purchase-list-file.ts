import ExcelJS from 'exceljs';
import { DomainError } from '../../common/errors/domain-error';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import type { FileCell, FileColumn } from '../library/library-file';

/**
 * A purchase list (Purchase Indents, Requisitions, Orders) as on screen, filters kept, as Excel or PDF
 * (docs/design/83, "As built — list filters and exports; the letterhead"). Both carry the school's
 * letterhead (logo; name, address, what the list is, the filters and when it was made). The Excel has
 * the list, then a "Lines" sheet with one row per item line; the PDF is the list (A4 landscape).
 */
export interface ListSheet {
  columns: FileColumn[];
  rows: FileCell[][];
}

const MAX_ROWS = 5000;
const dmy = (s: string) => `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
const sheetName = (s: string) =>
  s
    .replace(/[*?:\\/[\]]/g, ' -')
    .replace(/\s+/g, ' ')
    .slice(0, 31);

/** Refuses a list longer than a file should be (narrow the filters). */
export function checkListSize(rows: number, what: string) {
  if (rows > MAX_ROWS)
    throw new DomainError(
      'validation-failed',
      `More than ${MAX_ROWS.toLocaleString('en-IN')} ${what}: narrow the filters (department, dates, status)`,
      { status: 400 },
    );
}
export const LIST_LIMIT = MAX_ROWS + 1;

export async function purchaseListFile(x: {
  format: 'xlsx' | 'pdf';
  head: { school: string; address: string; logo: LetterheadLogo | null; generatedOn: string };
  /** Purchase Indents · Purchase Requisitions · Purchase Orders */
  title: string;
  /** for the file name, e.g. Purchase-Indents */
  slug: string;
  /** the filters in words */
  words: string;
  list: ListSheet;
  /** the money columns totalled on a last line (by position) */
  sum?: number[];
  /** one row per item line (Excel only) */
  lines?: ListSheet;
}): Promise<{ filename: string; contentType: string; base64: string; rows: number }> {
  const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const base = `${x.slug}-${day}`;
  const details = `${x.words} · Generated on: ${x.head.generatedOn}`;
  const totals = x.sum?.length
    ? x.list.columns.map((_, i) =>
        i === 0
          ? 'Total'
          : x.sum!.includes(i)
            ? Math.round(x.list.rows.reduce((a, r) => a + Number(r[i] ?? 0), 0) * 100) / 100
            : '',
      )
    : null;

  if (x.format === 'pdf') {
    const show = (c: FileColumn, v: FileCell) =>
      v === null || v === undefined || v === ''
        ? ''
        : c.type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))
          ? dmy(String(v))
          : c.type === 'money'
            ? Number(v).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : String(v);
    const rows = x.list.rows.map((r) => x.list.columns.map((c, i) => show(c, r[i])));
    if (totals) rows.push(x.list.columns.map((c, i) => (i === 0 ? 'Total' : show(c, totals[i]))));
    const bytes = await tablePdf({
      school: x.head.school,
      address: x.head.address,
      title: x.title,
      subtitle: `${String(x.list.rows.length)} ${x.list.rows.length === 1 ? 'row' : 'rows'}`,
      letterhead: { logo: x.head.logo, details },
      columns: x.list.columns.map((c) => ({
        // the PDF's built-in fonts have no rupee sign
        label: c.label.replace(/₹/g, 'Rs.'),
        width: c.width ?? (c.type === 'text' || !c.type ? 3 : 1.4),
        right: c.type === 'money' || c.type === 'number',
      })),
      rows,
      wrap: true,
      fontSize: 8,
      ...(totals ? { strong: [rows.length - 1], rowCount: x.list.rows.length } : {}),
    });
    return {
      filename: `${base}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
      rows: x.list.rows.length,
    };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro';
  wb.created = new Date();
  const logoId =
    x.head.logo && /^image\/(png|jpe?g)$/.test(x.head.logo.contentType)
      ? wb.addImage({
          buffer: x.head.logo.bytes as unknown as ExcelJS.Buffer,
          extension: x.head.logo.contentType === 'image/png' ? 'png' : 'jpeg',
        })
      : null;
  const sheet = (tab: string, name: string, s: ListSheet, sumRow: (string | number)[] | null) => {
    const ws = wb.addWorksheet(sheetName(tab), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const cols = Math.max(s.columns.length, 1);
    ws.columns = s.columns.map((c) => ({
      width: c.width ? Math.max(10, c.width * 7) : c.type === 'text' || !c.type ? 24 : 13,
    }));
    // the letterhead: the logo on the left, the lines centred over the table
    if (logoId !== null)
      ws.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 70, height: 46 } });
    for (const [text, bold, size] of [
      [x.head.school, true, 14],
      [x.head.address, false, 10],
      [name, true, 12],
      [details, false, 10],
    ] as Array<[string, boolean, number]>) {
      const r = ws.addRow([text]);
      ws.mergeCells(r.number, 1, r.number, cols);
      r.getCell(1).alignment = { horizontal: 'center' };
      r.getCell(1).font = { bold, size };
    }
    ws.addRow([]);
    const head = ws.addRow(s.columns.map((c) => c.label));
    head.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    ws.views = [{ state: 'frozen', ySplit: head.number }];
    ws.autoFilter = {
      from: { row: head.number, column: 1 },
      to: { row: head.number, column: cols },
    };
    const cellOf = (c: FileColumn, v: FileCell) =>
      v === null || v === undefined || v === ''
        ? null
        : c.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v))
          ? new Date(`${String(v)}T00:00:00Z`)
          : c.type === 'money' || c.type === 'number'
            ? Number(v)
            : v;
    for (const r of s.rows) ws.addRow(s.columns.map((c, i) => cellOf(c, r[i])));
    if (sumRow) ws.addRow(sumRow).font = { bold: true };
    s.columns.forEach((c, i) => {
      if (c.type === 'date') ws.getColumn(i + 1).numFmt = 'dd-mm-yyyy';
      if (c.type === 'money') ws.getColumn(i + 1).numFmt = '#,##0.00';
    });
  };
  sheet(x.title, x.title, x.list, totals);
  if (x.lines) sheet('Lines', `${x.title}: item lines`, x.lines, null);
  const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return {
    filename: `${base}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
    rows: x.list.rows.length,
  };
}
