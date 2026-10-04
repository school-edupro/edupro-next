import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { PeriodTable } from '@/components/transport/PeriodTable';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { decideTransport } from '@/lib/transport-desk-actions';
import {
  APPROVAL_LABEL,
  APPROVAL_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  monthLabel,
  rupees,
  whoLine,
  type TransportRequestDetail,
} from '@/lib/transport-desk';

/**
 * One transport request with everything on it: who and what, the approval levels, the next step for
 * whoever opens it, what happened to the fees, and the pupil's transport history.
 */
export default async function TransportRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, r] = await Promise.all([
    getMe(),
    apiFetch<TransportRequestDetail>(`/transport/requests/${id}`),
  ]);
  const here = `/transport/requests/${r.id}`;
  const leave = r.kind === 'leave';
  const facts: Array<[string, string | null]> = [
    ['Request', `${r.kindLabel} · ${r.number}`],
    ['Student', `${r.student}${whoLine(r) ? ` · ${whoLine(r)}` : ''}`],
    ['Service', leave ? null : r.serviceLabel],
    [
      'Pick',
      !leave && r.service !== 'drop' && r.pickStop
        ? `${r.pickStop} · ${r.pickRoute ?? ''}${r.pickTime ? ` · ${r.pickTime}` : ''}`
        : null,
    ],
    [
      'Drop',
      !leave && r.service !== 'pick' && r.dropStop
        ? `${r.dropStop} · ${r.dropRoute ?? ''}${r.dropTime ? ` · ${r.dropTime}` : ''}`
        : null,
    ],
    [leave ? 'No transport from' : 'From month', monthLabel(r.fromMonth)],
    ['To month', leave ? null : monthLabel(r.toMonth)],
    ['Slab', leave ? null : r.slab],
    ['Monthly charge', leave ? null : rupees(r.monthlyAmount)],
    ['Made by', r.source === 'office' ? 'The transport office' : 'The family (portal)'],
    [
      'Asked by',
      r.requestedBy ? `${r.requestedBy} on ${when(r.requestedAt)}` : when(r.requestedAt),
    ],
    ['Note', r.note],
    ['Decided', r.decidedAt ? when(r.decidedAt) : null],
    ['Decision note', r.decisionNote],
  ];
  return (
    <>
      <PageHeader
        kicker="Transport request"
        title={`${r.student} · ${r.number}`}
        description={r.what}
        actions={<Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}
      />
      <TransportNav current="" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {r.feeNote ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert
            tone={
              r.feeNote.startsWith('Fees updated') && !r.feeNote.includes('except')
                ? 'success'
                : 'warning'
            }
          >
            {r.feeNote}.
          </Alert>
        </div>
      ) : null}
      {r.canDecide ? (
        <Card title="Your approval" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={decideTransport} className="ep-hd__form">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="returnTo" value={here} />
            <label className="ep-field" htmlFor="tr-note">
              <span className="ep-field__label">Note (needed to reject)</span>
              <input id="tr-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" name="outcome" value="approved">
                Approve
              </Button>
              <Button type="submit" name="outcome" value="rejected" variant="secondary">
                Reject
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Details" style={{ marginBottom: 'var(--sp-4)' }}>
        <dl className="ep-hd__facts">
          {facts
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </Card>
      <Card title="Approval" style={{ marginBottom: 'var(--sp-4)' }}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          One after another, in this order. The last approval writes the transport period and
          updates the fees.
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Approval levels">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Approval levels of {r.number}</caption>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Who</th>
                <th scope="col">Status</th>
                <th scope="col">Decided by</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {r.approvals.map((a) => (
                <tr key={a.seq}>
                  <td>
                    {a.seq}. {a.label}
                  </td>
                  <td>{a.approvers ?? '—'}</td>
                  <td>
                    <Badge tone={APPROVAL_TONE[a.status]}>{APPROVAL_LABEL[a.status]}</Badge>
                  </td>
                  <td>
                    {a.actedBy ?? '—'}
                    {a.actedAt ? <div className="ep-field__help">{when(a.actedAt)}</div> : null}
                  </td>
                  <td>{a.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card
        title="Transport history of the student"
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/transport/history?when=all&studentId=${r.studentId}`}
          >
            Open history
          </a>
        }
      >
        {r.periods.length ? (
          <PeriodTable periods={r.periods} caption={`Transport history of ${r.student}`} />
        ) : (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No transport period yet this session.
          </p>
        )}
      </Card>
    </>
  );
}
