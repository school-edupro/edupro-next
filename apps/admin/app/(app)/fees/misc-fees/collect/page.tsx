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
}
const dmy = (v: string) => v.slice(0, 10).split('-').reverse().join('-');

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
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Misc receipts of the pupil"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Misc receipts of the pupil</caption>
                  <thead>
                    <tr>
                      <th scope="col">Receipt no.</th>
                      <th scope="col">Date</th>
                      <th scope="col">Fee</th>
                      <th scope="col">Mode</th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Amount
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        Refunded
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.receipts.map((r) => {
                      const left = Number(r.amount) - Number(r.refunded);
                      const cheque = r.mode === 'cheque' || r.mode === 'dd';
                      return (
                        <tr key={r.id}>
                          <td>
                            <a href={`/fees/misc-fees/receipt/${r.id}`}>
                              <strong>{r.receiptNo}</strong>
                            </a>
                          </td>
                          <td>{dmy(r.receivedOn)}</td>
                          <td>{r.title}</td>
                          <td>{r.mode.toUpperCase()}</td>
                          <td style={{ textAlign: 'right' }}>{rupees(r.amount)}</td>
                          <td style={{ textAlign: 'right' }}>
                            {Number(r.refunded) ? rupees(r.refunded) : '—'}
                          </td>
                          <td>
                            <Badge
                              tone={
                                r.status === 'posted'
                                  ? 'success'
                                  : r.status === 'bounced'
                                    ? 'danger'
                                    : 'neutral'
                              }
                            >
                              {r.status === 'posted'
                                ? left <= 0
                                  ? 'Refunded'
                                  : 'Received'
                                : r.status === 'bounced'
                                  ? 'Bounced'
                                  : 'Cancelled'}
                            </Badge>
                          </td>
                          <td>
                            {r.waiting ? (
                              `Waiting for approval: ${MISC_KIND[r.waiting] ?? r.waiting}`
                            ) : r.status !== 'posted' || left <= 0 || !canPost || !r.announced ? (
                              '—'
                            ) : (
                              <details>
                                <summary>Cancel, bounce or refund</summary>
                                <form
                                  action={miscReceiptRequest}
                                  style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: '15rem' }}
                                >
                                  <input type="hidden" name="studentId" value={data.student.id} />
                                  <input type="hidden" name="receiptId" value={r.id} />
                                  <select
                                    name="kind"
                                    className="ep-select"
                                    aria-label={`What to do with receipt ${r.receiptNo}`}
                                    defaultValue="receipt_refund"
                                  >
                                    <option value="receipt_refund">Refund (all or part)</option>
                                    {Number(r.refunded) === 0 ? (
                                      <option value="receipt_cancel">Cancel the receipt</option>
                                    ) : null}
                                    {cheque && Number(r.refunded) === 0 ? (
                                      <option value="receipt_bounce">Cheque bounced</option>
                                    ) : null}
                                  </select>
                                  <input
                                    name="amount"
                                    type="number"
                                    min={0.01}
                                    max={left}
                                    step="0.01"
                                    className="ep-input"
                                    defaultValue={left}
                                    aria-label={`Refund amount of receipt ${r.receiptNo}`}
                                  />
                                  <select
                                    name="refundMode"
                                    className="ep-select"
                                    aria-label={`Refund mode of receipt ${r.receiptNo}`}
                                  >
                                    <option value="cash">Refund in cash</option>
                                    <option value="bank">Refund by bank transfer</option>
                                    <option value="cheque">Refund by cheque</option>
                                  </select>
                                  <input
                                    name="reason"
                                    className="ep-input"
                                    required
                                    minLength={3}
                                    maxLength={300}
                                    placeholder="Reason"
                                    aria-label={`Reason for receipt ${r.receiptNo}`}
                                  />
                                  <button
                                    type="submit"
                                    className="ep-btn ep-btn--secondary ep-btn--sm"
                                  >
                                    Send for approval
                                  </button>
                                  <span className="ep-field__help">
                                    Amount and refund mode count only for a refund.
                                  </span>
                                </form>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
