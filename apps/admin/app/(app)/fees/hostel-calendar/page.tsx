import { Card, PageHeader } from '@edupro/ui';
import { Fragment } from 'react';
import { FeeSetupNav } from '@/components/fees/FeeSetupNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { saveHostelCalendar } from '@/lib/fee-setup-actions';

interface HostelCalendar {
  mode: 'school' | 'own';
  payPlan: string | null;
  lateMode: 'slab' | 'daywise' | 'none';
  latePerDay: string | null;
  lateMax: string | null;
  hostellers: number;
  periods: Array<{
    periodId: string;
    sequence: number;
    name: string;
    schoolDueOn: string;
    dueOn: string | null;
    lateFeeAmount: string | null;
    latePerDay: string | null;
    slabs: Array<{ on: string; amount: string }>;
  }>;
}
const dmy = (v: string) => v.split('-').reverse().join('-');

/**
 * Fee setup -> Hostel calendar: hostel instalments follow the school's dates, or the hostel has its own
 * pay plan (for example quarterly), last dates and late fee. Unpaid hostel bills take a change at once.
 */
export default async function HostelCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [cal, me] = await Promise.all([apiFetch<HostelCalendar>('/fees/hostel-calendar'), getMe()]);
  const can = me.permissions.includes('fees.master.manage');
  const cell = { padding: 'var(--sp-1)' } as const;
  const box = (
    name: string,
    value: string | null | undefined,
    type: 'date' | 'number',
    label: string,
  ) => (
    <input
      className="ep-input"
      name={name}
      type={type}
      min={type === 'number' ? 0 : undefined}
      step={type === 'number' ? '0.01' : undefined}
      defaultValue={value ?? ''}
      aria-label={label}
      disabled={!can}
      style={{ minWidth: type === 'date' ? '9.5rem' : '6rem' }}
    />
  );
  return (
    <>
      <PageHeader
        kicker="Fees · Setup"
        title="Hostel calendar"
        description="Hostel fee is billed and receipted on its own ledger. Here it follows the school's last dates and late fee, or gets its own: how often it is paid, its last dates and its late fee."
      />
      <FeeSetupNav current="/fees/hostel-calendar" />
      <Notice params={sp} />
      <form action={saveHostelCalendar}>
        <Card title="How hostel fee falls due">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Hostel calendar</legend>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="mode"
                value="school"
                defaultChecked={cal.mode === 'school'}
                disabled={!can}
              />{' '}
              Same as school: hostel instalments use the class calendar’s dates and late fee
            </label>
            <label style={{ display: 'block' }}>
              <input
                type="radio"
                name="mode"
                value="own"
                defaultChecked={cal.mode === 'own'}
                disabled={!can}
              />{' '}
              Own hostel calendar: the plan, dates and late fee below
            </label>
          </fieldset>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))',
              marginTop: 'var(--sp-3)',
            }}
          >
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Hostel pay plan</span>
              <select
                className="ep-select"
                name="payPlan"
                defaultValue={cal.payPlan ?? ''}
                disabled={!can}
              >
                <option value="">As each pupil’s school pay plan</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half_yearly">Half-yearly</option>
                <option value="yearly">Yearly</option>
              </select>
              <span className="ep-field__help">
                A pupil can be given an own hostel plan through a fee change (approval).
              </span>
            </label>
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Hostel late fee</span>
              <select
                className="ep-select"
                name="lateMode"
                defaultValue={cal.lateMode}
                disabled={!can}
              >
                <option value="slab">By slabs (dates and amounts below)</option>
                <option value="daywise">Per day after the last date</option>
                <option value="none">No late fee on hostel</option>
              </select>
            </label>
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Per day (₹)</span>
              <input
                className="ep-input"
                name="latePerDay"
                type="number"
                min={0}
                step="0.01"
                defaultValue={cal.latePerDay ?? ''}
                disabled={!can}
              />
            </label>
            <label className="ep-field" style={{ margin: 0 }}>
              <span className="ep-field__label">Most per instalment (₹)</span>
              <input
                className="ep-input"
                name="lateMax"
                type="number"
                min={0}
                step="0.01"
                defaultValue={Number(cal.lateMax ?? 0) > 0 ? (cal.lateMax ?? '') : ''}
                disabled={!can}
              />
              <span className="ep-field__help">Per day only. Empty or 0 = no limit.</span>
            </label>
          </div>
          <p className="ep-field__help">
            {cal.hostellers} hosteller(s) this session. The months of one hostel instalment are due
            on the last date of its first month. Late fee runs only on the hostel balance; part
            payments are taken.
          </p>
        </Card>
        <Card title="Hostel months" style={{ marginTop: 'var(--sp-4)' }}>
          <p className="ep-field__help">
            Used only with the own hostel calendar. An empty last date takes the month’s own date.
            Slabs: after “Last date 1” the late fee becomes “Late fee 1”, and so on.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Hostel months">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Hostel months</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">School date</th>
                  <th scope="col">Hostel last date</th>
                  <th scope="col">Late fee (₹)</th>
                  <th scope="col">Last date 1</th>
                  <th scope="col">Late fee 1</th>
                  <th scope="col">Last date 2</th>
                  <th scope="col">Late fee 2</th>
                  <th scope="col">Last date 3</th>
                  <th scope="col">Late fee 3</th>
                  <th scope="col">Per day (₹)</th>
                </tr>
              </thead>
              <tbody>
                {cal.periods.map((p) => (
                  <tr key={p.periodId}>
                    <th scope="row">
                      {p.name}
                      <input type="hidden" name="periodIds" value={p.periodId} />
                    </th>
                    <td>{dmy(p.schoolDueOn)}</td>
                    <td style={cell}>
                      {box(`dueOn:${p.periodId}`, p.dueOn, 'date', `Hostel last date, ${p.name}`)}
                    </td>
                    <td style={cell}>
                      {box(
                        `lateFee:${p.periodId}`,
                        p.lateFeeAmount,
                        'number',
                        `Late fee, ${p.name}`,
                      )}
                    </td>
                    {[1, 2, 3].map((i) => (
                      <Fragment key={i}>
                        <td style={cell}>
                          {box(
                            `slabOn${i}:${p.periodId}`,
                            p.slabs[i - 1]?.on,
                            'date',
                            `Last date ${i}, ${p.name}`,
                          )}
                        </td>
                        <td style={cell}>
                          {box(
                            `slabAmt${i}:${p.periodId}`,
                            p.slabs[i - 1]?.amount,
                            'number',
                            `Late fee ${i}, ${p.name}`,
                          )}
                        </td>
                      </Fragment>
                    ))}
                    <td style={cell}>
                      {box(`perDay:${p.periodId}`, p.latePerDay, 'number', `Per day, ${p.name}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can ? (
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save the hostel calendar
              </button>{' '}
              <span className="ep-field__help">
                Unpaid hostel bills move to the new dates at once.
              </span>
            </p>
          ) : null}
        </Card>
      </form>
    </>
  );
}
