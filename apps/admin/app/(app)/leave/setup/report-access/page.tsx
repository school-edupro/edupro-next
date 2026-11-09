import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ChipPickerField } from '@/components/ChipPickerField';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import type { LeaveReportAccess } from '@/lib/leave';
import { setReportAccess } from '@/lib/leave-actions';

/**
 * Who may open the leave & attendance reports (docs/design/85, phase D), as the school's earlier MIS gave
 * them: those with the reports right (the principal, the leave office, the school admin, HR) open every
 * report; here a report is given to named staff besides (an HOD the daily report, an accountant the
 * monthly summary).
 */
export default async function ReportAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  let d: LeaveReportAccess;
  try {
    d = await apiFetch<LeaveReportAccess>('/leave-reports/access');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const options = d.people.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` }));
  const groups = [...new Set(d.reports.map((r) => r.group))];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Who may open the reports' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Who may open the reports"
        description="The principal, the leave office, the school admin and HR open every report. Give a report to other staff here: they find it under Leave & attendance reports (My leave → Reports)."
      />
      <Notice params={sp} />
      {groups.map((g) => (
        <section
          key={g}
          className="ep-card"
          aria-labelledby={`ra-${g}`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <h2 id={`ra-${g}`} className="ep-card__title">
            {g}
          </h2>
          {d.reports
            .filter((r) => r.group === g)
            .map((r) => (
              <div key={r.code} id={`r-${r.code}`} style={{ marginBottom: 'var(--sp-3)' }}>
                {d.manage ? (
                  <form
                    action={setReportAccess.bind(null, r.code)}
                    className="ep-grid__toolbar"
                    style={{ alignItems: 'flex-end' }}
                  >
                    <div style={{ flex: '1 1 24rem' }}>
                      <ChipPickerField
                        name="people"
                        label={r.name}
                        options={options}
                        initial={r.people.map((p) => p.id)}
                        help={r.people.length ? undefined : 'Only those with the reports right'}
                      />
                    </div>
                    <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                      Save
                    </button>
                  </form>
                ) : (
                  <p>
                    <strong>{r.name}</strong>:{' '}
                    {r.people.map((p) => p.name).join(', ') || 'only those with the reports right'}
                  </p>
                )}
              </div>
            ))}
        </section>
      ))}
    </>
  );
}
