import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { EMERGENCY_STATUS, ORDER_STATUS, type OrderDetail } from '@/lib/purchase';
import { approveOrder, rejectOrder, sendBackOrder } from '@/lib/purchase-actions';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One Purchase Order in the staff app (docs/design/83, part 4): the vendor, the lines with their GST,
 * the totals, the PDF; an approver approves, sends back or rejects it (an emergency purchase: ratifies
 * it or not).
 */
export default async function StaffOrderPage({
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
  let po: OrderDetail;
  try {
    po = await bff.api.fetch<OrderDetail>(`/purchase/orders/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  const st = ORDER_STATUS[po.status];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase/orders" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Purchase orders')}
        </a>
      </p>
      <PageHeader
        kicker={`${t(lang, 'Purchase orders')}${po.department ? ` · ${po.department}` : ''}`}
        title={po.label}
        description={`${po.vendor} (${po.vendorCode})`}
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
            <Badge tone={st.tone}>
              {po.emergency ? (EMERGENCY_STATUS[po.status] ?? st.label) : st.label}
            </Badge>{' '}
            {po.emergency ? <Badge tone="danger">Emergency</Badge> : null}{' '}
            <strong>{money(po.totals.total)}</strong>{' '}
            <FileLinks
              url={`/api/purchase-order/${po.id}`}
              saveUrl={`/api/purchase-order/${po.id}?save=1`}
              label={`${po.label} as a PDF`}
            />
          </p>
          {po.status === 'submitted' && po.waitingWith ? <p>With {po.waitingWith}.</p> : null}
          {po.emergency && po.emergencyReason ? (
            <p>
              <strong>{t(lang, 'Why an emergency')}:</strong> {po.emergencyReason}
            </p>
          ) : null}
          {po.msmeWarning ? (
            <p className="ep-alert ep-alert--warning" role="status">
              {po.msmeWarning}
            </p>
          ) : null}
          <p className="ep-field__help">
            {po.paymentText ? `${t(lang, 'Payment')}: ${po.paymentText}` : ''}
          </p>
        </Card>

        {po.can.decide ? (
          <Card title={t(lang, 'Your decision')}>
            <form action={approveOrder} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={po.id} />
              <label className="ep-field" htmlFor="od-note">
                <span className="ep-field__label">
                  {t(lang, 'Remark (needed to send back or reject)')}
                </span>
                <textarea
                  id="od-note"
                  name="reason"
                  className="ep-input"
                  rows={2}
                  maxLength={500}
                />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button type="submit" formAction={approveOrder} className="ep-btn ep-btn--primary">
                  {po.emergency ? t(lang, 'Ratify') : t(lang, 'Approve')}
                </button>
                {!po.emergency ? (
                  <button
                    type="submit"
                    formAction={sendBackOrder}
                    className="ep-btn ep-btn--secondary"
                  >
                    {t(lang, 'Send back')}
                  </button>
                ) : null}
                <button type="submit" formAction={rejectOrder} className="ep-btn ep-btn--danger">
                  {po.emergency ? t(lang, 'Do not ratify') : t(lang, 'Reject')}
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card title={t(lang, 'Lines')}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t(lang, 'Lines')}>
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Before GST
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {po.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.description}
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {l.quantity} {l.uom} × {money(l.rate)}
                        {l.discountPct ? ` less ${String(l.discountPct)}%` : ''} · GST {l.gstRate}%
                        {l.rcm ? ' (reverse charge: the school pays)' : ''}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(l.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>{money(l.total)}</td>
                  </tr>
                ))}
                {po.charges.map((x) => (
                  <tr key={x.id}>
                    <td>{x.label}</td>
                    <td style={{ textAlign: 'right' }}>{money(x.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{money(x.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={2} style={{ textAlign: 'right' }}>
                    Total
                  </th>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{money(po.totals.total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="ep-field__help">Rupees {po.words} only.</p>
        </Card>
      </div>
    </main>
  );
}
