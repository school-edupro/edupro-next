import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { PayrollOverview } from '@/lib/payroll';

/**
 * Payroll set-up (docs/design/86, phase A): the figures, what is missing or would stop a run, then the
 * sections in the order the legacy set-up journey takes them — the rules and rates, pay heads and the matrix,
 * the staff (profiles and structures), and the drafts waiting for a checker. Its screens are not in the menu.
 */
export default async function PayrollSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let o: PayrollOverview;
  try {
    o = await apiFetch<PayrollOverview>('/payroll/setup');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const f = o.figures;
  const waiting = f.drafts.rates + f.drafts.statutory + f.drafts.versions + f.drafts.structures;
  type Link = { done: boolean | null; title: string; text: string; href: string; flag?: string };
  const sections: Array<{ id: string; title: string; text: string; links: Link[] }> = [
    {
      id: 'pr-rules',
      title: '1. Rules and rates',
      text: 'The school’s payroll identity and every rate the calculation reads, each dated: a change is a new dated row a checker approves.',
      links: [
        {
          done: !!(o.settings.stateCode && o.settings.tan && o.settings.pfEstablishmentCode),
          title: 'Settings',
          text: 'State, PF establishment code, TAN, PTRC, ESI code, payslip password, bank file, confidential staff, formula attributes',
          href: '/payroll/setup/settings',
        },
        {
          done: null,
          title: 'Rates and statutory rules',
          text: 'DA, HRA and other rates; PF, ESI, profession tax by state, labour welfare fund, overtime rates',
          href: '/payroll/setup/rates',
          ...(f.drafts.rates + f.drafts.statutory
            ? { flag: `${String(f.drafts.rates + f.drafts.statutory)} draft(s)` }
            : {}),
        },
        {
          done: !o.checks.some((c) => c.href === '/payroll/setup/tax'),
          title: 'Income tax',
          text: `Slabs, rebate, surcharge and the printed labels by financial year (${o.fy} now; Form 130 / 138 from 2026-27)`,
          href: '/payroll/setup/tax',
        },
      ],
    },
    {
      id: 'pr-heads',
      title: '2. Pay heads and the pay matrix',
      text: 'One head for each payslip line, its formula in dated versions tested before they go live; the matrix of basic pay by level and cell.',
      links: [
        {
          done: f.heads > 0 && !f.headsUnversioned,
          title: 'Pay heads',
          text: `${String(f.heads)} active heads: earnings and deductions, formulas, statutory flags, rounding`,
          href: '/payroll/setup/heads',
          ...(f.headsUnversioned
            ? { flag: `${String(f.headsUnversioned)} without a version in force` }
            : f.drafts.versions
              ? { flag: `${String(f.drafts.versions)} draft version(s)` }
              : {}),
        },
        {
          done: f.matrixCells > 0,
          title: 'Pay matrix',
          text: `${String(f.matrixCells)} cells of basic pay by level and cell`,
          href: '/payroll/setup/matrix',
        },
      ],
    },
    {
      id: 'pr-staff',
      title: '3. Staff',
      text: 'Each employee’s payroll profile (statutory switches, regime, level and cell, pay mode) and salary structure (the amount of each head from a date).',
      links: [
        {
          done: f.staff > 0 && f.profiles >= f.staff,
          title: 'Payroll profiles',
          text: `${String(f.profiles)} of ${String(f.staff)} active staff have one`,
          href: '/payroll/setup/profiles',
          ...(f.staff > f.profiles ? { flag: `${String(f.staff - f.profiles)} missing` } : {}),
        },
        {
          done: f.staff > 0 && f.structured >= f.staff,
          title: 'Salary structures',
          text: `${String(f.structured)} of ${String(f.staff)} active staff have a structure in force; templates and the Excel sheet`,
          href: '/payroll/setup/structures',
          ...(f.drafts.structures
            ? { flag: `${String(f.drafts.structures)} staff with drafts` }
            : {}),
        },
      ],
    },
    {
      id: 'pr-approve',
      title: '4. Drafts to approve',
      text: 'Everything above is made as a draft and goes live when a checker who did not make it approves it.',
      links: [
        {
          done: waiting === 0,
          title: 'Drafts to approve',
          text: waiting
            ? `${String(waiting)} waiting: rates and statutory rules, pay-head versions, salary structures`
            : 'Nothing waits',
          href: '/payroll/setup/approvals',
        },
      ],
    },
  ];
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'Payroll set-up' }]} />
      <PageHeader
        kicker="Payroll"
        title="Payroll set-up"
        description="Everything the monthly pay run reads. Fill it in order: rules and rates, pay heads and the matrix, then each employee’s profile and salary structure."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Active staff" value={String(f.staff)} />
        <KpiTile label="With a profile" value={`${String(f.profiles)} of ${String(f.staff)}`} />
        <KpiTile label="With a structure" value={`${String(f.structured)} of ${String(f.staff)}`} />
        <KpiTile label="Pay heads" value={String(f.heads)} />
        <KpiTile label="Matrix cells" value={String(f.matrixCells)} />
        <KpiTile label="Drafts waiting" value={String(waiting)} />
      </div>
      {o.checks.length ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>To look at</strong>
            <ul style={{ margin: 'var(--sp-2) 0 0' }}>
              {o.checks.map((c) => (
                <li key={c.text}>
                  <Badge tone={c.level === 'red' ? 'danger' : 'warning'}>
                    {c.level === 'red' ? 'Stops a run' : 'Check'}
                  </Badge>{' '}
                  <a href={c.href}>{c.text}</a>
                </li>
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
                  <a href={l.href}>
                    <strong>{l.title}</strong>
                  </a>{' '}
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
    </>
  );
}
