import { Alert, Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  inr,
  RATE_SOURCE,
  type IndentDetail,
  type IndentStep,
} from '@/lib/purchase';
import { cancelIndent, decideIndent, submitIndent } from '@/lib/purchase-actions';

const when = (iso: string | null, time = false) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
      }).format(new Date(iso))
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
 * One Purchase Indent (docs/design/83, part 2): what is asked and why, its lines with where each rate
 * came from, the department's approved indents this year, the approval levels and who acted, where it
 * went once approved (the PR, or a PR made by the system under a bypass rule), and its history. The
 * raiser changes, sends or withdraws it; the current level's approver approves, sends back or rejects.
 */
export default async function IndentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  // no permission check here: an approver without the raise right still opens the indents waiting
  // for them; the API shows an indent only to those who may see it
  const pi = await apiFetch<IndentDetail>(`/purchase/indents/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = INDENT_STATUS[pi.status];
  // the level deciding now; the levels after it are still to come
  const nowLevel =
    pi.status === 'submitted'
      ? (pi.steps.find((x) => x.status === 'pending')?.level ?? null)
      : null;
  const stepOf = (s: IndentStep) =>
    s.status !== 'pending'
      ? STEP[s.status]
      : s.level === nowLevel
        ? STEP.pending
        : { label: pi.status === 'submitted' ? 'Later' : 'Not reached', tone: 'neutral' as const };
  const name = pi.number ?? 'Draft indent';
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Purchase Indents', href: '/purchase/indents' }, { label: name }]}
      />
      <PageHeader
        kicker={`Purchase · Indent · ${pi.department}`}
        title={name}
        description={pi.purpose}
        actions={
          pi.can.edit ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/purchase/indents/${pi.id}/edit`}
            >
              Change
            </a>
          ) : null
        }
      />
      <Notice params={sp} />

      <section className="ep-card" aria-labelledby="pi-st">
        <h2 id="pi-st" className="ep-card__title">
          Status <Badge tone={st.tone}>{st.label}</Badge>
          {pi.priority === 'urgent' ? (
            <>
              {' '}
              <Badge tone="danger">Urgent</Badge>
            </>
          ) : null}
        </h2>
        {pi.status === 'submitted' && pi.waitingWith ? (
          <p style={{ marginTop: 0 }}>Waiting with {pi.waitingWith}.</p>
        ) : null}
        {pi.status === 'sent_back' || pi.status === 'rejected' || pi.status === 'cancelled' ? (
          pi.decisionNote ? (
            <Alert
              tone={pi.status === 'rejected' ? 'danger' : 'warning'}
              title={
                pi.status === 'rejected'
                  ? 'Why it was rejected'
                  : pi.status === 'sent_back'
                    ? 'What to change'
                    : 'Why it was withdrawn'
              }
            >
              {pi.decisionNote}
            </Alert>
          ) : null
        ) : null}
        {pi.status === 'approved' && pi.route ? (
          <>
            <p style={{ marginTop: 0 }}>
              <strong>{INDENT_ROUTE[pi.route]}</strong>
              {pi.decidedAt ? ` · approved ${when(pi.decidedAt)}` : ''}
            </p>
            {pi.bypassNote ? <p className="ep-field__help">{pi.bypassNote}</p> : null}
            {pi.requisitions.length ? (
              <p>
                {pi.requisitions.map((r) => (
                  <span key={r.id}>
                    PR {r.number}
                    {r.autoRule ? ' (approved by the system)' : ''}{' '}
                  </span>
                ))}
              </p>
            ) : null}
          </>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          {pi.can.decide ? (
            <>
              <ConfirmAction
                action={decideIndent}
                fields={{ id: pi.id, action: 'approve' }}
                label="Approve"
                title={`Approve ${name}?`}
                confirmLabel="Approve"
                variant="primary"
              >
                {`${inr(pi.estimate)} for ${pi.department}. It moves to the next level, or, at the last, to the purchase office.`}
              </ConfirmAction>
              <ConfirmAction
                action={decideIndent}
                fields={{ id: pi.id, action: 'send_back' }}
                label="Send back"
                title={`Send ${name} back for changes?`}
                confirmLabel="Send back"
                variant="secondary"
                reason={{ label: 'What to change (the raiser sees it)' }}
              >
                The raiser changes it and sends it again; it goes through every level again.
              </ConfirmAction>
              <ConfirmAction
                action={decideIndent}
                fields={{ id: pi.id, action: 'reject' }}
                label="Reject"
                title={`Reject ${name}?`}
                confirmLabel="Reject"
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: 'Why it is rejected (the raiser sees it)' }}
              >
                The indent closes. The raiser can raise a new one.
              </ConfirmAction>
            </>
          ) : null}
          {pi.can.submit ? (
            <ConfirmAction
              action={submitIndent}
              fields={{ id: pi.id }}
              label="Send for approval"
              title={`Send ${name} for approval?`}
              confirmLabel="Send"
              variant="primary"
            >
              {`It goes to ${pi.department}’s approvers in turn; you cannot change it while they decide.`}
            </ConfirmAction>
          ) : null}
          {pi.can.cancel ? (
            <ConfirmAction
              action={cancelIndent}
              fields={{ id: pi.id }}
              label="Withdraw"
              title={`Withdraw ${name}?`}
              confirmLabel="Withdraw"
              variant="ghost"
              confirmVariant="danger"
              reason={{ label: 'Why it is withdrawn' }}
            >
              The indent closes and its approvers are told nothing more is needed.
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      <section className="ep-card" aria-labelledby="pi-facts">
        <h2 id="pi-facts" className="ep-card__title">
          The indent
        </h2>
        <dl className="ep-facts">
          <div>
            <dt>Department</dt>
            <dd>{pi.department}</dd>
          </div>
          <div>
            <dt>Raised by</dt>
            <dd>
              {pi.raisedBy}
              {pi.onBehalf ? ` for ${pi.onBehalf}` : ''} · {when(pi.createdAt)}
            </dd>
          </div>
          <div>
            <dt>Needed by</dt>
            <dd>{pi.requiredBy ? when(`${pi.requiredBy}T00:00:00+05:30`) : 'Not given'}</dd>
          </div>
          <div>
            <dt>Estimate</dt>
            <dd>
              <strong>{inr(pi.estimate)}</strong>
            </dd>
          </div>
          <div>
            <dt>{pi.department}’s approved indents this year</dt>
            <dd>{inr(pi.departmentSpendThisYear)}</dd>
          </div>
        </dl>
      </section>

      <section className="ep-card" aria-labelledby="pi-lines">
        <h2 id="pi-lines" className="ep-card__title">
          Items
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pi-lines">
          <table className="ep-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Item</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Quantity
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Rate
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Amount
                </th>
                <th scope="col">Rate from</th>
              </tr>
            </thead>
            <tbody>
              {pi.lineItems.map((l) => (
                <tr key={l.id}>
                  <td>{l.seq}</td>
                  <td>
                    {l.item}
                    {l.itemCode ? ` (${l.itemCode})` : ''}
                    {!l.inCatalogue ? (
                      <span className="ep-mr-col__desc">Not in the item list</span>
                    ) : null}
                    {l.note ? <span className="ep-mr-col__desc">{l.note}</span> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {l.quantity} {l.uom}
                  </td>
                  <td style={{ textAlign: 'right' }}>{inr(l.estRate)}</td>
                  <td style={{ textAlign: 'right' }}>{inr(l.amount)}</td>
                  <td>
                    {RATE_SOURCE[l.rateSource]}
                    {l.contractVendor && l.rateSource === 'contract' ? (
                      <span className="ep-mr-col__desc">{l.contractVendor}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} style={{ textAlign: 'right' }}>
                  Estimate
                </th>
                <td style={{ textAlign: 'right' }}>
                  <strong>{inr(pi.estimate)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {pi.steps.length ? (
        <section className="ep-card" aria-labelledby="pi-steps">
          <h2 id="pi-steps" className="ep-card__title">
            Approvals
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pi-steps">
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
                {pi.steps.map((s) => (
                  <tr key={s.id} aria-current={s.level === nowLevel ? 'step' : undefined}>
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

      {pi.history.length ? (
        <section className="ep-card" aria-labelledby="pi-hist">
          <h2 id="pi-hist" className="ep-card__title">
            History
          </h2>
          <ol className="ep-purch-steps">
            {pi.history.map((h, i) => (
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
