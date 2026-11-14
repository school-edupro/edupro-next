/**
 * What a payslip prints (PAYROLL_RUN_SPEC.md §8.2), frozen on the record when its run is locked so a reprint is
 * identical (the legacy read the address, bank and PAN again at print time). Employer shares never print.
 */
import type { PoolClient } from '@edupro/db';
import { registerLetterhead } from '../exams/register-head';

export interface Payslip {
  version: 1;
  /** the letterhead as it was at the lock */
  school?: { name: string; address: string; logoFileId: string | null };
  month: string;
  runType: string;
  isTopUp: boolean;
  held: boolean;
  employee: {
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    panMasked: string | null;
    uan: string | null;
    pfNumber: string | null;
    esiNumber: string | null;
    payLevel: string | null;
    payMode: string | null;
    bankName: string | null;
    bankIfsc: string | null;
    bankMasked: string | null;
  };
  days: { month: string; paid: string; lop: string };
  earnings: Array<{ code: string; name: string; rate: string; amount: string; arrear: boolean }>;
  deductions: Array<{ code: string; name: string; amount: string }>;
  totals: { grossRate: string; gross: string; deductions: string; net: string; lopAmount: string };
  netInWords: string;
  frozenAt: string;
}

const sum = (xs: string[]) =>
  (xs.reduce((n, x) => n + Math.round(Number(x) * 100), 0) / 100).toFixed(2);

export async function buildPayslip(c: PoolClient, recordId: string): Promise<Payslip> {
  const r = (
    await c.query<{
      month: string;
      run_type: string;
      is_top_up: boolean;
      status: string;
      employee_code: string;
      employee_name: string;
      designation: string | null;
      department: string | null;
      pan_masked: string | null;
      uan: string | null;
      pf_number: string | null;
      esi_number: string | null;
      pay_level: string | null;
      pay_mode: string | null;
      bank_name: string | null;
      bank_ifsc: string | null;
      bank_account_masked: string | null;
      month_days: string;
      paid_days: string;
      lop_days: string;
      gross_earned: string;
      total_deductions: string;
      net_pay: string;
      lop_amount: string;
      net_in_words: string | null;
      arrear_display: string | null;
    }>(
      `SELECT to_char(r.month, 'YYYY-MM') AS month, u.run_type, r.is_top_up, r.status, r.employee_code, r.employee_name, r.designation,
              r.department, r.pan_masked, r.uan, r.pf_number, r.esi_number, r.pay_level, r.pay_mode, r.bank_name, r.bank_ifsc,
              r.bank_account_masked, r.month_days::text, r.paid_days::text, r.lop_days::text, r.gross_earned::text,
              r.total_deductions::text, r.net_pay::text, r.lop_amount::text, r.net_in_words,
              (SELECT arrear_display FROM payroll_settings) AS arrear_display
         FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id WHERE r.id = $1`,
      [recordId],
    )
  ).rows[0]!;
  const lines = (
    await c.query<{
      code: string;
      name: string;
      head_type: string;
      rate: string;
      amount: string;
      is_arrear: boolean;
      show: boolean;
    }>(
      `SELECT code, name, head_type, rate::text, amount::text, is_arrear, show_if_zero AS show FROM payroll_record_lines
        WHERE record_id = $1 ORDER BY print_order, calc_order`,
      [recordId],
    )
  ).rows.filter((l) => l.show || Number(l.rate) !== 0 || Number(l.amount) !== 0);
  let earnings = lines
    .filter((l) => l.head_type === 'EARNING')
    .map((l) => ({
      code: l.code,
      name: l.name,
      rate: l.rate,
      amount: l.amount,
      arrear: l.is_arrear,
    }));
  if (r.arrear_display === 'combined') {
    const arrears = earnings.filter((l) => l.arrear);
    if (arrears.length)
      earnings = [
        ...earnings.filter((l) => !l.arrear),
        {
          code: 'ARREARS',
          name: 'Arrears',
          rate: '0.00',
          amount: sum(arrears.map((a) => a.amount)),
          arrear: true,
        },
      ];
  }
  const head = await registerLetterhead(c);
  const logo = (
    await c.query<{ id: string | null }>(
      `SELECT NULLIF(branding->>'logoFileId', '') AS id FROM schools WHERE id = app.current_school_id()`,
    )
  ).rows[0]?.id;
  return {
    version: 1,
    school: {
      name: head.school,
      address: head.address,
      logoFileId: logo && /^\d{1,18}$/.test(logo) ? logo : null,
    },
    month: r.month,
    runType: r.run_type,
    isTopUp: r.is_top_up,
    held: r.status === 'HELD',
    employee: {
      code: r.employee_code,
      name: r.employee_name,
      designation: r.designation,
      department: r.department,
      panMasked: r.pan_masked,
      uan: r.uan,
      pfNumber: r.pf_number,
      esiNumber: r.esi_number,
      payLevel: r.pay_level,
      payMode: r.pay_mode,
      bankName: r.bank_name,
      bankIfsc: r.bank_ifsc,
      bankMasked: r.bank_account_masked,
    },
    days: { month: r.month_days, paid: r.paid_days, lop: r.lop_days },
    earnings,
    deductions: lines
      .filter((l) => l.head_type === 'DEDUCTION')
      .map((l) => ({ code: l.code, name: l.name, amount: l.amount })),
    totals: {
      grossRate: sum(earnings.map((l) => l.rate)),
      gross: r.gross_earned,
      deductions: r.total_deductions,
      net: r.net_pay,
      lopAmount: r.lop_amount,
    },
    netInWords: r.net_in_words ?? '',
    frozenAt: new Date().toISOString(),
  };
}
