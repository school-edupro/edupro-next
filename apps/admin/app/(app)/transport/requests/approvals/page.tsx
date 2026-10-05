import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { decideManyTransport, decideTransport } from '@/lib/transport-desk-actions';
import {
  STATUS_LABEL,
  STATUS_TONE,
  approvalLine,
  monthLabel,
  rideLines,
  rupees,
  whoLine,
  type TransportRequest,
} from '@/lib/transport-desk';

/**
 * The transport requests that wait on me (transport in-charge, fee department, or whoever the admin
 * named), with approve and reject; below, the ones I decided lately.
 */
export default async function TransportApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, inbox] = await Promise.all([
    getMe(),
    apiFetch<{ data: TransportRequest[]; decided: TransportRequest[] }>(
      '/transport/requests/inbox',
    ),
  ]);
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="To approve"
        description={`${String(inbox.data.length)} transport ${inbox.data.length === 1 ? 'request waits' : 'requests wait'} for your approval. The last approval updates the fees.`}
      />
      <TransportNav
        current="/transport/requests/approvals"
        permissions={me.permissions}
        ok={sp.ok}
      />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {inbox.data.length === 0 ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing waits for you.
          </p>
        </Card>
      ) : null}
      {inbox.data.length > 1 ? (
        <Card title="Decide several in one go" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={decideManyTransport} className="ep-hd__form">
            <fieldset className="ep-slots">
              <legend className="ep-field__label">
                Tick the requests (all are ticked to start with)
              </legend>
              <div className="ep-slots__grid">
                {inbox.data.map((r) => (
                  <label key={r.id} className="ep-slots__slot">
                    <input type="checkbox" name="ids" value={r.id} defaultChecked />
                    <span>
                      {r.student}
                      {r.admissionNo ? ` (${r.admissionNo})` : ''} · {r.kindLabel} ·{' '}
                      {r.kind === 'leave'
                        ? `from ${monthLabel(r.fromMonth)}`
                        : rupees(r.monthlyAmount)}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="ep-gate__act">
              <input
                name="note"
                className="ep-input"
                maxLength={300}
                placeholder="Note (needed to reject)"
                aria-label="Note for the requests ticked"
              />
              <Button type="submit" name="outcome" value="approved" size="sm">
                Approve the ticked
              </Button>
              <Button type="submit" name="outcome" value="rejected" size="sm" variant="secondary">
                Reject the ticked
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {inbox.data.map((r) => (
        <Card
          key={r.id}
          title={`${r.student}${whoLine(r) ? ` · ${whoLine(r)}` : ''}`}
          actions={<Badge tone="warning">{r.kindLabel}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {r.kind === 'leave'
              ? `Stop the transport from ${monthLabel(r.fromMonth)}`
              : `${r.serviceLabel ?? ''} · ${monthLabel(r.fromMonth)} – ${monthLabel(r.toMonth)} · ${r.slab ?? 'no slab'} · ${rupees(r.monthlyAmount)} a month`}
          </p>
          <p className="ep-field__help">
            {[
              ...rideLines(r),
              approvalLine(r),
              `${r.source === 'office' ? 'made by the transport office' : 'asked by the family'}${r.requestedBy ? ` (${r.requestedBy})` : ''} on ${when(r.requestedAt)}`,
              r.note,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <form action={decideTransport} className="ep-gate__act">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="returnTo" value="/transport/requests/approvals" />
            <input
              name="note"
              className="ep-input"
              maxLength={300}
              placeholder="Note (needed to reject)"
              aria-label={`Note for ${r.number}`}
            />
            <Button type="submit" name="outcome" value="approved" size="sm">
              Approve
            </Button>
            <Button type="submit" name="outcome" value="rejected" size="sm" variant="secondary">
              Reject
            </Button>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/transport/requests/${r.id}`}
              aria-label={`Details of ${r.number}`}
            >
              Details
            </a>
          </form>
        </Card>
      ))}
      {inbox.decided.length ? (
        <Card title="Decided by you lately" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Decided lately">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Transport requests I decided lately</caption>
              <thead>
                <tr>
                  <th scope="col">Request</th>
                  <th scope="col">Student</th>
                  <th scope="col">Asked for</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {inbox.decided.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/transport/requests/${r.id}`}>{r.number}</a>
                    </td>
                    <td>
                      {r.student}
                      <div className="ep-field__help">{whoLine(r)}</div>
                    </td>
                    <td>{r.what}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
