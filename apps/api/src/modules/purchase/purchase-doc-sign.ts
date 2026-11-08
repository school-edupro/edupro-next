import type { PoolClient } from '@edupro/db';
import { rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { embedLogo } from '../../common/pdf/letterhead';

/**
 * The signature boxes of the purchase and store documents (docs/design/83, "As built — the PO e-mail;
 * signatures with ID and time", and "— store documents like the indent's"): each box the signature on
 * the employee record, the name, "Emp. ID · designation", when ("Received on 08-11-2026 10:15 AM") and
 * what the box is for at its foot. A box with nobody yet is left empty, to sign by hand.
 */
export interface SignBox {
  /** what the box is for: Received by, Inspected by, Principal… */
  as: string;
  name: string | null;
  code: string | null;
  designation: string | null;
  when: string | null;
  signature: { contentType: string; bytes: Buffer } | null;
}

const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/** "Received on 08-11-2026 10:15 AM" (India time). */
export const whenOf = (verb: string, at: Date | null) =>
  at
    ? `${verb} ${at
        .toLocaleString('en-GB', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        .replace(/\//g, '-')
        .replace(',', '')
        .toUpperCase()}`
    : null;

/** An empty box, to sign by hand. */
export const blankBox = (as: string): SignBox => ({
  as,
  name: null,
  code: null,
  designation: null,
  when: null,
  signature: null,
});

/**
 * A box filled from the system: the person (by their user, else their employee record) — the employee
 * code, designation and the signature image on the employee record — and when they acted.
 */
export async function signerOf(
  c: PoolClient,
  read: (key: string) => Promise<Buffer>,
  x: {
    as: string;
    name: string | null;
    userId?: string | null;
    employeeId?: string | null;
    at?: Date | null;
    /** a date without a time (YYYY-MM-DD), when only the day is known */
    day?: string | null;
    verb?: string;
  },
): Promise<SignBox> {
  const e =
    x.userId || x.employeeId
      ? (
          await c.query<{
            code: string;
            designation: string | null;
            object_key: string | null;
            content_type: string | null;
          }>(
            `SELECT e.employee_code AS code, e.designation, f.object_key, f.content_type FROM employees e
               LEFT JOIN files f ON f.id = e.signature_file_id AND f.deleted_at IS NULL
                                AND f.content_type IN ('image/png', 'image/jpeg')
              WHERE ($1::bigint IS NULL OR e.user_id = $1) AND ($2::bigint IS NULL OR e.id = $2)
                AND e.deleted_at IS NULL LIMIT 1`,
            [x.userId ?? null, x.userId ? null : (x.employeeId ?? null)],
          )
        ).rows[0]
      : undefined;
  let signature: SignBox['signature'] = null;
  if (e?.object_key && e.content_type)
    try {
      signature = { contentType: e.content_type, bytes: await read(e.object_key) };
    } catch {
      signature = null;
    }
  return {
    as: x.as,
    name: x.name,
    code: e?.code ?? null,
    designation: e?.designation ?? null,
    when:
      whenOf(x.verb ?? 'On', x.at ?? null) ??
      (x.day
        ? `${x.verb ?? 'On'} ${x.day.slice(8, 10)}-${x.day.slice(5, 7)}-${x.day.slice(0, 4)}`
        : null),
    signature,
  };
}

function firstLine(text: string, font: PDFFont, size: number, width: number) {
  let t = latin(text);
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1);
  return t;
}

/**
 * The boxes in rows of up to four across `width` from `x`, the top at `y`; returns the y below them.
 * Images are embedded first (an unreadable one is left out).
 */
export async function drawSignBoxes(
  pdf: PDFDocument,
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  boxes: SignBox[],
  at: { x: number; y: number; width: number },
): Promise<number> {
  const images: Array<PDFImage | null> = [];
  for (const b of boxes) images.push(await embedLogo(pdf, b.signature));
  const per = Math.min(4, Math.max(1, boxes.length));
  const bw = at.width / per;
  let y = at.y;
  for (let row = 0; row * per < boxes.length; row += 1) {
    boxes.slice(row * per, row * per + per).forEach((s, k) => {
      const i = row * per + k;
      const x = at.x + k * bw;
      page.drawRectangle({
        x,
        y: y - 88,
        width: bw,
        height: 98,
        borderColor: LINE,
        borderWidth: 0.6,
      });
      page.drawLine({
        start: { x, y: y - 74 },
        end: { x: x + bw, y: y - 74 },
        thickness: 0.6,
        color: LINE,
      });
      const img = images[i];
      if (img) {
        const sc = Math.min(28 / img.height, (bw - 12) / img.width, 1);
        page.drawImage(img, {
          x: x + 4,
          y: y - 26,
          width: img.width * sc,
          height: img.height * sc,
        });
      }
      let ly = y - 36;
      // the ID and the designation on one line when they fit, else one under the other
      const idLine = [s.code ? `Emp. ID ${s.code}` : null, s.designation]
        .filter(Boolean)
        .join(' · ');
      const fits = fonts.regular.widthOfTextAtSize(latin(idLine), 7.5) <= bw - 8;
      const ids = fits
        ? [idLine]
        : [s.code ? `Emp. ID ${s.code}` : '', s.designation ?? ''].filter(Boolean);
      for (const [t, f, size, color] of [
        [s.name ?? '', fonts.bold, 8.5, INK],
        ...ids.map((t) => [t, fonts.regular, 7.5, INK]),
        [s.when ?? '', fonts.regular, 7.5, MUTED],
      ] as Array<[string, PDFFont, number, ReturnType<typeof rgb>]>) {
        if (t)
          page.drawText(firstLine(t, f, size, bw - 8), {
            x: x + 4,
            y: ly,
            size,
            font: f,
            color,
          });
        ly -= ids.length > 1 ? size + 2 : size + 3;
      }
      page.drawText(firstLine(s.as, fonts.bold, 8.5, bw - 8), {
        x: x + 4,
        y: y - 84,
        size: 8.5,
        font: fonts.bold,
        color: INK,
      });
    });
    y -= 102;
  }
  return y;
}
