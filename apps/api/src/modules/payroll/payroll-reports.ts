import type { PoolClient } from '@edupro/db';
import { addMonths, firstOf, monthWords } from './payroll-month';
import {
  type Grid,
  type GridCol,
  type GridRow,
  paise,
  rupees,
  subtotalsBy,
  totalOf,
} from './payroll-report-grid';

/**
 * The payroll report catalogue (docs/design/86, phase F; PAYROLL_REPORTS_SPEC.md §2–3, reshaped): one line per employee
 * (a month's regular record and its top-ups together), the details as stored when paid, held salaries apart, the same
 * filters for the screen and every download, PROVISIONAL while a run of the period is approved but not locked.
 */
export interface ReportParams {
  month?: string;
  fy?: string;
  asOf?: string;
  runId?: string;
  department?: string;
  staffType?: string;
  employeeId?: string;
  view?: string;
  columns?: string[];
  groupBy?: string;
  threshold?: string;
}
export type Filter = 'run' | 'department' | 'staffType' | 'employee';
export interface ReportDef {
  key: string;
  label: string;
  group: string;
  period: 'month' | 'fy' | 'asof' | 'none';
  /** a checker's (or the payroll admin's, or the auditor's) */
  checker?: boolean;
  filters: Filter[];
  /** the register's built-in views */
  views?: Array<{ key: string; label: string }>;
  note: string;
}

export const STAFF_TYPES: Record<string, string> = {
  teaching: 'Teaching',
  non_teaching: 'Non-teaching',
  contract: 'Contract',
  visiting: 'Visiting',
};
const typeName = (t: string) => STAFF_TYPES[t] ?? (t ? t : 'Type not set');

export const REGISTER_VIEWS = [
  { key: 'full', label: 'Every head' },
  { key: 'summary', label: 'Gross, deductions and net' },
  { key: 'allowances', label: 'Basic and allowances' },
  { key: 'earnings', label: 'Earnings' },
  { key: 'deductions', label: 'Deductions' },
  { key: 'arrears', label: 'Arrears' },
  { key: 'overtime', label: 'Overtime' },
  { key: 'bonus', label: 'Bonus and ex-gratia' },
  { key: 'pf', label: 'PF and VPF' },
  { key: 'esi', label: 'ESI' },
  { key: 'pt', label: 'Profession tax' },
  { key: 'tds', label: 'Income tax (TDS)' },
  { key: 'lwf', label: 'Labour welfare fund' },
  { key: 'loans', label: 'Loan recovery' },
  { key: 'other', label: 'Other deductions' },
  { key: 'net', label: 'Net pay and payment' },
  { key: 'lop', label: 'Loss of pay' },
] as const;

export const CATALOGUE: ReportDef[] = [
  // ---- salary registers
  {
    key: 'register',
    label: 'Salary register',
    group: 'Salary registers',
    period: 'month',
    filters: ['run', 'department', 'staffType', 'employee'],
    views: [...REGISTER_VIEWS],
    note: 'One line per employee: the month’s regular pay and any additional run together. Choose a view or your own columns.',
  },
  {
    key: 'group',
    label: 'Department, designation or staff-group summary',
    group: 'Salary registers',
    period: 'month',
    filters: ['run', 'staffType'],
    note: 'The month’s pay added up by department, designation, staff type or category: staff, each head, gross, deductions, net.',
  },
  {
    key: 'heads',
    label: 'Head-wise summary',
    group: 'Salary registers',
    period: 'month',
    filters: ['run', 'department', 'staffType'],
    note: 'Each pay head of the month: how many staff and how much, earnings then deductions.',
  },
  {
    key: 'ytd',
    label: 'Year to date',
    group: 'Salary registers',
    period: 'fy',
    filters: ['department', 'staffType', 'employee'],
    note: 'Each employee’s year: months paid, gross, PF, ESI, profession tax, income tax, other deductions and net.',
  },
  // ---- analysis
  {
    key: 'attendance',
    label: 'Attendance and salary',
    group: 'Analysis',
    period: 'month',
    filters: ['department', 'staffType', 'employee'],
    note: 'The month’s days as paid (present, paid leave, loss of pay, overtime hours) beside the pay.',
  },
  {
    key: 'arrears',
    label: 'Arrears paid',
    group: 'Analysis',
    period: 'month',
    filters: ['run', 'department', 'employee'],
    note: 'Arrears paid in the month: the month they belong to, the head and why (a revision, loss of pay given back, other).',
  },
  {
    key: 'ctc',
    label: 'Cost to school',
    group: 'Analysis',
    period: 'month',
    checker: true,
    filters: ['run', 'department', 'staffType', 'employee'],
    note: 'Gross pay and what the school pays on top: PF (EPF, EPS, EDLI, admin charges), ESI, NPS and LWF.',
  },
  {
    key: 'variance',
    label: 'Month-on-month variance',
    group: 'Analysis',
    period: 'month',
    filters: ['department', 'staffType', 'employee'],
    note: 'Each head of each employee against the month before; only the changes (at least the amount given).',
  },
  {
    key: 'headcount',
    label: 'Headcount reconciliation',
    group: 'Analysis',
    period: 'month',
    filters: ['department', 'staffType'],
    note: 'Who was paid last month and this month: new (joined, back from a hold) and not paid now (left, held, skipped).',
  },
  // ---- statutory and annual
  {
    key: 'tds',
    label: 'Income tax (TDS) register',
    group: 'Statutory and annual',
    period: 'month',
    filters: ['department', 'staffType', 'employee'],
    note: 'Income tax deducted in the month, with the regime and the PAN (masked).',
  },
  {
    key: 'pf',
    label: 'PF register',
    group: 'Statutory and annual',
    period: 'month',
    filters: [],
    note: 'Every member of the month: wages, the employee’s and the employer’s shares, NCP days, the challan.',
  },
  {
    key: 'esi',
    label: 'ESI contribution statement',
    group: 'Statutory and annual',
    period: 'month',
    filters: [],
    note: 'The covered staff of the month: days, wages, the employee’s and the employer’s shares.',
  },
  {
    key: 'pt',
    label: 'Profession tax register',
    group: 'Statutory and annual',
    period: 'month',
    filters: [],
    note: 'Profession tax by slab and by employee.',
  },
  {
    key: 'lwf',
    label: 'Labour welfare fund register',
    group: 'Statutory and annual',
    period: 'month',
    filters: [],
    note: 'The labour welfare fund of the month by employee.',
  },
  {
    key: 'nps',
    label: 'NPS register',
    group: 'Statutory and annual',
    period: 'month',
    filters: ['department', 'staffType', 'employee'],
    note: 'NPS wages and the employee’s and the employer’s contributions.',
  },
  {
    key: 'esi_coverage',
    label: 'ESI coverage',
    group: 'Statutory and annual',
    period: 'none',
    filters: ['employee'],
    note: 'Each ESI contribution period of each employee: covered or not, and the wage it started on.',
  },
  {
    key: 'gratuity',
    label: 'Gratuity liability',
    group: 'Statutory and annual',
    period: 'asof',
    filters: ['department', 'staffType'],
    note: 'What gratuity would be if every employee left on the day: the years, the wage, the liability. The accounts’ figure is the actuary’s.',
  },
  {
    key: 'bonus',
    label: 'Bonus register',
    group: 'Statutory and annual',
    period: 'fy',
    filters: ['department', 'staffType'],
    note: 'The year’s bonus by the school’s own rule (set for the year), one line per employee; a checker posts it to a bonus run.',
  },
  // ---- payments
  {
    key: 'bank',
    label: 'Bank-wise payments',
    group: 'Payments',
    period: 'month',
    checker: true,
    filters: ['run', 'department', 'employee'],
    note: 'Net pay by bank and mode, each employee’s account (masked), the bank file and its UTR.',
  },
  {
    key: 'loans',
    label: 'Loans outstanding',
    group: 'Payments',
    period: 'none',
    filters: ['department', 'employee'],
    note: 'Every loan still owed: the amount, the instalment, recovered so far, the balance and when it ends.',
  },
  {
    key: 'third_party',
    label: 'Third-party payout',
    group: 'Payments',
    period: 'month',
    checker: true,
    filters: ['run'],
    note: 'What the month’s runs deducted for each payee (insurance, society, club …), and from whom.',
  },
];

// ---- the records a report reads --------------------------------------------------------------------------------------
export interface Scope {
  from: string;
  to: string;
  runId: string | null;
  hidden: string[];
  department: string | null;
  staffType: string | null;
  employeeId: string | null;
}
/** $1 from, $2 to, $3 run, $4 hidden staff, $5 department, $6 staff type, $7 employee — the next argument is $8 */
export const RECS = `
  recs AS (
    SELECT r.*, u.run_type, u.stage AS run_stage
      FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
     WHERE u.stage IN ('APPROVED', 'LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
       AND r.month BETWEEN $1::date AND $2::date
       AND ($3::bigint IS NULL OR u.id = $3)
       AND NOT (r.employee_id::text = ANY($4::text[]))
       AND ($5::text IS NULL OR r.department = $5)
       AND ($6::text IS NULL OR r.staff_type = $6)
       AND ($7::bigint IS NULL OR r.employee_id = $7)),
  people AS (
    SELECT DISTINCT ON (employee_id) employee_id, employee_code AS code, employee_name AS name, designation, department,
           staff_type, pay_level, pay_cell, category, pay_mode, bank_name, bank_ifsc, bank_account_masked, pan_masked, uan,
           tax_regime
      FROM recs ORDER BY employee_id, is_top_up, month DESC, id DESC)`;
export const argsOf = (s: Scope) => [
  s.from,
  s.to,
  s.runId,
  s.hidden,
  s.department,
  s.staffType,
  s.employeeId,
];

const identity: GridCol[] = [
  { key: 'code', label: 'Emp. ID', kind: 'text', width: 0.07 },
  { key: 'name', label: 'Employee', kind: 'text', width: 0.15 },
  { key: 'designation', label: 'Designation', kind: 'text', width: 0.1 },
];
const money = (key: string, label: string): GridCol => ({ key, label, kind: 'money' });
const num = (key: string, label: string): GridCol => ({ key, label, kind: 'number', width: 0.05 });

export function scopeLine(
  p: ReportParams,
  names: { department?: string; staffType?: string; employee?: string; run?: string },
) {
  const bits = [
    names.run ? `Run: ${names.run}` : null,
    p.department ? `Department: ${p.department}` : null,
    p.staffType ? `Staff type: ${typeName(p.staffType)}` : null,
    names.employee ? `Employee: ${names.employee}` : null,
  ].filter(Boolean);
  return bits.length ? [`Only ${bits.join(' · ')}`] : [];
}

/** The window of a period, and its words. */
export function windowOf(
  def: ReportDef,
  p: ReportParams,
): { from: string; to: string; words: string } {
  if (def.period === 'fy') {
    const y = Number(p.fy!.slice(0, 4));
    return { from: `${String(y)}-04-01`, to: `${String(y + 1)}-03-01`, words: `FY ${p.fy!}` };
  }
  if (def.period === 'month')
    return { from: firstOf(p.month!), to: firstOf(p.month!), words: monthWords(p.month!) };
  if (def.period === 'asof') {
    const d = p.asOf!;
    return { from: d, to: d, words: `As of ${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` };
  }
  return { from: '1900-01-01', to: '2999-12-01', words: 'All periods' };
}

/** PROVISIONAL while a run of the window is approved but not locked. */
export async function provisionalIn(
  c: PoolClient,
  from: string,
  to: string,
): Promise<string | null> {
  const runs = (
    await c.query<{ id: string; month: string; run_type: string; seq: number }>(
      `SELECT id::text, to_char(month, 'YYYY-MM') AS month, run_type, seq FROM payroll_runs
        WHERE stage = 'APPROVED' AND deleted_at IS NULL AND month BETWEEN $1::date AND $2::date ORDER BY month, run_type, seq`,
      [from, to],
    )
  ).rows;
  if (!runs.length) return null;
  return `PROVISIONAL — ${runs
    .map((r) => `${monthWords(r.month)} ${r.run_type.toLowerCase()} run ${String(r.seq)}`)
    .join(
      ', ',
    )} ${runs.length > 1 ? 'are' : 'is'} approved but not locked: these figures can still change.`;
}

// ---- the salary register --------------------------------------------------------------------------------------------
interface HeadInfo {
  code: string;
  name: string;
  head_type: 'EARNING' | 'DEDUCTION';
  category: string | null;
}
const FIXED_COLS: Record<string, GridCol> = {
  code: identity[0]!,
  name: identity[1]!,
  designation: identity[2]!,
  department: { key: 'department', label: 'Department', kind: 'text', width: 0.1 },
  staff_type: { key: 'staff_type', label: 'Staff type', kind: 'text', width: 0.08 },
  level: { key: 'level', label: 'Level', kind: 'text', width: 0.04 },
  cell: { key: 'cell', label: 'Cell', kind: 'text', width: 0.04 },
  category: { key: 'category', label: 'Category', kind: 'text', width: 0.08 },
  mode: { key: 'mode', label: 'Mode', kind: 'text', width: 0.05 },
  bank: { key: 'bank', label: 'Bank', kind: 'text', width: 0.1 },
  ifsc: { key: 'ifsc', label: 'IFSC', kind: 'text', width: 0.08 },
  account: { key: 'account', label: 'Account', kind: 'text', width: 0.09 },
  pan: { key: 'pan', label: 'PAN', kind: 'text', width: 0.08 },
  uan: { key: 'uan', label: 'UAN', kind: 'text', width: 0.09 },
  month_days: num('month_days', 'Month days'),
  paid_days: num('paid_days', 'Days paid'),
  lop_days: num('lop_days', 'LOP days'),
  lop_amount: money('lop_amount', 'LOP amount'),
  gross: money('gross', 'Gross'),
  deductions: money('deductions', 'Deductions'),
  net: money('net', 'Net'),
  pf_wage: money('pf_wage', 'PF wage'),
  er_epf: money('er_epf', 'Employer EPF'),
  er_eps: money('er_eps', 'Employer EPS'),
  esi_wage: money('esi_wage', 'ESI wage'),
  esi_er: money('esi_er', 'Employer ESI'),
  status: { key: 'status', label: 'Paid', kind: 'text', width: 0.06 },
};
const BEFORE_HEADS = [
  'code',
  'name',
  'designation',
  'department',
  'staff_type',
  'level',
  'cell',
  'category',
  'mode',
  'bank',
  'ifsc',
  'account',
  'pan',
  'uan',
  'month_days',
  'paid_days',
  'lop_days',
  'lop_amount',
];
const AFTER_HEADS = [
  'gross',
  'deductions',
  'net',
  'pf_wage',
  'er_epf',
  'er_eps',
  'esi_wage',
  'esi_er',
  'status',
];

/** Every column the register can show, in order: the details, each head paid in the month, the totals. */
export function registerColumns(heads: HeadInfo[]): GridCol[] {
  return [
    ...BEFORE_HEADS.map((k) => FIXED_COLS[k]!),
    ...heads.map((h) =>
      money(`h:${h.code}`, h.head_type === 'DEDUCTION' ? `${h.name} (ded.)` : h.name),
    ),
    ...AFTER_HEADS.map((k) => FIXED_COLS[k]!),
  ];
}

const VIEW_HEADS: Record<string, (h: HeadInfo) => boolean> = {
  full: () => true,
  summary: () => false,
  allowances: (h) =>
    h.head_type === 'EARNING' && ['BASIC', 'DA', 'HRA', 'ALLOWANCE'].includes(h.category ?? ''),
  earnings: (h) => h.head_type === 'EARNING',
  deductions: (h) => h.head_type === 'DEDUCTION',
  arrears: (h) => h.category === 'ARREAR',
  overtime: (h) => /^OT/.test(h.code),
  bonus: (h) => h.category === 'BONUS',
  pf: (h) => ['PF', 'VPF'].includes(h.code),
  esi: (h) => h.code === 'ESI',
  pt: (h) => h.code === 'PT',
  tds: (h) => h.code === 'TDS',
  lwf: (h) => h.code === 'LWF',
  loans: (h) => h.category === 'LOAN',
  other: (h) => h.head_type === 'DEDUCTION' && !['STATUTORY', 'LOAN'].includes(h.category ?? ''),
  net: () => false,
  lop: () => false,
};
const VIEW_FIXED: Record<string, string[]> = {
  full: ['code', 'name', 'designation', 'paid_days', 'gross', 'deductions', 'net', 'status'],
  summary: [
    'code',
    'name',
    'designation',
    'department',
    'paid_days',
    'gross',
    'deductions',
    'net',
    'status',
  ],
  allowances: ['code', 'name', 'designation', 'paid_days', 'gross'],
  earnings: ['code', 'name', 'designation', 'paid_days', 'gross'],
  deductions: ['code', 'name', 'designation', 'deductions'],
  arrears: ['code', 'name', 'designation'],
  overtime: ['code', 'name', 'designation', 'paid_days'],
  bonus: ['code', 'name', 'designation'],
  pf: ['code', 'name', 'uan', 'pf_wage', 'er_epf', 'er_eps'],
  esi: ['code', 'name', 'esi_wage', 'esi_er'],
  pt: ['code', 'name', 'gross'],
  tds: ['code', 'name', 'pan'],
  lwf: ['code', 'name'],
  loans: ['code', 'name', 'designation'],
  other: ['code', 'name', 'designation'],
  net: [
    'code',
    'name',
    'designation',
    'mode',
    'bank',
    'account',
    'gross',
    'deductions',
    'net',
    'status',
  ],
  lop: [
    'code',
    'name',
    'designation',
    'month_days',
    'paid_days',
    'lop_days',
    'lop_amount',
    'gross',
    'net',
  ],
};
/** a view's columns: its fixed ones and its heads, in the register's order */
export function viewColumns(
  view: string,
  heads: HeadInfo[],
): { keys: string[]; headOnly: boolean } {
  const pick = VIEW_HEADS[view] ?? VIEW_HEADS.full!;
  const fixed = new Set(VIEW_FIXED[view] ?? VIEW_FIXED.full!);
  const all = registerColumns(heads).map((c) => c.key);
  const chosen = heads.filter(pick).map((h) => `h:${h.code}`);
  return {
    keys: all.filter((k) => fixed.has(k) || chosen.includes(k)),
    // a view about some heads lists only the staff paid or charged on them
    headOnly: !['full', 'summary', 'earnings', 'deductions', 'net', 'lop'].includes(view),
  };
}

export async function registerData(c: PoolClient, s: Scope) {
  const args = argsOf(s);
  const heads = (
    await c.query<HeadInfo>(
      // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
      `WITH ${RECS}
       SELECT l.code, max(l.name) AS name, max(l.head_type) AS head_type, max(h.category) AS category
         FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id LEFT JOIN payroll_pay_heads h ON h.id = l.pay_head_id
        GROUP BY l.code ORDER BY max(l.head_type) = 'DEDUCTION', min(l.print_order), l.code`,
      args,
    )
  ).rows;
  const people = (
    await c.query<Record<string, string | null> & { employee_id: string; held: boolean }>(
      // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
      `WITH ${RECS},
       sums AS (
         SELECT employee_id, sum(gross_earned) AS gross, sum(total_deductions) AS deductions, sum(net_pay) AS net,
                max(month_days) FILTER (WHERE NOT is_top_up) AS month_days, max(paid_days) FILTER (WHERE NOT is_top_up) AS paid_days,
                max(lop_days) FILTER (WHERE NOT is_top_up) AS lop_days, sum(lop_amount) AS lop_amount,
                bool_or(status = 'HELD') AS held, array_agg(id) AS ids
           FROM recs GROUP BY employee_id),
       stat AS (
         SELECT r.employee_id, sum(st.pf_wage) AS pf_wage, sum(st.er_epf) AS er_epf, sum(st.er_eps) AS er_eps,
                sum(st.esi_wage) AS esi_wage, sum(st.esi_er) AS esi_er
           FROM recs r JOIN payroll_record_statutory st ON st.record_id = r.id GROUP BY r.employee_id)
       SELECT p.employee_id::text, p.code, p.name, p.designation, p.department, p.staff_type, p.pay_level AS level,
              p.pay_cell::text AS cell, p.category, p.pay_mode AS mode, p.bank_name AS bank, p.bank_ifsc AS ifsc,
              p.bank_account_masked AS account, p.pan_masked AS pan, p.uan,
              s.month_days::text, s.paid_days::text, s.lop_days::text, s.lop_amount::text, s.gross::text, s.deductions::text,
              s.net::text, s.held, COALESCE(t.pf_wage, 0)::text AS pf_wage, COALESCE(t.er_epf, 0)::text AS er_epf,
              COALESCE(t.er_eps, 0)::text AS er_eps, COALESCE(t.esi_wage, 0)::text AS esi_wage, COALESCE(t.esi_er, 0)::text AS esi_er
         FROM people p JOIN sums s ON s.employee_id = p.employee_id LEFT JOIN stat t ON t.employee_id = p.employee_id
        ORDER BY s.held, p.department NULLS LAST, p.name`,
      args,
    )
  ).rows;
  const amounts = (
    await c.query<{ employee_id: string; code: string; amount: string }>(
      // eslint-disable-next-line no-restricted-syntax -- the shared record scope and fixed fragments; values are bound
      `WITH ${RECS}
       SELECT r.employee_id::text, l.code, sum(l.amount)::text AS amount
         FROM payroll_record_lines l JOIN recs r ON r.id = l.record_id GROUP BY r.employee_id, l.code`,
      args,
    )
  ).rows;
  const byEmp = new Map<string, Record<string, string>>();
  for (const a of amounts)
    byEmp.set(a.employee_id, { ...(byEmp.get(a.employee_id) ?? {}), [`h:${a.code}`]: a.amount });
  const rows: GridRow[] = people.map(({ held, ...p }) => {
    const row: GridRow = {
      ...p,
      staff_type: typeName(p.staff_type ?? ''),
      status: held ? 'Held' : 'Paid',
    };
    for (const h of heads) row[`h:${h.code}`] = byEmp.get(p.employee_id)?.[`h:${h.code}`] ?? '0.00';
    return row;
  });
  return { heads, rows };
}

/** The register in a view or in the columns chosen; held salaries apart; sub-totals by staff type when all are paid. */
export function registerGrid(
  base: Pick<Grid, 'period' | 'subtitle' | 'provisional'>,
  data: Awaited<ReturnType<typeof registerData>>,
  p: ReportParams,
): Grid {
  const all = registerColumns(data.heads);
  let keys: string[];
  let headOnly = false;
  let title = 'Salary register';
  if (p.columns?.length) {
    const want = new Set(p.columns);
    keys = all.map((c) => c.key).filter((k) => want.has(k));
    if (!keys.includes('name')) keys.unshift('name');
  } else {
    const v = viewColumns(p.view ?? 'full', data.heads);
    keys = v.keys;
    headOnly = v.headOnly;
    const label = REGISTER_VIEWS.find((x) => x.key === (p.view ?? 'full'))?.label;
    if (p.view && p.view !== 'full' && label) title = `Salary register — ${label.toLowerCase()}`;
  }
  const columns = all.filter((c) => keys.includes(c.key));
  const headKeys = columns.filter((c) => c.key.startsWith('h:')).map((c) => c.key);
  const rows = headOnly
    ? data.rows.filter((r) => headKeys.some((k) => paise(r[k]) !== 0n))
    : data.rows;
  const held = rows.filter((r) => r.status === 'Held');
  const subtotals = held.length
    ? [
        {
          label: 'Paid',
          row: totalOf(
            columns,
            rows.filter((r) => r.status !== 'Held'),
            `Paid (${String(rows.length - held.length)})`,
          ),
        },
        {
          label: 'Held',
          row: totalOf(columns, held, `Held — not paid yet (${String(held.length)})`),
        },
      ]
    : subtotalsBy(columns, rows, 'staff_type', (t) => t);
  return {
    key: 'register',
    title,
    ...base,
    columns,
    rows,
    subtotals,
    total: rows.length ? totalOf(columns, rows, `Total (${String(rows.length)})`) : null,
  };
}

// ---- a period's words for the variance and headcount ------------------------------------------------------------------
export const prevMonth = (m: string) => addMonths(m, -1);
export const sumPaise = (vals: Array<string | number | null | undefined>) =>
  rupees(vals.reduce<bigint>((t, v) => t + paise(v), 0n));
