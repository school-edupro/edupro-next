import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** What a pupil's health check-up card carries. */
export interface HealthCard {
  school: string;
  camp: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  dob: string | null;
  examDate: string;
  place: string | null;
  doctor: string | null;
  /** Section title → label / value lines (empty values are left out, an empty section too). */
  groups: Array<{ title: string; rows: Array<[string, string | null]> }>;
  remarks: string | null;
  needsAttention: boolean;
  note: string | null;
}

const W = 595.28;
const H = 841.89;
const M = 42;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
const AMBER = rgb(0.7, 0.42, 0);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * The health check-up card as a one-page A4 PDF: the school band, who was examined and when, the findings
 * section by section in two columns, the doctor's remarks for the parents and the signature line.
 */
export async function healthCardPdf(card: HealthCard): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Health card ${card.student}`);
  const page: PDFPage = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = H;
  const text = (s: string, x: number, yy: number, size: number, font = regular, color = INK) =>
    page.drawText(latin(s), { x, y: yy, size, font, color });

  page.drawRectangle({ x: 0, y: H - 64, width: W, height: 64, color: NAVY });
  text(card.school, M, H - 30, 16, bold, rgb(1, 1, 1));
  text(`Health check-up card · ${card.camp}`, M, H - 50, 10.5, regular, rgb(0.85, 0.9, 1));
  y = H - 92;

  text(card.student, M, y, 15, bold);
  y -= 18;
  const who: Array<[string, string | null]> = [
    ['Class', card.section],
    ['Admission no.', card.admissionNo],
    ['Date of birth', card.dob],
    ['Examined on', card.examDate],
    ['Place', card.place],
    ['Doctor', card.doctor],
  ];
  let x = M;
  for (const [k, v] of who.filter(([, v]) => v)) {
    const label = `${k}: `;
    const w = regular.widthOfTextAtSize(latin(label), 9.5) + bold.widthOfTextAtSize(latin(v!), 9.5);
    if (x + w > W - M) {
      x = M;
      y -= 14;
    }
    text(label, x, y, 9.5, regular, MUTED);
    text(v!, x + regular.widthOfTextAtSize(latin(label), 9.5), y, 9.5, bold);
    x += w + 18;
  }
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 20;

  const colW = (W - 2 * M - 20) / 2;
  for (const g of card.groups) {
    const rows = g.rows.filter(([, v]) => v && v.trim());
    if (!rows.length) continue;
    text(g.title.toUpperCase(), M, y, 9, bold, NAVY);
    y -= 15;
    for (let i = 0; i < rows.length; i += 2) {
      for (const [n, row] of [rows[i], rows[i + 1]].entries()) {
        if (!row) continue;
        const cx = M + n * (colW + 20);
        text(row[0], cx, y, 9.5, regular, MUTED);
        const lines = wrap(bold, row[1]!, 10, colW - 120).slice(0, 2);
        lines.forEach((l, k) => text(l, cx + 118, y - k * 12, 10, bold));
      }
      y -= 26;
      page.drawLine({
        start: { x: M, y: y + 10 },
        end: { x: W - M, y: y + 10 },
        thickness: 0.4,
        color: LINE,
      });
    }
    y -= 8;
  }

  if (card.remarks) {
    text('REMARKS FOR THE PARENTS', M, y, 9, bold, card.needsAttention ? AMBER : NAVY);
    y -= 15;
    for (const l of wrap(regular, card.remarks, 10.5, W - 2 * M).slice(0, 8)) {
      text(l, M, y, 10.5);
      y -= 14;
    }
    y -= 6;
  }
  if (card.needsAttention) {
    text('Please see a doctor or specialist about the points above.', M, y, 10, bold, AMBER);
    y -= 20;
  }
  if (card.note)
    for (const l of wrap(regular, card.note, 9, W - 2 * M).slice(0, 4)) {
      text(l, M, y, 9, regular, MUTED);
      y -= 12;
    }

  page.drawLine({
    start: { x: W - M - 170, y: 82 },
    end: { x: W - M, y: 82 },
    thickness: 0.6,
    color: MUTED,
  });
  text(card.doctor ?? 'School doctor', W - M - 170, 68, 9.5, bold);
  text('Signature', W - M - 170, 56, 8.5, regular, MUTED);
  text(
    'This card records a school health check-up. It is not a medical certificate.',
    M,
    40,
    8,
    regular,
    MUTED,
  );
  return Buffer.from(await pdf.save());
}
