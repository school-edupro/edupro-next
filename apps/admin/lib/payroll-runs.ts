/** Payroll runs (docs/design/86, phase B step 3): the shapes /payroll/runs answers with. */
import type { RunCan } from './payroll-inputs';

export type RunStage =
  'DRAFT' | 'PROCESSING' | 'REVIEW' | 'REJECTED' | 'APPROVED' | 'LOCKED' | 'PAID';
export type RunType = 'REGULAR' | 'SUPPLEMENTARY' | 'BONUS';

export interface RunListRow {
  id: string;
  month: string;
  runType: RunType;
  seq: number;
  stage: RunStage;
  empCount: number;
  failedCount: number;
  grossTotal: string;
  deductionTotal: string;
  netTotal: string;
  progress: number;
  createdByName: string | null;
  approvedByName: string | null;
  named: number | null;
}
export interface RunList {
  fy: number;
  rows: RunListRow[];
  thisMonth: string;
  can: RunCan;
}
export interface RunDetail {
  run: RunListRow & {
    remark: string | null;
    employeeIds: string[] | null;
    createdAt: string;
    approvedAt: string | null;
    lockedAt: string | null;
    lockedByName: string | null;
    mine: boolean;
  };
  monthWords: string;
  counts: Partial<Record<'COMPUTED' | 'FAILED' | 'HELD' | 'RELEASED' | 'PAID', number>>;
  eligible: number;
  receipts: { pending: number; posted: number };
  events: Array<{
    action: string;
    stageFrom: string | null;
    stageTo: string | null;
    comment: string | null;
    detail: Record<string, unknown>;
    createdAt: string;
    byName: string | null;
  }>;
  can: RunCan;
}
export interface RunChecks {
  red: Array<{ employee?: string; text: string }>;
  amber: Array<{ employee?: string; text: string }>;
  people: number;
  fullMonth: number;
  topUps: number;
  ok: boolean;
}
export interface RecordRow {
  id: string;
  employeeId: string;
  code: string;
  name: string;
  department: string | null;
  status: 'COMPUTED' | 'FAILED' | 'HELD' | 'RELEASED' | 'PAID';
  failureCode: string | null;
  failureReason: string | null;
  isTopUp: boolean;
  paidDays: string;
  lopDays: string;
  gross: string;
  deductions: string;
  net: string;
  prevNet: string | null;
  heldReason: string | null;
  warnings: string[];
  flags: string[];
}
export interface RecordList {
  rows: RecordRow[];
  total: number;
  page: number;
  size: number;
  summary: {
    records: number;
    failed: number;
    held: number;
    flagged: number;
    zeroNet: number;
    new: number;
  };
  can: RunCan;
}
export interface RecordDetail {
  record: {
    id: string;
    runId: string;
    month: string;
    runStage: RunStage;
    runType: RunType;
    status: RecordRow['status'];
    failureCode: string | null;
    failureReason: string | null;
    isTopUp: boolean;
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    designation: string | null;
    department: string | null;
    panMasked: string | null;
    uan: string | null;
    payMode: string | null;
    bankName: string | null;
    bankIfsc: string | null;
    bankAccountMasked: string | null;
    taxRegime: string | null;
    monthDays: string;
    paidDays: string;
    lopDays: string;
    ncpDays: string;
    grossFixed: string;
    grossEarned: string;
    lopAmount: string;
    pfWage: string;
    esiWage: string;
    ptAmount: string;
    itAmount: string;
    cessAmount: string;
    totalDeductions: string;
    netPay: string;
    netInWords: string | null;
    heldReason: string | null;
    warnings: string[];
    trace: {
      structure?: Record<string, string>;
      versions?: Record<string, string>;
      rates?: Record<string, { id: string; value: string }>;
      attributes?: Record<string, number>;
      eps?: string | null;
      esi?: { covered: boolean; decided: string } | null;
      ptSlab?: { gender: string; from: string; to: string | null } | null;
      topUp?: { pfWageUsed: string; headroom: string | null } | null;
      skipped?: string[];
      shortfall?: string;
    };
  };
  lines: Array<{
    code: string;
    name: string;
    headType: 'EARNING' | 'DEDUCTION';
    rate: string;
    amount: string;
    isArrear: boolean;
    isStructure: boolean;
    isTaxable: boolean;
    sourceKind: string;
    sourceId: string | null;
  }>;
  statutory: Record<string, string | boolean | null> | null;
  tax: Record<string, string | number | boolean | null> | null;
  loans: Array<{
    loanId: string;
    loanType: string;
    opening: string;
    interest: string;
    emi: string;
    principal: string;
    closing: string;
  }>;
  can: RunCan;
}

export const STAGE_WORD: Record<RunStage, string> = {
  DRAFT: 'Draft',
  PROCESSING: 'Processing',
  REVIEW: 'In review',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
  PAID: 'Paid',
};
export const STAGE_TONE: Record<RunStage, 'neutral' | 'info' | 'warning' | 'danger' | 'success'> = {
  DRAFT: 'neutral',
  PROCESSING: 'info',
  REVIEW: 'warning',
  REJECTED: 'danger',
  APPROVED: 'info',
  LOCKED: 'success',
  PAID: 'success',
};
export const TYPE_WORD: Record<RunType, string> = {
  REGULAR: 'Regular',
  SUPPLEMENTARY: 'Supplementary',
  BONUS: 'Bonus',
};
export const FLAG_WORD: Record<string, string> = {
  ZERO_NET: 'Nil net',
  NEW: 'New this month',
  NET_CHANGED: 'Net changed by over 10 %',
  BANK_CHANGED: 'Bank changed',
  LOP_SPIKE: 'Loss of pay up by over 10 days',
  SAME_ACCOUNT: 'Same account as another',
  NO_BANK: 'No bank account',
};
