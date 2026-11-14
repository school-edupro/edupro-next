import ExcelJS from 'exceljs';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf, type TablePdf } from '../engagement/table-pdf';
import { registerGeneratedOn } from '../exams/register-head';
import type { SignBox } from '../purchase/purchase-doc-sign';

/**
 * One report as a grid (docs/design/86, phase F): the screen, Excel, PDF and CSV are all drawn from it, so a download
 * is always what the screen shows — the same filters, rows, subtotals and totals, and the PROVISIONAL line while a run
 * of the period is approved but not locked. Money is kept as rupee strings with two decimals; totals are added in paise.
 */
export interface GridCol {
  key: string;
  label: string;
  kind?: 'money' | 'number' | 'text';
  /** a share of the page width (default by kind) */
  width?: number;
}
export type GridRow = Record<string, string | number | null>;
export interface Grid {
  key: string;
  title: string;
  /** the period in words: "June 2026", "FY 2026-27", "as of 31-03-2027" */
  period: string;
  /** lines under the title: the rule followed, the filters chosen */
  subtitle: string[];
  columns: GridCol[];
  rows: GridRow[];
  /** sub-totals after the rows (by staff type, paid and held …) */
  subtotals: Array<{ label: string; row: GridRow }>;
  total: GridRow | null;
  provisional: string | null;
  /** small tables under the main one (a summary by bank, the nominees …) */
  after?: Array<{ title: string; columns: GridCol[]; rows: GridRow[] }>;
  /** a closing note (the rule the figures follow) */
  note?: string;
}

const P = (v: unknown): bigint => {
  const s = String(v ?? '0').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0n;
  const neg = s.startsWith('-');
  const [r, f = ''] = s.replace('-', '').split('.');
  const abs = BigInt(r || '0') * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -abs : abs;
};
export const rupees = (p: bigint) => {
  const neg = p < 0n;
  const s = (neg ? -p : p).toString().padStart(3, '0');
  return `${neg ? '-' : ''}${s.slice(0, -2)}.${s.slice(-2)}`;
};
export const paise = P;

/** The total of the money and number columns over some rows (the first text column says what it is). */
export function totalOf(cols: GridCol[], rows: GridRow[], label = 'Total'): GridRow {
  const out: GridRow = {};
  let labelled = false;
  for (const c of cols) {
    if (c.kind === 'money') out[c.key] = rupees(rows.reduce((t, r) => t + P(r[c.key]), 0n));
    else if (c.kind === 'number')
      out[c.key] = Math.round(rows.reduce((t, r) => t + Number(r[c.key] ?? 0), 0) * 100) / 100;
    else if (!labelled) {
      out[c.key] = label;
      labelled = true;
    } else out[c.key] = '';
  }
  return out;
}

/** Sub-totals by a field of the rows (only when there are two groups or more). */
export function subtotalsBy(
  cols: GridCol[],
  rows: GridRow[],
  field: string,
  name: (v: string) => string,
): Grid['subtotals'] {
  const groups = new Map<string, GridRow[]>();
  for (const r of rows) {
    const k = String(r[field] ?? '');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  if (groups.size < 2) return [];
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, rs]) => ({
      label: `${name(k)} (${String(rs.length)})`,
      row: totalOf(cols, rs, `${name(k)} (${String(rs.length)})`),
    }));
}

const inr = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? ''
    : Number(String(v).replace(/,/g, '')).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
const cell = (c: GridCol, v: string | number | null | undefined) =>
  c.kind === 'money' ? inr(v) : v === null || v === undefined ? '' : String(v);
const widthOf = (c: GridCol) => c.width ?? (c.kind === 'text' || !c.kind ? 0.14 : 0.08);

/** The grid as a PDF on the register letterhead, PROVISIONAL first, prepared / checked boxes at the end. */
export async function gridPdf(
  g: Grid,
  head: { school: string; address: string; logo: LetterheadLogo | null },
  signs: SignBox[],
): Promise<Buffer> {
  const all = g.columns.reduce((t, c) => t + widthOf(c), 0);
  const rows = g.rows.map((r) => g.columns.map((c) => cell(c, r[c.key])));
  const subs = g.subtotals.map((s) => g.columns.map((c) => cell(c, s.row[c.key])));
  const total = g.total ? [g.columns.map((c) => cell(c, g.total![c.key]))] : [];
  const strong: number[] = [];
  const shade: NonNullable<TablePdf['shade']> = {};
  subs.forEach((_, i) => {
    strong.push(rows.length + i);
    shade[rows.length + i] = 'subtotal';
  });
  if (total.length) {
    strong.push(rows.length + subs.length);
    shade[rows.length + subs.length] = 'grand';
  }
  return tablePdf({
    school: head.school,
    address: head.address,
    title: g.title,
    letterhead: { logo: head.logo, details: `${g.period} · Generated on ${registerGeneratedOn()}` },
    subtitle: [...(g.provisional ? [g.provisional] : []), ...g.subtitle],
    subtitleFirstOnly: true,
    portrait: g.columns.length <= 7,
    a3: g.columns.length > 16,
    fontSize: g.columns.length > 12 ? 7.5 : undefined,
    wrap: true,
    columns: g.columns.map((c) => ({
      label: c.label,
      width: widthOf(c) / all,
      right: c.kind === 'money' || c.kind === 'number',
    })),
    rows: [...rows, ...subs, ...total],
    strong,
    shade,
    rowCount: g.rows.length,
    after: g.after?.map((a) => {
      const w = a.columns.reduce((t, c) => t + widthOf(c), 0);
      return {
        title: a.title,
        columns: a.columns.map((c) => ({
          label: c.label,
          width: widthOf(c) / w,
          right: c.kind === 'money' || c.kind === 'number',
        })),
        rows: a.rows.map((r) => a.columns.map((c) => cell(c, r[c.key]))),
      };
    }),
    footnote: g.note,
    signs,
  });
}

/** The grid as one Excel sheet (or a sheet of a pack): numbers as numbers, the header frozen, a filter on the rows. */
export function gridSheet(wb: ExcelJS.Workbook, g: Grid, school: string, sheetName?: string) {
  const ws = wb.addWorksheet((sheetName ?? g.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  ws.addRow([school]).font = { bold: true, size: 13 };
  ws.addRow([`${g.title} · ${g.period}`]).font = { bold: true };
  if (g.provisional) ws.addRow([g.provisional]).font = { bold: true, color: { argb: 'FFB45309' } };
  for (const s of g.subtitle) ws.addRow([s]);
  ws.addRow([`Generated on ${registerGeneratedOn()}`]).font = { italic: true, size: 9 };
  ws.addRow([]);
  const top = ws.rowCount + 1;
  const hr = ws.addRow(g.columns.map((c) => c.label));
  hr.font = { bold: true };
  const value = (c: GridCol, v: string | number | null | undefined) =>
    (c.kind === 'money' || c.kind === 'number') && v !== null && v !== undefined && v !== ''
      ? Number(String(v).replace(/,/g, ''))
      : (v ?? '');
  for (const r of g.rows) ws.addRow(g.columns.map((c) => value(c, r[c.key])));
  for (const s of g.subtotals)
    ws.addRow(g.columns.map((c) => value(c, s.row[c.key]))).font = { bold: true };
  if (g.total) ws.addRow(g.columns.map((c) => value(c, g.total![c.key]))).font = { bold: true };
  g.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.kind === 'money' ? 14 : c.kind === 'number' ? 9 : 22;
    if (c.kind === 'money') col.numFmt = '#,##,##0.00';
  });
  ws.views = [{ state: 'frozen', ySplit: top, xSplit: 1 }];
  if (g.rows.length)
    ws.autoFilter = {
      from: { row: top, column: 1 },
      to: { row: top + g.rows.length, column: g.columns.length },
    };
  for (const a of g.after ?? []) {
    ws.addRow([]);
    ws.addRow([a.title]).font = { bold: true };
    ws.addRow(a.columns.map((c) => c.label)).font = { bold: true };
    for (const r of a.rows) ws.addRow(a.columns.map((c) => value(c, r[c.key])));
  }
  if (g.note) {
    ws.addRow([]);
    ws.addRow([g.note]).font = { italic: true };
  }
  return ws;
}

export async function gridXlsx(g: Grid, school: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  gridSheet(wb, g, school);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** The grid as CSV: the title lines first, then the table with plain numbers. */
export function gridCsv(g: Grid, school: string): string {
  const lines: unknown[][] = [[school], [`${g.title} · ${g.period}`]];
  if (g.provisional) lines.push([g.provisional]);
  for (const s of g.subtitle) lines.push([s]);
  lines.push([]);
  lines.push(g.columns.map((c) => c.label));
  const plain = (c: GridCol, v: unknown) => (v === null || v === undefined ? '' : v);
  for (const r of g.rows) lines.push(g.columns.map((c) => plain(c, r[c.key])));
  for (const s of g.subtotals) lines.push(g.columns.map((c) => plain(c, s.row[c.key])));
  if (g.total) lines.push(g.columns.map((c) => plain(c, g.total![c.key])));
  return `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
