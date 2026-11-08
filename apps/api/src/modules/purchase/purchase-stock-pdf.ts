import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawLetterhead, embedLogo } from '../../common/pdf/letterhead';
import { drawSignBoxes, type SignBox } from './purchase-doc-sign';

/**
 * A store's document as a PDF (docs/design/84, part 8; the look: docs/design/83, "As built — store
 * documents like the indent's"): the issue slip, the return note, the transfer note, the count sheet and
 * the condemnation share one layout — A4, the school's letterhead as the indent prints it (logo; name,
 * address, title, number and when it was made), the facts (key and value), a table of lines (with a
 * muted detail under a cell), an optional total, the signature boxes as on the PO (name, Emp. ID ·
 * designation and when where known; empty to sign by hand) and a note at the foot. A watermark across a
 * document not final (cancelled, not approved).
 */

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const W = A4[0] - 2 * M;
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);
const BAND = rgb(0.953, 0.961, 0.976);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

export interface StockPdfData {
  school: { name: string; address: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  title: string;
  number: string;
  /** 08-11-2026 06:15 PM, India (pdfSchool gives it) */
  generatedOn?: string;
  watermark: string | null;
  facts: Array<[string, string]>;
  columns: Array<{ label: string; width: number; right?: boolean }>;
  rows: Array<{ cells: string[]; detail?: string }>;
  total?: { label: string; value: string };
  /** a box filled from the system (signerOf), or a label with the name and date known */
  signatures: Array<SignBox | { label: string; name?: string | null; at?: string | null }>;
  foot?: string;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut -= 1;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export async function purchaseStockPdf(d: StockPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`${d.title} ${d.number}`));
  pdf.setAuthor(latin(d.school.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, d.logo);
  let page: PDFPage = pdf.addPage(A4);
  let y = 0;
  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: number } = {},
  ) => {
    const size = o.size ?? 8.5;
    const f = o.f ?? font;
    const t = latin(s);
    const xx = o.right !== undefined ? o.right - f.widthOfTextAtSize(t, size) : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };
  // the letterhead, as the indent prints it: logo left; name, address, title, details centred
  const head = () => {
    y = drawLetterhead(page, { regular: font, bold }, logo, {
      school: d.school.name,
      address: d.school.address,
      title: d.title,
      details: `No. ${d.number}${d.generatedOn ? ` · Generated on: ${d.generatedOn}` : ''}`,
      margin: 30,
    });
    page.drawLine({
      start: { x: M, y: y + 4 },
      end: { x: M + W, y: y + 4 },
      thickness: 0.8,
      color: LINE,
    });
    y -= 10;
    if (d.watermark)
      page.drawText(latin(d.watermark), {
        x: 120,
        y: 330,
        size: 62,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(35),
      });
  };
  const xs: number[] = [];
  const scale = W / d.columns.reduce((a, c) => a + c.width, 0);
  d.columns.reduce((x, c) => {
    xs.push(x);
    return x + c.width * scale;
  }, M);
  const colW = (i: number) => d.columns[i]!.width * scale;
  const header = () => {
    page.drawRectangle({ x: M - 2, y: y - 4, width: W + 4, height: 15, color: BAND });
    d.columns.forEach((c, i) =>
      text(c.label, xs[i]!, y, {
        size: 7.5,
        f: bold,
        color: MUTED,
        ...(c.right ? { right: xs[i]! + colW(i) - 3 } : {}),
      }),
    );
    y -= 16;
  };
  const need = (h: number, again?: () => void) => {
    if (y - h < M + 30) {
      page = pdf.addPage(A4);
      head();
      again?.();
    }
  };

  head();
  for (const [k, v] of d.facts) {
    text(k, M, y, { color: MUTED });
    for (const l of wrap(v, font, 8.5, W - 110)) {
      text(l, M + 110, y);
      y -= 11;
    }
  }
  y -= 8;
  header();
  for (const r of d.rows) {
    const cells = r.cells.map((c, i) => wrap(c, font, 8, colW(i) - 4));
    const detail = r.detail ? wrap(r.detail, font, 7, colW(1) - 4) : [];
    const h = (Math.max(...cells.map((c) => c.length)) + detail.length) * 10 + 4;
    need(h, header);
    let low = y;
    cells.forEach((lines, i) => {
      let ly = y;
      const c = d.columns[i]!;
      for (const l of lines) {
        text(l, xs[i]!, ly, { size: 8, ...(c.right ? { right: xs[i]! + colW(i) - 3 } : {}) });
        ly -= 10;
      }
      if (i === 1)
        for (const l of detail) {
          text(l, xs[1]!, ly, { size: 7, color: MUTED });
          ly -= 10;
        }
      low = Math.min(low, ly);
    });
    y = low - 4;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: M + W, y: y + 6 },
      thickness: 0.5,
      color: LINE,
    });
  }
  if (d.total) {
    need(20);
    text(d.total.label, M, y, { f: bold });
    text(d.total.value, 0, y, { f: bold, right: M + W - 3 });
    y -= 16;
  }
  y -= 14;
  // the boxes to sign, as on the PO: filled from the system where known, else the name and date known
  const boxes: SignBox[] = d.signatures.map((sg) =>
    'as' in sg
      ? sg
      : {
          as: sg.label,
          name: sg.name ?? null,
          code: null,
          designation: null,
          when: sg.at ? `On ${sg.at}` : null,
          signature: null,
        },
  );
  need(110 * Math.ceil(boxes.length / 4));
  y = await drawSignBoxes(pdf, page, { regular: font, bold }, boxes, { x: M, y, width: W });
  y -= 6;
  if (d.foot) {
    need(30);
    for (const l of wrap(d.foot, font, 7.5, W)) {
      text(l, M, y, { size: 7.5, color: MUTED });
      y -= 10;
    }
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    if (d.generatedOn) text(`Printed ${d.generatedOn}`, M, 20, { size: 7, color: MUTED });
    text(`${d.number} · page ${String(i + 1)} of ${String(pages.length)}`, 0, 20, {
      size: 7,
      color: MUTED,
      right: M + W,
    });
  });
  return Buffer.from(await pdf.save());
}
