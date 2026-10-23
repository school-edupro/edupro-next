import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { FeeBill } from './fee-documents.service';

const W = 595.28; // A4 portrait
const H = 841.89;
const M = 36;
const INK = rgb(0, 0, 0);
const BLUE = rgb(0.17, 0.24, 0.6);
const SHADE = rgb(0.88, 0.88, 0.88);
const MUTED = rgb(0.35, 0.35, 0.35);

const latin = (s: string | null | undefined) =>
  (s ?? '').replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null | undefined) => {
  if (!iso) return '-';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const title = (w: string) => w.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

/**
 * The fee bill as a PDF, in the school's layout (Fee setup -> Receipt numbers, layouts): the annual bill
 * (letterhead, particulars, heads of the session, the schedule of each fee with paid and balance, fee
 * received, the balance in words and the notes) or the instalment bill (what is payable, head by head).
 */
export async function billPdf(
  b: FeeBill,
  logo?: { contentType: string; bytes: Buffer } | null,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Fee bill ${b.billNo}`);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let image: PDFImage | null = null;
  if (logo && /^image\/(png|jpeg)$/.test(logo.contentType)) {
    try {
      image =
        logo.contentType === 'image/png'
          ? await pdf.embedPng(new Uint8Array(logo.bytes))
          : await pdf.embedJpg(new Uint8Array(logo.bytes));
    } catch {
      image = null;
    }
  }
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const room = (need: number) => {
    if (y - need >= M) return;
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const fit = (font: PDFFont, t: string, size: number, width: number) => {
    let out = latin(t);
    if (font.widthOfTextAtSize(out, size) <= width) return out;
    while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
      out = out.slice(0, -1);
    return `${out}...`;
  };
  const text = (t: string, x: number, yy: number, size: number, font = regular, color = INK) =>
    page.drawText(latin(t), { x, y: yy, size, font, color });
  const centre = (t: string, size: number, font = regular, color = INK) => {
    const s = fit(font, t, size, W - 2 * M - 120);
    text(s, (W - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color);
    y -= size + 4;
  };
  /** A ruled table: widths in fractions of the page, right = which columns are amounts. */
  const table = (
    head: string[],
    rows: string[][],
    widths: number[],
    right: number[] = [],
    footer?: string[],
  ) => {
    const full = W - 2 * M;
    const xs = widths.reduce<number[]>(
      (a, w, i) => [...a, (a[i - 1] ?? M) + (i === 0 ? 0 : widths[i - 1]! * full)],
      [],
    );
    xs[0] = M;
    const row = (cells: string[], font: PDFFont, shade: boolean) => {
      room(18);
      if (shade) page.drawRectangle({ x: M, y: y - 14, width: full, height: 16, color: SHADE });
      cells.forEach((cell, i) => {
        const w = widths[i]! * full - 8;
        const s = fit(font, cell, 8.5, w);
        const x = right.includes(i)
          ? xs[i]! + widths[i]! * full - 4 - font.widthOfTextAtSize(s, 8.5)
          : xs[i]! + 4;
        text(s, x, y - 10, 8.5, font);
      });
      page.drawRectangle({
        x: M,
        y: y - 14,
        width: full,
        height: 16,
        borderColor: INK,
        borderWidth: 0.5,
      });
      xs.slice(1).forEach((x) =>
        page.drawLine({
          start: { x, y: y + 2 },
          end: { x, y: y - 14 },
          thickness: 0.5,
          color: INK,
        }),
      );
      y -= 16;
    };
    row(head, bold, true);
    for (const r of rows) row(r, regular, false);
    if (footer) row(footer, bold, true);
    y -= 8;
  };

  // letterhead
  if (image) {
    const s = Math.min(54 / image.width, 54 / image.height);
    page.drawImage(image, {
      x: M,
      y: y - image.height * s + 6,
      width: image.width * s,
      height: image.height * s,
    });
  }
  centre(b.school.name, 15, bold, BLUE);
  if (b.school.address) centre(b.school.address, 8.5, bold);
  if (b.letterhead.phone) centre(`Ph. No: ${b.letterhead.phone}`, 8);
  if (b.letterhead.email) centre(`Email: ${b.letterhead.email}`, 8);
  if (b.letterhead.website) centre(`Website: ${b.letterhead.website}`, 8);
  const fee =
    b.ledger === 'hostel'
      ? 'Hostel Fee Bill'
      : b.ledger === 'school'
        ? 'School Fee Bill'
        : 'Annual Fee Bill';
  y -= 4;
  centre(b.layout === 'instalment' ? 'Fee Bill' : fee, 12, bold);
  centre(`Academic Year : ${b.session.from} to ${b.session.to}`, 10, bold);
  y -= 6;
  // particulars, two to a line
  const pairs: Array<[string, string]> = [
    ['Fee Bill No.:', b.billNo],
    ['Session:', b.year],
    ['Name of Student:', b.student.name],
    ['Admission No.:', b.student.admissionNo],
    ['Class & Section:', b.student.section ?? '-'],
    ['Date of Birth:', dmy(b.student.dob)],
    ["Father's Name:", b.student.father ?? '-'],
    ["Mother's Name:", b.student.mother ?? '-'],
    ['Route/Stop:', b.student.route ?? '-'],
    ['Generation Date:', b.generatedAt],
  ];
  const half = (W - 2 * M) / 2;
  for (let i = 0; i < pairs.length; i += 2) {
    room(14);
    [pairs[i], pairs[i + 1]].forEach((p, k) => {
      if (!p) return;
      const x = M + k * half;
      text(p[0], x, y, 9, bold);
      text(fit(regular, p[1], 9, half - 100), x + 92, y, 9);
    });
    y -= 14;
  }
  y -= 6;

  if (b.layout === 'instalment') {
    // the earlier bill: what is payable, instalment by instalment, head by head
    const rows: string[][] = [];
    for (const i of b.instalments) {
      i.lines.forEach((l, n) =>
        rows.push([
          n === 0 ? i.label : n === 1 && i.ledger === 'hostel' ? '(hostel)' : '',
          n === 0 ? dmy(i.dueOn) : '',
          l.head,
          rupees(l.fee),
          rupees(l.discount),
          rupees(l.paid),
          rupees(l.balance),
        ]),
      );
      if (Number(i.lateFee) > 0) rows.push(['', '', 'Late fee', '', '', '', rupees(i.lateFee)]);
    }
    table(
      ['Instalment', 'Last date', 'Particulars', 'Fee', 'Discount', 'Paid', 'Payable'],
      rows,
      [0.19, 0.11, 0.26, 0.11, 0.11, 0.11, 0.11],
      [3, 4, 5, 6],
      ['Total payable', '', '', '', '', '', rupees(b.totals.payable)],
    );
    room(14);
    text(`Amount in words: ${title(b.totals.payableWords)} Only`, M, y, 9, bold);
    y -= 14;
  } else {
    // heads of the session
    const through = b.headsThrough ? ` till ${b.headsThrough}` : '';
    const rows: string[][] = [];
    const groups: Array<[string | null, FeeBill['heads']]> = [
      [null, b.heads.filter((h) => h.ledger === 'school' && !h.optional)],
      ['OPTIONAL FEES', b.heads.filter((h) => h.ledger === 'school' && h.optional)],
      ['HOSTEL FEES', b.heads.filter((h) => h.ledger === 'hostel')],
    ];
    for (const [name, list] of groups) {
      if (!list.length) continue;
      if (name) rows.push([name, '']);
      for (const h of list) rows.push([`${h.head}${through}`, rupees(h.amount)]);
    }
    if (Number(b.discount) > 0)
      rows.push(['Less: discount / concession', `-${rupees(b.discount)}`]);
    const grand = b.heads.reduce((a, h) => a + Number(h.amount), 0) - Number(b.discount);
    table(['Fee Head', 'Amount'], rows, [0.75, 0.25], [1], ['GRAND TOTAL', rupees(grand)]);
    for (const s of b.schedules) {
      room(40);
      y -= 4;
      text(
        `${s.ledger === 'hostel' ? 'Hostel fee' : 'School fee'} is collected on ${s.payPlan.replace('_', '-')} basis as per the following schedule:`,
        M,
        y,
        9,
        bold,
      );
      y -= 10;
      table(
        ['Instalment', 'Months', 'Last date', 'Payable', 'Paid', 'Balance', 'Late fee'],
        s.rows.map((r) => [
          r.no,
          r.months,
          dmy(r.dueOn),
          rupees(r.payable),
          rupees(r.paid),
          rupees(r.balance),
          rupees(r.lateFee),
        ]),
        [0.1, 0.24, 0.12, 0.14, 0.13, 0.14, 0.13],
        [3, 4, 5, 6],
      );
    }
    room(40);
    y -= 6;
    text('DETAILS OF FEE RECEIVED', M, y, 11, bold);
    y -= 10;
    table(
      [
        'S.No',
        'Receipt No.',
        'Type',
        'Txn / Cheque No',
        'Date',
        'Amount',
        'Late fee',
        'Bounce',
        'Final',
      ],
      b.receipts.length
        ? b.receipts.map((r, n) => [
            String(n + 1),
            `${r.receiptNo ?? '-'}${r.status === 'bounced' ? ' (bounced)' : ''}`,
            r.mode.toUpperCase(),
            r.instrumentNo ?? '',
            dmy(r.receivedOn),
            rupees(r.amount),
            rupees(r.lateFee),
            rupees(r.bounceCharge),
            rupees(r.finalAmount),
          ])
        : [['', 'No fee received yet this session', '', '', '', '', '', '', '']],
      [0.05, 0.25, 0.1, 0.11, 0.1, 0.11, 0.08, 0.08, 0.12],
      [5, 6, 7, 8],
      ['', 'Total Paid Amount', '', '', '', '', '', '', rupees(b.summary.received)],
    );
    const advance = Number(b.summary.advance) > 0;
    table(
      [
        'Total Due',
        'Total Received',
        'Refund / Return',
        ...(advance ? ['Advance'] : []),
        'Balance Payable',
      ],
      [
        [
          rupees(b.summary.due),
          rupees(b.summary.received),
          rupees(b.summary.refund),
          ...(advance ? [rupees(b.summary.advance)] : []),
          rupees(b.summary.balance),
        ],
      ],
      advance ? [0.2, 0.2, 0.2, 0.2, 0.2] : [0.25, 0.25, 0.25, 0.25],
      advance ? [0, 1, 2, 3, 4] : [0, 1, 2, 3],
    );
    room(14);
    text(`In Words:- ${title(b.summary.balanceWords)} Only`, M, y, 9, bold);
    y -= 16;
    const notes = [
      'Payment can be made by Credit Card, Debit Card, Net Banking and UPI through the parent portal.',
      ...(Number(b.notes.bounceCharge) > 0
        ? [
            `A fine of Rs. ${rupees(b.notes.bounceCharge)} will be charged if a cheque is returned unpaid by the banker.`,
          ]
        : []),
      b.notes.lateFeeMode === 'daywise' && Number(b.notes.latePerDay ?? 0) > 0
        ? `If the fee is not paid by the last date, a late payment charge of Rs. ${rupees(b.notes.latePerDay ?? 0)} a day will be charged.`
        : 'If the fee is not paid by the last date, late fee is charged as per the school schedule.',
    ];
    for (const n of notes) {
      room(12);
      text(`- ${n}`, M, y, 8, regular, MUTED);
      y -= 12;
    }
  }
  return Buffer.from(await pdf.save());
}
