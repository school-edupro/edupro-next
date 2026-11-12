import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { Pager, PerPage } from '@/components/Pager';
import { DialogButton } from '@/components/leave/DialogButton';
import { ProcessButton } from '@/components/payroll/runs/ProcessButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import {
  FLAG_WORD,
  STAGE_TONE,
  STAGE_WORD,
  TYPE_WORD,
  type RecordList,
  type RunChecks,
  type RunDetail,
  type RunStage,
} from '@/lib/payroll-runs';
import { runAction } from '@/lib/payroll-runs-actions';

const STEPS: RunStage[] = ['DRAFT', 'PROCESSING', 'REVIEW', 'APPROVED', 'LOCKED', 'PAID'];
const SHOW = [
  ['all', 'All'],
  ['failed', 'Failed'],
  ['flagged', 'To look at'],
  ['held', 'Held'],
  ['topup', 'Top-ups'],
] as const;
const REC_TONE = {
  COMPUTED: 'neutral',
  FAILED: 'danger',
  HELD: 'warning',
  RELEASED: 'info',
  PAID: 'success',
} as const;
const REC_WORD = {
  COMPUTED: 'Worked out',
  FAILED: 'Failed',
  HELD: 'Held',
  RELEASED: 'Released',
  PAID: 'Paid',
} as const;
const ACTION_WORD: Record<string, string> = {
  create: 'Created',
  process: 'Processing started',
  processed: 'Processed',
  recompute: 'Worked out afresh',
  approve: 'Approved',
  reject: 'Rejected',
  lock: 'Locked',
  unapprove: 'Unapproved',
  reopen: 'Reopened',
  drop_failed: 'Failed records dropped',
  hold: 'Salary held',
  release: 'Salary released',
  recovery: 'Negative net recovered',
  remove: 'Removed',
};

/** A pay run (legacy Pay Run): its stage, the checks, processing, review of the records, approve, lock. */
export default async function PayrollRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const show = SHOW.find(([v]) => v === sp.show)?.[0] ?? 'all';
  const q = (sp.q ?? '').trim().slice(0, 60);
  const size = [25, 50, 100].includes(Number(sp.size)) ? Number(sp.size) : 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (p: number) => {
    const u = new URLSearchParams({ show, size: String(size), page: String(p) });
    if (q) u.set('q', q);
    return u.toString();
  };
  let d: RunDetail;
  let checks: RunChecks | null = null;
  let recs: RecordList;
  try {
    d = await apiFetch<RunDetail>(`/payroll/runs/${id}`);
    if (['DRAFT', 'PROCESSING', 'REJECTED'].includes(d.run.stage))
      checks = await apiFetch<RunChecks>(`/payroll/runs/${id}/checks`);
    recs = await apiFetch<RecordList>(`/payroll/runs/${id}/records?${qs(page)}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const r = d.run;
  const stage = r.stage;
  const failed = d.counts.FAILED ?? 0;
  const reason = (key: string, label: string, help: string, min = 3) => (
    <>
      <p className="ep-field__help">{help}</p>
      <label className="ep-field" htmlFor={`rn-${key}`}>
        <span className="ep-field__label">{label}</span>
        <textarea
          id={`rn-${key}`}
          name="comment"
          className="ep-input"
          rows={3}
          required
          minLength={min}
          maxLength={500}
        />
      </label>
    </>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Pay runs', href: '/payroll/runs' },
          { label: `${d.monthWords} · ${TYPE_WORD[r.runType]}` },
        ]}
      />
      <PageHeader
        kicker={`Pay run · ${TYPE_WORD[r.runType]}${r.seq > 1 ? ` #${String(r.seq)}` : ''}`}
        title={`${d.monthWords}`}
        description={[
          r.createdByName ? `Created by ${r.createdByName}` : null,
          r.approvedByName ? `approved by ${r.approvedByName}` : null,
          r.lockedByName ? `locked by ${r.lockedByName}` : null,
          r.remark,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Notice params={sp} />
      <ol
        className="ep-grid__toolbar"
        aria-label="The run's stages"
        style={{ listStyle: 'none', padding: 0 }}
      >
        {STEPS.map((s) => (
          <li key={s}>
            <Badge tone={s === stage ? STAGE_TONE[s] : 'neutral'}>
              {s === stage ? `● ${STAGE_WORD[s]}` : STAGE_WORD[s]}
            </Badge>
          </li>
        ))}
        {stage === 'REJECTED' ? (
          <li>
            <Badge tone="danger">● Rejected</Badge>
          </li>
        ) : null}
      </ol>
      <div className="ep-dash-kpis">
        <KpiTile
          label="Staff"
          value={`${String(r.empCount)}${d.eligible && d.eligible !== r.empCount ? ` of ${String(d.eligible)}` : ''}`}
        />
        <KpiTile label="Failed" value={String(failed)} />
        <KpiTile label="Held" value={String(d.counts.HELD ?? 0)} />
        <KpiTile label="Gross" value={`₹${money(r.grossTotal)}`} />
        <KpiTile label="Deductions" value={`₹${money(r.deductionTotal)}`} />
        <KpiTile label="Net" value={`₹${money(r.netTotal)}`} />
      </div>
      {checks ? (
        <section className="ep-card" aria-labelledby="rn-checks">
          <h2 id="rn-checks" className="ep-card__title">
            The checks before processing{' '}
            {checks.ok ? (
              <Badge tone="success">Nothing blocks it</Badge>
            ) : (
              <Badge tone="danger">{`${String(checks.red.length)} to fix`}</Badge>
            )}
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {checks.people} employee(s): {checks.fullMonth} a full month
            {checks.topUps ? `, ${String(checks.topUps)} only what is pending (already paid)` : ''}.
            Red stops the run until fixed; amber is to look at.
          </p>
          {checks.red.length || checks.amber.length ? (
            <ul>
              {checks.red.map((x, k) => (
                <li key={`r${String(k)}`}>
                  <Badge tone="danger">Fix</Badge>{' '}
                  {x.employee ? <strong>{x.employee}: </strong> : null}
                  {x.text}
                </li>
              ))}
              {checks.amber.slice(0, 30).map((x, k) => (
                <li key={`a${String(k)}`}>
                  <Badge tone="warning">Look</Badge>{' '}
                  {x.employee ? <strong>{x.employee}: </strong> : null}
                  {x.text}
                </li>
              ))}
              {checks.amber.length > 30 ? (
                <li>… and {checks.amber.length - 30} more to look at</li>
              ) : null}
            </ul>
          ) : null}
        </section>
      ) : null}
      <section className="ep-card" aria-labelledby="rn-do" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="rn-do" className="ep-card__title">
          {stage === 'DRAFT' || stage === 'PROCESSING'
            ? 'Process'
            : stage === 'REVIEW'
              ? 'Review, then approve or reject'
              : stage === 'APPROVED'
                ? 'Lock to release the payslips'
                : stage === 'REJECTED'
                  ? 'Rejected: correct the inputs and process again'
                  : 'Locked'}
        </h2>
        <div className="ep-grid__toolbar">
          {d.can.manage && ['DRAFT', 'PROCESSING', 'REJECTED'].includes(stage) ? (
            <ProcessButton
              runId={id}
              label={
                stage === 'REJECTED'
                  ? 'Work it out afresh'
                  : stage === 'PROCESSING'
                    ? 'Go on processing'
                    : 'Process the run'
              }
              disabled={!!checks && !checks.ok}
            />
          ) : null}
          {d.can.manage && stage === 'REVIEW' && failed ? (
            <ProcessButton runId={id} label="Process the failed again" />
          ) : null}
          {d.can.approve && stage === 'REVIEW' ? (
            <form action={runAction.bind(null, id, 'approve')}>
              <button
                type="submit"
                className="ep-btn ep-btn--primary"
                disabled={failed > 0 || (r.mine && !d.can.admin)}
              >
                Approve
              </button>
            </form>
          ) : null}
          {d.can.approve && stage === 'REVIEW' ? (
            <DialogButton
              id="rn-rej"
              label="Reject"
              title="Reject the run"
              className="ep-btn ep-btn--danger"
            >
              <form action={runAction.bind(null, id, 'reject')} className="ep-form-section__body">
                {reason(
                  'rej',
                  'What is wrong',
                  'A maker corrects the inputs and processes it again.',
                )}
                <p>
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Reject
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
          {d.can.approve && stage === 'APPROVED' ? (
            <form action={runAction.bind(null, id, 'lock')}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Lock and release the payslips
              </button>
            </form>
          ) : null}
          {d.can.approve && failed > 0 && ['DRAFT', 'REVIEW', 'REJECTED'].includes(stage) ? (
            <DialogButton
              id="rn-drop"
              label="Drop the failed"
              title="Drop the failed records"
              className="ep-btn ep-btn--ghost"
            >
              <form
                action={runAction.bind(null, id, 'drop-failed')}
                className="ep-form-section__body"
              >
                {reason(
                  'drop',
                  'Why (at least 10 letters)',
                  `${String(failed)} employee(s) are not paid in this run; a supplementary run can pay them later.`,
                  10,
                )}
                <p>
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Drop them
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
          <span className="ep-grid__spacer" />
          {d.can.admin && stage === 'APPROVED' ? (
            <DialogButton
              id="rn-unap"
              label="Unapprove"
              title="Unapprove the run"
              className="ep-btn ep-btn--ghost ep-btn--sm"
            >
              <form
                action={runAction.bind(null, id, 'unapprove')}
                className="ep-form-section__body"
              >
                {reason(
                  'unap',
                  'Why',
                  'It goes back to rejected; processing it again works it out afresh.',
                )}
                <p>
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Unapprove
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
          {d.can.admin && stage === 'LOCKED' ? (
            <DialogButton
              id="rn-reopen"
              label="Reopen"
              title="Reopen the run"
              className="ep-btn ep-btn--ghost ep-btn--sm"
            >
              <form action={runAction.bind(null, id, 'reopen')} className="ep-form-section__body">
                {reason(
                  'reopen',
                  'Why',
                  'Back to draft: every record is removed and what it took is given back (loan instalments, one-off lines, claims); fee receipts posted at the lock are reversed. Not once anything is paid or a later run exists.',
                )}
                <p>
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Reopen
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
          {d.can.manage && stage === 'DRAFT' && !r.empCount && !failed ? (
            <form action={runAction.bind(null, id, 'remove')}>
              <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                Remove the draft
              </button>
            </form>
          ) : null}
        </div>
        {stage === 'REVIEW' && r.mine && !d.can.admin ? (
          <p className="ep-field__help">You created this run: a different checker approves it.</p>
        ) : null}
        {stage === 'REVIEW' && failed ? (
          <p className="ep-field__help">
            Approval waits until no record has failed: fix the inputs and process again, or drop
            them.
          </p>
        ) : null}
        {d.receipts.posted || d.receipts.pending ? (
          <p className="ep-field__help">
            Fee recovery: {d.receipts.posted} receipt(s) posted
            {d.receipts.pending ? `, ${String(d.receipts.pending)} to post at the lock` : ''}.
          </p>
        ) : null}
      </section>
      <section className="ep-card" aria-labelledby="rn-recs" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="rn-recs" className="ep-card__title">
          Records{' '}
          {recs.summary.flagged ? (
            <Badge tone="warning">{`${String(recs.summary.flagged)} to look at`}</Badge>
          ) : null}
        </h2>
        <form method="get" className="ep-pfilter ep-grid__toolbar">
          <label className="ep-field" htmlFor="rn-q">
            <span className="ep-field__label">Name or code</span>
            <input id="rn-q" name="q" className="ep-input" defaultValue={q} maxLength={60} />
          </label>
          <label className="ep-field" htmlFor="rn-show">
            <span className="ep-field__label">Show</span>
            <select id="rn-show" name="show" className="ep-select" defaultValue={show}>
              {SHOW.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <PerPage id="rn-size" value={String(size)} />
          <button type="submit" className="ep-btn ep-btn--ghost">
            Show
          </button>
        </form>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="rn-recs">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Paid days</th>
                <th scope="col">Gross (₹)</th>
                <th scope="col">Deductions (₹)</th>
                <th scope="col">Net (₹)</th>
                <th scope="col">Last month (₹)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {recs.rows.length ? (
                recs.rows.map((x) => (
                  <tr key={x.id}>
                    <td>
                      <a href={`/payroll/runs/${id}/records/${x.id}`}>{x.name}</a>
                      <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                        {x.code}
                        {x.department ? ` · ${x.department}` : ''}
                      </span>
                    </td>
                    <td>{x.status === 'FAILED' ? '' : x.isTopUp ? 'Top-up' : x.paidDays}</td>
                    <td>{x.status === 'FAILED' ? '' : money(x.gross)}</td>
                    <td>{x.status === 'FAILED' ? '' : money(x.deductions)}</td>
                    <td>{x.status === 'FAILED' ? '' : <strong>{money(x.net)}</strong>}</td>
                    <td>{x.prevNet ? money(x.prevNet) : ''}</td>
                    <td>
                      <Badge tone={REC_TONE[x.status]}>{REC_WORD[x.status]}</Badge>
                      {x.failureReason ? (
                        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                          {x.failureReason}
                        </span>
                      ) : null}
                      {x.flags.map((f) => (
                        <span key={f}>
                          {' '}
                          <Badge tone="warning">{FLAG_WORD[f] ?? f}</Badge>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>
                    {r.empCount || failed
                      ? 'Nobody to show.'
                      : 'Nothing worked out yet: process the run.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={recs.page}
          size={recs.size}
          total={recs.total}
          href={(p) => `/payroll/runs/${id}?${qs(p)}`}
          noun="records"
        />
      </section>
      <FoldCard
        id="rn-history"
        title="History"
        hint={`${String(d.events.length)} event(s): who did what and why`}
      >
        <ul className="ep-setup-links">
          {d.events.map((e, k) => (
            <li key={String(k)}>
              <strong>{ACTION_WORD[e.action] ?? e.action}</strong> · {e.byName ?? ''} ·{' '}
              {new Date(e.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
              {e.comment ? (
                <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                  “{e.comment}”
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </FoldCard>
    </>
  );
}
