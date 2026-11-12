/** Payroll's monthly inputs (docs/design/86, phase B step 1): the shapes /payroll/inputs answers with. */

export interface RunCan {
  manage: boolean;
  approve: boolean;
  admin: boolean;
}

export interface AttendanceRow {
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    joinedOn: string | null;
    leftOn: string | null;
  };
  attendance: {
    monthDays: string;
    presentDays: string;
    paidLeaveDays: string;
    lopDays: string;
    preJoinDays: string;
    postLeaveDays: string;
    paidDays: string;
    otHours: string;
    unmarkedDays: number;
    source: 'register' | 'manual' | 'import' | 'quick_fill';
    reason: string | null;
    finalised: boolean;
    finalisedAt: string | null;
    updatedAt: string;
    warnings: number;
  } | null;
  hold: { id: string; mode: 'HOLD' | 'SKIP'; reason: string } | null;
}
export interface AttendanceMonth {
  month: string;
  monthWords: string;
  window: { from: string; to: string };
  register: { unlocked: string[]; running: string[]; locked: string[] };
  figures: {
    staff: number;
    pulled: number;
    missing: number;
    finalised: number;
    manual: number;
    held: number;
    skipped: number;
  };
  runs: string[];
  rows: AttendanceRow[];
  total: number;
  page: number;
  size: number;
  can: RunCan;
}
export interface AttendanceExplain {
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    joinedOn: string | null;
    leftOn: string | null;
  };
  month: string;
  attendance:
    | (Omit<NonNullable<AttendanceRow['attendance']>, 'warnings'> & {
        windowFrom: string;
        windowTo: string;
        updatedByName: string | null;
        finalisedByName: string | null;
        detail: {
          counts?: Record<string, string>;
          leave?: Record<string, { days: string; paid: string; lop: string }>;
          lop?: Record<string, string>;
          futureDays?: number;
          unmarkedAs?: string;
          otRegister?: string;
          otTyped?: boolean;
          manual?: { at: string; reason: string; source: string };
          warnings?: string[];
        };
      })
    | null;
  hold: { id: string; mode: string; reason: string } | null;
  can: RunCan;
}
export interface StaffOption {
  id: string;
  code: string;
  name: string;
  department: string | null;
}
export interface HoldList {
  month: string;
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    department: string | null;
    mode: 'HOLD' | 'SKIP';
    reason: string;
    active: boolean;
    updatedAt: string;
    byName: string | null;
  }>;
  runs: string[];
  can: RunCan;
}
export interface TdsList {
  month: string;
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    itAmount: string;
    cessAmount: string;
    reason: string;
    byName: string | null;
  }>;
  can: RunCan;
}
export interface LoanRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  department?: string | null;
  loanType: string;
  principal: string;
  emi: string;
  interestRate: string;
  interestMethod: 'NONE' | 'FLAT' | 'REDUCING';
  balance: string;
  startMonth: string;
  status: 'ACTIVE' | 'HOLD' | 'CLOSED';
  remarks?: string | null;
  createdByName?: string | null;
}
export interface LoanList {
  rows: LoanRow[];
  total: number;
  page: number;
  size: number;
  figures: { active: number; hold: number; owed: string };
  can: RunCan;
}
export interface ScheduleMonth {
  month?: string;
  opening: string;
  interest: string;
  emi: string;
  principal: string;
  closing: string;
}
export interface LoanDetail {
  loan: LoanRow;
  remaining: ScheduleMonth[];
  can: RunCan;
}
export interface AdhocList {
  month: string;
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    headCode: string;
    headName: string;
    headType: 'EARNING' | 'DEDUCTION';
    amount: string;
    refModule: string | null;
    remarks: string | null;
    receiptPending: boolean;
    paidInRecordId: string | null;
    byName: string | null;
  }>;
  total: number;
  page: number;
  size: number;
  figures: { earnings: string; deductions: string; count: number };
  heads: Array<{
    id: string;
    code: string;
    name: string;
    headType: 'EARNING' | 'DEDUCTION';
    category: string;
  }>;
  can: RunCan;
}
export interface Wards {
  employee: { id: string; code: string; name: string };
  linked: Array<{
    id: string;
    studentId: string;
    admissionNo: string;
    name: string;
    source: string;
    active: boolean;
  }>;
  found: Array<{ studentId: string; admissionNo: string; name: string }>;
  dues: Array<{
    studentId: string;
    academicYearId: string;
    dueOn: string;
    heads: string;
    outstanding: string;
    staged: boolean;
  }>;
  wardFeeHeadId: string | null;
  can: RunCan;
}
export interface PayeeList {
  rows: Array<{
    id: string;
    name: string;
    partyType: string;
    payeeAccount: string | null;
    remarks: string | null;
    active: boolean;
    deductions: number;
  }>;
  can: RunCan;
}
export interface RecurringList {
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    headCode: string;
    headName: string;
    payee: string | null;
    amount: string;
    referenceNo: string | null;
    startMonth: string;
    endMonth: string | null;
    status: 'ACTIVE' | 'HOLD' | 'ENDED';
    remarks: string | null;
  }>;
  total: number;
  page: number;
  size: number;
  heads: Array<{ id: string; code: string; name: string }>;
  payees: Array<{ id: string; name: string }>;
  can: RunCan;
}
export interface ClaimList {
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    headCode: string;
    headName: string;
    amountClaimed: string;
    amountApproved: string | null;
    billDate: string | null;
    description: string;
    status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';
    payMonth: string | null;
    decisionRemark: string | null;
    byName: string | null;
    decidedByName: string | null;
    mine: boolean;
  }>;
  total: number;
  page: number;
  size: number;
  heads: Array<{ id: string; code: string; name: string }>;
  waiting: number;
  can: RunCan;
}
export interface OvertimeList {
  month: string;
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    basis: 'DAY' | 'HOUR';
    qty: string;
    employeeType: string | null;
    rate: string;
    derivedAmount: string;
    amount: string;
    reason: string | null;
    paid: string | null;
  }>;
  total: string;
  can: RunCan;
}

/** this month (IST) as YYYY-MM */
export const thisMonth = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .format(new Date())
    .slice(0, 7);
/** a month query value, else this month */
export const monthParam = (v: string | undefined) =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(v ?? '') ? v! : thisMonth();
export const monthName = (m: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${m}-01T00:00:00Z`),
  );
export const SOURCE: Record<string, string> = {
  register: 'Register',
  manual: 'By hand',
  import: 'Sheet',
  quick_fill: 'Marked present',
};
