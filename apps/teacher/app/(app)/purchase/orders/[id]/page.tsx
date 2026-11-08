import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { l1Count, OrderAmendmentCard, OrderSourcingCard } from '@/components/OrderSourcing';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { EMERGENCY_STATUS, ORDER_STATUS, TIER, type OrderDetail } from '@/lib/purchase';

const SHORT_REASON: Record<string, string> = {
  vendor_stock: 'Vendor short of stock',
  pack_size: 'Sold in packs',
  budget: 'Over budget',
  not_needed: 'No longer needed',
  other: 'Other',
};
import { approveOrder, rejectOrder, sendBackOrder } from '@/lib/purchase-actions';

const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string, time = false) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso));
const STEP = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Passed on',
} as const;

/**
 * One Purchase Order in the staff app (docs/design/83, part 4; the layout: "As built — the PO page"):
 * the figures (total, lines, delivery, payment, quotes and L1, revision), the status and the PDF; an
 * approver approves, sends back or rejects it (an emergency purchase: ratifies it or not). The lines
 * show; the approvals show while the PO waits; why this vendor and what changed from the last revision
 * are folded, with a one-line hint, until clicked.
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
  const l1 = po.sourcing ? l1Count(po.sourcing) : null;
  const nowLevel =
    po.status === 'submitted'
      ? (po.steps.find((x) => x.status === 'pending')?.level ?? null)
      : null;
  const decided = po.steps.filter((x) => x.status !== 'pending').length;
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
        description={`${po.vendor} (${po.vendorCode}) · ${when(po.poDate)}`}
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
        <h2 className="ep-sr-only">{t(lang, 'The order at a glance')}</h2>
        <div className="ep-doc-kpis">
          <KpiTile
            label={t(lang, 'Total with GST')}
            value={money(po.totals.total)}
            hint={`${money(po.totals.taxable)} before GST`}
          />
          <KpiTile
            label={t(lang, 'Lines')}
            value={String(po.lineItems.length)}
            hint={
              po.charges.length
                ? `+ ${po.charges.map((x) => x.label).join(', ')}`
                : 'No other charges'
            }
          />
          <KpiTile
            label={t(lang, 'Deliver by')}
            value={po.deliveryDate ? when(po.deliveryDate) : 'No date set'}
            hint={`PO valid until ${when(po.validUntil)}`}
          />
          <KpiTile
            label={t(lang, 'Payment')}
            value={po.paymentText ?? 'No term set'}
            hint={
              po.vendorGstStatus !== 'regular'
                ? `No GST (${po.vendorGstStatus})`
                : po.supply === 'intra'
                  ? 'CGST + SGST'
                  : 'IGST'
            }
          />
          <KpiTile
            label={t(lang, 'Quotes · L1')}
            value={
              po.sourcing
                ? po.sourcing.quotes.length
                  ? `${String(po.sourcing.quotes.length)} quote${po.sourcing.quotes.length === 1 ? '' : 's'}`
                  : 'No quotes'
                : po.emergency
                  ? 'Emergency'
                  : 'No requisition'
            }
            hint={
              l1 && l1.quoted
                ? l1.l1 === l1.quoted
                  ? 'L1 on every line'
                  : `L1 on ${String(l1.l1)} of ${String(l1.quoted)} lines`
                : po.sourcing?.tier
                  ? TIER[po.sourcing.tier].label
                  : 'Vendor and rate agreed'
            }
          />
          <KpiTile
            label={t(lang, 'Revision')}
            value={po.revision ? `R${String(po.revision)}` : 'Original'}
            hint={po.amendment ? `Replaces ${po.amendment.previousLabel}` : 'Not amended'}
          />
        </div>

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

        {po.amendment ? <OrderAmendmentCard a={po.amendment} label={po.label} /> : null}

        {po.sourcing ? <OrderSourcingCard poId={po.id} s={po.sourcing} /> : null}

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
                      {l.shortReason ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          Less than the requisition needs:{' '}
                          {SHORT_REASON[l.shortReason] ?? l.shortReason}
                          {l.shortNote ? `: ${l.shortNote}` : ''} · the rest{' '}
                          {l.closeRest ? 'closed (not to be ordered)' : 'to order later'}
                        </span>
                      ) : null}
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

        {po.steps.length ? (
          <FoldCard
            id="po-steps"
            title={po.emergency ? 'Ratification' : t(lang, 'Approvals')}
            open={po.status === 'submitted'}
            hint={
              po.status === 'submitted'
                ? `Level ${String(nowLevel ?? '')} of ${String(po.steps.length)}${po.waitingWith ? ` · waiting with ${po.waitingWith}` : ''}`
                : `${String(decided)} of ${String(po.steps.length)} levels decided`
            }
          >
            <ol
              style={{ margin: 0, paddingLeft: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-2)' }}
            >
              {po.steps.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> ·{' '}
                  {s.status !== 'pending'
                    ? STEP[s.status]
                    : s.level === nowLevel
                      ? STEP.pending
                      : po.status === 'submitted'
                        ? 'Later'
                        : 'Not reached'}{' '}
                  · {s.actedBy ?? (s.assignees.map((a) => a.name).join(', ') || 'Nobody')}
                  {s.actedAt ? ` · ${when(s.actedAt, true)}` : ''}
                  {s.note ? (
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {s.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </FoldCard>
        ) : null}
      </div>
    </main>
  );
}
