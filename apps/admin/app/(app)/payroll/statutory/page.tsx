import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import {
  CalendarTab,
  EsiTab,
  LwfTab,
  PfTab,
  PtTab,
  VoucherTab,
} from '@/components/payroll/statutory/StatTabs';
import { ApiError, getMe } from '@/lib/api';
import { monthName } from '@/lib/payroll-inputs';

const TABS = [
  { id: 'pf', label: 'PF and ECR' },
  { id: 'esi', label: 'ESI' },
  { id: 'pt', label: 'Profession tax' },
  { id: 'lwf', label: 'LWF' },
  { id: 'voucher', label: 'Salary voucher' },
  { id: 'calendar', label: 'Compliance calendar' },
] as const;

/** last month (IST): the month whose returns are due now */
function lastMonth() {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  return m === 1 ? `${String(y - 1)}-12` : `${String(y)}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * Statutory and accounts (docs/design/86, phase C): a month's PF (the ECR, filed and next), ESI (the ESIC upload),
 * profession tax, LWF and the salary voucher, and the year's compliance calendar. Payroll staff read; a checker
 * downloads the files and records what was filed or paid.
 */
export default async function PayrollStatutoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const tab = TABS.find((t) => t.id === sp.tab)?.id ?? 'pf';
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? '') ? sp.month! : lastMonth();
  const fyNow =
    Number(month.slice(5, 7)) >= 4 ? Number(month.slice(0, 4)) : Number(month.slice(0, 4)) - 1;
  const fy = /^\d{4}$/.test(sp.fy ?? '') ? Number(sp.fy) : fyNow;
  const fyLabel = (y: number) => `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`;
  let body: ReactNode;
  try {
    body =
      tab === 'pf'
        ? await PfTab({ month })
        : tab === 'esi'
          ? await EsiTab({ month })
          : tab === 'pt'
            ? await PtTab({ month })
            : tab === 'lwf'
              ? await LwfTab({ month })
              : tab === 'voucher'
                ? await VoucherTab({ month })
                : await CalendarTab({ fy });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Statutory and accounts' }]} />
      <PageHeader
        kicker="Payroll"
        title={
          tab === 'calendar'
            ? `Compliance calendar — ${fyLabel(fy)}`
            : `Statutory and accounts — ${monthName(month)}`
        }
        description="The month’s PF, ESI, profession tax and LWF from its locked runs, the files the portals take, the salary voucher, and the year’s statutory dues."
      />
      <Notice params={sp} />
      <form method="get" className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
        <input type="hidden" name="tab" value={tab} />
        {tab === 'calendar' ? (
          <label className="ep-field" htmlFor="st-fy">
            <span className="ep-field__label">Financial year</span>
            <select id="st-fy" name="fy" className="ep-input" defaultValue={String(fy)}>
              {[fyNow - 1, fyNow, fyNow + 1].map((y) => (
                <option key={y} value={String(y)}>
                  {fyLabel(y)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="ep-field" htmlFor="st-month">
            <span className="ep-field__label">Month</span>
            <input
              id="st-month"
              name="month"
              type="month"
              className="ep-input"
              defaultValue={month}
              required
            />
          </label>
        )}
        <button type="submit" className="ep-btn ep-btn--ghost">
          Show
        </button>
      </form>
      <nav className="ep-tabs" aria-label="Statutory and accounts">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/statutory?month=${month}&tab=${t.id}${t.id === 'calendar' ? `&fy=${String(fy)}` : ''}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      {body}
    </>
  );
}
