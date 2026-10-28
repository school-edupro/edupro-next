import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { code128Bars } from '../library/library-labels';
import { latin, type SchoolHead } from './admission-pdf';

/** Draw of lots slips (docs/design/60, part 2): A4 pages of slips with cut lines, 2 to 8 a page. */

const A4: [number, number] = [595.28, 841.89];
const M = 24;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.6, 0.64, 0.7);

/** What a slip may show, in the order it shows them. */
export const SLIP_FIELDS = [
  'photo',
  'name',
  'father',
  'mother',
  'dob',
  'number',
  'sno',
  'points',
  'category',
  'session',
  'draw',
] as const;
export type SlipField = (typeof SLIP_FIELDS)[number];

/** One slip: a candidate, or twins sharing it. */
export interface Slip {
  sno: number;
  names: string[];
  numbers: string[];
  father: string | null;
  mother: string | null;
  dob: string | null;
  points: string;
  category: string | null;
  photos: Array<{ contentType: string; bytes: Buffer }>;
}

export interface SlipsInput {
  school: SchoolHead;
  logo: { contentType: string; bytes: Buffer } | null;
  /** the heading with its placeholders filled */
  heading: string;
  fields: SlipField[];
  session: string;
  /** the draw's date, time and venue in words */
  draw: string | null;
  footer: string | null;
  perPage: 2 | 4 | 6 | 8;
  slips: Slip[];
  title: string;
}

async function image(pdf: PDFDocument, f: { contentType: string; bytes: Buffer }) {
  try {
    return f.contentType === 'image/png'
      ? await pdf.embedPng(new Uint8Array(f.bytes))
      : await pdf.embedJpg(new Uint8Array(f.bytes));
  } catch {
    // a photo that cannot be read: the slip without it
    return null;
  }
}

/** A text cut to a width, with an ellipsis. */
const fit = (t: string, font: PDFFont, size: number, w: number) => {
  let s = latin(t);
  if (font.widthOfTextAtSize(s, size) <= w) return s;
  while (s && font.widthOfTextAtSize(`${s}...`, size) > w) s = s.slice(0, -1);
  return `${s}...`;
};

/** Words to lines of a width (at most `max` lines). */
const wrap = (t: string, font: PDFFont, size: number, w: number, max: number) => {
  const out: string[] = [];
  let cur = '';
  for (const word of latin(t).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && font.widthOfTextAtSize(next, size) > w) {
      out.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) out.push(cur);
  if (out.length > max) {
    out.length = max;
    out[max - 1] = fit(`${out[max - 1]!} ...`, font, size, w);
  }
  return out;
};

export async function drawSlipsPdf(p: SlipsInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(p.title));
  pdf.setAuthor(latin(p.school.name));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = p.logo ? await image(pdf, p.logo) : null;
  const cols = p.perPage === 2 ? 1 : 2;
  const rows = p.perPage / cols;
  const W = (A4[0] - 2 * M) / cols;
  const H = (A4[1] - 2 * M) / rows;
  const big = p.perPage <= 4;
  const show = new Set(p.fields);
  let page: PDFPage | null = null;
  for (const [i, s] of p.slips.entries()) {
    const at = i % p.perPage;
    if (at === 0) page = pdf.addPage(A4);
    const x = M + (at % cols) * W;
    const top = A4[1] - M - Math.floor(at / cols) * H;
    await slip(page!, s, x, top, W, H);
  }
  if (!p.slips.length) pdf.addPage(A4);
  return Buffer.from(await pdf.save());

  /** The slip's details: label, value, and whether the value may take two lines. */
  function details(s: Slip): Array<[string, string, boolean]> {
    const all: Array<[SlipField, string, string | null, boolean]> = [
      ['name', 'Name', s.names.join(' & '), true],
      ['father', "Father's name", s.father, false],
      ['mother', "Mother's name", s.mother, false],
      ['dob', 'Date of birth', s.dob, false],
      ['number', 'Reg. No.', s.numbers.join(' & '), true],
      ['sno', 'S.No.', String(s.sno), false],
      ['points', 'Points', s.points, false],
      ['category', 'Category', s.category, false],
    ];
    return all.filter(([k]) => show.has(k)).map(([, l, v, two]) => [l, v ?? '-', two]);
  }

  async function slip(page: PDFPage, s: Slip, x: number, top: number, w: number, h: number) {
    // the cut line
    page.drawRectangle({
      x: x + 3,
      y: top - h + 3,
      width: w - 6,
      height: h - 6,
      borderColor: LINE,
      borderWidth: 0.7,
      borderDashArray: [4, 3],
    });
    const pad = big ? 12 : 10;
    const left = x + pad;
    const inner = w - 2 * pad;
    const photos: PDFImage[] = [];
    if (show.has('photo'))
      for (const f of s.photos.slice(0, 2)) {
        const img = await image(pdf, f);
        if (img) photos.push(img);
      }
    const sub = [
      show.has('session') ? `Session: ${p.session}` : null,
      show.has('draw') && p.draw ? `Draw: ${p.draw}` : null,
    ].filter((v): v is string => Boolean(v));
    const rows = details(s);
    const number = s.numbers[0] ?? '';

    // the largest text that fits the slip
    const sizes = (fs: number) => {
      const lh = big ? 26 : Math.max(14, fs * 2);
      const ph = Math.min(big ? 70 : 52, fs * 7);
      const pw = ph * 0.8;
      const photoW = photos.length ? photos.length * (pw + 4) : 0;
      const labelW = Math.max(...rows.map(([l]) => bold.widthOfTextAtSize(`${l}:`, fs)), 0) + 8;
      const valueW = inner - labelW - (photoW ? photoW + 6 : 0);
      const heading = wrap(p.heading.toUpperCase(), bold, fs + 0.5, inner, 2);
      const values = rows.map(([, v, two]) =>
        two ? wrap(v, regular, fs, valueW, 2) : [fit(v, regular, fs, valueW)],
      );
      const notes = p.footer ? wrap(p.footer, regular, fs - 1.5, inner, 2) : [];
      const barH = number ? fs * 2.4 : 0;
      const height =
        (logo ? lh + 6 : fs + 8) +
        heading.length * (fs + 4) +
        sub.length * (fs + 2) +
        9 +
        Math.max(
          values.reduce((n, v) => n + v.length * (fs + 3) + 2, 0),
          photos.length ? ph : 0,
        ) +
        (number ? barH + fs + 14 : 0) +
        notes.length * (fs + 1) +
        2 * pad +
        6;
      return { fs, lh, ph, pw, photoW, labelW, valueW, heading, values, notes, barH, height };
    };
    let z = sizes(big ? 10 : 8.5);
    while (z.height > h && z.fs > 5.5) z = sizes(z.fs - 0.5);
    const { fs } = z;

    let y = top - pad - 4;
    // the school: logo and name
    if (logo) {
      const k = z.lh / logo.height;
      page.drawImage(logo, { x: left, y: y - z.lh, width: logo.width * k, height: z.lh });
      const nx = left + logo.width * k + 6;
      page.drawText(fit(p.school.name, bold, fs + 1, left + inner - nx), {
        x: nx,
        y: y - z.lh / 2 - (fs + 1) / 3,
        size: fs + 1,
        font: bold,
        color: NAVY,
      });
      y -= z.lh + 6;
    } else {
      page.drawText(fit(p.school.name, bold, fs + 1, inner), {
        x: left,
        y: y - fs,
        size: fs + 1,
        font: bold,
        color: NAVY,
      });
      y -= fs + 8;
    }
    // the heading and the session and draw, centred
    for (const line of z.heading) {
      const lw = bold.widthOfTextAtSize(line, fs + 0.5);
      page.drawText(line, {
        x: left + (inner - lw) / 2,
        y: y - fs,
        size: fs + 0.5,
        font: bold,
        color: INK,
      });
      y -= fs + 4;
    }
    for (const line of sub) {
      const t = fit(line, regular, fs - 1, inner);
      const lw = regular.widthOfTextAtSize(t, fs - 1);
      page.drawText(t, {
        x: left + (inner - lw) / 2,
        y: y - fs + 1,
        size: fs - 1,
        font: regular,
        color: MUTED,
      });
      y -= fs + 2;
    }
    y -= 3;
    page.drawLine({
      start: { x: left, y },
      end: { x: left + inner, y },
      thickness: 0.5,
      color: LINE,
    });
    y -= 6;
    // the photos on the right, the details on the left
    photos.forEach((img, j) => {
      const k = Math.min(z.pw / img.width, z.ph / img.height);
      page.drawImage(img, {
        x: left + inner - z.photoW + j * (z.pw + 4) + (z.pw - img.width * k) / 2,
        y: y - z.ph,
        width: img.width * k,
        height: img.height * k,
      });
    });
    rows.forEach(([label], j) => {
      page.drawText(latin(`${label}:`), { x: left, y: y - fs, size: fs, font: bold, color: INK });
      for (const line of z.values[j]!) {
        page.drawText(line, {
          x: left + z.labelW,
          y: y - fs,
          size: fs,
          font: label === 'Name' || label === 'Reg. No.' ? bold : regular,
          color: INK,
        });
        y -= fs + 3;
      }
      y -= 2;
    });
    // the footer note at the bottom, the barcode of the registration no. above it
    const bottom = top - h + pad;
    z.notes.forEach((line, j) =>
      page.drawText(line, {
        x: left,
        y: bottom + (z.notes.length - 1 - j) * (fs + 1),
        size: fs - 1.5,
        font: regular,
        color: MUTED,
      }),
    );
    if (number) {
      const barBottom = bottom + z.notes.length * (fs + 1) + fs + 4;
      const { bars, modules } = code128Bars(number);
      const bw = Math.min(inner * 0.7, modules * 1.1);
      const m = bw / modules;
      const bx = left + (inner - bw) / 2;
      for (const [start, width] of bars)
        page.drawRectangle({
          x: bx + start * m,
          y: barBottom,
          width: width * m,
          height: z.barH,
          color: INK,
        });
      const t = latin(number);
      const tw = regular.widthOfTextAtSize(t, fs - 2);
      page.drawText(t, {
        x: left + (inner - tw) / 2,
        y: barBottom - fs + 1,
        size: fs - 2,
        font: regular,
        color: INK,
      });
    }
  }
}
