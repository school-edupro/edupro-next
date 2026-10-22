import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { ReceiptPaper } from './receipt-pdf';

/** The receipt with what the school's layout prints besides the money (FeeDocumentsService.receiptView). */
export interface ReceiptLayoutPaper extends ReceiptPaper {
  letterhead?: {
    phone: string | null;
    email: string | null;
    website: string | null;
    logoFileId: string | null;
    affiliation: string | null;
  };
  parents?: string | null;
  mobiles?: string | null;
  address?: string | null;
  transport?: string;
  instalment?: string | null;
  bounceCharge?: string;
}

const W = 841.89; // A4 landscape
const H = 595.28;
const M = 24;
const INK = rgb(0, 0, 0);
const BLUE = rgb(0.17, 0.24, 0.6);
const SHADE = rgb(0.84, 0.84, 0.84);
const RED = rgb(0.7, 0.1, 0.1);
const FEE: Record<string, string> = { hostel: 'Hostel Fee', misc: 'Misc Fee' };

const latin = (s: string | null | undefined) =>
  (s ?? '').replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const title = (w: string) => w.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/** Splits text into lines that fit the width (words kept whole where they can be). */
function wrap(font: PDFFont, text: string, size: number, width: number, maxLines = 3): string[] {
  const words = latin(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]}...`;
    return kept;
  }
  return lines.length ? lines : [''];
}

/**
 * The fee, hostel or misc receipt as a PDF in the school's layout: one A4 landscape page per copy, the
 * school, the pupil and the payment on the left, the instalment, heads paid and amount in words on the
 * right. The logo (PNG or JPEG) is drawn when given.
 */
export async function receiptLayoutPdf(
  r: ReceiptLayoutPaper,
  copies: string[],
  logo?: { contentType: string; bytes: Buffer } | null,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const fee = FEE[r.feeType] ?? 'Fee';
  pdf.setTitle(`${fee} receipt ${r.receiptNo ?? ''}`.trim());
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let image: PDFImage | null = null;
  if (logo && /^image\/(png|jpeg)$/.test(logo.contentType)) {
    try {
      image =
        logo.contentType === 'image/png'
          ? await pdf.embedPng(logo.bytes)
          : await pdf.embedJpg(logo.bytes);
    } catch {
      image = null; // a logo the library cannot read is left out
    }
  }
  const cancelled = r.status === 'reversed' || r.status === 'bounced';
  const lh = r.letterhead;
  const heads = [
    ...r.lines.reduce(
      (m, l) => m.set(l.head, (m.get(l.head) ?? 0) + Number(l.amount)),
      new Map<string, number>(),
    ),
  ];
  if (Number(r.advance) > 0) heads.push(['Advance (kept for the next dues)', Number(r.advance)]);
  const paidHeads = heads.reduce((a, [, v]) => a + v, 0);

  for (const label of copies) {
    const page: PDFPage = pdf.addPage([W, H]);
    const x0 = M;
    const half = (W - 2 * M) / 2;
    const x1 = x0 + half;
    const top = H - M;
    const text = (t: string, x: number, y: number, size: number, font = regular, color = INK) =>
      page.drawText(latin(t), { x, y, size, font, color });
    const right = (t: string, xr: number, y: number, size: number, font = regular) =>
      text(t, xr - font.widthOfTextAtSize(latin(t), size), y, size, font);
    const centre = (
      t: string,
      xa: number,
      xb: number,
      y: number,
      size: number,
      font = regular,
      color = INK,
    ) => text(t, (xa + xb - font.widthOfTextAtSize(latin(t), size)) / 2, y, size, font, color);
    const hline = (xa: number, xb: number, y: number, t = 0.8) =>
      page.drawLine({ start: { x: xa, y }, end: { x: xb, y }, thickness: t, color: INK });
    const vline = (x: number, ya: number, yb: number, t = 0.8) =>
      page.drawLine({ start: { x, y: ya }, end: { x, y: yb }, thickness: t, color: INK });
    const band = (xa: number, xb: number, y: number, h: number) => {
      page.drawRectangle({ x: xa, y: y - h, width: xb - xa, height: h, color: SHADE });
      hline(xa, xb, y);
      hline(xa, xb, y - h);
    };

    // ---- left panel: the school, the pupil, the payment -------------------------------------------
    let y = top;
    const headH = 78;
    if (image) {
      const s = Math.min(56 / image.width, 56 / image.height);
      page.drawImage(image, {
        x: x0 + 8,
        y: y - 10 - image.height * s,
        width: image.width * s,
        height: image.height * s,
      });
    }
    let hy = y - 18;
    centre(r.school.name, x0 + 70, x1 - 70, hy, 13, bold, BLUE);
    for (const [t, f] of [
      [r.school.address, bold],
      [lh?.phone ? `Contact No: ${lh.phone}` : '', regular],
      [lh?.affiliation ?? '', regular],
      [[lh?.website, lh?.email].filter(Boolean).join(' || '), regular],
    ] as Array<[string, PDFFont]>) {
      if (!t) continue;
      hy -= 11;
      centre(wrap(f, t, 8, half - 140, 1)[0]!, x0 + 70, x1 - 70, hy, 8, f);
    }
    right(label, x1 - 6, y - 12, 7);
    y -= headH;
    band(x0, x1, y, 16);
    const word = `${fee} Receipt`
      .toUpperCase()
      .split(' ')
      .map((w) => w.split('').join(' '))
      .join('    ');
    centre(word, x0, x1, y - 12, 10, bold);
    if (cancelled)
      right(r.status === 'bounced' ? 'CHEQUE BOUNCED' : 'CANCELLED', x1 - 6, y - 12, 9, bold);
    y -= 16;
    const lx = x0 + 6;
    const vx = x0 + half * 0.44;
    const field = (k: string, v: string, lines = 2) => {
      const vs = wrap(regular, v, 9, x1 - vx - 6, lines);
      const ks = wrap(regular, k, 9, vx - lx - 6, 2);
      const n = Math.max(vs.length, ks.length);
      y -= 13;
      ks.forEach((t, i) => text(t, lx, y - i * 11, 9));
      vs.forEach((t, i) => text(t, vx, y - i * 11, 9));
      y -= (n - 1) * 11;
    };
    y -= 2;
    const staff = r.student.kind === 'employee';
    const outsider = r.student.kind === 'other';
    if (!staff && !outsider) field("Parent's Name", r.parents ?? r.student.guardian ?? '-');
    field('Name', r.student.name, 1);
    if (!outsider) {
      field(staff ? 'Emp Code' : 'Adm No', r.student.admissionNo, 1);
      field(staff ? 'Designation' : 'Class', r.student.section ?? '-', 1);
    }
    field('Mobile No', r.mobiles ?? '-', 1);
    field('Address', r.address ?? '-');
    if (!staff && !outsider)
      field('Student Category/Bus Route/Bus Stop/Bus Slab', r.transport ?? '');
    y -= 8;
    band(x0, x1, y, 16);
    centre('Pay Mode Information', x0, x1, y - 12, 10, bold);
    y -= 16;
    const q = x0 + half / 2;
    y -= 14;
    text('Pay Mode', lx, y, 9);
    text(r.mode.toUpperCase(), lx + 90, y, 9);
    text('Date', q + 6, y, 9);
    right(dmy(r.instrumentDate ?? r.receivedOn), x1 - 6, y, 9);
    y -= 14;
    text('Bank', lx, y, 9);
    text(wrap(regular, r.bankName ?? '', 9, q - lx - 96, 1)[0]!, lx + 90, y, 9);
    text('Txn/Cheque No', q + 6, y, 9);
    right(r.instrumentNo ?? r.reference ?? '', x1 - 6, y, 9);
    y -= 8;
    band(x0, x1, y, 16);
    text('Total', lx, y - 12, 10, bold);
    right(rupees(r.amount), x1 - 6, y - 12, 10, bold);
    y -= 16;
    // the stamp box and the closing words
    y -= 8;
    const box = { x: x0 + half * 0.4, w: half * 0.56, h: 40 };
    page.drawRectangle({
      x: box.x,
      y: y - box.h,
      width: box.w,
      height: box.h,
      borderColor: INK,
      borderWidth: 0.8,
    });
    y -= box.h + 14;
    right(`* This is computer generated ${fee.toLowerCase()} receipt.`, x1 - 6, y, 9);
    y -= 13;
    right('No Signature/Stamp required', x1 - 6, y, 9);
    const leftEnd = y - 10;

    // ---- right panel: the instalment and the money -------------------------------------------------
    let ry = top;
    band(x1, x0 + 2 * half, ry, 18);
    centre(
      `${fee} Receipt${r.feeType === 'misc' ? '' : ' Instalment'}${r.instalment ? ` - ${r.instalment}` : ''} Session ${r.year}`,
      x1,
      x0 + 2 * half,
      ry - 13,
      10,
      bold,
    );
    ry -= 18;
    const rx = x1 + 8;
    const rr = x0 + 2 * half - 8;
    ry -= 26;
    text(`Receipt Date:  ${dmy(r.receivedOn)}`, rx + 6, ry, 10);
    right(`Receipt No  ${r.receiptNo ?? '-'}`, rr - 6, ry, 10);
    ry -= 14;
    // the table of heads
    const c1 = x1 + half * 0.16;
    const c2 = x1 + half * 0.76;
    const xe = x0 + 2 * half;
    const rowH = 16;
    const tableTop = ry;
    band(x1, xe, ry, rowH);
    centre('SR.NO', x1, c1, ry - 12, 10, bold);
    centre('Description', c1, c2, ry - 12, 10, bold);
    centre('Paid', c2, xe, ry - 12, 10, bold);
    ry -= rowH;
    heads.forEach(([head, amount], i) => {
      text(String(i + 1), x1 + 6, ry - 12, 9.5);
      text(wrap(regular, head.toUpperCase(), 9.5, c2 - c1 - 10, 1)[0]!, c1 + 6, ry - 12, 9.5);
      right(rupees(amount), xe - 6, ry - 12, 9.5);
      ry -= rowH;
      hline(x1, xe, ry, 0.5);
    });
    band(x1, xe, ry, rowH);
    centre('Total', x1, c2, ry - 12, 10, bold);
    right(rupees(paidHeads), xe - 6, ry - 12, 10, bold);
    vline(c1, tableTop, ry);
    vline(c2, tableTop, ry - rowH);
    ry -= rowH;
    // late fee, bounce charge, amount, words
    const split = x1 + half * 0.26;
    const line = (left: string, rightText: string, h = rowH, sep = true) => {
      text(left, x1 + 6, ry - 12, 9.5);
      if (sep) vline(split, ry, ry - h);
      right(rightText, xe - 6, ry - 12, 9.5);
      ry -= h;
      hline(x1, xe, ry, 0.8);
    };
    line(`Late Fee : ${rupees(r.lateFee)}`, `Bounce Charge : ${rupees(r.bounceCharge ?? 0)}`);
    line('Amount Received', rupees(r.amount));
    const words = wrap(regular, `Rupees ${title(r.amountWords)} Only`, 9.5, xe - split - 12, 3);
    const wordsH = Math.max(rowH, 6 + words.length * 12);
    text('In Word:', x1 + 6, ry - wordsH / 2 - 3, 9.5);
    vline(split, ry, ry - wordsH);
    words.forEach((t, i) => text(t, split + 6, ry - 12 - i * 12, 9.5));
    ry -= wordsH;
    hline(x1, xe, ry, 0.8);
    const cheque = r.modeKind === 'cheque' || r.modeKind === 'dd';
    text(
      wrap(
        regular,
        `${title(r.mode.toLowerCase())} ${fee} Paid${cheque ? ' (subject to realisation of the cheque / draft)' : ''}`,
        9.5,
        xe - x1 - 12,
        1,
      )[0]!,
      x1 + 6,
      ry - 12,
      9.5,
    );
    ry -= rowH;
    hline(x1, xe, ry, 0.8);
    if (Number(r.refunded) > 0) line('Refunded since', rupees(r.refunded), rowH, false);
    if (r.remarks) {
      text(wrap(regular, `Remarks: ${r.remarks}`, 9.5, xe - x1 - 12, 1)[0]!, x1 + 6, ry - 12, 9.5);
      ry -= rowH;
      hline(x1, xe, ry, 0.8);
    }
    const note = `For any queries, kindly call at : ${lh?.phone ?? 'the school office'}${lh?.email ? ` or drop an email at ${lh.email}` : ''}`;
    ry -= 4;
    const noteLines = wrap(regular, note, 9.5, xe - x1 - 50, 3);
    text('Note: -', x1 + 6, ry - 12, 9.5, bold);
    noteLines.forEach((t, i) => text(t, x1 + 44, ry - 12 - i * 12, 9.5));
    ry -= 8 + noteLines.length * 12;
    if (r.receivedBy) {
      text(`Received by ${r.receivedBy}`, x1 + 6, ry - 10, 8, regular, rgb(0.35, 0.35, 0.35));
      ry -= 14;
    }
    hline(x1, xe, ry - 4, 0.8);

    // ---- frame -------------------------------------------------------------------------------------
    const bottom = Math.min(leftEnd, ry - 4);
    page.drawRectangle({
      x: x0,
      y: bottom,
      width: 2 * half,
      height: top - bottom,
      borderColor: INK,
      borderWidth: 1.5,
    });
    vline(x1, top, bottom, 1.5);
    hline(x0, x1, top - headH, 0.8);
    if (cancelled) {
      const stamp = r.status === 'bounced' ? 'CHEQUE BOUNCED' : 'CANCELLED';
      text(stamp, x0 + 2 * half - 220, bottom + 14, 22, bold, RED);
    }
  }
  return Buffer.from(await pdf.save());
}
