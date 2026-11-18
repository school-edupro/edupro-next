import ExcelJS from 'exceljs';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import type { SignBox } from '../purchase/purchase-doc-sign';
import type { MarksRow } from './board-marks';

/**
 * The Results tab's list as files (docs/design/88): the Excel sheet (a row a candidate, each subject as name,
 * marks and grade) and the PDF on the school's letterhead (A3 landscape) with signature boxes.
 */
export interface MarksHead {
  school: string;
  address: string;
  logo: LetterheadLogo | null;
  generatedOn: string;
  by: string;
  /** "CBSE AISSE result (Class X) 2025-26" */
  title: string;
  /** the filters in words */
  scope: string;
  method: string;
}

const out = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : v);
const subjectsOf = (rows: MarksRow[]) => Math.max(1, ...rows.map((r) => r.subjects.length));
const classOf = (r: MarksRow, classLabel: string) =>
  r.section ? `${classLabel}-${r.section}` : classLabel;

export async function marksXlsx(
  rows: MarksRow[],
  classLabel: string,
  head: MarksHead,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  wb.created = new Date();
  const ws = wb.addWorksheet('Student marks');
  const n = subjectsOf(rows);
  const headers = [
    'Sr#',
    'Roll No',
    'Name',
    'Gender',
    'Class',
    'Comp Sub',
    ...Array.from({ length: n }, (_, i) => [
      `Subject-${String(i + 1)}`,
      `Subject-${String(i + 1)} Marks`,
      `Subject-${String(i + 1)} Grade`,
    ]).flat(),
    'Max Marks',
    'Result',
    'Subject Aggregate',
    'Total Percentage',
    'Rank',
  ];
  for (const [i, line] of [head.school, head.title, `${head.scope} · ${head.method}`].entries()) {
    const r = ws.addRow([line]);
    r.font = { bold: true, size: i === 0 ? 14 : 11, color: { argb: 'FF1C2A70' } };
    ws.mergeCells(r.number, 1, r.number, headers.length);
  }
  ws.addRow([]);
  const h = ws.addRow(headers);
  h.font = { bold: true, color: { argb: 'FF1C2A70' } };
  h.alignment = { wrapText: true, vertical: 'middle' };
  h.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1FB' } };
  });
  ws.views = [{ state: 'frozen', ySplit: h.number, xSplit: 3 }];
  rows.forEach((r, i) => {
    ws.addRow([
      i + 1,
      r.roll,
      out(r.name),
      out(r.sex),
      classOf(r, classLabel),
      r.compartment.length ? r.compartment.map((x) => x.name).join(', ') : '-',
      ...Array.from({ length: n }, (_, k) => {
        const s = r.subjects[k];
        return s ? [s.name, s.marks === null ? 'AB' : s.marks, out(s.grade)] : ['-', '', ''];
      }).flat(),
      out(r.max),
      out(r.result),
      out(r.total),
      r.percent === null ? '' : r.percent,
      out(r.rank),
    ]);
  });
  ws.columns.forEach((col, i) => {
    col.width = i === 2 ? 30 : i >= 6 && i < 6 + 3 * n && (i - 6) % 3 === 0 ? 24 : 10;
  });
  ws.addRow([]);
  ws.addRow([`Made ${head.generatedOn} by ${head.by}`]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function marksPdf(
  rows: MarksRow[],
  classLabel: string,
  head: MarksHead,
): Promise<Buffer> {
  const n = subjectsOf(rows);
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
    title: 'Student marks data',
    subtitle: [head.title, `${head.scope} · ${head.method}`],
    letterhead: { logo: head.logo, details: `Made ${head.generatedOn}` },
    columns: [
      { label: 'Sr#', width: 0.6, right: true },
      { label: 'Roll No', width: 1.4 },
      { label: 'Name', width: 3 },
      { label: 'G', width: 0.5, center: true },
      { label: 'Class', width: 0.9 },
      { label: 'Comp Sub', width: 1.4 },
      ...Array.from({ length: n }, (_, i) => ({ label: `Subject-${String(i + 1)}`, width: 2 })),
      { label: 'Max', width: 0.8, right: true },
      { label: 'Result', width: 1 },
      { label: 'Aggregate', width: 1.2, right: true },
      { label: '%', width: 1, right: true },
      { label: 'Rank', width: 0.8, right: true },
    ],
    rows: rows.map((r, i) => [
      i + 1,
      r.roll,
      out(r.name),
      out(r.sex),
      classOf(r, classLabel),
      r.compartment.length ? r.compartment.map((x) => x.name).join(', ') : '-',
      ...Array.from({ length: n }, (_, k) => {
        const s = r.subjects[k];
        return s
          ? `${s.short} ${s.marks === null ? 'AB' : String(s.marks)} ${s.grade ?? ''}${s.counted ? '' : ' *'}`.trim()
          : '-';
      }),
      out(r.max),
      out(r.result),
      r.total === null ? '' : r.total.toFixed(2),
      r.percent === null ? '' : `${r.percent.toFixed(2)}%`,
      out(r.rank),
    ]),
    wrap: true,
    fontSize: 6.5,
    a3: true,
    footnote: `${head.method}. * not counted in the aggregate. Ranks: equal aggregates share a rank.`,
    signs,
  });
}
