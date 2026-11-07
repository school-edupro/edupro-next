import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/**
 * The letterhead of the school's printed papers, as the Term Mark Register prints it: the logo on the
 * left and, centred over the page, the school's name, its address, an optional line (GSTIN, telephone),
 * what the paper is, and a details line (its number, the department, when it was made). Used by the
 * printed Purchase Indent, Requisition and Order and by the purchase lists' PDFs.
 */
export interface LetterheadLogo {
  contentType: string;
  bytes: Buffer;
}

const INK = rgb(0.1, 0.1, 0.12);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

function clip(font: PDFFont, text: string, size: number, width: number): string {
  let s = latin(text);
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}..`, size) > width) s = s.slice(0, -1);
  return `${s}..`;
}

/** The school's logo embedded in the paper (PNG or JPEG); none when it cannot be read. */
export async function embedLogo(
  doc: PDFDocument,
  logo: LetterheadLogo | null,
): Promise<PDFImage | null> {
  if (!logo || !/^image\/(png|jpe?g)$/.test(logo.contentType)) return null;
  try {
    return logo.contentType === 'image/png'
      ? await doc.embedPng(new Uint8Array(logo.bytes))
      : await doc.embedJpg(new Uint8Array(logo.bytes));
  } catch {
    return null;
  }
}

/** Draws the letterhead at the top of the page; returns the y under it. */
export function drawLetterhead(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  logo: PDFImage | null,
  o: {
    school: string;
    address?: string | null;
    /** a line under the address: GSTIN, State, telephone */
    extra?: string | null;
    title: string;
    /** No. PI/2026-27/0001 · Department: Library · Generated on: 07-11-2026 06:15 PM */
    details?: string | null;
    margin: number;
  },
): number {
  const { width: W, height: H } = page.getSize();
  let top = H - o.margin;
  let logoBottom = top;
  if (logo) {
    const s = Math.min(46 / logo.height, 80 / logo.width);
    page.drawImage(logo, {
      x: o.margin,
      y: top - logo.height * s,
      width: logo.width * s,
      height: logo.height * s,
    });
    logoBottom = top - logo.height * s;
  }
  // the lines keep clear of the logo on both sides, so they stay centred on the page
  const room = W - 2 * o.margin - 2 * (logo ? 92 : 0);
  const centre = (text: string, font: PDFFont, size: number, gap = 4) => {
    const t = clip(font, text, size, room);
    page.drawText(t, {
      x: W / 2 - font.widthOfTextAtSize(t, size) / 2,
      y: top - size,
      size,
      font,
      color: INK,
    });
    top -= size + gap;
  };
  // a long address or extra line breaks at its separators onto a second line rather than being cut
  const centreWrapped = (text: string, font: PDFFont, size: number) => {
    const parts = latin(text).split(/(?<=,|·) /);
    let line = '';
    let lines = 0;
    for (const part of parts) {
      const next = line ? `${line} ${part}` : part;
      if (line && font.widthOfTextAtSize(next, size) > room && lines < 1) {
        centre(line.replace(/[,·]$/, '').trim(), font, size, 2);
        lines += 1;
        line = part;
      } else line = next;
    }
    if (line) centre(line, font, size);
  };
  centre(o.school, fonts.bold, 15, 5);
  if (o.address) centreWrapped(o.address, fonts.regular, 9.5);
  if (o.extra) centreWrapped(o.extra, fonts.regular, 8.5);
  centre(o.title, fonts.bold, 12, 4);
  if (o.details) centre(o.details, fonts.regular, 9.5);
  return Math.min(top, logoBottom) - 10;
}
