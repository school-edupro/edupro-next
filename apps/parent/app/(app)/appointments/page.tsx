import { Badge, Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelAppointment, requestAppointment, requestGatePass } from './actions';

type State =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
interface Appointment {
  id: string;
  number: string;
  state: State;
  student: string | null;
  hostName: string | null;
  withName: string | null;
  purpose: string;
  startsAt: string | null;
  place: string | null;
  decisionNote: string | null;
  cancelReason: string | null;
  passLink: string | null;
}
interface Host {
  id: string;
  name: string;
  kind: string;
  person: string | null;
  location: string | null;
  hours: Array<{ weekday: number; starts: string; ends: string }>;
}
interface Slots {
  closed: string | null;
  slots: Array<{ time: string; startsAt: string; available: boolean }>;
}
const STATE: Record<State, [string, 'warning' | 'success' | 'danger' | 'info' | 'neutral']> = {
  requested: ['Waiting for the school', 'warning'],
  approved: ['Confirmed', 'success'],
  rejected: ['Not confirmed', 'danger'],
  cancelled: ['Cancelled', 'neutral'],
  checked_in: ['Arrived', 'info'],
  completed: ['Completed', 'neutral'],
  no_show: ['Did not come', 'danger'],
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** The school day (India) of now, as YYYY-MM-DD. */
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
interface GatePass {
  id: string;
  student: string;
  kind: string;
  onDate: string;
  atTime: string | null;
  reason: string;
  passNo: string | null;
  status: string;
  escortName: string | null;
}
interface Viewer {
  students: Array<{ id: string; name: string }>;
}
const tone = (s: string) => (s === 'approved' ? 'success' : s === 'pending' ? 'warning' : 'danger');

/**
 * Appointments with the school (0059): pick the child, whom to meet and the day, then a free slot; the
 * school confirms and the pass arrives. Also here: gate passes requested by the family (Sprint 19).
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    student?: string;
    host?: string;
    date?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let appointments: Appointment[];
  let passes: GatePass[];
  let viewer: Viewer;
  let hosts: Host[];
  let maxDaysAhead: number;
  let instructions: string | null;
  try {
    const [mine, gate, v, h] = await Promise.all([
      bff.api.fetch<{ data: Appointment[] }>('/appointments/mine'),
      bff.api.fetch<{ data: GatePass[] }>('/engagement/mine/gate-passes'),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
      bff.api.fetch<{ data: Host[]; maxDaysAhead: number; instructions: string | null }>(
        '/appointments/mine/hosts',
      ),
    ]);
    appointments = mine.data;
    passes = gate.data;
    viewer = v;
    hosts = h.data;
    maxDaysAhead = h.maxDaysAhead;
    instructions = h.instructions;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Appointments')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  const students = viewer.students.map((s) => ({ value: s.id, label: s.name }));
  const student = viewer.students.find((s) => s.id === sp.student) ?? viewer.students[0] ?? null;
  const host = hosts.find((x) => x.id === sp.host) ?? null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? sp.date! : '';
  const slots =
    student && host && date
      ? await bff.api
          .fetch<Slots>(
            `/appointments/mine/slots?${new URLSearchParams({ hostId: host.id, date, studentId: student.id }).toString()}`,
          )
          .catch(() => null)
      : null;
  /** Visiting hours on one line, the days with the same hours together: Mon–Fri 14:00–15:00. */
  const hoursOf = (x: Host) => {
    const byTime = new Map<string, number[]>();
    for (const o of x.hours)
      byTime.set(`${o.starts}–${o.ends}`, [
        ...(byTime.get(`${o.starts}–${o.ends}`) ?? []),
        o.weekday,
      ]);
    return (
      [...byTime.entries()]
        .map(([time, list]) => {
          const d = [...new Set(list)].sort((a, b) => a - b);
          const run = d.length > 2 && d.every((v, n) => n === 0 || v === d[n - 1]! + 1);
          return `${run ? `${DAYS[d[0]! - 1]!}–${DAYS[d[d.length - 1]! - 1]!}` : d.map((v) => DAYS[v - 1]).join(', ')} ${time}`;
        })
        .join(' · ') || t(lang, 'No visiting hours')
    );
  };
  const last = new Date(Date.parse(`${today()}T00:00:00Z`) + maxDaysAhead * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Appointments')}
        description={t(
          lang,
          'Book a time to meet the class teacher or the school office, or request a gate pass.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'pass'
            ? t(lang, 'Gate pass requested. The school will confirm on WhatsApp.')
            : sp.ok === 'cancelled'
              ? t(lang, 'Appointment cancelled.')
              : t(lang, 'Appointment requested. The school will confirm it and send you the pass.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card title={t(lang, 'Request an appointment')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form method="get">
          <FormRow columns={2}>
            <SelectField
              id="student"
              name="student"
              label={t(lang, 'Child')}
              defaultValue={student?.id ?? ''}
              options={students}
            />
            <SelectField
              id="host"
              name="host"
              label={t(lang, 'To meet')}
              defaultValue={host?.id ?? ''}
              options={[
                { value: '', label: t(lang, 'Choose') },
                ...hosts.map((x) => ({
                  value: x.id,
                  label: `${x.name}${x.person ? ` · ${x.person}` : ''}`,
                })),
              ]}
            />
            <InputField
              id="date"
              name="date"
              label={t(lang, 'Day')}
              type="date"
              required
              min={today()}
              max={last}
              defaultValue={date}
            />
          </FormRow>
          <Button type="submit" variant="secondary">
            {t(lang, 'Show free times')}
          </Button>
        </form>
        {host ? (
          <p className="ep-field__help">
            {t(lang, 'Visiting hours')}: {hoursOf(host)}
            {host.location ? ` · ${host.location}` : ''}
          </p>
        ) : null}
        {instructions ? <p className="ep-field__help">{instructions}</p> : null}
        {slots?.closed ? (
          <div className="ep-alert ep-alert--warning" role="status">
            {slots.closed}
          </div>
        ) : null}
        {slots && !slots.closed && student && host ? (
          slots.slots.some((x) => x.available) ? (
            <form action={requestAppointment} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="hostId" value={host.id} />
              <input type="hidden" name="date" value={date} />
              <fieldset className="ep-slots">
                <legend className="ep-field__label">
                  {t(lang, 'Free times on')} {date}
                </legend>
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
              <InputField
                id="purpose"
                name="purpose"
                label={t(lang, 'Purpose')}
                required
                minLength={3}
                maxLength={500}
              />
              <Button type="submit">{t(lang, 'Request')}</Button>
            </form>
          ) : (
            <div className="ep-alert ep-alert--warning" role="status">
              {t(lang, 'No free time on this day. Please try another day.')}
            </div>
          )
        ) : null}
      </Card>
      <Card title={t(lang, 'Your appointments')} style={{ marginBottom: 'var(--sp-3)' }}>
        {appointments.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No appointments yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {appointments.map((a) => (
              <li
                key={a.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {[a.student, a.withName ?? a.hostName].filter(Boolean).join(' · ')}
                  </strong>
                  <Badge tone={STATE[a.state][1]}>{t(lang, STATE[a.state][0])}</Badge>
                </div>
                <div>{a.purpose}</div>
                <div className="ep-kicker">
                  {a.number}
                  {a.startsAt ? ` · ${when(a.startsAt)}` : ''}
                  {a.place ? ` · ${a.place}` : ''}
                  {a.decisionNote || a.cancelReason
                    ? ` · ${a.decisionNote ?? a.cancelReason ?? ''}`
                    : ''}
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
                  {a.passLink ? (
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={a.passLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t(lang, 'Gate pass')}
                    </a>
                  ) : null}
                  {['requested', 'approved'].includes(a.state) ? (
                    <form action={cancelAppointment}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t(lang, 'Cancel')} ${a.number}`}
                      >
                        {t(lang, 'Cancel')}
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t(lang, 'Request a gate pass')} style={{ marginBottom: 'var(--sp-3)' }}>
        <form action={requestGatePass}>
          <FormRow columns={2}>
            <SelectField
              id="gp-studentId"
              name="studentId"
              label={t(lang, 'Child')}
              options={students}
            />
            <SelectField
              id="kind"
              name="kind"
              label={t(lang, 'Kind')}
              options={[
                { value: 'early_leave', label: t(lang, 'Early leave') },
                { value: 'late_arrival', label: t(lang, 'Late arrival') },
              ]}
            />
            <InputField id="onDate" name="onDate" label={t(lang, 'Date')} type="date" />
            <InputField id="atTime" name="atTime" label={t(lang, 'Time')} type="time" />
            <InputField
              id="reason"
              name="reason"
              label={t(lang, 'Reason')}
              required
              minLength={3}
              maxLength={300}
            />
            <InputField
              id="escortName"
              name="escortName"
              label={t(lang, 'Who will pick up')}
              maxLength={120}
            />
            <InputField
              id="escortRelation"
              name="escortRelation"
              label={t(lang, 'Relation')}
              maxLength={40}
            />
            <InputField
              id="escortMobile"
              name="escortMobile"
              label={t(lang, 'Mobile')}
              pattern="\\d{10}"
            />
          </FormRow>
          <Button type="submit" variant="secondary">
            {t(lang, 'Request gate pass')}
          </Button>
        </form>
      </Card>
      <Card title={t(lang, 'Your gate passes')}>
        {passes.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No gate passes yet.')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {passes.map((p) => (
              <li
                key={p.id}
                style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                >
                  <strong>
                    {p.passNo ? `${p.passNo} · ` : ''}
                    {p.student}
                  </strong>
                  <Badge tone={tone(p.status)}>{p.status}</Badge>
                </div>
                <div className="ep-kicker">
                  {p.kind === 'early_leave' ? t(lang, 'Early leave') : t(lang, 'Late arrival')} ·{' '}
                  {p.onDate}
                  {p.atTime ? ` ${p.atTime}` : ''} · {p.reason}
                  {p.escortName ? ` · ${p.escortName}` : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
