import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/** What FeeDocumentsService.receiptView returns: the receipt as it prints. */
export interface ReceiptPaper {
  school: { name: string; address: string };
  student: {
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
    /** a staff member paying a misc fee (0216) */
    kind?: 'student' | 'employee';
  };
  year: string;
  receiptNo: string | null;
  receivedOn: string;
  amount: string;
  amountWords: string;
  lateFee: string;
  advance: string;
  refunded: string;
  status: string;
  mode: string;
  modeKind: string;
  feeType: string;
  reference: string | null;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  remarks: string | null;
  receivedBy: string | null;
  depositAccount: string | null;
  lines: Array<{ head: string; period: string | null; amount: string }>;
}

const W = 595.28; // A4 portrait
const H = 841.89;
const M = 48;
const NAVY = rgb(0, 0.149, 0.365);
const INK = rgb(0.043, 0.122, 0.227);
const MUTED = rgb(0.357, 0.4, 0.463);
const LINE = rgb(0.86, 0.88, 0.92);
const RED = rgb(0.7, 0.1, 0.1);

/** The built-in PDF fonts carry Latin letters only: anything else prints as "?" rather than failing. */
const latin = (s: string | null | undefined) =>
  (s ?? '').replace(/[‐-―]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const rupees = (v: string | number) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};
const fit = (font: PDFFont, text: string | null, size: number, width: number): string => {
  let out = latin(text);
  if (font.widthOfTextAtSize(out, size) <= width) return out;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > width)
    out = out.slice(0, -1);
  return `${out}...`;
};

/**
 * The fee receipt as a PDF, made at once (no worker): the same content and order as the printed
 * receipt page, one A4 page per copy ("School copy", "Parent copy").
 */
export async function receiptPdf(
  r: ReceiptPaper,
  copies: string[],
  /** Another paper in the same layout (the refund voucher): its own words. */
  paper: {
    title: string;
    numberLabel: string;
    totalLabel: string;
    paidLine: string;
    signLeft: string;
    signRight: string;
  } = {
    title: 'Fee receipt',
    numberLabel: 'Receipt no.',
    totalLabel: 'Total received',
    paidLine: 'Paid by',
    signLeft: 'Received by',
    signRight: "Cashier's signature",
  },
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${paper.title} ${r.receiptNo ?? ''}`.trim());
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cancelled = r.status === 'reversed' || r.status === 'bounced';

  for (const label of copies) {
    let page: PDFPage = pdf.addPage([W, H]);
    let y = H - M;
    const centre = (text: string, font: PDFFont, size: number, color = INK) => {
      const t = fit(font, text, size, W - 2 * M);
      page.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
      y -= size + 6;
    };
    const rule = () => {
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: LINE });
      y -= 12;
    };
    const room = (need: number) => {
      if (y - need > M) return;
      page = pdf.addPage([W, H]);
      y = H - M;
    };

    centre(r.school.name, bold, 16, NAVY);
    if (r.school.address) centre(r.school.address, regular, 9, MUTED);
    y -= 2;
    centre(label ? `${paper.title} - ${label}` : paper.title, bold, 11);
    if (cancelled) centre(r.status === 'bounced' ? 'CHEQUE BOUNCED' : 'CANCELLED', bold, 11, RED);
    rule();

    // two columns of facts, as on the printed page
    const facts: Array<[string, string]> = [
      [paper.numberLabel, r.receiptNo ?? '-'],
      ['Date', dmy(r.receivedOn)],
      ...((r.student.kind === 'employee'
        ? [
            ['Staff member', r.student.name],
            ['Employee code', r.student.admissionNo],
            ['Designation', r.student.section ?? '-'],
          ]
        : [
            ['Student', r.student.name],
            ['Admission no.', r.student.admissionNo],
            ['Class', r.student.section ?? '-'],
            ['Father / guardian', r.student.guardian ?? '-'],
          ]) as Array<[string, string]>),
      ['Session', r.year],
      ['Fee type', r.feeType === 'hostel' ? 'Hostel' : 'Regular'],
    ];
    const half = (W - 2 * M) / 2;
    for (let i = 0; i < facts.length; i += 2) {
      for (const [k, pair] of [facts[i], facts[i + 1]].entries()) {
        if (!pair) continue;
        const x = M + k * half;
        const key = `${pair[0]}: `;
        page.drawText(key, { x, y, size: 10, font: regular, color: MUTED });
        const kx = regular.widthOfTextAtSize(key, 10);
        page.drawText(fit(bold, pair[1], 10, half - kx - 8), {
          x: x + kx,
          y,
          size: 10,
          font: bold,
          color: INK,
        });
      }
      y -= 17;
    }
    y -= 4;

    // what the receipt paid
    const cols = [M, M + (W - 2 * M) * 0.5, W - M];
    const header = () => {
      page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: NAVY });
      const white = rgb(1, 1, 1);
      page.drawText('Particulars', { x: cols[0]! + 6, y, size: 9.5, font: bold, color: white });
      page.drawText('Period', { x: cols[1]! + 6, y, size: 9.5, font: bold, color: white });
      const a = 'Amount (Rs.)';
      page.drawText(a, {
        x: cols[2]! - 6 - bold.widthOfTextAtSize(a, 9.5),
        y,
        size: 9.5,
        font: bold,
        color: white,
      });
      y -= 22;
    };
    const row = (head: string, period: string | null, amount: string, font: PDFFont = regular) => {
      room(40);
      page.drawText(fit(font, head, 10, cols[1]! - cols[0]! - 12), {
        x: cols[0]! + 6,
        y,
        size: 10,
        font,
        color: INK,
      });
      page.drawText(fit(font, period, 10, cols[2]! - cols[1]! - 90), {
        x: cols[1]! + 6,
        y,
        size: 10,
        font,
        color: INK,
      });
      const a = rupees(amount);
      page.drawText(a, {
        x: cols[2]! - 6 - font.widthOfTextAtSize(a, 10),
        y,
        size: 10,
        font,
        color: INK,
      });
      y -= 6;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: LINE });
      y -= 13;
    };
    header();
    for (const l of r.lines) row(l.head, l.period, l.amount);
    if (Number(r.lateFee) > 0) row('Late fee', '', r.lateFee);
    if (Number(r.advance) > 0) row('Advance (kept for the next dues)', '', r.advance);
    row(paper.totalLabel, '', r.amount, bold);
    y -= 4;

    const para = (text: string, font: PDFFont = regular, color = INK) => {
      room(30);
      page.drawText(fit(font, text, 10, W - 2 * M), { x: M, y, size: 10, font, color });
      y -= 16;
    };
    para(`Rupees ${r.amountWords} only.`, bold);
    para(
      `${paper.paidLine} ${r.mode}` +
        (r.instrumentNo ? ` no. ${r.instrumentNo}` : '') +
        (r.instrumentDate ? ` dated ${dmy(r.instrumentDate)}` : '') +
        (r.bankName ? `, ${r.bankName}` : '') +
        (r.reference ? ` - Ref. ${r.reference}` : '') +
        (r.depositAccount ? ` - Into ${r.depositAccount}` : ''),
    );
    if (r.modeKind === 'cheque' || r.modeKind === 'dd')
      para('Subject to realisation of the cheque / draft.', regular, MUTED);
    if (Number(r.refunded) > 0) para(`Refunded since: Rs. ${rupees(r.refunded)}`);
    if (r.remarks) para(`Remarks: ${r.remarks}`);

    room(70);
    y -= 36;
    page.drawText(fit(regular, `${paper.signLeft}: ${r.receivedBy ?? ''}`, 10, half), {
      x: M,
      y,
      size: 10,
      font: regular,
      color: INK,
    });
    const sign = paper.signRight;
    page.drawText(sign, {
      x: W - M - regular.widthOfTextAtSize(sign, 10),
      y,
      size: 10,
      font: regular,
      color: INK,
    });
  }
  return Buffer.from(await pdf.save());
}
