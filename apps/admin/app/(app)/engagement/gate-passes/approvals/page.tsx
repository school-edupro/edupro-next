import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { decidePass } from '@/lib/gate-pass-actions';
import {
  KIND_LABEL,
  STATE_TONE,
  approvalLine,
  escortLine,
  whoOfPass,
  type GatePass,
} from '@/lib/gate-passes';

/**
 * The gate passes that wait on me (class teacher, coordinator, vice principal, principal, or whoever the
 * admin named), with approve and reject; below, the ones I decided lately.
 */
export default async function GatePassApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, inbox] = await Promise.all([
    getMe(),
    apiFetch<{ data: GatePass[]; decided: GatePass[] }>('/gate-passes/inbox'),
  ]);
  return (
    <>
      <PageHeader
        kicker="Gate passes"
        title="To approve"
        description={`${String(inbox.data.length)} gate ${inbox.data.length === 1 ? 'pass waits' : 'passes wait'} for your approval.`}
      />
      <GatePassNav
        current="/engagement/gate-passes/approvals"
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
      {inbox.data.map((p) => (
        <Card
          key={p.id}
          title={whoOfPass(p)}
          actions={<Badge tone="warning">{KIND_LABEL[p.kind]}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p style={{ marginTop: 0 }}>
            {p.onDate}
            {p.atTime ? `, ${p.atTime}` : ''}
            {p.returnBy ? ` · back by ${when(p.returnBy)}` : ''} · {p.reason}
          </p>
          <p className="ep-field__help">
            {[
              escortLine(p) ? `Collected by ${escortLine(p)!}` : null,
              p.destination ? `Going to ${p.destination}` : null,
              p.items ? `${String(p.items)} item(s) carried out` : null,
              approvalLine(p),
              p.requestedBy ? `asked by ${p.requestedBy}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <form action={decidePass} className="ep-gate__act">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="returnTo" value="/engagement/gate-passes/approvals" />
            <input
              name="note"
              className="ep-input"
              maxLength={300}
              placeholder="Note (needed to reject)"
              aria-label={`Note for ${p.number}`}
            />
            <Button type="submit" name="outcome" value="approved" size="sm">
              Approve
            </Button>
            <Button type="submit" name="outcome" value="rejected" size="sm" variant="secondary">
              Reject
            </Button>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/engagement/gate-passes/${p.id}`}
              aria-label={`Details of ${p.number}`}
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
              <caption className="ep-sr-only">Gate passes I decided lately</caption>
              <thead>
                <tr>
                  <th scope="col">Pass</th>
                  <th scope="col">For</th>
                  <th scope="col">Date</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {inbox.decided.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a href={`/engagement/gate-passes/${p.id}`}>{p.number}</a>
                    </td>
                    <td>{whoOfPass(p)}</td>
                    <td>{p.onDate}</td>
                    <td>
                      <Badge tone={STATE_TONE[p.state]}>{p.stage}</Badge>
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
