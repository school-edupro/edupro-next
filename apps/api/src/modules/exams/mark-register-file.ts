import ExcelJS from 'exceljs';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { Sheet, SheetCell } from './mark-register-sheet';

/**
 * A register's files (docs/design/68), as the school's Term Mark Register prints them: the letterhead
 * (logo, the school, its address, what the paper is, the class and when it was made), the two heading
 * rows, every cell ruled, worked-out columns tinted green and the final amber. The PDF takes the paper
 * (A4, A3, Legal, Letter), the way round and "fit to page width" (smaller letters for a wide register);
 * the headings repeat on every page and a row never splits; every section on its own page. The Excel
 * keeps the decimals shown (numbers stay numbers), a sheet per section.
 */
export interface RegisterFileMeta {
  school: string;
  address: string;
  logo: { contentType: string; bytes: Buffer } | null;
  /** Mark Register · Merit List · … (and the exam of an exam-wise register) */
  label: string;
  generatedOn: string;
}
export interface PaperOptions {
  paper: 'A4' | 'A3' | 'Legal' | 'Letter';
  orientation: 'portrait' | 'landscape';
  fit: boolean;
}

const SIZES: Record<PaperOptions['paper'], [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  Legal: [612, 1008],
  Letter: [612, 792],
};
const INK = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.55, 0.57, 0.6);
const HEAD_BG = rgb(0.9, 0.91, 0.93);
const CALC_BG = rgb(0.92, 0.97, 0.93);
const FINAL_BG = rgb(1, 0.96, 0.88);
const RED = rgb(0.75, 0.1, 0.1);
const M = 24;

const latin = (s: string) =>
  s
    .replace(/[‐-―]/g, '-')
    .replace(/[—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
function clip(font: PDFFont, text: string, size: number, width: number): string {
  let s = latin(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}..`, size) > width) s = s.slice(0, -1);
  return `${s}..`;
}

/** a long text broken over lines that fit the width (a word longer than the width is cut) */
function wrapText(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** a laid-out grid: each heading cell's column and row, with its spans */
function grid(head: SheetCell[][]): Array<{ cell: SheetCell; col: number; row: number }> {
  const out: Array<{ cell: SheetCell; col: number; row: number }> = [];
  const taken = new Set<string>();
  head.forEach((cells, row) => {
    let col = 0;
    for (const cell of cells) {
      while (taken.has(`${String(row)}:${String(col)}`)) col += 1;
      out.push({ cell, col, row });
      for (let r = 0; r < (cell.rows ?? 1); r += 1)
        for (let k = 0; k < (cell.span ?? 1); k += 1)
          taken.add(`${String(row + r)}:${String(col + k)}`);
      col += cell.span ?? 1;
    }
  });
  return out;
}

const fill = (tone: SheetCell['tone'], head = false) =>
  head ? HEAD_BG : tone === 'calc' ? CALC_BG : tone === 'final' ? FINAL_BG : undefined;

export async function registerPdf(
  sheets: Sheet[],
  meta: RegisterFileMeta,
  p: PaperOptions,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (meta.logo && /^image\/(png|jpeg)$/.test(meta.logo.contentType))
    try {
      logo =
        meta.logo.contentType === 'image/png'
          ? await doc.embedPng(meta.logo.bytes)
          : await doc.embedJpg(meta.logo.bytes);
    } catch {
      logo = null;
    }
  const [a, b] = SIZES[p.paper];
  const [W, H] = p.orientation === 'landscape' ? [b, a] : [a, b];
  const usable = W - 2 * M;

  let page: PDFPage | null = null;
  let y = 0;
  let lastPlace: string | null = null;
  for (const sheet of sheets) {
    const shares = sheet.widths.reduce((x, y) => x + y, 0) || 1;
    const unit = usable / shares;
    // letters that fit the narrowest share (a number column) when fitting; else the usual size
    const size = p.fit ? Math.max(4, Math.min(8, unit * 0.62)) : 7.5;
    const lineH = size * 1.25;
    const xs: number[] = [M];
    for (const w of sheet.widths) xs.push(xs[xs.length - 1]! + w * unit);
    const heads = grid(sheet.head);
    const headRows = sheet.head.length;
    // the subject row takes one line; the columns' row two (the name, then its maximum)
    const rowH = (r: number) => (r === headRows - 1 && headRows > 1 ? lineH * 2 + 4 : lineH + 4);
    const rowTop = (r: number) =>
      Array.from({ length: r }, (_, i) => rowH(i)).reduce((a, b) => a + b, 0);
    const headH = rowTop(headRows);

    const letterhead = () => {
      const pg = page;
      if (!pg) return 0;
      let top = H - M;
      if (logo) {
        const s = Math.min(40 / logo.height, 70 / logo.width);
        pg.drawImage(logo, {
          x: M,
          y: top - logo.height * s,
          width: logo.width * s,
          height: logo.height * s,
        });
      }
      const centre = (text: string, font: PDFFont, sz: number) => {
        const t = clip(font, text, sz, usable - 160);
        pg.drawText(t, {
          x: W / 2 - font.widthOfTextAtSize(t, sz) / 2,
          y: top - sz,
          size: sz,
          font,
          color: INK,
        });
        top -= sz + 3;
      };
      centre(meta.school, bold, 12);
      if (meta.address) centre(meta.address, regular, 8);
      centre(meta.label, bold, 9.5);
      centre(`Class: ${sheet.place} · Generated on: ${meta.generatedOn}`, regular, 8);
      return Math.min(top, H - M - 44) - 6;
    };
    const drawCell = (
      text: string,
      x0: number,
      x1: number,
      yTop: number,
      h: number,
      opts: {
        font: PDFFont;
        bg?: ReturnType<typeof rgb>;
        centre?: boolean;
        left?: boolean;
        red?: boolean;
        lines?: string[];
      },
    ) => {
      if (!page) return;
      if (opts.bg)
        page.drawRectangle({ x: x0, y: yTop - h, width: x1 - x0, height: h, color: opts.bg });
      page.drawRectangle({
        x: x0,
        y: yTop - h,
        width: x1 - x0,
        height: h,
        borderColor: RULE,
        borderWidth: 0.4,
      });
      const lines = opts.lines ?? text.split('\n');
      const total = lines.length * lineH;
      let ly = yTop - (h - total) / 2 - size;
      for (const line of lines) {
        const t = clip(opts.font, line, size, x1 - x0 - 3);
        const w = opts.font.widthOfTextAtSize(t, size);
        const x = opts.left ? x0 + 2 : opts.centre ? (x0 + x1 - w) / 2 : x1 - 2 - w;
        page.drawText(t, { x, y: ly + 1.5, size, font: opts.font, color: opts.red ? RED : INK });
        ly -= lineH;
      }
    };
    const header = () => {
      const top = y;
      for (const g of heads) {
        const x0 = xs[g.col]!;
        const x1 = xs[g.col + (g.cell.span ?? 1)]!;
        const h = rowTop(g.row + (g.cell.rows ?? 1)) - rowTop(g.row);
        const words = g.cell.t.split(' (');
        // the name over its maximum, in a column's heading that reaches the two-line (last) row
        const lines =
          words.length > 1 &&
          (g.cell.span ?? 1) === 1 &&
          headRows > 1 &&
          g.row + (g.cell.rows ?? 1) === headRows
            ? [words[0]!, `(${words.slice(1).join(' (')}`]
            : [g.cell.t];
        drawCell(g.cell.t, x0, x1, top - rowTop(g.row), h, {
          font: bold,
          bg: HEAD_BG,
          centre: true,
          lines,
        });
      }
      y = top - headH;
    };
    const fresh = () => {
      page = doc.addPage([W, H]);
      y = letterhead();
    };
    // a report's next table of the same place follows on the page (a new page when it is full)
    const noteH = sheet.note ? 14 : 0;
    const titleH = (sheet.title ? 16 : 0) + noteH;
    if (!page || !sheet.title || sheet.place !== lastPlace || y - titleH - headH - lineH * 2 < M)
      fresh();
    else y -= 10;
    lastPlace = sheet.place;
    if (sheet.note && page) {
      // the rules the figures follow
      (page as PDFPage).drawText(clip(regular, sheet.note, 8, usable), {
        x: M,
        y: y - 9,
        size: 8,
        font: regular,
        color: INK,
      });
      y -= noteH;
    }
    if (sheet.title && page) {
      (page as PDFPage).drawText(clip(bold, sheet.title, 10, usable), {
        x: M,
        y: y - 11,
        size: 10,
        font: bold,
        color: INK,
      });
      y -= titleH - noteH;
    }
    header();
    const rows = [...sheet.body.map((r) => r.cells), ...(sheet.foot ? [sheet.foot] : [])];
    rows.forEach((cells, ri) => {
      const isFoot = sheet.foot !== null && ri === rows.length - 1;
      // a cell may span columns (the pass % of a summary); a long text wraps over lines
      let col = 0;
      const laid = cells.map((c) => {
        const from = col;
        col += c.span ?? 1;
        const x0 = xs[from]!;
        const x1 = xs[Math.min(col, xs.length - 1)]!;
        const font = isFoot || c.tone === 'final' || c.strong ? bold : regular;
        const lines =
          c.lines ?? (c.wrap ? wrapText(font, fileText(c), size, x1 - x0 - 3) : undefined);
        return { c, x0, x1, font, lines };
      });
      const n = Math.max(1, ...laid.map((x) => (x.lines ?? x.c.t.split('\n')).length));
      const h = n * lineH + 3;
      if (y - h < M) {
        fresh();
        header();
      }
      for (const { c, x0, x1, font, lines } of laid)
        drawCell(fileText(c), x0, x1, y, h, {
          font,
          bg: fill(c.tone),
          left: c.text && !c.center,
          centre: c.center,
          red: c.tone === 'star' || c.tone === 'code' || c.tone === 'warn',
          lines,
        });
      y -= h;
    });
  }
  return Buffer.from(await doc.save());
}

/** a cell as a file prints it: its text, its status and what is pending (38 / 39 Partial (1 pending)) */
const fileText = (c: SheetCell) =>
  [c.t, c.badge?.label, c.badge && c.drillLabel ? `(${c.drillLabel})` : '']
    .filter(Boolean)
    .join(' ');

/** a shown number as Excel keeps it (35.50 stays 35.50); anything else stays text */
function excelValue(t: string): { v: string | number; fmt?: string } {
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { v: t };
  const dec = t.includes('.') ? t.split('.')[1]!.length : 0;
  return { v: Number(t), fmt: dec ? `0.${'0'.repeat(dec)}` : '0' };
}

export async function registerXlsx(sheets: Sheet[], meta: RegisterFileMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const used = new Set<string>();
  // a worksheet per place; a report's tables one under another, each under its title
  const places: Sheet[][] = [];
  for (const sheet of sheets) {
    const last = places[places.length - 1];
    if (last && sheet.title && last[0]!.place === sheet.place) last.push(sheet);
    else places.push([sheet]);
  }
  const thin = { style: 'thin' as const, color: { argb: 'FF8C9199' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  for (const group of places) {
    const place = group[0]!.place;
    let name = place.replace(/[\\/?*[\]:]/g, '-').slice(0, 28) || 'Register';
    while (used.has(name)) name = `${name.slice(0, 26)}-${String(used.size)}`;
    used.add(name);
    const ws = wb.addWorksheet(name, {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    const cols = Math.max(...group.map((x) => x.widths.length), 1);
    // the letterhead: logo on the left, the lines centred over the table
    if (meta.logo && /^image\/(png|jpeg)$/.test(meta.logo.contentType)) {
      const id = wb.addImage({
        buffer: meta.logo.bytes as unknown as ExcelJS.Buffer,
        extension: meta.logo.contentType === 'image/png' ? 'png' : 'jpeg',
      });
      ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 60, height: 60 } });
    }
    const lines: Array<[string, boolean, number]> = [
      [meta.school, true, 14],
      [meta.address, false, 10],
      [meta.label, true, 11],
      [`Class: ${place} · Generated on: ${meta.generatedOn}`, false, 10],
    ];
    for (const [text, isBold, size] of lines) {
      const r = ws.addRow([text]);
      ws.mergeCells(r.number, 1, r.number, cols);
      r.getCell(1).alignment = { horizontal: 'center' };
      r.getCell(1).font = { bold: isBold, size };
    }
    let firstHead = 0;
    for (const [n, sheet] of group.entries()) {
      if (sheet.note) {
        const r = ws.addRow([sheet.note]);
        ws.mergeCells(r.number, 1, r.number, cols);
        r.getCell(1).alignment = { wrapText: true };
      }
      if (sheet.title) {
        if (n > 0) ws.addRow([]);
        const t = ws.addRow([sheet.title]);
        t.getCell(1).font = { bold: true, size: 11 };
      }
      const first = ws.rowCount + 1;
      if (n === 0) firstHead = first;
      for (let i = 0; i < sheet.head.length; i += 1) ws.addRow([]);
      for (const g of grid(sheet.head)) {
        const r = first + g.row;
        const c = g.col + 1;
        const cell = ws.getCell(r, c);
        cell.value = g.cell.t;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E8EC' } };
        const r2 = r + (g.cell.rows ?? 1) - 1;
        const c2 = c + (g.cell.span ?? 1) - 1;
        if (r2 > r || c2 > c) ws.mergeCells(r, c, r2, c2);
      }
      for (let r = first; r < first + sheet.head.length; r += 1)
        for (let c = 1; c <= sheet.widths.length; c += 1) ws.getCell(r, c).border = box;
      const rows = [...sheet.body.map((x) => x.cells), ...(sheet.foot ? [sheet.foot] : [])];
      for (const cells of rows) {
        const row = ws.addRow([]);
        let col = 0;
        cells.forEach((c) => {
          const at = col + 1;
          col += c.span ?? 1;
          if ((c.span ?? 1) > 1) ws.mergeCells(row.number, at, row.number, col);
          const cell = row.getCell(at);
          const x = c.text || c.lines || c.badge ? { v: fileText(c) } : excelValue(c.t);
          cell.value = x.v;
          if (x.fmt) cell.numFmt = x.fmt;
          cell.border = box;
          cell.alignment = {
            horizontal: c.center ? 'center' : c.text ? 'left' : 'right',
            vertical: 'middle',
            wrapText: Boolean(c.lines) || c.wrap || (c.text && c.t.length > 40),
          };
          if (c.tone === 'calc' || c.tone === 'final')
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: c.tone === 'calc' ? 'FFEBF7ED' : 'FFFFF5E0' },
            };
          if (c.tone === 'star' || c.tone === 'code' || c.tone === 'warn')
            cell.font = { color: { argb: 'FFBF1A1A' } };
          if (c.tone === 'final' || c.strong) cell.font = { ...(cell.font ?? {}), bold: true };
        });
      }
    }
    for (let i = 0; i < cols; i += 1)
      ws.getColumn(i + 1).width = Math.max(
        6,
        Math.round(Math.max(...group.map((x) => x.widths[i] ?? 0)) * 7),
      );
    // the register (one table): its heading rows and the student stay in view
    if (group.length === 1 && !group[0]!.title)
      ws.views = [
        {
          state: 'frozen',
          xSplit: group[0]!.frozen,
          ySplit: firstHead + group[0]!.head.length - 1,
        },
      ];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
