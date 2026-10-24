import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Employee exit papers (docs/design/38, part 7): A4, the school's band on top. */

const A4: [number, number] = [595.28, 841.89];
const M = 48;
const NAVY = rgb(0, 0.149, 0.365);
const CYAN = rgb(0, 0.604, 0.816);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

export interface SchoolHead {
  name: string;
  address: string | null;
  contact: string | null;
}
type Logo = { contentType: string; bytes: Buffer } | null;

async function start(title: string, school: SchoolHead, logo: Logo) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(title));
  pdf.setAuthor(latin(school.name));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage(A4);
  page.drawRectangle({ x: 0, y: A4[1] - 96, width: A4[0], height: 96, color: NAVY });
  let x = M;
  if (logo) {
    try {
      const img =
        logo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(logo.bytes))
          : await pdf.embedJpg(new Uint8Array(logo.bytes));
      const s = Math.min(56 / img.width, 56 / img.height);
      page.drawImage(img, { x: M, y: A4[1] - 76, width: img.width * s, height: img.height * s });
      x = M + 70;
    } catch {
      // no logo rather than no letter
    }
  }
  page.drawText(latin(school.name), {
    x,
    y: A4[1] - 44,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  for (const [i, line] of [school.address, school.contact].entries())
    if (line)
      page.drawText(latin(line).slice(0, 110), {
        x,
        y: A4[1] - 62 - i * 13,
        size: 9,
        font: regular,
        color: rgb(0.85, 0.89, 0.95),
      });
  return { pdf, page, regular, bold };
}

/** Wraps a paragraph to the width; returns the y below it. */
function para(
  page: PDFPage,
  font: PDFFont,
  text: string,
  y: number,
  size = 11,
  width = A4[0] - 2 * M,
) {
  for (const block of latin(text).split('\n')) {
    let line = '';
    for (const w of block.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) {
        page.drawText(line, { x: M, y, size, font, color: INK });
        y -= size + 5;
        line = w;
      } else line = next;
    }
    if (line) page.drawText(line, { x: M, y, size, font, color: INK });
    y -= size + 9;
  }
  return y;
}

export interface LetterInput {
  school: SchoolHead;
  logo: Logo;
  title: string;
  ref: string;
  date: string;
  to: string[];
  subject: string;
  paragraphs: string[];
  signer: string;
}

/** A letter on the school's letterhead: reference and date, to, subject, body, signature line. */
export async function exitLetterPdf(p: LetterInput): Promise<Buffer> {
  const { pdf, page, regular, bold } = await start(p.title, p.school, p.logo);
  let y = A4[1] - 130;
  page.drawText(latin(`Ref. ${p.ref}`), { x: M, y, size: 10, font: regular, color: MUTED });
  const d = latin(`Date ${p.date}`);
  page.drawText(d, {
    x: A4[0] - M - regular.widthOfTextAtSize(d, 10),
    y,
    size: 10,
    font: regular,
    color: MUTED,
  });
  y -= 30;
  page.drawText(latin(p.title.toUpperCase()), { x: M, y, size: 13, font: bold, color: NAVY });
  y -= 28;
  for (const line of p.to) {
    page.drawText(latin(line), {
      x: M,
      y,
      size: 11,
      font: line === p.to[0] ? bold : regular,
      color: INK,
    });
    y -= 15;
  }
  y -= 10;
  y = para(page, bold, `Subject: ${p.subject}`, y);
  y -= 4;
  for (const t of p.paragraphs) y = para(page, regular, t, y);
  y -= 50;
  page.drawLine({
    start: { x: M, y: y + 14 },
    end: { x: M + 180, y: y + 14 },
    thickness: 0.6,
    color: LINE,
  });
  page.drawText(latin(p.signer), { x: M, y, size: 10, font: bold, color: INK });
  page.drawText(latin(p.school.name), { x: M, y: y - 14, size: 10, font: regular, color: MUTED });
  return Buffer.from(await pdf.save());
}

export interface FnfInput {
  school: SchoolHead;
  logo: Logo;
  ref: string;
  date: string;
  employee: Array<[string, string]>;
  earnings: Array<{ label: string; amount: number; note: string | null }>;
  deductions: Array<{ label: string; amount: number; note: string | null }>;
  totals: { earnings: number; deductions: number; net: number };
  words: string;
  status: string;
}

const rs = (n: number) =>
  `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The full and final statement: the employee, earnings, deductions, the net payable or recoverable. */
export async function fnfPdf(p: FnfInput): Promise<Buffer> {
  const { pdf, page, regular, bold } = await start(
    `Full and final statement ${p.ref}`,
    p.school,
    p.logo,
  );
  let y = A4[1] - 130;
  page.drawText('FULL AND FINAL SETTLEMENT', { x: M, y, size: 10, font: bold, color: CYAN });
  const d = latin(`Date ${p.date}`);
  page.drawText(d, {
    x: A4[0] - M - regular.widthOfTextAtSize(d, 10),
    y,
    size: 10,
    font: regular,
    color: MUTED,
  });
  y -= 22;
  page.drawText(latin(`Statement ${p.ref} · ${p.status}`), {
    x: M,
    y,
    size: 13,
    font: bold,
    color: NAVY,
  });
  y -= 24;
  for (const [k, v] of p.employee) {
    page.drawText(latin(k), { x: M, y, size: 10, font: regular, color: MUTED });
    page.drawText(latin(v).slice(0, 70), { x: M + 160, y, size: 10.5, font: bold, color: INK });
    y -= 16;
  }
  const table = (title: string, rows: FnfInput['earnings'], total: number) => {
    y -= 10;
    page.drawText(latin(title), { x: M, y, size: 11, font: bold, color: NAVY });
    y -= 16;
    for (const r of rows) {
      page.drawText(latin(r.label).slice(0, 60), {
        x: M + 8,
        y,
        size: 10,
        font: regular,
        color: INK,
      });
      if (r.note)
        page.drawText(latin(r.note).slice(0, 40), {
          x: M + 260,
          y,
          size: 8.5,
          font: regular,
          color: MUTED,
        });
      const a = rs(r.amount);
      page.drawText(a, {
        x: A4[0] - M - regular.widthOfTextAtSize(a, 10),
        y,
        size: 10,
        font: regular,
        color: INK,
      });
      y -= 15;
    }
    page.drawLine({
      start: { x: M, y: y + 9 },
      end: { x: A4[0] - M, y: y + 9 },
      thickness: 0.5,
      color: LINE,
    });
    const t = rs(total);
    page.drawText(`Total ${title.toLowerCase()}`, {
      x: M + 8,
      y: y - 4,
      size: 10,
      font: bold,
      color: INK,
    });
    page.drawText(t, {
      x: A4[0] - M - bold.widthOfTextAtSize(t, 10),
      y: y - 4,
      size: 10,
      font: bold,
      color: INK,
    });
    y -= 24;
  };
  table('Earnings', p.earnings, p.totals.earnings);
  table('Deductions', p.deductions, p.totals.deductions);
  y -= 6;
  page.drawRectangle({
    x: M,
    y: y - 10,
    width: A4[0] - 2 * M,
    height: 30,
    color: rgb(0.93, 0.96, 0.99),
  });
  const label =
    p.totals.net >= 0 ? 'Net payable to the employee' : 'Net recoverable from the employee';
  page.drawText(label, { x: M + 10, y, size: 11, font: bold, color: NAVY });
  const n = rs(Math.abs(p.totals.net));
  page.drawText(n, {
    x: A4[0] - M - 10 - bold.widthOfTextAtSize(n, 12),
    y,
    size: 12,
    font: bold,
    color: NAVY,
  });
  y -= 30;
  y = para(page, regular, p.words, y, 9.5);
  y -= 50;
  for (const [i, who] of [
    'Prepared by (accounts)',
    'Approved by',
    'Received by the employee',
  ].entries()) {
    const x = M + i * 170;
    page.drawLine({
      start: { x, y: y + 14 },
      end: { x: x + 140, y: y + 14 },
      thickness: 0.6,
      color: LINE,
    });
    page.drawText(who, { x, y, size: 9, font: regular, color: MUTED });
  }
  return Buffer.from(await pdf.save());
}
