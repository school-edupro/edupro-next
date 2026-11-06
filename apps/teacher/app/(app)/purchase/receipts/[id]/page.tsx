import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { RECEIPT_STATUS, type ReceiptDetail } from '@/lib/purchase';
import { acceptReceipt, rejectReceipt } from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const qty = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A goods receipt or completion certificate in the staff app (docs/design/84, part 7): what came, the
 * vendor's challan, the PDF; the inspector (the department's level, or a member of the purchase
 * committee) accepts line by line — rejecting what is wrong with the reason — or rejects it all.
 */
export default async function StaffReceiptPage({
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
  let g: ReceiptDetail;
  try {
    g = await bff.api.fetch<ReceiptDetail>(`/purchase/receipts/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  const st = RECEIPT_STATUS[g.status];
  const goods = g.kind === 'goods';
  const lines = g.lineItems.filter((l) => l.received > 0);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase/receipts" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Goods received to inspect')}
        </a>
      </p>
      <PageHeader
        kicker={`${goods ? 'Goods received' : 'Completion certificate'}${g.department ? ` · ${g.department}` : ''}`}
        title={g.number}
        description={`${g.order} · ${g.vendor} (${g.vendorCode})`}
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
        <Card title="Status">
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>
            {g.status === 'inspecting' && g.waitingWith ? ` · with ${g.waitingWith}` : ''}
            {g.status === 'accepted' ? ` on ${when(g.acceptedOn)}: ${money(g.acceptedValue)}` : ''}
          </p>
          <p className="ep-field__help">
            {goods ? 'Received' : 'Work done'} on {when(g.receivedOn)}
            {g.createdBy ? ` · recorded by ${g.createdBy}` : ''}
            {g.store ? ` · ${g.store}` : ''}
            {g.challanNo ? ` · challan ${g.challanNo}` : ''}
            {g.invoiceNo ? ` · invoice ${g.invoiceNo}` : ''}
          </p>
          {g.status === 'inspecting' ? (
            <p className="ep-field__help">
              {g.overdue
                ? `Past 15 days: under the MSMED Act it counts as accepted from ${when(g.deemedOn)}.`
                : `Without a written objection by ${when(g.deemedOn)} it counts as accepted (MSMED Act).`}
            </p>
          ) : null}
          {g.note ? <p>{g.note}</p> : null}
          {g.decisionNote ? <p>Inspection note: {g.decisionNote}</p> : null}
          <p
            style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}
          >
            <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
              PDF{' '}
              <FileLinks
                url={`/api/purchase-receipt/${g.id}`}
                saveUrl={`/api/purchase-receipt/${g.id}?save=1`}
                label={`${g.number} as a PDF`}
              />
            </span>
            {g.hasFile ? (
              <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                The vendor’s papers{' '}
                <FileLinks
                  url={`/api/purchase-receipt/${g.id}/file`}
                  saveUrl={`/api/purchase-receipt/${g.id}/file?save=1`}
                  label="The vendor’s challan or invoice"
                />
              </span>
            ) : null}
          </p>
        </Card>

        {g.can.inspect ? (
          <Card title={goods ? t(lang, 'Inspect and accept') : t(lang, 'Certify the work')}>
            <form>
              <input type="hidden" name="id" value={g.id} />
              {g.committee ? (
                <p style={{ marginTop: 0 }}>
                  The purchase committee inspects this order: {g.committee.required} signatures are
                  needed. Changing what others signed asks them to sign again.
                </p>
              ) : null}
              <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                {lines.map((l) => (
                  <fieldset
                    key={l.id}
                    className="ep-purch-line ep-purch-line--wide"
                    style={{ margin: 0 }}
                  >
                    <legend className="ep-purch-line__item">
                      {l.poSeq}. {l.description} — {goods ? 'received' : 'done'} {qty(l.received)}{' '}
                      {l.uom}
                      {l.batch ? ` · batch ${l.batch}` : ''}
                      {l.workDone ? ` · ${l.workDone}` : ''}
                    </legend>
                    <input type="hidden" name="line" value={l.id} />
                    <label className="ep-field" htmlFor={`acc-${l.id}`}>
                      <span className="ep-field__label">
                        {t(lang, 'Accepted')} ({l.uom})
                      </span>
                      <input
                        id={`acc-${l.id}`}
                        name={`acc_${l.id}`}
                        className="ep-input"
                        inputMode="decimal"
                        defaultValue={String(l.accepted ?? l.received)}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`rej-${l.id}`}>
                      <span className="ep-field__label">{t(lang, 'Rejected')}</span>
                      <input
                        id={`rej-${l.id}`}
                        name={`rej_${l.id}`}
                        className="ep-input"
                        inputMode="decimal"
                        defaultValue={String(l.rejected ?? 0)}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`why-${l.id}`}>
                      <span className="ep-field__label">{t(lang, 'Why rejected')}</span>
                      <input
                        id={`why-${l.id}`}
                        name={`why_${l.id}`}
                        className="ep-input"
                        maxLength={300}
                        defaultValue={l.rejectReason ?? ''}
                      />
                    </label>
                    {l.serials.length ? (
                      <fieldset className="ep-purch-checks">
                        <legend className="ep-field__label">
                          {t(lang, 'Serial numbers rejected')}
                        </legend>
                        {l.serials.map((sn) => (
                          <label key={sn} className="ep-check">
                            <input
                              type="checkbox"
                              name={`sn_${l.id}`}
                              value={sn}
                              defaultChecked={l.rejectedSerials.includes(sn)}
                            />{' '}
                            {sn}
                          </label>
                        ))}
                      </fieldset>
                    ) : null}
                  </fieldset>
                ))}
              </div>
              <label className="ep-field" htmlFor="in-note">
                <span className="ep-field__label">
                  {t(lang, 'Note (the reason, when rejecting it all)')}
                </span>
                <textarea id="in-note" name="note" className="ep-input" rows={2} maxLength={1000} />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button type="submit" formAction={acceptReceipt} className="ep-btn ep-btn--primary">
                  {g.committee
                    ? t(lang, 'Sign the inspection')
                    : goods
                      ? t(lang, 'Accept what is marked accepted')
                      : t(lang, 'Certify the work')}
                </button>
                <button type="submit" formAction={rejectReceipt} className="ep-btn ep-btn--danger">
                  {t(lang, 'Reject it all')}
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card title={t(lang, 'What came')}>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t(lang, 'What came')}
          >
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Ordered
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    {goods ? 'Received' : 'Done'}
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    {t(lang, 'Accepted')}
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    {t(lang, 'Rejected')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {g.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.poSeq}. {l.description}
                      {l.batch || l.serials.length || l.refused || l.rejected ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {[
                            l.batch
                              ? `Batch ${l.batch}${l.expiry ? `, expiry ${when(l.expiry)}` : ''}`
                              : null,
                            l.serials.length ? `Serial ${l.serials.join(', ')}` : null,
                            l.refused
                              ? `Refused ${qty(l.refused)}: ${l.refusedReason ?? ''}`
                              : null,
                            l.rejected ? `Rejected: ${l.rejectReason ?? ''}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {qty(l.ordered)} {l.uom}
                    </td>
                    <td style={{ textAlign: 'right' }}>{qty(l.received)}</td>
                    <td style={{ textAlign: 'right' }}>{qty(l.accepted)}</td>
                    <td style={{ textAlign: 'right' }}>{qty(l.rejected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {g.issues.length ? (
          <Card title="Issued to the department">
            <ul style={{ margin: 0 }}>
              {g.issues.map((x) => (
                <li key={x.id}>
                  {x.number} to {x.department}
                  {x.indent ? ` for ${x.indent}` : ''}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
