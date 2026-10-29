import type { CandidateRowKind } from '@edupro/db';

/** One job application as the screening and the corrections read it (docs/design/34-recruitment.md). */
export type AppStatus =
  | 'submitted'
  | 'screening'
  | 'selected'
  | 'rejected'
  | 'on_hold'
  | 'withdrawn'
  | 'joined'
  | 'returned';
export const OPEN: AppStatus[] = ['submitted', 'screening', 'on_hold'];
export interface Snapshot {
  values: Record<string, unknown>;
  rows: Partial<Record<CandidateRowKind, Array<Record<string, string | null>>>>;
  activities: string[];
  files: Array<{ id: string; kind: string; fileId: string; contentType: string }>;
}
export interface AppRow {
  id: string;
  number: string;
  vacancy_id: string;
  vacancy: string;
  vacancy_code: string;
  stage_ids: string[];
  candidate_id: string;
  status: AppStatus;
  current_stage_id: string | null;
  stage: string | null;
  source: 'online' | 'office';
  snapshot: Snapshot;
  snapshot_secure: Record<string, string>;
  employee_match: Array<{ id: string; code: string; name: string }> | null;
  decision_note: string | null;
  submitted_at: Date;
  decided_at: Date | null;
  c_mobile: string | null;
  c_email: string | null;
  c_name: string | null;
  employee_id: string | null;
  joined_at: Date | null;
  /** a correction asked of the candidate (part 8) */
  correction: Correction | null;
}
/** What the office asked the candidate to correct (0203). */
export interface Correction {
  remark: string;
  steps: string[];
  partsText: string;
  dueOn: string;
  at: string;
  byName: string | null;
  byUser: string | null;
  prevStatus: AppStatus;
  remindedAt?: string;
  resentAt?: string;
  changed?: string[];
  cancelledAt?: string;
}
export const APP_COLS = `SELECT a.id::text, a.number, a.vacancy_id::text, v.title AS vacancy, v.code AS vacancy_code,
       v.stage_ids::text[] AS stage_ids, a.candidate_id::text, a.status, a.current_stage_id::text, st.name AS stage,
       a.source, a.snapshot, a.snapshot_secure, a.employee_match, a.decision_note, a.submitted_at, a.decided_at,
       c.mobile AS c_mobile, c.email::text AS c_email, c.name AS c_name, a.employee_id::text, a.joined_at,
       a.correction
  FROM job_applications a
  JOIN vacancies v ON v.id = a.vacancy_id
  JOIN candidates c ON c.id = a.candidate_id
  LEFT JOIN recruitment_stages st ON st.id = a.current_stage_id`;

export const nameOf = (a: Pick<AppRow, 'snapshot' | 'c_name'>) =>
  [a.snapshot.values.first_name, a.snapshot.values.last_name].filter(Boolean).join(' ') ||
  a.c_name ||
  'Candidate';

/** The candidates list's filters (vacancy, status, stage, search, employee match, ticked ids) as SQL. */
export function appFilter(q: {
  vacancy?: string;
  status?: AppStatus;
  stage?: string;
  q?: string;
  match?: boolean;
  ids?: string[];
}) {
  const where: string[] = [];
  const args: unknown[] = [];
  const arg = (v: unknown) => {
    args.push(v);
    return `$${String(args.length)}`;
  };
  if (q.vacancy) where.push(`a.vacancy_id = ${arg(q.vacancy)}`);
  if (q.status) where.push(`a.status = ${arg(q.status)}`);
  if (q.stage)
    where.push(
      `a.current_stage_id = ${arg(q.stage)} AND a.status IN ('submitted', 'screening', 'on_hold')`,
    );
  if (q.q) {
    const p = arg(`%${q.q.toLowerCase()}%`);
    where.push(
      `(lower(a.number) LIKE ${p} OR lower(COALESCE(c.name, '')) LIKE ${p}
        OR lower(COALESCE(a.snapshot->'values'->>'first_name', '') || ' ' || COALESCE(a.snapshot->'values'->>'last_name', '')) LIKE ${p}
        OR COALESCE(c.mobile, '') LIKE ${p} OR lower(COALESCE(c.email::text, '')) LIKE ${p})`,
    );
  }
  if (q.match) where.push(`a.employee_match IS NOT NULL`);
  if (q.ids?.length) where.push(`a.id = ANY(${arg(q.ids)}::bigint[])`);
  // eslint-disable-next-line no-restricted-syntax -- the conditions are fixed fragments built above; values are bound parameters
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}
