import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { TickAll } from '@/components/TickAll';
import { bulkClearance, bulkWithdrawal, bulkWithdrawalTc } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Page, Student, Withdrawal, WithdrawalDepartment } from '@/lib/types';

const TABS = [
  ['start', '1. Start withdrawals'],
  ['clear', '2. Clear a department'],
  ['tc', '3. Issue TCs'],
] as const;

/**
 * Bulk withdrawal for a whole class (Class XII at the year end): start many with one leaving date and
 * reason, clear one department for many at once, then issue the TCs together.
 */
export default async function BulkWithdrawalPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    section?: string;
    department?: string;
    done?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'start';
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  const [sections, deps] = await Promise.all([
    sectionOptions(),
    apiFetch<{ departments: WithdrawalDepartment[] }>('/people/withdrawal-departments')
      .then((r) => r.departments.filter((d) => d.active))
      .catch(() => [] as WithdrawalDepartment[]),
  ]);
  const students =
    tab === 'start' && sp.section && /^\d+$/.test(sp.section)
      ? await apiFetch<Page<Student>>(
          `/people/students?classSectionId=${sp.section}&size=200`,
        ).then((r) => r.data)
      : [];
  const open =
    tab !== 'start'
      ? await apiFetch<Page<Withdrawal>>('/people/withdrawals?status=open&size=200').then(
          (r) => r.data,
        )
      : [];
  const department = deps.find((d) => d.code === sp.department) ?? deps[0];
  const toClear = department
    ? open.filter((w) =>
        w.clearances.some(
          (x) => x.department === department.code && x.status !== 'cleared' && x.canAct,
        ),
      )
    : [];
  const done =
    tab === 'tc'
      ? await apiFetch<Page<Withdrawal>>('/people/withdrawals?status=completed&size=200').then(
          (r) => r.data,
        )
      : [];
  const tcReady = [...open, ...done].filter((w) => w.canIssueTc && !w.tc);
  const label = (v: string) => sections.find((s) => s.value === v)?.label ?? '';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Withdrawals', href: '/people/withdrawals' },
          { label: 'Bulk' },
        ]}
      />
      <PageHeader
        kicker="Withdrawals"
        title="Bulk withdrawal and TCs"
        description="For a whole class leaving together, e.g. Class XII after the board results. Fees and library clear by themselves for students with nothing due."
      />
      <Notice params={sp} />
      {sp.done ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          {sp.done}
        </div>
      ) : null}
      <nav className="ep-tabs-links" aria-label="Bulk steps">
        {TABS.map(([k, t]) => (
          <a
            key={k}
            href={`/people/withdrawals/bulk?tab=${k}`}
            aria-current={tab === k ? 'page' : undefined}
          >
            {t}
          </a>
        ))}
      </nav>

      {tab === 'start' ? (
        <Card>
          <form method="get" className="ep-wd__form" style={{ marginBottom: 'var(--sp-4)' }}>
            <input type="hidden" name="tab" value="start" />
            <label className="ep-field" htmlFor="section">
              <span className="ep-field__label">Class and section</span>
              <select
                id="section"
                name="section"
                className="ep-select"
                defaultValue={sp.section ?? ''}
              >
                <option value="">Choose…</option>
                {sections.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Show students
            </Button>
          </form>
          {sp.section ? (
            students.filter((s) => s.status === 'active').length ? (
              <form action={bulkWithdrawal}>
                <input type="hidden" name="section" value={sp.section} />
                <fieldset className="ep-wd__pick">
                  <legend>
                    Students of {label(sp.section)} (
                    {students.filter((s) => s.status === 'active').length})
                  </legend>
                  <TickAll name="studentIds" label="Tick all" />
                  <ul className="ep-wd__picklist">
                    {students
                      .filter((s) => s.status === 'active')
                      .map((s) => (
                        <li key={s.id}>
                          <label className="ep-roles__tick" htmlFor={`st-${s.id}`}>
                            <input
                              id={`st-${s.id}`}
                              type="checkbox"
                              name="studentIds"
                              value={s.id}
                            />{' '}
                            {s.displayName} · {s.admissionNo}
                          </label>
                        </li>
                      ))}
                  </ul>
                </fieldset>
                <div className="ep-wd__form">
                  <label className="ep-field" htmlFor="initiatedOn">
                    <span className="ep-field__label">Started on</span>
                    <input id="initiatedOn" name="initiatedOn" type="date" className="ep-input" />
                  </label>
                  <label className="ep-field" htmlFor="leavingOn">
                    <span className="ep-field__label">Leaving on *</span>
                    <input
                      id="leavingOn"
                      name="leavingOn"
                      type="date"
                      className="ep-input"
                      required
                    />
                  </label>
                  <label className="ep-field ep-wd__wide" htmlFor="reason">
                    <span className="ep-field__label">Reason *</span>
                    <input
                      id="reason"
                      name="reason"
                      className="ep-input"
                      required
                      maxLength={300}
                      defaultValue="Passed out (Class XII)"
                    />
                  </label>
                  <label className="ep-field ep-wd__wide" htmlFor="remarks">
                    <span className="ep-field__label">Remarks</span>
                    <input id="remarks" name="remarks" className="ep-input" maxLength={1000} />
                  </label>
                  <Button type="submit" disabled={!can('people.withdrawal.manage')}>
                    Start withdrawals for the ticked students
                  </Button>
                </div>
              </form>
            ) : (
              <p className="ep-field__help">No active students in this section.</p>
            )
          ) : null}
        </Card>
      ) : null}

      {tab === 'clear' ? (
        <Card>
          <form method="get" className="ep-wd__form" style={{ marginBottom: 'var(--sp-4)' }}>
            <input type="hidden" name="tab" value="clear" />
            <label className="ep-field" htmlFor="department">
              <span className="ep-field__label">Department</span>
              <select
                id="department"
                name="department"
                className="ep-select"
                defaultValue={department?.code ?? ''}
              >
                {deps.map((d) => (
                  <option key={d.code} value={d.code}>
                    Step {d.step}: {d.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Show waiting students
            </Button>
          </form>
          {department ? (
            toClear.length ? (
              <form action={bulkClearance}>
                <input type="hidden" name="department" value={department.code} />
                <fieldset className="ep-wd__pick">
                  <legend>
                    Waiting for {department.name} ({toClear.length})
                  </legend>
                  <TickAll name="withdrawalIds" label="Tick all" />
                  <ul className="ep-wd__picklist">
                    {toClear.map((w) => {
                      const x = w.clearances.find((y) => y.department === department.code)!;
                      return (
                        <li key={w.id}>
                          <label className="ep-roles__tick" htmlFor={`w-${w.id}`}>
                            <input
                              id={`w-${w.id}`}
                              type="checkbox"
                              name="withdrawalIds"
                              value={w.id}
                            />{' '}
                            {w.studentName} · {w.admissionNo} · {w.section ?? ''}
                          </label>
                          {x.check ? (
                            <span className="ep-field__help"> — {x.check.detail}</span>
                          ) : null}
                          {x.step !== w.currentStep ? (
                            <span className="ep-field__help"> — at step {w.currentStep}</span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                <div className="ep-wd__form">
                  <label className="ep-field" htmlFor="status">
                    <span className="ep-field__label">Decision</span>
                    <select id="status" name="status" className="ep-select" defaultValue="cleared">
                      <option value="cleared">Clear</option>
                      <option value="hold">Hold</option>
                    </select>
                  </label>
                  <label className="ep-field ep-wd__wide" htmlFor="bremarks">
                    <span className="ep-field__label">Remarks</span>
                    <input id="bremarks" name="remarks" className="ep-input" maxLength={500} />
                  </label>
                  <Button type="submit">Record for the ticked students</Button>
                </div>
              </form>
            ) : (
              <p className="ep-field__help">
                Nothing is waiting for {department.name} that you may clear.
              </p>
            )
          ) : (
            <p className="ep-field__help">Set up the departments first.</p>
          )}
        </Card>
      ) : null}

      {tab === 'tc' ? (
        <Card>
          {tcReady.length ? (
            <form action={bulkWithdrawalTc}>
              <fieldset className="ep-wd__pick">
                <legend>Ready for a TC ({tcReady.length})</legend>
                <TickAll name="withdrawalIds" label="Tick all" />
                <ul className="ep-wd__picklist">
                  {tcReady.map((w) => (
                    <li key={w.id}>
                      <label className="ep-roles__tick" htmlFor={`t-${w.id}`}>
                        <input id={`t-${w.id}`} type="checkbox" name="withdrawalIds" value={w.id} />{' '}
                        {w.studentName} · {w.admissionNo} · {w.section ?? ''} · leaving{' '}
                        {w.leavingOn}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
              <div className="ep-wd__form">
                <label className="ep-field" htmlFor="issuedOn">
                  <span className="ep-field__label">Issue date (blank = each leaving date)</span>
                  <input id="issuedOn" name="issuedOn" type="date" className="ep-input" />
                </label>
                <label className="ep-field" htmlFor="conduct">
                  <span className="ep-field__label">Conduct</span>
                  <input
                    id="conduct"
                    name="conduct"
                    className="ep-input"
                    defaultValue="Good"
                    maxLength={60}
                  />
                </label>
                <label className="ep-field ep-wd__wide" htmlFor="promotionStatus">
                  <span className="ep-field__label">Promotion status</span>
                  <input
                    id="promotionStatus"
                    name="promotionStatus"
                    className="ep-input"
                    maxLength={120}
                    defaultValue="Passed Class XII"
                  />
                </label>
                <Button type="submit" disabled={!can('people.tc.issue')}>
                  Issue TCs for the ticked students
                </Button>
              </div>
              <p className="ep-field__help">
                Each TC gets its number and PDF; find them in the TC register and the export centre.
              </p>
            </form>
          ) : (
            <p className="ep-field__help">
              No withdrawal is ready for a TC yet (the fees department must clear first).
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
