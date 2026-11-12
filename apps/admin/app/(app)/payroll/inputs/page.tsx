import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { AttendanceTab } from '@/components/payroll/inputs/AttendanceTab';
import {
  AdhocTab,
  ClaimsTab,
  HoldTab,
  LoansTab,
  OvertimeTab,
  RecurringTab,
  TaxTab,
} from '@/components/payroll/inputs/OtherTabs';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { monthName, monthParam, type StaffOption } from '@/lib/payroll-inputs';

const TABS = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'hold', label: 'Salary hold' },
  { id: 'loans', label: 'Loans' },
  { id: 'adhoc', label: 'One-off items' },
  { id: 'recurring', label: 'Recurring' },
  { id: 'claims', label: 'Claims' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'tax', label: 'Typed tax' },
] as const;

/**
 * Monthly inputs (legacy Monthly Inputs, docs/design/86 phase B): what a month's pay run reads besides the
 * set-up — attendance pulled from the register and finalised, salary hold, loans, one-off items and fee
 * recovery, recurring deductions, claims, overtime and a typed month's tax.
 */
export default async function PayrollInputsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const month = monthParam(sp.month);
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? 'attendance';
  let staff: StaffOption[];
  try {
    staff = (await apiFetch<{ rows: StaffOption[] }>(`/payroll/inputs/staff?month=${month}`)).rows;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Monthly inputs' }]} />
      <PageHeader
        kicker="Payroll"
        title={`Monthly inputs — ${monthName(month)}`}
        description="What the month’s pay run reads besides the set-up: the attendance, salary holds, loans, one-off items, recurring deductions, claims, overtime and any tax typed by hand. A maker prepares them; a checker finalises."
      />
      <Notice params={sp} />
      <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <input type="hidden" name="tab" value={tab} />
        <label className="ep-field" htmlFor="in-month">
          <span className="ep-field__label">Month</span>
          <input
            id="in-month"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={month}
            required
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--ghost">
          Show
        </button>
      </form>
      <nav className="ep-tabs" aria-label="Monthly inputs">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/inputs?month=${month}&tab=${t.id}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'attendance' ? <AttendanceTab month={month} sp={sp} /> : null}
      {tab === 'hold' ? <HoldTab month={month} staff={staff} /> : null}
      {tab === 'loans' ? <LoansTab month={month} staff={staff} sp={sp} /> : null}
      {tab === 'adhoc' ? <AdhocTab month={month} staff={staff} /> : null}
      {tab === 'recurring' ? <RecurringTab month={month} staff={staff} sp={sp} /> : null}
      {tab === 'claims' ? <ClaimsTab month={month} staff={staff} sp={sp} /> : null}
      {tab === 'overtime' ? <OvertimeTab month={month} staff={staff} /> : null}
      {tab === 'tax' ? <TaxTab month={month} staff={staff} /> : null}
    </>
  );
}
