import { Alert, Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import {
  l1Count,
  OrderAmendmentCard,
  OrderSourcingCard,
} from '@/components/purchase/OrderSourcing';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { PassLevel } from '@/components/purchase/PassLevel';
import { StepApprovers } from '@/components/purchase/StepApprovers';
import {
  EMERGENCY_STATUS,
  ORDER_STATUS,
  RECEIPT_KIND,
  RECEIPT_STATUS,
  RECEIPT_STATUS_OF_ORDER,
  shortText,
  TIER,
  type IndentStep,
  type OrderDetail,
} from '@/lib/purchase';
import {
  amendOrder,
  cancelOrder,
  closeOrder,
  decideOrder,
  sendOrder,
  submitOrder,
} from '@/lib/purchase-actions';

const when = (iso: string | null, time = false) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STEP: Record<
  IndentStep['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  skipped: { label: 'Passed on', tone: 'neutral' },
};
const EVENT: Record<string, string> = {
  started: 'Sent for approval',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Passed on',
  delegated: 'Decided on someone’s behalf',
  cancelled: 'Closed',
  escalated: 'Moved on: no decision in time',
  reminded: 'Reminder sent',
};
const MESSAGE: Record<string, string> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  cancelled: 'Not sent',
};

/**
 * One Purchase Order (docs/design/83, part 4; the layout: "As built — the PO page"): the figures
 * (total, lines, delivery, payment, quotes and L1, revision), the status and actions, then cards. Open:
 * the lines (HSN / SAC, GST: CGST + SGST within the state, IGST outside, none from an unregistered
 * vendor, reverse charge paid by the school), the approvals while the PO waits and the deliveries while
 * goods are expected. Folded, with a one-line hint, until clicked: why this vendor, what changed from the
 * last revision, the vendor and terms, the GST summary, the e-mails sent, the revisions and the history.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  // the admin may pass the level a document waits at for its approvers (docs/design/83)
  const canPass = (await getMe()).permissions.includes('purchase.approval.override');
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const po = await apiFetch<OrderDetail>(`/purchase/orders/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = ORDER_STATUS[po.status];
  const label = po.emergency ? (EMERGENCY_STATUS[po.status] ?? st.label) : st.label;
  const nowLevel =
    po.status === 'submitted'
      ? (po.steps.find((x) => x.status === 'pending')?.level ?? null)
      : null;
  const stepOf = (s: IndentStep) =>
    s.status !== 'pending'
      ? STEP[s.status]
      : s.level === nowLevel
        ? STEP.pending
        : { label: po.status === 'submitted' ? 'Later' : 'Not reached', tone: 'neutral' as const };
  const gstOf = (l: { cgst: number; sgst: number; igst: number }) => l.cgst + l.sgst + l.igst;
  const pdf = `/api/purchase/orders/${po.id}/pdf`;
  const plural = (n: number, one: string, many = `${one}s`) =>
    `${String(n)} ${n === 1 ? one : many}`;
  const gstMode =
    po.vendorGstStatus !== 'regular'
      ? `No GST (${po.vendorGstStatus})`
      : po.supply === 'intra'
        ? 'CGST + SGST'
        : 'IGST';
  const receiving = ['approved', 'sent'].includes(po.status);
  const l1 = po.sourcing ? l1Count(po.sourcing) : null;
  const pending = po.steps.filter((s) => s.status === 'pending').length;
  const decided = po.steps.filter((s) => s.status !== 'pending');
  const lastSend = po.sends[0];
  const lastEvent = po.history[po.history.length - 1];
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase Orders', href: '/purchase/orders' }, { label: po.label }]}
      />
      <PageHeader
        kicker={`Purchase · ${po.emergency ? 'Emergency purchase' : 'Order'}${po.department ? ` · ${po.department}` : ''}`}
        title={po.label}
        description={`${po.vendor} (${po.vendorCode}) · dated ${when(po.poDate)}`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <FileLinks href={pdf} label={`${po.label} as a PDF`} />
            {po.can.edit ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/orders/${po.id}/edit`}
              >
                Change
              </a>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />
      <div className="ep-doc-stack">
        <h2 className="ep-sr-only">The order at a glance</h2>
        <div className="ep-doc-kpis">
          <KpiTile
            label="Total with GST"
            value={money(po.totals.total)}
            hint={`${money(po.totals.taxable)} before GST`}
          />
          <KpiTile
            label="Lines"
            value={String(po.lineItems.length)}
            hint={
              po.charges.length
                ? `+ ${po.charges.map((x) => x.label).join(', ')}`
                : 'No other charges'
            }
          />
          <KpiTile
            label="Deliver by"
            value={po.deliveryDate ? when(po.deliveryDate) : 'No date set'}
            hint={
              receiving || po.status === 'closed'
                ? RECEIPT_STATUS_OF_ORDER[po.receiptStatus]
                : `PO valid until ${when(po.validUntil)}`
            }
          />
          <KpiTile
            label="Payment"
            value={po.paymentText ?? 'No term set'}
            hint={po.freightTerms ? `${gstMode} · ${po.freightTerms}` : gstMode}
          />
          <KpiTile
            label="Quotes · L1"
            value={
              po.sourcing
                ? po.sourcing.quotes.length
                  ? plural(po.sourcing.quotes.length, 'quote')
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
            label="Revision"
            value={po.revision ? `R${String(po.revision)}` : 'Original'}
            hint={
              po.amendment
                ? `Replaces ${po.amendment.previousLabel}`
                : po.revisions.length > 1
                  ? plural(po.revisions.length, 'revision')
                  : 'Not amended'
            }
          />
        </div>

        <section className="ep-card" aria-labelledby="po-st">
          <h2 id="po-st" className="ep-card__title">
            Status and actions <Badge tone={st.tone}>{label}</Badge>
            {po.emergency ? (
              <>
                {' '}
                <Badge tone="danger">Emergency</Badge>
              </>
            ) : null}
          </h2>
          {po.status === 'submitted' && po.waitingWith ? (
            <p style={{ marginTop: 0 }}>Waiting with {po.waitingWith}.</p>
          ) : null}
          {po.decisionNote && !['approved', 'sent', 'submitted'].includes(po.status) ? (
            <Alert tone={po.status === 'rejected' ? 'danger' : 'warning'} title="Note">
              {po.decisionNote}
            </Alert>
          ) : null}
          {po.msmeWarning ? (
            <Alert tone="warning" title="MSME payment within 45 days">
              {po.msmeWarning}
            </Alert>
          ) : null}
          {po.newerId ? (
            <Alert tone="info" title="An amendment is open">
              <a style={{ textDecoration: 'underline' }} href={`/purchase/orders/${po.newerId}`}>
                See the next revision
              </a>
              ; this one stays in force until it is approved.
            </Alert>
          ) : null}
          <p className="ep-field__help">
            {po.createdBy ? `Made by ${po.createdBy}` : 'Drafted by the system'} on{' '}
            {when(po.createdAt)}
            {po.approvedAt ? ` · approved ${when(po.approvedAt)}` : ''}
            {po.sentAt ? ` · first sent ${when(po.sentAt)}` : ''}
            {po.closedAt
              ? ` · closed ${when(po.closedAt)}${po.closedNote ? ` (${po.closedNote})` : ''}`
              : ''}
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {po.can.receive ? (
              <>
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/purchase/receipts/new?order=${po.id}`}
                >
                  Receive goods
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/purchase/receipts/new?order=${po.id}&kind=service`}
                >
                  Work done (services)
                </a>
              </>
            ) : null}
            {po.can.decide ? (
              <>
                <ConfirmAction
                  action={decideOrder}
                  fields={{ id: po.id, action: 'approve' }}
                  label={po.emergency ? 'Ratify' : 'Approve'}
                  title={`${po.emergency ? 'Ratify' : 'Approve'} ${po.label}?`}
                  confirmLabel={po.emergency ? 'Ratify' : 'Approve'}
                  variant="primary"
                >
                  {`${money(po.totals.total)} to ${po.vendor}.${po.emergency ? ' The purchase was already made; you accept it.' : ''}`}
                </ConfirmAction>
                {!po.emergency ? (
                  <ConfirmAction
                    action={decideOrder}
                    fields={{ id: po.id, action: 'send_back' }}
                    label="Send back"
                    title={`Send ${po.label} back?`}
                    confirmLabel="Send back"
                    variant="secondary"
                    reason={{ label: 'What to change (the purchase office sees it)' }}
                  >
                    The purchase office changes it and sends it again through every level.
                  </ConfirmAction>
                ) : null}
                <ConfirmAction
                  action={decideOrder}
                  fields={{ id: po.id, action: 'reject' }}
                  label={po.emergency ? 'Do not ratify' : 'Reject'}
                  title={`${po.emergency ? 'Not ratify' : 'Reject'} ${po.label}?`}
                  confirmLabel={po.emergency ? 'Do not ratify' : 'Reject'}
                  variant="ghost"
                  confirmVariant="danger"
                  reason={{ label: 'Why' }}
                >
                  {po.emergency
                    ? 'It is listed as not ratified; the school deals with the purchase.'
                    : 'The PO closes; its lines go back to To order.'}
                </ConfirmAction>
              </>
            ) : null}
            {po.can.submit ? (
              <ConfirmAction
                action={submitOrder}
                fields={{ id: po.id }}
                label={po.emergency ? 'Send for ratification' : 'Send for approval'}
                title={`Send ${po.label} ${po.emergency ? 'for ratification' : 'for approval'}?`}
                confirmLabel="Send"
                variant="primary"
              >
                {`${money(po.totals.total)} to ${po.vendor}. It cannot change while the approvers decide.`}
              </ConfirmAction>
            ) : null}
            {po.can.amend ? (
              <ConfirmAction
                action={amendOrder}
                fields={{ id: po.id }}
                label="Amend"
                title={`Amend ${po.label}?`}
                confirmLabel="Open the amendment"
                variant="secondary"
                reason={{ label: 'What changes and why' }}
              >
                The next revision opens as a draft to change and approve again; this one stays in
                force until then, and is then replaced.
              </ConfirmAction>
            ) : null}
            {po.can.close ? (
              <ConfirmAction
                action={closeOrder}
                fields={{ id: po.id }}
                label={po.receipts ? 'Close short' : 'Close'}
                title={`Close ${po.label}${po.receipts ? ' short' : ''}?`}
                confirmLabel="Close"
                variant="secondary"
                reason={{
                  label: po.receipts
                    ? 'What will not come and why'
                    : 'What happened (e.g. the vendor cannot supply)',
                }}
              >
                Nothing more is expected from the vendor. A PO whose lines are all accepted closes
                by itself.
              </ConfirmAction>
            ) : null}
            {po.can.cancel ? (
              <ConfirmAction
                action={cancelOrder}
                fields={{ id: po.id }}
                label="Cancel the PO"
                title={`Cancel ${po.label}?`}
                confirmLabel="Cancel it"
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: 'Why it is cancelled' }}
              >
                {['approved', 'sent'].includes(po.status)
                  ? 'Tell the vendor yourself. Its lines go back to To order.'
                  : 'Its lines go back to To order.'}
              </ConfirmAction>
            ) : null}
          </div>
        </section>

        {po.can.send ? (
          <section className="ep-card" aria-labelledby="po-send">
            <h2 id="po-send" className="ep-card__title">
              Send to the vendor
            </h2>
            <form action={sendOrder} className="ep-grid__toolbar">
              <input type="hidden" name="id" value={po.id} />
              <label className="ep-field" htmlFor="po-to">
                <span className="ep-field__label">E-mail to</span>
                <input
                  id="po-to"
                  name="to"
                  type="email"
                  className="ep-input"
                  required
                  maxLength={150}
                  defaultValue={po.vendorEmail ?? ''}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                E-mail the PO with the PDF
              </button>
            </form>
            <p className="ep-field__help">
              Through the school’s e-mail; the words are the template “Purchase: order to the
              vendor” (Communication → Templates).
            </p>
          </section>
        ) : null}

        {po.amendment ? <OrderAmendmentCard a={po.amendment} label={po.label} /> : null}

        {po.sourcing ? <OrderSourcingCard poId={po.id} s={po.sourcing} /> : null}

        <section className="ep-card" aria-labelledby="po-lines">
          <h2 id="po-lines" className="ep-card__title">
            Lines
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="po-lines">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Item</th>
                  <th scope="col">HSN / SAC</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Quantity
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Rate
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Taxable
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    GST
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {po.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>{l.seq}</td>
                    <td>
                      {l.description}
                      {l.make || l.model ? (
                        <span className="ep-mr-col__desc">
                          {[l.make ? `Make: ${l.make}` : null, l.model ? `Model: ${l.model}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                      {l.shortReason ? (
                        <span className="ep-mr-col__desc">
                          Less than the requisition needs: {shortText(l.shortReason, l.shortNote)} ·
                          the rest {l.closeRest ? 'closed (not to be ordered)' : 'to order later'}
                        </span>
                      ) : null}
                      {l.contractRate !== null ? (
                        <span className="ep-mr-col__desc">
                          Rate contract {money(l.contractRate)}
                          {l.rateChangeReason ? ` · changed: ${l.rateChangeReason}` : ''}
                        </span>
                      ) : null}
                    </td>
                    <td>{l.hsnCode ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.quantity} {l.uom}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {money(l.rate)}
                      {l.discountPct ? (
                        <span className="ep-mr-col__desc">less {l.discountPct}%</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(l.taxable)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {l.rcm ? (
                        <>
                          —
                          <span className="ep-mr-col__desc">
                            {l.gstRate}% {money(l.rcm)} paid by the school (reverse charge)
                          </span>
                        </>
                      ) : l.exempt ? (
                        'Exempt'
                      ) : (
                        <>
                          {money(gstOf(l))}
                          <span className="ep-mr-col__desc">
                            {l.gstRate}%{l.igst ? ' IGST' : l.cgst ? ' CGST + SGST' : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(l.total)}</td>
                  </tr>
                ))}
                {po.charges.map((x) => (
                  <tr key={x.id}>
                    <td />
                    <td>{x.label}</td>
                    <td />
                    <td />
                    <td />
                    <td style={{ textAlign: 'right' }}>{money(x.amount)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {money(x.gst)}
                      <span className="ep-mr-col__desc">{x.gstRate}%</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(x.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {(
                  [
                    ['Taxable value', po.totals.taxable],
                    ['CGST', po.totals.cgst],
                    ['SGST', po.totals.sgst],
                    ['IGST', po.totals.igst],
                    ['Round off', po.totals.roundOff],
                  ] as Array<[string, number]>
                )
                  .filter(([k, v]) => k === 'Taxable value' || v !== 0)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <th
                        scope="row"
                        colSpan={7}
                        style={{ textAlign: 'right', fontWeight: 'normal' }}
                      >
                        {k}
                      </th>
                      <td style={{ textAlign: 'right' }}>{money(v)}</td>
                    </tr>
                  ))}
                <tr>
                  <th scope="row" colSpan={7} style={{ textAlign: 'right' }}>
                    Total
                  </th>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{money(po.totals.total)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p>
            <strong>Rupees {po.words} only.</strong>
          </p>
          {po.totals.rcm ? (
            <p className="ep-field__help">
              GST of {money(po.totals.rcm)} is payable by the school under reverse charge; the
              vendor does not charge it.
            </p>
          ) : null}
        </section>

        {po.receiptList.length || ['approved', 'sent'].includes(po.status) ? (
          <FoldCard
            id="po-del"
            title="Deliveries"
            open={receiving}
            hint={`${RECEIPT_STATUS_OF_ORDER[po.receiptStatus]}${po.receipts ? ` · ${plural(po.receipts, 'receipt')}` : ''}`}
          >
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="po-del">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Ordered
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Received
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Accepted
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Rejected
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Still to come
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {po.lineItems.map((l) => (
                    <tr key={l.id}>
                      <td>
                        {l.seq}. {l.description}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {l.quantity} {l.uom}
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.received}</td>
                      <td style={{ textAlign: 'right' }}>{l.accepted}</td>
                      <td style={{ textAlign: 'right' }}>
                        {l.rejected}
                        {l.returned ? (
                          <span className="ep-mr-col__desc">
                            {l.returned} more sent back from stock for a replacement
                          </span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {Math.max(
                          0,
                          Math.round((l.quantity - l.received + l.rejected + l.returned) * 1000) /
                            1000,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {po.receiptList.length ? (
              <ul className="ep-purch-checks" style={{ marginTop: 'var(--sp-3)' }}>
                {po.receiptList.map((g) => (
                  <li key={g.id}>
                    <a href={`/purchase/receipts/${g.id}`}>{g.number}</a> {RECEIPT_KIND[g.kind]} ·{' '}
                    {when(g.receivedOn)}
                    {g.store ? ` · ${g.store}` : ''}
                    {g.by ? ` · by ${g.by}` : ''}{' '}
                    <Badge tone={RECEIPT_STATUS[g.status].tone}>
                      {RECEIPT_STATUS[g.status].label}
                    </Badge>
                    {g.acceptedOn ? ` on ${when(g.acceptedOn)}` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help">Nothing has come yet.</p>
            )}
            {po.receiptList.some(
              (g) => g.kind === 'goods' && ['accepted', 'rejected'].includes(g.status),
            ) ? (
              <p>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/purchase/returns/new?order=${po.id}`}
                >
                  Return goods to the vendor
                </a>
              </p>
            ) : null}
          </FoldCard>
        ) : null}

        <FoldCard
          id="po-facts"
          title="Vendor and terms"
          hint={[
            `${po.vendor} (${po.vendorCode})`,
            po.vendorDetail.gstin ? `GSTIN ${po.vendorDetail.gstin}` : null,
            gstMode,
            po.quoteRef ? `quotation ${po.quoteRef}` : null,
            po.terms ? 'general instructions' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <dl className="ep-facts">
            <div>
              <dt>Vendor</dt>
              <dd>
                {po.vendor} ({po.vendorCode})
                {po.vendorStatus !== 'active' ? ` · now ${po.vendorStatus}` : ''}
                <span className="ep-mr-col__desc">
                  {po.vendorDetail.gstin
                    ? `GSTIN ${po.vendorDetail.gstin}`
                    : `GST ${po.vendorGstStatus}${po.vendorDetail.pan ? ` · PAN ${po.vendorDetail.pan}` : ''}`}
                  {po.vendorDetail.state ? ` · ${po.vendorDetail.state}` : ''}
                  {po.vendorDetail.msme ? ` · MSME ${po.vendorDetail.msme}` : ''}
                </span>
                {po.vendorDetail.address ? (
                  <span className="ep-mr-col__desc">{po.vendorDetail.address}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>GST</dt>
              <dd>
                {po.vendorGstStatus !== 'regular'
                  ? `None: the vendor is ${po.vendorGstStatus}`
                  : po.supply === 'intra'
                    ? 'CGST + SGST (vendor in the school’s state)'
                    : 'IGST (vendor in another state)'}
              </dd>
            </div>
            <div>
              <dt>Date · valid until</dt>
              <dd>
                {when(po.poDate)} · {when(po.validUntil)}
              </dd>
            </div>
            {po.requisition ? (
              <div>
                <dt>Requisition</dt>
                <dd>
                  <a
                    style={{ textDecoration: 'underline' }}
                    href={`/purchase/requisitions/${po.requisitionId ?? ''}`}
                  >
                    {po.requisition}
                  </a>
                  {po.quoteRef ? ` · quotation ${po.quoteRef}` : ''}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Delivery</dt>
              <dd>
                {po.deliveryDate ? `By ${when(po.deliveryDate)}` : 'No date set'}
                {po.deliveryAddress ? ` · ${po.deliveryAddress}` : ''}
              </dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{po.paymentText ?? 'No payment term'}</dd>
            </div>
            {po.freightTerms ? (
              <div>
                <dt>Freight terms</dt>
                <dd>{po.freightTerms}</dd>
              </div>
            ) : null}
            {po.vendorNote ? (
              <div>
                <dt>Note to the vendor</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{po.vendorNote}</dd>
              </div>
            ) : null}
            {po.terms ? (
              <div>
                <dt>General instructions</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{po.terms}</dd>
              </div>
            ) : null}
            {po.emergency ? (
              <div>
                <dt>Why an emergency</dt>
                <dd>
                  {po.emergencyReason}
                  {po.billRef ? ` · bill ${po.billRef}` : ''}
                  {po.billFileId ? (
                    <FileLinks
                      href={`/api/files/${po.billFileId}/download`}
                      label="The vendor’s bill"
                    />
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </FoldCard>

        {po.summary.length ? (
          <FoldCard
            id="po-gst"
            title="GST summary"
            hint={[
              plural(po.summary.length, 'HSN / SAC row'),
              po.totals.cgst ? `CGST ${money(po.totals.cgst)}` : null,
              po.totals.sgst ? `SGST ${money(po.totals.sgst)}` : null,
              po.totals.igst ? `IGST ${money(po.totals.igst)}` : null,
              po.totals.rcm ? `reverse charge ${money(po.totals.rcm)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          >
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="GST summary">
              <table className="ep-table">
                <caption className="ep-sr-only">GST summary by HSN / SAC and rate</caption>
                <thead>
                  <tr>
                    <th scope="col">HSN / SAC</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      GST %
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Taxable
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      CGST
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      SGST
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      IGST
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Reverse charge
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {po.summary.map((x) => (
                    <tr key={`${x.hsn ?? '-'}-${String(x.gstRate)}-${x.reverseCharge ? 'r' : ''}`}>
                      <td>{x.hsn ?? 'Other charges'}</td>
                      <td style={{ textAlign: 'right' }}>{x.gstRate}</td>
                      <td style={{ textAlign: 'right' }}>{money(x.taxable)}</td>
                      <td style={{ textAlign: 'right' }}>{money(x.cgst)}</td>
                      <td style={{ textAlign: 'right' }}>{money(x.sgst)}</td>
                      <td style={{ textAlign: 'right' }}>{money(x.igst)}</td>
                      <td style={{ textAlign: 'right' }}>{x.rcm ? money(x.rcm) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FoldCard>
        ) : null}

        {po.sends.length ? (
          <FoldCard
            id="po-sends"
            title="E-mails sent to the vendor"
            hint={`${plural(po.sends.length, 'e-mail')}${lastSend ? ` · last ${(MESSAGE[lastSend.messageStatus ?? ''] ?? lastSend.messageStatus ?? '').toLowerCase()} to ${lastSend.to} on ${when(lastSend.at, true)}` : ''}`}
          >
            <ul className="ep-purch-checks">
              {po.sends.map((x) => (
                <li key={x.id}>
                  <Badge tone={x.messageStatus === 'failed' ? 'danger' : 'neutral'}>
                    {MESSAGE[x.messageStatus ?? ''] ?? x.messageStatus ?? '—'}
                  </Badge>{' '}
                  {x.to} · {when(x.at, true)}
                  {x.by ? ` · ${x.by}` : ''}
                  {x.fileId ? (
                    <FileLinks href={`/api/files/${x.fileId}/download`} label="The PDF sent" />
                  ) : null}
                </li>
              ))}
            </ul>
          </FoldCard>
        ) : null}

        {po.revisions.length > 1 ? (
          <FoldCard
            id="po-rev"
            title="Revisions"
            hint={`${plural(po.revisions.length, 'revision')} · this is ${po.revision ? `R${String(po.revision)}` : 'the original'}`}
          >
            <ul className="ep-purch-checks">
              {po.revisions.map((r) => (
                <li key={r.id}>
                  {r.id === po.id ? (
                    <strong>{r.label}</strong>
                  ) : (
                    <a href={`/purchase/orders/${r.id}`}>{r.label}</a>
                  )}{' '}
                  <Badge tone={ORDER_STATUS[r.status].tone}>{ORDER_STATUS[r.status].label}</Badge>
                  {r.approvedAt ? ` · approved ${when(r.approvedAt)}` : ''}
                </li>
              ))}
            </ul>
          </FoldCard>
        ) : null}

        {po.steps.length ? (
          <FoldCard
            id="po-steps"
            title={po.emergency ? 'Ratification' : 'Approvals'}
            open={po.status === 'submitted'}
            hint={
              po.status === 'submitted'
                ? `Level ${String(nowLevel ?? '')} of ${String(po.steps.length)}${po.waitingWith ? ` · waiting with ${po.waitingWith}` : ''}`
                : `${plural(decided.length, 'level')} decided${pending ? ` · ${String(pending)} not reached` : ''}`
            }
          >
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="po-steps">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Approver</th>
                    <th scope="col">Status</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {po.steps.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.level}. {s.name}
                      </td>
                      <td>
                        <StepApprovers s={s} />
                      </td>
                      <td>
                        <Badge tone={stepOf(s).tone}>{stepOf(s).label}</Badge>
                        <span className="ep-mr-col__desc">
                          {s.actedAt
                            ? when(s.actedAt, true)
                            : s.level === nowLevel && s.dueAt
                              ? `${s.overdue ? 'Overdue since' : 'Due'} ${when(s.dueAt, true)}`
                              : ''}
                        </span>
                      </td>
                      <td>{s.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canPass ? (
              <PassLevel
                step={po.steps.find((s) => s.level === nowLevel && s.status === 'pending')}
                back={`/purchase/orders/${po.id}`}
              />
            ) : null}
          </FoldCard>
        ) : null}

        {po.history.length ? (
          <FoldCard
            id="po-hist"
            title="History"
            hint={`${plural(po.history.length, 'event')}${lastEvent ? ` · last: ${EVENT[lastEvent.kind] ?? lastEvent.kind}${lastEvent.actor ? ` by ${lastEvent.actor}` : ''}, ${when(lastEvent.at, true)}` : ''}`}
          >
            <ol className="ep-purch-steps">
              {po.history.map((h, i) => (
                <li key={i}>
                  <strong>{EVENT[h.kind] ?? h.kind}</strong>
                  {h.actor ? ` · ${h.actor}` : ''} · {when(h.at, true)}
                  {h.note ? <span className="ep-mr-col__desc">{h.note}</span> : null}
                </li>
              ))}
            </ol>
          </FoldCard>
        ) : null}
      </div>
    </>
  );
}
