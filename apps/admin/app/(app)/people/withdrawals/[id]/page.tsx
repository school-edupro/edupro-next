import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import {
  bypassClearance,
  cancelWithdrawal,
  completeWithdrawal,
  issueWithdrawalTc,
  recordClearance,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Clearance, Withdrawal } from '@/lib/types';

const TONE: Record<Clearance['status'], 'success' | 'warning' | 'danger'> = {
  cleared: 'success',
  hold: 'danger',
  pending: 'warning',
};

function Docs({ docs }: { docs: Array<{ fileId: string; name: string | null }> }) {
  if (!docs.length) return null;
  return (
    <div className="ep-filecell">
      <span className="ep-field__help">Documents</span>
      {docs.map((d, i) => (
        <FileLinks
          key={d.fileId}
          href={`/api/files/${d.fileId}/download`}
          label={`document ${String(i + 1)}`}
        />
      ))}
    </div>
  );
}

/** One department's clearance: what the check found, who clears it, and the actions for them. */
function Department({ w, x }: { w: Withdrawal; x: Clearance }) {
  const waiting = x.status !== 'cleared' && x.step === w.currentStep;
  const label =
    x.status === 'cleared'
      ? x.bypassed
        ? 'bypassed'
        : x.auto
          ? 'cleared automatically'
          : 'cleared'
      : x.status === 'hold'
        ? 'on hold'
        : waiting
          ? 'waiting'
          : 'later step';
  return (
    <div className="ep-wd__dept" data-status={x.status}>
      <div className="ep-wd__dept-head">
        <strong>{x.departmentName}</strong>
        <Badge tone={x.status === 'pending' && !waiting ? 'neutral' : TONE[x.status]}>
          {label}
        </Badge>
        {x.gatesTc ? <Badge tone="info">TC after this</Badge> : null}
      </div>
      <div className="ep-field__help">Cleared by {x.approvers.join(' or ')}</div>
      {x.check ? (
        <div className={x.check.due > 0 ? 'ep-wd__check ep-wd__check--due' : 'ep-wd__check'}>
          {x.check.detail}
        </div>
      ) : null}
      {x.remarks ? <div>{x.remarks}</div> : null}
      {Number(x.dues) > 0 ? <div>Dues ₹{Number(x.dues).toLocaleString('en-IN')}</div> : null}
      <Docs docs={x.documents} />
      {x.actedBy || x.actedAt ? (
        <div className="ep-field__help">
          {x.actedBy ?? 'System'}
          {x.actedAt ? ` · ${new Date(x.actedAt).toLocaleString('en-IN')}` : ''}
        </div>
      ) : null}
      {x.canAct ? (
        <details className="ep-wd__act" open={waiting}>
          <summary>Record {x.departmentName}</summary>
          <form action={recordClearance} className="ep-wd__form">
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="department" value={x.department} />
            <label className="ep-field" htmlFor={`st-${x.id}`}>
              <span className="ep-field__label">Decision</span>
              <select id={`st-${x.id}`} name="status" className="ep-select" defaultValue="cleared">
                <option value="cleared">Clear</option>
                <option value="hold">Hold (something is pending)</option>
              </select>
            </label>
            <label className="ep-field" htmlFor={`du-${x.id}`}>
              <span className="ep-field__label">Dues (₹)</span>
              <input
                id={`du-${x.id}`}
                name="dues"
                className="ep-input"
                inputMode="decimal"
                defaultValue={Number(x.dues) > 0 ? x.dues : ''}
              />
            </label>
            <label className="ep-field ep-wd__wide" htmlFor={`re-${x.id}`}>
              <span className="ep-field__label">Remarks</span>
              <input
                id={`re-${x.id}`}
                name="remarks"
                className="ep-input"
                maxLength={500}
                defaultValue={x.auto ? '' : (x.remarks ?? '')}
              />
            </label>
            <label className="ep-field ep-wd__wide" htmlFor={`do-${x.id}`}>
              <span className="ep-field__label">
                Document{x.documentRequired ? ' (required to clear)' : ' (optional)'}
              </span>
              <input
                id={`do-${x.id}`}
                name="documents"
                type="file"
                multiple
                className="ep-input"
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
            </label>
            <Button type="submit" size="sm">
              Save
            </Button>
          </form>
          {x.bypassAllowed && x.status !== 'cleared' ? (
            <form action={bypassClearance} className="ep-wd__form">
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="department" value={x.department} />
              <label className="ep-field ep-wd__wide" htmlFor={`by-${x.id}`}>
                <span className="ep-field__label">Bypass reason</span>
                <input
                  id={`by-${x.id}`}
                  name="reason"
                  className="ep-input"
                  minLength={3}
                  maxLength={300}
                  required
                  placeholder="e.g. does not use the school bus"
                />
              </label>
              <Button type="submit" size="sm" variant="ghost">
                Bypass {x.departmentName}
              </Button>
            </form>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

/** A withdrawal: the departments step by step, the TC once it may be issued, completion and cancel. */
export default async function WithdrawalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [l, me, w] = await Promise.all([
    getTranslations('lifecycle'),
    getMe(),
    apiFetch<Withdrawal>(`/people/withdrawals/${id}`),
  ]);
  const canManage = me.permissions.includes('people.withdrawal.manage');
  const canTc = me.permissions.includes('people.tc.issue');
  const open = w.status === 'requested' || w.status === 'cleared';
  const steps = [...new Set(w.clearances.map((x) => x.step))].sort((a, b) => a - b);
  const gateWaiting = w.clearances
    .filter((x) => x.gatesTc && x.status !== 'cleared')
    .map((x) => x.departmentName);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Withdrawals', href: '/people/withdrawals' },
          { label: w.studentName },
        ]}
      />
      <PageHeader
        kicker="Withdrawal"
        title={`${w.studentName} · ${w.admissionNo}`}
        description={`${w.section ?? ''} · started ${w.initiatedOn} · leaving ${w.leavingOn} · ${w.reason}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge
              tone={
                w.status === 'completed'
                  ? 'success'
                  : w.status === 'cancelled'
                    ? 'danger'
                    : w.status === 'cleared'
                      ? 'info'
                      : 'warning'
              }
            >
              {l(`withdrawalStatuses.${w.status}`)}
            </Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/people/students/${w.studentId}?tab=status`}
            >
              Student
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {w.remarks || w.documents.length || w.requestedBy || w.cancelReason ? (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          {w.remarks ? <p style={{ marginTop: 0 }}>{w.remarks}</p> : null}
          <Docs docs={w.documents} />
          {w.requestedBy ? (
            <div className="ep-field__help">
              Started by {w.requestedBy} on {w.requestedOn}
            </div>
          ) : null}
          {w.cancelReason ? (
            <div className="ep-field__help">Cancelled: {w.cancelReason}</div>
          ) : null}
        </Card>
      ) : null}

      <div className="ep-wd__steps">
        {steps.map((step) => {
          const list = w.clearances.filter((x) => x.step === step);
          const done = list.every((x) => x.status === 'cleared');
          return (
            <section
              key={step}
              className="ep-wd__step"
              data-current={w.currentStep === step ? 'true' : undefined}
              aria-label={`Step ${String(step)}`}
            >
              <h2 className="ep-wd__step-title">
                Step {step}{' '}
                {done ? (
                  <Badge tone="success">done</Badge>
                ) : w.currentStep === step && open ? (
                  <Badge tone="warning">now</Badge>
                ) : null}
              </h2>
              <div className="ep-wd__depts">
                {list.map((x) => (
                  <Department key={x.id} w={w} x={x} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="ep-wd__end">
        <Card title="Transfer certificate">
          {w.tc ? (
            <p style={{ margin: 0 }}>
              TC <strong>{w.tc.tcNo}</strong> issued. <a href="/people/tc">Open the TC register</a>
            </p>
          ) : w.canIssueTc && canTc ? (
            <form action={issueWithdrawalTc} className="ep-wd__form">
              <input type="hidden" name="id" value={w.id} />
              <label className="ep-field" htmlFor="tc-on">
                <span className="ep-field__label">Issue date</span>
                <input
                  id="tc-on"
                  name="issuedOn"
                  type="date"
                  className="ep-input"
                  defaultValue={w.leavingOn}
                />
              </label>
              <label className="ep-field" htmlFor="tc-conduct">
                <span className="ep-field__label">Conduct</span>
                <input
                  id="tc-conduct"
                  name="conduct"
                  className="ep-input"
                  defaultValue="Good"
                  maxLength={60}
                />
              </label>
              <label className="ep-field ep-wd__wide" htmlFor="tc-promo">
                <span className="ep-field__label">Promotion status</span>
                <input
                  id="tc-promo"
                  name="promotionStatus"
                  className="ep-input"
                  maxLength={120}
                  placeholder="e.g. Passed Class XII"
                />
              </label>
              <Button type="submit" size="sm">
                Issue TC
              </Button>
            </form>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              {w.status === 'cancelled'
                ? 'The withdrawal was cancelled.'
                : `The TC can be issued once ${gateWaiting.join(', ') || 'the departments'} ${
                    gateWaiting.length === 1 ? 'clears' : 'clear'
                  }.`}
            </p>
          )}
        </Card>
        {open && canManage ? (
          <Card title="Finish">
            <form action={completeWithdrawal}>
              <input type="hidden" name="id" value={w.id} />
              <Button type="submit" disabled={w.status !== 'cleared'}>
                Complete withdrawal
              </Button>
              <p className="ep-field__help">
                {w.status === 'cleared'
                  ? 'Ends the enrolment and revokes the student’s login (and a parent’s when no other child studies here).'
                  : 'Available once every department has cleared.'}
              </p>
            </form>
            <form
              action={cancelWithdrawal}
              className="ep-wd__form"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <input type="hidden" name="id" value={w.id} />
              <label className="ep-field ep-wd__wide" htmlFor="cancel-reason">
                <span className="ep-field__label">Cancel reason</span>
                <input
                  id="cancel-reason"
                  name="reason"
                  className="ep-input"
                  required
                  maxLength={300}
                />
              </label>
              <Button type="submit" size="sm" variant="ghost">
                Cancel withdrawal
              </Button>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
