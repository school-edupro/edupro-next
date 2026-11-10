import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApprovalsTabs } from '@/components/leave/ApprovalsTabs';
import { ApproversImport } from '@/components/leave/ApproversImport';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ApproverChain, ApproversByEmployee } from '@/lib/leave';
import { ownApprovalRule } from '@/lib/leave-actions';

const SIZES = ['25', '50', '100', '500'];
const LENGTHS = ['Up to 7 days', '8 to 30 days', 'More than 30 days'];

/**
 * Who approves (the first page; the old module's screen): every employee with the approvers the rules give
 * them now — leave of any type for each length, and attendance corrections — and the rule that gives
 * them. "Own approvers" opens the employee's own rule, made from these approvers when there is none.
 */
export default async function WhoApprovesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  const page = Math.max(1, Number(sp.page) || 1);
  const size = SIZES.includes(sp.size ?? '') ? Number(sp.size) : 50;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const department = (sp.department ?? '').trim().slice(0, 100);
  const own = sp.own === '1';
  const query = new URLSearchParams({ page: String(page), size: String(size) });
  if (q) query.set('q', q);
  if (department) query.set('department', department);
  if (own) query.set('own', '1');
  let d: ApproversByEmployee;
  try {
    d = await apiFetch<ApproversByEmployee>(`/leave/setup/approvals/by-employee?${query}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const total = d.page.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const keep = new URLSearchParams({ size: String(size) });
  if (q) keep.set('q', q);
  if (department) keep.set('department', department);
  if (own) keep.set('own', '1');
  const here = `/leave/setup/approvals?${keep.toString()}&page=${String(page)}`;
  const pageUrl = (n: number) => `/leave/setup/approvals?${keep.toString()}&page=${String(n)}`;

  const levels = (ch: ApproverChain) =>
    ch.levels.length ? (
      <ul className="ep-approvers">
        {ch.levels.map((l, i) => (
          <li key={i}>
            <span className="ep-approvers__lv">L{i + 1}</span>{' '}
            {l.people.length ? (
              <>
                {l.people.join(', ')}
                {l.people.length > 1 ? (
                  <span className="ep-field__help">
                    {' '}
                    · {l.need === 'all' ? 'all must approve' : 'any one'}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="ep-field__help">{l.name}: nobody, skipped</span>
            )}
          </li>
        ))}
      </ul>
    ) : (
      <span className="ep-field__help">No approver: cannot apply</span>
    );
  const ruleOf = (ch: ApproverChain) =>
    ch.rule ? (
      <span className="ep-field__help">
        <a href={`/leave/setup/approvals/${ch.rule.id}`}>{ch.rule.name}</a>
        {ch.rule.own ? (
          <>
            {' '}
            <Badge tone="info">own</Badge>
          </>
        ) : null}
      </span>
    ) : null;
  const ownButton = (r: ApproversByEmployee['rows'][number], kind: 'leave' | 'regularisation') => {
    const id = r.own[kind];
    const label = kind === 'leave' ? 'Leave' : 'Corrections';
    if (id)
      return (
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/leave/setup/approvals/${id}`}
          aria-label={`${r.name}: edit own ${kind === 'leave' ? 'leave' : 'correction'} approvers`}
        >
          {label}: edit own
        </a>
      );
    if (!d.can.manage || !r.code) return null;
    return (
      <form action={ownApprovalRule}>
        <input type="hidden" name="employeeId" value={r.id} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="back" value={here} />
        <button
          type="submit"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          aria-label={`${r.name}: set own ${kind === 'leave' ? 'leave' : 'correction'} approvers`}
        >
          {label}: set own
        </button>
      </form>
    );
  };

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Who approves' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Who approves"
        description="Who approves each employee’s leave and attendance corrections. To change it for one person, use Set own; for a whole group (a department, a designation …), use Group rules."
      />
      <Notice params={sp} />
      <ApprovalsTabs current="employees" />
      <details className="ep-card" style={{ marginBottom: 'var(--sp-4)' }}>
        <summary className="ep-card__title">Excel: download, change, upload</summary>
        <ApproversImport canManage={d.can.manage} />
      </details>
      <section className="ep-card" aria-label="Employees and their approvers">
        <form method="get" className="ep-master__filter" aria-label="Filter">
          <label className="ep-field" htmlFor="be-q">
            <span className="ep-field__label">Employee</span>
            <input
              id="be-q"
              name="q"
              className="ep-input"
              type="search"
              defaultValue={q}
              maxLength={80}
              placeholder="Name or code"
            />
          </label>
          <label className="ep-field" htmlFor="be-dept">
            <span className="ep-field__label">Department</span>
            <select id="be-dept" name="department" className="ep-select" defaultValue={department}>
              <option value="">All departments</option>
              {d.departments.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="be-size">
            <span className="ep-field__label">Records per page</span>
            <select id="be-size" name="size" className="ep-select" defaultValue={String(size)}>
              {SIZES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-check" htmlFor="be-own">
            <input
              id="be-own"
              name="own"
              type="checkbox"
              value="1"
              className="ep-check__box"
              defaultChecked={own}
            />
            <span className="ep-check__text">Only with own approvers</span>
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Apply
          </button>
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/leave/setup/approvals">
            Clear
          </a>
        </form>
        <div className="ep-master__count">
          Showing {from} to {to} of {total} employees (page {page} of {pages})
        </div>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Employees and their approvers"
        >
          <table className="ep-table ep-table--dense ep-approvers__table">
            <caption className="ep-sr-only">Employees and their approvers</caption>
            <thead>
              <tr>
                <th scope="col">S.No</th>
                <th scope="col">Applies to</th>
                <th scope="col">Duration</th>
                <th scope="col">Leave approvers (L1/L2/L3)</th>
                <th scope="col">Correction approvers (L1/L2/L3)</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="ep-field__help">
                    No employee matches.
                  </td>
                </tr>
              ) : null}
              {d.rows.map((r, i) =>
                r.leave.map((b, j) => (
                  <tr
                    key={`${r.id}-${String(j)}`}
                    className={j === 0 ? 'ep-approvers__first' : undefined}
                  >
                    {j === 0 ? (
                      <>
                        <td rowSpan={3}>{from + i}</td>
                        <td rowSpan={3} className="ep-approvers__who">
                          <strong>
                            {r.code ? `${r.code} — ` : ''}
                            {r.name}
                          </strong>
                          <span className="ep-field__help">
                            {[r.designation, r.department].filter(Boolean).join(' · ')}
                          </span>
                          {r.signsIn ? null : (
                            <span className="ep-field__help">No sign-in: cannot apply</span>
                          )}
                        </td>
                      </>
                    ) : null}
                    <td className="ep-approvers__band">{LENGTHS[j] ?? b.band}</td>
                    <td>
                      {levels(b)}
                      {ruleOf(b)}
                    </td>
                    {j === 0 ? (
                      <>
                        <td rowSpan={3}>
                          {levels(r.regularisation)}
                          {ruleOf(r.regularisation)}
                        </td>
                        <td rowSpan={3}>
                          <div className="ep-approvers__actions">
                            {ownButton(r, 'leave')}
                            {ownButton(r, 'regularisation')}
                          </div>
                        </td>
                      </>
                    ) : null}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
        <nav className="ep-master__pager" aria-label="Pagination">
          {page > 1 ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page - 1)}>
              ‹ Previous
            </a>
          ) : (
            <span />
          )}
          <span className="ep-field__help">
            {page} / {pages}
          </span>
          {page < pages ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={pageUrl(page + 1)}>
              Next ›
            </a>
          ) : (
            <span />
          )}
        </nav>
      </section>
    </>
  );
}
