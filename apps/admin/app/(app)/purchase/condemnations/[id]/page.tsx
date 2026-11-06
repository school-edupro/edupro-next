import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { CONDEMNATION_STATUS, DISPOSAL_METHOD, type CondemnationDetail } from '@/lib/purchase';
import {
  approveCondemnation,
  cancelCondemnation,
  disposeCondemnation,
  rejectCondemnation,
  sendBackCondemnation,
  signCondemnation,
  submitCondemnation,
} from '@/lib/purchase-actions';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso.length === 10 ? `${iso}T00:00:00+05:30` : iso))
    : '—';
const money = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * One condemnation (docs/design/84, part 9): what is proposed and why, its book value; the committee's
 * signatures; the approval (written off); the disposal; the record as a PDF.
 */
export default async function CondemnationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const k = await apiFetch<CondemnationDetail>(`/purchase/condemnations/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    },
  );
  const st = CONDEMNATION_STATUS[k.status] ?? { label: k.status, tone: 'neutral' as const };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Condemnation', href: '/purchase/condemnations' },
          { label: k.number },
        ]}
      />
      <PageHeader
        kicker="Purchase · Condemnation"
        title={k.number}
        description={`${k.title} · ${money(k.value)} book value`}
        actions={
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <FileLinks
              href={`/api/purchase/stock-doc/condemnations/${k.id}`}
              label={`${k.number} as a PDF`}
            />
            {k.can.edit ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/purchase/condemnations/${k.id}/edit`}
              >
                Change
              </a>
            ) : null}
          </div>
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="cd-st">
        <h2 id="cd-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
        </h2>
        <p style={{ marginTop: 0 }} className="ep-field__help">
          Proposed by {k.createdBy ?? '—'} on {when(k.createdAt)}
          {k.writtenOffOn
            ? ` · written off ${when(k.writtenOffOn)} (approved by ${k.decidedBy ?? ''})`
            : ''}
        </p>
        {k.note ? <p>{k.note}</p> : null}
        {k.decisionNote && ['draft', 'rejected'].includes(k.status) ? (
          <Alert tone={k.status === 'rejected' ? 'danger' : 'warning'} title="Note">
            {k.decisionNote}
          </Alert>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {k.can.submit ? (
            <ConfirmAction
              action={submitCondemnation}
              fields={{ id: k.id }}
              label="Send to the committee"
              title={`Send ${k.number} to the condemnation committee?`}
              confirmLabel="Send"
              variant="primary"
            >
              {`The committee signs its recommendation; ${String(k.committee.required || 'every')} signature${k.committee.required === 1 ? '' : 's'} needed.`}
            </ConfirmAction>
          ) : null}
          {k.can.sign ? (
            <ConfirmAction
              action={signCondemnation}
              fields={{ id: k.id }}
              label="Sign: recommend it"
              title={`Recommend ${k.number}?`}
              confirmLabel="Sign"
              variant="primary"
            >
              {`You recommend writing off what is listed (${money(k.value)} book value).`}
            </ConfirmAction>
          ) : null}
          {k.can.sendBack ? (
            <ConfirmAction
              action={sendBackCondemnation}
              fields={{ id: k.id }}
              label="Send back"
              title={`Send ${k.number} back?`}
              confirmLabel="Send back"
              variant="secondary"
              reason={{ label: 'What to change' }}
            >
              It goes back to draft; the signatures start again.
            </ConfirmAction>
          ) : null}
          {k.can.decide ? (
            <>
              <ConfirmAction
                action={approveCondemnation}
                fields={{ id: k.id }}
                label="Approve: write off"
                title={`Approve ${k.number}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {`The assets are written off at their book value and the stock leaves the store (${money(k.value)}).`}
              </ConfirmAction>
              <ConfirmAction
                action={sendBackCondemnation}
                fields={{ id: k.id }}
                label="Send back"
                title={`Send ${k.number} back?`}
                confirmLabel="Send back"
                variant="secondary"
                reason={{ label: 'What to change' }}
              >
                It goes back to draft; the committee signs again.
              </ConfirmAction>
              <ConfirmAction
                action={rejectCondemnation}
                fields={{ id: k.id }}
                label="Reject"
                title={`Reject ${k.number}?`}
                confirmLabel="Reject"
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: 'Why' }}
              >
                Nothing is written off; held stock is free again.
              </ConfirmAction>
            </>
          ) : null}
          {k.can.cancel ? (
            <ConfirmAction
              action={cancelCondemnation}
              fields={{ id: k.id }}
              label="Cancel the proposal"
              title={`Cancel ${k.number}?`}
              confirmLabel="Cancel it"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why' }}
            >
              Held stock is free again.
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      <section className="ep-card" aria-labelledby="cd-lines">
        <h2 id="cd-lines" className="ep-card__title">
          What is proposed
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="cd-lines">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">Asset / item</th>
                <th scope="col">Why</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Book value
                </th>
              </tr>
            </thead>
            <tbody>
              {k.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.kind === 'asset' ? (
                      <a
                        href={`/purchase/assets/${l.assetId ?? ''}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {l.tag}
                      </a>
                    ) : (
                      `${(l.qty ?? 0).toLocaleString('en-IN')} ${l.unit ?? ''}`
                    )}{' '}
                    {l.item}
                    <span className="ep-mr-col__desc">
                      {[
                        l.store,
                        l.batch ? `Batch ${l.batch}` : null,
                        l.acquiredOn ? `bought ${when(l.acquiredOn)}` : null,
                        l.cost !== null ? `cost ${money(l.cost)}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </td>
                  <td>
                    {l.reasonLabel}
                    {l.reason ? <span className="ep-mr-col__desc">{l.reason}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(l.bookValue)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2} style={{ textAlign: 'right' }}>
                  Book value
                </th>
                <td style={{ textAlign: 'right' }}>{money(k.value)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="ep-card" aria-labelledby="cd-com">
        <h2 id="cd-com" className="ep-card__title">
          The condemnation committee
        </h2>
        <p style={{ marginTop: 0 }}>
          {k.committee.required} of {k.committee.members.length} signatures needed.
        </p>
        <ul className="ep-purch-checks">
          {k.committee.members.map((m) => (
            <li key={m.name}>
              {m.name}
              {m.role ? ` (${m.role})` : ''}{' '}
              {m.signedAt ? (
                <Badge tone="success">{`Signed ${when(m.signedAt)}`}</Badge>
              ) : (
                <Badge tone="neutral">Not signed</Badge>
              )}
            </li>
          ))}
        </ul>
      </section>

      {k.disposal ? (
        <section className="ep-card" aria-labelledby="cd-disp">
          <h2 id="cd-disp" className="ep-card__title">
            Disposal
          </h2>
          <p style={{ marginTop: 0 }}>
            {k.disposal.methodLabel} on {when(k.disposal.disposedOn)}
            {k.disposal.party ? ` to ${k.disposal.party}` : ''} for {money(k.disposal.amount)}
            {k.disposal.reference ? ` (${k.disposal.reference})` : ''}.
          </p>
          {k.disposal.note ? <p>{k.disposal.note}</p> : null}
        </section>
      ) : null}

      {k.can.dispose ? (
        <section className="ep-card" aria-labelledby="cd-dispose">
          <h2 id="cd-dispose" className="ep-card__title">
            Record the disposal
          </h2>
          {k.auctionNeeded ? (
            <Alert tone="warning" title="Above ₹2 lakh">
              The book value is above ₹2 lakh: dispose of it by public auction or tender and give
              its reference (GFR 2017 rule 217).
            </Alert>
          ) : null}
          <form action={disposeCondemnation}>
            <input type="hidden" name="id" value={k.id} />
            <div className="ep-form-row" data-columns="3">
              <label className="ep-field" htmlFor="dp-method">
                <span className="ep-field__label" data-required="true">
                  How
                </span>
                <select id="dp-method" name="method" className="ep-select" required>
                  {Object.entries(DISPOSAL_METHOD).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="dp-on">
                <span className="ep-field__label" data-required="true">
                  On
                </span>
                <input
                  id="dp-on"
                  name="disposedOn"
                  type="date"
                  className="ep-input"
                  defaultValue={today}
                  max={today}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="dp-party">
                <span className="ep-field__label">To (buyer or receiver)</span>
                <input id="dp-party" name="party" className="ep-input" maxLength={200} />
              </label>
              <label className="ep-field" htmlFor="dp-amount">
                <span className="ep-field__label">Amount realised (₹)</span>
                <input
                  id="dp-amount"
                  name="amount"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue="0"
                />
              </label>
              <label className="ep-field" htmlFor="dp-ref">
                <span className="ep-field__label">Auction / tender reference</span>
                <input id="dp-ref" name="reference" className="ep-input" maxLength={120} />
              </label>
              <label className="ep-field" htmlFor="dp-file">
                <span className="ep-field__label">Receipt or record (PDF / photo)</span>
                <input
                  id="dp-file"
                  name="file"
                  type="file"
                  className="ep-input"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                />
              </label>
            </div>
            <label className="ep-field" htmlFor="dp-note">
              <span className="ep-field__label">Note</span>
              <input id="dp-note" name="note" className="ep-input" maxLength={1000} />
            </label>
            <button
              type="submit"
              className="ep-btn ep-btn--primary ep-btn--sm"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              Record the disposal
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
