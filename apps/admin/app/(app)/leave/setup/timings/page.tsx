import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import { dmy, type Timings } from '@/lib/leave';
import { retireTiming, saveTiming } from '@/lib/leave-actions';

const ACTION: Record<string, string> = {
  none: 'only a late mark',
  HD: 'a half day',
  A: 'absent',
  leave: 'leave of the type named',
};
type Row = Timings['rows'][number];

function TimingForm({ t, d }: { t: Row | null; d: Timings }) {
  const id = t ? `tf-${t.id}` : 'tf-new';
  const f = (k: string) => `${id}-${k}`;
  const rule = (which: 'late' | 'early') => (
    <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
      <label className="ep-field" htmlFor={f(`${which}Over`)}>
        <span className="ep-field__label">
          {which === 'late' ? 'Late by more than (min)' : 'Leaves early by more than (min)'}
        </span>
        <input
          id={f(`${which}Over`)}
          name={`${which}Over`}
          type="number"
          min={1}
          max={720}
          className="ep-input"
          defaultValue={(which === 'late' ? t?.late_over_minutes : t?.early_over_minutes) ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor={f(`${which}Action`)}>
        <span className="ep-field__label">Then the day is</span>
        <select
          id={f(`${which}Action`)}
          name={`${which}Action`}
          className="ep-select"
          defaultValue={(which === 'late' ? t?.late_action : t?.early_action) ?? 'none'}
        >
          {Object.entries(ACTION).map(([v, l]) => (
            <option key={v} value={v}>
              {v === 'none' ? 'Unchanged' : l[0]!.toUpperCase() + l.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field" htmlFor={f(`${which}TypeId`)}>
        <span className="ep-field__label">Leave type (for leave)</span>
        <select
          id={f(`${which}TypeId`)}
          name={`${which}TypeId`}
          className="ep-select"
          defaultValue={(which === 'late' ? t?.late_type_id : t?.early_type_id) ?? ''}
        >
          <option value="">—</option>
          {d.types.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  return (
    <form action={saveTiming.bind(null, t?.id ?? null)} className="ep-form-section__body">
      <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
        <legend className="ep-field__label">For</legend>
        <label className="ep-check" htmlFor={f('kd')}>
          <input
            id={f('kd')}
            type="radio"
            name="kind"
            value="department"
            defaultChecked={(t?.kind ?? 'department') === 'department'}
            className="ep-check__input"
          />
          <span className="ep-check__box" />A department, every day
        </label>
        <label className="ep-check" htmlFor={f('ks')}>
          <input
            id={f('ks')}
            type="radio"
            name="kind"
            value="special"
            defaultChecked={t?.kind === 'special'}
            className="ep-check__input"
          />
          <span className="ep-check__box" />
          One employee, for some dates
        </label>
      </fieldset>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
        <label className="ep-field" htmlFor={f('dept')}>
          <span className="ep-field__label">Department (a department timing)</span>
          <select
            id={f('dept')}
            name="department"
            className="ep-select"
            defaultValue={t?.department ?? ''}
          >
            <option value="">—</option>
            {d.departments.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={f('emp')}>
          <span className="ep-field__label">Employee (a special timing)</span>
          <select
            id={f('emp')}
            name="employeeId"
            className="ep-select"
            defaultValue={t?.employee_id ?? ''}
          >
            <option value="">—</option>
            {d.employees.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={f('from')}>
          <span className="ep-field__label">From</span>
          <input
            id={f('from')}
            name="from"
            type="date"
            className="ep-input"
            defaultValue={t?.from_date ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={f('to')}>
          <span className="ep-field__label">To</span>
          <input
            id={f('to')}
            name="to"
            type="date"
            className="ep-input"
            defaultValue={t?.to_date ?? ''}
          />
        </label>
      </div>
      <div className="ep-grid__toolbar" style={{ flexWrap: 'wrap' }}>
        <label className="ep-field" htmlFor={f('starts')}>
          <span className="ep-field__label">Starts</span>
          <input
            id={f('starts')}
            name="startsAt"
            type="time"
            className="ep-input"
            required
            defaultValue={t?.starts_at ?? '08:00'}
          />
        </label>
        <label className="ep-field" htmlFor={f('ends')}>
          <span className="ep-field__label">Ends</span>
          <input
            id={f('ends')}
            name="endsAt"
            type="time"
            className="ep-input"
            required
            defaultValue={t?.ends_at ?? '14:00'}
          />
        </label>
        <label className="ep-field" htmlFor={f('grace')}>
          <span className="ep-field__label">Grace (min)</span>
          <input
            id={f('grace')}
            name="grace"
            type="number"
            min={0}
            max={240}
            className="ep-input"
            defaultValue={t?.grace_minutes ?? 5}
          />
        </label>
        <label className="ep-field" htmlFor={f('present')}>
          <span className="ep-field__label">Present from (hours)</span>
          <input
            id={f('present')}
            name="presentHours"
            type="number"
            min={0}
            max={24}
            step={0.25}
            className="ep-input"
            defaultValue={t?.present_hours ?? 6}
          />
        </label>
        <label className="ep-field" htmlFor={f('half')}>
          <span className="ep-field__label">Half day from (hours)</span>
          <input
            id={f('half')}
            name="halfDayHours"
            type="number"
            min={0}
            max={24}
            step={0.25}
            className="ep-input"
            defaultValue={t?.half_day_hours ?? 3}
          />
        </label>
      </div>
      {rule('late')}
      {rule('early')}
      <label className="ep-field" htmlFor={f('note')}>
        <span className="ep-field__label">Note</span>
        <input
          id={f('note')}
          name="note"
          className="ep-input"
          maxLength={200}
          defaultValue={t?.note ?? ''}
        />
      </label>
      <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
        {t ? 'Save the timing' : 'Add the timing'}
      </button>
    </form>
  );
}

/**
 * Department and special timings (docs/design/85, phase C): hours over the shift — a department's every day,
 * or one employee's for some dates (a special timing wins over the department's, which wins over the shift).
 * The school's earlier rule kept: grace, present and half-day hours, the late and early rule.
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
  const editing = d.rows.find((r) => r.id === sp.edit) ?? null;
  const when = (r: Row) =>
    r.kind === 'department'
      ? (r.department ?? '')
      : `${r.employee ?? ''} · ${dmy(r.from_date)} to ${dmy(r.to_date)}`;
  const rule = (over: number | null, action: string, early: boolean) =>
    over
      ? `${early ? 'early' : 'late'} over ${String(over)} min: ${ACTION[action] ?? action}`
      : null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Department and special timings' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Department and special timings"
        description="Hours over the shift. A department timing gives a department its own hours every day; a special timing gives one employee their own hours for some dates (a duty, a late bus). The special timing wins over the department's, and the department's over the shift. After a change, work the past days out again from the attendance register."
      />
      <Notice params={sp} />
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Timings">
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">For</th>
              <th scope="col">Hours</th>
              <th scope="col">Present, half day</th>
              <th scope="col">Late and early rule</th>
              {d.can.manage ? <th scope="col">Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {when(r)}
                    <span className="ep-mr-col__desc">
                      {r.kind === 'department' ? 'Department' : 'Special'}
                      {r.note ? ` · ${r.note}` : ''}
                    </span>
                  </td>
                  <td>
                    {r.starts_at} – {r.ends_at}
                    <span className="ep-mr-col__desc">grace {r.grace_minutes} min</span>
                  </td>
                  <td>
                    {Number(r.present_hours)} h, {Number(r.half_day_hours)} h
                  </td>
                  <td>
                    {[
                      rule(r.late_over_minutes, r.late_action, false),
                      rule(r.early_over_minutes, r.early_action, true),
                    ]
                      .filter(Boolean)
                      .join('; ') || 'None'}
                  </td>
                  {d.can.manage ? (
                    <td style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/leave/setup/timings?edit=${r.id}#tf-edit`}
                      >
                        Edit
                      </a>
                      <ConfirmAction
                        action={retireTiming.bind(null, r.id)}
                        fields={{ id: r.id }}
                        label="Retire"
                        title="Retire this timing?"
                        confirmLabel="Retire"
                        confirmVariant="danger"
                      >
                        The shift&apos;s hours (or the department&apos;s) apply again from the next
                        day worked out. Days already worked out stay as they are until they are
                        worked out again.
                      </ConfirmAction>
                    </td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={d.can.manage ? 5 : 4}>
                  No timings: every employee works the hours of their shift.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {d.can.manage ? (
        editing ? (
          <FoldCard
            id="tf-edit"
            title={`Edit · ${when(editing)}`}
            hint="Changes apply to the days worked out from now"
            open
          >
            <TimingForm t={editing} d={d} />
          </FoldCard>
        ) : (
          <FoldCard
            id="tf-add"
            title="Add a timing"
            hint="A department's hours, or one employee's for some dates"
            open={!d.rows.length}
          >
            <TimingForm t={null} d={d} />
          </FoldCard>
        )
      ) : null}
    </>
  );
}
