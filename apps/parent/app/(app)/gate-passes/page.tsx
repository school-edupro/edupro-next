import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { DAYS, dayOf, studentLabel } from '../appointments/shared';
import { cancelGatePass } from './actions';
import { KIND, dateParts, stateOf, type Pass } from './shared';

interface Viewer {
  students: Array<{ id: string; name: string }>;
}
const PAGE_SIZE = 10;

/**
 * The family's gate passes: a list with filters and pages (or a month calendar), each one opening its
 * details, the approval and the pass. Asking for one is its own page (the button in the header).
 */
export default async function GatePassesPage({
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
    `/gate-passes?${new URLSearchParams({
      ...(filters.state ? { st: filters.state } : {}),
      ...(filters.studentId ? { child: filters.studentId } : {}),
      ...(filters.q ? { q: filters.q } : {}),
      page: String(n),
    }).toString()}`;
  // the calendar: one month, every pass of the family dated in it
  const calendar = sp.view === 'calendar';
  const nowDay = dayOf(new Date().toISOString());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : nowDay.slice(0, 7);
  const [my, mm] = month.split('-').map(Number) as [number, number];
  const monthDays = new Date(Date.UTC(my, mm, 0)).getUTCDate();
  const monthOf = (n: number) => new Date(Date.UTC(my, mm - 1 + n, 1)).toISOString().slice(0, 7);
  const lead = (new Date(Date.UTC(my, mm - 1, 1)).getUTCDay() + 6) % 7;
  const monthLabel = new Date(Date.UTC(my, mm - 1, 1)).toLocaleDateString(
    lang === 'hi' ? 'hi-IN' : 'en-IN',
    { timeZone: 'UTC', month: 'long', year: 'numeric' },
  );
  const query: Record<string, string> = calendar
    ? { from: `${month}-01`, to: `${month}-${String(monthDays).padStart(2, '0')}`, size: '100' }
    : { ...filters, size: String(PAGE_SIZE), page: String(page) };
  let passes: Pass[];
  let total: number;
  let viewer: Viewer;
  try {
    const [mine, v] = await Promise.all([
      bff.api.fetch<{ data: Pass[]; page: { total: number } }>(
        `/gate-passes/mine?${new URLSearchParams(query).toString()}`,
      ),
      bff.api.fetch<Viewer>('/academics/daily-work/viewer'),
    ]);
    passes = mine.data;
    total = mine.page.total;
    viewer = v;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Gate passes')} />
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
        kicker={t(lang, 'Gate passes')}
        title={t(lang, 'Early leave and late arrival')}
        description={
          calendar
            ? `${monthLabel} · ${String(total)}`
            : `${String(total)} ${t(lang, filtered ? 'found' : 'in all')} · ${t(lang, 'latest first')}`
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
              href="/gate-passes"
              aria-current={calendar ? undefined : 'page'}
            >
              {t(lang, 'List')}
            </a>
            <a
              className={`ep-btn ep-btn--sm ${calendar ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
              href="/gate-passes?view=calendar"
              aria-current={calendar ? 'page' : undefined}
            >
              {t(lang, 'Calendar')}
            </a>
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/gate-passes/new">
              {t(lang, 'Request a gate pass')}
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
          {t(lang, 'Gate pass cancelled.')}
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
              href={`/gate-passes?view=calendar&month=${monthOf(-1)}`}
            >
              ← {t(lang, 'Earlier')}
            </a>
            <strong>{monthLabel}</strong>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/gate-passes?view=calendar&month=${monthOf(1)}`}
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
              const rows = passes.filter((p) => p.onDate === d);
              return (
                <div
                  key={d}
                  className={
                    d === nowDay ? 'ep-month__cell ep-month__cell--today' : 'ep-month__cell'
                  }
                >
                  <span className="ep-month__num">{i + 1}</span>
                  {rows.map((p) => (
                    <a
                      key={p.id}
                      className="ep-month__item"
                      data-state={
                        p.state === 'pending'
                          ? 'requested'
                          : p.state === 'handed_over'
                            ? 'checked_in'
                            : p.state
                      }
                      href={`/gate-passes/${p.id}`}
                      aria-label={`${p.atTime ?? ''} ${t(lang, KIND[p.kind])} ${p.number} ${t(lang, stateOf(p)[0])}`}
                    >
                      {p.atTime ?? t(lang, 'Pass')}
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
              id="g-st"
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
                id="g-child"
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
              id="g-q"
              name="q"
              type="search"
              label={t(lang, 'Pass number, reason or who collects')}
              defaultValue={filters.q ?? ''}
              maxLength={80}
            />
            <Button type="submit" variant="secondary">
              {t(lang, 'Show')}
            </Button>
            {filtered ? (
              <a className="ep-btn ep-btn--ghost" href="/gate-passes">
                {t(lang, 'Clear')}
              </a>
            ) : null}
          </form>
        </Card>
      )}
      {passes.length === 0 ? (
        <Card>
          {calendar
            ? t(lang, 'No gate passes in this month.')
            : filtered
              ? t(lang, 'Nothing matches these filters.')
              : t(
                  lang,
                  'No gate passes yet. Use Request a gate pass when your child must leave early or will come late.',
                )}
        </Card>
      ) : null}
      {passes.map((p) => {
        const d = dateParts(p.onDate);
        const [label, tone] = stateOf(p);
        return (
          <Card key={p.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
            <div className="ep-apt">
              <div className="ep-apt__date">
                <span className="ep-apt__day">{d.day}</span>
                <span className="ep-apt__month">{d.month}</span>
                {p.atTime ? <span className="ep-apt__time">{p.atTime}</span> : null}
              </div>
              <div className="ep-apt__body">
                <div className="ep-apt__top">
                  <a className="ep-apt__title" href={`/gate-passes/${p.id}`}>
                    {t(lang, KIND[p.kind])}
                  </a>
                  <Badge tone={tone}>{t(lang, label)}</Badge>
                </div>
                <div>{p.reason}</div>
                <div className="ep-kicker">
                  {[
                    p.number,
                    studentLabel(p, t(lang, 'Adm. no.')),
                    p.escortName
                      ? `${t(lang, 'With')} ${p.escortName}${p.escortRelation ? ` (${p.escortRelation})` : ''}`
                      : null,
                    p.state === 'pending' && p.waitingOn
                      ? `${t(lang, 'Waiting on')} ${p.waitingOn}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="ep-apt__actions">
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/gate-passes/${p.id}`}
                    aria-label={`${t(lang, p.passNo ? 'Details and gate pass' : 'Details')} ${p.number}`}
                  >
                    {t(lang, p.passNo ? 'Details and gate pass' : 'Details')}
                  </a>
                  {['pending', 'approved'].includes(p.state) ? (
                    <form action={cancelGatePass}>
                      <input type="hidden" name="id" value={p.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t(lang, 'Cancel')} ${p.number}`}
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
