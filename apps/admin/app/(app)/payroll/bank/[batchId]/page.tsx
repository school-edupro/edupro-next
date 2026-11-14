import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { monthName } from '@/lib/payroll-inputs';
import { BATCH_WORD, dmy, type BatchDetail } from '@/lib/payroll-pay';
import { batchAction, returnLine } from '@/lib/payroll-pay-actions';
import { TYPE_WORD } from '@/lib/payroll-runs';

const LINE_WORD = {
  SENT: 'Sent',
  REJECTED: 'Returned by the bank',
  CANCELLED: 'Cancelled',
} as const;
const LINE_TONE = { SENT: 'neutral', REJECTED: 'danger', CANCELLED: 'warning' } as const;

/**
 * A bank file (docs/design/86, phase C step 1): download it (the file as made, or the bank letter), mark it uploaded
 * to the bank, confirm it with the bank's UTR — the salaries paid —, cancel it before upload, record a payment the
 * bank returned. A payroll checker's page.
 */
export default async function BankFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { batchId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(batchId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.approve')) notFound();
  let d: BatchDetail;
  try {
    d = await apiFetch<BatchDetail>(`/payroll/bank/batches/${batchId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const b = d.batch;
  const returned = d.lines.filter((l) => l.status === 'REJECTED').length;
  const file = (as: string) => `/api/payroll/pay-file?kind=bank&id=${batchId}&as=${as}`;
  const runLabel = `${monthName(b.month)} · ${TYPE_WORD[b.runType as keyof typeof TYPE_WORD] ?? b.runType}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Pay runs', href: '/payroll/runs' },
          { label: runLabel, href: `/payroll/runs/${b.runId}` },
          { label: 'Payments', href: `/payroll/runs/${b.runId}/bank` },
          { label: `File ${String(b.seq)}` },
        ]}
      />
      <PageHeader
        kicker="Bank file"
        title={`File ${String(b.seq)} · ${b.bankCode ?? 'every bank'}`}
        description={[
          b.formatWords,
          b.debitBankName ? `from ${b.debitBankName}` : null,
          b.debitAccount ? `account ${b.debitAccount}` : null,
          b.valueDate ? `value date ${dmy(b.valueDate)}` : `made on ${dmy(b.madeOn)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Notice params={sp} />
      {b.status === 'GENERATED' && !['LOCKED', 'PAID'].includes(b.stage) ? (
        <p className="ep-alert ep-alert--warning" role="status">
          PROVISIONAL — the run is approved but not locked. Check the file, then lock the run before
          it goes to the bank.
        </p>
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Payments" value={String(b.txnCount)} />
        <KpiTile label="Amount" value={`₹${money(b.total)}`} />
        <KpiTile label="Status" value={BATCH_WORD[b.status]} />
        <KpiTile label="Returned by the bank" value={String(returned)} />
      </div>
      <section className="ep-card" aria-labelledby="bf-do">
        <h2 id="bf-do" className="ep-card__title">
          {b.status === 'GENERATED'
            ? 'Download, upload to the bank, then mark it uploaded'
            : b.status === 'UPLOADED'
              ? 'When the bank has paid: confirm with its UTR'
              : b.status === 'CONFIRMED'
                ? `Paid · UTR ${b.utr ?? ''}`
                : 'Cancelled'}
        </h2>
        {d.can.download ? (
          <div className="ep-grid__toolbar">
            {b.fileFormat === 'BANK_LETTER' ? null : (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('file')} download>
                Download the bank file
              </a>
            )}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('letter')} download>
              Bank letter (Excel)
            </a>
            <span className="ep-field__help">Bank letter (PDF)</span>
            <FileLinks href={file('pdf')} label={`the bank letter of file ${String(b.seq)}`} />
          </div>
        ) : null}
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          {d.can.upload ? (
            <form action={batchAction.bind(null, batchId, 'uploaded')}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Mark uploaded to the bank
              </button>
            </form>
          ) : null}
          {d.can.confirm ? (
            <DialogButton
              id="bf-confirm"
              label="Confirm: the bank paid"
              title={`Confirm file ${String(b.seq)}`}
            >
              <form
                action={batchAction.bind(null, batchId, 'confirm')}
                className="ep-form-section__body"
              >
                <p className="ep-field__help">
                  Every salary in the file is marked paid with this UTR. A payment the bank returns
                  later is recorded on its line below.
                </p>
                <label className="ep-field" htmlFor="bf-utr">
                  <span className="ep-field__label">UTR (the bank’s reference)</span>
                  <input
                    id="bf-utr"
                    name="utr"
                    className="ep-input"
                    required
                    minLength={4}
                    maxLength={60}
                  />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Confirm
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
          {d.can.cancel ? (
            <DialogButton
              id="bf-cancel"
              label="Cancel the file"
              title={`Cancel file ${String(b.seq)}`}
              className="ep-btn ep-btn--danger"
            >
              <form
                action={batchAction.bind(null, batchId, 'cancel')}
                className="ep-form-section__body"
              >
                <p className="ep-field__help">
                  Only a file not yet uploaded is cancelled. Its salaries can then go in a new file.
                </p>
                <label className="ep-field" htmlFor="bf-why">
                  <span className="ep-field__label">Why</span>
                  <textarea
                    id="bf-why"
                    name="reason"
                    className="ep-input"
                    rows={3}
                    required
                    minLength={10}
                    maxLength={300}
                  />
                </label>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Cancel the file
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
          {b.status === 'GENERATED' && !d.can.upload ? (
            <span className="ep-field__help">Lock the run, then mark the file uploaded.</span>
          ) : null}
        </div>
      </section>
      <section className="ep-card" aria-labelledby="bf-lines" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="bf-lines" className="ep-card__title">
          The payments
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="bf-lines">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">No.</th>
                <th scope="col">Emp. ID</th>
                <th scope="col">Name</th>
                <th scope="col">IFSC</th>
                <th scope="col">Account</th>
                <th scope="col">Amount (₹)</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.lineNo}</td>
                  <td>{l.code}</td>
                  <td>{l.name}</td>
                  <td>{l.ifsc ?? '—'}</td>
                  <td>{l.accountMasked}</td>
                  <td>{money(l.amount)}</td>
                  <td>
                    <Badge tone={LINE_TONE[l.status]}>{LINE_WORD[l.status]}</Badge>
                    {l.rejectReason ? <div className="ep-field__help">{l.rejectReason}</div> : null}
                  </td>
                  <td>
                    {d.can.reject && l.status === 'SENT' ? (
                      <DialogButton
                        id={`bf-ret-${l.id}`}
                        label="Returned"
                        title={`Returned by the bank: ${l.code}`}
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                      >
                        <form
                          action={returnLine.bind(null, batchId, l.id)}
                          className="ep-form-section__body"
                        >
                          <p className="ep-field__help">
                            The salary is held and no longer paid. Correct the account on the
                            employee record if needed, then release the salary on the run: the next
                            bank file pays it to the current account.
                          </p>
                          <label className="ep-field" htmlFor={`bf-rr-${l.id}`}>
                            <span className="ep-field__label">The bank’s reason</span>
                            <input
                              id={`bf-rr-${l.id}`}
                              name="reason"
                              className="ep-input"
                              required
                              minLength={3}
                              maxLength={180}
                            />
                          </label>
                          <div className="ep-grid__toolbar">
                            <button type="submit" className="ep-btn ep-btn--danger">
                              Record as returned
                            </button>
                          </div>
                        </form>
                      </DialogButton>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
