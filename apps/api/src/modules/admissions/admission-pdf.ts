import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** Receipts and admit cards of the admission process (docs/design/39): A4, the school's band on top. */

const A4: [number, number] = [595.28, 841.89];
const M = 40;
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

async function start(
  title: string,
  school: SchoolHead,
  logo: { contentType: string; bytes: Buffer } | null,
) {
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
      // no logo rather than no receipt
    }
  }
  page.drawText(latin(school.name), {
    x,
    y: A4[1] - 44,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  if (school.address)
    page.drawText(latin(school.address).slice(0, 110), {
      x,
      y: A4[1] - 62,
      size: 9,
      font: regular,
      color: rgb(0.85, 0.89, 0.95),
    });
  if (school.contact)
    page.drawText(latin(school.contact).slice(0, 110), {
      x,
      y: A4[1] - 75,
      size: 9,
      font: regular,
      color: rgb(0.85, 0.89, 0.95),
    });
  return { pdf, page, regular, bold };
}

function rows(
  page: PDFPage,
  regular: PDFFont,
  bold: PDFFont,
  y: number,
  list: Array<[string, string]>,
  width = A4[0] - 2 * M,
) {
  for (const [k, v] of list) {
    if (!v) continue;
    page.drawText(latin(k), { x: M + 8, y, size: 10, font: regular, color: MUTED });
    const text = latin(v);
    let line = '';
    let yy = y;
    for (const w of text.split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (bold.widthOfTextAtSize(next, 10.5) > width * 0.6) {
        page.drawText(line, { x: M + width * 0.38, y: yy, size: 10.5, font: bold, color: INK });
        yy -= 14;
        line = w;
      } else line = next;
    }
    page.drawText(line, { x: M + width * 0.38, y: yy, size: 10.5, font: bold, color: INK });
    y = yy - 8;
    page.drawLine({
      start: { x: M, y: y + 3 },
      end: { x: A4[0] - M, y: y + 3 },
      thickness: 0.5,
      color: LINE,
    });
    y -= 12;
  }
  return y;
}

export interface ReceiptInput {
  school: SchoolHead;
  logo: { contentType: string; bytes: Buffer } | null;
  title: string;
  receiptNo: string;
  date: string;
  rows: Array<[string, string]>;
  amount: string;
  words: string;
  note?: string;
}

/** A registration or admission fee receipt. */
export async function admissionReceiptPdf(p: ReceiptInput): Promise<Buffer> {
  const { pdf, page, regular, bold } = await start(`${p.title} ${p.receiptNo}`, p.school, p.logo);
  let y = A4[1] - 130;
  page.drawText(latin(p.title.toUpperCase()), { x: M, y, size: 10, font: bold, color: CYAN });
  y -= 22;
  page.drawText(latin(`Receipt no. ${p.receiptNo}`), {
    x: M,
    y,
    size: 14,
    font: bold,
    color: NAVY,
  });
  const d = latin(`Date ${p.date}`);
  page.drawText(d, {
    x: A4[0] - M - regular.widthOfTextAtSize(d, 11),
    y,
    size: 11,
    font: regular,
    color: INK,
  });
  y -= 30;
  y = rows(page, regular, bold, y, p.rows);
  y -= 6;
  page.drawRectangle({
    x: M,
    y: y - 40,
    width: A4[0] - 2 * M,
    height: 52,
    color: rgb(0.933, 0.957, 0.984),
  });
  page.drawText('Amount received', { x: M + 12, y: y - 6, size: 10, font: regular, color: MUTED });
  page.drawText(latin(p.amount), { x: M + 12, y: y - 28, size: 18, font: bold, color: NAVY });
  page.drawText(latin(p.words).slice(0, 80), {
    x: M + 200,
    y: y - 26,
    size: 10,
    font: regular,
    color: INK,
  });
  y -= 80;
  if (p.note)
    page.drawText(latin(p.note).slice(0, 120), { x: M, y, size: 9.5, font: regular, color: MUTED });
  page.drawText('This is a computer-generated receipt and needs no signature.', {
    x: M,
    y: M,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  return Buffer.from(await pdf.save());
}

export interface AdmitCardInput {
  school: SchoolHead;
  logo: { contentType: string; bytes: Buffer } | null;
  photo: { contentType: string; bytes: Buffer } | null;
  title: string;
  rows: Array<[string, string]>;
  instructions: string[];
}

/** The admit card of a written test or interview: the candidate's photo, the slot and the venue. */
export async function admitCardPdf(p: AdmitCardInput): Promise<Buffer> {
  const { pdf, page, regular, bold } = await start(p.title, p.school, p.logo);
  let y = A4[1] - 130;
  page.drawText(latin(p.title.toUpperCase()), { x: M, y, size: 12, font: bold, color: CYAN });
  y -= 24;
  const photoW = 100;
  page.drawRectangle({
    x: A4[0] - M - photoW,
    y: y - 120,
    width: photoW,
    height: 120,
    borderColor: LINE,
    borderWidth: 1,
  });
  if (p.photo) {
    try {
      const img =
        p.photo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(p.photo.bytes))
          : await pdf.embedJpg(new Uint8Array(p.photo.bytes));
      const s = Math.min(photoW / img.width, 120 / img.height);
      page.drawImage(img, {
        x: A4[0] - M - photoW + (photoW - img.width * s) / 2,
        y: y - 120 + (120 - img.height * s) / 2,
        width: img.width * s,
        height: img.height * s,
      });
    } catch {
      page.drawText('Photo', {
        x: A4[0] - M - 64,
        y: y - 64,
        size: 10,
        font: regular,
        color: MUTED,
      });
    }
  } else
    page.drawText('Photo', { x: A4[0] - M - 64, y: y - 64, size: 10, font: regular, color: MUTED });
  y = rows(page, regular, bold, y, p.rows, A4[0] - 2 * M - photoW - 16);
  y -= 16;
  page.drawText('Instructions', { x: M, y, size: 11, font: bold, color: NAVY });
  y -= 16;
  for (const line of p.instructions) {
    page.drawText(latin(`- ${line}`).slice(0, 110), {
      x: M + 4,
      y,
      size: 9.5,
      font: regular,
      color: INK,
    });
    y -= 14;
  }
  y -= 40;
  page.drawLine({ start: { x: M, y }, end: { x: M + 160, y }, thickness: 0.5, color: INK });
  page.drawLine({
    start: { x: A4[0] - M - 160, y },
    end: { x: A4[0] - M, y },
    thickness: 0.5,
    color: INK,
  });
  page.drawText('Signature of the parent', {
    x: M,
    y: y - 12,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  page.drawText('Signature of the invigilator', {
    x: A4[0] - M - 160,
    y: y - 12,
    size: 8.5,
    font: regular,
    color: MUTED,
  });
  return Buffer.from(await pdf.save());
}

export interface MeritListInput {
  school: SchoolHead;
  logo: { contentType: string; bytes: Buffer } | null;
  title: string;
  subtitle: string;
  /** the criteria the class goes by, with their points */
  criteria: Array<{ name: string; points: number }>;
  tieRule: string;
  seed: string | null;
  rows: Array<{
    rank: number;
    number: string;
    candidate: string;
    category: string;
    points: string;
    marks: string;
    merit: string;
    note: string;
  }>;
  printedAt: string;
}

/** The merit list of a class (docs/design/40, part 4): the criteria, the tie-break rule, the ranked candidates. */
export async function meritListPdf(p: MeritListInput): Promise<Buffer> {
  const { pdf, page: first, regular, bold } = await start(p.title, p.school, p.logo);
  let page = first;
  let y = A4[1] - 124;
  const W = A4[0] - 2 * M;
  const wrap = (text: string, size: number, font: PDFFont, width = W) => {
    const out: string[] = [];
    let line = '';
    for (const w of latin(text).split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) {
        out.push(line);
        line = w;
      } else line = next;
    }
    if (line) out.push(line);
    return out;
  };
  const more = (need: number) => {
    if (y - need > 50) return;
    page = pdf.addPage(A4);
    y = A4[1] - 50;
  };
  page.drawText(latin(p.title.toUpperCase()), { x: M, y, size: 13, font: bold, color: NAVY });
  y -= 16;
  page.drawText(latin(p.subtitle), { x: M, y, size: 9.5, font: regular, color: MUTED });
  y -= 22;
  if (p.criteria.length) {
    page.drawText('Merit points from the form', { x: M, y, size: 10, font: bold, color: CYAN });
    y -= 14;
    for (const k of p.criteria) {
      page.drawText(latin(`${k.name}: ${String(k.points)}`), {
        x: M + 8,
        y,
        size: 9.5,
        font: regular,
        color: INK,
      });
      y -= 13;
    }
    y -= 6;
  }
  for (const l of wrap(`${p.tieRule}${p.seed ? ` Draw seed: ${p.seed}.` : ''}`, 9, regular)) {
    page.drawText(l, { x: M, y, size: 9, font: regular, color: MUTED });
    y -= 12;
  }
  y -= 10;
  // the table: rank, reg. no., candidate, category, points, marks, merit, note
  const cols = [
    { h: 'Rank', w: 32 },
    { h: 'Reg. no.', w: 114 },
    { h: 'Candidate', w: 124 },
    { h: 'Category', w: 64 },
    { h: 'Points', w: 38 },
    { h: 'Marks', w: 38 },
    { h: 'Merit', w: 40 },
    { h: 'Note', w: W - 450 },
  ];
  const head = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 16, color: rgb(0.93, 0.96, 0.99) });
    let x = M + 4;
    for (const c of cols) {
      page.drawText(c.h, { x, y, size: 8.5, font: bold, color: NAVY });
      x += c.w;
    }
    y -= 18;
  };
  head();
  if (!p.rows.length) {
    page.drawText('Nobody waits at Selection in this class.', {
      x: M + 4,
      y,
      size: 9.5,
      font: regular,
      color: MUTED,
    });
    y -= 14;
  }
  for (const r of p.rows) {
    if (y < 60) {
      more(80);
      head();
    }
    const cells = [
      String(r.rank),
      r.number,
      r.candidate,
      r.category,
      r.points,
      r.marks,
      r.merit,
      r.note,
    ];
    let x = M + 4;
    for (const [i, c] of cols.entries()) {
      let t = latin(cells[i] ?? '');
      while (t && regular.widthOfTextAtSize(t, 8.5) > c.w - 6) t = t.slice(0, -1);
      page.drawText(t, { x, y, size: 8.5, font: i === 6 ? bold : regular, color: INK });
      x += c.w;
    }
    page.drawLine({
      start: { x: M, y: y - 5 },
      end: { x: A4[0] - M, y: y - 5 },
      thickness: 0.4,
      color: LINE,
    });
    y -= 16;
  }
  more(40);
  y -= 14;
  page.drawText(latin(`Printed ${p.printedAt}`), { x: M, y, size: 8, font: regular, color: MUTED });
  return Buffer.from(await pdf.save());
}
