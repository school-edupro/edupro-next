import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { LeaveOverview } from '@/lib/leave';

/**
 * Leave & attendance set-up (docs/design/85, phase A): the figures, what is missing or would misbehave,
 * the leave types at a glance, then four sections — leave rules, the calendar, shifts and timings, the
 * settings — each opening its screens (they are not in the menu).
 */
export default async function LeaveSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('leave.setup.view')) notFound();
  let o: LeaveOverview;
  try {
    o = await apiFetch<LeaveOverview>('/leave/setup/overview');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const c = o.counts;
  const balanceTypes = o.types.filter((t) => t.keepsBalance && !t.lossOfPay);
  const typesWithoutPolicy = balanceTypes.filter((t) => !t.policies).length;
  type Link = { done: boolean | null; title: string; text: string; href?: string; flag?: string };
  const sections: Array<{ id: string; title: string; text: string; links: Link[] }> = [
    {
      id: 'lv-rules',
      title: '1. Leave rules',
      text: 'The kinds of leave, how many days staff get and when, and who approves.',
      links: [
        {
          done: c.types > 0,
          title: 'Leave types',
          text: `${String(c.types)} types: paid or loss of pay, balance, half day, documents, limits, the deduction order`,
          href: '/masters/leave?tab=staff_leave_types',
        },
        {
          done: c.policies > 0 && !typesWithoutPolicy,
          title: 'Leave policies',
          text: `${String(c.policies)} policies: days a year by scope, credit months, carry forward, sandwich`,
          href: '/masters/leave?tab=staff_leave_policies',
          ...(typesWithoutPolicy
            ? {
                flag: `${String(typesWithoutPolicy)} type${typesWithoutPolicy > 1 ? 's' : ''} without one`,
              }
            : {}),
        },
        {
          done: c.leaveRules > 0 && c.regRules > 0 && !c.noApprover,
          title: 'Who approves',
          text: `${String(c.leaveRules)} leave rules (up to 7 days, 7 to 30, over 30), ${String(c.regRules)} for attendance corrections`,
          href: '/leave/setup/approvals',
          ...(c.noApprover ? { flag: `${String(c.noApprover)} staff without an approver` } : {}),
        },
      ],
    },
    {
      id: 'lv-calendar',
      title: '2. The calendar',
      text: 'Days staff are off: weekly offs (by scope) and holidays. Leave on them is not charged unless a policy’s sandwich says so.',
      links: [
        {
          done: c.weekoffs > 0,
          title: 'Weekly offs',
          text: `${String(c.weekoffs)} rules (weekdays, which weeks of the month, or dates)`,
          href: '/masters/leave?tab=staff_weekoff_rules',
        },
        {
          done: null,
          title: 'Holidays',
          text: `${String(c.holidays)} holidays ahead for staff: optional ones and which staff on the school's holiday list`,
          href: '/masters/academics?tab=holidays',
        },
      ],
    },
    {
      id: 'lv-shifts',
      title: '3. Shifts and timings',
      text: 'Working hours, for staff attendance worked out from the biometric punches.',
      links: [
        {
          done: c.shifts > 0,
          title: 'Shifts',
          text: `${String(c.shifts)} shifts: hours, grace, present and half-day hours, the late and early rule`,
          href: '/masters/leave?tab=staff_shifts',
        },
        {
          done: null,
          title: 'Shift postings',
          text: c.postings
            ? `${String(c.postings)} postings (staff without one work the default shift)`
            : 'Optional: staff without a posting work the default shift',
          href: '/masters/leave?tab=staff_shift_postings',
        },
        {
          done: null,
          title: 'Department and special timings',
          text: 'Come with staff attendance (the next phase)',
        },
      ],
    },
    {
      id: 'lv-settings',
      title: '4. Settings',
      text: 'Deductions for late marks and missing punches, loss of pay for absence, punches, devices and messages.',
      links: [
        {
          done: null,
          title: 'Settings',
          text: 'Late marks per leave, loss of pay after days, the default shift, device serials, message channels',
          href: '/leave/setup/settings',
        },
      ],
    },
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance set-up' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Leave & attendance set-up"
        description="Everything staff leave and attendance follow, in four sections. Fill them in order: the leave rules, the calendar, shifts and timings, then the settings."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Leave types" value={String(c.types)} />
        <KpiTile label="Leave policies" value={String(c.policies)} />
        <KpiTile
          label="Staff with an approver"
          value={`${String(c.staff - c.noApprover)} of ${String(c.staff)}`}
        />
        <KpiTile label="Weekly-off rules" value={String(c.weekoffs)} />
        <KpiTile label="Shifts" value={String(c.shifts)} />
        <KpiTile label="Holidays ahead" value={String(c.holidays)} />
      </div>
      {o.warnings.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>To look at</strong>
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {o.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      <div className="ep-setup-sections">
        {sections.map((x) => (
          <section key={x.id} className="ep-card" aria-labelledby={x.id}>
            <h2 id={x.id} className="ep-card__title">
              {x.title}
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {x.text}
            </p>
            <ul className="ep-setup-links">
              {x.links.map((l) => (
                <li key={l.title}>
                  {l.href ? (
                    <a href={l.href}>
                      <strong>{l.title}</strong>
                    </a>
                  ) : (
                    <strong>{l.title}</strong>
                  )}{' '}
                  {l.flag ? (
                    <Badge tone="warning">{l.flag}</Badge>
                  ) : l.done === null ? null : (
                    <Badge tone={l.done ? 'success' : 'neutral'}>{l.done ? 'Done' : 'To do'}</Badge>
                  )}
                  <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
                    {l.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <section className="ep-card" aria-labelledby="lv-types" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="lv-types" className="ep-card__title">
          Leave types at a glance
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="lv-types">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Balance</th>
                <th scope="col">Approval</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Deduction order
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Policies
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Staff in no policy
                </th>
              </tr>
            </thead>
            <tbody>
              {o.types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.code}</strong>
                    <span className="ep-mr-col__desc">{t.name}</span>
                  </td>
                  <td>{t.lossOfPay ? 'Loss of pay' : t.keepsBalance ? 'Kept' : 'Limits only'}</td>
                  <td>{t.autoApprove ? 'At once' : 'Who approves'}</td>
                  <td style={{ textAlign: 'right' }}>{t.deductOrder ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{t.policies}</td>
                  <td style={{ textAlign: 'right' }}>
                    {t.keepsBalance && !t.lossOfPay ? t.uncovered : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
