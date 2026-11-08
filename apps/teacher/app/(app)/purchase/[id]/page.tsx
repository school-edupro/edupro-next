import { Badge, Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { INDENT_ROUTE, INDENT_STATUS, inr, RATE_SOURCE, type IndentDetail } from '@/lib/purchase';
import {
  approveIndent,
  cancelIndent,
  rejectIndent,
  sendBackIndent,
  submitIndent,
} from '@/lib/purchase-actions';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const when = (iso: string, time = false) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso));
const STEP = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Rejected',
  skipped: 'Passed on',
} as const;

/**
 * One Purchase Indent in the staff app (docs/design/83, part 2): its lines and estimate, the approval
 * levels, and what I may do — change, send or withdraw mine; approve, send back or reject one at my level.
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
  const name = pi.number ?? t(lang, 'Draft');
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/purchase" style={{ textDecoration: 'underline' }}>
          ← {t(lang, 'Purchase indents')}
        </a>
      </p>
      <PageHeader
        kicker={`${t(lang, 'Purchase indents')} · ${pi.department}`}
        title={name}
        description={pi.purpose}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail || 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        <Card title={t(lang, 'Status')}>
          <p style={{ marginTop: 0 }}>
            <Badge tone={st.tone}>{st.label}</Badge>{' '}
            {pi.priority === 'urgent' ? <Badge tone="danger">Urgent</Badge> : null}{' '}
            {pi.estimate !== null ? <strong>{inr(pi.estimate)}</strong> : null}
          </p>
          <p>
            {pi.raisedBy}
            {pi.onBehalf ? ` for ${pi.onBehalf}` : ''} · {when(pi.createdAt)}
            {pi.requiredBy ? ` · needed by ${when(`${pi.requiredBy}T00:00:00+05:30`)}` : ''}
          </p>
          {pi.status === 'submitted' && pi.waitingWith ? <p>With {pi.waitingWith}.</p> : null}
          {pi.decisionNote && pi.status !== 'approved' ? (
            <p className="ep-alert ep-alert--warning" role="status">
              {pi.decisionNote}
            </p>
          ) : null}
          {pi.status === 'approved' && pi.route ? (
            <p>
              <strong>{INDENT_ROUTE[pi.route]}</strong>
              {pi.bypassNote ? <span className="ep-field__help"> {pi.bypassNote}</span> : null}
            </p>
          ) : null}
          {pi.departmentSpendThisYear !== null ? (
            <p className="ep-field__help">
              {pi.department}’s approved indents this year: {inr(pi.departmentSpendThisYear)}
            </p>
          ) : null}
          {pi.can.print ? (
            <p style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
              {t(lang, 'Print')}{' '}
              <FileLinks
                url={`/api/purchase-indent/${pi.id}`}
                saveUrl={`/api/purchase-indent/${pi.id}?save=1`}
                label={`${name} as a PDF`}
              />
            </p>
          ) : null}
        </Card>

        {pi.can.decide ? (
          <Card title={t(lang, 'Your decision')}>
            <form action={approveIndent} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={pi.id} />
              <label className="ep-field" htmlFor="pd-note">
                <span className="ep-field__label">
                  {t(lang, 'Remark (needed to send back or reject; the raiser sees it)')}
                </span>
                <textarea
                  id="pd-note"
                  name="reason"
                  className="ep-input"
                  rows={2}
                  maxLength={500}
                />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button type="submit" formAction={approveIndent} className="ep-btn ep-btn--primary">
                  {t(lang, 'Approve')}
                </button>
                <button
                  type="submit"
                  formAction={sendBackIndent}
                  className="ep-btn ep-btn--secondary"
                >
                  {t(lang, 'Send back')}
                </button>
                <button type="submit" formAction={rejectIndent} className="ep-btn ep-btn--danger">
                  {t(lang, 'Reject')}
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        {pi.can.edit || pi.can.cancel ? (
          <Card title={t(lang, 'Your indent')}>
            <div
              style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'end' }}
            >
              {pi.can.edit ? (
                <a className="ep-btn ep-btn--secondary" href={`/purchase/${pi.id}/edit`}>
                  {t(lang, 'Change')}
                </a>
              ) : null}
              {pi.can.submit ? (
                <form action={submitIndent}>
                  <input type="hidden" name="id" value={pi.id} />
                  <button type="submit" className="ep-btn ep-btn--primary">
                    {t(lang, 'Send for approval')}
                  </button>
                </form>
              ) : null}
            </div>
            {pi.can.cancel ? (
              <form
                action={cancelIndent}
                style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}
              >
                <input type="hidden" name="id" value={pi.id} />
                <label className="ep-field" htmlFor="pd-why">
                  <span className="ep-field__label">{t(lang, 'Withdraw it: why')}</span>
                  <input
                    id="pd-why"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={500}
                  />
                </label>
                <div>
                  <button type="submit" className="ep-btn ep-btn--ghost">
                    {t(lang, 'Withdraw')}
                  </button>
                </div>
              </form>
            ) : null}
          </Card>
        ) : null}

        <Card title={t(lang, 'Items')}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={t(lang, 'Items')}>
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Qty
                  </th>
                  <th scope="col">In store when raised</th>
                  {pi.showRates ? (
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Amount
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {pi.lineItems.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.item}
                      {pi.showRates || l.note ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {[
                            pi.showRates && l.estRate !== null
                              ? `${inr(l.estRate)} · ${l.rateSource ? RATE_SOURCE[l.rateSource] : ''}`
                              : null,
                            l.note,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                      {l.stockReason ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          Bought though the store has it: {l.stockReason}
                        </span>
                      ) : null}
                      {l.ordered ? (
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          <strong>{l.ordered}</strong>
                        </span>
                      ) : null}
                      {l.fileId ? (
                        <span
                          className="ep-field__help"
                          style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
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
                          {qty(l.stockFree)} {l.stockUom} free
                          <span className="ep-field__help" style={{ display: 'block' }}>
                            {l.stockStores.map((x) => `${x.store} ${qty(x.free)}`).join(' · ')}
                          </span>
                        </>
                      ) : (
                        'None free'
                      )}
                    </td>
                    {pi.showRates ? (
                      <td style={{ textAlign: 'right' }}>{inr(l.amount ?? 0)}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {pi.steps.length ? (
          <Card title={t(lang, 'Approvals')}>
            <ol
              style={{ margin: 0, paddingLeft: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-2)' }}
            >
              {pi.steps.map((s) => (
                <li key={s.id}>
                  <strong>{s.name}</strong> ·{' '}
                  {s.status !== 'pending'
                    ? STEP[s.status]
                    : s.level === nowLevel
                      ? STEP.pending
                      : pi.status === 'submitted'
                        ? 'Later'
                        : 'Not reached'}{' '}
                  · {s.actedBy ?? (s.assignees.map((a) => a.name).join(', ') || 'Nobody')}
                  {s.actedAt ? ` · ${when(s.actedAt, true)}` : ''}
                  {s.note ? (
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {s.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
