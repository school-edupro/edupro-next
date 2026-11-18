import ExcelJS from 'exceljs';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import type { SignBox } from '../purchase/purchase-doc-sign';
import type { AnTable } from './board-analysis';
import { rangeYearLabel, type RangeSummary } from './board-reports';

/** The Range Wise Subject Summary as files: the Excel sheet as on screen, and the PDF on the letterhead. */
export interface ReportHead {
  school: string;
  address: string;
  logo: LetterheadLogo | null;
  generatedOn: string;
  by: string;
  title: string;
  scope: string;
}

const cellText = (v: number | null) => (v === null ? '' : v);

/** What a range report calls itself and its columns (the subject summary, the class's summary). */
export interface RangeLabels {
  report: string;
  sheet: string;
  first: string;
  count: string;
  pct: string;
  footnote: string;
}
export const SUBJECT_LABELS: RangeLabels = {
  report: 'Range wise subject summary',
  sheet: 'Range wise subject summary',
  first: 'Subject Code & Name',
  count: 'Count',
  pct: '%',
  footnote:
    'Divisions as the old report counts them: distinction from the distinction marks, 1st division from 60, 2nd from 45, 3rd from the pass marks. Shares are of those who appeared.',
};
export const OVERALL_LABELS: RangeLabels = {
  report: 'Range wise summary',
  sheet: 'Range wise summary',
  first: 'Range of Marks',
  count: 'No. of Students',
  pct: 'Percentage (%)',
  footnote:
    "Pass, fail and compartment by the CBSE result; divisions and ranges by each student's aggregate. Shares are of those who appeared (absent: of all students).",
};

export async function rangeXlsx(
  r: RangeSummary,
  head: ReportHead,
  labels: RangeLabels = SUBJECT_LABELS,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  wb.created = new Date();
  const ws = wb.addWorksheet(labels.sheet);
  const width = 2 + r.years.length * 2;
  for (const [i, line] of [head.school, head.title, head.scope].entries()) {
    const x = ws.addRow([line]);
    x.font = { bold: true, size: i === 0 ? 14 : 11, color: { argb: 'FF1C2A70' } };
    ws.mergeCells(x.number, 1, x.number, width);
  }
  ws.addRow([]);
  const g = ws.addRow(['Sr No', labels.first, ...r.years.flatMap((y) => [rangeYearLabel(y), ''])]);
  const h = ws.addRow(['', '', ...r.years.flatMap(() => [labels.count, labels.pct])]);
  ws.mergeCells(g.number, 1, h.number, 1);
  ws.mergeCells(g.number, 2, h.number, 2);
  r.years.forEach((_, i) => ws.mergeCells(g.number, 3 + i * 2, g.number, 4 + i * 2));
  for (const x of [g, h])
    x.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FF1C2A70' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1FB' } };
      c.alignment = { vertical: 'middle' };
    });
  ws.views = [{ state: 'frozen', ySplit: h.number }];
  ws.pageSetup = {
    orientation: r.years.length <= 2 ? 'portrait' : 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${String(g.number)}:${String(h.number)}`,
  };
  for (const [k, b] of r.blocks.entries()) {
    // each subject on a page of its own when printed
    if (k > 0) ws.lastRow?.addPageBreak();
    // a block of the class's summary has no heading of its own
    if (b.code) {
      const t = ws.addRow(['', `${b.code} - ${b.name.toUpperCase()}`]);
      t.font = { bold: true };
      t.eachCell({ includeEmpty: true }, (c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F6FB' } };
      });
      ws.mergeCells(t.number, 2, t.number, width);
    }
    b.rows.forEach((row, i) =>
      ws.addRow([
        i + 1,
        row.label,
        ...r.years.flatMap((y) => {
          const v = row.values[String(y)];
          return [
            cellText(v?.count ?? null),
            v?.pct === null || v?.pct === undefined ? '' : `${v.pct.toFixed(2)}%`,
          ];
        }),
      ]),
    );
  }
  ws.getColumn(1).width = 8;
  ws.getColumn(2).width = 40;
  for (let i = 3; i <= width; i += 1) ws.getColumn(i).width = 12;
  ws.addRow([]);
  ws.addRow([`Made ${head.generatedOn} by ${head.by}`]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function rangePdf(
  r: RangeSummary,
  head: ReportHead,
  labels: RangeLabels = SUBJECT_LABELS,
): Promise<Buffer> {
  const rows: Array<Array<string | number>> = [];
  const shade: Record<number, 'heading'> = {};
  // each subject starts a page (its headings repeated), the signature boxes at the foot of each
  const breakBefore: number[] = [];
  for (const b of r.blocks) {
    if (rows.length) breakBefore.push(rows.length);
    if (b.code) {
      shade[rows.length] = 'heading';
      rows.push([`${b.code} - ${b.name.toUpperCase()}`, '', ...r.years.flatMap(() => ['', ''])]);
    }
    b.rows.forEach((row, i) =>
      rows.push([
        i + 1,
        row.label,
        ...r.years.flatMap((y) => {
          const v = row.values[String(y)];
          return [
            v?.count === null || v?.count === undefined ? '' : v.count,
            v?.pct === null || v?.pct === undefined ? '' : `${v.pct.toFixed(2)}%`,
          ];
        }),
      ]),
    );
  }
  const signs: SignBox[] = [
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
  return tablePdf({
    school: head.school,
    address: head.address,
    title: labels.report,
    subtitle: [head.title, head.scope],
    letterhead: { logo: head.logo, details: `Made ${head.generatedOn}` },
    columns: [
      { label: 'Sr No', width: 0.6, right: true },
      { label: labels.first, width: 4 },
      ...r.years.flatMap((y) => [
        { label: labels.count, width: 1.4, right: true, group: rangeYearLabel(y) },
        { label: labels.pct, width: 1.4, right: true, group: rangeYearLabel(y) },
      ]),
    ],
    rows: rows.length ? rows : [['', 'No subject', ...r.years.flatMap(() => ['', ''])]],
    shade,
    breakBefore,
    signsEachBreak: true,
    portrait: r.years.length <= 2,
    fontSize: 8,
    footnote: labels.footnote,
    signs,
  });
}

/** One wide table (a report of the Reports tab) as a PDF: A3 landscape when wide, heading groups, the total bold. */
export async function singleTablePdf(t: AnTable, head: ReportHead): Promise<Buffer> {
  const many = t.columns.length;
  const signs: SignBox[] = [
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
  return tablePdf({
    school: head.school,
    address: head.address,
    title: t.title,
    subtitle: [head.title, head.scope],
    letterhead: { logo: head.logo, details: `Made ${head.generatedOn}` },
    columns: t.columns.map((c) => ({
      label: c.label,
      width: c.num ? 1 : (c.width ?? 2),
      right: Boolean(c.num),
      ...(c.group ? { group: c.group } : {}),
    })),
    rows: t.rows.map((r) =>
      t.columns.map((c) => {
        const v = r[c.key];
        return v === null || v === undefined ? '' : v;
      }),
    ),
    strong: t.strong ?? [],
    rowCount: t.rows.length - (t.strong?.length ?? 0),
    wrap: true,
    fontSize: many > 30 ? 5.5 : many > 20 ? 6.5 : 8,
    a3: many > 14,
    ...(t.note ? { footnote: t.note } : {}),
    signs,
  });
}
