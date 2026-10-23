/** Stock verification in cycles (docs/design/36-library.md, "Library reports", part 3): what the API gives. */
export interface StockCycle {
  reopened?: number;
  reopenLog?: Array<{
    at: string;
    by: string;
    reason: string;
    restored: number;
    closedOn?: string;
  }>;
  reopen?: { allowed: boolean; why: string | null; until: string | null } | null;
  id: string;
  name: string;
  status: 'open' | 'closed' | 'cancelled';
  startedOn: string;
  finishedOn: string | null;
  startedBy: string | null;
  closedBy: string | null;
  note: string | null;
  cancelReason: string | null;
  missingMarkedLost: boolean;
  scope: {
    libraries: Array<{ id: string; name: string }>;
    shelves: Array<{ id: string; code: string; library: string }>;
    materialTypes: Array<{ id: string; name: string }>;
    words: string;
  };
  counts: {
    total: number;
    verified: number;
    pending: number;
    onLoan: number;
    missing: number;
    gone: number;
    outside: number;
    unknown: number;
  };
  /** verified, on loan or gone, of all (%) */
  done: number;
}

export type StockState = 'pending' | 'verified' | 'on_loan' | 'missing' | 'gone' | 'all' | 'extras';

export interface StockItem {
  kind: 'copy';
  copyId: string;
  accessionNo: string;
  titleId: string;
  title: string;
  author: string | null;
  library: string | null;
  shelf: string | null;
  rack: string | null;
  material: string | null;
  copyStatus: string;
  state: 'verified' | 'pending' | 'on_loan' | 'missing' | 'gone';
  foundOn: string | null;
  foundBy: string | null;
  method: string | null;
  remark: string | null;
  borrower: string | null;
  borrowerRef: string | null;
  dueOn: string | null;
}
export interface StockExtra {
  kind: 'extra';
  typed: string;
  extra: 'outside' | 'unknown';
  method: string;
  remark: string | null;
  by: string | null;
  on: string | null;
  accessionNo: string | null;
  title: string | null;
  library: string | null;
  shelf: string | null;
  copyStatus: string | null;
}

/** A number as the cycle took it. */
export interface StockHit {
  no: string;
  row: number | null;
  accessionNo: string | null;
  title: string | null;
  library: string | null;
  shelf: string | null;
}
export interface StockVerifyResult {
  verified: StockHit[];
  already: StockHit[];
  outside: StockHit[];
  unknown: StockHit[];
  repeated: StockHit[];
  issued: Array<{ accessionNo: string | null; title: string | null }>;
  cycle: StockCycle;
}
export interface StockUpload {
  id: string;
  cycleId: string;
  fileName: string;
  status: 'checked' | 'applied' | 'discarded';
  by: string | null;
  at: string;
  numbers: number;
  counts: Record<'verify' | 'already' | 'outside' | 'unknown' | 'repeated', number> | null;
  lists: Record<'verify' | 'already' | 'outside' | 'unknown' | 'repeated', StockHit[]> | null;
}

export const STATE_LABEL: Record<string, string> = {
  verified: 'Verified',
  pending: 'Pending',
  on_loan: 'On loan',
  missing: 'Missing',
  gone: 'Lost, withdrawn or sold since',
};
export const STATE_TONE: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  verified: 'success',
  pending: 'warning',
  on_loan: 'info',
  missing: 'danger',
  gone: 'neutral',
};
export const METHOD_LABEL: Record<string, string> = {
  scan: 'Scanned',
  excel: 'From a file',
  manual: 'By hand',
};
