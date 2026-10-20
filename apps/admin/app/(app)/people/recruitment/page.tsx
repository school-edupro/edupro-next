import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  VACANCY_ORDER,
  VACANCY_STATUS,
  VACANCY_TONE,
  dmy,
  type Vacancy,
  type VacancyStatus,
} from '@/lib/recruitment';

/** Vacancies (docs/design/34-recruitment.md): raised, waiting for approval, published, closed. */
export default async function VacanciesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.recruitment.view')) notFound();
  const canRaise = me.permissions.includes('people.recruitment.raise');
  const status = VACANCY_ORDER.includes(sp.status as VacancyStatus) ? sp.status : '';
  const list = await apiFetch<{ data: Vacancy[]; counts: Partial<Record<VacancyStatus, number>> }>(
    `/people/recruitment/vacancies${status ? `?status=${status}` : ''}`,
  );
  const q = (sp.q ?? '').trim().toLowerCase();
  const rows = list.data.filter(
    (v) =>
      !q ||
      `${v.code} ${v.title} ${v.department ?? ''} ${v.subject ?? ''} ${v.designation ?? ''}`
        .toLowerCase()
        .includes(q),
  );
  const total = Object.values(list.counts).reduce((n, x) => n + (x ?? 0), 0);
  const cards: VacancyStatus[] = ['draft', 'pending', 'approved', 'published', 'closed'];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Vacancies' },
        ]}
      />
      <PageHeader
        kicker="Recruitment"
        title="Vacancies"
        description="Posts the school is filling: raised, approved through the school’s levels, published for candidates."
        actions={
          <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--secondary" href="/people/recruitment/setup">
              Set-up
            </a>
            {canRaise ? (
              <a className="ep-btn ep-btn--primary" href="/people/recruitment/new">
                Raise a vacancy
              </a>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <a className="ep-card ep-card--elevated ep-staff-kpi" href="?">
          <span className="ep-kpi__value">{total}</span>
          <span className="ep-kpi__label">All vacancies</span>
        </a>
        {cards.map((s) => (
          <a key={s} className="ep-card ep-card--elevated ep-staff-kpi" href={`?status=${s}`}>
            <span className="ep-kpi__value">{list.counts[s] ?? 0}</span>
            <span className="ep-kpi__label">{VACANCY_STATUS[s]}</span>
          </a>
        ))}
      </div>
      <form
        method="get"
        className="ep-card ep-acr-filter"
        style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}
      >
        <label className="ep-field" htmlFor="vl-status" style={{ margin: 0 }}>
          <span className="ep-field__label">Status</span>
          <select id="vl-status" name="status" className="ep-select" defaultValue={status}>
            <option value="">All</option>
            {VACANCY_ORDER.map((s) => (
              <option key={s} value={s}>
                {VACANCY_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor="vl-q" style={{ margin: 0 }}>
          <span className="ep-field__label">Post, code, department or subject</span>
          <input id="vl-q" name="q" type="search" className="ep-input" defaultValue={sp.q ?? ''} />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      <div
        className="ep-table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Vacancies (scrolls sideways)"
      >
        <table className="ep-table">
          <caption className="ep-sr-only">Vacancies</caption>
          <thead>
            <tr>
              <th scope="col">Post</th>
              <th scope="col">Department</th>
              <th scope="col">Posts</th>
              <th scope="col">Status</th>
              <th scope="col">Where it is</th>
              <th scope="col">Raised by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td>
                  <a href={`/people/recruitment/${v.id}`}>
                    <strong>{v.title}</strong>
                  </a>
                  <div className="ep-field__help">
                    {[v.code, v.subject, v.employeeType].filter(Boolean).join(' · ')}
                  </div>
                </td>
                <td>{v.department ?? '—'}</td>
                <td>{v.posts}</td>
                <td>
                  <Badge tone={VACANCY_TONE[v.status] as 'neutral'}>
                    {VACANCY_STATUS[v.status]}
                  </Badge>
                </td>
                <td>
                  {v.status === 'pending'
                    ? (v.waitingWith ?? 'With the approvers')
                    : v.status === 'published'
                      ? `Open ${dmy(v.opensOn)} to ${dmy(v.closesOn)}`
                      : v.status === 'rejected'
                        ? (v.decisionNote ?? 'Sent back')
                        : v.status === 'closed'
                          ? `Closed ${dmy(v.closedAt)}`
                          : '—'}
                </td>
                <td>{v.raisedBy ?? '—'}</td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>
                  {total ? 'No vacancy matches.' : 'No vacancy yet: raise the first one.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
