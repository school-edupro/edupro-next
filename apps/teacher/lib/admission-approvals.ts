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
  data: ApprovalRow[];
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
