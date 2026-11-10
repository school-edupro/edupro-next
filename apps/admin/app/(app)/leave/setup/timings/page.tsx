import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { TimingForm } from '@/components/leave/TimingForm';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type Timings } from '@/lib/leave';
import { retireTiming } from '@/lib/leave-actions';

const ACTION: Record<string, string> = {
  HD: 'half day',
  A: 'absent',
  leave: 'half day of a leave type',
};
type Row = Timings['rows'][number];

/**
 * Department and special timings (docs/design/85, phase C): hours over the shift — a department's every
 * day, or one employee's for some dates (a special timing wins over the department's, which wins over the
 * shift). Each is added or changed in its own dialog (the old module's layout), every box checked.
 */
export default async function TimingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  let d: Timings;
  try {
    d = await apiFetch<Timings>('/staff-attendance/timings');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const can = d.can.manage;
  const editing = can ? (d.rows.find((r) => r.id === sp.edit) ?? null) : null;
  const adding =
    can && !editing && (sp.add === 'department' || sp.add === 'special') ? sp.add : null;
  const hm = (t: string) => t.slice(0, 5);
  const rule = (over: number | null, action: string, early: boolean) =>
    over && action !== 'none'
      ? `${early ? 'Left early' : 'Late'} by more than ${String(over)} min → ${ACTION[action] ?? action}`
      : null;

  const table = (rows: Row[], kind: 'department' | 'special') => (
    <div
      className="ep-table-wrap"
      tabIndex={0}
      role="region"
      aria-label={kind === 'department' ? 'Department timings' : 'Special timings'}
    >
      <table className="ep-table ep-table--dense">
        <thead>
          <tr>
            <th scope="col">{kind === 'department' ? 'Department' : 'Employee and dates'}</th>
            <th scope="col">Working times</th>
            <th scope="col">Present / half day</th>
            <th scope="col">Late / early rule</th>
            <th scope="col">Remark</th>
            {can ? <th scope="col">Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {kind === 'department' ? (
                    <strong>{r.department}</strong>
                  ) : (
                    <>
                      <strong>{r.employee}</strong>
                      <span className="ep-mr-col__desc">
                        {dmy(r.from_date)} to {dmy(r.to_date)}
                      </span>
                    </>
                  )}
                </td>
                <td>
                  {hm(r.starts_at)} – {hm(r.ends_at)}
                  <span className="ep-mr-col__desc">grace {r.grace_minutes} min</span>
                </td>
                <td>
                  P from {Number(r.present_hours)} h · HD from {Number(r.half_day_hours)} h
                </td>
                <td>
                  {[
                    rule(r.late_over_minutes, r.late_action, false),
                    rule(r.early_over_minutes, r.early_action, true),
                  ]
                    .filter(Boolean)
                    .join('; ') || <span className="ep-field__help">No rule</span>}
                </td>
                <td>{r.note ?? ''}</td>
                {can ? (
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/leave/setup/timings?edit=${r.id}`}
                        aria-label={`Edit ${kind === 'department' ? (r.department ?? '') : (r.employee ?? '')}`}
                      >
                        Edit
                      </a>
                      <ConfirmAction
                        action={retireTiming.bind(null, r.id)}
                        fields={{ id: r.id }}
                        label="Remove"
                        title="Remove this timing?"
                        confirmLabel="Remove"
                        confirmVariant="danger"
                      >
                        {kind === 'department'
                          ? 'The department goes back to the hours of its shift'
                          : 'The employee goes back to the department’s or the shift’s hours'}{' '}
                        from the next day worked out. Days already worked out stay as they are until
                        worked out again.
                      </ConfirmAction>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={can ? 6 : 5} className="ep-field__help">
                {kind === 'department'
                  ? 'No department timing: every department works the hours of its shift.'
                  : 'No special timing.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Department and special timings' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Department and special timings"
        description="Hours over the shift: a department's own hours every day, or one employee's hours for some dates (a duty, a late bus)."
        actions={
          can ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <a className="ep-btn ep-btn--primary" href="/leave/setup/timings?add=department">
                ＋ Department timing
              </a>
              <a className="ep-btn ep-btn--secondary" href="/leave/setup/timings?add=special">
                ＋ Special timing
              </a>
            </div>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <div className="ep-alert ep-alert--info" role="note" style={{ marginBottom: 'var(--sp-4)' }}>
        <span>
          <strong>Which hours a day is measured against, in order:</strong> 1. a special timing
          covering that date → 2. a shift posted for that single date → 3. the department timing →
          4. the employee’s shift. After a change, work past days out again from the attendance
          register.
        </span>
      </div>
      <section className="ep-card" aria-labelledby="tm-dept">
        <h2 id="tm-dept" className="ep-card__title">
          Department timings
        </h2>
        {table(
          d.rows.filter((r) => r.kind === 'department'),
          'department',
        )}
      </section>
      <section
        className="ep-card"
        aria-labelledby="tm-special"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <h2 id="tm-special" className="ep-card__title">
          Special timings
        </h2>
        {table(
          d.rows.filter((r) => r.kind === 'special'),
          'special',
        )}
      </section>
      {editing ? <TimingForm key={editing.id} kind={editing.kind} row={editing} d={d} /> : null}
      {adding ? <TimingForm key={adding} kind={adding} row={null} d={d} /> : null}
    </>
  );
}
