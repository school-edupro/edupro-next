import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * The Purchase Order as a PDF (docs/design/83, part 4): A4, the school's band with its GSTIN, the
 * vendor and the order's details, the lines with their HSN / SAC and GST, other charges, the totals
 * with the amount in words, reverse-charge GST payable by the school, the GST summary by HSN and rate,
 * the payment instalments, delivery, terms and conditions, and the signatures. "DRAFT" across a PO
 * not yet approved; "EMERGENCY PURCHASE" on one recorded after the fact.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const W = A4[0] - 2 * M;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.851, 0.878, 0.918);
const BAND = rgb(0.953, 0.961, 0.976);
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

export interface OrderPdfData {
  school: {
    name: string;
    address: string | null;
    contact: string | null;
    gstin: string | null;
    state: string | null;
  };
  logo: { contentType: string; bytes: Buffer } | null;
  title: string;
  watermark: string | null;
  number: string;
  date: string;
  validUntil: string;
  quoteRef: string | null;
  deliveryDate: string | null;
  department: string | null;
  requisition: string | null;
  billingAddress: string | null;
  deliveryAddress: string | null;
  vendor: {
    name: string;
    code: string;
    address: string | null;
    gstin: string | null;
    pan: string | null;
    state: string | null;
    gstStatus: string;
    msme: string | null;
    contact: string | null;
  };
  supply: 'intra' | 'inter';
  lines: Array<{
    seq: number;
    description: string;
    hsn: string | null;
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
  terms: string | null;
  emergency: { reason: string; billRef: string | null } | null;
  signatures: string[];
  approved: { by: string | null; at: string | null } | null;
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
  pdf.setAuthor(latin(d.school.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: Awaited<ReturnType<PDFDocument['embedPng']>> | null = null;
  if (d.logo)
    try {
      logo =
        d.logo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(d.logo.bytes))
          : await pdf.embedJpg(new Uint8Array(d.logo.bytes));
    } catch {
      logo = null;
    }

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
  const hr = (yy: number) =>
    page.drawLine({
      start: { x: M, y: yy },
      end: { x: M + W, y: yy },
      thickness: 0.6,
      color: LINE,
    });

  const head = () => {
    const top = A4[1];
    page.drawRectangle({ x: 0, y: top - 78, width: A4[0], height: 78, color: NAVY });
    let x = M;
    if (logo) {
      const s = Math.min(46 / logo.width, 46 / logo.height);
      page.drawImage(logo, { x: M, y: top - 62, width: logo.width * s, height: logo.height * s });
      x = M + 56;
    }
    text(d.school.name, x, top - 32, { size: 15, f: bold, color: rgb(1, 1, 1) });
    const sub = [d.school.address, d.school.contact].filter(Boolean).join(' · ');
    if (sub) text(sub.slice(0, 120), x, top - 46, { size: 8, color: rgb(0.86, 0.9, 0.96) });
    const tax = [
      d.school.gstin ? `GSTIN ${d.school.gstin}` : null,
      d.school.state ? `State ${d.school.state}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (tax) text(tax, x, top - 58, { size: 8, color: rgb(0.86, 0.9, 0.96) });
    if (d.watermark) {
      page.drawText(latin(d.watermark), {
        x: 150,
        y: 330,
        size: 70,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.12,
        rotate: degrees(35),
      });
    }
    y = top - 100;
  };
  const newPage = () => {
    page = pdf.addPage(A4);
    head();
  };
  const need = (h: number, again?: () => void) => {
    if (y - h < M + 30) {
      newPage();
      again?.();
    }
  };

  head();
  // title and the order's details
  text(d.title, M, y, { size: 14, f: bold, color: NAVY });
  text(`No. ${d.number}`, 0, y, { size: 11, f: bold, right: M + W });
  y -= 16;
  if (d.emergency) {
    text('Recorded after the purchase; for ratification', M, y, { size: 8.5, color: RED });
    y -= 12;
  }
  y -= 4;
  // vendor (left) and the order (right)
  const boxTop = y;
  const half = W / 2 - 6;
  text('To (vendor)', M, y, { size: 7.5, f: bold, color: MUTED });
  text('Order', M + half + 12, y, { size: 7.5, f: bold, color: MUTED });
  y -= 12;
  const left: string[] = [
    `${d.vendor.name} (${d.vendor.code})`,
    ...(d.vendor.address ? wrap(d.vendor.address, font, 8.5, half) : []),
    d.vendor.state ? `State: ${d.vendor.state}` : '',
    d.vendor.gstin
      ? `GSTIN: ${d.vendor.gstin}`
      : `GST: ${d.vendor.gstStatus}${d.vendor.pan ? ` · PAN ${d.vendor.pan}` : ''}`,
    d.vendor.msme ? `MSME: ${d.vendor.msme}` : '',
    d.vendor.contact ?? '',
  ].filter(Boolean);
  const right: Array<[string, string]> = [
    ['Date', d.date],
    ['Valid until', d.validUntil],
    ...(d.quoteRef ? ([['Your quotation', d.quoteRef]] as Array<[string, string]>) : []),
    ...(d.deliveryDate ? ([['Deliver by', d.deliveryDate]] as Array<[string, string]>) : []),
    ...(d.department ? ([['Department', d.department]] as Array<[string, string]>) : []),
    ...(d.requisition ? ([['Requisition', d.requisition]] as Array<[string, string]>) : []),
    ['Supply', d.supply === 'intra' ? 'Within the state' : 'Inter-state'],
  ];
  let ly = y;
  for (const [i, l] of left.entries()) {
    text(l, M, ly, { size: 8.5, f: i === 0 ? bold : font });
    ly -= 11;
  }
  let ry = y;
  for (const [k, v] of right) {
    text(k, M + half + 12, ry, { size: 8.5, color: MUTED });
    text(v, M + half + 90, ry, { size: 8.5 });
    ry -= 11;
  }
  y = Math.min(ly, ry) - 4;
  page.drawRectangle({
    x: M - 4,
    y,
    width: W + 8,
    height: boxTop - y + 10,
    borderColor: LINE,
    borderWidth: 0.6,
  });
  y -= 14;
  for (const [label, addr] of [
    ['Bill to', d.billingAddress],
    ['Deliver to', d.deliveryAddress],
  ] as const) {
    if (!addr) continue;
    const lines = wrap(addr, font, 8.5, W - 70);
    text(label, M, y, { size: 8.5, color: MUTED });
    for (const l of lines) {
      text(l, M + 70, y, { size: 8.5 });
      y -= 11;
    }
  }
  y -= 6;

  // the lines
  const cols = [
    { k: '#', w: 16 },
    { k: 'Item', w: 150 },
    { k: 'HSN/SAC', w: 40 },
    { k: 'Qty', w: 50, r: true },
    { k: 'Rate', w: 50, r: true },
    { k: 'Disc %', w: 30, r: true },
    { k: 'Taxable', w: 56, r: true },
    { k: 'GST %', w: 28, r: true },
    { k: 'GST', w: 48, r: true },
    { k: 'Total', w: 55, r: true },
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => {
    xs.push(x);
    return x + c.w;
  }, M);
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W, height: 15, color: BAND });
    for (const [i, c] of cols.entries())
      text(c.k, xs[i]!, y, {
        size: 7.5,
        f: bold,
        color: MUTED,
        ...(c.r ? { right: xs[i]! + c.w - 3 } : {}),
      });
    y -= 16;
  };
  need(60);
  tableHead();
  for (const l of d.lines) {
    const desc = wrap(l.description, font, 8, cols[1]!.w - 4);
    need(desc.length * 10 + 6, tableHead);
    const cells = [
      String(l.seq),
      '',
      l.hsn ?? '',
      `${qty(l.quantity)} ${l.uom}`,
      money(l.rate),
      l.discountPct ? String(l.discountPct) : '',
      money(l.taxable),
      String(l.gstRate),
      l.rcm ? `${money(l.rcm)}*` : money(l.gst),
      money(l.total),
    ];
    for (const [i, c] of cols.entries())
      if (i !== 1)
        text(cells[i]!, xs[i]!, y, { size: 8, ...(c.r ? { right: xs[i]! + c.w - 3 } : {}) });
    for (const [j, dl] of desc.entries()) text(dl, xs[1]!, y - j * 10, { size: 8 });
    y -= desc.length * 10 + 4;
    hr(y + 5);
  }
  for (const c of d.charges) {
    need(14, tableHead);
    text(c.label, xs[1]!, y, { size: 8 });
    text(money(c.amount), 0, y, { size: 8, right: xs[6]! + cols[6]!.w - 3 });
    text(String(c.gstRate), 0, y, { size: 8, right: xs[7]! + cols[7]!.w - 3 });
    text(money(c.gst), 0, y, { size: 8, right: xs[8]! + cols[8]!.w - 3 });
    text(money(c.total), 0, y, { size: 8, right: xs[9]! + cols[9]!.w - 3 });
    y -= 14;
    hr(y + 5);
  }

  // totals
  const tot: Array<[string, number, boolean?]> = [
    ['Taxable value', d.totals.taxable],
    ...(d.totals.cgst ? ([['CGST', d.totals.cgst]] as Array<[string, number]>) : []),
    ...(d.totals.sgst ? ([['SGST', d.totals.sgst]] as Array<[string, number]>) : []),
    ...(d.totals.igst ? ([['IGST', d.totals.igst]] as Array<[string, number]>) : []),
    ...(d.totals.roundOff ? ([['Round off', d.totals.roundOff]] as Array<[string, number]>) : []),
    ['Total (Rs)', d.totals.total, true],
  ];
  need(tot.length * 12 + 40);
  y -= 4;
  for (const [k, v, b] of tot) {
    text(k, M + W - 200, y, { size: b ? 10 : 8.5, f: b ? bold : font });
    text(money(v), 0, y, { size: b ? 10 : 8.5, f: b ? bold : font, right: M + W - 3 });
    y -= b ? 14 : 11;
  }
  for (const l of wrap(`Rupees ${d.words} only`, bold, 8.5, W)) {
    text(l, M, y, { size: 8.5, f: bold });
    y -= 11;
  }
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
  }
  y -= 6;

  // GST summary by HSN and rate
  if (d.summary.length) {
    need(30 + d.summary.length * 11);
    text('GST summary', M, y, { size: 8.5, f: bold, color: NAVY });
    y -= 12;
    const sx = [M, M + 80, M + 130, M + 210, M + 290, M + 370, M + 450];
    for (const [i, h] of [
      'HSN / SAC',
      'GST %',
      'Taxable',
      'CGST',
      'SGST',
      'IGST',
      'Reverse charge',
    ].entries())
      text(h, sx[i]!, y, { size: 7.5, f: bold, color: MUTED });
    y -= 11;
    for (const s of d.summary) {
      const v = [
        s.hsn ?? 'Charges',
        String(s.gstRate),
        money(s.taxable),
        money(s.cgst),
        money(s.sgst),
        money(s.igst),
        s.rcm ? money(s.rcm) : '-',
      ];
      for (const [i, c] of v.entries()) text(c, sx[i]!, y, { size: 8 });
      y -= 11;
    }
    y -= 6;
  }

  // payment, delivery, terms
  const blocks: Array<[string, string | null]> = [
    ['Payment', d.paymentText],
    ['MSME', d.msmeWarning],
    [
      'Emergency purchase',
      d.emergency
        ? `${d.emergency.reason}${d.emergency.billRef ? ` (bill ${d.emergency.billRef})` : ''}`
        : null,
    ],
    ['Terms and conditions', d.terms],
  ];
  for (const [k, v] of blocks) {
    if (!v) continue;
    const lines = wrap(v, font, 8, W);
    need(14 + lines.length * 10);
    text(k, M, y, { size: 8.5, f: bold, color: NAVY });
    y -= 11;
    for (const l of lines) {
      need(10);
      text(l, M, y, { size: 8 });
      y -= 10;
    }
    y -= 6;
  }

  // signatures
  need(60);
  y -= 30;
  const sw = W / Math.max(1, d.signatures.length);
  for (const [i, s] of d.signatures.entries()) {
    const x = M + i * sw;
    page.drawLine({
      start: { x, y: y + 12 },
      end: { x: x + sw - 20, y: y + 12 },
      thickness: 0.6,
      color: MUTED,
    });
    text(s, x, y, { size: 8, color: MUTED });
  }
  if (d.approved?.by)
    text(
      `Approved in EduPro by ${d.approved.by}${d.approved.at ? ` on ${d.approved.at}` : ''}`,
      M,
      y - 14,
      {
        size: 7.5,
        color: MUTED,
      },
    );

  const pages = pdf.getPages();
  for (const [i, p] of pages.entries()) {
    const t = latin(`${d.number} · page ${String(i + 1)} of ${String(pages.length)}`);
    p.drawText(t, {
      x: A4[0] - M - font.widthOfTextAtSize(t, 7.5),
      y: 18,
      size: 7.5,
      font,
      color: MUTED,
    });
  }
  return Buffer.from(await pdf.save());
}
