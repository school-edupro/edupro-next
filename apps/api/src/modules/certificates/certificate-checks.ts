import type { PoolClient } from '@edupro/db';
import type { Ledger } from '../fees/fee-ledger.service';

/**
 * Eligibility per certificate type (docs/design/87, decision 5). The type's `rules` name what is checked: the student's
 * state (active, leaving or any), fee dues, library, hostel and transport cleared; the type's `multiple` rule says
 * whether a live certificate already held stops another. Each failed check is named; the principal (holding
 * certificate.register.override) may issue anyway with a reason, which is recorded on the certificate.
 */
export interface CertificateRules {
  state?: 'active' | 'leaving' | 'any';
  fees?: boolean;
  library?: boolean;
  hostel?: boolean;
  transport?: boolean;
}
export type CheckKey = 'state' | 'fees' | 'library' | 'hostel' | 'transport' | 'one';
export interface CertificateCheck {
  key: CheckKey;
  label: string;
  ok: boolean;
  detail: string;
}
export const CHECK_LABELS: Record<CheckKey, string> = {
  state: 'Student',
  fees: 'Fees',
  library: 'Library',
  hostel: 'Hostel',
  transport: 'Transport',
  one: 'Certificates held',
};

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The withdrawal departments whose clearance answers a check (a department cleared or bypassed there passes it). */
const DEPARTMENTS: Partial<Record<CheckKey, (code: string) => boolean>> = {
  fees: (d) => d === 'fees',
  library: (d) => d === 'library',
  hostel: (d) => d.startsWith('hostel'),
  transport: (d) => d === 'transport',
};

export interface CheckInput {
  studentId: string;
  typeId: string;
  rules: CertificateRules;
  multiple: 'ONE' | 'YEAR' | 'ANY';
  /** the date dues are counted up to: the leaving date on the withdrawal route, else today */
  asOf: string;
  /** issued from a withdrawal whose TC gates are cleared */
  withdrawalId?: string | null;
  yearCode: string | null;
  /** the student's fee ledger, read by the caller (null: no ledger) */
  ledger: Ledger | null;
}

export async function runChecks(c: PoolClient, i: CheckInput): Promise<CertificateCheck[]> {
  const out: CertificateCheck[] = [];
  const push = (key: CheckKey, ok: boolean, detail: string) =>
    out.push({ key, label: CHECK_LABELS[key], ok, detail });
  const s = (
    await c.query<{
      status: string;
      left_on: string | null;
      wd: string | null;
      wd_status: string | null;
    }>(
      `SELECT s.status::text, s.left_on::text,
              w.id::text AS wd, w.status::text AS wd_status
         FROM students s
         LEFT JOIN LATERAL (SELECT w.id, w.status FROM student_withdrawals w
                             WHERE w.student_id = s.id AND w.status IN ('cleared', 'completed')
                             ORDER BY w.created_at DESC LIMIT 1) w ON true
        WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [i.studentId],
    )
  ).rows[0];
  if (!s)
    return [{ key: 'state', label: CHECK_LABELS.state, ok: false, detail: 'Student not found' }];
  const state = i.rules.state ?? 'any';
  if (state === 'active')
    push(
      'state',
      s.status === 'active',
      s.status === 'active' ? 'On the rolls' : 'The student has left the school',
    );
  else if (state === 'leaving') {
    const ok = s.status !== 'active' || !!i.withdrawalId || !!s.wd;
    push(
      'state',
      ok,
      i.withdrawalId
        ? 'Issued from the withdrawal (its departments are cleared)'
        : s.status !== 'active'
          ? 'Left the school'
          : s.wd
            ? `Withdrawal ${s.wd_status === 'completed' ? 'complete' : 'cleared'}`
            : 'No withdrawal is complete: the student is still on the rolls',
    );
  } else push('state', true, s.status === 'active' ? 'On the rolls' : 'A past student');

  // the departments cleared (or bypassed) in the withdrawal answer their checks
  const wdId = i.withdrawalId ?? s.wd;
  const cleared = wdId
    ? (
        await c.query<{ department: string; bypassed: boolean }>(
          `SELECT department, bypassed FROM withdrawal_clearances WHERE withdrawal_id = $1 AND status = 'cleared'`,
          [wdId],
        )
      ).rows
    : [];
  const clearedIn = (key: CheckKey) => {
    const f = DEPARTMENTS[key];
    const hit = f ? cleared.find((x) => f(x.department)) : undefined;
    return hit ? (hit.bypassed ? 'bypassed in the withdrawal' : 'cleared in the withdrawal') : null;
  };
  const check = (key: CheckKey, failing: string | null, passing: string) => {
    if (!failing) return push(key, true, passing);
    const w = clearedIn(key);
    push(key, !!w, w ? `${failing} (${w})` : failing);
  };

  if (i.rules.fees) {
    const due = i.ledger
      ? i.ledger.instalments
          .filter((x) => x.dueOn <= i.asOf)
          .reduce((n, x) => n + Number(x.balance) + Number(x.lateFee.outstanding), 0)
      : 0;
    const d = Math.max(Math.round(due * 100) / 100, 0);
    check(
      'fees',
      d > 0 ? `${money(d)} due up to ${i.asOf}` : null,
      i.ledger ? 'No fees due' : 'No fee ledger',
    );
  }
  if (i.rules.library) {
    const r = (
      await c.query<{ open: number; fines: string; charges: string }>(
        `SELECT count(*) FILTER (WHERE returned_on IS NULL)::int AS open,
                app.library_fines_unsent('student', $1)::text AS fines,
                app.library_charges_due('student', $1)::text AS charges
           FROM library_loans WHERE borrower_kind = 'student' AND borrower_id = $1`,
        [i.studentId],
      )
    ).rows[0];
    const open = r?.open ?? 0;
    const owed = Number(r?.fines ?? 0) + Number(r?.charges ?? 0);
    const parts = [
      open ? `${String(open)} book${open === 1 ? '' : 's'} not returned` : null,
      owed ? `${money(owed)} of library dues` : null,
    ].filter(Boolean);
    check('library', parts.length ? parts.join(', ') : null, 'No books out and no dues');
  }
  if (i.rules.hostel) {
    const r = await c.query(
      `SELECT 1 FROM hostel_allotments WHERE student_id = $1 AND from_date <= $2::date AND (to_date IS NULL OR to_date > $2::date)`,
      [i.studentId, i.asOf],
    );
    check('hostel', r.rowCount ? 'Still allotted a hostel bed' : null, 'No hostel bed held');
  }
  if (i.rules.transport) {
    const r = await c.query(
      `SELECT 1 FROM student_transport WHERE student_id = $1 AND status = 'active'
          AND (to_month IS NULL OR to_month >= date_trunc('month', $2::date))`,
      [i.studentId, i.asOf],
    );
    check('transport', r.rowCount ? 'Still using school transport' : null, 'No transport in use');
  }
  if (i.multiple !== 'ANY') {
    const r = await c.query<{ number: string }>(
      `SELECT number FROM certificates
        WHERE type_id = $1 AND student_id = $2 AND status = 'issued' AND copy_no = 0
          AND ($3::text = 'ONE' OR year_code IS NOT DISTINCT FROM $4::text)
        ORDER BY issued_on DESC LIMIT 1`,
      [i.typeId, i.studentId, i.multiple, i.yearCode],
    );
    const held = r.rows[0]?.number;
    push(
      'one',
      !held,
      held
        ? `Already holds ${held}${i.multiple === 'YEAR' ? ' this year' : ''}; cancel it or print a duplicate`
        : 'None held',
    );
  }
  return out;
}
