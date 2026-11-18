import ExcelJS from 'exceljs';
import { tablePdf } from '../engagement/table-pdf';
import type { SignBox } from '../purchase/purchase-doc-sign';
import type { ReportHead } from './board-reports-file';
import type { TopperList, TopperRow, ToppersBlock, ToppersReport } from './board-toppers';

/** The Topper Report as files (docs/design/88): the Excel sheet and the PDF on the letterhead, as on screen. */

export interface ToppersHead extends ReportHead {
  /** "best five (language + four), out of 500" */
  method: string;
  /** the top ranks asked (for the years' columns) */
  top: number;
}

const gender = (s: string | null) => (s === 'M' ? 'Boy' : s === 'F' ? 'Girl' : '');
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const students = (n: number) => `${String(n)} student${n === 1 ? '' : 's'}`;

/** What a list is called: "Top 5 ranks - 12 students". */
export function listTitle(l: TopperList, pct: { op?: 'gte' | 'lte'; value?: number }): string {
  if (l.kind === 'top')
    return `Top ${String(l.ranks)} rank${l.ranks === 1 ? '' : 's'} - ${students(l.rows.length)}`;
  if (l.kind === 'low')
    return `Lowest ${String(l.ranks)} rank${l.ranks === 1 ? '' : 's'} - ${students(l.rows.length)}`;
  return `${pct.op === 'lte' ? 'At or below' : 'At or above'} ${num(pct.value ?? 0)}% - ${students(l.rows.length)}`;
}

const blockTitle = (b: ToppersBlock, method: string) =>
  b.code === null
    ? `Class toppers - ${method} - ${String(b.appeared)} ranked`
    : `${b.name} (${b.code}) - ${String(b.appeared)} appeared`;

const signs = (head: ReportHead): SignBox[] => [
  {
    as: 'Prepared by',
    name: head.by,
    code: null,
    designation: null,
    when: head.generatedOn,
    signature: null,
  },
  { as: 'Checked by', name: null, code: null, designation: null, when: null, signature: null },
  { as: 'Principal', name: null, code: null, designation: null, when: null, signature: null },
];

const NOTE =
  'Ranks are dense: equal marks share a rank and the next follows (1, 1, 2), so the top ranks may hold more students than ranks. A section or gender chosen is ranked within itself; the class rank is the whole class. Bars on a 0-100 scale.';

function cells(r: TopperRow, b: ToppersBlock, classRank: boolean): Array<string | number> {
  return [
    r.rank,
    ...(classRank ? [r.classRank ?? ''] : []),
    r.roll,
    r.name ?? '',
    gender(r.sex),
    r.section ?? '',
    b.code === null ? `${num(r.marks)} / ${String(r.max)}` : num(r.marks),
    // the aggregate's percentage always to two places, a subject's marks as they are
    b.code === null ? `${r.pct.toFixed(2)}%` : `${num(r.pct)}%`,
    r.grade ?? '',
  ];
}

export async function toppersPdf(
  t: ToppersReport,
  head: ToppersHead,
  pct: { op?: 'gte' | 'lte'; value?: number },
): Promise<Buffer> {
  const blocks = [...(t.overall ? [t.overall] : []), ...t.subjects];
  const classRank = Boolean(t.overall?.lists.some((l) => l.rows.some((r) => r.classRank !== null)));
  const rows: Array<Array<string | number>> = [];
  const shade: Record<number, 'heading' | 'subheading'> = {};
  for (const b of blocks) {
    shade[rows.length] = 'heading';
    rows.push([blockTitle(b, head.method)]);
    for (const l of b.lists) {
      shade[rows.length] = 'subheading';
      rows.push([listTitle(l, pct)]);
      if (!l.rows.length) rows.push(['', ...(classRank ? [''] : []), '', 'None']);
      for (const r of l.rows) rows.push([...cells(r, b, classRank), r.pct]);
    }
  }
  const counted = rows.filter((_, i) => !shade[i]).length;
  return tablePdf({
    school: head.school,
    address: head.address,
    title: 'Toppers report',
    subtitle: [head.title, head.scope],
    letterhead: { logo: head.logo, details: `Made ${head.generatedOn}` },
    portrait: true,
    columns: [
      { label: 'Rank', width: 0.8, center: true },
      ...(classRank ? [{ label: 'Class rank', width: 0.9, center: true }] : []),
      { label: 'Roll No', width: 1.4 },
      { label: 'Name', width: 3.4 },
      { label: 'Gender', width: 1.1, center: true },
      { label: 'Section', width: 1.1, center: true },
      { label: 'Marks', width: 1.3, right: true },
      { label: '%', width: 1, right: true },
      { label: 'Grade', width: 0.8, center: true },
      { label: '0 - 100%', width: 1.8, bar: 100 },
    ],
    rows,
    shade,
    rowCount: counted,
    keepBlocks: true,
    wrap: true,
    fontSize: 8,
    ...(t.years.length > 1
      ? {
          after: [
            {
              title: 'Toppers over the years',
              wide: true,
              columns: [
                { label: 'Year', width: 1.4 },
                { label: 'Ranked', width: 1, right: true },
                { label: 'Highest', width: 1.2, right: true },
                { label: 'At rank 1', width: 1.1, right: true },
                { label: `Top ${String(head.top)} ranks from`, width: 1.9, right: true },
                { label: `In top ${String(head.top)} ranks`, width: 1.6, right: true },
                { label: '95% and above', width: 1.6, right: true },
                { label: '90% and above', width: 1.6, right: true },
              ],
              rows: t.years.map((y) => [
                y.label,
                y.appeared,
                y.highest === null ? '' : `${y.highest.toFixed(2)}%`,
                y.atFirst,
                y.cutoff === null ? '' : `${y.cutoff.toFixed(2)}%`,
                y.inTop,
                y.pct95,
                y.pct90,
              ]),
            },
          ],
        }
      : {}),
    footnote: NOTE,
    signs: signs(head),
  });
}

export async function toppersXlsx(
  t: ToppersReport,
  head: ToppersHead,
  pct: { op?: 'gte' | 'lte'; value?: number },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  wb.created = new Date();
  const ws = wb.addWorksheet('Toppers');
  const classRank = Boolean(t.overall?.lists.some((l) => l.rows.some((r) => r.classRank !== null)));
  const header = [
    'Rank',
    ...(classRank ? ['Class rank'] : []),
    'Roll No',
    'Name',
    'Gender',
    'Section',
    'Marks',
    '%',
    'Grade',
  ];
  const width = header.length;
  for (const [i, line] of [head.school, `Toppers report - ${head.title}`, head.scope].entries()) {
    const x = ws.addRow([line]);
    x.font = { bold: true, size: i === 0 ? 14 : 11, color: { argb: 'FF1C2A70' } };
    ws.mergeCells(x.number, 1, x.number, width);
  }
  const band = (text: string, argb: string, bold = true) => {
    const x = ws.addRow([text]);
    x.font = { bold, color: { argb: 'FF1C2A70' } };
    for (let c = 1; c <= width; c += 1)
      x.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    ws.mergeCells(x.number, 1, x.number, width);
  };
  for (const b of [...(t.overall ? [t.overall] : []), ...t.subjects]) {
    ws.addRow([]);
    band(blockTitle(b, head.method), 'FFDFE4F7');
    for (const l of b.lists) {
      band(listTitle(l, pct), 'FFEEF1FB');
      const h = ws.addRow(header);
      h.font = { bold: true };
      if (!l.rows.length) ws.addRow(['', ...(classRank ? [''] : []), '', 'None']);
      for (const r of l.rows) {
        const x = ws.addRow(
          cells(r, b, classRank).map((v, i) =>
            // numbers stay numbers in the sheet
            header[i] === 'Marks' && b.code !== null ? r.marks : header[i] === '%' ? r.pct : v,
          ),
        );
        x.getCell(header.indexOf('%') + 1).numFmt = '0.00';
      }
    }
  }
  if (t.years.length > 1) {
    ws.addRow([]);
    band('Toppers over the years', 'FFDFE4F7');
    ws.addRow([
      'Year',
      'Ranked',
      'Highest %',
      'At rank 1',
      `Top ${String(head.top)} ranks from %`,
      `In top ${String(head.top)} ranks`,
      '95% and above',
      '90% and above',
    ]).font = { bold: true };
    for (const y of t.years)
      ws.addRow([y.label, y.appeared, y.highest, y.atFirst, y.cutoff, y.inTop, y.pct95, y.pct90]);
  }
  const widths = [8, ...(classRank ? [10] : []), 12, 34, 9, 9, 12, 10, 8];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.addRow([]);
  ws.addRow([NOTE]).font = { italic: true, size: 9 };
  ws.addRow([`Made ${head.generatedOn} by ${head.by}`]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
