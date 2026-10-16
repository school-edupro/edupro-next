import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { HostelNav } from '@/components/hostel/HostelNav';
import {
  HW_REASON,
  HW_STATUS,
  HW_TONE,
  dmy,
  monthLabel,
} from '@/components/hostel/withdrawal-text';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  bypassHostelStep,
  cancelHostelWithdrawal,
  clearHostelStep,
  completeHostelWithdrawal,
} from '@/lib/hostel-withdrawal-actions';
import type { HostelClearance, HostelWithdrawal } from '@/lib/types';

const TONE: Record<HostelClearance['status'], 'success' | 'warning' | 'danger'> = {
  cleared: 'success',
  hold: 'danger',
  pending: 'warning',
};
const OK: Record<string, string> = {
  started: 'The hostel withdrawal is started.',
  saved: 'Saved.',
  bypassed: 'Bypassed.',
  completed: 'The pupil has left the hostel: the bed is free and the hostel fee is settled.',
  cancelled: 'The hostel withdrawal is cancelled; the pupil keeps the bed.',
};
const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN')}`;

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

/** One step's department: what it found, who clears it, and the form for them. */
function Department({ w, x }: { w: HostelWithdrawal; x: HostelClearance }) {
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
        {x.settles ? <Badge tone="info">settles the fee</Badge> : null}
      </div>
      <div className="ep-field__help">Cleared by {x.approvers.join(' or ')}</div>
      {x.check ? (
        <div className={x.check.due > 0 ? 'ep-wd__check ep-wd__check--due' : 'ep-wd__check'}>
          {x.check.detail}
        </div>
      ) : null}
      {x.remarks ? <div>{x.remarks}</div> : null}
      {Number(x.dues) > 0 && !x.check ? <div>Dues {rupees(x.dues)}</div> : null}
      {Number(x.charge) > 0 ? (
        <div>
          {x.chargeKind === 'mess' ? 'Mess dues' : 'Damages'} {rupees(x.charge)} raised as a misc
          fee
        </div>
      ) : null}
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
          <form action={clearHostelStep} className="ep-wd__form">
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="department" value={x.department} />
            <label className="ep-field" htmlFor={`st-${x.id}`}>
              <span className="ep-field__label">Decision</span>
              <select id={`st-${x.id}`} name="status" className="ep-select" defaultValue="cleared">
                <option value="cleared">Clear</option>
                <option value="hold">Hold (something is pending)</option>
              </select>
            </label>
            {x.chargeKind && !x.chargeMiscFeeId ? (
              <label className="ep-field" htmlFor={`ch-${x.id}`}>
                <span className="ep-field__label">
                  {x.chargeKind === 'mess' ? 'Mess dues to charge (₹)' : 'Damages to charge (₹)'}
                </span>
                <input
                  id={`ch-${x.id}`}
                  name="charge"
                  className="ep-input"
                  inputMode="decimal"
                  placeholder="0"
                />
                <span className="ep-field__help">Put on the pupil as a misc fee, due at once.</span>
              </label>
            ) : null}
            {x.settles ? (
              <fieldset className="ep-field ep-wd__wide" style={{ border: 0, padding: 0 }}>
                <legend className="ep-field__label">Hostel fee paid after it stops</legend>
                <label className="ep-roles__tick">
                  <input
                    type="radio"
                    name="feeChoice"
                    value="carry"
                    defaultChecked={w.feeChoice === 'carry'}
                  />{' '}
                  Carry forward (stays with the school as advance on the receipt)
                </label>
                <label className="ep-roles__tick">
                  <input
                    type="radio"
                    name="feeChoice"
                    value="refund"
                    defaultChecked={w.feeChoice === 'refund'}
                  />{' '}
                  Refund to the parent (through the fee approval levels)
                </label>
              </fieldset>
            ) : null}
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
            <form action={bypassHostelStep} className="ep-wd__form">
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
                  placeholder="e.g. no mess dues on record"
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

/** A hostel withdrawal: its steps, completion (bed and fee) and cancel. */
export default async function HostelWithdrawalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, w] = await Promise.all([
    getMe(),
    apiFetch<HostelWithdrawal>(`/hostel/withdrawals/${id}`),
  ]);
  const canManage = me.permissions.includes('hostel.withdrawal.manage');
  const open = w.status === 'requested' || w.status === 'cleared';
  const steps = [...new Set(w.clearances.map((x) => x.step))].sort((a, b) => a - b);
  const charges = w.clearances.reduce((n, x) => n + Number(x.charge), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Hostel', href: '/hostel' },
          { label: 'Withdrawals', href: '/hostel/withdrawals' },
          { label: w.studentName },
        ]}
      />
      <PageHeader
        kicker="Hostel withdrawal"
        title={`${w.studentName} · ${w.admissionNo}`}
        description={`${w.section ?? ''} · ${w.hostelName} ${w.place} · asked ${dmy(w.requestedOn)} · leaving ${dmy(w.leavingOn)} · ${HW_REASON[w.reason]}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={HW_TONE[w.status] ?? 'neutral'}>{HW_STATUS[w.status]}</Badge>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/fees/ledger/${w.studentId}?fee=hostel`}
            >
              Hostel fee
            </a>
          </span>
        }
      />
      <HostelNav current="/hostel/withdrawals" permissions={me.permissions} />
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? sp.detail) : sp.detail }} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        {w.noticeShort ? (
          <p className="ep-alert ep-alert--warning" role="status" style={{ marginTop: 0 }}>
            Short notice: the leaving date is less than {w.noticeDays ?? 0} days after the request,
            so the hostel fee of the month after leaving is charged too.
          </p>
        ) : null}
        {w.remarks ? <p style={{ marginTop: 0 }}>{w.remarks}</p> : null}
        <Docs docs={w.documents} />
        {w.requestedBy ? (
          <div className="ep-field__help">
            Started by {w.requestedBy} · request of {dmy(w.requestedOn)}
          </div>
        ) : null}
        {charges > 0 ? (
          <div className="ep-field__help">Charges raised: {rupees(charges)} (misc fees)</div>
        ) : null}
        {w.cancelReason ? <div className="ep-field__help">Cancelled: {w.cancelReason}</div> : null}
      </Card>

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
        <Card title="Leaving the hostel">
          {w.status === 'completed' ? (
            <>
              <p style={{ marginTop: 0 }}>
                Left on <strong>{dmy(w.leavingOn)}</strong>; the bed is free.
                {w.feeUntil ? ` Hostel fee up to ${monthLabel(w.feeUntil)}.` : ''}
              </p>
              {w.feeNote ? <p className="ep-field__help">{w.feeNote}</p> : null}
            </>
          ) : w.status === 'cancelled' ? (
            <p style={{ margin: 0 }}>Cancelled: the pupil keeps the bed.</p>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                When every step has cleared: the bed is given up on {dmy(w.leavingOn)}, the hostel
                fee stops after {w.noticeShort ? 'the next month' : 'the leaving month'}, and hostel
                months paid after that are{' '}
                {w.feeChoice === 'refund' ? 'sent for refund' : 'carried forward'}. The parent is
                told.
              </p>
              {w.canComplete ? (
                <ConfirmAction
                  action={completeHostelWithdrawal}
                  fields={{ id: w.id }}
                  label="Complete: leave the hostel"
                  title={`${w.studentName} leaves the hostel?`}
                  confirmLabel="Complete"
                  variant="primary"
                >
                  The bed {w.place} is given up on {dmy(w.leavingOn)} and the hostel fee is settled.
                  This cannot be undone here; to come back, the pupil is allotted a bed again.
                </ConfirmAction>
              ) : (
                <p className="ep-field__help">
                  {w.status === 'requested'
                    ? 'Waiting for the steps above.'
                    : 'The hostel office completes it.'}
                </p>
              )}
            </>
          )}
        </Card>
        {open && canManage ? (
          <Card title="Cancel">
            <ConfirmAction
              action={cancelHostelWithdrawal}
              fields={{ id: w.id }}
              label="Cancel the withdrawal"
              title="Cancel this hostel withdrawal?"
              confirmLabel="Cancel the withdrawal"
              confirmVariant="danger"
              reason={{ label: 'Why', placeholder: 'e.g. the parent changed their mind' }}
            >
              The pupil keeps the bed. Charges already raised stay as misc fees (cancel them from
              Misc fees if they were wrong).
            </ConfirmAction>
          </Card>
        ) : null}
      </div>
    </>
  );
}
