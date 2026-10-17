import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** What the PDF copy of a consent form response shows. */
export interface ConsentSheet {
  school: string;
  address: string;
  title: string;
  description: string | null;
  number: string;
  /** the pupil (admission no., class) or the staff member */
  about: string;
  answeredBy: string;
  signedName: string | null;
  on: string;
  /** a section heading, or a question with its answer (and a drawn signature) */
  items: Array<{ heading: string } | { label: string; value: string; signature: Buffer | null }>;
}

const W = 595.28; // A4 portrait
const H = 841.89;
const M = 54;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
/** The built-in fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) =>
  s
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/** An A4 copy of one response: the school, the form, who it is about, every answer, the signature. */
export async function consentPdf(s: ConsentSheet): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${s.title} ${s.number}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([W, H]);
  let y = 0;
  const band = () => {
    page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: NAVY });
    page.drawText(latin(s.school).slice(0, 70), {
      x: M,
      y: H - 40,
      size: 16,
      font: bold,
      color: rgb(1, 1, 1),
    });
    if (s.address)
      page.drawText(latin(s.address).slice(0, 110), {
        x: M,
        y: H - 58,
        size: 8.5,
        font,
        color: rgb(1, 1, 1),
      });
    y = H - 110;
  };
  const room = (need: number) => {
    if (y - need > 70) return;
    page = doc.addPage([W, H]);
    band();
  };
  band();
  for (const line of wrap(bold, s.title, 15, W - 2 * M)) {
    page.drawText(line, { x: M, y, size: 15, font: bold, color: INK });
    y -= 19;
  }
  page.drawText(latin(`No. ${s.number}   ·   ${s.on}`), { x: M, y, size: 9.5, font, color: MUTED });
  y -= 22;
  if (s.description) {
    for (const line of wrap(font, s.description, 9.5, W - 2 * M).slice(0, 30)) {
      room(14);
      page.drawText(line, { x: M, y, size: 9.5, font, color: INK });
      y -= 13;
    }
    y -= 8;
  }
  const labelW = 200;
  const row = (k: string, v: string, strong = false) => {
    const lines = wrap(font, v || '-', 10, W - 2 * M - labelW);
    const klines = wrap(bold, k, 9.5, labelW - 12);
    const h = Math.max(lines.length, klines.length) * 13;
    room(h + 12);
    klines.forEach((l, i) =>
      page.drawText(l, { x: M, y: y - i * 13, size: 9.5, font: bold, color: MUTED }),
    );
    lines.forEach((l, i) =>
      page.drawText(l, {
        x: M + labelW,
        y: y - i * 13,
        size: 10,
        font: strong ? bold : font,
        color: INK,
      }),
    );
    const bottom = y - h + 7;
    page.drawLine({
      start: { x: M, y: bottom },
      end: { x: W - M, y: bottom },
      thickness: 0.5,
      color: LINE,
    });
    y = bottom - 14;
  };
  row('About', s.about, true);
  row('Answered by', s.answeredBy);
  if (s.signedName) row('Name as signed', s.signedName);
  y -= 6;
  for (const it of s.items) {
    if ('heading' in it) {
      room(30);
      y -= 6;
      page.drawText(latin(it.heading).slice(0, 90), { x: M, y, size: 11, font: bold, color: NAVY });
      y -= 18;
      continue;
    }
    if (it.signature) {
      room(90);
      page.drawText(latin(it.label).slice(0, 60), {
        x: M,
        y,
        size: 9.5,
        font: bold,
        color: MUTED,
      });
      try {
        const img = await doc.embedPng(it.signature);
        const scale = Math.min(220 / img.width, 60 / img.height, 1);
        page.drawImage(img, {
          x: M + labelW,
          y: y - img.height * scale + 10,
          width: img.width * scale,
          height: img.height * scale,
        });
        y -= Math.max(img.height * scale, 20) + 14;
      } catch {
        page.drawText('Signed', { x: M + labelW, y, size: 10, font, color: INK });
        y -= 20;
      }
      continue;
    }
    row(it.label, it.value);
  }
  for (const p of doc.getPages())
    p.drawText('Generated by EduPro. The school may verify this copy by its number.', {
      x: M,
      y: 36,
      size: 8,
      font,
      color: MUTED,
    });
  return Buffer.from(await doc.save());
}
