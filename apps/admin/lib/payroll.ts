/** Payroll (docs/design/86): the shapes the /payroll API answers with, and small helpers. */

export interface PayrollCan {
  manage: boolean;
  approve: boolean;
  admin: boolean;
  reveal: boolean;
}

export interface PayrollOverview {
  today: string;
  fy: string;
  settings: { stateCode: string | null; tan: string | null; pfEstablishmentCode: string | null };
  figures: {
    staff: number;
    profiles: number;
    structured: number;
    heads: number;
    headsUnversioned: number;
    matrixCells: number;
    drafts: { rates: number; statutory: number; versions: number; structures: number };
  };
  checks: Array<{ level: 'red' | 'amber'; text: string; href: string }>;
  can: PayrollCan;
}

export interface PayrollSettings {
  settings: {
    stateCode: string | null;
    pfEstablishmentCode: string | null;
    tan: string | null;
    ptrcNo: string | null;
    esiCode: string | null;
    lwfEnabled: boolean;
    epsStopAge: number;
    pfCeilingProrate: boolean;
    matrixCode: string;
    payCycleFromDay: number | null;
    otHoursLimit: number;
    payslipPassword: string | null;
    bankFileFormat: 'GENERIC_CSV' | 'CUSTOM_CSV' | 'BANK_LETTER_XLSX';
    confidentialEmployeeIds: string[];
    formulaAttributes: Array<{ code: string; field: string; value: string }>;
    regimeCutoffMonth: number;
    updatedAt: string;
  };
  confidential: Array<{ id: string; code: string; name: string }>;
  matrices: string[];
  can: PayrollCan;
}

export type ConfigKind = 'rates' | 'pf' | 'esi' | 'pt' | 'lwf' | 'ot';
export interface ConfigRow {
  id: string;
  status: 'draft' | 'active' | 'ended';
  effectiveFrom: string;
  effectiveTo: string | null;
  referenceNo: string | null;
  changeReason: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  mine: boolean;
  [k: string]: unknown;
}
export interface ConfigList {
  kind: ConfigKind;
  rows: ConfigRow[];
  can: PayrollCan;
}

export interface TaxYear {
  fy: string;
  years: string[];
  slabs: Array<{ regime: string; slabFrom: string; slabTo: string | null; rate: string }>;
  config: Array<{
    regime: string;
    standardDeduction: string;
    rebateIncomeLimit: string;
    rebateMax: string;
    cessRate: string;
    panAbsentRate: string;
    marginalRelief: boolean;
  }>;
  surcharges: Array<{ regime: string; incomeFrom: string; rate: string }>;
  labels: Array<{
    lineCode: string;
    label: string;
    appliesTo: string;
    capAmount: string | null;
    declarable: boolean;
  }>;
  can: PayrollCan;
}

export interface HeadListRow {
  id: string;
  code: string;
  name: string;
  headType: 'EARNING' | 'DEDUCTION';
  category: string;
  printOrder: number;
  showIfZero: boolean;
  status: 'active' | 'inactive';
  versions: number;
  drafts: number;
  calcType: string | null;
  formula: string | null;
  rounding: string | null;
  liveFrom: string | null;
  pfWage: boolean | null;
  esiWage: boolean | null;
  ptWage: boolean | null;
  isTaxable: boolean | null;
  prorateOnLop: boolean | null;
}

export interface HeadVersion {
  id: string;
  calcType: string;
  formula: string | null;
  dependsOn: string | null;
  isTaxable: boolean;
  pfWage: boolean;
  esiWage: boolean;
  ptWage: boolean;
  prorateOnLop: boolean;
  rounding: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'draft' | 'active' | 'ended';
  referenceNo: string | null;
  changeReason: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  mine: boolean;
}
export interface HeadDetail {
  head: Omit<
    HeadListRow,
    | 'versions'
    | 'drafts'
    | 'calcType'
    | 'formula'
    | 'rounding'
    | 'liveFrom'
    | 'pfWage'
    | 'esiWage'
    | 'ptWage'
    | 'isTaxable'
    | 'prorateOnLop'
  >;
  versions: HeadVersion[];
  slabs: Array<{
    versionId: string;
    basis: string;
    rangeFrom: string;
    rangeTo: string | null;
    flatAmount: string | null;
    percent: string | null;
  }>;
  tests: Array<{
    id: string;
    name: string;
    inputs: Record<string, string>;
    expected: string;
    lastResult: string | null;
    lastStatus: 'pass' | 'fail' | null;
  }>;
  can: PayrollCan;
}

export interface FormulaCheck {
  ok: boolean;
  errors: string[];
  headsUsed: string[];
  varsUsed: string[];
  warnings: string[];
  result: { ok: true; value: string } | { ok: false; errors: string[] } | null;
  names: { heads: string[]; rates: string[]; attributes: string[]; system: string[] };
}

export interface PayMatrix {
  code: string;
  active: string;
  codes: string[];
  levels: Array<{
    level: string;
    order: number;
    cells: Array<{ cell: number; basic: string; effectiveFrom: string; used: number }>;
  }>;
  can: PayrollCan;
}

export interface ProfileList {
  rows: Array<{
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    staffType: string | null;
    uan: string | null;
    hasProfile: boolean;
    payLevel: string | null;
    payCell: number | null;
    taxRegime: string | null;
    payrollStatus: string | null;
    payMode: string | null;
    contractEnd: string | null;
    leftOn: string | null;
    structured: boolean;
    panMasked: string | null;
    bankMasked: string | null;
  }>;
  total: number;
  page: number;
  size: number;
  figures: { staff: number; profiles: number; missing: number; hold: number };
  can: PayrollCan;
}

export interface ProfileValues {
  pfApplicable: boolean;
  pfWageBasis: 'ACTUAL' | 'CEILING';
  epsApplicable: boolean;
  vpfType: 'NONE' | 'FLAT' | 'PERCENT';
  vpfValue: string;
  npsApplicable: boolean;
  npsEeRate: string;
  npsErRate: string;
  esiApplicable: boolean;
  pwd: boolean;
  ptApplicable: boolean;
  ptExemptReason: string | null;
  taxRegime: 'NEW' | 'OLD';
  tdsMode: 'PROJECTION' | 'MANUAL';
  category: string | null;
  payLevel: string | null;
  payCell: number | null;
  contractStart: string | null;
  contractEnd: string | null;
  incrementMonth: number | null;
  payrollStatus: 'ACTIVE' | 'HOLD' | 'LEFT';
  payMode: 'BANK' | 'CASH' | 'CHEQUE';
}
export interface ProfileDetail {
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    status: string;
    staffType: string | null;
    joinedOn: string | null;
    leftOn: string | null;
    dob: string | null;
    gender: string | null;
    pfNo: string | null;
    uan: string | null;
    esiNo: string | null;
    npsNo: string | null;
    bankName: string | null;
    bankIfsc: string | null;
  };
  statutory: { panMasked: string | null; aadhaarMasked: string | null; bankMasked: string | null };
  exists: boolean;
  profile: ProfileValues | null;
  nominees: Array<{
    id: string;
    name: string;
    relation: string;
    dob: string | null;
    sharePercent: string;
    purpose: string;
    guardianName: string | null;
    address: string | null;
  }>;
  changes: Array<{
    field: string;
    oldValue: string | null;
    newValue: string | null;
    effectiveFrom: string;
    changedAt: string;
    changedBy: string | null;
  }>;
  matrix: Array<{ level: string; cells: number }>;
  can: PayrollCan;
}

export interface StructureView {
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
    staffType: string | null;
  };
  asOf: string;
  heads: Array<{
    id: string;
    code: string;
    name: string;
    headType: 'EARNING' | 'DEDUCTION';
    category: string;
    calcType: string | null;
    formula: string | null;
    liveId: string | null;
    liveAmount: string | null;
    liveFrom: string | null;
    draftId: string | null;
    draftAmount: string | null;
    draftFrom: string | null;
    draftBy: string | null;
  }>;
  timeline: Array<{
    id: string;
    code: string;
    name: string;
    amount: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
    changeReason: string | null;
    madeBy: string | null;
    approvedBy: string | null;
  }>;
  templates: Array<{
    id: string;
    name: string;
    description: string | null;
    staffTypes: string[];
    lines: Record<string, string>;
  }>;
  can: PayrollCan;
}

export interface StructureDrafts {
  rows: Array<{
    id: string;
    code: string;
    name: string;
    department: string | null;
    lines: number;
    effectiveFrom: string;
    madeAt: string;
    madeBy: string | null;
    mine: boolean;
  }>;
  can: PayrollCan;
}

/** dd-mm-yyyy */
export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
/** ₹ amounts the Indian way, from the API's decimal strings */
export const money = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? ''
    : Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** a rate 0.0833 as 8.33 % */
export const pct = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === ''
    ? ''
    : `${(Number(v) * 100).toLocaleString('en-IN', { maximumFractionDigits: 4 })} %`;
export const STATUS_TONE = { draft: 'warning', active: 'success', ended: 'neutral' } as const;
export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** pay-head kinds and how a head is worked out, as people say them */
export const CATEGORY: Record<string, string> = {
  BASIC: 'Basic',
  DA: 'Dearness allowance',
  HRA: 'House rent',
  ALLOWANCE: 'Allowance',
  ARREAR: 'Arrears',
  BONUS: 'Bonus',
  REIMB: 'Reimbursement',
  LOAN: 'Loan or advance',
  STATUTORY: 'Statutory',
  MISC: 'Other',
};
export const CALC_LABEL: Record<string, string> = {
  FIXED: 'Fixed',
  FORMULA: 'Formula',
  SLAB: 'Slab',
  MANUAL: 'Manual',
  SYSTEM: 'System',
};
