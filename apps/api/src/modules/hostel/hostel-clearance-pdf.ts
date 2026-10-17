import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** What the hostel clearance certificate says (a completed hostel withdrawal). */
export interface ClearanceSheet {
  school: string;
  address: string;
  number: string;
  issuedOn: string;
  pupil: string;
  admissionNo: string;
  section: string;
  hostel: string;
  room: string;
  stayFrom: string;
  lastDay: string;
  reason: string;
  /** label / value lines of the settlement (fee, charges, approved by) */
  settlement: Array<[string, string]>;
  /** the room check-out: item, condition, charge */
  checkout: Array<[string, string, string]>;
  approvedBy: string;
}

const W = 595.28; // A4 portrait
const H = 841.89;
const M = 54;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
/** The built-in fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of latin(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

/** An A4 hostel clearance certificate: who left the hostel, when, and how the dues were settled. */
export async function clearancePdf(s: ClearanceSheet): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Hostel clearance ${s.number}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = doc.addPage([W, H]);
  // the head band
  page.drawRectangle({ x: 0, y: H - 96, width: W, height: 96, color: NAVY });
  page.drawText(latin(s.school), { x: M, y: H - 46, size: 18, font: bold, color: rgb(1, 1, 1) });
  if (s.address)
    page.drawText(latin(s.address).slice(0, 110), {
      x: M,
      y: H - 66,
      size: 9,
      font,
      color: rgb(1, 1, 1),
    });
  let y = H - 140;
  const title = 'HOSTEL CLEARANCE CERTIFICATE';
  page.drawText(title, {
    x: (W - bold.widthOfTextAtSize(title, 16)) / 2,
    y,
    size: 16,
    font: bold,
    color: INK,
  });
  y -= 22;
  const sub = `No. ${s.number}   ·   Issued on ${s.issuedOn}`;
  page.drawText(latin(sub), {
    x: (W - font.widthOfTextAtSize(latin(sub), 10)) / 2,
    y,
    size: 10,
    font,
    color: MUTED,
  });
  y -= 34;
  const para = `This is to certify that ${s.pupil} (admission no. ${s.admissionNo}${s.section ? `, ${s.section}` : ''}) stayed in ${s.hostel}${s.room ? `, room ${s.room}` : ''}, from ${s.stayFrom} to ${s.lastDay}, and has left the hostel. The hostel withdrawal was approved and the dues are settled as below.`;
  for (const line of wrap(font, para, 11, W - 2 * M)) {
    page.drawText(line, { x: M, y, size: 11, font, color: INK });
    y -= 16;
  }
  y -= 12;
  const rows: Array<[string, string]> = [
    ['Pupil', `${s.pupil} (${s.admissionNo})`],
    ['Class', s.section || '-'],
    ['Hostel and room', `${s.hostel}${s.room ? ` · ${s.room}` : ''}`],
    ['Stay', `${s.stayFrom} to ${s.lastDay}`],
    ['Reason', s.reason],
    ...s.settlement,
  ];
  const labelW = 150;
  for (const [k, v] of rows) {
    const lines = wrap(font, v, 10, W - 2 * M - labelW);
    page.drawText(latin(k), { x: M, y, size: 10, font: bold, color: MUTED });
    for (const [i, line] of lines.entries())
      page.drawText(line, { x: M + labelW, y: y - i * 13, size: 10, font, color: INK });
    y -= Math.max(1, lines.length) * 13 + 6;
    page.drawLine({
      start: { x: M, y: y + 3 },
      end: { x: W - M, y: y + 3 },
      thickness: 0.5,
      color: LINE,
    });
  }
  if (s.checkout.length) {
    y -= 14;
    page.drawText('Room check-out', { x: M, y, size: 11, font: bold, color: INK });
    y -= 16;
    for (const [item, cond, charge] of s.checkout) {
      page.drawText(latin(item).slice(0, 50), { x: M, y, size: 9.5, font, color: INK });
      page.drawText(latin(cond), { x: M + 250, y, size: 9.5, font, color: INK });
      page.drawText(latin(charge), {
        x: W - M - font.widthOfTextAtSize(latin(charge), 9.5),
        y,
        size: 9.5,
        font,
        color: INK,
      });
      y -= 13;
      if (y < 160) break;
    }
  }
  // the signature lines
  const sy = 120;
  page.drawLine({
    start: { x: M, y: sy },
    end: { x: M + 170, y: sy },
    thickness: 0.7,
    color: MUTED,
  });
  page.drawText('Warden', { x: M, y: sy - 14, size: 9, font, color: MUTED });
  page.drawLine({
    start: { x: W - M - 170, y: sy },
    end: { x: W - M, y: sy },
    thickness: 0.7,
    color: MUTED,
  });
  page.drawText(latin(`Approved by ${s.approvedBy}`).slice(0, 48), {
    x: W - M - 170,
    y: sy - 14,
    size: 9,
    font,
    color: MUTED,
  });
  page.drawText('Generated by EduPro. The school may verify this certificate by its number.', {
    x: M,
    y: 40,
    size: 8,
    font,
    color: MUTED,
  });
  return Buffer.from(await doc.save());
}
