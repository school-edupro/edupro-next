import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface TablePdf {
  school: string;
  title: string;
  /** Under the title: the filters used, the date. Several lines when an array. */
  subtitle?: string | string[];
  /** The school's address, under its name in the band. */
  address?: string;
  columns: Array<{
    label: string;
    /** Share of the width. */
    width: number;
    right?: boolean;
    /** Centred in its cell (a one-letter code under a date). */
    center?: boolean;
    /** A heading over this and the next columns that carry the same group (a date over M and A). */
    group?: string;
  }>;
  rows: Array<Array<string | number | null | undefined>>;
  /** Smaller for a sheet with many columns (default 8.5). */
  fontSize?: number;
  /** Long text runs onto more lines of its cell (up to three) instead of being cut. */
  wrap?: boolean;
  /** Rows (by position) printed in bold: subtotals and totals. */
  strong?: number[];
  /** The rows the footer counts (default all; a totals line is not one) */
  rowCount?: number;
  /**
   * Rows (by position) with a shaded band: a heading across the table (its words are the row's first
   * filled cell, written from the left edge), a subtotal, or the grand total (dark, white letters).
   */
  shade?: Record<number, 'heading' | 'subheading' | 'subtotal' | 'total' | 'grand'>;
  /** Small tables printed under the main one (a summary by mode, by ledger …), each with its own columns. */
  after?: Array<{
    title: string;
    columns: Array<{ label: string; width: number; right?: boolean }>;
    rows: Array<Array<string | number | null | undefined>>;
    /** The last row is a total. */
    total?: boolean;
  }>;
  /** A closing line under everything (the rule the figures follow). */
  footnote?: string;
}

const W = 841.89; // A4 landscape
const H = 595.28;
const M = 36;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
const ZEBRA = rgb(0.965, 0.972, 0.985);
// the bands of a grouped report, as in the school's own Excel sheets
const BANDS = {
  heading: rgb(0.933, 0.945, 0.984),
  subheading: rgb(0.914, 0.925, 0.984),
  subtotal: rgb(0.957, 0.965, 0.984),
  total: rgb(0.875, 0.894, 0.969),
  grand: rgb(0.11, 0.165, 0.439),
};

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
function fit(font: PDFFont, text: string, size: number, width: number): string {
  let out = latin(text);
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
}

/** Breaks text into the lines that fit a cell: at spaces, and inside a word too long for the cell. */
function wrapLines(
  font: PDFFont,
  text: string,
  size: number,
  width: number,
  max: number,
): string[] {
  const out: string[] = [];
  let line = '';
  const push = (word: string) => {
    let w = word;
    while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
      out.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    line = w;
  };
  for (const word of latin(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      push(word);
    }
  }
  if (line) out.push(line);
  if (out.length <= max) return out.length ? out : [''];
  return [...out.slice(0, max - 1), fit(font, out.slice(max - 1).join(' '), size, width)];
}

/**
 * A plain list as a PDF (A4 landscape): the school band, the title, a header row repeated on every page,
 * zebra rows and page numbers. Used for the clinic's set-up lists and stock reports, straight from the API
 * (no worker needed).
 */
export async function tablePdf(t: TablePdf): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(t.title);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const total = t.columns.reduce((n, c) => n + c.width, 0) || 1;
  const widths = t.columns.map((c) => ((W - 2 * M) * c.width) / total);
  const FS = t.fontSize ?? 8.5;
  const ROW = FS < 8 ? 14 : 18;
  const pages: Array<ReturnType<typeof pdf.addPage>> = [];
  let page = pdf.addPage([W, H]);
  let y = 0;
  const PAD = FS < 8 ? 2 : 4;
  const LEAD = FS + 2;
  /** The lines of one cell: one cut line, or up to three when the sheet wraps. */
  const cell = (font: PDFFont, text: string, i: number): string[] =>
    t.wrap
      ? wrapLines(font, text, FS, widths[i]! - 2 * PAD, 3)
      : [fit(font, text, FS, widths[i]! - 2 * PAD)];
  const draw = (cells: string[][], font: PDFFont, color = INK) => {
    let x = M;
    t.columns.forEach((c, i) => {
      cells[i]!.forEach((s, k) =>
        page.drawText(s, {
          x: c.right
            ? x + widths[i]! - PAD - font.widthOfTextAtSize(s, FS)
            : c.center
              ? x + (widths[i]! - font.widthOfTextAtSize(s, FS)) / 2
              : x + PAD,
          y: y - k * LEAD,
          size: FS,
          font,
          color,
        }),
      );
      x += widths[i]!;
    });
  };
  const head = () => {
    pages.push(page);
    const BAND = t.address ? 58 : 46;
    page.drawRectangle({ x: 0, y: H - BAND, width: W, height: BAND, color: NAVY });
    page.drawText(fit(bold, t.school, 13, W / 2), {
      x: M,
      y: H - 28,
      size: 13,
      font: bold,
      color: rgb(1, 1, 1),
    });
    if (t.address)
      page.drawText(fit(regular, t.address, 8.5, W / 2), {
        x: M,
        y: H - 44,
        size: 8.5,
        font: regular,
        color: rgb(1, 1, 1),
      });
    page.drawText(fit(bold, t.title, 11, W / 2 - M), {
      x: W / 2,
      y: H - 28,
      size: 11,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y = H - BAND - 16;
    for (const line of [t.subtitle ?? []].flat()) {
      page.drawText(fit(regular, line, 9, W - 2 * M), {
        x: M,
        y,
        size: 9,
        font: regular,
        color: MUTED,
      });
      y -= 13;
    }
    y -= 3;
    if (t.columns.some((c) => c.group)) {
      // the headings over grouped columns: one label centred over each run of the same group
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: ROW, color: LINE });
      let gx = M;
      for (let i = 0; i < t.columns.length;) {
        const g = t.columns[i]!.group;
        let span = widths[i]!;
        let k = i + 1;
        while (g && k < t.columns.length && t.columns[k]!.group === g) {
          span += widths[k]!;
          k += 1;
        }
        if (g) {
          const label = fit(bold, g, FS, span - 1);
          page.drawText(label, {
            x: gx + (span - bold.widthOfTextAtSize(label, FS)) / 2,
            y,
            size: FS,
            font: bold,
            color: INK,
          });
          page.drawLine({
            start: { x: gx, y: y - 5 },
            end: { x: gx, y: y - 5 + ROW },
            thickness: 0.4,
            color: rgb(1, 1, 1),
          });
        }
        gx += span;
        i = k;
      }
      y -= ROW;
    }
    const labels = t.columns.map((c, i) => cell(bold, c.label, i));
    const extra = (Math.max(...labels.map((l) => l.length), 1) - 1) * LEAD;
    page.drawRectangle({
      x: M,
      y: y - 5 - extra,
      width: W - 2 * M,
      height: ROW + extra,
      color: LINE,
    });
    draw(labels, bold);
    y -= ROW + extra;
  };
  head();
  const strongRows = new Set(t.strong ?? []);
  t.rows.forEach((row, n) => {
    if (y < M + 20) {
      page = pdf.addPage([W, H]);
      head();
    }
    const band = t.shade?.[n];
    if (band === 'heading' || band === 'subheading') {
      // a heading runs across the table: its words are the first filled cell
      const words = String(row.find((v) => v !== null && v !== undefined && v !== '') ?? '');
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: ROW, color: BANDS[band] });
      page.drawText(fit(bold, words, FS + 0.5, W - 2 * M - 2 * PAD), {
        x: M + PAD,
        y,
        size: FS + 0.5,
        font: bold,
        color: NAVY,
      });
      y -= ROW;
      return;
    }
    const face = strongRows.has(n) || band ? bold : regular;
    const cells = t.columns.map((_, i) => {
      const v = row[i];
      return cell(face, v === null || v === undefined ? '' : String(v), i);
    });
    const extra = (Math.max(...cells.map((l) => l.length), 1) - 1) * LEAD;
    if (y - extra < M + 20) {
      page = pdf.addPage([W, H]);
      head();
    }
    if (band || n % 2 === 1)
      page.drawRectangle({
        x: M,
        y: y - 5 - extra,
        width: W - 2 * M,
        height: ROW + extra,
        color: band ? BANDS[band] : ZEBRA,
      });
    draw(cells, face, band === 'grand' ? rgb(1, 1, 1) : INK);
    y -= ROW + extra;
  });
  if (!t.rows.length)
    page.drawText('Nothing to show.', { x: M, y, size: 9, font: regular, color: MUTED });
  // the small tables under the main one: half the page wide, each with a title and its own header row
  const SFS = Math.max(FS, 8);
  const SROW = 16;
  const fresh = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 30, width: W, height: 30, color: NAVY });
    page.drawText(fit(bold, `${t.school} · ${t.title}`, 11, W - 2 * M), {
      x: M,
      y: H - 20,
      size: 11,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y = H - 30 - 22;
  };
  for (const block of t.after ?? []) {
    if (y - (block.rows.length + 3) * SROW < M + 20) fresh();
    else y -= 14;
    const span = (W - 2 * M) * 0.55;
    const sum = block.columns.reduce((a, c) => a + c.width, 0) || 1;
    const bw = block.columns.map((c) => (span * c.width) / sum);
    page.drawText(fit(bold, block.title, SFS + 1.5, span), {
      x: M,
      y,
      size: SFS + 1.5,
      font: bold,
      color: NAVY,
    });
    y -= SROW + 2;
    const line = (
      cells: Array<string | number | null | undefined>,
      font: PDFFont,
      fill?: ReturnType<typeof rgb>,
      color = INK,
    ) => {
      if (fill) page.drawRectangle({ x: M, y: y - 4, width: span, height: SROW, color: fill });
      let x = M;
      block.columns.forEach((c, i) => {
        const v = cells[i];
        const s = fit(font, v === null || v === undefined ? '' : String(v), SFS, bw[i]! - 8);
        page.drawText(s, {
          x: c.right ? x + bw[i]! - 4 - font.widthOfTextAtSize(s, SFS) : x + 4,
          y,
          size: SFS,
          font,
          color,
        });
        x += bw[i]!;
      });
      y -= SROW;
    };
    line(
      block.columns.map((c) => c.label),
      bold,
      BANDS.heading,
      NAVY,
    );
    block.rows.forEach((r, i) => {
      if (y < M + 20) fresh();
      const last = block.total && i === block.rows.length - 1;
      line(r, last ? bold : regular, last ? BANDS.total : i % 2 === 1 ? ZEBRA : undefined);
    });
  }
  if (t.footnote) {
    if (y < M + 40) fresh();
    y -= 10;
    for (const l of wrapLines(regular, t.footnote, 8, W - 2 * M, 4)) {
      page.drawText(l, { x: M, y, size: 8, font: regular, color: MUTED });
      y -= 11;
    }
  }
  pages.forEach((p, i) =>
    p.drawText(
      `Page ${String(i + 1)} of ${String(pages.length)} · ${String(t.rowCount ?? t.rows.length)} row(s)`,
      {
        x: M,
        y: 18,
        size: 8,
        font: regular,
        color: MUTED,
      },
    ),
  );
  return Buffer.from(await pdf.save());
}
