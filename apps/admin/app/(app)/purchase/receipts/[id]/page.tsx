import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { InspectionForm } from '@/components/purchase/InspectionForm';
import { ApiError, apiFetch } from '@/lib/api';
import { RECEIPT_KIND, RECEIPT_STATUS, type IndentStep, type ReceiptDetail } from '@/lib/purchase';
import { cancelReceipt } from '@/lib/purchase-actions';

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
const qty = (n: number | null) =>
  n === null ? '—' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const STEP: Record<
  IndentStep['status'],
  { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }
> = {
  pending: { label: 'Waiting', tone: 'warning' },
  approved: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  skipped: { label: 'Passed on', tone: 'neutral' },
};

/**
 * One goods receipt or completion certificate (docs/design/84, part 7): what came against the PO and
 * what was refused at the door, batch, expiry and serial numbers, the inspection (the department's
 * levels or the committee's signatures) with what was accepted and rejected, the cost each accepted
 * unit entered the store at, the issues made at once to the indenting departments, the MSME
 * deemed-acceptance date, the PDF and the vendor's challan.
 */
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const g = await apiFetch<ReceiptDetail>(`/purchase/receipts/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = RECEIPT_STATUS[g.status];
  const goods = g.kind === 'goods';
  const nowLevel =
    g.status === 'inspecting' ? (g.steps.find((x) => x.status === 'pending')?.level ?? null) : null;
  const stepOf = (s: IndentStep) =>
    s.status !== 'pending'
      ? STEP[s.status]
      : s.level === nowLevel
        ? STEP.pending
        : { label: g.status === 'inspecting' ? 'Later' : 'Not reached', tone: 'neutral' as const };
  const total = g.lineItems.reduce((a, l) => a + (l.value ?? 0), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Goods receipts', href: '/purchase/receipts' },
          { label: g.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · ${RECEIPT_KIND[g.kind]}`}
        title={g.number}
        description={`${g.order} · ${g.vendor} (${g.vendorCode})${g.department ? ` · ${g.department}` : ''}`}
        actions={
          <FileLinks href={`/api/purchase/receipts/${g.id}/pdf`} label={`${g.number} as a PDF`} />
        }
      />
      <Notice params={sp} />

      <section className="ep-card" aria-labelledby="gr-st">
        <h2 id="gr-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        {g.status === 'inspecting' ? (
          <>
            <p style={{ marginTop: 0 }}>
              {g.waitingWith ? `Waiting with ${g.waitingWith}. ` : ''}
              {g.inspection === 'committee'
                ? 'The order is above the committee limit: the purchase committee inspects it.'
                : `${g.department ?? 'The department'} inspects it.`}
            </p>
            {g.overdue ? (
              <Alert tone="warning" title="Deemed accepted">
                {`Not inspected within 15 days of delivery: under the MSMED Act the goods count as accepted from ${when(g.deemedOn)}, and the vendor's payment term runs from then.`}
              </Alert>
            ) : (
              <p className="ep-field__help">
                Without a written objection by {when(g.deemedOn)} it counts as accepted (MSMED Act
                s.15).
              </p>
            )}
          </>
        ) : null}
        {g.status === 'accepted' ? (
          <p style={{ marginTop: 0 }}>
            Accepted on {when(g.acceptedOn)}
            {g.decidedBy ? ` by ${g.decidedBy}` : ''}: {money(g.acceptedValue)}
            {goods && g.store ? ` entered ${g.store}` : ''}.
          </p>
        ) : null}
        {g.decisionNote ? (
          <Alert tone={g.status === 'rejected' ? 'danger' : 'info'} title="Inspection note">
            {g.decisionNote}
          </Alert>
        ) : null}
        {g.cancelReason ? (
          <Alert tone="info" title="Cancelled">
            {g.cancelReason}
          </Alert>
        ) : null}
        <p className="ep-field__help">
          {goods ? 'Received' : 'Work done'} on {when(g.receivedOn)}
          {g.createdBy ? ` · recorded by ${g.createdBy}` : ''}
          {g.store ? ` · ${g.store}` : ''}
          {g.challanNo
            ? ` · challan ${g.challanNo}${g.challanDate ? ` of ${when(g.challanDate)}` : ''}`
            : ''}
          {g.invoiceNo
            ? ` · invoice ${g.invoiceNo}${g.invoiceDate ? ` of ${when(g.invoiceDate)}` : ''}`
            : ''}{' '}
          · <a href={`/purchase/orders/${g.orderId}`}>{g.order}</a>
        </p>
        {g.hasFile ? (
          <p style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            The vendor’s papers{' '}
            <FileLinks
              href={`/api/purchase/receipts/${g.id}/file`}
              label="The vendor’s challan or invoice"
            />
          </p>
        ) : null}
        {g.note ? <p>{g.note}</p> : null}
        {g.can.cancel ? (
          <ConfirmAction
            action={cancelReceipt}
            fields={{ id: g.id }}
            label="Cancel this receipt"
            title={`Cancel ${g.number}?`}
            confirmLabel="Cancel it"
            variant="ghost"
            confirmVariant="danger"
            reason={{ label: 'Why (e.g. entered wrongly)' }}
          >
            What it brought counts as still to come; record it again as it is.
          </ConfirmAction>
        ) : null}
      </section>

      {g.can.inspect ? (
        <section className="ep-card" aria-labelledby="gr-in">
          <h2 id="gr-in" className="ep-card__title">
            {goods ? 'Inspect and accept' : 'Certify the work'}
          </h2>
          <p style={{ marginTop: 0 }}>
            {goods
              ? 'Check what came against the order: accept what is right, reject what is not with the reason. Only the accepted quantity enters the store; what was bought for an indent goes straight to its department.'
              : 'Certify the work the vendor has done, or reject it with the reason.'}
            {g.inspection === 'committee'
              ? ` The committee's members sign the same inspection: ${String(g.committee?.required ?? 0)} signatures are needed; changing it asks the others to sign again.`
              : ''}
          </p>
          <InspectionForm receipt={g} />
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="gr-lines">
        <h2 id="gr-lines" className="ep-card__title">
          {goods ? 'What came' : 'The work'}
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="gr-lines">
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
                  Accepted
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rejected
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {g.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.poSeq}. {l.description}
                    {l.itemCode ? ` (${l.itemCode})` : ''}
                    {l.batch ? (
                      <span className="ep-mr-col__desc">
                        Batch {l.batch}
                        {l.expiry ? `, expiry ${when(l.expiry)}` : ''}
                      </span>
                    ) : null}
                    {l.serials.length ? (
                      <span className="ep-mr-col__desc">
                        Serial numbers: {l.serials.join(', ')}
                      </span>
                    ) : null}
                    {l.workDone ? (
                      <span className="ep-mr-col__desc">Done: {l.workDone}</span>
                    ) : null}
                    {l.refused ? (
                      <span className="ep-mr-col__desc">
                        Refused {qty(l.refused)} at the door: {l.refusedReason}
                      </span>
                    ) : null}
                    {l.rejected ? (
                      <span className="ep-mr-col__desc">
                        Rejected: {l.rejectReason}
                        {l.rejectedSerials.length ? ` (${l.rejectedSerials.join(', ')})` : ''} — to
                        return to the vendor
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {qty(l.ordered)} {l.uom}
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty(l.received)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(l.accepted)}</td>
                  <td style={{ textAlign: 'right' }}>{qty(l.rejected)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {l.value === null ? '—' : money(l.value)}
                    {l.unitCost !== null && l.accepted ? (
                      <span className="ep-mr-col__desc">
                        {money(l.unitCost)} per {l.uom}
                        {l.stockTracked ? '' : ' (not kept in stock)'}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            {g.status === 'accepted' ? (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={5} style={{ textAlign: 'right' }}>
                    Value accepted
                  </th>
                  <td style={{ textAlign: 'right' }}>{money(total)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {g.status === 'accepted' && goods ? (
          <p className="ep-field__help">
            The value is each unit’s share of the order: the rate after discount, its GST (unless
            Purchase settings leaves GST out of the stock cost) and its share of the other charges.
          </p>
        ) : null}
      </section>

      {goods && g.lineItems.some((l) => (l.rejected ?? 0) > 0) ? (
        <p>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/purchase/returns/new?order=${g.orderId}`}
          >
            Return rejected goods to the vendor
          </a>
        </p>
      ) : null}

      {g.issues.length ? (
        <section className="ep-card" aria-labelledby="gr-iss">
          <h2 id="gr-iss" className="ep-card__title">
            Issued at once to the indenting departments
          </h2>
          <ul className="ep-purch-checks">
            {g.issues.map((x) => (
              <li key={x.id}>
                <a href={`/purchase/issues/${x.id}`}>{x.number}</a> to {x.department}
                {x.indent ? (
                  <>
                    {' '}
                    for <a href={`/purchase/indents/${x.indentId ?? ''}`}>{x.indent}</a>
                  </>
                ) : null}{' '}
                · {x.lines} line{x.lines === 1 ? '' : 's'}, {money(x.value)}{' '}
                <Badge tone={x.status === 'acknowledged' ? 'success' : 'warning'}>
                  {x.status === 'acknowledged'
                    ? 'Acknowledged'
                    : 'Waiting for the department’s acknowledgement'}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {g.committee ? (
        <section className="ep-card" aria-labelledby="gr-com">
          <h2 id="gr-com" className="ep-card__title">
            The purchase committee
          </h2>
          <p style={{ marginTop: 0 }}>
            {g.committee.required} of {g.committee.members.length} signatures needed.
          </p>
          <ul className="ep-purch-checks">
            {g.committee.members.map((m) => (
              <li key={m.name}>
                {m.name}
                {m.role ? ` (${m.role})` : m.designation ? ` (${m.designation})` : ''}{' '}
                {m.signedAt ? (
                  <Badge tone="success">{`Signed ${when(m.signedAt, true)}`}</Badge>
                ) : (
                  <Badge tone="neutral">Not signed</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {g.steps.length ? (
        <section className="ep-card" aria-labelledby="gr-steps">
          <h2 id="gr-steps" className="ep-card__title">
            Inspection
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="gr-steps">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Level</th>
                  <th scope="col">Who</th>
                  <th scope="col">Status</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {g.steps.map((s) => {
                  const x = stepOf(s);
                  return (
                    <tr key={s.id}>
                      <td>
                        {s.level}. {s.name}
                      </td>
                      <td>{s.assignees.map((a) => a.name).join(', ') || '—'}</td>
                      <td>
                        <Badge tone={x.tone}>{x.label}</Badge>
                        {s.actedAt ? (
                          <span className="ep-mr-col__desc">{when(s.actedAt, true)}</span>
                        ) : null}
                      </td>
                      <td>{s.note ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
