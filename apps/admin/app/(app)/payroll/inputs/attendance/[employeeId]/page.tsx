import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy } from '@/lib/payroll';
import { monthName, monthParam, SOURCE, type AttendanceExplain } from '@/lib/payroll-inputs';
import { saveAttendance } from '@/lib/payroll-inputs-actions';

const KIND: Record<string, string> = {
  P: 'Present',
  HD: 'Half day',
  A: 'Absent',
  WO: 'Weekly off',
  H: 'Holiday',
  LV: 'On leave',
  HOLD: 'Salary hold',
};
const LOP: Record<string, string> = {
  absent: 'Absent',
  halfDay: 'Half days',
  lossOfPayLeave: 'Loss-of-pay leave',
  partPayLeave: 'Unpaid share of part-pay leave',
  hold: 'Salary-hold days',
  unmarked: 'Unmarked days counted absent',
};

/** One employee's month for payroll (legacy Explain): how the days were worked out, and a correction by hand. */
export default async function PayrollAttendanceExplainPage({
  params,
  searchParams,
}: {
  params: Promise<{ employeeId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { employeeId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(employeeId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const month = monthParam(sp.month);
  let d: AttendanceExplain;
  try {
    d = await apiFetch<AttendanceExplain>(
      `/payroll/inputs/attendance/${employeeId}?month=${month}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const a = d.attendance;
  const e = d.employee;
  const det = a?.detail ?? {};
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Monthly inputs', href: `/payroll/inputs?month=${month}&tab=attendance` },
          { label: `${e.code} · ${monthName(month)}` },
        ]}
      />
      <PageHeader
        kicker={`Attendance for payroll · ${monthName(month)}`}
        title={`${e.name} (${e.code})`}
        description={[
          e.designation,
          e.department,
          e.joinedOn ? `joined ${dmy(e.joinedOn)}` : null,
          e.leftOn ? `left ${dmy(e.leftOn)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Notice params={sp} />
      {d.hold ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>
              {d.hold.mode === 'SKIP' ? 'Skipped this month' : 'Salary held this month'}:
            </strong>{' '}
            {d.hold.reason}
          </div>
        </div>
      ) : null}
      {a ? (
        <>
          <div className="ep-dash-kpis">
            <KpiTile label="Days" value={a.monthDays} />
            <KpiTile label="Present" value={a.presentDays} />
            <KpiTile label="Paid leave" value={a.paidLeaveDays} />
            <KpiTile label="Loss of pay" value={a.lopDays} />
            <KpiTile
              label="Not employed"
              value={String(Number(a.preJoinDays) + Number(a.postLeaveDays))}
            />
            <KpiTile label="Paid days" value={a.paidDays} />
          </div>
          <section className="ep-card" aria-labelledby="ae-how">
            <h2 id="ae-how" className="ep-card__title">
              How it was worked out
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {SOURCE[a.source]} · {a.windowFrom} to {a.windowTo}
              {a.updatedByName ? ` · last by ${a.updatedByName}` : ''}
              {a.finalised
                ? ` · finalised${a.finalisedByName ? ` by ${a.finalisedByName}` : ''}`
                : ''}
              {a.reason ? ` · “${a.reason}”` : ''}
            </p>
            {det.warnings?.length ? (
              <ul>
                {det.warnings.map((w) => (
                  <li key={w}>
                    <Badge tone="warning">To look at</Badge> {w}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="ep-profile__grid">
              {det.counts ? (
                <div>
                  <strong>Days in the register</strong>
                  <ul className="ep-field__help" style={{ margin: 0 }}>
                    {Object.entries(det.counts)
                      .filter(([, v]) => Number(v) > 0)
                      .map(([k, v]) => (
                        <li key={k}>
                          {KIND[k] ?? k}: {v}
                        </li>
                      ))}
                    {a.unmarkedDays ? (
                      <li>
                        Nothing marked: {a.unmarkedDays} (counted {det.unmarkedAs ?? 'present'})
                      </li>
                    ) : null}
                    {det.futureDays ? <li>Still to come: {det.futureDays}</li> : null}
                  </ul>
                </div>
              ) : null}
              {det.leave && Object.keys(det.leave).length ? (
                <div>
                  <strong>Leave by type</strong>
                  <ul className="ep-field__help" style={{ margin: 0 }}>
                    {Object.entries(det.leave).map(([k, v]) => (
                      <li key={k}>
                        {k}: {v.days} day(s){Number(v.lop) ? ` — ${v.lop} unpaid` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {det.lop ? (
                <div>
                  <strong>Loss of pay</strong>
                  <ul className="ep-field__help" style={{ margin: 0 }}>
                    {Object.entries(det.lop)
                      .filter(([, v]) => Number(v) > 0)
                      .map(([k, v]) => (
                        <li key={k}>
                          {LOP[k] ?? k}: {v}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <strong>Overtime</strong>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  {a.otHours} hour(s){det.otRegister ? ` (the register: ${det.otRegister})` : ''}
                  {det.otTyped ? ', typed by hand' : ''}
                </p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="ep-alert ep-alert--info" role="status">
          <div>Not pulled yet for {monthName(month)}: pull the month, or type it below.</div>
        </div>
      )}
      {d.can.manage && !a?.finalised ? (
        <FoldCard
          id="ae-edit"
          title="Correct by hand"
          hint="Loss of pay, paid leave, present days, overtime — with a reason"
          open={!a}
        >
          <form action={saveAttendance.bind(null, e.id, month)} className="ep-form-section__body">
            <div className="ep-profile__grid">
              <label className="ep-field" htmlFor="ae-lop">
                <span className="ep-field__label">Loss of pay days</span>
                <input
                  id="ae-lop"
                  name="lopDays"
                  className="ep-input"
                  required
                  inputMode="decimal"
                  defaultValue={a?.lopDays ?? '0'}
                />
              </label>
              <label className="ep-field" htmlFor="ae-pl">
                <span className="ep-field__label">Paid leave days</span>
                <input
                  id="ae-pl"
                  name="paidLeaveDays"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={a?.paidLeaveDays ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ae-pr">
                <span className="ep-field__label">Present days</span>
                <input id="ae-pr" name="presentDays" className="ep-input" inputMode="decimal" />
                <span className="ep-field__help">Empty: worked out</span>
              </label>
              <label className="ep-field" htmlFor="ae-ot">
                <span className="ep-field__label">OT hours</span>
                <input
                  id="ae-ot"
                  name="otHours"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={a?.otHours ?? ''}
                />
              </label>
            </div>
            <label className="ep-field" htmlFor="ae-why">
              <span className="ep-field__label">Reason</span>
              <input
                id="ae-why"
                name="reason"
                className="ep-input"
                required
                minLength={3}
                maxLength={200}
              />
            </label>
            <p className="ep-field__help">
              Paid days = the month’s days − loss of pay − days before joining and after leaving.
            </p>
            <p>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save
              </button>
            </p>
          </form>
        </FoldCard>
      ) : null}
    </>
  );
}
