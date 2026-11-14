import { z } from 'zod';

/**
 * Bank files (docs/design/86, phase C step 1; PAYROLL_PAYMENT_SPEC.md §2.11): the generic CSV, a custom column layout
 * per bank account (set from that bank's sample file), and the data of the bank letter. Pure: the service reads the
 * batch, its lines and the accounts; nothing here touches the database.
 */

/** The bank of an IFSC: its first four letters (ABCD0001234 → ABCD); no bank when shorter. */
export function bankCode(ifsc: string | null | undefined): string | null {
  const s = (ifsc ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{4}/.test(s) ? s.slice(0, 4) : null;
}

export const LAYOUT_FIELDS = [
  'name',
  'empid',
  'account',
  'ifsc',
  'amount',
  'narration',
  'date',
  'debit_account',
  'line_no',
] as const;
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DDMMYYYY'] as const;
export const AMOUNT_FORMATS = ['0.00', '0'] as const;
export const DELIMITERS = { ',': ',', '|': '|', ';': ';', '^': '^', TAB: '\t' } as const;

export const LayoutColumnSchema = z
  .object({
    field: z.enum(LAYOUT_FIELDS).optional(),
    value: z.string().max(60).optional(),
    header: z.string().trim().max(60).optional(),
    format: z.enum([...DATE_FORMATS, ...AMOUNT_FORMATS]).optional(),
  })
  .superRefine((col, ctx) => {
    if (!col.field && col.value === undefined)
      ctx.addIssue({ code: 'custom', message: 'A column needs a field or a fixed value' });
    if (
      col.format &&
      col.field === 'date' &&
      !(DATE_FORMATS as readonly string[]).includes(col.format)
    )
      ctx.addIssue({ code: 'custom', message: 'A date column takes a date format' });
    if (
      col.format &&
      col.field === 'amount' &&
      !(AMOUNT_FORMATS as readonly string[]).includes(col.format)
    )
      ctx.addIssue({ code: 'custom', message: 'An amount column takes 0.00 or 0' });
    if (col.format && col.field !== 'date' && col.field !== 'amount')
      ctx.addIssue({ code: 'custom', message: 'Only a date or an amount column has a format' });
  });
export const LayoutSchema = z.object({
  columns: z.array(LayoutColumnSchema).min(1).max(40),
  header: z.boolean().default(false),
  delimiter: z.enum(Object.keys(DELIMITERS) as [keyof typeof DELIMITERS]).default(','),
  extension: z.enum(['csv', 'txt']).default('csv'),
});
export type Layout = z.infer<typeof LayoutSchema>;

/** One payment as the bank file carries it (the account in clear, only while the file is made). */
export interface BankLine {
  lineNo: number;
  code: string;
  name: string;
  account: string;
  ifsc: string | null;
  /** rupees, two places */
  amount: string;
}
export interface BankFileMeta {
  /** the pay month, YYYY-MM */
  month: string;
  /** the value date, else the day the batch was made (never today: a re-download is identical) */
  date: string;
  debitAccount: string | null;
}

const words = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

/**
 * The generic file: no header; Name, Account, IFSC, Amount, Narration; commas in a name become spaces (a bank
 * reads it by position); LF between lines, none after the last.
 */
export function genericCsv(lines: BankLine[], meta: BankFileMeta): string {
  return lines
    .map((l) =>
      [
        words(l.name).replace(/,/g, ' ').replace(/\s+/g, ' '),
        l.account,
        l.ifsc ?? '',
        l.amount,
        `SALARY ${meta.month}`,
      ].join(','),
    )
    .join('\n');
}

function dateAs(iso: string, format: string | undefined): string {
  const [y, m, d] = iso.split('-');
  switch (format) {
    case 'DD/MM/YYYY':
      return `${d}/${m}/${y}`;
    case 'DD-MM-YYYY':
      return `${d}-${m}-${y}`;
    case 'DDMMYYYY':
      return `${d}${m}${y}`;
    default:
      return iso;
  }
}

/** A bank's own layout: its columns in its order, fixed values, an optional header, its separator. */
export function customCsv(lines: BankLine[], meta: BankFileMeta, layout: Layout): string {
  const sep = DELIMITERS[layout.delimiter];
  const cell = (v: string) => {
    const s = words(v);
    return s.includes(sep) || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const value = (col: Layout['columns'][number], l: BankLine): string => {
    switch (col.field) {
      case 'name':
        return l.name;
      case 'empid':
        return l.code;
      case 'account':
        return l.account;
      case 'ifsc':
        return l.ifsc ?? '';
      case 'amount':
        return col.format === '0' ? String(Math.round(Number(l.amount))) : l.amount;
      case 'narration':
        return `SALARY ${meta.month}`;
      case 'date':
        return dateAs(meta.date, col.format);
      case 'debit_account':
        return meta.debitAccount ?? '';
      case 'line_no':
        return String(l.lineNo);
      default:
        return col.value ?? '';
    }
  };
  const out: string[] = [];
  if (layout.header) out.push(layout.columns.map((c) => cell(c.header ?? c.field ?? '')).join(sep));
  for (const l of lines) out.push(layout.columns.map((c) => cell(value(c, l))).join(sep));
  return out.join('\n');
}

/** The month as the bank letter writes it: "July '2026". */
export function letterMonth(month: string): string {
  const name = new Intl.DateTimeFormat('en-IN', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  return `${name} '${month.slice(0, 4)}`;
}

/** Rupees as the letter writes them: whole when there are no paise. */
export function letterAmount(v: string): string {
  return v.endsWith('.00') ? v.slice(0, -3) : v;
}
