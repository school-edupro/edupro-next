import bwipjs from 'bwip-js';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import QRCode from 'qrcode';

/** What goes on a visitor ID card (an appointment visitor or a walk-in visitor). */
export interface VisitorCard {
  school: string;
  /** The band on the right of the header: VISITOR, PARENT... */
  kind: string;
  name: string;
  /** Label / value lines under the name; empty values are left out. */
  rows: Array<[string, string | null]>;
  /** The number printed under the barcode and what the barcode holds (the pass code). */
  number: string;
  code: string;
  /** What the QR opens (the pass link), or the code itself. */
  qrText: string;
  photo: { contentType: string; bytes: Buffer } | null;
}

const MM = 72 / 25.4;
const W = 86 * MM;
const H = 54 * MM;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string) => s.replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function fit(font: PDFFont, text: string, size: number, width: number): string {
  let out = latin(text);
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
}

export const qrPng = (text: string): Promise<Buffer> =>
  QRCode.toBuffer(text, { type: 'png', width: 360, margin: 1, errorCorrectionLevel: 'M' });

export const barcodePng = (text: string): Promise<Buffer> =>
  bwipjs.toBuffer({ bcid: 'code128', text, scale: 3, height: 10, includetext: false });

/**
 * The visitor card as a one-page PDF in ID-card size (86 x 54 mm): school band, photo, name, the details
 * the visitor gave, the QR of the pass and a Code 128 barcode with the number. The same file is printed
 * at the gate, downloaded by the visitor and attached to the confirmation mail.
 */
export async function visitorCardPdf(card: VisitorCard): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Visitor card ${card.number}`);
  const page = pdf.addPage([W, H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const top = (y: number) => H - y;

  // header band
  page.drawRectangle({ x: 0, y: top(20), width: W, height: 20, color: NAVY });
  page.drawText(fit(bold, card.school, 8.5, W - 80), {
    x: 8,
    y: top(13.5),
    size: 8.5,
    font: bold,
    color: rgb(1, 1, 1),
  });
  const kind = latin(card.kind.toUpperCase());
  page.drawText(kind, {
    x: W - 8 - bold.widthOfTextAtSize(kind, 7.5),
    y: top(13.2),
    size: 7.5,
    font: bold,
    color: rgb(1, 1, 1),
  });

  // photo (JPEG or PNG; anything else leaves the frame empty)
  const px = 8;
  const pw = 48;
  const ph = 60;
  page.drawRectangle({
    x: px,
    y: top(26 + ph),
    width: pw,
    height: ph,
    borderColor: rgb(0.8, 0.83, 0.87),
    borderWidth: 0.6,
  });
  if (card.photo && /^image\/(jpeg|png)$/.test(card.photo.contentType)) {
    try {
      const img =
        card.photo.contentType === 'image/png'
          ? await pdf.embedPng(card.photo.bytes)
          : await pdf.embedJpg(card.photo.bytes);
      const scale = Math.min(pw / img.width, ph / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: px + (pw - w) / 2,
        y: top(26 + ph) + (ph - h) / 2,
        width: w,
        height: h,
      });
    } catch {
      // a photo the PDF library cannot read is left out; the card is still valid
    }
  } else {
    page.drawText('No photo', { x: px + 10, y: top(58), size: 6, font: regular, color: MUTED });
  }

  // QR on the right
  const qs = 46;
  const qr = await pdf.embedPng(await qrPng(card.qrText));
  page.drawImage(qr, { x: W - 8 - qs, y: top(24 + qs), width: qs, height: qs });

  // name and details in the middle
  const tx = px + pw + 7;
  const tw = W - 8 - qs - 5 - tx;
  page.drawText(fit(bold, card.name, 10.5, tw), {
    x: tx,
    y: top(33),
    size: 10.5,
    font: bold,
    color: INK,
  });
  let y = 43;
  for (const [label, value] of card.rows.filter(([, v]) => v && v.trim() !== '').slice(0, 8)) {
    page.drawText(latin(label), { x: tx, y: top(y), size: 5.8, font: regular, color: MUTED });
    page.drawText(fit(regular, value!, 6.6, tw - 30), {
      x: tx + 30,
      y: top(y),
      size: 6.6,
      font: regular,
      color: INK,
    });
    y += 8.3;
  }

  // barcode and number along the bottom
  const bar = await pdf.embedPng(await barcodePng(card.code));
  page.drawImage(bar, { x: 8, y: 7, width: 128, height: 19 });
  const foot = latin(`${card.number} - ${card.code}`);
  page.drawText(foot, {
    x: W - 8 - regular.widthOfTextAtSize(foot, 6.2),
    y: 9,
    size: 6.2,
    font: regular,
    color: INK,
  });
  return Buffer.from(await pdf.save());
}
