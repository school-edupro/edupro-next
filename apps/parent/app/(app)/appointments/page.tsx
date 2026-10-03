import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelAppointment } from './actions';
import { STATE, dayParts, timeOf, type Appointment } from './shared';

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
  let appointments: Appointment[];
  let total: number;
  let viewer: Viewer;
  try {
    const [mine, v] = await Promise.all([
      bff.api.fetch<{ data: Appointment[]; page: { total: number } }>(
        `/appointments/mine?${new URLSearchParams({ ...filters, size: String(PAGE_SIZE), page: String(page) }).toString()}`,
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
        description={`${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`}
        actions={
          <a className="ep-btn ep-btn--primary ep-btn--sm" href="/appointments/new">
            {t(lang, 'Book an appointment')}
          </a>
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
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
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
      {appointments.length === 0 ? (
        <Card>
          {filtered
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
                  {[a.number, a.student, a.withName ? a.hostName : null, a.place]
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
      {total > PAGE_SIZE ? (
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
