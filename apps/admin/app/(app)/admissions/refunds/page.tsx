import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { RefundActions } from '@/components/admissions/RefundActions';
import { Notice } from '@/components/Notice';
import { dmy, rupees } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';

interface Refund {
  id: string;
  applicationId: string;
  number: string | null;
  admissionNo: string | null;
  candidate: string | null;
  className: string;
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
}
const TONE: Record<string, 'warning' | 'info' | 'danger' | 'success'> = {
  requested: 'warning',
  approved: 'info',
  rejected: 'danger',
  paid: 'success',
};

/** Admission fee refunds of cancelled admissions (docs/design/39, part 6): approve, reject, mark paid. */
export default async function AdmissionRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  const status = ['requested', 'approved', 'rejected', 'paid'].includes(sp.status ?? '')
    ? sp.status
    : undefined;
  const list = await apiFetch<{ data: Refund[] }>(
    `/admissions/refunds${status ? `?status=${status}` : ''}`,
  );
  const canDecide = me.permissions.includes('fees.refund.approve');
  const sum = (s: string) =>
    list.data.filter((x) => x.status === s).reduce((t, x) => t + x.amount, 0);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission fee refunds"
        description="When an admission is cancelled after the admission fee, the fee less the session's deduction is refunded once the fee refund approvers agree. The registration fee is not refunded."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        {(['requested', 'approved', 'paid', 'rejected'] as const).map((s) => (
          <a
            key={s}
            href={`/admissions/refunds?status=${s}`}
            className="ep-tile-link"
            aria-label={`${s}: ${rupees(sum(s))}. Show the list`}
          >
            <Card
              title={
                s === 'requested'
                  ? 'Waiting for approval'
                  : s === 'approved'
                    ? 'Approved, to pay'
                    : s === 'paid'
                      ? 'Paid'
                      : 'Rejected'
              }
            >
              <div className="ep-cdash__big">{rupees(sum(s))}</div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                {list.data.filter((x) => x.status === s).length} refund(s)
              </p>
            </Card>
          </a>
        ))}
      </div>
      <Card elevated title={status ? `Refunds: ${status}` : 'All refunds'}>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>No refund.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Admission fee refunds</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Receipt</th>
                  <th scope="col">Refund</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  {canDecide ? <th scope="col">Action</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.data.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <a href={`/admissions/registrations/${x.applicationId}`}>
                        {x.candidate ?? x.number}
                      </a>
                      <div className="ep-kicker">
                        {x.admissionNo ?? x.number} · {x.className}
                      </div>
                    </td>
                    <td>
                      {x.receiptNo}
                      <div className="ep-kicker">{rupees(x.paidAmount)}</div>
                    </td>
                    <td>
                      <strong>{rupees(x.amount)}</strong>
                      <div className="ep-kicker">
                        less {x.deductionPct}% ({rupees(x.deduction)})
                      </div>
                    </td>
                    <td>
                      {x.reason}
                      <div className="ep-kicker">
                        {x.requestedBy ?? ''} · {dmy(x.requestedAt)}
                      </div>
                    </td>
                    <td>
                      <Badge tone={TONE[x.status] ?? 'info'}>{x.status}</Badge>
                      {x.decidedBy ? (
                        <div className="ep-kicker">
                          {x.decidedBy} · {dmy(x.decidedAt)}
                          {x.decisionNote ? ` · ${x.decisionNote}` : ''}
                        </div>
                      ) : null}
                      {x.paidOn ? (
                        <div className="ep-kicker">
                          Paid {dmy(x.paidOn)} · {x.mode}
                          {x.reference ? ` · ${x.reference}` : ''}
                        </div>
                      ) : null}
                    </td>
                    {canDecide ? (
                      <td>
                        <RefundActions id={x.id} status={x.status} />
                      </td>
                    ) : null}
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
