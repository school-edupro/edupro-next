import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { MiscCollectForm, type MiscPayLine } from '@/components/fees/MiscCollectForm';
import { MISC_KIND } from '@/components/fees/MiscRequests';
import { Notice } from '@/components/Notice';
import { rupees } from '@/components/RegisterTools';
import { apiFetch, getMe } from '@/lib/api';
import { miscCollect, miscReceiptRequest } from '@/lib/misc-fee-actions';

interface Found {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  father: string | null;
}
interface Receipt {
  id: string;
  receiptNo: string;
  receivedOn: string;
  amount: string;
  refunded: string;
  mode: string;
  status: 'posted' | 'reversed' | 'bounced';
  title: string;
  announced: boolean;
  waiting: string | null;
  instrumentNo: string | null;
  bankName: string | null;
  reference: string | null;
  receivedBy: string | null;
}
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');

const RECEIPT: Record<Receipt['status'], [string, 'success' | 'danger' | 'neutral']> = {
  posted: ['Received', 'success'],
  bounced: ['Cheque bounced', 'danger'],
  reversed: ['Cancelled', 'neutral'],
};

/** One misc receipt, laid out as a fee receipt on the pupil's fee page: what it is, then what can be asked. */
function MiscReceiptRow({
  r,
  studentId,
  canAsk,
}: {
  r: Receipt;
  studentId: string;
  canAsk: boolean;
}) {
  const left = Number(r.amount) - Number(r.refunded);
  const cheque = r.mode === 'cheque' || r.mode === 'dd';
  const [label, tone] =
    r.status === 'posted' && left <= 0 ? (['Refunded', 'neutral'] as const) : RECEIPT[r.status];
  const untouched = Number(r.refunded) === 0;
  const hidden = (kind: string) => (
    <>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="receiptId" value={r.id} />
      <input type="hidden" name="kind" value={kind} />
    </>
  );
  return (
    <div className="ep-card" style={{ padding: 'var(--sp-3)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <div>
          <strong>{r.receiptNo}</strong> · {dmy(r.receivedOn)} · <strong>{rupees(r.amount)}</strong>{' '}
          <Badge tone={tone}>{label}</Badge>
          <div className="ep-field__help">
            {r.title} · {r.mode.toUpperCase()}
            {r.instrumentNo ? ` no. ${r.instrumentNo}` : ''}
            {r.bankName ? `, ${r.bankName}` : ''}
            {r.reference ? ` · Ref. ${r.reference}` : ''}
            {Number(r.refunded) > 0 ? ` · refunded ${rupees(r.refunded)}` : ''}
            {r.receivedBy ? ` · by ${r.receivedBy}` : ''}
          </div>
        </div>
        <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/fees/misc-fees/receipt/${r.id}`}>
          Print receipt
        </a>
      </div>
      {r.waiting ? (
        <div className="ep-alert ep-alert--info" role="status" style={{ marginTop: 'var(--sp-3)' }}>
          Waiting for approval: {MISC_KIND[r.waiting] ?? r.waiting}. Nothing else can be asked on
          this receipt until this is decided (Misc fees → Requests, or My approvals).
        </div>
      ) : null}
      {!r.waiting && r.status === 'posted' && left > 0 && canAsk && r.announced ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-4)',
            flexWrap: 'wrap',
            marginTop: 'var(--sp-3)',
          }}
        >
          {untouched ? (
            <details>
              <summary>Cancel this receipt</summary>
              <form action={miscReceiptRequest} style={{ marginTop: 'var(--sp-2)' }}>
                {hidden('receipt_cancel')}
                <label className="ep-field">
                  <span className="ep-field__label">Why is it cancelled? *</span>
                  <input
                    className="ep-input"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Send cancellation for approval
                </button>
              </form>
            </details>
          ) : null}
          {untouched && cheque ? (
            <details>
              <summary>Cheque bounced</summary>
              <form action={miscReceiptRequest} style={{ marginTop: 'var(--sp-2)' }}>
                {hidden('receipt_bounce')}
                <label className="ep-field">
                  <span className="ep-field__label">Bank’s reason *</span>
                  <input
                    className="ep-input"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="Funds insufficient"
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Send bounce for approval
                </button>
              </form>
            </details>
          ) : null}
          <details>
            <summary>Refund (all or part)</summary>
            <form
              action={miscReceiptRequest}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
                gap: 'var(--sp-3)',
                alignItems: 'end',
                marginTop: 'var(--sp-2)',
              }}
            >
              {hidden('receipt_refund')}
              <label className="ep-field">
                <span className="ep-field__label">Amount to refund (₹) *</span>
                <input
                  className="ep-input"
                  name="amount"
                  type="number"
                  min={0.01}
                  max={left}
                  step="0.01"
                  defaultValue={left}
                  required
                />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Pay back by</span>
                <select className="ep-select" name="refundMode" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Cheque no. / UTR</span>
                <input className="ep-input" name="reference" maxLength={80} />
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Reason *</span>
                <input className="ep-input" name="reason" required minLength={3} maxLength={300} />
              </label>
              <div>
                <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                  Send refund for approval
                </button>
              </div>
            </form>
          </details>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The counter for misc fees: find the pupil, receive what is announced for them, and ask for a receipt
 * to be cancelled, marked bounced or refunded (each by approval).
 */
export default async function MiscCollectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canPost = me.permissions.includes('fees.misc.post');
  const q = (sp.q ?? '').trim();
  const studentId = /^\d{1,18}$/.test(sp.studentId ?? '') ? sp.studentId! : '';
  const found =
    !studentId && q.length >= 2
      ? await apiFetch<{ data: Found[] }>(`/fees/cashier/search?q=${encodeURIComponent(q)}`).then(
          (r) => r.data,
        )
      : [];
  const exact = found.filter((f) => f.admissionNo.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) redirect(`/fees/misc-fees/collect?studentId=${exact[0]!.id}`);
  const data = studentId
    ? await apiFetch<{
        student: { id: string; name: string; admissionNo: string; class: string | null };
        lines: MiscPayLine[];
        receipts: Receipt[];
      }>(`/fees/misc-fees/student/${studentId}`)
    : null;
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        kicker="Fees · Misc fees"
        title="Counter collection"
        description="Find the pupil by name or admission number, receive the misc fees announced for them, and print the receipt."
      />
      <Notice params={sp} />
      <Card title="Find the pupil">
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="q" style={{ margin: 0 }}>
            <span className="ep-field__label">Name or admission number</span>
            <input id="q" name="q" className="ep-input" defaultValue={q} maxLength={60} />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Find
          </button>
          <a className="ep-btn ep-btn--ghost" href="/fees/misc-fees">
            All misc fees
          </a>
        </form>
        {!studentId && q.length >= 2 ? (
          found.length === 0 ? (
            <p className="ep-field__help">Nobody found.</p>
          ) : (
            <ul>
              {found.slice(0, 30).map((f) => (
                <li key={f.id}>
                  <a href={`/fees/misc-fees/collect?studentId=${f.id}`}>
                    {f.name} · {f.admissionNo}
                  </a>
                  {f.section ? ` · ${f.section}` : ''}
                  {f.father ? ` · ${f.father}` : ''}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>
      {data ? (
        <>
          <Card
            title={`${data.student.name} · ${data.student.admissionNo}${data.student.class ? ` · ${data.student.class}` : ''}`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <p className="ep-field__help">
              <a href={`/fees/ledger/${data.student.id}?tab=pay`}>School fee of this pupil</a>
            </p>
            {data.lines.length === 0 ? (
              <p className="ep-field__help">No misc fee is announced for this pupil.</p>
            ) : canPost ? (
              <MiscCollectForm
                action={miscCollect}
                studentId={data.student.id}
                lines={data.lines}
                today={today}
              />
            ) : (
              <p className="ep-field__help">You can see the fees but not receive them.</p>
            )}
          </Card>
          <Card title="Misc receipts of the pupil" style={{ marginTop: 'var(--sp-4)' }}>
            {data.receipts.length === 0 ? (
              <p className="ep-field__help">No misc receipt yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                {data.receipts.map((r) => (
                  <MiscReceiptRow key={r.id} r={r} studentId={data.student.id} canAsk={canPost} />
                ))}
              </div>
            )}
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              Cancelling a receipt, a bounced cheque and a refund are asked here with a reason and
              approved through Fee setup → Approval levels (Misc fees → Requests, or My approvals).
              A receipt is never deleted: it stays in the list marked Cancelled or Cheque bounced.
            </p>
          </Card>
        </>
      ) : null}
    </>
  );
}
