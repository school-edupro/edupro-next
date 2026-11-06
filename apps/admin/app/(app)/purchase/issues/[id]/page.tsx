import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ReturnToStoreForm } from '@/components/purchase/ReturnToStoreForm';
import { ApiError, apiFetch } from '@/lib/api';
import type { IssueDetail } from '@/lib/purchase';
import { acknowledgeIssue } from '@/lib/purchase-actions';

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
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * One issue (docs/design/84, part 8): what went out of the store, to which department and who took
 * it, at what cost; the department's acknowledgement (or the slip signed on paper); the issue slip;
 * goods brought back against it.
 */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const is = await apiFetch<IssueDetail>(`/purchase/issues/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Issues', href: '/purchase/issues' },
          { label: is.number },
        ]}
      />
      <PageHeader
        kicker={`Purchase · ${is.kindLabel}`}
        title={is.number}
        description={`${is.store} → ${is.department}${is.takenBy ? ` · taken by ${is.takenBy}` : ''}`}
        actions={
          <FileLinks
            href={`/api/purchase/stock-doc/issues/${is.id}`}
            label={`${is.number} slip as a PDF`}
          />
        }
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="is-st">
        <h2 id="is-st" className="ep-card__title">
          Status{' '}
          <Badge tone={is.status === 'acknowledged' ? 'success' : 'warning'}>
            {is.status === 'acknowledged' ? 'Acknowledged' : 'Waiting for acknowledgement'}
          </Badge>
        </h2>
        {is.status === 'acknowledged' ? (
          <p style={{ marginTop: 0 }}>
            {is.ackOnPaper ? 'Slip signed on paper, recorded by ' : 'Acknowledged by '}
            {is.acknowledgedBy} on {when(is.acknowledgedAt)}
            {is.ackNote ? `: ${is.ackNote}` : ''}.
          </p>
        ) : null}
        <p className="ep-field__help">
          Issued on {when(is.issuedOn)}
          {is.issuedBy ? ` by ${is.issuedBy}` : ''}
          {is.indent ? (
            <>
              {' '}
              · for <a href={`/purchase/indents/${is.indentId ?? ''}`}>{is.indent}</a>
            </>
          ) : null}
          {is.requisition ? (
            <>
              {' '}
              · <a href={`/purchase/requisitions/${is.requisitionId ?? ''}`}>{is.requisition}</a>
            </>
          ) : null}
          {is.receipt ? (
            <>
              {' '}
              · on <a href={`/purchase/receipts/${is.receiptId ?? ''}`}>{is.receipt}</a>
            </>
          ) : null}
          {is.purpose ? ` · ${is.purpose}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {is.can.acknowledge ? (
            <ConfirmAction
              action={acknowledgeIssue}
              fields={{ id: is.id }}
              label="Acknowledge: received"
              title={`Acknowledge ${is.number}?`}
              confirmLabel="Acknowledge"
              variant="primary"
            >
              {`You confirm ${is.department} received what is listed (${String(is.lines)} lines, ${money(is.value)}).`}
            </ConfirmAction>
          ) : null}
          {is.can.acknowledgeOnPaper && !is.can.acknowledge ? (
            <ConfirmAction
              action={acknowledgeIssue}
              fields={{ id: is.id, onPaper: '1' }}
              label="Record the signed slip"
              title={`Record the signed slip of ${is.number}?`}
              confirmLabel="Record it"
              variant="secondary"
              reason={{ label: 'Who signed it, and where the slip is kept' }}
            >
              For a department without a sign-in: the slip it signed is the acknowledgement.
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      <section className="ep-card" aria-labelledby="is-lines">
        <h2 id="is-lines" className="ep-card__title">
          What went out
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="is-lines">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Quantity
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rate
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Value
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Came back
                </th>
              </tr>
            </thead>
            <tbody>
              {is.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.item} ({l.itemCode})
                    {l.batch || l.indent ? (
                      <span className="ep-mr-col__desc">
                        {[l.batch ? `Batch ${l.batch}` : null, l.indent ? `For ${l.indent}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {fmt(l.qty)} {l.unit}
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(l.rate)}</td>
                  <td style={{ textAlign: 'right' }}>{money(l.value)}</td>
                  <td style={{ textAlign: 'right' }}>{l.returned ? fmt(l.returned) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3} style={{ textAlign: 'right' }}>
                  Value issued
                </th>
                <td style={{ textAlign: 'right' }}>{money(is.value)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="ep-field__help">
          Out at the store’s average cost; the earliest expiry first unless a batch was named.
        </p>
      </section>

      {is.returns.length ? (
        <section className="ep-card" aria-labelledby="is-ret">
          <h2 id="is-ret" className="ep-card__title">
            Brought back
          </h2>
          <ul className="ep-purch-checks">
            {is.returns.map((r) => (
              <li key={r.id}>
                <a href={`/purchase/returns/${r.id}`}>{r.number}</a> · {when(r.returnedOn)} ·{' '}
                {r.lines} line{r.lines === 1 ? '' : 's'}
                {r.by ? ` · ${r.by}` : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {is.can.returnToStore ? (
        <section className="ep-card" aria-labelledby="is-back">
          <h2 id="is-back" className="ep-card__title">
            Goods brought back
          </h2>
          <Alert tone="info">
            Unused goods go back into stock at the rate they went out at; damaged goods are recorded
            (for condemnation) and stay out of stock.
          </Alert>
          <ReturnToStoreForm issue={is} />
        </section>
      ) : null}
    </>
  );
}
