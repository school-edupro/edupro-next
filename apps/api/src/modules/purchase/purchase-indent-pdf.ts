import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawLetterhead, embedLogo } from '../../common/pdf/letterhead';

/**
 * The printed Purchase Indent (docs/design/83, "As built — the printed PI"): A4, the school's letterhead, the
 * PI's details (number, date, department, who raised it and for whom, purpose, priority, needed by),
 * per line the item, quantity and unit, what the main store and the department's stores held free when
 * it was raised (and the raiser's reason for buying anyway), the rates and the estimate only for those
 * who see rates, the approval trail as recorded, and boxes to sign: raised by, head of department,
 * Principal, store keeper. "NOT APPROVED" across one still deciding; "REJECTED" or "WITHDRAWN" across
 * a closed one.
 */

const A4: [number, number] = [595.28, 841.89];
const M = 36;
const W = A4[0] - 2 * M;
const NAVY = rgb(0, 0.149, 0.365);
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
const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

export interface IndentPdfData {
  school: { name: string; address: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  /** 07-11-2026 06:15 PM, India */
  generatedOn: string;
  watermark: string | null;
  number: string;
  sentOn: string;
  department: string;
  raisedBy: string;
  purpose: string;
  priority: 'normal' | 'urgent';
  requiredBy: string | null;
  status: string;
  showRates: boolean;
  lines: Array<{
    seq: number;
    description: string;
    note: string | null;
    quantity: number;
    uom: string;
    /** in the store unit, NULL: a line in words or an item not kept in stock */
    stockFree: number | null;
    stockUom: string | null;
    stockStores: Array<{ store: string; free: number }>;
    stockReason: string | null;
    rate: number | null;
    amount: number | null;
  }>;
  estimate: number | null;
  approvals: Array<{ level: string; status: string; who: string; at: string; note: string | null }>;
  printedOn: string;
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

export async function purchaseIndentPdf(d: IndentPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`Purchase Indent ${d.number}`));
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
  // the letterhead, as the school's registers print it: logo left; name, address, title, details centred
  const head = () => {
    y = drawLetterhead(page, { regular: font, bold }, logo, {
      school: d.school.name,
      address: d.school.address,
      title: 'Purchase Indent',
      details: `No. ${d.number} · Department: ${d.department} · Generated on: ${d.generatedOn}`,
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
    ['Sent on', d.sentOn],
    ['Department', d.department],
    ['Raised by', d.raisedBy],
    ['Purpose', d.purpose],
    ['Priority', d.priority === 'urgent' ? 'Urgent' : 'Normal'],
    ['Needed by', d.requiredBy ?? 'Not given'],
    ['Status', d.status],
  ];
  for (const [k, v] of facts) {
    text(k, M, y, { color: MUTED });
    for (const l of wrap(
      v,
      k === 'Priority' && d.priority === 'urgent' ? bold : font,
      8.5,
      W - 100,
    )) {
      text(l, M + 100, y, k === 'Priority' && d.priority === 'urgent' ? { f: bold } : {});
      y -= 11;
    }
  }
  y -= 8;

  // the lines: the item column takes the room the rates leave when they are not shown
  const cols = [
    { k: '#', w: 16 },
    { k: 'Item', w: d.showRates ? 190 : 323 },
    { k: 'Quantity', w: 50, r: true },
    { k: 'Unit', w: 34 },
    { k: 'In store when raised', w: 100 },
    ...(d.showRates
      ? [
          { k: 'Rate', w: 55, r: true },
          { k: 'Amount', w: 78, r: true },
        ]
      : []),
  ];
  const xs: number[] = [];
  cols.reduce((x, c) => {
    xs.push(x);
    return x + c.w;
  }, M);
  const header = () => {
    page.drawRectangle({ x: M - 2, y: y - 4, width: W + 4, height: 15, color: BAND });
    cols.forEach((c, i) =>
      text(c.k, xs[i]! + (i === 3 ? 6 : 0), y, {
        size: 7.5,
        f: bold,
        color: MUTED,
        ...(c.r ? { right: xs[i]! + c.w - 3 } : {}),
      }),
    );
    y -= 16;
  };
  header();
  for (const l of d.lines) {
    const desc = wrap(l.description, font, 8, cols[1]!.w - 4);
    const extra = [
      ...(l.note ? wrap(l.note, font, 7, cols[1]!.w - 4) : []),
      ...(l.stockReason
        ? wrap(`Bought though the store has it: ${l.stockReason}`, font, 7, cols[1]!.w - 4)
        : []),
    ];
    const stock: string[] =
      l.stockFree === null
        ? ['-']
        : l.stockFree <= 0
          ? ['None free']
          : [
              `${qty(l.stockFree)} ${l.stockUom ?? ''} free`.trim(),
              ...l.stockStores.flatMap((s) => wrap(`${s.store}: ${qty(s.free)}`, font, 7, 96)),
            ];
    const h = Math.max(desc.length + extra.length, stock.length) * 10 + 4;
    need(h, header);
    text(String(l.seq), xs[0]!, y, { size: 8 });
    text(qty(l.quantity), 0, y, { size: 8, right: xs[2]! + cols[2]!.w - 3 });
    text(l.uom, xs[3]! + 6, y, { size: 8 });
    if (d.showRates) {
      text(l.rate === null ? '-' : money(l.rate), 0, y, {
        size: 8,
        right: xs[5]! + cols[5]!.w - 3,
      });
      text(l.amount === null ? '-' : money(l.amount), 0, y, {
        size: 8,
        right: xs[6]! + cols[6]!.w - 3,
      });
    }
    let ly = y;
    for (const t of desc) {
      text(t, xs[1]!, ly, { size: 8 });
      ly -= 10;
    }
    for (const t of extra) {
      text(t, xs[1]!, ly, { size: 7, color: MUTED });
      ly -= 10;
    }
    let sy = y;
    stock.forEach((t, i) => {
      text(t, xs[4]!, sy, i ? { size: 7, color: MUTED } : { size: 8 });
      sy -= 10;
    });
    y = Math.min(ly, sy) - 4;
    page.drawLine({
      start: { x: M, y: y + 6 },
      end: { x: M + W, y: y + 6 },
      thickness: 0.5,
      color: LINE,
    });
  }
  if (d.showRates && d.estimate !== null) {
    need(20);
    text('Estimate (Rs)', M, y, { f: bold });
    text(money(d.estimate), 0, y, { f: bold, right: M + W - 3 });
    y -= 22;
  } else y -= 10;

  // the approval trail as recorded
  if (d.approvals.length) {
    need(40);
    text('Approvals', M, y, { size: 10, f: bold, color: NAVY });
    y -= 16;
    const ac = [
      { k: 'Level', w: 120 },
      { k: 'Status', w: 70 },
      { k: 'By', w: 140 },
      { k: 'On', w: 60 },
      { k: 'Note', w: W - 390 },
    ];
    const ax: number[] = [];
    ac.reduce((x, c) => {
      ax.push(x);
      return x + c.w;
    }, M);
    const aHeader = () => {
      page.drawRectangle({ x: M - 2, y: y - 4, width: W + 4, height: 15, color: BAND });
      ac.forEach((c, i) => text(c.k, ax[i]!, y, { size: 7.5, f: bold, color: MUTED }));
      y -= 16;
    };
    aHeader();
    for (const a of d.approvals) {
      const who = wrap(a.who, font, 8, ac[2]!.w - 4);
      const note = a.note ? wrap(a.note, font, 7.5, ac[4]!.w - 4) : [];
      const h = Math.max(who.length, note.length, 1) * 10 + 4;
      need(h, aHeader);
      text(a.level, ax[0]!, y, { size: 8 });
      text(a.status, ax[1]!, y, { size: 8 });
      text(a.at, ax[3]!, y, { size: 8 });
      let wy = y;
      for (const t of who) {
        text(t, ax[2]!, wy, { size: 8 });
        wy -= 10;
      }
      let ny = y;
      for (const t of note) {
        text(t, ax[4]!, ny, { size: 7.5, color: MUTED });
        ny -= 10;
      }
      y = Math.min(wy, ny, y - 10) - 4;
      page.drawLine({
        start: { x: M, y: y + 6 },
        end: { x: M + W, y: y + 6 },
        thickness: 0.5,
        color: LINE,
      });
    }
    y -= 10;
  }

  // boxes to sign
  need(80);
  const boxes = ['Raised by', 'Head of department', 'Principal', 'Store keeper (stock checked)'];
  const bw = (W - 3 * 12) / 4;
  boxes.forEach((b, i) => {
    const x = M + i * (bw + 12);
    page.drawRectangle({
      x,
      y: y - 50,
      width: bw,
      height: 56,
      borderColor: LINE,
      borderWidth: 0.8,
    });
    text(b, x + 5, y - 4, { size: 7.5, f: bold, color: MUTED });
    page.drawLine({
      start: { x: x + 5, y: y - 34 },
      end: { x: x + bw - 5, y: y - 34 },
      thickness: 0.5,
      color: INK,
    });
    if (i === 0) text(wrap(d.raisedBy, font, 7, bw - 10)[0] ?? '', x + 5, y - 44, { size: 7 });
    else text('Signature and date', x + 5, y - 44, { size: 7, color: MUTED });
  });
  y -= 70;
  need(24);
  for (const l of wrap(
    'The approvals above are as recorded in the system. "In store when raised" is the free stock (in hand less what is held for other requests) in the main store and the department’s stores when the indent was sent.',
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
    text(`Printed ${d.printedOn}`, M, 20, { size: 7, color: MUTED });
    text(`${d.number} · page ${String(i + 1)} of ${String(pages.length)}`, 0, 20, {
      size: 7,
      color: MUTED,
      right: M + W,
    });
  });
  return Buffer.from(await pdf.save());
}
