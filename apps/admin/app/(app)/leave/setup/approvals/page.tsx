import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ScopePicker } from '@/components/leave/ScopePicker';
import { ApprovalsTabs } from '@/components/leave/ApprovalsTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { ApprovalRules, ChainPreview } from '@/lib/leave';
import { createApprovalRule } from '@/lib/leave-actions';

const ID = /^\d{1,18}$/;

/**
 * Who approves staff leave (docs/design/85, "Who approves"): the rules by scope and leave type, each
 * with three day bands of up to 3 levels, and the attendance-correction (regularisation) rules; a new
 * rule; and a test of the chain for an employee.
 */
export default async function LeaveApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  let d: ApprovalRules;
  try {
    d = await apiFetch<ApprovalRules>('/leave/setup/approvals');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  // test the chain
  const pe = sp.pe && ID.test(sp.pe) ? sp.pe : '';
  const pk = sp.pk === 'regularisation' ? 'regularisation' : 'leave';
  const pt = sp.pt && ID.test(sp.pt) ? sp.pt : '';
  const pd = Math.min(365, Math.max(0.5, Number(sp.pd) || 1));
  let preview: ChainPreview | null = null;
  let previewError = '';
  if (pe) {
    const q = new URLSearchParams({ employeeId: pe, kind: pk, days: String(pd) });
    if (pt && pk === 'leave') q.set('leaveTypeId', pt);
    try {
      preview = await apiFetch<ChainPreview>(`/leave/setup/approvals/preview?${q.toString()}`);
    } catch (e) {
      if (e instanceof ApiError) previewError = e.problem.detail ?? e.problem.type;
      else throw e;
    }
  }
  const leave = d.rules.filter((r) => r.kind === 'leave');
  const reg = d.rules.filter((r) => r.kind === 'regularisation');
  const levelCell = (names: string[]) =>
    names.length ? (
      <ol style={{ margin: 0, paddingLeft: 'var(--sp-4)' }}>
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ol>
    ) : (
      <span className="ep-field__help">Not set</span>
    );
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
        description="A rule is for all staff or the departments, designations, employee types or employees picked, and for one leave type or any type. A leave goes to the first rule by priority (lowest number) that takes the employee in — a rule for its leave type before one for any type — and to the levels of its length: up to 7 days, more than 7 up to 30, or more than 30. Approvers are worked out when the leave is applied, so a new joiner is covered."
      />
      <Notice params={sp} />
      <ApprovalsTabs current="rules" />
      <section className="ep-card" aria-labelledby="la-leave">
        <h2 id="la-leave" className="ep-card__title">
          Leave
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="la-leave">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">For</th>
                <th scope="col">Leave type</th>
                {d.bands.map((b) => (
                  <th key={b} scope="col">
                    {b}
                  </th>
                ))}
                <th scope="col" style={{ textAlign: 'right' }}>
                  Priority
                </th>
              </tr>
            </thead>
            <tbody>
              {leave.length ? (
                leave.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/leave/setup/approvals/${r.id}`}>{r.name}</a>
                      {r.status === 'inactive' ? (
                        <span className="ep-mr-col__desc">
                          <Badge tone="neutral">Switched off</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>{r.scopeWords}</td>
                    <td>
                      {r.leaveType ? `${r.leaveType.name} (${r.leaveType.code})` : 'Any type'}
                    </td>
                    {r.bands.map((b) => (
                      <td key={b.label}>{levelCell(b.levels)}</td>
                    ))}
                    <td style={{ textAlign: 'right' }}>{r.priority}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No rule yet: nobody can apply for leave that needs approval.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ep-card" aria-labelledby="la-reg" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="la-reg" className="ep-card__title">
          Attendance corrections (regularisation)
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="la-reg">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">For</th>
                <th scope="col">Levels</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Priority
                </th>
              </tr>
            </thead>
            <tbody>
              {reg.length ? (
                reg.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/leave/setup/approvals/${r.id}`}>{r.name}</a>
                      {r.status === 'inactive' ? (
                        <span className="ep-mr-col__desc">
                          <Badge tone="neutral">Switched off</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td>{r.scopeWords}</td>
                    <td>{levelCell(r.bands[0]?.levels ?? [])}</td>
                    <td style={{ textAlign: 'right' }}>{r.priority}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>No rule yet: staff cannot ask for an attendance correction.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {d.can.manage ? (
        <section className="ep-card" aria-labelledby="la-new" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="la-new" className="ep-card__title">
            New rule
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Say who it is for and which leave type; on the next page set the levels of each day
            band.
          </p>
          <form action={createApprovalRule} className="ep-form-section__body">
            <label className="ep-field" htmlFor="la-kind">
              <span className="ep-field__label">Approves</span>
              <select id="la-kind" name="kind" className="ep-select" defaultValue="leave">
                <option value="leave">Leave</option>
                <option value="regularisation">Attendance corrections</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="la-name">
              <span className="ep-field__label">Name</span>
              <input
                id="la-name"
                name="name"
                className="ep-input"
                required
                minLength={2}
                maxLength={100}
                placeholder="Teaching staff, Accounts …"
              />
            </label>
            <ScopePicker id="la-new" scopes={d.scopes} staff={d.staff} />
            <label className="ep-field" htmlFor="la-type">
              <span className="ep-field__label">Leave type</span>
              <select id="la-type" name="leaveTypeId" className="ep-select" defaultValue="">
                <option value="">Any type</option>
                {d.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code}){t.auto ? ' — approved at once' : ''}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">Not used for attendance corrections.</span>
            </label>
            <label className="ep-field" htmlFor="la-prio">
              <span className="ep-field__label">Priority</span>
              <input
                id="la-prio"
                name="priority"
                type="number"
                min={1}
                max={9999}
                defaultValue={100}
                className="ep-input"
              />
              <span className="ep-field__help">
                Lower first: a narrow rule before one for all staff.
              </span>
            </label>
            <div className="ep-form-actions">
              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                Add the rule
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <section className="ep-card" aria-labelledby="la-test" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="la-test" className="ep-card__title">
          Test the chain
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Who would approve, today, a leave of an employee — or tell why nobody would.
        </p>
        <form
          method="get"
          action="/leave/setup/approvals"
          className="ep-grid__toolbar"
          style={{ flexWrap: 'wrap' }}
        >
          <label className="ep-field" htmlFor="la-pe">
            <span className="ep-field__label">Employee</span>
            <select id="la-pe" name="pe" className="ep-select" defaultValue={pe} required>
              <option value="">Pick an employee</option>
              {d.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="la-pk">
            <span className="ep-field__label">For</span>
            <select id="la-pk" name="pk" className="ep-select" defaultValue={pk}>
              <option value="leave">Leave</option>
              <option value="regularisation">Attendance correction</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="la-pt">
            <span className="ep-field__label">Leave type</span>
            <select id="la-pt" name="pt" className="ep-select" defaultValue={pt}>
              <option value="">Any</option>
              {d.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="la-pd">
            <span className="ep-field__label">Days</span>
            <input
              id="la-pd"
              name="pd"
              type="number"
              min={0.5}
              max={365}
              step={0.5}
              defaultValue={pd}
              className="ep-input"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
            Test
          </button>
        </form>
        {previewError ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {previewError}
          </p>
        ) : null}
        {preview ? (
          <div role="status">
            <p className="ep-field__help">
              <strong>{preview.employee}</strong> · {preview.band}
              {preview.rule ? (
                <>
                  {' '}
                  · rule{' '}
                  <a href={`/leave/setup/approvals/${preview.rule.id}`}>{preview.rule.name}</a>
                </>
              ) : null}
            </p>
            {preview.levels.length ? (
              <ol>
                {preview.levels.map((l) => (
                  <li key={l.name}>
                    <strong>{l.name}</strong>: {l.people.length ? l.people.join(', ') : l.note}
                  </li>
                ))}
              </ol>
            ) : null}
            {preview.note ? <p className="ep-alert ep-alert--warning">{preview.note}</p> : null}
          </div>
        ) : null}
      </section>
    </>
  );
}
