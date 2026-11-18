import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import type { SignBox } from '../purchase/purchase-doc-sign';
import {
  RULE_WORDS,
  yearLabel,
  type AnTable,
  type Annexure,
  type BoardAnalysis,
  type Cell,
} from './board-analysis';

/**
 * The board result analysis as files (docs/design/88, phase C): one Excel workbook with a sheet an annexure, laid out
 * as the school's own (a title band, each table with its heading groups; Annexure 4 as a block a subject), and a PDF
 * on the school's letterhead with signature boxes.
 */
export interface AnalysisHead {
  school: string;
  address: string;
  logo: LetterheadLogo | null;
  generatedOn: string;
  /** Who made the file (the Prepared by box). */
  by: string;
  /** "Section B" when the analysis is of one section. */
  scope: string | null;
}

export const examName = (a: BoardAnalysis) =>
  `CBSE ${a.classLabel === 'XII' ? 'AISSCE' : 'AISSE'} result (Class ${a.classLabel}) ${yearLabel(a.examYear)}`;

const FILL = (argb: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});
const HEAD = 'FFEEF1FB';
const INK = 'FF1C2A70';
const thin = { style: 'thin' as const, color: { argb: 'FFC9D0E6' } };
const BOX = { top: thin, left: thin, bottom: thin, right: thin };
const EXTRA_SHEET: Record<number, string> = {
  11: 'Performance Index',
  12: 'Five-year trend',
  13: 'Lists',
};
const out = (v: Cell) => (v === null || v === undefined ? '' : v);

/** The groups of a table's columns, in order: a label over a run of columns, or none. */
function runs(t: AnTable) {
  const r: Array<{ group: string | undefined; from: number; to: number }> = [];
  t.columns.forEach((c, i) => {
    const last = r[r.length - 1];
    if (last && c.group && last.group === c.group) last.to = i;
    else r.push({ group: c.group, from: i, to: i });
  });
  return r;
}

function writeTable(ws: ExcelJS.Worksheet, t: AnTable) {
  const width = t.columns.length;
  const titleRow = ws.addRow([t.title]);
  titleRow.font = { bold: true, color: { argb: INK } };
  ws.mergeCells(titleRow.number, 1, titleRow.number, Math.max(width, 2));
  if (t.blocks) {
    // the school's Annexure 4: a block a row — "Subject code & name" then label | value lines
    const [first, ...rest] = t.columns;
    for (const row of t.rows) {
      const h = ws.addRow([first!.label.toUpperCase(), '', out(row[first!.key] ?? null)]);
      h.font = { bold: true };
      h.eachCell((c) => {
        c.fill = FILL(HEAD);
        c.border = BOX;
      });
      ws.mergeCells(h.number, 1, h.number, 2);
      for (const c of rest) {
        const x = ws.addRow([c.label, '', out(row[c.key] ?? null)]);
        ws.mergeCells(x.number, 1, x.number, 2);
        x.eachCell((cell) => (cell.border = BOX));
      }
      ws.addRow([]);
    }
    return;
  }
  const grouped = t.columns.some((c) => c.group);
  if (grouped) {
    const g = ws.addRow(t.columns.map((c) => c.group ?? c.label));
    const h = ws.addRow(t.columns.map((c) => c.label));
    for (const run of runs(t)) {
      if (run.group) {
        if (run.to > run.from) ws.mergeCells(g.number, run.from + 1, g.number, run.to + 1);
      } else ws.mergeCells(g.number, run.from + 1, h.number, run.from + 1);
    }
    for (const r of [g, h])
      r.eachCell((c) => {
        c.font = { bold: true, color: { argb: INK } };
        c.fill = FILL(HEAD);
        c.border = BOX;
        c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
      });
  } else {
    const h = ws.addRow(t.columns.map((c) => c.label));
    h.eachCell((c) => {
      c.font = { bold: true, color: { argb: INK } };
      c.fill = FILL(HEAD);
      c.border = BOX;
      c.alignment = { wrapText: true, vertical: 'middle' };
    });
  }
  t.rows.forEach((row, i) => {
    const x = ws.addRow(t.columns.map((c) => out(row[c.key] ?? null)));
    x.eachCell({ includeEmpty: true }, (cell) => (cell.border = BOX));
    if (t.strong?.includes(i)) x.font = { bold: true };
  });
  if (!t.rows.length) ws.addRow(['None']).font = { italic: true };
  if (t.note) ws.addRow([t.note]).font = { italic: true, size: 9 };
  ws.addRow([]);
}

/** One workbook: a sheet an annexure, named as the school's (Annexure-1 … Annexure-10). */
export async function analysisXlsx(a: BoardAnalysis, head: AnalysisHead): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  wb.created = new Date();
  for (const x of a.annexures) {
    // the school's ten as Annexure-1 … Annexure-10; EduPro's extras by name
    const ws = wb.addWorksheet(EXTRA_SHEET[x.no] ?? `Annexure-${String(x.no)}`);
    const widest = Math.max(...x.tables.map((t) => (t.blocks ? 3 : t.columns.length)), 3);
    const lines = [
      head.school,
      examName(a),
      `Annexure ${String(x.no)}: ${x.title}${head.scope ? ` · ${head.scope}` : ''}`,
    ];
    lines.forEach((l, i) => {
      const r = ws.addRow([l]);
      r.font = { bold: true, size: i === 0 ? 14 : 12, color: { argb: INK } };
      ws.mergeCells(r.number, 1, r.number, widest);
      r.alignment = { horizontal: 'center' };
    });
    ws.addRow([]);
    for (const t of x.tables) writeTable(ws, t);
    const first = x.tables[0];
    ws.columns.forEach((col, i) => {
      const c = first?.blocks ? undefined : first?.columns[i];
      col.width = first?.blocks ? (i === 0 ? 30 : 14) : c && !c.num ? 8 * (c.width ?? 2) : 10;
    });
    ws.addRow([]);
    ws.addRow([
      `Best five: ${RULE_WORDS[a.rules.bestFive]} · distinction from ${String(a.rules.distinction)} · pass from ${String(a.rules.passMarks)} · made ${head.generatedOn} by ${head.by}`,
    ]).font = { italic: true, size: 9 };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The PDF of one annexure, or of all ten: tables with the same columns run on as one list with headings. */
export async function analysisPdf(
  a: BoardAnalysis,
  head: AnalysisHead,
  annexure: number | null,
): Promise<Buffer> {
  const picked = a.annexures.filter((x) => annexure === null || x.no === annexure);
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
  const parts: Buffer[] = [];
  const chunks: Array<{ x: Annexure; tables: AnTable[] }> = [];
  for (const x of picked) {
    let run: AnTable[] = [];
    const key = (t: AnTable) => t.columns.map((c) => c.key).join('|');
    for (const t of x.tables) {
      if (run.length && key(run[0]!) !== key(t)) {
        chunks.push({ x, tables: run });
        run = [];
      }
      run.push(t);
    }
    if (run.length) chunks.push({ x, tables: run });
  }
  for (const [k, { x, tables }] of chunks.entries()) {
    const t0 = tables[0]!;
    const rows: Array<Array<string | number>> = [];
    const shade: Record<number, 'heading'> = {};
    const strong: number[] = [];
    for (const t of tables) {
      if (tables.length > 1) {
        shade[rows.length] = 'heading';
        rows.push([t.title, ...t0.columns.slice(1).map(() => '')]);
      }
      const at = rows.length;
      t.rows.forEach((r) => rows.push(t0.columns.map((c) => out(r[c.key] ?? null))));
      for (const s of t.strong ?? []) strong.push(at + s);
    }
    const many = t0.columns.length;
    parts.push(
      await tablePdf({
        school: head.school,
        address: head.address,
        title: `Annexure ${String(x.no)}: ${x.title}`,
        subtitle: [
          `${examName(a)}${head.scope ? ` · ${head.scope}` : ''}${tables.length === 1 ? ` · ${t0.title}` : ''}`,
          `Best five: ${RULE_WORDS[a.rules.bestFive]} · distinction from ${String(a.rules.distinction)} · pass from ${String(a.rules.passMarks)}`,
        ],
        letterhead: { logo: head.logo, details: `Made ${head.generatedOn}` },
        columns: t0.columns.map((c) => ({
          label: c.label,
          width: c.num ? 1 : (c.width ?? 2),
          right: Boolean(c.num),
          ...(c.group ? { group: c.group } : {}),
        })),
        rows: rows.length ? rows : [['None', ...t0.columns.slice(1).map(() => '')]],
        shade,
        strong,
        wrap: true,
        fontSize: many > 24 ? 6 : many > 14 ? 7 : 8.5,
        a3: many > 20,
        ...(t0.note ? { footnote: t0.note } : {}),
        ...(k === chunks.length - 1 ? { signs } : {}),
      }),
    );
  }
  if (parts.length === 1) return parts[0]!;
  const doc = await PDFDocument.create();
  doc.setTitle(`${examName(a)} — analysis`);
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => doc.addPage(pg));
  }
  return Buffer.from(await doc.save());
}

/** One table (a report of the Reports tab) as a workbook: the title band, the heading groups, the rows. */
export async function singleTableXlsx(
  t: AnTable,
  head: { school: string; title: string; scope: string; generatedOn: string; by: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EduPro Next';
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/*?:[\]]/g, ' '));
  for (const [i, line] of [head.school, head.title, head.scope].entries()) {
    const r = ws.addRow([line]);
    r.font = { bold: true, size: i === 0 ? 14 : 11, color: { argb: INK } };
    ws.mergeCells(r.number, 1, r.number, Math.max(t.columns.length, 2));
  }
  ws.addRow([]);
  writeTable(ws, { ...t, title: t.title });
  ws.columns.forEach((col, i) => {
    const c = t.columns[i];
    col.width = c && !c.num ? 8 * (c.width ?? 2) : 9;
  });
  ws.addRow([`Made ${head.generatedOn} by ${head.by}`]).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
