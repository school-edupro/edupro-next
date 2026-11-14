import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { BATCH_TONE, BATCH_WORD, FORMAT_WORD, dmy, type BankPreview } from '@/lib/payroll-pay';
import { makeBankFile, markPaid } from '@/lib/payroll-pay-actions';
import { TYPE_WORD, type RunDetail } from '@/lib/payroll-runs';

/**
 * A run's payments (docs/design/86, phase C step 1; legacy Bank Batches): what is still to pay by bank, by bank, with
 * the file each bank takes; the bank files made; the cash and cheque salaries marked paid with their voucher number.
 * A payroll checker's page.
 */
export default async function RunBankPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.approve')) notFound();
  let d: BankPreview;
  let run: RunDetail;
  try {
    run = await apiFetch<RunDetail>(`/payroll/runs/${id}`);
    d = await apiFetch<BankPreview>(`/payroll/runs/${id}/bank`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const r = run.run;
  const toPay = d.payable.reduce((s, p) => s + Number(p.amount), 0);
  const cashLeft = d.cash.filter((c) => c.status !== 'PAID');
  const open = ['APPROVED', 'LOCKED', 'PAID'].includes(r.stage);
  const today = new Date().toISOString().slice(0, 10);
  const makeForm = (code: string, label: string, key: string) => (
    <DialogButton
      id={`bk-make-${key}`}
      label={label}
      title={`Make the bank file: ${label.replace('Make the file', '').trim() || 'this bank'}`}
    >
      <form action={makeBankFile.bind(null, id)} className="ep-form-section__body">
        <input type="hidden" name="bankCode" value={code} />
        <p className="ep-field__help">
          The file carries each salary with the account copied when the run was worked out (or, for
          a payment the bank returned, the employee’s current account). Once made, these salaries
          are in this file only.
          {d.run.provisional
            ? ' The run is only approved: lock it before the file goes to the bank.'
            : ''}
        </p>
        <label className="ep-field" htmlFor={`bk-vd-${key}`}>
          <span className="ep-field__label">Value date (optional)</span>
          <input
            id={`bk-vd-${key}`}
            name="valueDate"
            type="date"
            className="ep-input"
            min={today}
          />
        </label>
        <div className="ep-grid__toolbar">
          <button type="submit" className="ep-btn ep-btn--primary">
            Make the file
          </button>
        </div>
      </form>
    </DialogButton>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Pay runs', href: '/payroll/runs' },
          { label: `${run.monthWords} · ${TYPE_WORD[r.runType]}`, href: `/payroll/runs/${id}` },
          { label: 'Payments' },
        ]}
      />
      <PageHeader
        kicker="Payments"
        title={`${run.monthWords} · ${TYPE_WORD[r.runType]}`}
        description="Pay the salaries: a bank file for each bank (uploaded, then confirmed with the bank’s UTR), and the cash and cheque salaries marked paid."
      />
      <Notice params={sp} />
      {d.run.provisional ? (
        <p className="ep-alert ep-alert--warning" role="status">
          PROVISIONAL — the run is approved but not locked. A bank file can be made to check it; it
          goes to the bank only after the run is locked.
        </p>
      ) : null}
      {!open ? (
        <p className="ep-alert ep-alert--info" role="status">
          Payments start once the run is approved.
        </p>
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="To pay by bank" value={`₹${money(toPay.toFixed(2))}`} />
        <KpiTile
          label="Salaries paid"
          value={`${String(d.paid.count)} · ₹${money(d.paid.total)}`}
        />
        <KpiTile
          label="Bank files"
          value={String(d.batches.filter((b) => b.status !== 'CANCELLED').length)}
        />
        <KpiTile label="Cash and cheque to pay" value={String(cashLeft.length)} />
      </div>
      {d.noAccount.length ? (
        <p className="ep-alert ep-alert--warning" role="status">
          No bank account for {d.noAccount.slice(0, 10).join(', ')}
          {d.noAccount.length > 10 ? ' …' : ''}: add it on the employee record, or hold the salary,
          before the file is made.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="bk-make">
        <h2 id="bk-make" className="ep-card__title">
          Still to pay by bank
        </h2>
        {d.groups.length ? (
          <>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="bk-make">
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Bank</th>
                    <th scope="col">Salaries</th>
                    <th scope="col">Amount (₹)</th>
                    <th scope="col">File</th>
                    <th scope="col">
                      <span className="ep-sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.groups.map((g) => (
                    <tr key={g.bankCode ?? 'none'}>
                      <td>
                        {g.bankCode ? (
                          <>
                            <strong>{g.bankCode}</strong>
                            {g.bankName ? ` · ${g.bankName}` : ''}
                          </>
                        ) : (
                          'No IFSC on the record'
                        )}
                      </td>
                      <td>{g.count}</td>
                      <td>{money(g.total)}</td>
                      <td>
                        {FORMAT_WORD[g.fileFormat] ?? g.fileFormat}
                        {g.accountSet ? null : (
                          <>
                            {' '}
                            <Badge tone="neutral">No account set: the default file</Badge>
                          </>
                        )}
                      </td>
                      <td>
                        {g.bankCode && d.can.generate
                          ? makeForm(g.bankCode, 'Make the file', g.bankCode)
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.can.generate && d.groups.length > 1 ? (
              <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
                {makeForm('ALL', 'One file for every bank', 'all')}
              </div>
            ) : null}
          </>
        ) : (
          <p>{open ? 'Nothing is left to pay by bank in this run.' : 'Nothing yet.'}</p>
        )}
        <p className="ep-field__help">
          The school’s accounts and each bank’s file layout are in{' '}
          <a href="/payroll/setup/bank">Payroll set-up → Bank accounts</a>.
        </p>
      </section>
      <section className="ep-card" aria-labelledby="bk-files" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="bk-files" className="ep-card__title">
          Bank files
        </h2>
        {d.batches.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="bk-files">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Bank</th>
                  <th scope="col">Payments</th>
                  <th scope="col">Amount (₹)</th>
                  <th scope="col">Status</th>
                  <th scope="col">UTR</th>
                  <th scope="col">Made</th>
                </tr>
              </thead>
              <tbody>
                {d.batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <a href={`/payroll/bank/${b.id}`}>File {b.seq}</a>
                    </td>
                    <td>{b.bankCode ?? 'Every bank'}</td>
                    <td>
                      {b.txnCount}
                      {b.returned ? ` (${String(b.returned)} returned)` : ''}
                    </td>
                    <td>{money(b.total)}</td>
                    <td>
                      <Badge tone={BATCH_TONE[b.status]}>{BATCH_WORD[b.status]}</Badge>
                      {b.provisional && b.status === 'GENERATED' ? (
                        <>
                          {' '}
                          <Badge tone="warning">Provisional</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{b.utr ?? '—'}</td>
                    <td>
                      {dmy(String(b.createdAt).slice(0, 10))}
                      {b.createdByName ? ` · ${b.createdByName}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No bank file yet.</p>
        )}
      </section>
      <section className="ep-card" aria-labelledby="bk-cash" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="bk-cash" className="ep-card__title">
          Cash and cheque
        </h2>
        {d.cash.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="bk-cash">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Emp. ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">Paid by</th>
                  <th scope="col">Amount (₹)</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.cash.map((c) => (
                  <tr key={c.recordId}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>{c.mode === 'CASH' ? 'Cash' : 'Cheque'}</td>
                    <td>{money(c.amount)}</td>
                    <td>
                      {c.status === 'PAID' ? (
                        <Badge tone="success">{`Paid · ${c.paymentRef ?? ''}`}</Badge>
                      ) : (
                        <Badge tone="neutral">To pay</Badge>
                      )}
                    </td>
                    <td>
                      {c.status !== 'PAID' && d.can.pay ? (
                        <DialogButton
                          id={`bk-paid-${c.recordId}`}
                          label="Mark paid"
                          title={`Paid: ${c.code}`}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <form
                            action={markPaid.bind(null, id, c.recordId, c.mode)}
                            className="ep-form-section__body"
                          >
                            <label className="ep-field" htmlFor={`bk-ref-${c.recordId}`}>
                              <span className="ep-field__label">
                                {c.mode === 'CASH' ? 'Voucher number' : 'Cheque number'}
                              </span>
                              <input
                                id={`bk-ref-${c.recordId}`}
                                name="reference"
                                className="ep-input"
                                required
                                minLength={3}
                                maxLength={60}
                              />
                            </label>
                            <div className="ep-grid__toolbar">
                              <button type="submit" className="ep-btn ep-btn--primary">
                                Mark paid
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
        ) : (
          <p>No one in this run is paid in cash or by cheque.</p>
        )}
        {!d.can.pay && cashLeft.length ? (
          <p className="ep-field__help">
            Cash and cheque salaries are marked paid once the run is locked.
          </p>
        ) : null}
      </section>
      {d.payable.length ? (
        <FoldCard
          id="bk-who"
          title="Who is paid by bank"
          hint={`${String(d.payable.length)} salary(ies) still to pay; open to see each account (masked)`}
        >
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Who is paid by bank"
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Emp. ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">IFSC</th>
                  <th scope="col">Account</th>
                  <th scope="col">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {d.payable.map((p) => (
                  <tr key={p.recordId}>
                    <td>{p.code}</td>
                    <td>
                      {p.name}
                      {p.reissue ? (
                        <>
                          {' '}
                          <Badge tone="info">Paid again: returned by the bank</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>{p.ifsc ?? '—'}</td>
                    <td>
                      {p.noAccount ? <Badge tone="danger">No account</Badge> : p.accountMasked}
                    </td>
                    <td>{money(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FoldCard>
      ) : null}
    </>
  );
}
