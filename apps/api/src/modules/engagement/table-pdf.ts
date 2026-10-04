import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export interface TablePdf {
  school: string;
  title: string;
  /** Under the title: the filters used, the date. */
  subtitle?: string;
  columns: Array<{ label: string; /** Share of the width. */ width: number; right?: boolean }>;
  rows: Array<Array<string | number | null | undefined>>;
}

const W = 841.89; // A4 landscape
const H = 595.28;
const M = 36;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
const ZEBRA = rgb(0.965, 0.972, 0.985);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
function fit(font: PDFFont, text: string, size: number, width: number): string {
  let out = latin(text);
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
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
  const ROW = 18;
  const pages: Array<ReturnType<typeof pdf.addPage>> = [];
  let page = pdf.addPage([W, H]);
  let y = 0;
  const head = () => {
    pages.push(page);
    page.drawRectangle({ x: 0, y: H - 46, width: W, height: 46, color: NAVY });
    page.drawText(fit(bold, t.school, 13, W / 2), {
      x: M,
      y: H - 28,
      size: 13,
      font: bold,
      color: rgb(1, 1, 1),
    });
    page.drawText(fit(bold, t.title, 11, W / 2 - M), {
      x: W / 2,
      y: H - 28,
      size: 11,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y = H - 62;
    if (t.subtitle) {
      page.drawText(fit(regular, t.subtitle, 9, W - 2 * M), {
        x: M,
        y,
        size: 9,
        font: regular,
        color: MUTED,
      });
      y -= 16;
    }
    let x = M;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: ROW, color: LINE });
    t.columns.forEach((c, i) => {
      const label = fit(bold, c.label, 8.5, widths[i]! - 8);
      page.drawText(label, {
        x: c.right ? x + widths[i]! - 4 - bold.widthOfTextAtSize(label, 8.5) : x + 4,
        y,
        size: 8.5,
        font: bold,
        color: INK,
      });
      x += widths[i]!;
    });
    y -= ROW;
  };
  head();
  t.rows.forEach((row, n) => {
    if (y < M + 20) {
      page = pdf.addPage([W, H]);
      head();
    }
    if (n % 2 === 1)
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: ROW, color: ZEBRA });
    let x = M;
    t.columns.forEach((c, i) => {
      const v = row[i];
      const s = fit(regular, v === null || v === undefined ? '' : String(v), 8.5, widths[i]! - 8);
      page.drawText(s, {
        x: c.right ? x + widths[i]! - 4 - regular.widthOfTextAtSize(s, 8.5) : x + 4,
        y,
        size: 8.5,
        font: regular,
        color: INK,
      });
      x += widths[i]!;
    });
    y -= ROW;
  });
  if (!t.rows.length)
    page.drawText('Nothing to show.', { x: M, y, size: 9, font: regular, color: MUTED });
  pages.forEach((p, i) =>
    p.drawText(
      `Page ${String(i + 1)} of ${String(pages.length)} · ${String(t.rows.length)} row(s)`,
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
