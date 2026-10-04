import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelAppointment } from './actions';
import { DAYS, STATE, dayOf, dayParts, studentLabel, timeOf, type Appointment } from './shared';

interface Viewer {
  students: Array<{ id: string; name: string }>;
}
const PAGE_SIZE = 10;

/**
 * The family's appointments with the school: a list with filters and pages, each one opening its
 * details and pass. Booking is its own page (the button in the header).
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    st?: string;
    child?: string;
    q?: string;
    page?: string;
    view?: string;
    month?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const filters = Object.fromEntries(
    Object.entries({
      state: ['open', 'past'].includes(sp.st ?? '') ? sp.st : undefined,
      studentId: /^\d{1,18}$/.test(sp.child ?? '') ? sp.child : undefined,
      q: sp.q?.trim().slice(0, 80) || undefined,
    }).filter(([, v]) => v),
  ) as Record<string, string>;
  const filtered = Object.keys(filters).length > 0;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageHref = (n: number) =>
    `/appointments?${new URLSearchParams({
      ...(filters.state ? { st: filters.state } : {}),
      ...(filters.studentId ? { child: filters.studentId } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      page: String(n),
    }).toString()}`;
  // the calendar: one month (school time), every appointment of the family whose visit falls in it
  const calendar = sp.view === 'calendar';
  const nowDay = dayOf(new Date().toISOString());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : nowDay.slice(0, 7);
  const [my, mm] = month.split('-').map(Number) as [number, number];
  const monthDays = new Date(Date.UTC(my, mm, 0)).getUTCDate();
  const monthOf = (n: number) => new Date(Date.UTC(my, mm - 1 + n, 1)).toISOString().slice(0, 7);
  // Monday first: how many blank cells before the 1st
  const lead = (new Date(Date.UTC(my, mm - 1, 1)).getUTCDay() + 6) % 7;
  const monthLabel = new Date(Date.UTC(my, mm - 1, 1)).toLocaleDateString(
    lang === 'hi' ? 'hi-IN' : 'en-IN',
    { timeZone: 'UTC', month: 'long', year: 'numeric' },
  );
  const query: Record<string, string> = calendar
    ? { from: `${month}-01`, to: `${month}-${String(monthDays).padStart(2, '0')}`, size: '100' }
    : { ...filters, size: String(PAGE_SIZE), page: String(page) };
  let appointments: Appointment[];
  let total: number;
  let viewer: Viewer;
  try {
    const [mine, v] = await Promise.all([
      bff.api.fetch<{ data: Appointment[]; page: { total: number } }>(
        `/appointments/mine?${new URLSearchParams(query).toString()}`,
      ),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
    appointments = mine.data;
    total = mine.page.total;
    viewer = v;
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
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Appointments')}
        title={t(lang, 'Meet the school')}
        description={
          calendar
            ? `${monthLabel} · ${String(total)}`
            : `${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
              href="/appointments"
              aria-current={calendar ? undefined : 'page'}
            >
              {t(lang, 'List')}
            </a>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
              href="/appointments?view=calendar"
              aria-current={calendar ? 'page' : undefined}
            >
              {t(lang, 'Calendar')}
            </a>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/appointments/new">
              {t(lang, 'Book an appointment')}
            </a>
          </span>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Appointment cancelled.')}
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
      {calendar ? (
        <Card style={{ marginBottom: 'var(--sp-3)' }}>
          <nav
            aria-label={t(lang, 'Month')}
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/appointments?view=calendar&month=${monthOf(-1)}`}
            >
              ← {t(lang, 'Earlier')}
            </a>
            <strong>{monthLabel}</strong>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/appointments?view=calendar&month=${monthOf(1)}`}
            >
              {t(lang, 'Later')} →
            </a>
          </nav>
          <div className="ep-month">
            {DAYS.map((d) => (
              <div key={d} className="ep-month__wd" aria-hidden="true">
                {t(lang, d)}
              </div>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`b${String(i)}`} className="ep-month__cell ep-month__cell--out" />
            ))}
            {Array.from({ length: monthDays }, (_, i) => {
              const d = `${month}-${String(i + 1).padStart(2, '0')}`;
              const rows = appointments.filter((a) => a.startsAt && dayOf(a.startsAt) === d);
              return (
                <div
                  key={d}
                  className={
                    d === nowDay ? 'ep-month__cell ep-month__cell--today' : 'ep-month__cell'
                  }
                >
                  <span className="ep-month__num">{i + 1}</span>
                  {rows.map((a) => (
                    <a
                      key={a.id}
                      className="ep-month__item"
                      data-state={a.state}
                      href={`/appointments/${a.id}`}
                      aria-label={`${timeOf(a.startsAt!)} ${a.withName ?? a.hostName ?? ''} ${a.number} ${t(lang, STATE[a.state][0])}`}
                    >
                      {timeOf(a.startsAt!)}
                    </a>
                  ))}
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-3)' }}>
          <form
            method="get"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--sp-2)',
              alignItems: 'flex-end',
            }}
          >
            <SelectField
              id="f-st"
              name="st"
              label={t(lang, 'Status')}
              defaultValue={filters.state ?? ''}
              options={[
                { value: '', label: t(lang, 'All') },
                { value: 'open', label: t(lang, 'Still to come') },
                { value: 'past', label: t(lang, 'Over or closed') },
              ]}
            />
            {viewer.students.length > 1 ? (
              <SelectField
                id="f-child"
                name="child"
                label={t(lang, 'Child')}
                defaultValue={filters.studentId ?? ''}
                options={[
                  { value: '', label: t(lang, 'All') },
                  ...viewer.students.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            ) : null}
            <InputField
              id="f-q"
              name="q"
              type="search"
              label={t(lang, 'Number, purpose or whom to meet')}
              defaultValue={filters.q ?? ''}
              maxLength={80}
            />
            <Button type="submit" variant="secondary">
              {t(lang, 'Show')}
            </Button>
            {filtered ? (
              <a className="ep-btn ep-btn--ghost" href="/appointments">
                {t(lang, 'Clear')}
              </a>
            ) : null}
          </form>
        </Card>
      )}
      {appointments.length === 0 ? (
        <Card>
          {calendar
            ? t(lang, 'No appointments in this month.')
            : filtered
              ? t(lang, 'Nothing matches these filters.')
              : t(
                  lang,
                  'No appointments yet. Use Book an appointment to meet a teacher or the office.',
                )}
        </Card>
      ) : null}
      {appointments.map((a) => {
        const d = a.startsAt ? dayParts(a.startsAt) : null;
        return (
          <Card key={a.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date" aria-hidden={d ? undefined : 'true'}>
                {d ? (
                  <>
                    <span className="ep-apt__day">{d.day}</span>
                    <span className="ep-apt__month">{d.month}</span>
                    <span className="ep-apt__time">{timeOf(a.startsAt!)}</span>
                  </>
                ) : (
                  <span className="ep-apt__month">—</span>
                )}
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/appointments/${a.id}`}>
                    {a.withName ?? a.hostName ?? t(lang, 'Appointment')}
                  </a>
                  <Badge tone={STATE[a.state][1]}>{t(lang, STATE[a.state][0])}</Badge>
                </div>
                <div>{a.purpose}</div>
                <div className="ep-kicker">
                  {[
                    a.number,
                    studentLabel(a, t(lang, 'Adm. no.')),
                    a.withName ? a.hostName : null,
                    a.place,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/appointments/${a.id}`}
                    aria-label={`${t(lang, ['approved', 'checked_in'].includes(a.state) ? 'Details and gate pass' : 'Details')} ${a.number}`}
                  >
                    {t(
                      lang,
                      ['approved', 'checked_in'].includes(a.state)
                        ? 'Details and gate pass'
                        : 'Details',
                    )}
                  </a>
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
              </div>
            </div>
          </Card>
        );
      })}
      {!calendar && total > PAGE_SIZE ? (
        <nav
          aria-label={t(lang, 'Pages')}
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageHref(page - 1)}>
              ← {t(lang, 'Previous')}
            </a>
          ) : null}
          <span className="ep-field__help">
            {t(lang, 'Page')} {page} / {Math.ceil(total / PAGE_SIZE)}
          </span>
          {page * PAGE_SIZE < total ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageHref(page + 1)}>
              {t(lang, 'Next')} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </main>
  );
}
