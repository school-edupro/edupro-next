import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { inr, REQUISITION_STATUS, TIER, type RequisitionDetail } from '@/lib/purchase';
import {
  approveRequisition,
  rejectRequisition,
  sendBackRequisition,
  signRequisition,
  unsignRequisition,
} from '@/lib/purchase-actions';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/**
 * One Purchase Requisition in the staff app (docs/design/83, part 3): the lines with the vendor chosen
 * for each, the comparative statement (L1 marked), the committee's signatures; an approver decides it,
 * a committee member signs the statement.
 */
export default async function StaffRequisitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  let pr: RequisitionDetail;
  try {
    pr = await bff.api.fetch<RequisitionDetail>(`/purchase/requisitions/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  const st = REQUISITION_STATUS[pr.status];
  const buy = pr.lineItems.filter((l) => l.fulfil === 'buy');
  const quoted = (lineId: string, vendorId: string) =>
    pr.quotes.find((q) => q.vendorId === vendorId)?.lines.find((x) => x.lineId === lineId);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase/requisitions" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Purchase requisitions')}
        </a>
      </p>
      <PageHeader
        kicker={`${t(lang, 'Purchase requisitions')} · ${pr.department ?? ''}`}
        title={pr.number}
        description={pr.purpose ?? undefined}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card title={t(lang, 'Status')}>
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge> <strong>{inr(pr.estimate)}</strong> ·{' '}
            {TIER[pr.tier ?? 'none'].label}
          </p>
          {pr.status === 'submitted' && pr.waitingWith ? <p>With {pr.waitingWith}.</p> : null}
          <p className="ep-field__help">{TIER[pr.tier ?? 'none'].help}</p>
          <p style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            {t(lang, 'Print')}{' '}
            <FileLinks
              url={`/api/purchase-requisition/${pr.id}`}
              saveUrl={`/api/purchase-requisition/${pr.id}?save=1`}
              label={`${pr.number} as a PDF`}
            />
          </p>
        </Card>

        {pr.can.decide ? (
          <Card title={t(lang, 'Your decision')}>
            <form action={approveRequisition} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={pr.id} />
              <label className="ep-field" htmlFor="rd-note">
                <span className="ep-field__label">
                  {t(lang, 'Remark (needed to send back or reject)')}
                </span>
                <textarea
                  id="rd-note"
                  name="reason"
                  className="ep-input"
                  rows={2}
                  maxLength={500}
                />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  formAction={approveRequisition}
                  className="ep-btn ep-btn--primary"
                >
                  {t(lang, 'Approve')}
                </button>
                <button
                  type="submit"
                  formAction={sendBackRequisition}
                  className="ep-btn ep-btn--secondary"
                >
                  {t(lang, 'Send back')}
                </button>
                <button
                  type="submit"
                  formAction={rejectRequisition}
                  className="ep-btn ep-btn--danger"
                >
                  {t(lang, 'Reject')}
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        {pr.can.sign || pr.can.unsign ? (
          <Card title={t(lang, 'Your signature (purchase committee)')}>
            {pr.can.sign ? (
              <form action={signRequisition} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={pr.id} />
                <p style={{ margin: 0 }}>
                  {t(lang, 'You confirm the quotes below and the vendor chosen for each line.')}
                </p>
                <label className="ep-field" htmlFor="rs-note">
                  <span className="ep-field__label">{t(lang, 'Remark (optional)')}</span>
                  <input id="rs-note" name="reason" className="ep-input" maxLength={300} />
                </label>
                <div>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    {t(lang, 'Sign the comparative statement')}
                  </button>
                </div>
              </form>
            ) : (
              <form action={unsignRequisition}>
                <input type="hidden" name="id" value={pr.id} />
                <p style={{ marginTop: 0 }}>{t(lang, 'You have signed it.')}</p>
                <button type="submit" className="ep-btn ep-btn--ghost">
                  {t(lang, 'Withdraw my signature')}
                </button>
              </form>
            )}
          </Card>
        ) : null}

        <Card title={t(lang, 'Lines')}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t(lang, 'Lines')}>
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Vendor</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {pr.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.item}
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {l.quantity} {l.uom}
                        {l.sources.length
                          ? ` · from ${l.sources.map((s) => s.number).join(', ')}`
                          : ''}
                      </span>
                    </td>
                    <td>
                      {l.fulfil === 'store'
                        ? `From the store: ${l.storeNote ?? ''}`
                        : (l.vendor ?? 'Not chosen')}
                      {l.fromContract ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          On rate contract
                        </span>
                      ) : null}
                      {l.aboveContract && l.contract ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          Above the rate contract ({inr(l.contract.landed)} with GST):{' '}
                          {l.choiceReason}
                        </span>
                      ) : l.dearer ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          Not the lowest: {l.choiceReason}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {l.fulfil === 'store' ? '—' : inr(l.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {pr.quotes.length ? (
          <Card title={t(lang, 'Comparative statement')}>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t(lang, 'Comparative statement')}
            >
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    {pr.quotes.map((q) => (
                      <th key={q.id} scope="col" style={{ textAlign: 'right' }}>
                        {q.vendor}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buy.map((l) => (
                    <tr key={l.id}>
                      <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                        {l.item}
                      </th>
                      {pr.quotes.map((q) => {
                        const x = quoted(l.id, q.vendorId);
                        return (
                          <td key={q.id} style={{ textAlign: 'right' }}>
                            {x ? (
                              <>
                                {inr(x.landed)}{' '}
                                {l.l1?.vendorIds.includes(q.vendorId) ? (
                                  <Badge tone="success">L1</Badge>
                                ) : null}
                                {l.vendorId === q.vendorId ? (
                                  <span className="ep-field__help" style={{ display: 'block' }}>
                                    Chosen
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ep-field__help">
              {t(lang, 'What the school pays per unit, with GST; the lowest is L1.')}
            </p>
          </Card>
        ) : null}

        {pr.committee.members.some((m) => m.signedAt) || pr.tier === 'committee' ? (
          <Card title={t(lang, 'Committee signatures')}>
            <ul
              style={{ margin: 0, paddingLeft: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-1)' }}
            >
              {pr.committee.members.map((m) => (
                <li key={m.employeeId}>
                  {m.name}: {m.signedAt ? `signed ${when(m.signedAt)}` : 'not yet'}
                  {m.note ? ` · ${m.note}` : ''}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
