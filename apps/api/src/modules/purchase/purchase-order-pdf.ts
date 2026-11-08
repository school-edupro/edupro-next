import {
  degrees,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { embedLogo } from '../../common/pdf/letterhead';

/**
 * The Purchase Order as a PDF in the school's own format (docs/design/83, "As built — the PO format"):
 * the logo, PURCHASE ORDER and the PO number and date; the supplier (with its contact and bank), where
 * to ship and whom to bill (the legal entity and its GSTIN); the lines with item code, description,
 * HSN / SAC, make / model, quantity, unit, unit cost, discount, GST and amount, the other charges; the
 * totals (sub-total, discount, after discount, tax, after tax, charges with tax, grand total) and the
 * amount in words; the GST summary by HSN and rate; general instructions, payment and freight terms,
 * the delivery date and a note to the vendor; who prepared and approved it (names and signature
 * images), "a system generated document"; and a footer line with the legal name, registered office and
 * GSTIN. "PENDING" across a PO not yet approved; "CANCELLED" / "SUPERSEDED" / "REJECTED" across one
 * closed that way.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 30;
const W = A4[0] - 2 * M;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.72, 0.74, 0.78);
const BAND = rgb(0.95, 0.955, 0.965);
const RED = rgb(0.7, 0.1, 0.1);

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
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

type Image = { contentType: string; bytes: Buffer } | null;

export interface OrderPdfData {
  school: {
    name: string;
    address: string | null;
    contact: string | null;
    gstin: string | null;
    state: string | null;
  };
  logo: Image;
  /** 08-11-2026 06:15 PM, India */
  generatedOn: string;
  /** Purchase Order · Emergency Purchase */
  title: string;
  watermark: string | null;
  number: string;
  date: string;
  validUntil: string;
  quoteRef: string | null;
  deliveryDate: string | null;
  department: string | null;
  requisition: string | null;
  /** whom invoices are made out to: the legal entity (a society, a trust) */
  billTo: {
    name: string;
    address: string | null;
    gstin: string | null;
    contactName: string | null;
    contactPhone: string | null;
  };
  /** where the goods go */
  shipTo: {
    name: string;
    address: string | null;
    contactName: string | null;
    contactPhone: string | null;
  };
  vendor: {
    name: string;
    code: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    state: string | null;
    gstStatus: string;
    msme: string | null;
    contactName: string | null;
    phone: string | null;
    email: string | null;
    /** the account number masked but for its last digits */
    bank: { name: string; account: string; ifsc: string } | null;
  };
  supply: 'intra' | 'inter';
  lines: Array<{
    seq: number;
    code: string | null;
    description: string;
    hsn: string | null;
    make: string | null;
    model: string | null;
    quantity: number;
    uom: string;
    rate: number;
    discountPct: number;
    taxable: number;
    gstRate: number;
    gst: number;
    rcm: number;
    total: number;
  }>;
  charges: Array<{ label: string; amount: number; gstRate: number; gst: number; total: number }>;
  totals: {
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    rcm: number;
    roundOff: number;
    total: number;
  };
  words: string;
  summary: Array<{
    hsn: string | null;
    gstRate: number;
    reverseCharge: boolean;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    rcm: number;
  }>;
  paymentText: string | null;
  msmeWarning: string | null;
  freightTerms: string | null;
  vendorNote: string | null;
  /** the general instructions: the PO's terms */
  terms: string | null;
  emergency: { reason: string; billRef: string | null } | null;
  /** the boxes to sign, in order: the first is who prepared it, the last who approved it */
  signers: Array<{ as: string; name: string | null; signature: Image }>;
  /** legal name || registered office || GSTIN */
  footer: string;
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
        // a word longer than the width is cut
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

export async function purchaseOrderPdf(d: OrderPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`${d.title} ${d.number}`));
  pdf.setAuthor(latin(d.billTo.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, d.logo);
  const signatures: Array<PDFImage | null> = [];
  for (const s of d.signers) signatures.push(await embedLogo(pdf, s.signature));

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
  const hr = (yy: number, thickness = 0.6) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness, color: LINE });
  /** "Label: value" with the label bold, wrapped to the width; returns the y under it */
  const pair = (label: string, value: string, x: number, yy: number, width: number, size = 8.5) => {
    const lw = bold.widthOfTextAtSize(latin(`${label} `), size);
    const lines = wrap(value, font, size, Math.max(40, width - lw));
    text(`${label} `, x, yy, { size, f: bold });
    lines.forEach((l, i) => text(l, x + lw, yy - i * (size + 2.5), { size }));
    return yy - lines.length * (size + 2.5);
  };

  // the head of every page: the frame, the logo, PURCHASE ORDER, the number and date
  const head = () => {
    const top = A4[1] - M;
    page.drawRectangle({
      x: M - 8,
      y: M - 8,
      width: W + 16,
      height: A4[1] - 2 * M + 16,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    if (logo) {
      const s = Math.min(42 / logo.height, 90 / logo.width);
      page.drawImage(logo, {
        x: M,
        y: top - logo.height * s,
        width: logo.width * s,
        height: logo.height * s,
      });
    }
    const title = latin(d.title.toUpperCase());
    text(title, A4[0] / 2 - bold.widthOfTextAtSize(title, 18) / 2, top - 26, { size: 18, f: bold });
    const kind = d.emergency ? 'Emergency' : 'Regular';
    const no = latin(`PO No: ${d.number}`);
    text(no, 0, top - 14, { size: 9.5, f: bold, right: M + W });
    text(`${kind} `, 0, top - 14, { size: 9.5, right: M + W - bold.widthOfTextAtSize(no, 9.5) });
    text(`PO Date: ${d.date}`, 0, top - 27, { size: 9.5, f: bold, right: M + W });
    hr(top - 48);
    if (d.watermark)
      page.drawText(latin(d.watermark), {
        x: 120,
        y: 330,
        size: 70,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(30),
      });
    y = top - 66;
  };
  const need = (h: number, again?: () => void) => {
    if (y - h < M + 44) {
      page = pdf.addPage(A4);
      head();
      again?.();
    }
  };

  head();
  if (d.emergency) {
    text('Recorded after the purchase; for ratification', M, y, { size: 8.5, color: RED });
    y -= 14;
  }

  // ---- supplier, ship to, bill to ----
  const colW = (W - 24) / 3;
  const block = (
    x: number,
    heading: string,
    rows: Array<[string | null, string | null | undefined]>,
  ) => {
    let yy = y;
    text(heading, x, yy, { size: 12, f: bold });
    yy -= 15;
    for (const [label, value] of rows) {
      if (!value) continue;
      if (label === null) {
        for (const l of wrap(value, font, 8.5, colW)) {
          text(l, x, yy);
          yy -= 11;
        }
      } else yy = pair(`${label}:`, value, x, yy, colW) - 0.5;
    }
    return yy;
  };
  const v = d.vendor;
  const ends = [
    block(M, 'Supplier Address:', [
      [null, `${v.name} (${v.code})`],
      [null, v.address],
      ['GSTIN', v.gstin ?? (v.gstStatus === 'regular' ? '-' : `- (${v.gstStatus})`)],
      ['State', v.state],
      ['Contact Person', v.contactName],
      ['Contact No', v.phone],
      ['Email Id', v.email],
      ['MSME', v.msme],
      ['Bank Name', v.bank?.name],
      ['Account Number', v.bank?.account],
      ['IFSC Code', v.bank?.ifsc],
    ]),
    block(M + colW + 12, 'Ship To:', [
      [null, d.shipTo.name],
      [null, d.shipTo.address],
      ['Contact Person', d.shipTo.contactName],
      ['Contact No', d.shipTo.contactPhone],
    ]),
    block(M + 2 * (colW + 12), 'Bill To:', [
      [null, d.billTo.name],
      [null, d.billTo.address],
      ['GSTIN', d.billTo.gstin],
      ['State', d.school.state],
      ['Contact Person', d.billTo.contactName],
      ['Contact No', d.billTo.contactPhone],
    ]),
  ];
  y = Math.min(...ends) - 6;
  const refs = [
    d.quoteRef ? `Your quotation: ${d.quoteRef}` : null,
    `Valid until: ${d.validUntil}`,
    d.requisition ? `Requisition: ${d.requisition}` : null,
    d.department ? `Department: ${d.department}` : null,
    d.supply === 'inter' ? 'Supply: from another state (IGST)' : 'Supply: within the state',
  ].filter((x): x is string => !!x);
  for (const l of wrap(refs.join('  ·  '), font, 8, W)) {
    text(l, M, y, { size: 8, color: MUTED });
    y -= 10;
  }
  y -= 8;

  // ---- the lines ----
  const cols = [
    { k: 'Sr.No', w: 28 },
    { k: 'Item', w: 166 },
    { k: 'Item Make / Model', w: 82 },
    { k: 'Quantity', w: 46, r: true },
    { k: 'UOM', w: 34 },
    { k: 'Unit Cost', w: 56, r: true },
    { k: 'Disc %', w: 34, r: true },
    { k: 'GST%', w: 32, r: true },
    { k: 'Amount', w: W - 478, r: true },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => {
    xs.push(x);
    return x + c.w;
  }, M);
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W, height: 18, color: BAND });
    cols.forEach((c, i) =>
      text(c.k, xs[i]! + 3, y, {
        size: 8,
        f: bold,
        ...(c.r ? { right: xs[i]! + c.w - 3 } : {}),
      }),
    );
    y -= 18;
  };
  tableHead();
  const rowOf = (seq: number, item: string[], makeModel: string[], cells: string[]) => {
    const itemLines = item.flatMap((t) => wrap(t, font, 8, cols[1]!.w - 6));
    const mm = makeModel.flatMap((t) => wrap(t, font, 8, cols[2]!.w - 6));
    const h = Math.max(itemLines.length, mm.length, 1) * 10 + 6;
    need(h, tableHead);
    const top = y;
    text(String(seq), xs[0]! + 3, y, { size: 8 });
    itemLines.forEach((l, i) => text(l, xs[1]! + 3, y - i * 10, { size: 8 }));
    mm.forEach((l, i) => text(l, xs[2]! + 3, y - i * 10, { size: 8 }));
    cells.forEach((cv, i) => {
      const c = cols[i + 3]!;
      text(cv, xs[i + 3]! + 3, y, { size: 8, ...(c.r ? { right: xs[i + 3]! + c.w - 3 } : {}) });
    });
    y -= h;
    for (const x of [...xs, M + W])
      page.drawLine({
        start: { x, y: top + 12 },
        end: { x, y: y + 6 },
        thickness: 0.4,
        color: LINE,
      });
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: M + W, y: y + 6 },
      thickness: 0.4,
      color: LINE,
    });
  };
  let seq = 0;
  for (const l of d.lines) {
    seq += 1;
    rowOf(
      seq,
      [
        ...(l.code ? [l.code] : []),
        `Desc: ${l.description}`,
        ...(l.hsn ? [`HSN/SAC: ${l.hsn}`] : []),
      ],
      [`Make: ${l.make ?? '-'}`, `Model: ${l.model ?? '-'}`],
      [
        qty(l.quantity),
        l.uom,
        money(l.rate),
        l.discountPct ? String(l.discountPct) : '0',
        l.rcm ? `${String(l.gstRate)}*` : String(l.gstRate),
        money(l.taxable),
      ],
    );
  }
  for (const ch of d.charges) {
    seq += 1;
    rowOf(
      seq,
      [`Desc: ${ch.label}`],
      ['Make: NA', 'Model: NA'],
      ['1', 'NA', money(ch.amount), '0', String(ch.gstRate), money(ch.amount)],
    );
  }

  // ---- the totals ----
  const gross = d.lines.reduce((a, l) => a + l.quantity * l.rate, 0);
  const afterDiscount = d.lines.reduce((a, l) => a + l.taxable, 0);
  const tax = d.lines.reduce((a, l) => a + l.gst, 0);
  const charges = d.charges.reduce((a, c) => a + c.total, 0);
  const totals: Array<[string, number, boolean]> = [
    ['Sub - Total amount:', gross, false],
    ['Discount:', gross - afterDiscount, false],
    ['Price After Discount:', afterDiscount, false],
    ['Tax:', tax, false],
    ['Price After Tax:', afterDiscount + tax, false],
    ...(d.charges.length
      ? ([['Freight and Other Charges With Tax:', charges, false]] as Array<
          [string, number, boolean]
        >)
      : []),
    ...(Math.abs(d.totals.roundOff) > 0.004
      ? ([['Round Off:', d.totals.roundOff, false]] as Array<[string, number, boolean]>)
      : []),
    ['Grand Total:', d.totals.total, true],
  ];
  need(totals.length * 12 + 30);
  y -= 6;
  for (const [k, amount, strong] of totals) {
    const val = money(amount);
    const size = strong ? 10 : 9;
    const vw = (strong ? bold : font).widthOfTextAtSize(val, size);
    text(`${k} `, 0, y, { size, f: bold, right: M + W - vw - 2 });
    text(val, 0, y, { size, ...(strong ? { f: bold } : {}), right: M + W });
    y -= strong ? 14 : 12;
  }
  y -= 4;
  need(20);
  // Rupees Five Hundred Seventy Two Only
  const titled = d.words
    .replace(/\b(rupees?|only)\b/gi, '')
    .trim()
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase());
  y = pair('Amount In Words:-', `Rupees ${titled} Only`, M, y, W, 9) - 6;
  if (d.totals.rcm) {
    for (const l of wrap(
      `* GST of Rs ${money(d.totals.rcm)} is payable by the school under reverse charge; the vendor does not charge it.`,
      font,
      8,
      W,
    )) {
      text(l, M, y, { size: 8, color: MUTED });
      y -= 10;
    }
    y -= 4;
  }

  // ---- the GST summary by HSN and rate (for the accounts) ----
  if (d.summary.length) {
    need(30 + d.summary.length * 11);
    text('GST summary', M, y, { size: 8.5, f: bold, color: NAVY });
    y -= 12;
    const sc = ['HSN / SAC', 'GST %', 'Taxable', 'CGST', 'SGST', 'IGST', 'Reverse charge'];
    const sw = W / sc.length;
    sc.forEach((h, i) =>
      text(h, M + i * sw, y, {
        size: 7.5,
        f: bold,
        color: MUTED,
        ...(i > 1 ? { right: M + (i + 1) * sw - 6 } : {}),
      }),
    );
    y -= 11;
    for (const s of d.summary) {
      const cells = [
        s.hsn ?? 'Charges / no HSN',
        String(s.gstRate),
        money(s.taxable),
        money(s.cgst),
        money(s.sgst),
        money(s.igst),
        s.rcm ? money(s.rcm) : '-',
      ];
      cells.forEach((cv, i) =>
        text(cv, M + i * sw, y, { size: 7.5, ...(i > 1 ? { right: M + (i + 1) * sw - 6 } : {}) }),
      );
      y -= 11;
    }
    y -= 6;
  }

  // ---- instructions and terms ----
  if (d.terms) {
    need(24);
    text('General Instructions:', M, y, { size: 9, f: bold });
    page.drawLine({
      start: { x: M, y: y - 2 },
      end: { x: M + bold.widthOfTextAtSize('General Instructions:', 9), y: y - 2 },
      thickness: 0.5,
      color: INK,
    });
    y -= 12;
    for (const l of wrap(d.terms, font, 8.5, W)) {
      need(11);
      text(l, M, y);
      y -= 11;
    }
    y -= 4;
  }
  const notes: Array<[string, string]> = [
    ['Payment Terms:-', d.paymentText ?? ''],
    ['Freight Terms:', d.freightTerms ?? ''],
    ['Expected Delivery Date:', d.deliveryDate ?? ''],
    ...(d.msmeWarning ? ([['MSME:', d.msmeWarning]] as Array<[string, string]>) : []),
    ...(d.emergency
      ? ([
          [
            'Emergency purchase:',
            `${d.emergency.reason}${d.emergency.billRef ? ` (bill ${d.emergency.billRef})` : ''}`,
          ],
        ] as Array<[string, string]>)
      : []),
    ['Note:', d.vendorNote ?? ''],
  ];
  for (const [k, val] of notes) {
    need(14);
    y = pair(k, val, M, y, W, 9) - 2;
  }
  y -= 12;

  // ---- who prepared and approved it ----
  const bw = W / Math.max(1, d.signers.length);
  need(90);
  d.signers.forEach((s, i) => {
    const x = M + i * bw;
    page.drawRectangle({
      x,
      y: y - 62,
      width: bw,
      height: 72,
      borderColor: LINE,
      borderWidth: 0.6,
    });
    page.drawLine({
      start: { x, y: y - 48 },
      end: { x: x + bw, y: y - 48 },
      thickness: 0.6,
      color: LINE,
    });
    text(wrap(s.name ?? '', font, 8.5, bw - 8)[0] ?? '', x + 4, y, { size: 8.5 });
    const img = signatures[i];
    if (img) {
      const sc = Math.min(30 / img.height, (bw - 12) / img.width, 1);
      page.drawImage(img, {
        x: x + 4,
        y: y - 44,
        width: img.width * sc,
        height: img.height * sc,
      });
    }
    text(s.as, x + 4, y - 58, { size: 8.5 });
  });
  y -= 76;
  const sys = '* This is a system generated document. Signature is not required *';
  text(sys, A4[0] / 2 - font.widthOfTextAtSize(sys, 8.5) / 2, y, { size: 8.5 });

  // ---- the footer on every page ----
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    hr(M + 24, 0.6);
    wrap(d.footer, bold, 7.5, W - 90)
      .slice(0, 2)
      .forEach((l, k) => text(l, M, M + 13 - k * 9, { size: 7.5, f: bold }));
    text(`${String(i + 1)} of ${String(pages.length)}`, 0, M + 13, {
      size: 7.5,
      color: MUTED,
      right: M + W,
    });
    text(`Printed ${d.generatedOn}`, 0, M + 4, { size: 7, color: MUTED, right: M + W });
  });
  return Buffer.from(await pdf.save());
}
