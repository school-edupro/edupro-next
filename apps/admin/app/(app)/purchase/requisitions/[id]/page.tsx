import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  inr,
  REQUISITION_STATUS,
  TIER,
  type IndentStep,
  type RequisitionDetail,
  type RequisitionFormLists,
} from '@/lib/purchase';
import {
  addRequisitionFile,
  cancelRequisition,
  certifyRequisition,
  decideRequisition,
  removeQuote,
  removeRequisitionFile,
  reopenRequisition,
  saveChoices,
  saveTender,
  signRequisition,
  submitRequisition,
  uncertifyRequisition,
  unsignRequisition,
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
  reassigned: 'Approvers changed',
  escalated: 'Moved on: no decision in time',
  reminded: 'Reminder sent',
  comment: 'Comment',
};

/**
 * One Purchase Requisition (docs/design/83, part 3): its status and actions, the sourcing its value
 * calls for with what is still needed, the lines with the indents they came from, the quotes and the
 * comparative statement (L1 marked) where the vendor per line is chosen, the reasonable-price
 * certificate, the tender, the committee's signatures, the approvals and the history.
 */
export default async function RequisitionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const pr = await apiFetch<RequisitionDetail>(`/purchase/requisitions/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    },
  );
  const lists = pr.can.edit
    ? await apiFetch<RequisitionFormLists>('/purchase/requisition-form')
    : null;
  const st = REQUISITION_STATUS[pr.status];
  const tier = pr.tier ?? 'none';
  const buy = pr.lineItems.filter((l) => l.fulfil === 'buy');
  const missing = pr.requirements.filter((r) => !r.met);
  const nowLevel =
    pr.status === 'submitted'
      ? (pr.steps.find((x) => x.status === 'pending')?.level ?? null)
      : null;
  const stepOf = (s: IndentStep) =>
    s.status !== 'pending'
      ? STEP[s.status]
      : s.level === nowLevel
        ? STEP.pending
        : { label: pr.status === 'submitted' ? 'Later' : 'Not reached', tone: 'neutral' as const };
  const quoted = (lineId: string, vendorId: string) =>
    pr.quotes.find((q) => q.vendorId === vendorId)?.lines.find((x) => x.lineId === lineId);
  const showCommittee = tier === 'committee' || pr.committee.members.some((m) => m.signedAt);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Requisitions', href: '/purchase/requisitions' },
          { label: pr.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · Requisition · ${pr.department ?? ''}${pr.combined ? ' (combined)' : ''}`}
        title={pr.number}
        description={pr.purpose ?? undefined}
        actions={
          pr.can.edit ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/purchase/requisitions/${pr.id}/edit`}
              style={{ whiteSpace: 'nowrap' }}
            >
              Change the lines
            </a>
          ) : null
        }
      />
      <Notice params={sp} />

      <section className="ep-card" aria-labelledby="pr-st">
        <h2 id="pr-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
          {pr.revision ? (
            <>
              {' '}
              <Badge tone="info">{`Revision ${String(pr.revision)}`}</Badge>
            </>
          ) : null}
        </h2>
        {pr.autoRule ? <p style={{ marginTop: 0 }}>Approved by the system: {pr.autoNote}</p> : null}
        {pr.status === 'submitted' && pr.waitingWith ? (
          <p style={{ marginTop: 0 }}>Waiting with {pr.waitingWith}.</p>
        ) : null}
        {pr.decisionNote && pr.status !== 'approved' && pr.status !== 'submitted' ? (
          <Alert
            tone={pr.status === 'rejected' ? 'danger' : 'warning'}
            title={
              pr.status === 'rejected'
                ? 'Why it was rejected'
                : pr.status === 'sent_back'
                  ? 'What to change'
                  : 'Note'
            }
          >
            {pr.decisionNote}
          </Alert>
        ) : null}
        <p className="ep-field__help">
          Made by {pr.createdBy ?? '—'} on {when(pr.createdAt)}
          {pr.requiredBy ? ` · needed by ${when(pr.requiredBy)}` : ''}
          {pr.approvedAt ? ` · approved ${when(pr.approvedAt)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {pr.can.decide ? (
            <>
              <ConfirmAction
                action={decideRequisition}
                fields={{ id: pr.id, action: 'approve' }}
                label="Approve"
                title={`Approve ${pr.number}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {`${inr(pr.estimate)} (${TIER[tier].label.toLowerCase()}). It moves to the next level, or, at the last, to the purchase orders.`}
              </ConfirmAction>
              <ConfirmAction
                action={decideRequisition}
                fields={{ id: pr.id, action: 'send_back' }}
                label="Send back"
                title={`Send ${pr.number} back?`}
                confirmLabel="Send back"
                variant="secondary"
                reason={{ label: 'What to change (the purchase office sees it)' }}
              >
                The purchase office changes it and sends it again through every level.
              </ConfirmAction>
              <ConfirmAction
                action={decideRequisition}
                fields={{ id: pr.id, action: 'reject' }}
                label="Reject"
                title={`Reject ${pr.number}?`}
                confirmLabel="Reject"
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: 'Why it is rejected' }}
              >
                The requisition closes; its indents wait for a requisition again, with your reason.
              </ConfirmAction>
            </>
          ) : null}
          {pr.can.submit ? (
            <ConfirmAction
              action={submitRequisition}
              fields={{ id: pr.id }}
              label="Send for approval"
              title={`Send ${pr.number} for approval?`}
              confirmLabel="Send"
              variant="primary"
              blocked={
                missing.length
                  ? `Not ready yet: ${missing.map((m) => m.label).join('; ')}.`
                  : undefined
              }
            >
              {`It goes to ${pr.department ?? 'the department'}’s requisition levels; the lines and vendors cannot change while they decide.`}
            </ConfirmAction>
          ) : null}
          {pr.can.sign ? (
            <ConfirmAction
              action={signRequisition}
              fields={{ id: pr.id }}
              label="Sign the comparative statement"
              title="Sign the comparative statement?"
              confirmLabel="Sign"
              variant="primary"
              reason={{ label: 'Remark (optional)' }}
            >
              You confirm the quotes and the vendor chosen for each line, as the purchase committee.
            </ConfirmAction>
          ) : null}
          {pr.can.unsign ? (
            <ConfirmAction
              action={unsignRequisition}
              fields={{ id: pr.id }}
              label="Withdraw my signature"
              title="Withdraw your signature?"
              confirmLabel="Withdraw"
              variant="ghost"
            >
              The statement needs your signature (or another member’s) again.
            </ConfirmAction>
          ) : null}
          {pr.can.reopen ? (
            <ConfirmAction
              action={reopenRequisition}
              fields={{ id: pr.id }}
              label="Reopen to change"
              title={`Reopen ${pr.number}?`}
              confirmLabel="Reopen"
              variant="secondary"
              reason={{ label: 'What changes and why' }}
            >
              It goes back to draft; once changed it is approved again (the next revision).
            </ConfirmAction>
          ) : null}
          {pr.can.cancel ? (
            <ConfirmAction
              action={cancelRequisition}
              fields={{ id: pr.id }}
              label="Cancel the requisition"
              title={`Cancel ${pr.number}?`}
              confirmLabel="Cancel it"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why it is cancelled' }}
            >
              Its indents go back to To requisition.
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      {buy.length && !pr.autoRule ? (
        <section className="ep-card" aria-labelledby="pr-src">
          <h2 id="pr-src" className="ep-card__title">
            Sourcing: {TIER[tier].label}
          </h2>
          <p style={{ marginTop: 0 }}>
            Value <strong>{inr(pr.value)}</strong> before GST (the larger of the estimate and the
            chosen rates). Direct purchase up to {inr(pr.limits.direct)}; the purchase committee up
            to {inr(pr.limits.committee)}; a tender above. {TIER[tier].help}
          </p>
          {pr.requirements.length ? (
            <ul className="ep-purch-checks">
              {pr.requirements.map((r) => (
                <li key={r.key} data-met={r.met ? 'true' : 'false'}>
                  <Badge tone={r.met ? 'success' : 'warning'}>{r.met ? 'Done' : 'Needed'}</Badge>{' '}
                  {r.label}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section className="ep-card" aria-labelledby="pr-lines">
        <h2 id="pr-lines" className="ep-card__title">
          Lines
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pr-lines">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Quantity
                </th>
                <th scope="col">Vendor</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rate
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {pr.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>{l.seq}</td>
                  <td>
                    {l.item}
                    {l.itemCode ? ` (${l.itemCode})` : ''}
                    {!l.inCatalogue ? (
                      <span className="ep-mr-col__desc">In words: match it to an item</span>
                    ) : null}
                    {l.sources.length ? (
                      <span className="ep-mr-col__desc">
                        From{' '}
                        {l.sources.map((s, i) => (
                          <span key={s.indentId}>
                            {i ? ', ' : ''}
                            <a href={`/purchase/indents/${s.indentId}`}>{s.number}</a> (
                            {s.department}, {s.quantity})
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {l.note ? <span className="ep-mr-col__desc">{l.note}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.quantity} {l.uom}
                  </td>
                  <td>
                    {l.fulfil === 'store' ? (
                      <>
                        <Badge tone="info">From the store</Badge>
                        <span className="ep-mr-col__desc">{l.storeNote}</span>
                      </>
                    ) : (
                      <>
                        {l.vendor ?? 'Not chosen'}
                        {l.fromContract ? (
                          <span className="ep-mr-col__desc">Rate contract</span>
                        ) : null}
                        {l.dearer ? (
                          <span className="ep-mr-col__desc">Not the lowest: {l.choiceReason}</span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.fulfil === 'store'
                      ? '—'
                      : l.rate !== null
                        ? `${inr(l.rate)}${l.gstRate ? ` + ${String(l.gstRate)}% GST` : ''}`
                        : `est. ${inr(l.estRate)}`}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.fulfil === 'store' ? '—' : inr(l.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={5} style={{ textAlign: 'right' }}>
                  Before GST
                </th>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(pr.estimate)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {buy.length && !pr.autoRule && (pr.can.edit || pr.quotes.length) ? (
        <section className="ep-card" aria-labelledby="pr-quotes">
          <h2 id="pr-quotes" className="ep-card__title">
            Quotes and the comparative statement
          </h2>
          {pr.quotes.length ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Quotes">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Vendor</th>
                    <th scope="col">Quote</th>
                    <th scope="col">Delivery</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Total with GST
                    </th>
                    <th scope="col">
                      <span className="ep-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pr.quotes.map((q) => (
                    <tr key={q.id}>
                      <td>
                        {q.vendor} ({q.vendorCode})
                        <span className="ep-mr-col__desc">
                          {q.gstStatus === 'regular' ? 'GST registered' : `${q.gstStatus}: no GST`}
                          {q.msmeType ? ` · MSME ${q.msmeType}` : ''}
                          {q.vendorStatus !== 'active' ? ` · ${q.vendorStatus}` : ''}
                        </span>
                      </td>
                      <td>
                        {q.quoteRef ?? 'No reference'}
                        {q.quoteDate ? ` · ${when(q.quoteDate)}` : ''}
                        <span className="ep-mr-col__desc">
                          {q.validUntil ? `Valid until ${when(q.validUntil)}` : 'No validity given'}
                          {q.note ? ` · ${q.note}` : ''}
                        </span>
                        {q.fileId ? (
                          <FileLinks
                            href={`/api/files/${q.fileId}/download`}
                            label={`Quote of ${q.vendor}`}
                          />
                        ) : null}
                      </td>
                      <td>{q.deliveryDays !== null ? `${String(q.deliveryDays)} days` : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {inr(q.total)}
                        {!q.quotedAll ? (
                          <span className="ep-mr-col__desc">Not every line quoted</span>
                        ) : null}
                      </td>
                      <td>
                        {pr.can.edit ? (
                          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                            <a
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              href={`/purchase/requisitions/${pr.id}/quote?quoteId=${q.id}`}
                            >
                              Change
                            </a>
                            <ConfirmAction
                              action={removeQuote}
                              fields={{ id: pr.id, quoteId: q.id }}
                              label="Remove"
                              title={`Remove the quote of ${q.vendor}?`}
                              confirmLabel="Remove"
                              variant="ghost"
                              confirmVariant="danger"
                            >
                              Lines chosen from this quote lose their vendor; the committee’s
                              signatures are cleared.
                            </ConfirmAction>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ marginTop: 0 }}>
              No quote yet.
              {tier === 'committee'
                ? ` The committee needs at least ${String(pr.limits.quotes)}.`
                : ' A direct purchase or a tender can simply name the vendor and rate below.'}
            </p>
          )}
          {pr.can.edit ? (
            <p>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/requisitions/${pr.id}/quote`}
              >
                Add a quote
              </a>
            </p>
          ) : null}

          <form action={saveChoices}>
            <input type="hidden" name="id" value={pr.id} />
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Comparative statement"
            >
              <table className="ep-table">
                <caption className="ep-card__title" style={{ textAlign: 'left' }}>
                  Comparative statement: rate + GST = what the school pays per unit; the lowest is
                  L1
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    {pr.quotes.map((q) => (
                      <th key={q.id} scope="col" style={{ textAlign: 'right' }}>
                        {q.vendorCode}
                      </th>
                    ))}
                    <th scope="col">Chosen</th>
                  </tr>
                </thead>
                <tbody>
                  {buy.map((l) => (
                    <tr key={l.id}>
                      <th scope="row" style={{ fontWeight: 'normal', textAlign: 'left' }}>
                        <input type="hidden" name="lineId" value={l.id} />
                        {l.seq}. {l.item}
                        <span className="ep-mr-col__desc">
                          {l.quantity} {l.uom}
                        </span>
                      </th>
                      {pr.quotes.map((q) => {
                        const x = quoted(l.id, q.vendorId);
                        const isL1 = !!x && !!l.l1 && l.l1.vendorIds.includes(q.vendorId);
                        return (
                          <td key={q.id} style={{ textAlign: 'right' }}>
                            {x ? (
                              <>
                                {inr(x.rate)}
                                {x.gstRate ? ` + ${String(x.gstRate)}%` : ''}
                                {x.gstRate || isL1 ? (
                                  <span className="ep-mr-col__desc">
                                    {x.gstRate ? `${inr(x.landed)} ` : ''}
                                    {isL1 ? <Badge tone="success">L1</Badge> : null}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span className="ep-mr-col__desc">Not quoted</span>
                            )}
                          </td>
                        );
                      })}
                      <td>
                        {pr.can.edit && lists ? (
                          <div style={{ display: 'grid', gap: 'var(--sp-2)', minWidth: '14rem' }}>
                            <select
                              name={`vendor_${l.id}`}
                              className="ep-select"
                              aria-label={`Vendor for ${l.item}`}
                              defaultValue={l.vendorId ?? ''}
                            >
                              <option value="">Not chosen</option>
                              {pr.quotes
                                .filter((q) => quoted(l.id, q.vendorId))
                                .map((q) => (
                                  <option key={q.vendorId} value={q.vendorId}>
                                    {q.vendor}: {inr(quoted(l.id, q.vendorId)!.landed)}
                                    {l.l1?.vendorIds.includes(q.vendorId) ? ' (L1)' : ''}
                                  </option>
                                ))}
                              {tier !== 'committee'
                                ? lists.vendors
                                    .filter((v) => !quoted(l.id, v.id))
                                    .map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {v.name} ({v.code}): agreed rate
                                      </option>
                                    ))
                                : null}
                            </select>
                            {tier !== 'committee' ? (
                              <input
                                name={`rate_${l.id}`}
                                className="ep-input"
                                inputMode="decimal"
                                aria-label={`Agreed rate for ${l.item} (a vendor without a quote)`}
                                placeholder="Agreed rate (no quote)"
                                defaultValue={
                                  l.vendorId && !quoted(l.id, l.vendorId) && l.rate !== null
                                    ? l.rate
                                    : ''
                                }
                              />
                            ) : null}
                            <input
                              name={`reason_${l.id}`}
                              className="ep-input"
                              maxLength={300}
                              aria-label={`Reason for a vendor dearer than L1 for ${l.item}`}
                              placeholder="Reason, if not the lowest"
                              defaultValue={l.choiceReason ?? ''}
                            />
                          </div>
                        ) : (
                          <>
                            {l.vendor ?? 'Not chosen'}
                            {l.dearer ? (
                              <span className="ep-mr-col__desc">Not L1: {l.choiceReason}</span>
                            ) : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pr.can.edit ? (
              <p>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  Save the vendors chosen
                </button>{' '}
                <span className="ep-field__help">
                  {tier === 'committee'
                    ? 'The committee chooses from the quotes. Saving clears its signatures.'
                    : 'A vendor without a quote needs the agreed rate.'}
                </span>
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {buy.length && !pr.autoRule && (tier === 'direct' || pr.certificate) ? (
        <section className="ep-card" aria-labelledby="pr-cert">
          <h2 id="pr-cert" className="ep-card__title">
            Reasonable-price certificate
          </h2>
          {pr.certificate ? (
            <>
              <blockquote style={{ margin: 0 }}>{pr.certificate.text}</blockquote>
              <p className="ep-field__help">
                {pr.certificate.by ?? '—'} · {when(pr.certificate.at, true)}
              </p>
              {pr.can.edit ? (
                <form action={uncertifyRequisition}>
                  <input type="hidden" name="id" value={pr.id} />
                  <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                    Remove the certificate
                  </button>
                </form>
              ) : null}
            </>
          ) : pr.can.edit ? (
            <form action={certifyRequisition} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <input type="hidden" name="id" value={pr.id} />
              <label className="ep-field" htmlFor="pr-cert-text">
                <span className="ep-field__label">
                  The purchase officer certifies (GFR 2017 rule 154)
                </span>
                <textarea
                  id="pr-cert-text"
                  name="text"
                  className="ep-input"
                  rows={3}
                  maxLength={1000}
                  defaultValue={pr.certificateText}
                />
              </label>
              <div>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  Record the certificate in my name
                </button>
              </div>
            </form>
          ) : (
            <p>Not recorded.</p>
          )}
        </section>
      ) : null}

      {buy.length && !pr.autoRule && (tier === 'tender' || pr.tender.ref || pr.files.length) ? (
        <section className="ep-card" aria-labelledby="pr-tender">
          <h2 id="pr-tender" className="ep-card__title">
            Tender
          </h2>
          {pr.can.edit ? (
            <form action={saveTender} className="ep-grid__toolbar">
              <input type="hidden" name="id" value={pr.id} />
              <label className="ep-field" htmlFor="pr-tref">
                <span className="ep-field__label">Tender reference</span>
                <input
                  id="pr-tref"
                  name="tenderRef"
                  className="ep-input"
                  maxLength={120}
                  required
                  defaultValue={pr.tender.ref ?? ''}
                  placeholder="e.g. the GeM bid or newspaper notice number"
                />
              </label>
              <label className="ep-field" htmlFor="pr-tnote">
                <span className="ep-field__label">Note</span>
                <input
                  id="pr-tnote"
                  name="note"
                  className="ep-input"
                  maxLength={1000}
                  defaultValue={pr.tender.note ?? ''}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Save
              </button>
            </form>
          ) : (
            <p style={{ marginTop: 0 }}>
              {pr.tender.ref ?? 'No reference'}
              {pr.tender.note ? ` · ${pr.tender.note}` : ''}
            </p>
          )}
          <ul className="ep-purch-steps" style={{ listStyle: 'none', paddingLeft: 0 }}>
            {pr.files.map((f) => (
              <li key={f.id} style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <span>Tender document · {when(f.uploadedAt)}</span>
                <FileLinks href={`/api/files/${f.fileId}/download`} label="Tender document" />
                {pr.can.edit ? (
                  <form action={removeRequisitionFile}>
                    <input type="hidden" name="id" value={pr.id} />
                    <input type="hidden" name="fileId" value={f.id} />
                    <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {pr.can.edit ? (
            <form action={addRequisitionFile} className="ep-grid__toolbar">
              <input type="hidden" name="id" value={pr.id} />
              <label className="ep-field" htmlFor="pr-tfile">
                <span className="ep-field__label">Attach a tender document (PDF or photo)</span>
                <input
                  id="pr-tfile"
                  name="file"
                  type="file"
                  className="ep-input"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  required
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                Attach
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {buy.length && !pr.autoRule && showCommittee ? (
        <section className="ep-card" aria-labelledby="pr-cmt">
          <h2 id="pr-cmt" className="ep-card__title">
            The purchase committee’s signatures
          </h2>
          {pr.committee.members.length ? (
            <>
              <p style={{ marginTop: 0 }}>
                {pr.committee.required} of {pr.committee.members.length} members sign the
                comparative statement. A change of the lines, quotes or choices clears the
                signatures.
              </p>
              <ul className="ep-purch-steps" style={{ listStyle: 'none', paddingLeft: 0 }}>
                {pr.committee.members.map((m) => (
                  <li key={m.employeeId}>
                    <Badge tone={m.signedAt ? 'success' : 'neutral'}>
                      {m.signedAt ? 'Signed' : 'Not yet'}
                    </Badge>{' '}
                    {m.name}
                    {m.designation ? ` · ${m.designation}` : ''}
                    {m.role ? ` · ${m.role}` : ''}
                    {m.me ? ' (you)' : ''}
                    {m.signedAt ? ` · ${when(m.signedAt, true)}` : ''}
                    {m.note ? <span className="ep-mr-col__desc">{m.note}</span> : null}
                    {!m.signsIn ? (
                      <span className="ep-mr-col__desc">Cannot sign in: give them a login</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>
              No committee named yet: add the members on{' '}
              <a href="/purchase/settings">Purchase settings</a>.
            </p>
          )}
        </section>
      ) : null}

      {pr.steps.length ? (
        <section className="ep-card" aria-labelledby="pr-steps">
          <h2 id="pr-steps" className="ep-card__title">
            Approvals
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pr-steps">
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
                {pr.steps.map((s) => (
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

      {pr.history.length ? (
        <section className="ep-card" aria-labelledby="pr-hist">
          <h2 id="pr-hist" className="ep-card__title">
            History
          </h2>
          <ol className="ep-purch-steps">
            {pr.history.map((h, i) => (
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
