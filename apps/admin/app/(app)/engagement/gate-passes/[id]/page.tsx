import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { ApprovalTrail } from '@/components/gate-passes/ApprovalTrail';
import { GatePassNav } from '@/components/gate-passes/GatePassNav';
import { HandoverPanel } from '@/components/gate-passes/HandoverPanel';
import { PassPhotos } from '@/components/gate-passes/PassPhotos';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { when } from '@/lib/appointments';
import { decidePass, gateInPass, gateOutPass } from '@/lib/gate-pass-actions';
import {
  STATE_TONE,
  escortLine,
  lateBack,
  outsideFor,
  type GatePassDetail,
} from '@/lib/gate-passes';

/**
 * One gate pass with everything on it: who and why, the approval matrix, the photos to compare, the
 * items carried, and the next step for whoever opens it (approve, hand over, let out, let in).
 */
export default async function GatePassPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, p] = await Promise.all([getMe(), apiFetch<GatePassDetail>(`/gate-passes/${id}`)]);
  const may = (code: string) => me.permissions.includes(code);
  const here = `/engagement/gate-passes/${p.id}`;
  const student = p.audience === 'student';
  const canHandover =
    may('engagement.gate_pass.handover') &&
    p.state === 'approved' &&
    student &&
    p.kind === 'early_leave';
  const canOut =
    may('engagement.gate_pass.gate') &&
    ((student && p.state === 'handed_over') || (!student && p.state === 'approved'));
  const canIn =
    may('engagement.gate_pass.gate') &&
    ((p.kind === 'rgp' && p.state === 'out') ||
      (p.kind === 'late_arrival' && p.state === 'approved'));
  const facts: Array<[string, string | null]> = [
    ['Pass', `${p.kindLabel} · ${p.number}`],
    [student ? 'Student' : 'Employee', p.who],
    ['Designation', student ? null : p.designation],
    ['Date and time', `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
    ['Back by', p.returnBy ? when(p.returnBy) : p.kind === 'nrgp' ? 'Not returning today' : null],
    ['Collected by', escortLine(p)],
    ['Collector’s mobile', p.escortMobile],
    ['Going to', p.destination],
    ['Reason', p.reason],
    ['Asked by', p.requestedBy ? `${p.requestedBy} on ${when(p.createdAt)}` : when(p.createdAt)],
    [
      'Made at',
      p.source === 'front_desk' ? 'The front desk' : student ? 'The parent portal' : 'The employee',
    ],
    [
      'Handed over',
      p.handoverAt ? `${when(p.handoverAt)}${p.handoverBy ? ` by ${p.handoverBy}` : ''}` : null,
    ],
    ['Front desk remark', p.handoverRemark],
    ['Parent’s code', p.otpVerified ? 'Confirmed' : null],
    ['Gate out', p.outAt ? `${when(p.outAt)}${p.outGate ? ` · ${p.outGate}` : ''}` : null],
    ['Gate in', p.inAt ? when(p.inAt) : null],
    [
      'Time outside',
      outsideFor(p)
        ? `${outsideFor(p)!}${lateBack(p) ? ' · back after the allowed time' : ''}`
        : null,
    ],
    ['Gate note', p.gateNote],
    ['Note', p.decisionNote ?? p.cancelReason],
  ];
  return (
    <>
      <PageHeader
        kicker={`Gate pass ${p.number}`}
        title={p.student ?? p.employee ?? 'Gate pass'}
        description={p.kindLabel}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <Badge tone={STATE_TONE[p.state]}>{p.stage}</Badge>
            {p.passNo ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/engagement/gate-passes/${p.id}/card`}
              >
                Pass card
              </a>
            ) : null}
          </span>
        }
      />
      <GatePassNav current="" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {p.canDecide ? (
        <Card title="Your approval" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={decidePass} className="ep-hd__form">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="returnTo" value={here} />
            <label className="ep-field" htmlFor="gp-note">
              <span className="ep-field__label">Note (needed to reject)</span>
              <input id="gp-note" name="note" className="ep-input" maxLength={300} />
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
      {student ? (
        <Card title="Photos to compare" style={{ marginBottom: 'var(--sp-4)' }}>
          <PassPhotos pass={p} />
          {p.guardians.length ? (
            <p className="ep-field__help">
              On record:{' '}
              {p.guardians
                .map(
                  (g) =>
                    `${g.name} (${g.relation}${g.mobileEnd ? `, mobile ending ${g.mobileEnd}` : ''})`,
                )
                .join(' · ')}
            </p>
          ) : null}
        </Card>
      ) : null}
      {canHandover ? (
        <Card title="Hand over at the front desk" style={{ marginBottom: 'var(--sp-4)' }}>
          <HandoverPanel
            id={p.id}
            collector={escortLine(p) ?? 'the person collecting'}
            otpNeeded={p.otpNeeded}
            outsider={p.escortKind === 'other'}
          />
        </Card>
      ) : null}
      {p.state === 'approved' && student && p.kind === 'early_leave' && !canHandover ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="info">
            Approved. The front desk hands the child over (photo
            {p.otpNeeded ? ' and the parent’s code' : ''}); the gate can let the child out only
            after that.
          </Alert>
        </div>
      ) : null}
      {canOut ? (
        <Card title="At the gate: going out" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={gateOutPass} className="ep-hd__row">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="returnTo" value={here} />
            <label className="ep-field" htmlFor="go-gate">
              <span className="ep-field__label">Gate</span>
              <input
                id="go-gate"
                name="gate"
                className="ep-input"
                maxLength={40}
                defaultValue="Main gate"
              />
            </label>
            <label className="ep-field" htmlFor="go-note">
              <span className="ep-field__label">Note{p.items ? ' (items checked?)' : ''}</span>
              <input id="go-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div>
              <Button type="submit">Let out</Button>
            </div>
          </form>
        </Card>
      ) : null}
      {canIn ? (
        <Card title="At the gate: coming in" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={gateInPass} className="ep-hd__form">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="returnTo" value={here} />
            {p.itemList
              .filter((i) => i.returnable)
              .map((i) => (
                <label key={i.id} className="ep-field" htmlFor={`gi-${i.id}`}>
                  <span className="ep-field__label">
                    {i.name}
                    {i.serialNo ? ` · ${i.serialNo}` : ''}: how many of {i.qty} came back
                  </span>
                  <input type="hidden" name="itemId" value={i.id} />
                  <input
                    id={`gi-${i.id}`}
                    name={`returned_${i.id}`}
                    type="number"
                    className="ep-input"
                    min={0}
                    max={i.qty}
                    defaultValue={i.qty}
                  />
                </label>
              ))}
            <label className="ep-field" htmlFor="gi-note">
              <span className="ep-field__label">Note</span>
              <input id="gi-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div>
              <Button type="submit">{p.kind === 'late_arrival' ? 'Let in' : 'Mark back in'}</Button>
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
      {p.itemList.length ? (
        <Card title="Items carried out" style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Items">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Items carried out on {p.number}</caption>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Serial / asset no.</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">To come back</th>
                  <th scope="col">Came back</th>
                </tr>
              </thead>
              <tbody>
                {p.itemList.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.serialNo ?? '—'}</td>
                    <td>{i.qty}</td>
                    <td>{i.returnable ? 'Yes' : 'No'}</td>
                    <td>
                      {i.returnable
                        ? `${String(i.returnedQty)} of ${String(i.qty)}${i.returnedAt ? ` · ${when(i.returnedAt)}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title="Approval">
        <ApprovalTrail pass={p} />
      </Card>
    </>
  );
}
