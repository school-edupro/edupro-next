import type { ReviewRemark } from '@edupro/ui';

/** Admission approvers (docs/design/50): what waits at my levels, and what I decided. */
export interface ApprovalRow {
  id: string;
  number: string | null;
  candidate: string | null;
  className: string;
  session: string;
  category: string | null;
  status: string;
  points: number | null;
  merit: number | null;
  stage: string | null;
  level: string | null;
  since: string | null;
  dueAt: string | null;
  overdue: boolean;
  remarks: ReviewRemark[];
}
export interface ApprovalList {
  waiting: number;
  decided: number;
  overdue: number;
  total: number;
  options: {
    sessions: Array<{ id: string; name: string }>;
    classes: Array<{ id: string; name: string }>;
    categories: Array<{ id: string; name: string }>;
    stages: string[];
    levels: string[];
    statuses: string[];
  };
  data: ApprovalRow[];
}

/** The filters the list takes (docs/design/51), kept in the address. */
export const FILTER_KEYS = [
  'tab',
  'cycleId',
  'classId',
  'categoryId',
  'status',
  'stage',
  'level',
  'q',
  'from',
  'to',
  'overdue',
] as const;
export type ApprovalFilters = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

/** The filters from the address, checked, as the API query. */
export function approvalsQuery(sp: Record<string, string | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  const ok: Record<string, RegExp> = {
    tab: /^(waiting|decided)$/,
    cycleId: /^\d{1,18}$/,
    classId: /^\d{1,18}$/,
    categoryId: /^\d{1,18}$/,
    status: /^[a-z_]{3,20}$/,
    stage: /^.{1,80}$/,
    level: /^.{1,120}$/,
    q: /^.{1,80}$/,
    from: /^\d{4}-\d{2}-\d{2}$/,
    to: /^\d{4}-\d{2}-\d{2}$/,
    overdue: /^1$/,
  };
  for (const k of FILTER_KEYS) {
    const v = sp[k]?.trim();
    if (v && ok[k]!.test(v)) q.set(k, v);
  }
  return q;
}

export const DECISION_LABEL: Record<string, string> = {
  approved: 'Approved',
  rejected: 'Not selected',
  hold: 'On hold',
  offered: 'Offered',
  waitlisted: 'Waiting list',
};

export const STATUS_LABEL: Record<string, string> = {
  registered: 'Registered',
  under_review: 'In process',
  sent_back: 'Sent back to the family',
  shortlisted: 'Shortlisted',
  selected: 'Selected',
  waitlisted: 'Waiting list',
  offered: 'Offered',
  fee_paid: 'Admission fee paid',
  admitted: 'Admitted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

/** One column per stage level met in the rows, in the order the decisions were taken. */
export function remarkColumns(rows: ApprovalRow[]): string[] {
  const cols: string[] = [];
  for (const r of rows)
    for (const m of r.remarks) {
      const k = `${m.stage} · ${m.levelName}`;
      if (!cols.includes(k)) cols.push(k);
    }
  return cols;
}
