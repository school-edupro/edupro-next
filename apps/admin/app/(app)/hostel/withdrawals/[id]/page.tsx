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
  approveHostelWithdrawal,
  cancelHostelWithdrawal,
  completeHostelWithdrawal,
  rejectHostelWithdrawal,
} from '@/lib/hostel-withdrawal-actions';
import type { HostelApprovalStep, HostelWithdrawal } from '@/lib/types';

const STEP: Record<
  HostelApprovalStep['status'],
  ['success' | 'warning' | 'danger' | 'neutral', string]
> = {
  approved: ['success', 'approved'],
  pending: ['warning', 'waiting'],
  rejected: ['danger', 'not approved'],
  skipped: ['neutral', 'not reached'],
};
const OK: Record<string, string> = {
  started: 'The hostel withdrawal is started and sent for approval.',
  approved: 'Approved.',
  rejected: 'Not approved: the pupil keeps the bed.',
  completed: 'The pupil has left the hostel: the bed is free and the hostel fee is settled.',
  cancelled: 'The hostel withdrawal is cancelled; the pupil keeps the bed.',
};
const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN')}`;

function FeeChoice({ current }: { current: 'carry' | 'refund' }) {
  return (
    <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ep-field__label">Hostel fee paid after it stops</legend>
      <label className="ep-roles__tick">
        <input type="radio" name="feeChoice" value="carry" defaultChecked={current === 'carry'} />{' '}
        Carry forward (stays with the school as advance on the hostel receipt)
      </label>
      <label className="ep-roles__tick">
        <input type="radio" name="feeChoice" value="refund" defaultChecked={current === 'refund'} />{' '}
        Refund to the parent (through the refund approval)
      </label>
    </fieldset>
  );
}

/**
 * A hostel withdrawal: what was asked (dates, damages, mess dues), its approval levels (Fee setup →
 * Approval levels → Hostel withdrawal) with the decision for the approver of the current level, and
 * what the last approval did to the bed and the hostel fee.
 */
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
  const charges = Number(w.damageCharge) + Number(w.messCharge);
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

      <Card title="What is asked" style={{ marginBottom: 'var(--sp-4)' }}>
        {w.noticeShort ? (
          <p className="ep-alert ep-alert--warning" role="status" style={{ marginTop: 0 }}>
            Short notice: the leaving date is less than {w.noticeDays ?? 0} days after the request,
            so the hostel fee of the month after leaving is charged too.
          </p>
        ) : null}
        <dl className="hs-dl">
          <dt>Last day in the hostel</dt>
          <dd>{dmy(w.leavingOn)}</dd>
          <dt>Hostel fee up to</dt>
          <dd>
            {w.feeUntil
              ? monthLabel(w.feeUntil)
              : `${monthLabel(w.leavingOn)}${w.noticeShort ? ' and the next month' : ''} (on approval)`}
          </dd>
          <dt>Damages (room and inventory)</dt>
          <dd>{Number(w.damageCharge) > 0 ? rupees(w.damageCharge) : 'none'}</dd>
          <dt>Mess dues</dt>
          <dd>{Number(w.messCharge) > 0 ? rupees(w.messCharge) : 'none'}</dd>
          {w.chargeRemarks ? (
            <>
              <dt>About the charges</dt>
              <dd>{w.chargeRemarks}</dd>
            </>
          ) : null}
        </dl>
        {charges > 0 && w.status !== 'completed' ? (
          <p className="ep-field__help">
            The charges become misc fees of the pupil on the last approval.
          </p>
        ) : null}
        {w.remarks ? <p>{w.remarks}</p> : null}
        {w.documents.length ? (
          <div className="ep-filecell">
            <span className="ep-field__help">Documents</span>
            {w.documents.map((d, i) => (
              <FileLinks
                key={d.fileId}
                href={`/api/files/${d.fileId}/download`}
                label={`document ${String(i + 1)}`}
              />
            ))}
          </div>
        ) : null}
        {w.requestedBy ? (
          <div className="ep-field__help">
            Started by {w.requestedBy} · request of {dmy(w.requestedOn)}
          </div>
        ) : null}
        {w.cancelReason ? <div className="ep-field__help">Cancelled: {w.cancelReason}</div> : null}
      </Card>

      <Card title="Approval" style={{ marginBottom: 'var(--sp-4)' }}>
        {w.approval ? (
          <ol className="hs-approval">
            {w.approval.steps.map((s) => (
              <li
                key={s.id}
                data-current={
                  s.status === 'pending' && s.level === w.approval!.currentLevel
                    ? 'true'
                    : undefined
                }
              >
                <div>
                  <strong>
                    Level {s.level} · {s.name}
                  </strong>{' '}
                  {s.status === 'pending' && s.level !== w.approval!.currentLevel ? (
                    <Badge tone="neutral">later</Badge>
                  ) : (
                    <Badge tone={STEP[s.status][0]}>{STEP[s.status][1]}</Badge>
                  )}
                </div>
                <div className="ep-field__help">
                  {s.actedBy
                    ? `${s.actedBy}${s.actedAt ? ` · ${new Date(s.actedAt).toLocaleString('en-IN')}` : ''}`
                    : s.assignees.length
                      ? `With ${s.assignees.slice(0, 4).join(', ')}${s.assignees.length > 4 ? ` and ${String(s.assignees.length - 4)} more` : ''}`
                      : ''}
                </div>
                {s.note ? <div>{s.note}</div> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p style={{ margin: 0 }}>
            The approval levels of a hostel withdrawal are switched off: the hostel office completes
            it.
          </p>
        )}
        {w.decidedNote && w.status === 'rejected' ? (
          <p className="ep-alert ep-alert--danger" role="status">
            Not approved: {w.decidedNote}
          </p>
        ) : null}
        {w.myStep ? (
          <form className="hs-form" style={{ marginTop: 'var(--sp-3)', maxWidth: '40rem' }}>
            <input type="hidden" name="id" value={w.id} />
            {w.myStep.lastLevel ? <FeeChoice current={w.feeChoice} /> : null}
            <label className="ep-field" htmlFor="hw-note">
              <span className="ep-field__label">Note (needed to not approve)</span>
              <input id="hw-note" name="note" className="ep-input" maxLength={500} />
            </label>
            <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" formAction={approveHostelWithdrawal}>
                {w.myStep.lastLevel ? 'Approve: leave the hostel' : 'Approve'}
              </Button>
              <Button type="submit" variant="secondary" formAction={rejectHostelWithdrawal}>
                Do not approve
              </Button>
            </span>
            {w.myStep.lastLevel ? (
              <span className="ep-field__help">
                The last approval gives up the bed on {dmy(w.leavingOn)}, settles the hostel fee and
                raises the charges.
              </span>
            ) : null}
          </form>
        ) : w.status === 'requested' && w.waitingWith ? (
          <p className="ep-field__help">Waiting with: {w.waitingWith}.</p>
        ) : null}
      </Card>

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
          ) : w.status === 'cancelled' || w.status === 'rejected' ? (
            <p style={{ margin: 0 }}>The pupil keeps the bed.</p>
          ) : w.canComplete ? (
            <form action={completeHostelWithdrawal} className="hs-form">
              <input type="hidden" name="id" value={w.id} />
              <FeeChoice current={w.feeChoice} />
              <Button type="submit">Complete: leave the hostel</Button>
            </form>
          ) : (
            <p style={{ margin: 0 }}>
              On the last approval the bed is given up on {dmy(w.leavingOn)}, the hostel fee stops
              after {w.noticeShort ? 'the next month' : 'the leaving month'}, the charges become
              misc fees and the parent is told.
            </p>
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
              The pupil keeps the bed and the approval stops. Nothing is charged.
            </ConfirmAction>
          </Card>
        ) : null}
      </div>
    </>
  );
}
