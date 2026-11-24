import { Alert, Badge, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t, type Lang } from '@/lib/i18n';
import {
  INDENT_ROUTE,
  INDENT_STATUS,
  inr,
  RATE_SOURCE,
  type IndentDetail,
  type IndentStep,
} from '@/lib/purchase';
import { cancelIndent, decideIndent, submitIndent } from '@/lib/purchase-actions';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
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

/** Who a level waits with, or who decided it; a level that needs all shows each, ticked once they approved. */
function StepApprovers({ s, lang }: { s: IndentStep; lang: Lang }) {
  if (s.need === 'all' && s.status === 'pending') {
    const done = new Set((s.approvedBy ?? []).map((a) => a.id));
    return (
      <>
        <span>
          {s.assignees.map((a, i) => (
            <span key={a.id}>
              {i ? ', ' : ''}
              {done.has(a.id) ? '✓ ' : ''}
              {a.name}
            </span>
          ))}
        </span>
        <span className="ep-mr-col__desc">
          {t(lang, 'All of them must approve')} · {String(done.size)} / {String(s.assignees.length)}
        </span>
      </>
    );
  }
  if (s.actedBy) return <>{s.actedBy}</>;
  return <>{s.assignees.length ? s.assignees.map((a) => a.name).join(', ') : t(lang, 'Nobody')}</>;
}

/**
 * One Purchase Indent on the staff website, as the admin's page (docs/design/83, part 2): the status with what I
 * may do (change, send or withdraw mine; approve, send back or reject one at my level — each asks first), the
 * indent's facts, its lines with what the stores held free when it was raised (rates for those who see them), the
 * approval levels and who acted, and its history. Printed once sent.
 */
export default async function StaffIndentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  let pi: IndentDetail;
  try {
    // no permission check here: an approver without the raise right still opens the indents waiting for them;
    // the API shows an indent only to those who may see it
    pi = await bff.api.fetch<IndentDetail>(`/purchase/indents/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
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
  const name = pi.number ?? t(lang, 'Draft indent');
  const ask = {
    cancelLabel: t(lang, 'Cancel'),
    needReason: t(lang, 'Give a reason of at least 3 characters.'),
  };
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '72rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Purchase indents')}
        </a>
      </p>
      <PageHeader
        kicker={`${t(lang, 'Purchase')} · ${t(lang, 'Indent')} · ${pi.department}`}
        title={name}
        description={pi.purpose}
        actions={
          pi.can.edit || pi.can.print ? (
            <>
              {pi.can.print ? (
                <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
                  {t(lang, 'Print')}{' '}
                  <FileLinks
                    url={`/api/purchase-indent/${pi.id}`}
                    saveUrl={`/api/purchase-indent/${pi.id}?save=1`}
                    label={`${name} as a PDF`}
                  />
                </span>
              ) : null}
              {pi.can.edit ? (
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/purchase/${pi.id}/edit`}>
                  {t(lang, 'Change')}
                </a>
              ) : null}
            </>
          ) : null
        }
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || t(lang, 'Done.')}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}

      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <section className="ep-card" aria-labelledby="pi-st">
          <h2 id="pi-st" className="ep-card__title">
            {t(lang, 'Status')} <Badge tone={st.tone}>{t(lang, st.label)}</Badge>
            {pi.priority === 'urgent' ? (
              <>
                {' '}
                <Badge tone="danger">{t(lang, 'Urgent')}</Badge>
              </>
            ) : null}
          </h2>
          {pi.status === 'submitted' && pi.waitingWith ? (
            <p style={{ marginTop: 0 }}>
              {t(lang, 'Waiting with')} {pi.waitingWith}.
            </p>
          ) : null}
          {(pi.status === 'sent_back' || pi.status === 'rejected' || pi.status === 'cancelled') &&
          pi.decisionNote ? (
            <Alert
              tone={pi.status === 'rejected' ? 'danger' : 'warning'}
              title={t(
                lang,
                pi.status === 'rejected'
                  ? 'Why it was rejected'
                  : pi.status === 'sent_back'
                    ? 'What to change'
                    : 'Why it was withdrawn',
              )}
            >
              {pi.decisionNote}
            </Alert>
          ) : null}
          {pi.status === 'approved' && pi.route ? (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>{t(lang, INDENT_ROUTE[pi.route])}</strong>
                {pi.decidedAt ? ` · ${t(lang, 'approved')} ${when(pi.decidedAt)}` : ''}
              </p>
              {pi.bypassNote ? <p className="ep-field__help">{pi.bypassNote}</p> : null}
              {pi.requisitions.length ? (
                <p>
                  {pi.requisitions.map((r) => (
                    <span key={r.id}>
                      PR <strong>{r.number}</strong>
                      {r.autoRule ? ` (${t(lang, 'approved by the system')})` : ''}{' '}
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
                  {...ask}
                  action={decideIndent}
                  fields={{ id: pi.id, decision: 'approve' }}
                  label={t(lang, 'Approve')}
                  title={`${t(lang, 'Approve')} ${name}?`}
                  confirmLabel={t(lang, 'Approve')}
                  variant="primary"
                >
                  {`${pi.estimate !== null ? `${inr(pi.estimate)} · ` : ''}${pi.department}. ${t(lang, 'It moves to the next level, or, at the last, to the purchase office.')}`}
                </ConfirmAction>
                <ConfirmAction
                  {...ask}
                  action={decideIndent}
                  fields={{ id: pi.id, decision: 'send_back' }}
                  label={t(lang, 'Send back')}
                  title={`${t(lang, 'Send back for changes')}: ${name}?`}
                  confirmLabel={t(lang, 'Send back')}
                  variant="secondary"
                  reason={{ label: t(lang, 'What to change (the raiser sees it)') }}
                >
                  {t(
                    lang,
                    'The raiser changes it and sends it again; it goes through every level again.',
                  )}
                </ConfirmAction>
                <ConfirmAction
                  {...ask}
                  action={decideIndent}
                  fields={{ id: pi.id, decision: 'reject' }}
                  label={t(lang, 'Reject')}
                  title={`${t(lang, 'Reject')} ${name}?`}
                  confirmLabel={t(lang, 'Reject')}
                  variant="ghost"
                  confirmVariant="danger"
                  reason={{ label: t(lang, 'Why it is rejected (the raiser sees it)') }}
                >
                  {t(lang, 'The indent closes. The raiser can raise a new one.')}
                </ConfirmAction>
              </>
            ) : null}
            {pi.can.submit ? (
              <ConfirmAction
                {...ask}
                action={submitIndent}
                fields={{ id: pi.id }}
                label={t(lang, 'Send for approval')}
                title={`${t(lang, 'Send for approval')}: ${name}?`}
                confirmLabel={t(lang, 'Send')}
                variant="primary"
              >
                {`${pi.department}: ${t(lang, 'it goes to the department’s approvers in turn; you cannot change it while they decide.')}`}
              </ConfirmAction>
            ) : null}
            {pi.can.cancel ? (
              <ConfirmAction
                {...ask}
                action={cancelIndent}
                fields={{ id: pi.id }}
                label={t(lang, 'Withdraw')}
                title={`${t(lang, 'Withdraw')} ${name}?`}
                confirmLabel={t(lang, 'Withdraw')}
                variant="ghost"
                confirmVariant="danger"
                reason={{ label: t(lang, 'Why it is withdrawn') }}
              >
                {t(lang, 'The indent closes and its approvers are told nothing more is needed.')}
              </ConfirmAction>
            ) : null}
          </div>
        </section>

        <section className="ep-card" aria-labelledby="pi-facts">
          <h2 id="pi-facts" className="ep-card__title">
            {t(lang, 'The indent')}
          </h2>
          <dl className="ep-facts">
            <div>
              <dt>{t(lang, 'Department')}</dt>
              <dd>{pi.department}</dd>
            </div>
            <div>
              <dt>{t(lang, 'Raised by')}</dt>
              <dd>
                {pi.raisedBy}
                {pi.onBehalf ? ` ${t(lang, 'for')} ${pi.onBehalf}` : ''} · {when(pi.createdAt)}
              </dd>
            </div>
            <div>
              <dt>{t(lang, 'Needed by')}</dt>
              <dd>
                {pi.requiredBy ? when(`${pi.requiredBy}T00:00:00+05:30`) : t(lang, 'Not given')}
              </dd>
            </div>
            {pi.estimate !== null ? (
              <div>
                <dt>{t(lang, 'Estimate')}</dt>
                <dd>
                  <strong>{inr(pi.estimate)}</strong>
                </dd>
              </div>
            ) : null}
            {pi.departmentSpendThisYear !== null ? (
              <div>
                <dt>
                  {pi.department}: {t(lang, 'approved indents this year')}
                </dt>
                <dd>{inr(pi.departmentSpendThisYear)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section className="ep-card" aria-labelledby="pi-lines">
          <h2 id="pi-lines" className="ep-card__title">
            {t(lang, 'Items')}
          </h2>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pi-lines">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">{t(lang, 'Item')}</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    {t(lang, 'Quantity')}
                  </th>
                  <th scope="col">{t(lang, 'In store when raised')}</th>
                  {pi.showRates ? (
                    <>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        {t(lang, 'Rate')}
                      </th>
                      <th scope="col" style={{ textAlign: 'right' }}>
                        {t(lang, 'Amount')}
                      </th>
                      <th scope="col">{t(lang, 'Rate from')}</th>
                    </>
                  ) : null}
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
                        <span className="ep-mr-col__desc">{t(lang, 'Not in the item list')}</span>
                      ) : null}
                      {l.note ? <span className="ep-mr-col__desc">{l.note}</span> : null}
                      {l.stockReason ? (
                        <span className="ep-mr-col__desc">
                          {t(lang, 'Bought though the store has it:')} {l.stockReason}
                        </span>
                      ) : null}
                      {l.ordered ? (
                        <span className="ep-mr-col__desc">
                          <strong>{l.ordered}</strong>
                        </span>
                      ) : null}
                      {l.issues.length ? (
                        <span
                          className="ep-mr-col__desc"
                          style={{
                            display: 'flex',
                            gap: 'var(--sp-2)',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                          }}
                        >
                          {t(lang, 'Issue slips:')}
                          {l.issues.map((x) => (
                            <span
                              key={x.id}
                              style={{
                                display: 'inline-flex',
                                gap: 'var(--sp-1)',
                                alignItems: 'center',
                              }}
                            >
                              <a
                                style={{ textDecoration: 'underline' }}
                                href={`/purchase/issues/${x.id}`}
                              >
                                {x.number}
                              </a>
                              <FileLinks
                                url={`/api/purchase-issue/${x.id}`}
                                saveUrl={`/api/purchase-issue/${x.id}?save=1`}
                                label={`${x.number} slip as a PDF`}
                              />
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {l.fileId ? (
                        <span
                          className="ep-mr-col__desc"
                          style={{
                            display: 'inline-flex',
                            gap: 'var(--sp-1)',
                            alignItems: 'center',
                          }}
                        >
                          {t(lang, 'Document')}{' '}
                          <FileLinks
                            url={`/api/purchase-indent-file/${pi.id}/${l.id}`}
                            saveUrl={`/api/purchase-indent-file/${pi.id}/${l.id}?save=1`}
                            label={`the document of line ${String(l.seq)}`}
                          />
                        </span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {l.quantity} {l.uom}
                    </td>
                    <td>
                      {l.stockFree === null ? (
                        '—'
                      ) : l.stockFree > 0 ? (
                        <>
                          {qty(l.stockFree)} {l.stockUom} {t(lang, 'free')}
                          <span className="ep-mr-col__desc">
                            {l.stockStores.map((x) => `${x.store} ${qty(x.free)}`).join(' · ')}
                          </span>
                        </>
                      ) : (
                        t(lang, 'None free')
                      )}
                    </td>
                    {pi.showRates ? (
                      <>
                        <td style={{ textAlign: 'right' }}>{inr(l.estRate ?? 0)}</td>
                        <td style={{ textAlign: 'right' }}>{inr(l.amount ?? 0)}</td>
                        <td>
                          {l.rateSource ? t(lang, RATE_SOURCE[l.rateSource] ?? '') : null}
                          {l.contractVendor && l.rateSource === 'contract' ? (
                            <span className="ep-mr-col__desc">{l.contractVendor}</span>
                          ) : null}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              {pi.estimate !== null && pi.showRates ? (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={5} style={{ textAlign: 'right' }}>
                      {t(lang, 'Estimate')}
                    </th>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{inr(pi.estimate)}</strong>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>

        {pi.steps.length ? (
          <section className="ep-card" aria-labelledby="pi-steps">
            <h2 id="pi-steps" className="ep-card__title">
              {t(lang, 'Approvals')}
            </h2>
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pi-steps">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">{t(lang, 'Level')}</th>
                    <th scope="col">{t(lang, 'Approver')}</th>
                    <th scope="col">{t(lang, 'Status')}</th>
                    <th scope="col">{t(lang, 'Note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pi.steps.map((s) => (
                    <tr key={s.id} aria-current={s.level === nowLevel ? 'step' : undefined}>
                      <td>
                        {s.level}. {s.name}
                      </td>
                      <td>
                        <StepApprovers s={s} lang={lang} />
                      </td>
                      <td>
                        <Badge tone={stepOf(s).tone}>{t(lang, stepOf(s).label)}</Badge>
                        <span className="ep-mr-col__desc">
                          {s.actedAt
                            ? when(s.actedAt, true)
                            : s.level === nowLevel && s.dueAt
                              ? `${t(lang, s.overdue ? 'Overdue since' : 'Due')} ${when(s.dueAt, true)}`
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
              {t(lang, 'History')}
            </h2>
            <ol className="ep-purch-steps">
              {pi.history.map((h, i) => (
                <li key={i}>
                  <strong>{t(lang, EVENT[h.kind] ?? h.kind)}</strong>
                  {h.actor ? ` · ${h.actor}` : ''} · {when(h.at, true)}
                  {h.note ? <span className="ep-mr-col__desc">{h.note}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </main>
  );
}
