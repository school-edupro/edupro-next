import bwipjs from 'bwip-js';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * The bars of a text in Code 128 (bwip-js picks the shortest of sets A, B and C, so a run of digits is
 * packed two to a symbol): [start, width] in modules from the left edge, with quiet zones of 10 modules.
 */
export function code128Bars(text: string) {
  const raw = bwipjs.raw({ bcid: 'code128', text }) as Array<{ sbs: number[] }>;
  const sbs = raw[0]?.sbs ?? [];
  const bars: Array<[number, number]> = [];
  let x = 10;
  sbs.forEach((w, i) => {
    if (i % 2 === 0) bars.push([x, w]);
    x += w;
  });
  return { bars, modules: x + 10 };
}

/** A sheet of labels: how many across and down, the label's size and the gaps, in millimetres. */
export interface Sheet {
  cols: number;
  rows: number;
  width: number;
  height: number;
  top: number;
  left: number;
  gapX: number;
  gapY: number;
}
export const PRESETS: Record<string, Sheet & { name: string }> = {
  'a4-3x8': {
    name: 'A4, 24 labels (3 × 8, 64 × 33.9 mm)',
    cols: 3,
    rows: 8,
    width: 64,
    height: 33.9,
    top: 12.9,
    left: 7,
    gapX: 2,
    gapY: 0,
  },
  'a4-4x10': {
    name: 'A4, 40 labels (4 × 10, 48.5 × 25.4 mm)',
    cols: 4,
    rows: 10,
    width: 48.5,
    height: 25.4,
    top: 21.5,
    left: 8,
    gapX: 0,
    gapY: 0,
  },
  l7651: {
    name: 'Avery L7651, 65 labels (5 × 13, 38.1 × 21.2 mm)',
    cols: 5,
    rows: 13,
    width: 38.1,
    height: 21.2,
    top: 10.7,
    left: 4.7,
    gapX: 2.5,
    gapY: 0,
  },
  'a4-2x7': {
    name: 'A4, 14 labels (2 × 7, 99.1 × 38.1 mm)',
    cols: 2,
    rows: 7,
    width: 99.1,
    height: 38.1,
    top: 15.1,
    left: 4.7,
    gapX: 2.5,
    gapY: 0,
  },
};
const MM = 72 / 25.4;
const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0, 0, 0);

export interface Label {
  accessionNo: string;
  title: string | null;
  callNo: string | null;
  top: string | null;
}

/** Latin letters only in the built-in PDF fonts: a text with others is left off rather than garbled. */
const latin = (s: string | null) =>
  s && /^[\x20-\x7E -ÿ‘’“”–—]*$/.test(s)
    ? s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    : null;

/** A text cut to the width, with "…" (as "...") when it is longer. */
function fit(font: PDFFont, s: string, size: number, width: number) {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

/**
 * Library labels as a PDF (docs/design/36-library.md, part 5): for each copy a barcode label (the top
 * line, the title, the bars of the accession number, the number and the call number), a spine label
 * (the call number in lines, the accession number), or both; each repeated as asked; the first labels
 * of a used sheet left blank.
 */
export async function labelsPdf(
  labels: Label[],
  o: {
    kind: 'barcode' | 'spine' | 'both';
    sheet: Sheet;
    copies: number;
    skip: number;
    title: string;
  },
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(o.title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const s = o.sheet;
  const w = s.width * MM;
  const h = s.height * MM;
  const per = s.cols * s.rows;
  const cells: Array<{ label: Label; kind: 'barcode' | 'spine' }> = [];
  for (const l of labels)
    for (let n = 0; n < o.copies; n += 1) {
      if (o.kind !== 'spine') cells.push({ label: l, kind: 'barcode' });
      if (o.kind !== 'barcode') cells.push({ label: l, kind: 'spine' });
    }
  let page: PDFPage | null = null;
  let pos = o.skip;
  for (const cell of cells) {
    if (!page || pos >= per) {
      page = pdf.addPage(A4);
      if (pos >= per) pos = 0;
    }
    const col = pos % s.cols;
    const row = Math.floor(pos / s.cols);
    const x = (s.left + col * (s.width + s.gapX)) * MM;
    const y = A4[1] - (s.top + row * (s.height + s.gapY)) * MM - h;
    if (cell.kind === 'barcode') barcodeLabel(page, cell.label, x, y, w, h, regular, bold);
    else spineLabel(page, cell.label, x, y, w, h, regular, bold);
    pos += 1;
  }
  if (!page) pdf.addPage(A4);
  return { bytes: Buffer.from(await pdf.save()), pages: pdf.getPageCount(), labels: cells.length };
}

function barcodeLabel(
  page: PDFPage,
  l: Label,
  x: number,
  y: number,
  w: number,
  h: number,
  regular: PDFFont,
  bold: PDFFont,
) {
  const pad = Math.min(w, h) * 0.08;
  const inner = w - 2 * pad;
  const small = Math.max(4.5, Math.min(8, h * 0.11));
  const big = Math.max(6, Math.min(11, h * 0.15));
  let top = y + h - pad;
  const line = (text: string, font: PDFFont, size: number) => {
    top -= size;
    page.drawText(fit(font, text, size, inner), { x: x + pad, y: top, size, font, color: INK });
    top -= size * 0.25;
  };
  const head = latin(l.top);
  if (head) line(head, bold, small);
  const title = latin(l.title);
  if (title && h > 22 * MM) line(title, regular, small);
  // the number and the call number on the last line; the bars between
  const bottom = y + pad;
  page.drawText(fit(bold, l.accessionNo, big, inner * 0.6), {
    x: x + pad,
    y: bottom,
    size: big,
    font: bold,
    color: INK,
  });
  const call = latin(l.callNo);
  if (call) {
    const t = fit(regular, call, small, inner * 0.4);
    page.drawText(t, {
      x: x + w - pad - regular.widthOfTextAtSize(t, small),
      y: bottom,
      size: small,
      font: regular,
      color: INK,
    });
  }
  const barTop = top - small * 0.2;
  const barBottom = bottom + big + small * 0.3;
  const barH = Math.max(6, barTop - barBottom);
  const { bars, modules } = code128Bars(l.accessionNo);
  const m = inner / modules;
  for (const [start, width] of bars)
    page.drawRectangle({
      x: x + pad + start * m,
      y: barBottom,
      width: width * m,
      height: barH,
      color: INK,
    });
}

function spineLabel(
  page: PDFPage,
  l: Label,
  x: number,
  y: number,
  w: number,
  h: number,
  regular: PDFFont,
  bold: PDFFont,
) {
  const pad = Math.min(w, h) * 0.08;
  const inner = w - 2 * pad;
  // the call number in lines (class, author mark …), the accession number under them
  const parts = (latin(l.callNo) ?? '').split(/\s+/).filter(Boolean).slice(0, 3);
  const lines = parts.length ? parts : [];
  const n = lines.length + 1;
  const size = Math.max(6, Math.min(16, ((h - 2 * pad) / n) * 0.72));
  const accSize = Math.max(5, Math.min(11, size * 0.75));
  const total = lines.length * size * 1.15 + accSize;
  let top = y + h / 2 + total / 2;
  for (const t of lines) {
    top -= size;
    const s = fit(bold, t, size, inner);
    page.drawText(s, {
      x: x + (w - bold.widthOfTextAtSize(s, size)) / 2,
      y: top,
      size,
      font: bold,
      color: INK,
    });
    top -= size * 0.15;
  }
  top -= accSize;
  const a = fit(regular, l.accessionNo, accSize, inner);
  page.drawText(a, {
    x: x + (w - regular.widthOfTextAtSize(a, accSize)) / 2,
    y: top,
    size: accSize,
    font: regular,
    color: INK,
  });
}
