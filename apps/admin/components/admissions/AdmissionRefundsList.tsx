import { Badge, Card } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { RefundActions } from '@/components/admissions/RefundActions';
import { dmy, rupees } from '@/lib/admission-desk';
import { apiFetch } from '@/lib/api';

export interface AdmissionRefund {
  id: string;
  applicationId: string;
  number: string | null;
  admissionNo: string | null;
  candidate: string | null;
  className: string;
  session: string;
  receiptNo: string;
  paidAmount: number;
  deductionPct: number;
  deduction: number;
  amount: number;
  reason: string;
  status: string;
  requestedAt: string;
  requestedBy: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  mode: string | null;
  reference: string | null;
  paidOn: string | null;
  paidBy: string | null;
  hasVoucher: boolean;
  approval: {
    status: string;
    waitingWith: string | null;
    since: string | null;
    overdue: boolean;
    steps: Array<{
      level: number;
      name: string;
      status: string;
      actedBy: string | null;
      actedAt: string | null;
      note: string | null;
    }>;
  } | null;
  mayDecide: boolean;
  mayPay: boolean;
}

const TONE: Record<string, 'warning' | 'info' | 'danger' | 'success'> = {
  requested: 'warning',
  approved: 'info',
  rejected: 'danger',
  paid: 'success',
};
const LABEL: Record<string, string> = {
  requested: 'Waiting approval',
  approved: 'To pay',
  rejected: 'Not approved',
  paid: 'Paid',
};
const MODE: Record<string, string> = {
  bank: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  gateway: 'Back to the card / UPI',
};
const VIEWS = [
  ['mine', 'Waiting for me'],
  ['requested', 'Waiting approval'],
  ['approved', 'To pay'],
  ['paid', 'Paid'],
  ['rejected', 'Not approved'],
  ['all', 'All'],
] as const;

/**
 * The admission fee refunds (docs/design/54), shared by Fees → Refunds → Admission refunds and
 * Admissions → Admission fee refunds: by status, who each waits with, act on my level, pay with the
 * voucher.
 */
export async function AdmissionRefundsList({ base, view }: { base: string; view?: string }) {
  const v = VIEWS.some(([k]) => k === view) ? view! : 'mine';
  const q = v === 'mine' ? '?mine=1' : v === 'all' ? '' : `?status=${encodeURIComponent(v)}`;
  const list = await apiFetch<{
    data: AdmissionRefund[];
    counts: Record<string, number>;
    levelsInUse: boolean;
  }>(`/admissions/refunds${q}`);
  const all = await apiFetch<{ data: AdmissionRefund[] }>('/admissions/refunds?mine=1').then(
    (r) => r.data.length,
  );
  const count = (k: string) =>
    k === 'mine'
      ? all
      : k === 'all'
        ? Object.values(list.counts).reduce((t, n) => t + n, 0)
        : (list.counts[k] ?? 0);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return (
    <>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {list.levelsInUse ? (
          <>
            Each refund waits at the levels set on{' '}
            <a href="/fees/approval#admission-refund">Fees → Approval</a>; after the last one,
            Accounts pay it out with a voucher.
          </>
        ) : (
          <>
            The approval levels are switched off on{' '}
            <a href="/fees/approval#admission-refund">Fees → Approval</a>: a refund approver decides
            each refund in one step.
          </>
        )}
      </p>
      <nav className="ep-lead-views" aria-label="Show" style={{ marginBottom: 'var(--sp-3)' }}>
        {VIEWS.map(([k, label]) => (
          <a key={k} href={`${base}?view=${k}`} aria-current={v === k ? 'page' : undefined}>
            {label} ({count(k)})
          </a>
        ))}
      </nav>
      <Card>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>
            {v === 'mine' ? 'No refund waits for you.' : 'No refund here.'}
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Admission fee refunds (scrolls sideways)"
          >
            <table className="ep-table">
              <caption className="ep-sr-only">Admission fee refunds</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Refund</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <strong>{x.candidate ?? x.number}</strong>
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {x.admissionNo ?? x.number} · {x.className} · {x.session}
                      </div>
                    </td>
                    <td>
                      <strong>{rupees(x.amount)}</strong>
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {rupees(x.paidAmount)} paid ({x.receiptNo}) less {x.deductionPct}% (
                        {rupees(x.deduction)})
                      </div>
                    </td>
                    <td>
                      {x.reason}
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {x.requestedBy ?? ''} · {dmy(x.requestedAt)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={TONE[x.status] ?? 'info'}>{LABEL[x.status] ?? x.status}</Badge>
                      {x.approval?.waitingWith ? (
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          Waiting at {x.approval.waitingWith}
                          {x.approval.since ? ` · since ${dmy(x.approval.since)}` : ''}
                        </div>
                      ) : null}
                      {x.approval?.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                      {x.approval?.steps
                        .filter((s) => s.actedBy)
                        .map((s) => (
                          <div key={s.level} className="ep-field__help" style={{ margin: 0 }}>
                            {s.name}: {s.status === 'approved' ? 'approved' : s.status} by{' '}
                            {s.actedBy}
                            {s.note ? ` (${s.note})` : ''}
                          </div>
                        ))}
                      {!x.approval && x.decidedBy ? (
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          {x.decidedBy} · {dmy(x.decidedAt)}
                          {x.decisionNote ? ` · ${x.decisionNote}` : ''}
                        </div>
                      ) : null}
                      {x.paidOn ? (
                        <div className="ep-field__help" style={{ margin: 0 }}>
                          Paid {dmy(x.paidOn)} · {MODE[x.mode ?? ''] ?? x.mode}
                          {x.reference ? ` · ${x.reference}` : ''}
                          {x.paidBy ? ` · by ${x.paidBy}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {x.hasVoucher ? (
                        <FileLinks
                          href={`/api/admission-refunds/${x.id}/voucher`}
                          label="Refund voucher"
                        />
                      ) : (
                        <RefundActions
                          id={x.id}
                          mayDecide={x.mayDecide}
                          mayPay={x.mayPay}
                          today={today}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
