import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  APP_ORDER,
  APP_STATUS,
  APP_TONE,
  VACANCY_STATUS,
  dmy,
  type AppStatus,
  type ApplicationRow,
  type RecruitmentSetup,
  type Vacancy,
} from '@/lib/recruitment';
import { addWalkIn, bulkFail, bulkHold, bulkPass, bulkSchedule } from '@/lib/recruitment-actions';

const SIZES = [25, 50, 100] as const;

/**
 * Candidates (docs/design/34-recruitment.md, part 3): every application, filtered by vacancy, stage and
 * status, with the candidates of one stage taken on together (shortlisted, scheduled, passed, not taken
 * forward) and a walk-in added to a vacancy.
 */
export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: Promise<{
    vacancy?: string;
    stage?: string;
    status?: string;
    match?: string;
    q?: string;
    page?: string;
    size?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.recruitment.view')) notFound();
  const manage = me.permissions.includes('people.recruitment.manage');
  const id = (x?: string) => (x && /^\d{1,18}$/.test(x) ? x : '');
  const vacancyId = id(sp.vacancy);
  const stageId = vacancyId ? id(sp.stage) : '';
  const status = APP_ORDER.includes(sp.status as AppStatus) ? (sp.status as AppStatus) : '';
  const qs = new URLSearchParams({
    ...(vacancyId ? { vacancy: vacancyId } : {}),
    ...(stageId ? { stage: stageId } : {}),
    ...(status ? { status } : {}),
    ...(sp.match ? { match: '1' } : {}),
    ...(sp.q ? { q: sp.q } : {}),
  }).toString();
  const [list, vacancies, setup] = await Promise.all([
    apiFetch<{ data: ApplicationRow[]; counts: Partial<Record<AppStatus, number>> }>(
      `/people/recruitment/applications${qs ? `?${qs}` : ''}`,
    ),
    apiFetch<{ data: Vacancy[] }>('/people/recruitment/vacancies'),
    apiFetch<RecruitmentSetup>('/people/recruitment/setup'),
  ]);
  const usable = vacancies.data.filter((v) =>
    ['approved', 'published', 'closed'].includes(v.status),
  );
  const vacancy = usable.find((v) => v.id === vacancyId) ?? null;
  const stageName = new Map(setup.stages.map((s) => [s.id, s.name]));
  const size = (SIZES as readonly number[]).includes(Number(sp.size)) ? Number(sp.size) : 25;
  const pages = Math.max(1, Math.ceil(list.data.length / size));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const rows = list.data.slice((page - 1) * size, page * size);
  const here = `/people/recruitment/candidates${qs ? `?${qs}` : ''}`;
  const link = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(over))
      if (v === undefined || v === '') p.delete(k);
      else p.set(k, String(v));
    if (size !== 25) p.set('size', String(size));
    return `?${p.toString()}`;
  };
  const total = Object.values(list.counts).reduce((n, x) => n + (x ?? 0), 0);
  // ticking candidates works within one vacancy and one stage, so a result fits them all
  const bulk = manage && Boolean(vacancyId && stageId);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Vacancies', href: '/people/recruitment' },
          { label: 'Candidates' },
        ]}
      />
      <PageHeader
        kicker="Recruitment"
        title="Candidates"
        description="Every application and where it stands. Pick a vacancy and a stage to take its candidates on together."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <a
          className="ep-card ep-card--elevated ep-staff-kpi"
          href={link({ status: undefined, page: undefined })}
        >
          <span className="ep-kpi__value">{total}</span>
          <span className="ep-kpi__label">
            {vacancy ? `Applied for ${vacancy.title}` : 'All applications'}
          </span>
        </a>
        {(['submitted', 'screening', 'on_hold', 'selected', 'rejected'] as AppStatus[]).map((s) => (
          <a
            key={s}
            className="ep-card ep-card--elevated ep-staff-kpi"
            href={link({ status: s, page: undefined })}
          >
            <span className="ep-kpi__value">{list.counts[s] ?? 0}</span>
            <span className="ep-kpi__label">{APP_STATUS[s]}</span>
          </a>
        ))}
      </div>
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="cl-vac" style={{ margin: 0 }}>
          <span className="ep-field__label">Vacancy</span>
          <select id="cl-vac" name="vacancy" className="ep-select" defaultValue={vacancyId}>
            <option value="">All</option>
            {usable.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} ({v.code})
              </option>
            ))}
          </select>
        </label>
        {vacancy ? (
          <label className="ep-field" htmlFor="cl-stage" style={{ margin: 0 }}>
            <span className="ep-field__label">At stage</span>
            <select id="cl-stage" name="stage" className="ep-select" defaultValue={stageId}>
              <option value="">Any</option>
              {vacancy.stageIds.map((s) => (
                <option key={s} value={s}>
                  {stageName.get(s) ?? s}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="ep-field" htmlFor="cl-status" style={{ margin: 0 }}>
          <span className="ep-field__label">Status</span>
          <select id="cl-status" name="status" className="ep-select" defaultValue={status}>
            <option value="">All</option>
            {APP_ORDER.map((s) => (
              <option key={s} value={s}>
                {APP_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="cl-size" style={{ margin: 0 }}>
          <span className="ep-field__label">Per page</span>
          <select id="cl-size" name="size" className="ep-select" defaultValue={String(size)}>
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="cl-q" style={{ margin: 0 }}>
          <span className="ep-field__label">Name, mobile, email or number</span>
          <input id="cl-q" name="q" type="search" className="ep-input" defaultValue={sp.q ?? ''} />
        </label>
        <label className="ep-check" htmlFor="cl-match" style={{ alignSelf: 'center' }}>
          <input
            id="cl-match"
            type="checkbox"
            name="match"
            value="1"
            defaultChecked={Boolean(sp.match)}
          />{' '}
          Same mobile or email as an employee
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>

      <form action={bulkPass}>
        <input type="hidden" name="back" value={here} />
        <input type="hidden" name="stageId" value={stageId} />
        {bulk ? (
          <section
            className="ep-card"
            aria-labelledby="cl-bulk-h"
            style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}
          >
            <h2 id="cl-bulk-h" className="ep-card__title" style={{ marginTop: 0 }}>
              The ticked candidates at {stageName.get(stageId)}
            </h2>
            <div className="ep-acr-filter">
              <label className="ep-field" htmlFor="cl-when" style={{ margin: 0 }}>
                <span className="ep-field__label">Date and time</span>
                <input id="cl-when" name="scheduledAt" type="datetime-local" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="cl-venue" style={{ margin: 0 }}>
                <span className="ep-field__label">Venue</span>
                <input id="cl-venue" name="venue" className="ep-input" maxLength={200} />
              </label>
              <label className="ep-field" htmlFor="cl-panel" style={{ margin: 0 }}>
                <span className="ep-field__label">Panel</span>
                <input id="cl-panel" name="panel" className="ep-input" maxLength={300} />
              </label>
              <label className="ep-field" htmlFor="cl-rem" style={{ margin: 0 }}>
                <span className="ep-field__label">Remarks</span>
                <input id="cl-rem" name="remarks" className="ep-input" maxLength={1000} />
              </label>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--sp-2)',
                marginTop: 'var(--sp-3)',
              }}
            >
              <button type="submit" formAction={bulkSchedule} className="ep-btn ep-btn--secondary">
                Schedule
              </button>
              <button type="submit" className="ep-btn ep-btn--primary">
                Passed this stage
              </button>
              <button type="submit" formAction={bulkHold} className="ep-btn ep-btn--ghost">
                Put on hold
              </button>
              <button type="submit" formAction={bulkFail} className="ep-btn ep-btn--ghost">
                Not taken forward
              </button>
            </div>
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              A schedule tells each candidate (as set under Recruitment set-up → Notices).
            </p>
          </section>
        ) : manage ? (
          <p className="ep-field__help">
            Pick a vacancy and a stage to tick candidates and take them on together.
          </p>
        ) : null}
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Candidates (scrolls sideways)"
        >
          <table className="ep-table">
            <caption className="ep-sr-only">Candidates</caption>
            <thead>
              <tr>
                {bulk ? (
                  <th scope="col">
                    <span className="ep-sr-only">Tick</span>
                  </th>
                ) : null}
                <th scope="col">Candidate</th>
                <th scope="col">Post</th>
                <th scope="col">Stage</th>
                <th scope="col">Status</th>
                <th scope="col">Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {bulk ? (
                    <td>
                      <input
                        type="checkbox"
                        name="ids"
                        value={r.id}
                        aria-label={`Tick ${r.name}`}
                      />
                    </td>
                  ) : null}
                  <td>
                    <a href={`/people/recruitment/applications/${r.id}`}>
                      <strong>{r.name}</strong>
                    </a>
                    <div className="ep-field__help">
                      {[r.number, r.mobile, r.email].filter(Boolean).join(' · ')}
                      {r.source === 'office' ? ' · added by the office' : ''}
                    </div>
                    {r.match ? (
                      <Badge tone="warning">Same mobile or email as an employee</Badge>
                    ) : null}
                  </td>
                  <td>
                    {r.vacancy}
                    <div className="ep-field__help">{r.vacancyCode}</div>
                  </td>
                  <td>
                    {['submitted', 'screening', 'on_hold'].includes(r.status)
                      ? (r.stage ?? '—')
                      : '—'}
                  </td>
                  <td>
                    <Badge tone={APP_TONE[r.status] as 'neutral'}>{APP_STATUS[r.status]}</Badge>
                  </td>
                  <td>{dmy(r.submittedAt)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={bulk ? 6 : 5}>
                    {total ? 'No candidate matches.' : 'No application yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </form>
      {list.data.length > size ? (
        <nav
          aria-label="Pages of candidates"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            marginTop: 'var(--sp-3)',
          }}
        >
          <span className="ep-field__help">
            Showing {(page - 1) * size + 1}–{Math.min(page * size, list.data.length)} of{' '}
            {list.data.length}
          </span>
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link({ page: page - 1 })}>
              Previous
            </a>
          ) : null}
          <span className="ep-field__help">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={link({ page: page + 1 })}>
              Next
            </a>
          ) : null}
        </nav>
      ) : null}

      {manage && usable.length ? (
        <section
          className="ep-card"
          aria-labelledby="cl-walk-h"
          style={{ padding: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}
        >
          <h2 id="cl-walk-h" className="ep-card__title">
            Add a candidate the office met
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            A walk-in or a referral. Checked as the employee master checks; the candidate can
            complete the full form online by signing in with this mobile.
          </p>
          <form action={addWalkIn} className="ep-acr-filter">
            <input type="hidden" name="back" value={here} />
            <label className="ep-field" htmlFor="wi-vac" style={{ margin: 0 }}>
              <span className="ep-field__label">Vacancy *</span>
              <select
                id="wi-vac"
                name="vacancyId"
                className="ep-select"
                defaultValue={vacancyId}
                required
              >
                <option value="">—</option>
                {usable.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title} ({VACANCY_STATUS[v.status]})
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="wi-first" style={{ margin: 0 }}>
              <span className="ep-field__label">First name *</span>
              <input id="wi-first" name="firstName" className="ep-input" required maxLength={80} />
            </label>
            <label className="ep-field" htmlFor="wi-last" style={{ margin: 0 }}>
              <span className="ep-field__label">Last name</span>
              <input id="wi-last" name="lastName" className="ep-input" maxLength={80} />
            </label>
            <label className="ep-field" htmlFor="wi-gender" style={{ margin: 0 }}>
              <span className="ep-field__label">Gender *</span>
              <select id="wi-gender" name="gender" className="ep-select" required defaultValue="">
                <option value="">—</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="wi-dob" style={{ margin: 0 }}>
              <span className="ep-field__label">Date of birth</span>
              <input id="wi-dob" name="dob" type="date" className="ep-input" />
            </label>
            <label className="ep-field" htmlFor="wi-mob" style={{ margin: 0 }}>
              <span className="ep-field__label">Mobile *</span>
              <input
                id="wi-mob"
                name="mobile"
                className="ep-input"
                inputMode="numeric"
                required
                maxLength={10}
              />
            </label>
            <label className="ep-field" htmlFor="wi-mail" style={{ margin: 0 }}>
              <span className="ep-field__label">Email</span>
              <input id="wi-mail" name="email" type="email" className="ep-input" maxLength={200} />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary">
              Add the candidate
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
