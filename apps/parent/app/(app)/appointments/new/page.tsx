import { Button, Card, InputField, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { requestAppointment } from '../actions';
import { dateLabel, hoursLine } from '../shared';

interface Viewer {
  students: Array<{ id: string; name: string; section: string | null }>;
}
interface Host {
  id: string;
  name: string;
  kind: string;
  person: string | null;
  location: string | null;
  hours: Array<{ weekday: number; starts: string; ends: string }>;
}
interface Days {
  data: Array<{ date: string; free: number }>;
  note: string | null;
}
interface Slots {
  closed: string | null;
  slots: Array<{ time: string; startsAt: string; available: boolean }>;
}

/**
 * Book an appointment, one step at a time: the child, whom to meet, a day that is open (with how many
 * times are free), a time, then the purpose with a summary before it is sent. Each choice is a tap; a
 * step already answered shows its answer with Change.
 */
export default async function BookAppointmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    student?: string;
    host?: string;
    date?: string;
    time?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let viewer: Viewer;
  let hosts: Host[];
  let instructions: string | null;
  try {
    const [v, h] = await Promise.all([
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
      bff.api.fetch<{ data: Host[]; instructions: string | null }>('/appointments/mine/hosts'),
    ]);
    viewer = v;
    hosts = h.data;
    instructions = h.instructions;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/appointments');
    throw error;
  }
  const only = viewer.students.length === 1 ? viewer.students[0]! : null;
  // the child chosen in the portal's sibling switch is the starting point
  const chosen = await chosenChild(sp.student);
  const student = viewer.students.find((s) => s.id === chosen?.id) ?? only;
  const host = student ? (hosts.find((x) => x.id === sp.host) ?? null) : null;
  const days =
    student && host
      ? await bff.api
          .fetch<Days>(
            `/appointments/mine/days?${new URLSearchParams({ hostId: host.id, studentId: student.id }).toString()}`,
          )
          .catch(() => ({
            data: [],
            note: t(lang, 'The days could not be loaded. Please try again.'),
          }))
      : null;
  const date = days?.data.some((d) => d.date === sp.date) ? sp.date! : '';
  const slots =
    student && host && date
      ? await bff.api
          .fetch<Slots>(
            `/appointments/mine/slots?${new URLSearchParams({ hostId: host.id, date, studentId: student.id }).toString()}`,
          )
          .catch(() => null)
      : null;
  const slot = slots?.slots.find((x) => x.time === sp.time && x.available) ?? null;
  /** This page with the answers so far, up to and including the given step. */
  const at = (upTo: 'none' | 'student' | 'host' | 'date', extra: Record<string, string> = {}) => {
    const keep: Record<string, string> = {};
    if (upTo !== 'none' && student) keep.student = student.id;
    if ((upTo === 'host' || upTo === 'date') && host) keep.host = host.id;
    if (upTo === 'date' && date) keep.date = date;
    return `/appointments/new?${new URLSearchParams({ ...keep, ...extra }).toString()}`;
  };
  const step = !student ? 1 : !host ? 2 : !date ? 3 : !slot ? 4 : 5;
  const done = (n: number, label: string, value: string, change: string) => (
    <div className="ep-step ep-step--done">
      <span className="ep-step__no" aria-hidden="true">
        {n}
      </span>
      <span className="ep-step__label">{label}</span>
      <strong>{value}</strong>
      <a href={change} aria-label={`${t(lang, 'Change')}: ${label}`}>
        {t(lang, 'Change')}
      </a>
    </div>
  );
  const open = (n: number, label: string) => (
    <h2 className="ep-step ep-step--open">
      <span className="ep-step__no" aria-hidden="true">
        {n}
      </span>
      <span className="ep-step__label">{label}</span>
    </h2>
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Appointments')}
        title={t(lang, 'Book an appointment')}
        description={`${t(lang, 'Step')} ${String(step)} / 5`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/appointments">
            {t(lang, 'Back to appointments')}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card>
        {/* 1: the child */}
        {student ? (
          done(
            1,
            t(lang, 'Child'),
            `${student.name}${student.section ? ` (${student.section})` : ''}`,
            only ? '/appointments' : at('none'),
          )
        ) : (
          <>
            {open(1, t(lang, 'Which child is this about?'))}
            <div className="ep-choices">
              {viewer.students.map((s) => (
                <a key={s.id} className="ep-choice" href={at('none', { student: s.id })}>
                  <strong>{s.name}</strong>
                  {s.section ? <span>{s.section}</span> : null}
                </a>
              ))}
            </div>
          </>
        )}
        {/* 2: whom to meet */}
        {student && host
          ? done(
              2,
              t(lang, 'To meet'),
              `${host.name}${host.person ? ` · ${host.person}` : ''}`,
              at('student'),
            )
          : null}
        {student && !host ? (
          <>
            {open(2, t(lang, 'Whom do you want to meet?'))}
            {hosts.length ? (
              <div className="ep-choices">
                {hosts.map((x) => (
                  <a key={x.id} className="ep-choice" href={at('student', { host: x.id })}>
                    <strong>{x.name}</strong>
                    {x.person ? <span>{x.person}</span> : null}
                    <span>{hoursLine(x.hours) || t(lang, 'No visiting hours')}</span>
                    {x.location ? <span>{x.location}</span> : null}
                  </a>
                ))}
              </div>
            ) : (
              <p className="ep-field__help">
                {t(lang, 'The school has not opened appointments for parents yet.')}
              </p>
            )}
          </>
        ) : null}
        {/* 3: the day */}
        {host && date ? done(3, t(lang, 'Day'), dateLabel(date), at('host')) : null}
        {host && !date && days ? (
          <>
            {open(3, t(lang, 'Pick a day'))}
            {days.data.length ? (
              <div className="ep-choices ep-choices--days">
                {days.data.map((d) => (
                  <a key={d.date} className="ep-choice" href={at('host', { date: d.date })}>
                    <strong>{dateLabel(d.date)}</strong>
                    <span>
                      {d.free} {t(lang, d.free === 1 ? 'time free' : 'times free')}
                    </span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="ep-alert ep-alert--warning" role="status">
                {days.note}
              </div>
            )}
          </>
        ) : null}
        {/* 4: the time */}
        {date && slot ? done(4, t(lang, 'Time'), slot.time, at('date')) : null}
        {date && !slot && slots ? (
          <>
            {open(4, t(lang, 'Pick a time'))}
            {slots.slots.some((x) => x.available) ? (
              <div className="ep-choices ep-choices--times">
                {slots.slots
                  .filter((x) => x.available)
                  .map((x) => (
                    <a key={x.time} className="ep-choice" href={at('date', { time: x.time })}>
                      <strong>{x.time}</strong>
                    </a>
                  ))}
              </div>
            ) : (
              <div className="ep-alert ep-alert--warning" role="status">
                {slots.closed ?? t(lang, 'No free time on this day. Please try another day.')}
              </div>
            )}
          </>
        ) : null}
        {/* 5: purpose and send */}
        {student && host && slot ? (
          <>
            {open(5, t(lang, 'Why do you want to meet?'))}
            <form action={requestAppointment} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="studentId" value={student.id} />
              <input type="hidden" name="hostId" value={host.id} />
              <input type="hidden" name="startsAt" value={slot.startsAt} />
              <InputField
                id="purpose"
                name="purpose"
                label={t(lang, 'Purpose')}
                required
                minLength={3}
                maxLength={500}
              />
              <p className="ep-field__help" style={{ margin: 0 }}>
                {student.name} · {host.name}
                {host.person ? ` (${host.person})` : ''} · {dateLabel(date)} · {slot.time}
                {host.location ? ` · ${host.location}` : ''}.{' '}
                {t(lang, 'The school confirms the request and sends you the gate pass.')}
              </p>
              {instructions ? <p className="ep-field__help">{instructions}</p> : null}
              <div>
                <Button type="submit">{t(lang, 'Send the request')}</Button>
              </div>
            </form>
          </>
        ) : null}
      </Card>
    </main>
  );
}
