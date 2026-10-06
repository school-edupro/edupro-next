import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { tablePdf } from '../engagement/table-pdf';

export interface RegisterSheet {
  school: string;
  address: string;
  /** The name of the report, e.g. "Bus attendance register". */
  report: string;
  /** What it is of and when it was made: route or class, month, generated on. */
  details: string[];
  legend: string;
  columns: Array<{
    label: string;
    width: number;
    right?: boolean;
    center?: boolean;
    /** A heading over consecutive columns of the same group (a date over M and A). */
    group?: string;
  }>;
  rows: Array<Array<string | number>>;
  /** Without the extension. */
  filename: string;
}

/** The school's name and one-line address for the head of a report. */
export async function schoolHead(c: PoolClient): Promise<{ name: string; address: string }> {
  const r = await c.query<{ name: string; address: string | null }>(
    `SELECT name, NULLIF(concat_ws(', ', NULLIF(address->>'line1', ''), NULLIF(address->>'line2', ''), NULLIF(address->>'area', ''), NULLIF(address->>'city', ''),
                 NULLIF(address->>'district', ''), NULLIF(address->>'state', ''), NULLIF(COALESCE(address->>'pincode', address->>'pin'), '')), '') AS address
       FROM schools WHERE id = app.current_school_id()`,
  );
  return { name: r.rows[0]?.name ?? '', address: r.rows[0]?.address ?? '' };
}

export const generatedOn = (): string =>
  `Generated on ${new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })}`;

export const monthName = (m: string): string =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * A register as Excel or PDF with the same head on both: the school's name and address, the name of the
 * report, what it is of and when it was generated, then the table (with a heading row over grouped
 * columns) and the legend.
 */
export async function registerFile(t: RegisterSheet, format: 'xlsx' | 'pdf') {
  if (format === 'pdf')
    return {
      bytes: await tablePdf({
        school: t.school,
        address: t.address || undefined,
        title: t.report,
        subtitle: [t.details.join(' · '), t.legend],
        columns: t.columns,
        rows: t.rows,
        fontSize: t.columns.length > 50 ? 5.5 : t.columns.length > 30 ? 6.5 : 8,
        wrap: true,
      }),
      filename: `${t.filename}.pdf`,
      contentType: 'application/pdf',
    };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Register');
  const last = t.columns.length;
  const heads: Array<[string, Partial<ExcelJS.Font>]> = [
    [t.school, { bold: true, size: 14 }],
    [t.address, { size: 10 }],
    [t.report, { bold: true, size: 12 }],
    [t.details.join(' · '), { size: 10 }],
    [t.legend, { size: 9, italic: true }],
  ];
  heads.forEach(([text, font], i) => {
    ws.addRow([text]);
    ws.mergeCells(i + 1, 1, i + 1, last);
    ws.getRow(i + 1).font = font;
    ws.getRow(i + 1).alignment = { horizontal: 'center' };
  });
  let top = heads.length + 1;
  const grouped = t.columns.some((c) => c.group);
  if (grouped) {
    ws.addRow(t.columns.map((c) => c.group ?? ''));
    for (let i = 0; i < t.columns.length;) {
      const g = t.columns[i]!.group;
      let k = i + 1;
      while (g && k < t.columns.length && t.columns[k]!.group === g) k += 1;
      if (g && k - i > 1) ws.mergeCells(top, i + 1, top, k);
      i = k;
    }
    ws.getRow(top).font = { bold: true };
    ws.getRow(top).alignment = { horizontal: 'center' };
    top += 1;
  }
  ws.addRow(t.columns.map((c) => c.label));
  ws.getRow(top).font = { bold: true };
  ws.getRow(top).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  for (const r of t.rows) ws.addRow(r);
  const thin = { style: 'thin' as const, color: { argb: 'FFB8C0CC' } };
  for (let r = heads.length + 1; r <= ws.rowCount; r += 1)
    for (let col = 1; col <= last; col += 1)
      ws.getCell(r, col).border = { top: thin, left: thin, bottom: thin, right: thin };
  t.columns.forEach((c, i) => {
    const column = ws.getColumn(i + 1);
    column.width = Math.max(4, c.width * 1.3);
    for (let r = top + 1; r <= ws.rowCount; r += 1)
      ws.getCell(r, i + 1).alignment = {
        horizontal: c.right ? 'right' : c.center ? 'center' : 'left',
      };
  });
  ws.views = [{ state: 'frozen', ySplit: top, xSplit: 2 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  return {
    bytes: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
    filename: `${t.filename}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
