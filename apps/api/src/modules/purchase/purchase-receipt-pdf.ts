import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawLetterhead, embedLogo } from '../../common/pdf/letterhead';
import { drawSignBoxes, type SignBox } from './purchase-doc-sign';

/**
 * The goods received and inspection note, or a service's completion certificate, as a PDF
 * (docs/design/84, part 7; the look: docs/design/83, "As built — store documents like the indent's"):
 * A4, the school's letterhead as the indent prints it (logo; name, address, title, number and when it was
 * made), the receipt's details (PO, vendor, department, store, challan / invoice, status), per line
 * ordered, received, refused, accepted and rejected with batch, serial numbers, work done and reasons, the
 * accepted value, and the signature boxes as on the PO — who received it and who inspected it (signature,
 * name, Emp. ID · designation, when), then the head of department and the Principal to sign. "NOT
 * INSPECTED" across one still waiting; "CANCELLED" across a cancelled one.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const W = A4[0] - 2 * M;
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);
const BAND = rgb(0.953, 0.961, 0.976);

const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');
const money = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (n: number | null) =>
  n === null ? '-' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

export interface ReceiptPdfData {
  school: { name: string; address: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  title: string;
  watermark: string | null;
  number: string;
  /** 08-11-2026 06:15 PM, India */
  generatedOn: string;
  receivedOn: string;
  order: string;
  vendor: string;
  department: string | null;
  store: string | null;
  challan: string;
  note: string | null;
  status: string;
  kind: 'goods' | 'service';
  lines: Array<{
    seq: number;
    description: string;
    uom: string;
    ordered: number;
    received: number;
    refused: number;
    accepted: number | null;
    rejected: number | null;
    detail: string;
    value: number | null;
  }>;
  /** received by, inspected by (each inspector or committee member), then boxes to sign by hand */
  signers: SignBox[];
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
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
    out.push(line);
  }
  return out;
}

export async function purchaseReceiptPdf(d: ReceiptPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`${d.title} ${d.number}`));
  pdf.setAuthor(latin(d.school.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, d.logo);

  let page: PDFPage = pdf.addPage(A4);
  let y = 0;
  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: number } = {},
  ) => {
    const size = o.size ?? 8.5;
    const f = o.f ?? font;
    const t = latin(s);
    const xx = o.right !== undefined ? o.right - f.widthOfTextAtSize(t, size) : x;
    page.drawText(t, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };
  // the letterhead, as the indent prints it: logo left; name, address, title, details centred
  const head = () => {
    y = drawLetterhead(page, { regular: font, bold }, logo, {
      school: d.school.name,
      address: d.school.address,
      title: d.title,
      details: `No. ${d.number} · Generated on: ${d.generatedOn}`,
      margin: 30,
    });
    page.drawLine({
      start: { x: M, y: y + 4 },
      end: { x: M + W, y: y + 4 },
      thickness: 0.8,
      color: LINE,
    });
    y -= 10;
    if (d.watermark)
      page.drawText(latin(d.watermark), {
        x: 110,
        y: 330,
        size: 62,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(35),
      });
  };
  const need = (h: number, again?: () => void) => {
    if (y - h < M + 30) {
      page = pdf.addPage(A4);
      head();
      again?.();
    }
  };

  head();
  const facts: Array<[string, string]> = [
    [d.kind === 'goods' ? 'Received on' : 'Work reported on', d.receivedOn],
    ['Purchase order', d.order],
    ['Vendor', d.vendor],
    ...(d.department ? ([['Department', d.department]] as Array<[string, string]>) : []),
    ...(d.store ? ([['Store', d.store]] as Array<[string, string]>) : []),
    ...(d.challan ? ([['Vendor papers', d.challan]] as Array<[string, string]>) : []),
    ['Status', d.status],
  ];
  for (const [k, v] of facts) {
    text(k, M, y, { color: MUTED });
    const lines = wrap(v, font, 8.5, W - 100);
    for (const l of lines) {
      text(l, M + 100, y);
      y -= 11;
    }
  }
  if (d.note) {
    text('Note', M, y, { color: MUTED });
    for (const l of wrap(d.note, font, 8.5, W - 100)) {
      text(l, M + 100, y);
      y -= 11;
    }
  }
  y -= 8;

  const cols = [
    { k: '#', w: 16 },
    { k: d.kind === 'goods' ? 'Item' : 'Service', w: 190 },
    { k: 'Unit', w: 34 },
    { k: 'Ordered', w: 44, r: true },
    { k: d.kind === 'goods' ? 'Received' : 'Done', w: 46, r: true },
    { k: 'Refused', w: 40, r: true },
    { k: 'Accepted', w: 46, r: true },
    { k: 'Rejected', w: 44, r: true },
    { k: 'Value', w: 63, r: true },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => {
    xs.push(x);
    return x + c.w;
  }, M);
  const header = () => {
    page.drawRectangle({ x: M - 2, y: y - 4, width: W + 4, height: 15, color: BAND });
    cols.forEach((c, i) =>
      text(c.k, xs[i]!, y, {
        size: 7.5,
        f: bold,
        color: MUTED,
        ...(c.r ? { right: xs[i]! + c.w - 3 } : {}),
      }),
    );
    y -= 16;
  };
  header();
  let total = 0;
  for (const l of d.lines) {
    const desc = wrap(l.description, font, 8, cols[1]!.w - 4);
    const detail = l.detail ? wrap(l.detail, font, 7, cols[1]!.w - 4) : [];
    const h = (desc.length + detail.length) * 10 + 4;
    need(h, header);
    const cells = [
      String(l.seq),
      '',
      l.uom,
      qty(l.ordered),
      qty(l.received),
      l.refused ? qty(l.refused) : '',
      qty(l.accepted),
      l.rejected ? qty(l.rejected) : l.rejected === null ? '-' : '',
      l.value === null ? '-' : money(l.value),
    ];
    cells.forEach((v, i) => {
      if (i === 1) return;
      const c = cols[i]!;
      text(v, xs[i]!, y, { size: 8, ...(c.r ? { right: xs[i]! + c.w - 3 } : {}) });
    });
    let ly = y;
    for (const t of desc) {
      text(t, xs[1]!, ly, { size: 8 });
      ly -= 10;
    }
    for (const t of detail) {
      text(t, xs[1]!, ly, { size: 7, color: MUTED });
      ly -= 10;
    }
    y = ly - 4;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: M + W, y: y + 6 },
      thickness: 0.5,
      color: LINE,
    });
    total += l.value ?? 0;
  }
  need(20);
  text('Value accepted (Rs)', M, y, { f: bold });
  text(money(total), 0, y, { f: bold, right: M + W - 3 });
  y -= 30;

  // the boxes to sign, as on the PO
  need(110 * Math.ceil(d.signers.length / 4));
  y = await drawSignBoxes(pdf, page, { regular: font, bold }, d.signers, { x: M, y, width: W });
  y -= 6;
  need(30);
  for (const l of wrap(
    d.kind === 'goods'
      ? 'Only the accepted quantity enters the stock. Rejected goods wait to go back to the vendor. Without a written objection within 15 days of delivery the goods count as accepted (MSMED Act s.15).'
      : 'The certificate is the acceptance of the service; the payment term runs from its date (MSMED Act s.15).',
    font,
    7.5,
    W,
  )) {
    text(l, M, y, { size: 7.5, color: MUTED });
    y -= 10;
  }

  // page numbers
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    text(`Printed ${d.generatedOn}`, M, 20, { size: 7, color: MUTED });
    text(`${d.number} · page ${String(i + 1)} of ${String(pages.length)}`, 0, 20, {
      size: 7,
      color: MUTED,
      right: M + W,
    });
  });
  return Buffer.from(await pdf.save());
}
