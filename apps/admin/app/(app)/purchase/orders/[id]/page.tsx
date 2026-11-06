import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  EMERGENCY_STATUS,
  ORDER_STATUS,
  RECEIPT_KIND,
  RECEIPT_STATUS,
  RECEIPT_STATUS_OF_ORDER,
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
 * One Purchase Order (docs/design/83, part 4): its status and actions, the vendor and the order's
 * terms, the lines with their HSN / SAC and GST (CGST + SGST within the state, IGST outside, none from
 * an unregistered vendor, reverse charge paid by the school), other charges, the totals in words, the
 * GST summary, the PDF, the e-mails to the vendor, the revisions, the approvals and the history.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
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
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase Orders', href: '/purchase/orders' }, { label: po.label }]}
      />
      <PageHeader
        kicker={`Purchase · ${po.emergency ? 'Emergency purchase' : 'Order'}${po.department ? ` · ${po.department}` : ''}`}
        title={po.label}
        description={`${po.vendor} (${po.vendorCode}) · ${money(po.totals.total)}`}
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

      <section className="ep-card" aria-labelledby="po-st">
        <h2 id="po-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{label}</Badge>
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
        {po.revision ? (
          <p>
            Revision {po.revision}
            {po.amendReason ? `: ${po.amendReason}` : ''}.
          </p>
        ) : null}
        {['approved', 'sent', 'closed'].includes(po.status) ? (
          <p style={{ marginTop: 0 }}>
            Deliveries: {RECEIPT_STATUS_OF_ORDER[po.receiptStatus].toLowerCase()}
            {po.receipts ? ` (${String(po.receipts)} receipt${po.receipts === 1 ? '' : 's'})` : ''}.
          </p>
        ) : null}
        {po.newerId ? (
          <p>
            An amendment of this PO is open:{' '}
            <a href={`/purchase/orders/${po.newerId}`}>see the next revision</a>.
          </p>
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
              Nothing more is expected from the vendor. A PO whose lines are all accepted closes by
              itself.
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
            Through the school’s e-mail; the words are the template “Purchase: order to the vendor”
            (Communication → Templates).
          </p>
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="po-facts">
        <h2 id="po-facts" className="ep-card__title">
          Vendor and terms
        </h2>
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
                <a href={`/purchase/requisitions/${po.requisitionId ?? ''}`}>{po.requisition}</a>
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
          {po.terms ? (
            <div>
              <dt>Terms and conditions</dt>
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
      </section>

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
            GST of {money(po.totals.rcm)} is payable by the school under reverse charge; the vendor
            does not charge it.
          </p>
        ) : null}
        {po.summary.length ? (
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
        ) : null}
      </section>

      {po.receiptList.length || ['approved', 'sent'].includes(po.status) ? (
        <section className="ep-card" aria-labelledby="po-del">
          <h2 id="po-del" className="ep-card__title">
            Deliveries
          </h2>
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
                      {l.rejected ? (
                        <span className="ep-mr-col__desc">to return to the vendor</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {Math.max(
                        0,
                        Math.round((l.quantity - l.received + l.rejected) * 1000) / 1000,
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
        </section>
      ) : null}

      {po.sends.length ? (
        <section className="ep-card" aria-labelledby="po-sends">
          <h2 id="po-sends" className="ep-card__title">
            E-mails to the vendor
          </h2>
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
        </section>
      ) : null}

      {po.revisions.length > 1 ? (
        <section className="ep-card" aria-labelledby="po-rev">
          <h2 id="po-rev" className="ep-card__title">
            Revisions
          </h2>
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
        </section>
      ) : null}

      {po.steps.length ? (
        <section className="ep-card" aria-labelledby="po-steps">
          <h2 id="po-steps" className="ep-card__title">
            {po.emergency ? 'Ratification' : 'Approvals'}
          </h2>
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
                      {s.actedBy ??
                        (s.assignees.length ? s.assignees.map((a) => a.name).join(', ') : 'Nobody')}
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
        </section>
      ) : null}

      {po.history.length ? (
        <section className="ep-card" aria-labelledby="po-hist">
          <h2 id="po-hist" className="ep-card__title">
            History
          </h2>
          <ol className="ep-purch-steps">
            {po.history.map((h, i) => (
              <li key={i}>
                <strong>{EVENT[h.kind] ?? h.kind}</strong>
                {h.actor ? ` · ${h.actor}` : ''} · {when(h.at, true)}
                {h.note ? <span className="ep-mr-col__desc">{h.note}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
