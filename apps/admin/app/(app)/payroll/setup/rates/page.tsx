import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  dmy,
  money,
  MONTHS,
  pct,
  STATUS_TONE,
  type ConfigKind,
  type ConfigList,
  type ConfigRow,
} from '@/lib/payroll';
import {
  addPayrollConfig,
  approvePayrollConfig,
  deletePayrollConfig,
  endPayrollConfig,
} from '@/lib/payroll-actions';

const TABS: Array<{ id: ConfigKind; label: string; text: string }> = [
  {
    id: 'rates',
    label: 'Rates',
    text: 'DA, HRA and any rate a formula names (DA_RATE …), each from a date.',
  },
  {
    id: 'pf',
    label: 'PF',
    text: 'Provident fund: the shares, the pension and EDLI ceilings, admin charges.',
  },
  {
    id: 'esi',
    label: 'ESI',
    text: 'ESI shares and the wage limit (and the limit for persons with disability).',
  },
  {
    id: 'pt',
    label: 'Profession tax',
    text: 'Monthly slabs by state and gender; a month may differ (February in Maharashtra).',
  },
  {
    id: 'lwf',
    label: 'LWF',
    text: 'Labour welfare fund by state: a rate with a cap, or flat amounts, monthly or in named months.',
  },
  {
    id: 'ot',
    label: 'Overtime rates',
    text: 'A daily and an hourly amount by employee type, for overtime paid at the school’s rate.',
  },
];
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** The columns of each kind's table (besides the dates, status and people). */
const COLUMNS: Record<ConfigKind, Array<{ label: string; cell: (r: ConfigRow) => ReactNode }>> = {
  rates: [
    { label: 'Code', cell: (r) => <code>{s(r.rateCode)}</code> },
    {
      label: 'Value',
      // a rate (DA_RATE …) also as a per cent; an amount as it is
      cell: (r) =>
        `${Number(r.rateValue).toLocaleString('en-IN', { maximumFractionDigits: 6 })}${/RATE$/.test(s(r.rateCode)) ? ` (${pct(r.rateValue as string)})` : ''}`,
    },
    { label: 'Source', cell: (r) => (r.source === 'govt' ? 'Government' : 'School') },
    { label: 'Notified', cell: (r) => dmy(r.notifiedOn as string | null) },
  ],
  pf: [
    { label: 'Employee', cell: (r) => pct(r.eeRate as string) },
    { label: 'Employer', cell: (r) => pct(r.erRate as string) },
    {
      label: 'EPS',
      cell: (r) => `${pct(r.epsRate as string)} up to ₹${money(r.epsWageCeiling as string)}`,
    },
    {
      label: 'EDLI',
      cell: (r) =>
        `${pct(r.edliRate as string)} up to ₹${money(r.edliWageCeiling as string)} (at least ₹${money(r.edliMin as string)})`,
    },
    {
      label: 'Admin',
      cell: (r) => `${pct(r.adminRate as string)} (at least ₹${money(r.adminMin as string)})`,
    },
  ],
  esi: [
    { label: 'Employee', cell: (r) => pct(r.eeRate as string) },
    { label: 'Employer', cell: (r) => pct(r.erRate as string) },
    { label: 'Wage limit', cell: (r) => `₹${money(r.wageLimit as string)}` },
    { label: 'Disability', cell: (r) => `₹${money(r.wageLimitPwd as string)}` },
  ],
  pt: [
    { label: 'State', cell: (r) => s(r.stateCode) },
    {
      label: 'Gender',
      cell: (r) => ({ M: 'Men', F: 'Women', ANY: 'Any' })[s(r.gender) as 'M'] ?? s(r.gender),
    },
    {
      label: 'Monthly wage',
      cell: (r) =>
        `₹${money(r.wageFrom as string)} – ${r.wageTo ? `₹${money(r.wageTo as string)}` : 'and above'}`,
    },
    { label: 'Tax a month', cell: (r) => `₹${money(r.monthlyAmount as string)}` },
    {
      label: 'A month differs',
      cell: (r) =>
        Object.entries((r.monthOverrides as Record<string, string> | null) ?? {})
          .map(([m, a]) => `${MONTHS[Number(m) - 1] ?? m} ₹${money(a)}`)
          .join(', '),
    },
  ],
  lwf: [
    { label: 'State', cell: (r) => s(r.stateCode) },
    {
      label: 'Employee',
      cell: (r) =>
        r.eeFlat
          ? `₹${money(r.eeFlat as string)}`
          : `${pct(r.eeRate as string)}${r.eeCap ? ` up to ₹${money(r.eeCap as string)}` : ''}`,
    },
    {
      label: 'Employer',
      cell: (r) =>
        r.erFlat
          ? `₹${money(r.erFlat as string)}`
          : r.erMultiplier
            ? `${s(r.erMultiplier)} × the employee`
            : '',
    },
    {
      label: 'When',
      cell: (r) =>
        r.frequency === 'monthly'
          ? 'Monthly'
          : `In ${((r.months as number[] | null) ?? []).map((m) => MONTHS[m - 1]).join(' and ')}`,
    },
  ],
  ot: [
    { label: 'Employee type', cell: (r) => s(r.employeeType) },
    { label: 'A day', cell: (r) => `₹${money(r.dailyAmount as string)}` },
    { label: 'An hour', cell: (r) => `₹${money(r.hourlyAmount as string)}` },
  ],
};

/** The draft form's own fields for each kind (rates are typed in per cent). */
function draftFields(kind: ConfigKind, last: ConfigRow | undefined) {
  const n = (
    name: string,
    label: string,
    opts: { pct?: boolean; req?: boolean; step?: string; help?: string; dflt?: string } = {},
  ) => (
    <label className="ep-field" htmlFor={`pr-${kind}-${name}`} key={name}>
      <span className="ep-field__label">
        {label}
        {opts.pct ? ' (%)' : ''}
      </span>
      <input
        id={`pr-${kind}-${name}`}
        name={name}
        className="ep-input"
        inputMode="decimal"
        required={opts.req ?? true}
        defaultValue={
          opts.dflt ??
          (last?.[name] !== undefined && last[name] !== null
            ? opts.pct
              ? String(Number(last[name]) * 100)
              : String(last[name])
            : '')
        }
      />
      {opts.help ? <span className="ep-field__help">{opts.help}</span> : null}
    </label>
  );
  const t = (
    name: string,
    label: string,
    opts: { req?: boolean; help?: string; max?: number } = {},
  ) => (
    <label className="ep-field" htmlFor={`pr-${kind}-${name}`} key={name}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`pr-${kind}-${name}`}
        name={name}
        className="ep-input"
        required={opts.req ?? true}
        maxLength={opts.max ?? 100}
      />
      {opts.help ? <span className="ep-field__help">{opts.help}</span> : null}
    </label>
  );
  switch (kind) {
    case 'rates':
      return [
        t('rateCode', 'Code', {
          help: 'Capital letters, digits and _: the name a formula uses (DA_RATE)',
          max: 30,
        }),
        n('rateValue', 'Value', {
          help: 'A rate as a decimal (0.62 for 62 %) or an amount',
          dflt: '',
        }),
        <label className="ep-field" htmlFor="pr-rates-source" key="source">
          <span className="ep-field__label">Source</span>
          <select id="pr-rates-source" name="source" className="ep-select" defaultValue="govt">
            <option value="govt">Government notification</option>
            <option value="school">The school’s own</option>
          </select>
        </label>,
        <label className="ep-field" htmlFor="pr-rates-notified" key="notified">
          <span className="ep-field__label">Notified on</span>
          <input id="pr-rates-notified" name="notifiedOn" type="date" className="ep-input" />
          <span className="ep-field__help">
            When it was announced (a later date than “from” means arrears)
          </span>
        </label>,
      ];
    case 'pf':
      return [
        n('eeRate', 'Employee share', { pct: true }),
        n('erRate', 'Employer share', { pct: true }),
        n('epsRate', 'Pension (EPS)', { pct: true }),
        n('epsWageCeiling', 'EPS wage ceiling (₹)'),
        n('edliRate', 'EDLI', { pct: true }),
        n('edliWageCeiling', 'EDLI wage ceiling (₹)'),
        n('edliMin', 'EDLI at least (₹ a month)'),
        n('adminRate', 'Admin charges', { pct: true }),
        n('adminMin', 'Admin at least (₹ a month)'),
      ];
    case 'esi':
      return [
        n('eeRate', 'Employee share', { pct: true }),
        n('erRate', 'Employer share', { pct: true }),
        n('wageLimit', 'Wage limit (₹ a month)'),
        n('wageLimitPwd', 'Limit for persons with disability (₹)'),
      ];
    case 'pt':
      return [
        t('stateCode', 'State (two letters)', { max: 2 }),
        <label className="ep-field" htmlFor="pr-pt-gender" key="gender">
          <span className="ep-field__label">Gender</span>
          <select id="pr-pt-gender" name="gender" className="ep-select" defaultValue="ANY">
            <option value="ANY">Any</option>
            <option value="M">Men</option>
            <option value="F">Women</option>
          </select>
        </label>,
        n('wageFrom', 'Monthly wage from (₹)', { dflt: '' }),
        n('wageTo', 'up to (₹)', { req: false, help: 'Empty: and above', dflt: '' }),
        n('monthlyAmount', 'Tax a month (₹)', { dflt: '' }),
        <label className="ep-field" htmlFor="pr-pt-om" key="om">
          <span className="ep-field__label">One month differs</span>
          <select id="pr-pt-om" name="overrideMonth" className="ep-select" defaultValue="">
            <option value="">No</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={String(i + 1)}>
                {m}
              </option>
            ))}
          </select>
        </label>,
        n('overrideAmount', 'Tax in that month (₹)', { req: false, dflt: '' }),
      ];
    case 'lwf':
      return [
        t('stateCode', 'State (two letters)', { max: 2 }),
        n('eeRate', 'Employee rate', { pct: true, req: false, dflt: '' }),
        n('eeCap', 'Employee at most (₹)', { req: false, dflt: '' }),
        n('eeFlat', 'Or a flat employee amount (₹)', { req: false, dflt: '' }),
        n('erFlat', 'Employer flat amount (₹)', { req: false, dflt: '' }),
        n('erMultiplier', 'Or the employer pays (× the employee)', { req: false, dflt: '' }),
        <label className="ep-field" htmlFor="pr-lwf-f" key="f">
          <span className="ep-field__label">When</span>
          <select id="pr-lwf-f" name="frequency" className="ep-select" defaultValue="half_yearly">
            <option value="monthly">Every month</option>
            <option value="half_yearly">In the months ticked</option>
          </select>
        </label>,
        <fieldset className="ep-field" key="months">
          <legend className="ep-field__label">Months</legend>
          <div className="ep-grid__toolbar">
            {MONTHS.map((m, i) => (
              <label key={m} className="ep-check">
                <input type="checkbox" name="months" value={String(i + 1)} /> {m.slice(0, 3)}
              </label>
            ))}
          </div>
        </fieldset>,
      ];
    case 'ot':
      return [
        t('employeeType', 'Employee type', {
          help: 'As on the employee (teaching, non_teaching …)',
        }),
        n('dailyAmount', 'A day (₹)', { dflt: '' }),
        n('hourlyAmount', 'An hour (₹)', { dflt: '' }),
      ];
  }
}

/** Rates and statutory rules (legacy Rate Registry): dated rows, drafts approved by another person. */
export default async function PayrollRatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const kind = TABS.find((t) => t.id === sp.tab)?.id ?? 'rates';
  const status = ['draft', 'active', 'ended'].includes(sp.status ?? '') ? sp.status! : 'all';
  let d: ConfigList;
  try {
    d = await apiFetch<ConfigList>(`/payroll/config/${kind}?status=${status}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const tab = TABS.find((t) => t.id === kind)!;
  const last = d.rows.find((r) => r.status === 'active');
  const cols = COLUMNS[kind];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Rates and statutory rules' },
        ]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Rates and statutory rules"
        description="Every rate the pay run reads, each from a date. A change is a new dated row: a maker drafts it, a checker who did not make it approves it, and the row it replaces ends the day before — earlier months keep their rate."
      />
      <Notice params={sp} />
      <nav className="ep-tabs" aria-label="Kinds of rate">
        {TABS.map((t) => (
          <a
            key={t.id}
            className="ep-tabs__tab"
            href={`/payroll/setup/rates?tab=${t.id}`}
            aria-current={t.id === kind ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>
      <section className="ep-card" aria-labelledby="pr-list">
        <div className="ep-grid__toolbar">
          <div>
            <h2 id="pr-list" className="ep-card__title">
              {tab.label}
            </h2>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {tab.text}
            </p>
          </div>
          <span className="ep-grid__spacer" />
          <nav aria-label="Show" className="ep-field__help">
            {(['all', 'draft', 'active', 'ended'] as const).map((x, i) => (
              <span key={x}>
                {i ? ' · ' : ''}
                {x === status ? (
                  <strong>{x === 'all' ? 'All' : x[0]!.toUpperCase() + x.slice(1)}</strong>
                ) : (
                  <a href={`/payroll/setup/rates?tab=${kind}&status=${x}`}>
                    {x === 'all' ? 'All' : x[0]!.toUpperCase() + x.slice(1)}
                  </a>
                )}
              </span>
            ))}
          </nav>
          {d.can.manage ? (
            <DialogButton
              id="pr-new"
              label="＋ New draft"
              title={`A new ${tab.label.toLowerCase()} row`}
            >
              <form action={addPayrollConfig.bind(null, kind)} className="ep-form-section__body">
                <div className="ep-profile__grid">{draftFields(kind, last)}</div>
                <div className="ep-profile__grid">
                  <label className="ep-field" htmlFor="pr-from">
                    <span className="ep-field__label">From</span>
                    <input
                      id="pr-from"
                      name="effectiveFrom"
                      type="date"
                      className="ep-input"
                      required
                    />
                  </label>
                  <label className="ep-field" htmlFor="pr-ref">
                    <span className="ep-field__label">Reference</span>
                    <input id="pr-ref" name="referenceNo" className="ep-input" maxLength={60} />
                    <span className="ep-field__help">The notification or order number</span>
                  </label>
                  <label className="ep-field" htmlFor="pr-why">
                    <span className="ep-field__label">Why</span>
                    <input id="pr-why" name="changeReason" className="ep-input" maxLength={200} />
                  </label>
                </div>
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Save as a draft
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
        </div>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pr-list">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.label} scope="col">
                    {c.label}
                  </th>
                ))}
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Status</th>
                <th scope="col">Made · approved by</th>
                <th scope="col">Why</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    {cols.map((c) => (
                      <td key={c.label}>{c.cell(r)}</td>
                    ))}
                    <td>{dmy(r.effectiveFrom)}</td>
                    <td>{r.effectiveTo ? dmy(r.effectiveTo) : 'Open'}</td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>
                        {r.status === 'draft'
                          ? 'Draft'
                          : r.status === 'active'
                            ? 'Active'
                            : 'Ended'}
                      </Badge>
                    </td>
                    <td>
                      {r.createdByName ?? 'Default'}
                      {r.approvedByName ? ` · ${r.approvedByName}` : ''}
                    </td>
                    <td>{r.changeReason ?? ''}</td>
                    <td>
                      <div className="ep-grid__toolbar">
                        {r.status === 'draft' && d.can.approve ? (
                          <form action={approvePayrollConfig.bind(null, kind, r.id)}>
                            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                              Approve
                            </button>
                          </form>
                        ) : null}
                        {r.status === 'draft' && (r.mine || d.can.approve) ? (
                          <form action={deletePayrollConfig.bind(null, kind, r.id)}>
                            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                              Delete
                            </button>
                          </form>
                        ) : null}
                        {r.status === 'active' && !r.effectiveTo && d.can.approve ? (
                          <DialogButton
                            id={`pr-end-${r.id}`}
                            label="End"
                            title="End this row"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                          >
                            <form
                              action={endPayrollConfig.bind(null, kind, r.id)}
                              className="ep-form-section__body"
                            >
                              <p className="ep-field__help">
                                No month after the date reads this row. To change a rate, add a new
                                dated row instead: it ends this one by itself.
                              </p>
                              <label className="ep-field" htmlFor={`pr-end-to-${r.id}`}>
                                <span className="ep-field__label">Last day</span>
                                <input
                                  id={`pr-end-to-${r.id}`}
                                  name="effectiveTo"
                                  type="date"
                                  className="ep-input"
                                  required
                                />
                              </label>
                              <label className="ep-field" htmlFor={`pr-end-why-${r.id}`}>
                                <span className="ep-field__label">Why</span>
                                <input
                                  id={`pr-end-why-${r.id}`}
                                  name="reason"
                                  className="ep-input"
                                  required
                                  minLength={3}
                                  maxLength={200}
                                />
                              </label>
                              <p>
                                <button type="submit" className="ep-btn ep-btn--primary">
                                  End it
                                </button>
                              </p>
                            </form>
                          </DialogButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={cols.length + 6}>Nothing here.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
