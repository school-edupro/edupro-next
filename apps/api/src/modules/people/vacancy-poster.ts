import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { qrPng } from '../engagement/visitor-card';

/** What the careers poster of a vacancy shows (docs/design/34-recruitment.md, part 5). */
export interface VacancyPoster {
  school: string;
  address: string | null;
  contact: string | null;
  code: string;
  title: string;
  /** designation, department, subject, number of posts: one line under the title */
  subline: string;
  rows: Array<[string, string | null]>;
  description: string | null;
  /** "30-10-2026, 5:00 pm" */
  closes: string;
  url: string;
}

const W = 595.28;
const H = 841.89;
const M = 48;
const NAVY = rgb(0, 0.149, 0.365);
const CYAN = rgb(0, 0.604, 0.816);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) =>
  s
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/** Words laid into lines of at most `width` (a word longer than the line is cut). */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
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
    if (line) out.push(line);
  }
  return out;
}

/** Lines drawn from `y` down; returns where the next thing starts. At most `max` lines ("..." after). */
function lines(
  page: PDFPage,
  font: PDFFont,
  text: string,
  o: {
    x: number;
    y: number;
    size: number;
    width: number;
    color?: ReturnType<typeof rgb>;
    max?: number;
    gap?: number;
  },
): number {
  let all = wrap(font, text, o.size, o.width);
  if (o.max && all.length > o.max) all = [...all.slice(0, o.max - 1), `${all[o.max - 1]!}...`];
  let y = o.y;
  for (const l of all) {
    page.drawText(l, { x: o.x, y, size: o.size, font, color: o.color ?? INK });
    y -= o.size * (o.gap ?? 1.35);
  }
  return y;
}

/**
 * The poster of a published vacancy as one A4 page: the school's band, the post and what it asks for,
 * the last date and time to apply, and the QR of the careers page with its link, for the notice board,
 * a newspaper or a WhatsApp group.
 */
export async function vacancyPosterPdf(p: VacancyPoster): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`${p.title} · ${p.school}`));
  const page = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const inner = W - 2 * M;

  // the school's band
  page.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: NAVY });
  let y = lines(page, bold, p.school, {
    x: M,
    y: H - 50,
    size: 22,
    width: inner,
    color: rgb(1, 1, 1),
    max: 1,
  });
  if (p.address)
    lines(page, regular, p.address, {
      x: M,
      y: y + 2,
      size: 10,
      width: inner,
      color: rgb(0.85, 0.9, 0.97),
      max: 2,
    });
  page.drawRectangle({ x: 0, y: H - 116, width: W, height: 4, color: CYAN });

  // the post
  y = H - 160;
  page.drawText('WE ARE HIRING', { x: M, y, size: 13, font: bold, color: CYAN });
  y = lines(page, bold, p.title, {
    x: M,
    y: y - 36,
    size: 30,
    width: inner,
    color: NAVY,
    max: 2,
    gap: 1.15,
  });
  if (p.subline)
    y = lines(page, regular, p.subline, {
      x: M,
      y: y - 4,
      size: 13,
      width: inner,
      color: MUTED,
      max: 2,
    });

  // what it asks for
  y -= 14;
  for (const [label, value] of p.rows) {
    if (!value) continue;
    page.drawLine({
      start: { x: M, y: y + 14 },
      end: { x: W - M, y: y + 14 },
      thickness: 0.6,
      color: LINE,
    });
    page.drawText(latin(label), { x: M, y, size: 10.5, font: bold, color: MUTED });
    y = lines(page, regular, value, { x: M + 150, y, size: 11, width: inner - 150, max: 4 }) - 8;
    if (y < 330) break;
  }
  if (p.description && y > 360) {
    y -= 6;
    page.drawText('About the post', { x: M, y, size: 12, font: bold, color: NAVY });
    lines(page, regular, p.description, {
      x: M,
      y: y - 18,
      size: 10.5,
      width: inner,
      color: INK,
      max: Math.max(2, Math.floor((y - 320) / 14.2)),
    });
  }

  // how to apply: the QR and the link
  const boxH = 230;
  const boxY = 70;
  page.drawRectangle({
    x: M,
    y: boxY,
    width: inner,
    height: boxH,
    borderColor: LINE,
    borderWidth: 1,
    color: rgb(0.965, 0.976, 0.992),
  });
  const qr = await pdf.embedPng(await qrPng(p.url));
  const q = 190;
  page.drawImage(qr, { x: M + 20, y: boxY + (boxH - q) / 2, width: q, height: q });
  const tx = M + 20 + q + 24;
  const tw = W - M - 20 - tx;
  let ty = boxY + boxH - 42;
  page.drawText('Apply online', { x: tx, y: ty, size: 20, font: bold, color: NAVY });
  ty = lines(page, regular, 'Scan the QR code with your phone, or open:', {
    x: tx,
    y: ty - 26,
    size: 11,
    width: tw,
    color: MUTED,
  });
  ty = lines(page, bold, p.url, { x: tx, y: ty, size: 10.5, width: tw, color: CYAN, max: 3 });
  ty -= 14;
  page.drawText('Last date to apply', { x: tx, y: ty, size: 10.5, font: regular, color: MUTED });
  ty = lines(page, bold, p.closes, { x: tx, y: ty - 18, size: 15, width: tw, color: INK, max: 1 });
  page.drawText(latin(`Vacancy ${p.code}`), {
    x: tx,
    y: ty - 6,
    size: 9.5,
    font: regular,
    color: MUTED,
  });

  if (p.contact)
    lines(page, regular, p.contact, { x: M, y: 44, size: 9.5, width: inner, color: MUTED, max: 1 });
  return Buffer.from(await pdf.save());
}
