import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ReportGrid, type Grid, type GridCol } from '@/components/payroll/reports/ReportGrid';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { deletePreset, postBonus, saveBonusRule, savePreset } from '@/lib/payroll-reports-actions';

interface Def {
  key: string;
  label: string;
  group: string;
  period: 'month' | 'fy' | 'asof' | 'none';
  filters: Array<'run' | 'department' | 'staffType' | 'employee'>;
  views?: Array<{ key: string; label: string }>;
  note: string;
}
interface Options {
  runs: Array<{ id: string; label: string }>;
  departments: string[];
  staffTypes: Array<{ id: string; label: string }>;
  employees: Array<{ id: string; label: string }>;
}
interface Preset {
  id: string;
  name: string;
  columns: string[];
  shared: boolean;
  mine: boolean;
}
interface BonusRule {
  kind: 'PERCENT' | 'FIXED' | 'STATUTORY';
  rate: string | null;
  amount: string | null;
  prorate: boolean;
  minMonths: number;
  minDays: string;
  maxWage: string | null;
  wageCap: string | null;
  note: string | null;
}

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const fyNow = () => {
  const t = today();
  const y = Number(t.slice(5, 7)) >= 4 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
  return `${String(y)}-${String((y + 1) % 100).padStart(2, '0')}`;
};
const lastMonth = () => {
  const t = today();
  const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1));
  return d.toISOString().slice(0, 7);
};
const FIXED: Record<string, string> = {
  code: 'Emp. ID',
  name: 'Employee',
  designation: 'Designation',
  department: 'Department',
  staff_type: 'Staff type',
  level: 'Level',
  cell: 'Cell',
  category: 'Category',
  mode: 'Mode',
  bank: 'Bank',
  ifsc: 'IFSC',
  account: 'Account',
  pan: 'PAN',
  uan: 'UAN',
  month_days: 'Month days',
  paid_days: 'Days paid',
  lop_days: 'LOP days',
  lop_amount: 'LOP amount',
};
const TOTALS: Record<string, string> = {
  gross: 'Gross',
  deductions: 'Deductions',
  net: 'Net',
  pf_wage: 'PF wage',
  er_epf: 'Employer EPF',
  er_eps: 'Employer EPS',
  esi_wage: 'ESI wage',
  esi_er: 'Employer ESI',
  status: 'Paid or held',
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[v.length - 1] : v);
const select = (
  id: string,
  name: string,
  label: string,
  value: string,
  items: Array<{ id: string; label: string }>,
  any = 'All',
) => (
  <label className="ep-field" htmlFor={id}>
    <span className="ep-field__label">{label}</span>
    <select id={id} name={name} className="ep-select" defaultValue={value}>
      <option value="">{any}</option>
      {items.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </select>
  </label>
);

/**
 * Payroll reports (docs/design/86, phase F): one catalogue; each report shown as one grid, and downloaded as Excel,
 * PDF or CSV with the same filters; the salary register's views and saved column sets; the bonus rule and its posting;
 * the gratuity liability and the actuary's file.
 */
export default async function PayrollReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  const checker = me.permissions.includes('payroll.run.approve');
  let cat: { reports: Def[]; groups: string[]; can: { sharePresets: boolean; bonusPost: boolean } };
  try {
    cat = await apiFetch('/payroll/reports');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const def = cat.reports.find((r) => r.key === one(sp.key)) ?? cat.reports[0]!;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(one(sp.month) ?? '') ? one(sp.month)! : lastMonth();
  const fy = /^\d{4}-\d{2}$/.test(one(sp.fy) ?? '') ? one(sp.fy)! : fyNow();
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(one(sp.asOf) ?? '') ? one(sp.asOf)! : today();
  const pick = (k: string) => {
    const v = one(sp[k]);
    return v && v.length <= 100 ? v : '';
  };
  const columnsRaw = sp.columns;
  const presets: Preset[] =
    def.key === 'register'
      ? (await apiFetch<{ rows: Preset[] }>('/payroll/reports/presets?report=register')).rows
      : [];
  const preset = presets.find((x) => `p:${x.id}` === pick('view'));
  const columns = preset
    ? preset.columns.join(',')
    : Array.isArray(columnsRaw)
      ? columnsRaw.join(',')
      : (columnsRaw ?? '');
  // the query the screen and every download share
  const q = new URLSearchParams();
  if (def.period === 'month') q.set('month', month);
  if (def.period === 'fy') q.set('fy', fy);
  if (def.period === 'asof') q.set('asOf', asOf);
  for (const k of ['runId', 'department', 'staffType', 'employeeId'] as const) {
    const f = {
      runId: 'run',
      department: 'department',
      staffType: 'staffType',
      employeeId: 'employee',
    }[k] as Def['filters'][number];
    if (def.filters.includes(f) && pick(k)) q.set(k, pick(k));
  }
  if (def.key === 'register') {
    if (columns) q.set('columns', columns);
    else if (pick('view') && !pick('view').startsWith('p:')) q.set('view', pick('view'));
  }
  if (def.key === 'group' && pick('groupBy')) q.set('groupBy', pick('groupBy'));
  if (def.key === 'variance' && pick('threshold')) q.set('threshold', pick('threshold'));
  const options: Options | null =
    def.period === 'month' && def.filters.length
      ? await apiFetch<Options>(`/payroll/reports/options?month=${month}`)
      : null;
  let grid: Grid | null = null;
  let problem: string | null = null;
  try {
    grid = await apiFetch<Grid>(`/payroll/reports/${def.key}?${q.toString()}`);
  } catch (e) {
    if (e instanceof ApiError && e.status !== 401)
      problem = e.problem.detail ?? 'This report cannot be made for that choice.';
    else throw e;
  }
  // every column the register can show, for the picker
  let registry: GridCol[] = [];
  if (def.key === 'register' && one(sp.pick) === '1')
    try {
      const all = await apiFetch<Grid>(`/payroll/reports/register?month=${month}&view=full`);
      registry = [
        ...Object.entries(FIXED).map(([key, label]) => ({ key, label })),
        ...all.columns.filter((c) => c.key.startsWith('h:')),
        ...Object.entries(TOTALS).map(([key, label]) => ({ key, label })),
      ];
    } catch {
      registry = [];
    }
  let bonus: {
    rule: BonusRule | null;
    statutory: BonusRule;
    can: { set: boolean; post: boolean };
  } | null = null;
  if (def.key === 'bonus') bonus = await apiFetch(`/payroll/bonus/${fy}`);
  const here = `/payroll/reports?${new URLSearchParams({ key: def.key, ...Object.fromEntries(q) }).toString()}`;
  const file = (format: 'xlsx' | 'pdf' | 'csv') =>
    `/api/payroll/pay-file?kind=report&key=${def.key}&${q.toString()}&format=${format}`;
  const y = Number(fyNow().slice(0, 4));
  const years = [y - 2, y - 1, y].map(
    (x) => `${String(x)}-${String((x + 1) % 100).padStart(2, '0')}`,
  );
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll', href: '/payroll' }, { label: 'Reports' }]} />
      <PageHeader kicker="Payroll" title={def.label} description={def.note} />
      <Notice params={Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]))} />
      <FoldCard
        id="rp-cat"
        title="All reports"
        hint={`${String(cat.reports.length)} reports in ${String(cat.groups.length)} groups`}
      >
        <div className="ep-chart__grid2">
          {cat.groups.map((gname) => (
            <div key={gname}>
              <h3 className="ep-field__label">{gname}</h3>
              <ul className="ep-list">
                {cat.reports
                  .filter((r) => r.group === gname)
                  .map((r) => (
                    <li key={r.key}>
                      {r.key === def.key ? (
                        <strong>{r.label}</strong>
                      ) : (
                        <a href={`/payroll/reports?key=${r.key}`}>{r.label}</a>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </FoldCard>
      <section className="ep-card" aria-labelledby="rp-form">
        <h2 id="rp-form" className="ep-card__title">
          Choose
        </h2>
        <form method="get" action="/payroll/reports" className="ep-form-section__body">
          <input type="hidden" name="key" value={def.key} />
          <div className="ep-form-row" data-columns="3">
            {def.period === 'month' ? (
              <label className="ep-field" htmlFor="rp-month">
                <span className="ep-field__label">Month</span>
                <input
                  id="rp-month"
                  name="month"
                  type="month"
                  className="ep-input"
                  defaultValue={month}
                  required
                />
              </label>
            ) : def.period === 'fy' ? (
              select(
                'rp-fy',
                'fy',
                'Financial year',
                fy,
                years.map((x) => ({ id: x, label: x })),
                'Choose…',
              )
            ) : def.period === 'asof' ? (
              <label className="ep-field" htmlFor="rp-asof">
                <span className="ep-field__label">As of</span>
                <input
                  id="rp-asof"
                  name="asOf"
                  type="date"
                  className="ep-input"
                  defaultValue={asOf}
                  required
                />
              </label>
            ) : null}
            {def.filters.includes('run') && options
              ? select(
                  'rp-run',
                  'runId',
                  'Run',
                  pick('runId'),
                  options.runs,
                  'Every run of the month',
                )
              : null}
            {def.filters.includes('department') && options
              ? select(
                  'rp-dept',
                  'department',
                  'Department',
                  pick('department'),
                  options.departments.map((d) => ({ id: d, label: d })),
                )
              : null}
            {def.filters.includes('staffType') && options
              ? select('rp-type', 'staffType', 'Staff type', pick('staffType'), options.staffTypes)
              : null}
            {def.filters.includes('employee') && options
              ? select('rp-emp', 'employeeId', 'Employee', pick('employeeId'), options.employees)
              : null}
            {def.key === 'register'
              ? select(
                  'rp-view',
                  'view',
                  'View',
                  preset ? `p:${preset.id}` : pick('view'),
                  [
                    ...(def.views ?? []).map((v) => ({ id: v.key, label: v.label })),
                    ...presets.map((x) => ({
                      id: `p:${x.id}`,
                      label: `${x.shared ? 'Shared' : 'Mine'}: ${x.name}`,
                    })),
                  ],
                  'Every head',
                )
              : null}
            {def.key === 'group'
              ? select(
                  'rp-by',
                  'groupBy',
                  'By',
                  pick('groupBy'),
                  [
                    { id: 'department', label: 'Department' },
                    { id: 'designation', label: 'Designation' },
                    { id: 'staff_type', label: 'Staff type' },
                    { id: 'category', label: 'Category' },
                  ],
                  'Department',
                )
              : null}
            {def.key === 'variance' ? (
              <label className="ep-field" htmlFor="rp-th">
                <span className="ep-field__label">Changes of at least (₹)</span>
                <input
                  id="rp-th"
                  name="threshold"
                  className="ep-input"
                  inputMode="decimal"
                  defaultValue={pick('threshold') || '1'}
                />
              </label>
            ) : null}
          </div>
          <div className="ep-grid__toolbar">
            <button type="submit" className="ep-btn ep-btn--primary">
              Show
            </button>
            {grid ? (
              <>
                <span className="ep-field__help">PDF</span>
                <FileLinks href={file('pdf')} label={`${def.label} as PDF`} />
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')} download>
                  Excel
                </a>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('csv')} download>
                  CSV
                </a>
              </>
            ) : null}
            {def.key === 'register' ? (
              <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`${here}&pick=1`}>
                Choose columns
              </a>
            ) : null}
            {def.key === 'gratuity' && checker ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/api/payroll/pay-file?kind=actuary&asOf=${asOf}`}
                download
              >
                Data for the actuary (Excel)
              </a>
            ) : null}
          </div>
        </form>
      </section>
      {registry.length ? (
        <section className="ep-card" aria-labelledby="rp-pick">
          <h2 id="rp-pick" className="ep-card__title">
            Columns
          </h2>
          <form method="get" action="/payroll/reports" className="ep-form-section__body">
            <input type="hidden" name="key" value="register" />
            <input type="hidden" name="month" value={month} />
            <fieldset className="ep-fieldset">
              <legend className="ep-field__label">Tick the columns, then Show</legend>
              <div className="ep-form-row" data-columns="4">
                {registry.map((c) => (
                  <label key={c.key} className="ep-field" htmlFor={`rp-c-${c.key}`}>
                    <span className="ep-field__label">
                      <input
                        id={`rp-c-${c.key}`}
                        type="checkbox"
                        name="columns"
                        value={c.key}
                        defaultChecked={(columns || 'code,name,gross,deductions,net')
                          .split(',')
                          .includes(c.key)}
                      />{' '}
                      {c.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="ep-grid__toolbar">
              <button type="submit" className="ep-btn ep-btn--primary">
                Show
              </button>
            </div>
          </form>
        </section>
      ) : null}
      {def.key === 'register' && columns && !preset ? (
        <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-3)' }}>
          <DialogButton id="rp-save" label="Save these columns" title="Save these columns as a set">
            <form action={savePreset} className="ep-form-section__body">
              <input type="hidden" name="back" value={here} />
              {columns.split(',').map((c) => (
                <input key={c} type="hidden" name="column" value={c} />
              ))}
              <label className="ep-field" htmlFor="rp-pn">
                <span className="ep-field__label">Name</span>
                <input
                  id="rp-pn"
                  name="name"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={80}
                />
              </label>
              {cat.can.sharePresets ? (
                <label className="ep-field" htmlFor="rp-ps">
                  <span className="ep-field__label">
                    <input id="rp-ps" type="checkbox" name="shared" /> Share with every payroll user
                  </span>
                </label>
              ) : null}
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </DialogButton>
        </div>
      ) : null}
      {problem ? (
        <p className="ep-alert ep-alert--warning" role="status">
          {problem}
        </p>
      ) : null}
      {bonus ? (
        <Card title={`The bonus rule of ${fy}`}>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Schools are outside the Code on Wages’ statutory bonus (s.41(1)(e)): the school sets its
            own rule. The statutory formula is offered as a choice:{' '}
            {Number(bonus.statutory.rate) * 100} % of basic + DA up to ₹{bonus.statutory.wageCap} a
            month, for months with basic + DA up to ₹{bonus.statutory.maxWage}, at least{' '}
            {bonus.statutory.minDays} days.
          </p>
          {bonus.can.set ? (
            <form action={saveBonusRule.bind(null, fy)} className="ep-form-section__body">
              <div className="ep-form-row" data-columns="3">
                <label className="ep-field" htmlFor="bn-kind">
                  <span className="ep-field__label">Rule</span>
                  <select
                    id="bn-kind"
                    name="kind"
                    className="ep-select"
                    defaultValue={bonus.rule?.kind ?? 'PERCENT'}
                  >
                    <option value="PERCENT">A % of basic + DA</option>
                    <option value="FIXED">A fixed sum each</option>
                    <option value="STATUTORY">The statutory formula</option>
                  </select>
                </label>
                <label className="ep-field" htmlFor="bn-rate">
                  <span className="ep-field__label">Rate (%)</span>
                  <input
                    id="bn-rate"
                    name="ratePct"
                    className="ep-input"
                    inputMode="decimal"
                    defaultValue={
                      bonus.rule?.rate
                        ? String(Math.round(Number(bonus.rule.rate) * 10000) / 100)
                        : ''
                    }
                  />
                </label>
                <label className="ep-field" htmlFor="bn-amt">
                  <span className="ep-field__label">Fixed sum (₹)</span>
                  <input
                    id="bn-amt"
                    name="amount"
                    className="ep-input"
                    inputMode="decimal"
                    defaultValue={bonus.rule?.amount ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="bn-mm">
                  <span className="ep-field__label">At least months</span>
                  <input
                    id="bn-mm"
                    name="minMonths"
                    type="number"
                    min={0}
                    max={12}
                    className="ep-input"
                    defaultValue={bonus.rule?.minMonths ?? 0}
                  />
                </label>
                <label className="ep-field" htmlFor="bn-md">
                  <span className="ep-field__label">At least days worked</span>
                  <input
                    id="bn-md"
                    name="minDays"
                    className="ep-input"
                    inputMode="decimal"
                    defaultValue={bonus.rule?.minDays ?? '0'}
                  />
                </label>
                <label className="ep-field" htmlFor="bn-mw">
                  <span className="ep-field__label">Months counted up to basic + DA (₹)</span>
                  <input
                    id="bn-mw"
                    name="maxWage"
                    className="ep-input"
                    inputMode="decimal"
                    defaultValue={bonus.rule?.maxWage ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="bn-cap">
                  <span className="ep-field__label">Wage counted at most (₹ a month)</span>
                  <input
                    id="bn-cap"
                    name="wageCap"
                    className="ep-input"
                    inputMode="decimal"
                    defaultValue={bonus.rule?.wageCap ?? ''}
                  />
                </label>
                <label className="ep-field" htmlFor="bn-pr">
                  <span className="ep-field__label">
                    <input
                      id="bn-pr"
                      name="prorate"
                      type="checkbox"
                      defaultChecked={bonus.rule?.prorate ?? true}
                    />{' '}
                    A fixed sum by the months counted
                  </span>
                </label>
                <label className="ep-field" htmlFor="bn-note">
                  <span className="ep-field__label">Note</span>
                  <input
                    id="bn-note"
                    name="note"
                    className="ep-input"
                    maxLength={300}
                    defaultValue={bonus.rule?.note ?? ''}
                  />
                </label>
              </div>
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save the rule
                </button>
              </div>
            </form>
          ) : null}
          {bonus.can.post && bonus.rule ? (
            <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
              <form action={postBonus.bind(null, fy, true)} className="ep-grid__toolbar">
                <label className="ep-field" htmlFor="bn-month">
                  <span className="ep-field__label">Pay in the month</span>
                  <input id="bn-month" name="month" type="month" className="ep-input" required />
                </label>
                <button type="submit" className="ep-btn ep-btn--secondary">
                  See what it posts
                </button>
              </form>
              <DialogButton
                id="bn-post"
                label="Post the bonus"
                title="Post the year’s bonus as one-off items"
              >
                <form action={postBonus.bind(null, fy, false)} className="ep-form-section__body">
                  <label className="ep-field" htmlFor="bn-month2">
                    <span className="ep-field__label">Pay in the month</span>
                    <input id="bn-month2" name="month" type="month" className="ep-input" required />
                  </label>
                  <p className="ep-field__help">
                    Each employee’s bonus is posted once; the month’s run pays it (a bonus run once
                    that month is locked).
                  </p>
                  <div className="ep-grid__toolbar">
                    <button type="submit" className="ep-btn ep-btn--primary">
                      Post
                    </button>
                  </div>
                </form>
              </DialogButton>
            </div>
          ) : null}
        </Card>
      ) : null}
      {grid ? <ReportGrid g={grid} /> : null}
      {presets.length ? (
        <FoldCard
          id="rp-presets"
          title={`Saved column sets (${String(presets.length)})`}
          hint="Yours, and the shared ones"
        >
          <ul className="ep-list">
            {presets.map((x) => (
              <li key={x.id}>
                {x.shared ? 'Shared' : 'Mine'}:{' '}
                <a href={`/payroll/reports?key=register&month=${month}&view=p:${x.id}`}>{x.name}</a>{' '}
                <span className="ep-field__help">{x.columns.length} columns</span>
                {x.mine ? (
                  <form action={deletePreset.bind(null, x.id)} style={{ display: 'inline' }}>
                    <input type="hidden" name="back" value={here} />{' '}
                    <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                      Remove
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
    </>
  );
}
