/** Payment and statutory (docs/design/86, phase C): what the API returns, and the words the screens use. */

export type BatchStatus = 'GENERATED' | 'UPLOADED' | 'CONFIRMED' | 'CANCELLED';
export const BATCH_WORD: Record<BatchStatus, string> = {
  GENERATED: 'Made',
  UPLOADED: 'Uploaded to the bank',
  CONFIRMED: 'Confirmed (paid)',
  CANCELLED: 'Cancelled',
};
export const BATCH_TONE: Record<BatchStatus, 'neutral' | 'info' | 'success' | 'warning'> = {
  GENERATED: 'neutral',
  UPLOADED: 'info',
  CONFIRMED: 'success',
  CANCELLED: 'warning',
};
export const FORMAT_WORD: Record<string, string> = {
  GENERIC_CSV: 'Generic CSV',
  CUSTOM_CSV: 'The bank’s own layout',
  BANK_LETTER: 'Bank letter',
};

export interface BankPreview {
  run: {
    id: string;
    month: string;
    runType: string;
    seq: number;
    stage: string;
    provisional: boolean;
  };
  groups: Array<{
    bankCode: string | null;
    bankName: string | null;
    accountSet: boolean;
    fileFormat: string;
    count: number;
    total: string;
  }>;
  payable: Array<{
    recordId: string;
    code: string;
    name: string;
    bankCode: string | null;
    ifsc: string | null;
    accountMasked: string | null;
    amount: string;
    reissue: boolean;
    noAccount: boolean;
  }>;
  noAccount: string[];
  cash: Array<{
    recordId: string;
    code: string;
    name: string;
    mode: 'CASH' | 'CHEQUE';
    amount: string;
    status: string;
    paymentRef: string | null;
    paidAt: string | null;
  }>;
  batches: Array<{
    id: string;
    seq: number;
    bankCode: string | null;
    fileFormat: string;
    status: BatchStatus;
    txnCount: number;
    total: string;
    utr: string | null;
    provisional: boolean;
    valueDate: string | null;
    createdAt: string;
    createdByName: string | null;
    returned: number;
  }>;
  paid: { count: number; total: string };
  can: { generate: boolean; pay: boolean };
}

export interface BatchDetail {
  batch: {
    id: string;
    runId: string;
    seq: number;
    bankCode: string | null;
    fileFormat: string;
    formatWords: string;
    debitBankName: string | null;
    debitAccount: string | null;
    valueDate: string | null;
    madeOn: string;
    provisional: boolean;
    status: BatchStatus;
    txnCount: number;
    total: string;
    utr: string | null;
    month: string;
    runType: string;
    runSeq: number;
    stage: string;
  };
  lines: Array<{
    id: string;
    lineNo: number;
    recordId: string;
    code: string;
    name: string;
    ifsc: string | null;
    accountMasked: string | null;
    amount: string;
    status: 'SENT' | 'REJECTED' | 'CANCELLED';
    rejectReason: string | null;
    recordStatus: string;
  }>;
  can: { upload: boolean; confirm: boolean; cancel: boolean; reject: boolean; download: boolean };
}

export interface BankAccount {
  id: string;
  bankCode: string;
  bankName: string;
  branch: string | null;
  accountNo: string;
  fileFormat: string;
  layout: {
    columns?: Array<{ field?: string; value?: string; header?: string; format?: string }>;
    header?: boolean;
    delimiter?: string;
    extension?: string;
  };
  active: boolean;
}

export const LAYOUT_FIELD_WORD: Record<string, string> = {
  name: 'Name',
  empid: 'Employee ID',
  account: 'Account number',
  ifsc: 'IFSC',
  amount: 'Amount',
  narration: 'Narration (SALARY YYYY-MM)',
  date: 'Value date',
  debit_account: 'The school’s account',
  line_no: 'Line number',
};

export const COMPLIANCE_WORD: Record<string, string> = {
  DONE: 'Done',
  DONE_LATE: 'Done late',
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due this week',
  PENDING: 'Pending',
};
export const COMPLIANCE_TONE: Record<
  string,
  'success' | 'warning' | 'danger' | 'info' | 'neutral'
> = {
  DONE: 'success',
  DONE_LATE: 'warning',
  OVERDUE: 'danger',
  DUE_SOON: 'info',
  PENDING: 'neutral',
};

/** a date YYYY-MM-DD as DD-MM-YYYY */
export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
