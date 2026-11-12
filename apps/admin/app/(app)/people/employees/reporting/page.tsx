import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { pageSizeOf } from '@/components/Pager';
import { Icon } from '@/components/nav-icons';
import { DialogButton } from '@/components/leave/DialogButton';
import { Pages, Showing, SizeLinks } from '@/components/leave/ListBar';
import { ReportingImport } from '@/components/people/ReportingImport';
import { TickAll } from '@/components/people/TickAll';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ReportingList } from '@/lib/reporting';
import { moveTeam, saveReporting } from '@/lib/reporting-actions';

const ID = /^\d{1,18}$/;

/**
 * Reporting managers (docs/design/30, as Zoho People's Assign Reporting To and the Excel imports of Keka and
 * greytHR): who each active employee reports to in the working year — changed in its row, for the ticked
 * employees at once, a manager's whole team moved to another, or from Excel (checked old → new first).
 * Leave and corrections already waiting with an old manager stay with them; the result says how many.
 */
export default async function ReportingManagersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.employee.view')) notFound();
  const edit = me.permissions.includes('people.employee.edit');
  const keep = new URLSearchParams();
  if (sp.q) keep.set('q', sp.q.slice(0, 80));
  if (sp.department) keep.set('department', sp.department.slice(0, 80));
  if (sp.designation) keep.set('designation', sp.designation.slice(0, 80));
  if (sp.managerId && (ID.test(sp.managerId) || sp.managerId === 'none'))
    keep.set('managerId', sp.managerId);
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page) || 1);
  let d: ReportingList;
  try {
    d = await apiFetch<ReportingList>(
      `/people/reporting?${new URLSearchParams([...keep, ['size', size], ['page', String(page)]]).toString()}`,
    );
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    if (e instanceof ApiError)
      return (
        <p className="ep-alert ep-alert--danger" role="alert">
          {typeof e.problem.detail === 'string' ? e.problem.detail : 'Could not load it.'}
        </p>
      );
    throw e;
  }
  const href = (o: { page?: number; size?: string; managerId?: string | null }) => {
    const p = new URLSearchParams(keep);
    if (o.managerId !== undefined) {
      if (o.managerId) p.set('managerId', o.managerId);
      else p.delete('managerId');
    }
    const sz = o.size ?? size;
    if (sz !== '50') p.set('size', sz);
    if (o.page && o.page > 1) p.set('page', String(o.page));
    const s = p.toString();
    return `/people/employees/reporting${s ? `?${s}` : ''}`;
  };
  const here = href({ page });
  const pick = (name: string, id: string, label: string, value: string, none: string) => (
    <label className="ep-field" htmlFor={id}>
      <span className="ep-field__label">{label}</span>
      <select id={id} name={name} className="ep-select" defaultValue={value} required>
        <option value="">{none}</option>
        <option value="none">Nobody (no reporting manager)</option>
        {d.lists.employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </label>
  );
  const sel = (name: string, label: string, opts: string[]) => (
    <label className="ep-field" htmlFor={`rf-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`rf-${name}`}
        name={name}
        className="ep-select"
        defaultValue={keep.get(name) ?? ''}
      >
        <option value="">All</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
  const cards: Array<[string, number, string | null | undefined, string]> = [
    ['Staff', d.figures.staff, null, 'users'],
    ['With a manager', d.figures.set, undefined, 'checkCircle'],
    ['Without a manager', d.figures.none, 'none', 'xCircle'],
    ['Managers', d.figures.managers, undefined, 'user'],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/dashboard' },
          { label: 'Employees', href: '/people/employees' },
          { label: 'Reporting managers' },
        ]}
      />
      <PageHeader
        kicker="People"
        title="Reporting managers"
        description={`Who each employee reports to in ${d.year.name ?? 'the working year'}: their manager sees their team’s attendance, leave and punches. Change one in its row, tick many and assign, move a manager’s whole team, or use Excel.`}
        actions={
          edit ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <DialogButton
                id="rm-move"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                title="Move a manager’s whole team"
                label="Move a team"
              >
                <form action={moveTeam} className="ep-form-section__body">
                  <input type="hidden" name="back" value={here} />
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    Everyone who reports to the first manager this year reports to the second from
                    now on — when a manager leaves or changes role.
                  </p>
                  <label className="ep-field" htmlFor="rm-from">
                    <span className="ep-field__label">Whose team</span>
                    <select
                      id="rm-from"
                      name="fromManagerId"
                      className="ep-select"
                      required
                      defaultValue=""
                    >
                      <option value="">Pick a manager</option>
                      {d.lists.managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} — {m.reportees} reporting
                        </option>
                      ))}
                    </select>
                  </label>
                  {pick(
                    'toManagerId',
                    'rm-to',
                    'Reports to from now on',
                    '',
                    'Pick who they report to',
                  )}
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    Move the team
                  </button>
                </form>
              </DialogButton>
              <DialogButton
                id="rm-xl"
                className="ep-btn ep-btn--secondary ep-btn--sm"
                title="Reporting managers from Excel"
                label="Excel upload"
              >
                <ReportingImport />
              </DialogButton>
            </div>
          ) : null
        }
      />
      <Notice params={sp} />

      <ul className="ep-regkpis" aria-label="Figures">
        {cards.map(([label, n, filter, icon]) => (
          <li key={label}>
            {filter === undefined ? (
              <span className="ep-regkpi">
                <span className="ep-regkpi__ic" aria-hidden="true">
                  <Icon name={icon as 'users'} size={18} />
                </span>
                <span>
                  <span className="ep-regkpi__label">{label}</span>
                  <span className="ep-regkpi__num">{n}</span>
                </span>
              </span>
            ) : (
              <a
                className="ep-regkpi"
                href={href({ managerId: filter, page: 1 })}
                aria-current={(keep.get('managerId') ?? null) === filter ? 'true' : undefined}
              >
                <span className="ep-regkpi__ic" aria-hidden="true">
                  <Icon name={icon as 'users'} size={18} />
                </span>
                <span>
                  <span className="ep-regkpi__label">{label}</span>
                  <span className="ep-regkpi__num">{n}</span>
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>

      <form method="get" action="/people/employees/reporting" className="ep-card ep-pfilter">
        <div className="ep-pfilter__row">
          <label className="ep-field" htmlFor="rf-q">
            <span className="ep-field__label">Search</span>
            <input
              id="rf-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={keep.get('q') ?? ''}
              placeholder="Name or employee code"
              maxLength={80}
            />
          </label>
          {sel('department', 'Department', d.lists.departments)}
          {sel('designation', 'Designation', d.lists.designations)}
          <label className="ep-field" htmlFor="rf-mgr">
            <span className="ep-field__label">Reports to</span>
            <select
              id="rf-mgr"
              name="managerId"
              className="ep-select"
              defaultValue={keep.get('managerId') ?? ''}
            >
              <option value="">Anyone</option>
              <option value="none">Nobody set</option>
              {d.lists.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.reportees})
                </option>
              ))}
            </select>
          </label>
          <div className="ep-pfilter__go">
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Show
            </button>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/people/employees/reporting">
              Clear
            </a>
          </div>
        </div>
      </form>

      <form id="rm-list" action={saveReporting}>
        <input type="hidden" name="back" value={here} />
        <div className="ep-listbar">
          <SizeLinks size={d.size} sizeHref={(s) => href({ size: s, page: 1 })} noun="employees" />
          <div className="ep-listbar__end">
            <Showing page={d.page} size={d.size} total={d.total} />
          </div>
        </div>
        {edit ? (
          <div className="ep-card ep-rmbulk">
            <TickAll form="rm-list" />
            <label className="ep-field ep-rmbulk__pick" htmlFor="rm-bulk">
              <span className="ep-field__label">The ticked report to</span>
              <select id="rm-bulk" name="managerId" className="ep-select" defaultValue="">
                <option value="">Pick a manager</option>
                <option value="none">Nobody (no reporting manager)</option>
                {d.lists.employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Assign to the ticked
            </button>
          </div>
        ) : null}
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Reporting managers">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                {edit ? (
                  <th scope="col">
                    <span className="ep-sr-only">Tick</span>
                  </th>
                ) : null}
                <th scope="col">Employee</th>
                <th scope="col">Department</th>
                <th scope="col">Designation</th>
                <th scope="col">Reports to</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Reporting to them
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    {edit ? (
                      <td>
                        <input
                          id={`rm-t-${r.id}`}
                          type="checkbox"
                          name="employeeIds"
                          value={r.id}
                          aria-label={`Tick ${r.name}`}
                        />
                      </td>
                    ) : null}
                    <td>
                      <a href={`/people/employees/${r.id}?tab=posting`}>
                        <strong>{r.name}</strong>
                      </a>
                      <span className="ep-mr-col__desc">{r.code ?? '—'}</span>
                    </td>
                    <td>{r.department ?? '—'}</td>
                    <td>{r.designation ?? '—'}</td>
                    <td style={{ minWidth: '16rem' }}>
                      {edit ? (
                        <div className="ep-rmrow">
                          <label className="ep-sr-only" htmlFor={`m_${r.id}`}>
                            {r.name} reports to
                          </label>
                          <select
                            id={`m_${r.id}`}
                            name={`m_${r.id}`}
                            className="ep-select"
                            defaultValue={r.manager?.id ?? ''}
                          >
                            <option value="">Nobody</option>
                            {d.lists.employees
                              .filter((e) => e.id !== r.id)
                              .map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name}
                                </option>
                              ))}
                          </select>
                          <button
                            type="submit"
                            name="one"
                            value={r.id}
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                            aria-label={`Save ${r.name}’s reporting manager`}
                          >
                            Save
                          </button>
                        </div>
                      ) : r.manager ? (
                        `${r.manager.name ?? ''} (${r.manager.code ?? '—'})`
                      ) : (
                        'Nobody'
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {r.reportees ? (
                        <a href={href({ managerId: r.id, page: 1 })}>{r.reportees}</a>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={edit ? 6 : 5}>Nobody in these filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </form>
      <Pages
        page={d.page}
        size={d.size}
        total={d.total}
        href={(p) => href({ page: p })}
        noun="employees"
      />
      <p className="ep-field__help">
        A change applies from now on to {d.year.name ?? 'the working year'}’s posting. Leave and
        corrections already waiting with an old manager stay with them; new ones go to the new
        manager.
      </p>
    </>
  );
}
