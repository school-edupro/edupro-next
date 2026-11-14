/**
 * The payslip as a PDF (PAYROLL_RUN_SPEC.md §8.2–8.4): the frozen payslip on the school's letterhead — identity,
 * days, earnings (a month's amount and this month's), deductions, net and in words — locked with the password the
 * payroll settings' pattern makes for the employee (AES-256, @cantoo/pdf-lib). Employer shares never print.
 */
import { randomBytes } from 'node:crypto';
import { PDFDocument as LockableDocument } from '@cantoo/pdf-lib';
import { decryptField, type PoolClient } from '@edupro/db';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { drawLetterhead, embedLogo, type LetterheadLogo } from '../../common/pdf/letterhead';
import type { Payslip } from './payroll-payslip';

/** the parts a payslip password is made of */
export const PASSWORD_TOKENS = [
  'EMPID',
  'NAME3',
  'NAME4',
  'PAN',
  'PAN4',
  'AADHAAR4',
  'DOB_DDMM',
  'DOB_DDMMYY',
  'DOB_DDMMYYYY',
  'DOB_YYYY',
  'DOJ_DDMM',
  'DOJ_DDMMYYYY',
] as const;

/** A pattern is valid when every {PART} is one of the parts (capitals exactly) and there is at least one. */
export function checkPattern(pattern: string): string | null {
  const parts = [...pattern.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
  if (!parts.length) return 'The password needs at least one part in braces, such as {EMPID}';
  const bad = parts.find((p) => !(PASSWORD_TOKENS as readonly string[]).includes(p));
  if (bad !== undefined)
    return `{${bad}} is not a part of the password (the parts are written in capitals: {EMPID}, {DOB_DDMMYYYY} …)`;
  if (/[{}]/.test(pattern.replace(/\{[A-Z0-9_]+\}/g, ''))) return 'A brace is not closed';
  return null;
}

/** How the password is made, in words, for the employee (never the value). */
export function patternInWords(pattern: string | null): string | null {
  if (!pattern) return null;
  const words: Record<string, string> = {
    EMPID: 'your employee code',
    NAME3: 'the first three letters of your name in capitals',
    NAME4: 'the first four letters of your name in capitals',
    PAN: 'your PAN in capitals',
    PAN4: 'the last four characters of your PAN',
    AADHAAR4: 'the last four digits of your Aadhaar',
    DOB_DDMM: 'your date of birth as DDMM',
    DOB_DDMMYY: 'your date of birth as DDMMYY',
    DOB_DDMMYYYY: 'your date of birth as DDMMYYYY',
    DOB_YYYY: 'your year of birth',
    DOJ_DDMM: 'your date of joining as DDMM',
    DOJ_DDMMYYYY: 'your date of joining as DDMMYYYY',
  };
  return pattern
    .split(/(\{[A-Z0-9_]+\})/)
    .filter(Boolean)
    .map((p) => (/^\{.+\}$/.test(p) ? (words[p.slice(1, -1)] ?? p) : `“${p}”`))
    .join(', then ');
}

/** The employee's password by the pattern; null when a part has no value (the file then goes out unlocked, noted). */
export async function passwordFor(
  c: PoolClient,
  employeeId: string,
  pattern: string | null,
): Promise<{ password: string | null; missing: string[] }> {
  if (!pattern) return { password: null, missing: [] };
  const e = (
    await c.query<{
      code: string;
      first: string;
      dob: string | null;
      joined: string | null;
      pan: string | null;
      aadhaar: string | null;
    }>(
      `SELECT employee_code AS code, first_name AS first, dob::text, joined_on::text AS joined, secure->>'pan' AS pan,
              secure->>'aadhaar' AS aadhaar FROM employees WHERE id = $1`,
      [employeeId],
    )
  ).rows[0];
  if (!e) return { password: null, missing: ['the employee'] };
  const plain = (v: string | null) => (v ? decryptField(v) : null);
  const pan = plain(e.pan)?.toUpperCase() ?? null;
  const aadhaar = plain(e.aadhaar)?.replace(/\D/g, '') ?? null;
  const name = e.first.replace(/[^A-Za-z]/g, '').toUpperCase();
  const d = (iso: string | null, f: (y: string, m: string, dd: string) => string) =>
    iso ? f(iso.slice(0, 4), iso.slice(5, 7), iso.slice(8, 10)) : null;
  const value: Record<string, string | null> = {
    EMPID: e.code,
    NAME3: name.length >= 3 ? name.slice(0, 3) : null,
    NAME4: name.length >= 4 ? name.slice(0, 4) : null,
    PAN: pan,
    PAN4: pan ? pan.slice(-4) : null,
    AADHAAR4: aadhaar && aadhaar.length >= 4 ? aadhaar.slice(-4) : null,
    DOB_DDMM: d(e.dob, (_y, m, dd) => `${dd}${m}`),
    DOB_DDMMYY: d(e.dob, (y, m, dd) => `${dd}${m}${y.slice(2)}`),
    DOB_DDMMYYYY: d(e.dob, (y, m, dd) => `${dd}${m}${y}`),
    DOB_YYYY: d(e.dob, (y) => y),
    DOJ_DDMM: d(e.joined, (_y, m, dd) => `${dd}${m}`),
    DOJ_DDMMYYYY: d(e.joined, (y, m, dd) => `${dd}${m}${y}`),
  };
  const missing: string[] = [];
  const password = pattern.replace(/\{([A-Z0-9_]+)\}/g, (_, k: string) => {
    const v = value[k];
    if (!v) missing.push(k);
    return v ?? '';
  });
  return missing.length ? { password: null, missing } : { password, missing: [] };
}

const INK = rgb(0.1, 0.1, 0.12);
const LINE = rgb(0.75, 0.77, 0.8);
const latin = (s: string) =>
  s
    .replace(/₹/g, 'Rs ')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const inr = (v: string) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthWords = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );

/** One payslip drawn on a page (the bulk "office copy" draws several into one document). */
async function drawSlip(doc: PDFDocument, slip: Payslip, logo: LetterheadLogo | null) {
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const margin = 40;
  const W = page.getWidth();
  const image = await embedLogo(doc, logo);
  let y = drawLetterhead(page, fonts, image, {
    school: slip.school?.name ?? '',
    address: slip.school?.address ?? null,
    title: `PAYSLIP - ${monthWords(slip.month).toUpperCase()}${slip.runType !== 'REGULAR' ? ` (${slip.runType})` : ''}`,
    details: slip.held ? 'PAYMENT HELD' : null,
    margin,
  });
  const text = (t: string, x: number, yy: number, f: PDFFont = fonts.regular, size = 9) =>
    page.drawText(latin(t), { x, y: yy, size, font: f, color: INK });
  const right = (t: string, x: number, yy: number, f: PDFFont = fonts.regular, size = 9) =>
    text(t, x - f.widthOfTextAtSize(latin(t), size), yy, f, size);
  const rule = (yy: number) =>
    page.drawLine({
      start: { x: margin, y: yy },
      end: { x: W - margin, y: yy },
      thickness: 0.6,
      color: LINE,
    });
  // identity in two columns
  const e = slip.employee;
  const left: Array<[string, string]> = [
    ['Employee code', e.code],
    ['Name', e.name],
    ['Designation', e.designation ?? ''],
    ['Department', e.department ?? ''],
    ['PAN', e.panMasked ?? ''],
    ['UAN', e.uan ?? ''],
  ];
  const rightCol: Array<[string, string]> = [
    ['PF number', e.pfNumber ?? ''],
    ['Level / cell', e.payLevel ?? ''],
    [
      'Paid by',
      e.payMode === 'BANK'
        ? `Bank ${[e.bankName, e.bankMasked].filter(Boolean).join(' ')}`
        : (e.payMode ?? ''),
    ],
    ['IFSC', e.bankIfsc ?? ''],
    ['Days in the month', slip.days.month],
    ['Paid days · loss of pay', `${slip.days.paid} · ${slip.days.lop}`],
  ];
  rule(y);
  y -= 14;
  for (let k = 0; k < Math.max(left.length, rightCol.length); k += 1) {
    const a = left[k];
    const b = rightCol[k];
    if (a) {
      text(a[0], margin, y, fonts.regular, 8.5);
      text(a[1], margin + 95, y, fonts.bold, 8.5);
    }
    if (b) {
      text(b[0], W / 2 + 5, y, fonts.regular, 8.5);
      text(b[1], W / 2 + 110, y, fonts.bold, 8.5);
    }
    y -= 13;
  }
  rule(y + 4);
  y -= 12;
  // earnings and deductions side by side
  const half = (W - 2 * margin) / 2;
  const lx = margin;
  const rx = margin + half + 10;
  text('Earnings', lx, y, fonts.bold, 10);
  right('A month', lx + half - 75, y, fonts.bold, 8.5);
  right('This month', lx + half - 5, y, fonts.bold, 8.5);
  text('Deductions', rx, y, fonts.bold, 10);
  right('Amount', W - margin, y, fonts.bold, 8.5);
  y -= 14;
  const rows = Math.max(slip.earnings.length, slip.deductions.length);
  for (let k = 0; k < rows; k += 1) {
    const a = slip.earnings[k];
    const b = slip.deductions[k];
    if (a) {
      text(
        `${a.name}${a.arrear && !/arrear/i.test(a.name) ? ' (arrear)' : ''}`.slice(0, 34),
        lx,
        y,
      );
      right(Number(a.rate) ? inr(a.rate) : '', lx + half - 75, y);
      right(inr(a.amount), lx + half - 5, y);
    }
    if (b) {
      text(b.name.slice(0, 34), rx, y);
      right(inr(b.amount), W - margin, y);
    }
    y -= 12;
  }
  rule(y + 4);
  y -= 10;
  text('Gross', lx, y, fonts.bold);
  right(inr(slip.totals.grossRate), lx + half - 75, y, fonts.bold);
  right(inr(slip.totals.gross), lx + half - 5, y, fonts.bold);
  text('Total deductions', rx, y, fonts.bold);
  right(inr(slip.totals.deductions), W - margin, y, fonts.bold);
  y -= 22;
  page.drawRectangle({
    x: margin,
    y: y - 6,
    width: W - 2 * margin,
    height: 22,
    color: rgb(0.94, 0.96, 0.98),
  });
  text('Net pay', margin + 8, y, fonts.bold, 11);
  right(`Rs ${inr(slip.totals.net)}`, W - margin - 8, y, fonts.bold, 11);
  y -= 22;
  text(slip.netInWords, margin, y, fonts.regular, 8.5);
  if (Number(slip.totals.lopAmount))
    text(
      `Loss of pay this month: Rs ${inr(slip.totals.lopAmount)}`,
      margin,
      y - 13,
      fonts.regular,
      8.5,
    );
  text(
    'This is a computer-generated payslip and needs no signature.',
    margin,
    40,
    fonts.regular,
    7.5,
  );
}

/** The payslip PDF, locked when a password is given. */
export async function payslipPdf(
  slip: Payslip,
  logo: LetterheadLogo | null,
  password: string | null,
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payslip ${slip.employee.code} ${slip.month}`);
  await drawSlip(doc, slip, logo);
  const bytes = await doc.save();
  if (!password) return Buffer.from(bytes);
  const lockable = await LockableDocument.load(bytes);
  lockable.encrypt({
    userPassword: password,
    // a random owner password: nobody can lift the restrictions with a guessable one
    ownerPassword: randomBytes(16).toString('hex'),
    permissions: { printing: 'highResolution', copying: false, modifying: false },
  });
  return Buffer.from(await lockable.save());
}

/** Several payslips in one unlocked document (the office copy). */
export async function payslipsPdf(slips: Payslip[], logo: LetterheadLogo | null): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle('Payslips');
  for (const s of slips) await drawSlip(doc, s, logo);
  return Buffer.from(await doc.save());
}
