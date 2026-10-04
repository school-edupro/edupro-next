import { Alert, Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  approveAppointment,
  cancelAppointment,
  checkInAppointment,
  checkOutAppointment,
  noShowAppointment,
  rejectAppointment,
  rescheduleAppointment,
} from '@/lib/appointment-actions';
import {
  SOURCE_LABEL,
  STATE_LABEL,
  STATE_TONE,
  dayOf,
  hoursLine,
  today,
  when,
  whoOf,
  type AppointmentDetail,
  type BookableHost,
  type SlotList,
  studentLabel,
} from '@/lib/appointments';

const EVENT: Record<string, string> = {
  requested: 'Requested',
  approved: 'Confirmed',
  rejected: 'Declined',
  rescheduled: 'Moved to a new time',
  cancelled: 'Cancelled',
  checked_in: 'Arrived (checked in)',
  checked_out: 'Left (checked out)',
  no_show: 'Did not come',
  reminded: 'Reminder sent',
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One appointment: who is coming, to whom and when; the front-desk decisions; the pass; the history. */
export default async function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    rhost?: string;
    rdate?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [me, a, hosts] = await Promise.all([
    getMe(),
    apiFetch<AppointmentDetail>(`/appointments/${id}`),
    apiFetch<{ data: BookableHost[] }>('/appointments/hosts'),
  ]);
  const movable = a.you.canDecide && ['requested', 'approved'].includes(a.state);
  const rhost = hosts.data.find((h) => h.id === (sp.rhost ?? a.hostId)) ?? null;
  const rdate = DATE.test(sp.rdate ?? '') ? sp.rdate! : '';
  const slots =
    movable && rhost && rdate
      ? await apiFetch<SlotList>(
          `/appointments/slots?${new URLSearchParams({
            hostId: rhost.id,
            date: rdate,
            except: a.id,
            ...(a.studentId ? { studentId: a.studentId } : {}),
          }).toString()}`,
        )
      : null;
  const here = `/engagement/appointments/${a.id}`;
  const hidden = (
    <>
      <input type="hidden" name="id" value={a.id} />
      <input type="hidden" name="returnTo" value={here} />
    </>
  );
  const facts: Array<[string, React.ReactNode]> = [
    ['Visitor', a.visitorName ?? '—'],
    ...(a.student
      ? ([['Student', studentLabel(a) ?? '']] as Array<[string, React.ReactNode]>)
      : []),
    ['Mobile', a.visitorMobile ?? '—'],
    ...(a.visitorEmail ? ([['Email', a.visitorEmail]] as Array<[string, React.ReactNode]>) : []),
    ...(a.visitorOrg ? ([['Coming from', a.visitorOrg]] as Array<[string, React.ReactNode]>) : []),
    ['People', String(a.partySize)],
    ...(a.idProofKind
      ? ([
          ['ID proof', `${a.idProofKind}${a.idProofLast4 ? ` ending ${a.idProofLast4}` : ''}`],
        ] as Array<[string, React.ReactNode]>)
      : []),
    ['Booked', `${SOURCE_LABEL[a.source]} · ${when(a.createdAt)}`],
    ...(a.decidedBy || a.decidedAt
      ? ([['Decided', [a.decidedBy, when(a.decidedAt)].filter(Boolean).join(' · ')]] as Array<
          [string, React.ReactNode]
        >)
      : []),
    ...(a.checkedInAt
      ? ([['Arrived', when(a.checkedInAt)]] as Array<[string, React.ReactNode]>)
      : []),
    ...(a.checkedOutAt
      ? ([['Left', when(a.checkedOutAt)]] as Array<[string, React.ReactNode]>)
      : []),
  ];
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Appointments', href: '/engagement/appointments' }, { label: a.number }]}
      />
      <PageHeader
        kicker={`Appointment ${a.number}`}
        title={whoOf(a)}
        description={`${a.hostName ?? 'No one chosen yet'}${a.withName ? ` · ${a.withName}` : ''} · ${a.startsAt ? when(a.startsAt) : 'no slot yet'}${a.place ? ` · ${a.place}` : ''}`}
        actions={<Badge tone={STATE_TONE[a.state]}>{STATE_LABEL[a.state]}</Badge>}
      />
      <AppointmentNav current="" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <div className="ep-hd__layout">
        <div>
          <Card title="Purpose">
            <p style={{ marginTop: 0 }}>{a.purpose}</p>
            {!a.startsAt && a.preferredSlots.length ? (
              <p className="ep-field__help">
                Asked for: {a.preferredSlots.map((x) => x.replace('T', ' ')).join(', ')}. Give it a
                slot below.
              </p>
            ) : null}
            {a.previousStartsAt ? (
              <p className="ep-field__help">
                Moved from {when(a.previousStartsAt)}
                {a.rescheduleCount > 1 ? ` (${String(a.rescheduleCount)} moves)` : ''}.
              </p>
            ) : null}
            {a.decisionNote || a.cancelReason ? (
              <p className="ep-field__help">Note: {a.decisionNote ?? a.cancelReason}</p>
            ) : null}
          </Card>
          {a.you.canDecide && a.state === 'requested' && a.startsAt ? (
            <Card title="Confirm or decline" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={approveAppointment} className="ep-hd__form">
                {hidden}
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor="ap-loc">
                    <span className="ep-field__label">Where (optional)</span>
                    <input
                      id="ap-loc"
                      name="location"
                      className="ep-input"
                      maxLength={120}
                      defaultValue={a.place ?? ''}
                    />
                  </label>
                  <label className="ep-field" htmlFor="ap-note">
                    <span className="ep-field__label">Note for the visitor (optional)</span>
                    <input id="ap-note" name="note" className="ep-input" maxLength={300} />
                  </label>
                  <div>
                    <Button type="submit">Confirm {when(a.startsAt)}</Button>
                  </div>
                </div>
              </form>
              <form
                action={rejectAppointment}
                className="ep-hd__form"
                style={{ marginTop: 'var(--sp-4)' }}
              >
                {hidden}
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor="ap-reason">
                    <span className="ep-field__label">
                      Reason for declining (the visitor sees it)
                    </span>
                    <input
                      id="ap-reason"
                      name="reason"
                      className="ep-input"
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </label>
                  <div>
                    <Button type="submit" variant="danger">
                      Decline
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          ) : null}
          {a.state === 'approved' && a.you.canCheckIn ? (
            <Card title="At the gate" style={{ marginTop: 'var(--sp-4)' }}>
              <div className="ep-hd__row">
                <form action={checkInAppointment} className="ep-hd__row">
                  {hidden}
                  <label className="ep-field" htmlFor="ap-badge">
                    <span className="ep-field__label">Visitor badge no. (optional)</span>
                    <input id="ap-badge" name="badgeNo" className="ep-input" maxLength={20} />
                  </label>
                  <div>
                    <Button type="submit">Check in</Button>
                  </div>
                </form>
                <form action={noShowAppointment}>
                  {hidden}
                  <Button type="submit" variant="ghost">
                    Did not come
                  </Button>
                </form>
              </div>
              {a.startsAt && dayOf(a.startsAt) !== today() ? (
                <p className="ep-field__help">
                  This visit is for {when(a.startsAt)}. A visitor is checked in only on the day of
                  the appointment; give a new time below if they have come on another day.
                </p>
              ) : null}
            </Card>
          ) : null}
          {a.state === 'checked_in' && a.you.canCheckIn ? (
            <Card title="At the gate" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={checkOutAppointment}>
                {hidden}
                <Button type="submit">Check out</Button>
              </form>
            </Card>
          ) : null}
          {movable ? (
            <Card
              title={a.startsAt ? 'Give a new time' : 'Give a slot'}
              style={{ marginTop: 'var(--sp-4)' }}
            >
              <form method="get" className="ep-hd__row">
                <SelectField
                  id="rs-host"
                  name="rhost"
                  label="To meet"
                  defaultValue={rhost?.id ?? ''}
                  options={hosts.data.map((h) => ({
                    value: h.id,
                    label: `${h.name}${h.person ? ` · ${h.person}` : ''}`,
                  }))}
                />
                <label className="ep-field" htmlFor="rs-date">
                  <span className="ep-field__label">Day</span>
                  <input
                    id="rs-date"
                    name="rdate"
                    type="date"
                    className="ep-input"
                    required
                    min={today()}
                    defaultValue={rdate}
                  />
                </label>
                <div>
                  <Button type="submit" variant="secondary">
                    Show slots
                  </Button>
                </div>
              </form>
              {rhost ? (
                <p className="ep-field__help">Visiting hours: {hoursLine(rhost.hours)}</p>
              ) : null}
              {slots?.closed ? <Alert tone="warning">{slots.closed}</Alert> : null}
              {slots && !slots.closed ? (
                slots.slots.some((x) => x.available) ? (
                  <form action={rescheduleAppointment} className="ep-hd__form">
                    {hidden}
                    <input type="hidden" name="hostId" value={rhost!.id} />
                    <fieldset className="ep-slots">
                      <legend className="ep-field__label">Free slots on {rdate}</legend>
                      <div className="ep-slots__grid">
                        {slots.slots.map((x) => (
                          <label
                            key={x.time}
                            className="ep-slots__slot"
                            data-off={x.available ? undefined : ''}
                          >
                            <input
                              type="radio"
                              name="startsAt"
                              value={x.startsAt}
                              disabled={!x.available}
                              required
                            />
                            <span>{x.time}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <div className="ep-hd__row">
                      <label className="ep-field" htmlFor="rs-reason">
                        <span className="ep-field__label">Reason (the visitor sees it)</span>
                        <input id="rs-reason" name="reason" className="ep-input" maxLength={300} />
                      </label>
                      <div>
                        <Button type="submit">Move and confirm</Button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <Alert tone="warning">No free slot on this day; try another day.</Alert>
                )
              ) : null}
            </Card>
          ) : null}
          {movable ? (
            <Card title="Cancel" style={{ marginTop: 'var(--sp-4)' }}>
              <form action={cancelAppointment} className="ep-hd__row">
                {hidden}
                <label className="ep-field" htmlFor="ap-cancel">
                  <span className="ep-field__label">Reason (the visitor sees it)</span>
                  <input id="ap-cancel" name="reason" className="ep-input" maxLength={300} />
                </label>
                <div>
                  <Button type="submit" variant="ghost">
                    Cancel the appointment
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}
          <Card title="History" style={{ marginTop: 'var(--sp-4)' }}>
            <ul className="ep-hd__timeline">
              {a.events.map((e, i) => (
                <li key={i}>
                  <span>
                    {EVENT[e.kind] ?? e.kind}
                    {typeof e.detail.startsAt === 'string'
                      ? ` · ${e.detail.startsAt.replace('T', ' ')}`
                      : ''}
                    {typeof e.detail.reason === 'string' && e.detail.reason
                      ? ` · ${e.detail.reason}`
                      : ''}
                  </span>
                  <span className="ep-field__help">
                    {[e.actor, when(e.at)].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <aside className="ep-hd__side">
          <Card title="Details">
            {a.hasPhoto ? (
              <img
                className="ep-appt__photo"
                src={`/api/appointments/${a.id}/photo`}
                alt={`Photo of ${a.visitorName ?? 'the visitor'}`}
              />
            ) : null}
            <dl className="ep-hd__facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {a.passQr && ['approved', 'checked_in'].includes(a.state) ? (
            <Card title="Gate pass" style={{ marginTop: 'var(--sp-4)' }}>
              <img
                className="ep-appt__qr"
                src={`data:image/svg+xml;utf8,${encodeURIComponent(a.passQr)}`}
                alt={`QR code of pass ${a.passCode ?? ''}`}
              />
              <p className="ep-field__help">
                Pass code <strong>{a.passCode}</strong>. The visitor has this pass in the
                confirmation message.
              </p>
              {a.you.canCheckIn ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/engagement/appointments/${a.id}/card`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Print the visitor card
                </a>
              ) : null}
              {a.you.canCheckIn ? (
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={`/api/appointments/${a.id}/card`}
                >
                  Download the card (PDF)
                </a>
              ) : null}
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
