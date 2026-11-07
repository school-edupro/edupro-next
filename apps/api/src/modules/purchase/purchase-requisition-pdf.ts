import { degrees, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawLetterhead, embedLogo } from '../../common/pdf/letterhead';

/**
 * The printed Purchase Requisition (docs/design/83, "As built — list filters and exports; the
 * letterhead"): A4, the school's letterhead, the PR's details (date, department, purpose, needed by, the
 * indents it came from, the sourcing, the status), the lines with the vendor chosen, rate, GST and
 * amount (on rate contract, above the contract or dearer than L1 with the reason; from the store), the
 * value; the comparative statement when there are quotes (what the school pays per unit with GST, the
 * lowest marked L1); the reasonable-price certificate; the tender reference; the approval trail as
 * recorded; and boxes to sign for the purchase officer, the committee members and the approver.
 * "NOT APPROVED" across one still deciding; "REJECTED" or "CANCELLED" across a closed one.
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

export interface RequisitionPdfData {
  school: { name: string; address: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  generatedOn: string;
  watermark: string | null;
  number: string;
  facts: Array<[string, string]>;
  lines: Array<{
    seq: number;
    description: string;
    /** under the item: on rate contract, the reason for a dearer choice, the store */
    notes: string[];
    quantity: number;
    uom: string;
    vendor: string;
    rate: number | null;
    gstRate: number | null;
    amount: number | null;
  }>;
  value: number;
  /** the comparative statement: the vendors' codes and, per line, each one's landed rate (L1 marked) */
  statement: {
    vendors: Array<{ code: string; name: string; ref: string }>;
    rows: Array<{
      line: string;
      cells: Array<{ landed: number | null; l1: boolean }>;
      chosen: string;
    }>;
  } | null;
  certificate: { text: string; by: string; at: string } | null;
  tender: string | null;
  approvals: Array<{ level: string; status: string; who: string; at: string; note: string | null }>;
  /** the boxes to sign: what each signs as, and the name printed under it */
  signatures: Array<{ as: string; name: string }>;
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

export async function purchaseRequisitionPdf(d: RequisitionPdfData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`Purchase Requisition ${d.number}`));
  pdf.setAuthor(latin(d.school.name));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, d.logo);
  const department = d.facts.find(([k]) => k === 'Department')?.[1] ?? '';

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
  const rule = (yy: number, thickness = 0.5) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness, color: LINE });
  const head = () => {
    y = drawLetterhead(page, { regular: font, bold }, logo, {
      school: d.school.name,
      address: d.school.address,
      title: 'Purchase Requisition',
      details: `No. ${d.number}${department ? ` · Department: ${department}` : ''} · Generated on: ${d.generatedOn}`,
      margin: 30,
    });
    rule(y + 4, 0.8);
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
  const heading = (s: string) => {
    need(40);
    text(s, M, y, { size: 10, f: bold, color: NAVY });
    y -= 16;
  };

  head();
  for (const [k, v] of d.facts) {
    const ls = wrap(v, font, 8.5, W - 110);
    need(ls.length * 11);
    text(k, M, y, { color: MUTED });
    for (const l of ls) {
      text(l, M + 110, y);
      y -= 11;
    }
  }
  y -= 8;

  // the lines
  const cols = [
    { k: '#', w: 16 },
    { k: 'Item', w: 170 },
    { k: 'Quantity', w: 48, r: true },
    { k: 'Unit', w: 34 },
    { k: 'Vendor', w: 110 },
    { k: 'Rate', w: 50, r: true },
    { k: 'GST %', w: 34, r: true },
    { k: 'Amount', w: 61, r: true },
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
    const notes = l.notes.flatMap((n) => wrap(n, font, 7, cols[1]!.w - 4));
    const vendor = wrap(l.vendor, font, 8, cols[4]!.w - 4);
    const h = Math.max(desc.length + notes.length, vendor.length) * 10 + 4;
    need(h, header);
    text(String(l.seq), xs[0]!, y, { size: 8 });
    text(qty(l.quantity), 0, y, { size: 8, right: xs[2]! + cols[2]!.w - 3 });
    text(l.uom, xs[3]! + 6, y, { size: 8 });
    text(l.rate === null ? '-' : money(l.rate), 0, y, { size: 8, right: xs[5]! + cols[5]!.w - 3 });
    text(l.gstRate === null ? '-' : String(l.gstRate), 0, y, {
      size: 8,
      right: xs[6]! + cols[6]!.w - 3,
    });
    text(l.amount === null ? '-' : money(l.amount), 0, y, {
      size: 8,
      right: xs[7]! + cols[7]!.w - 3,
    });
    let ly = y;
    for (const t of desc) {
      text(t, xs[1]!, ly, { size: 8 });
      ly -= 10;
    }
    for (const t of notes) {
      text(t, xs[1]!, ly, { size: 7, color: MUTED });
      ly -= 10;
    }
    let vy = y;
    for (const t of vendor) {
      text(t, xs[4]!, vy, { size: 8 });
      vy -= 10;
    }
    y = Math.min(ly, vy) - 4;
    rule(y + 6);
  }
  need(20);
  text('Value before GST (Rs)', M, y, { f: bold });
  text(money(d.value), 0, y, { f: bold, right: M + W - 3 });
  y -= 22;

  // the comparative statement
  if (d.statement && d.statement.vendors.length) {
    heading('Comparative statement: rate + GST = what the school pays per unit; the lowest is L1');
    const lineW = 170;
    const chosenW = 110;
    const vw = Math.max(40, (W - lineW - chosenW) / d.statement.vendors.length);
    const vx = (i: number) => M + lineW + i * vw;
    const sHeader = () => {
      page.drawRectangle({ x: M - 2, y: y - 4, width: W + 4, height: 15, color: BAND });
      text('Line', M, y, { size: 7.5, f: bold, color: MUTED });
      d.statement!.vendors.forEach((v, i) =>
        text(v.code, 0, y, { size: 7.5, f: bold, color: MUTED, right: vx(i) + vw - 4 }),
      );
      text('Chosen', M + W - chosenW + 6, y, { size: 7.5, f: bold, color: MUTED });
      y -= 16;
    };
    sHeader();
    for (const r of d.statement.rows) {
      const ls = wrap(r.line, font, 8, lineW - 6);
      const ch = wrap(r.chosen, font, 8, chosenW - 8);
      need(Math.max(ls.length, ch.length) * 10 + 4, sHeader);
      r.cells.forEach((c, i) =>
        text(c.landed === null ? 'Not quoted' : `${money(c.landed)}${c.l1 ? ' L1' : ''}`, 0, y, {
          size: 8,
          right: vx(i) + vw - 4,
          ...(c.l1 ? { f: bold } : {}),
          ...(c.landed === null ? { color: MUTED } : {}),
        }),
      );
      let ly = y;
      for (const t of ls) {
        text(t, M, ly, { size: 8 });
        ly -= 10;
      }
      let cy = y;
      for (const t of ch) {
        text(t, M + W - chosenW + 6, cy, { size: 8 });
        cy -= 10;
      }
      y = Math.min(ly, cy) - 4;
      rule(y + 6);
    }
    y -= 4;
    for (const v of d.statement.vendors) {
      const ls = wrap(`${v.code}: ${v.name}${v.ref ? ` · ${v.ref}` : ''}`, font, 7.5, W);
      need(ls.length * 10);
      for (const l of ls) {
        text(l, M, y, { size: 7.5, color: MUTED });
        y -= 10;
      }
    }
    y -= 8;
  }

  if (d.certificate) {
    heading('Reasonable-price certificate');
    for (const l of wrap(`"${d.certificate.text}"`, font, 8.5, W)) {
      need(11);
      text(l, M, y);
      y -= 11;
    }
    text(`${d.certificate.by} · ${d.certificate.at}`, M, y, { size: 8, color: MUTED });
    y -= 18;
  }
  if (d.tender) {
    heading('Tender');
    for (const l of wrap(d.tender, font, 8.5, W)) {
      need(11);
      text(l, M, y);
      y -= 11;
    }
    y -= 8;
  }

  // the approval trail as recorded
  if (d.approvals.length) {
    heading('Approvals');
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
      need(Math.max(who.length, note.length, 1) * 10 + 4, aHeader);
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
      rule(y + 6);
    }
    y -= 10;
  }

  // boxes to sign, four to a row
  const bw = (W - 3 * 12) / 4;
  for (let i = 0; i < d.signatures.length; i += 4) {
    need(70);
    d.signatures.slice(i, i + 4).forEach((sg, j) => {
      const x = M + j * (bw + 12);
      page.drawRectangle({
        x,
        y: y - 50,
        width: bw,
        height: 56,
        borderColor: LINE,
        borderWidth: 0.8,
      });
      text(wrap(sg.as, bold, 7.5, bw - 10)[0] ?? '', x + 5, y - 4, {
        size: 7.5,
        f: bold,
        color: MUTED,
      });
      page.drawLine({
        start: { x: x + 5, y: y - 34 },
        end: { x: x + bw - 5, y: y - 34 },
        thickness: 0.5,
        color: INK,
      });
      text(wrap(sg.name || 'Signature and date', font, 7, bw - 10)[0] ?? '', x + 5, y - 44, {
        size: 7,
        ...(sg.name ? {} : { color: MUTED }),
      });
    });
    y -= 66;
  }
  need(24);
  for (const l of wrap(
    'The approvals above are as recorded in the system. Amounts are before GST; the comparative statement shows what the school pays per unit with GST.',
    font,
    7.5,
    W,
  )) {
    text(l, M, y, { size: 7.5, color: MUTED });
    y -= 10;
  }

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
