import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { approveGatePass, rejectGatePass } from '../actions';

type State = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'handed_over' | 'out' | 'returned';
type LevelStatus = 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped';
interface Detail {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  kind: 'early_leave' | 'late_arrival' | 'rgp' | 'nrgp' | 'hostel_home' | 'hostel_outing';
  kindLabel: string;
  source: string;
  state: State;
  stage: string;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  reason: string;
  destination: string | null;
  student: string | null;
  employee: string | null;
  designation: string | null;
  who: string;
  escortName: string | null;
  escortRelation: string | null;
  escortMobile: string | null;
  passNo: string | null;
  decisionNote: string | null;
  handoverAt: string | null;
  handoverBy: string | null;
  handoverRemark: string | null;
  otpVerified: boolean;
  otpNeeded: boolean;
  outAt: string | null;
  outGate: string | null;
  inAt: string | null;
  gateNote: string | null;
  cancelReason: string | null;
  requestedBy: string | null;
  createdAt: string;
  canDecide: boolean;
  approvalMode: 'sequence' | 'any';
  approvalNeed: number;
  approvals: Array<{
    seq: number;
    label: string;
    status: LevelStatus;
    approvers: string | null;
    actedBy: string | null;
    actedAt: string | null;
    note: string | null;
    mandatory: boolean;
  }>;
  itemList: Array<{
    id: string;
    name: string;
    qty: number;
    serialNo: string | null;
    returnable: boolean;
    returnedQty: number;
    returnedAt: string | null;
  }>;
  photos: Record<'student' | 'father' | 'mother' | 'guardian' | 'collector', boolean>;
  guardians: Array<{ relation: string; name: string; mobileEnd: string | null }>;
}

const TONE: Record<State, 'warning' | 'success' | 'danger' | 'info' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  handed_over: 'info',
  out: 'info',
  returned: 'neutral',
};
const LEVEL: Record<LevelStatus, [string, 'warning' | 'success' | 'danger' | 'neutral']> = {
  waiting: ['Waits its turn', 'neutral'],
  pending: ['To decide now', 'warning'],
  approved: ['Approved', 'success'],
  rejected: ['Rejected', 'danger'],
  skipped: ['Skipped', 'neutral'],
};
const PARTY: Record<string, string> = {
  student: 'Student',
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  collector: 'Collecting (taken at the front desk)',
};
const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * One gate pass with everything on it, as the admin website's page: who and why, its stage and the pass card; my
 * approval when it waits on me; the photos to compare (a pupil's pass); the details; the items carried and how many
 * came back; the approval levels. The front desk and the gate hand over and let out on the admin website.
 */
export default async function GatePassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  const w = (en: string) => t(lang, en);
  let p: Detail;
  try {
    p = await bff.api.fetch<Detail>(`/gate-passes/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const student = p.audience === 'student';
  const outsideMin =
    p.outAt && p.inAt
      ? Math.max(0, Math.round((Date.parse(p.inAt) - Date.parse(p.outAt)) / 60_000))
      : null;
  const late =
    p.kind === 'rgp' &&
    Boolean(p.returnBy && p.outAt) &&
    Date.parse(p.inAt ?? new Date().toISOString()) > Date.parse(p.returnBy!);
  const facts: Array<[string, string | null]> = [
    [w('Pass'), `${p.kindLabel} · ${p.number}`],
    [student ? w('Student') : w('Employee'), p.who],
    [w('Designation'), student ? null : p.designation],
    [w('Date and time'), `${p.onDate}${p.atTime ? `, ${p.atTime}` : ''}`],
    [
      w('Back by'),
      p.returnBy ? when(p.returnBy) : p.kind === 'nrgp' ? w('Not returning today') : null,
    ],
    [
      w('Collected by'),
      p.escortName ? `${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}` : null,
    ],
    [w('Collector’s mobile'), p.escortMobile],
    [w('Going to'), p.destination],
    [w('Reason'), p.reason],
    [w('Asked by'), p.requestedBy ? `${p.requestedBy} · ${when(p.createdAt)}` : when(p.createdAt)],
    [
      w('Made at'),
      p.source === 'front_desk'
        ? w('The front desk')
        : student
          ? w('The parent portal')
          : w('The employee'),
    ],
    [
      w('Handed over'),
      p.handoverAt ? `${when(p.handoverAt)}${p.handoverBy ? ` · ${p.handoverBy}` : ''}` : null,
    ],
    [w('Front desk remark'), p.handoverRemark],
    [w('Parent’s code'), p.otpVerified ? w('Confirmed') : null],
    [w('Gate out'), p.outAt ? `${when(p.outAt)}${p.outGate ? ` · ${p.outGate}` : ''}` : null],
    [w('Gate in'), p.inAt ? when(p.inAt) : null],
    [
      w('Time outside'),
      outsideMin !== null
        ? `${outsideMin >= 60 ? `${String(Math.floor(outsideMin / 60))} h ${String(outsideMin % 60)} min` : `${String(outsideMin)} min`}${late ? ` · ${w('back after the allowed time')}` : ''}`
        : null,
    ],
    [w('Gate note'), p.gateNote],
    [w('Note'), p.decisionNote ?? p.cancelReason],
  ];
  const parties = (['student', 'father', 'mother', 'guardian', 'collector'] as const).filter(
    (k) => p.photos[k],
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker={`${w('Gate pass')} ${p.number}`}
        title={p.student ?? p.employee ?? w('Gate pass')}
        description={p.kindLabel}
        actions={
          <span
            style={{
              display: 'inline-flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <Badge tone={TONE[p.state]}>{w(p.stage)}</Badge>
            {p.passNo ? (
              <FileLinks
                url={`/api/gate-passes/${p.id}/card`}
                saveUrl={`/api/gate-passes/${p.id}/card?save=1`}
                label={`${w('Pass card')} ${p.number}`}
              />
            ) : null}
          </span>
        }
      />
      <nav
        aria-label={w('Gate passes')}
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/gate-passes">
          {w('To approve')}
        </a>
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/gate-passes#mine">
          {w('My gate passes')}
        </a>
      </nav>
      {p.canDecide ? (
        <Card title={w('Your approval')} style={{ marginBottom: 'var(--sp-4)' }}>
          <form style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <input type="hidden" name="id" value={p.id} />
            <label className="ep-field" htmlFor="gp-note">
              <span className="ep-field__label">{w('Note (needed to reject)')}</span>
              <input id="gp-note" name="note" className="ep-input" maxLength={300} />
            </label>
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <Button type="submit" formAction={approveGatePass}>
                {w('Approve')}
              </Button>
              <Button type="submit" formAction={rejectGatePass} variant="secondary">
                {w('Reject')}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {student ? (
        <Card title={w('Photos to compare')} style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-pass-photos">
            {parties.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                {w('No photo is on the school’s record for this pupil or the parents.')}
              </p>
            ) : null}
            {parties.map((k) => (
              <figure key={k} className="ep-pass-photos__one" data-party={k}>
                <img
                  src={`/api/gate-passes/${p.id}/photo/${k}`}
                  alt={`${w(PARTY[k]!)} · ${p.number}`}
                />
                <figcaption>{w(PARTY[k]!)}</figcaption>
              </figure>
            ))}
          </div>
          {p.guardians.length ? (
            <p className="ep-field__help">
              {w('On record:')}{' '}
              {p.guardians
                .map(
                  (g) =>
                    `${g.name} (${g.relation}${g.mobileEnd ? `, ${w('mobile ending')} ${g.mobileEnd}` : ''})`,
                )
                .join(' · ')}
            </p>
          ) : null}
        </Card>
      ) : null}
      {p.state === 'approved' &&
      student &&
      (p.kind === 'early_leave' || p.kind === 'hostel_home') ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {p.kind === 'hostel_home'
            ? w(
                p.otpNeeded
                  ? 'Approved. The hostel warden hands the child over (photo and the parent’s code); the gate can let the child out only after that.'
                  : 'Approved. The hostel warden hands the child over (photo); the gate can let the child out only after that.',
              )
            : w(
                p.otpNeeded
                  ? 'Approved. The front desk hands the child over (photo and the parent’s code); the gate can let the child out only after that.'
                  : 'Approved. The front desk hands the child over (photo); the gate can let the child out only after that.',
              )}
        </div>
      ) : null}
      <Card title={w('Details')} style={{ marginBottom: 'var(--sp-4)' }}>
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
        <Card title={w('Items carried out')} style={{ marginBottom: 'var(--sp-4)' }}>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label={w('Items carried out')}
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">
                {w('Items carried out')} · {p.number}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{w('Item')}</th>
                  <th scope="col">{w('Serial / asset no.')}</th>
                  <th scope="col">{w('Quantity')}</th>
                  <th scope="col">{w('To come back')}</th>
                  <th scope="col">{w('Came back')}</th>
                </tr>
              </thead>
              <tbody>
                {p.itemList.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.serialNo ?? '—'}</td>
                    <td>{i.qty}</td>
                    <td>{i.returnable ? w('Yes') : w('No')}</td>
                    <td>
                      {i.returnable
                        ? `${String(i.returnedQty)} / ${String(i.qty)}${i.returnedAt ? ` · ${when(i.returnedAt)}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title={w('Approval')}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {p.approvalMode === 'any'
            ? `${w('Any')} ${String(p.approvalNeed)} ${w('of these approve')}${p.approvals.some((a) => a.mandatory) ? `, ${w('and every level marked “must approve”')}` : ''}.`
            : w('One after another, in this order.')}
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={w('Approval levels')}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">
              {w('Approval levels')} · {p.number}
            </caption>
            <thead>
              <tr>
                <th scope="col">{w('Level')}</th>
                <th scope="col">{w('Who')}</th>
                <th scope="col">{w('Status')}</th>
                <th scope="col">{w('Decided by')}</th>
                <th scope="col">{w('Note')}</th>
              </tr>
            </thead>
            <tbody>
              {p.approvals.map((a) => (
                <tr key={a.seq}>
                  <td>
                    {a.seq}. {a.label}
                    {a.mandatory ? <div className="ep-field__help">{w('Must approve')}</div> : null}
                  </td>
                  <td>{a.approvers ?? '—'}</td>
                  <td>
                    <Badge tone={LEVEL[a.status][1]}>{w(LEVEL[a.status][0])}</Badge>
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
    </main>
  );
}
