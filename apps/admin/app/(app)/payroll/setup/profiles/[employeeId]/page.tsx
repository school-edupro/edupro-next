import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { RevealValue } from '@/components/payroll/RevealValue';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, MONTHS, type ProfileDetail, type ProfileValues } from '@/lib/payroll';
import { savePayrollNominees, savePayrollProfile } from '@/lib/payroll-actions';

/** The defaults a new profile starts from (the API's sync uses the same). */
const DEFAULTS: ProfileValues = {
  pfApplicable: true,
  pfWageBasis: 'ACTUAL',
  epsApplicable: true,
  vpfType: 'NONE',
  vpfValue: '0',
  npsApplicable: false,
  npsEeRate: '0.10',
  npsErRate: '0.14',
  esiApplicable: true,
  pwd: false,
  ptApplicable: true,
  ptExemptReason: null,
  taxRegime: 'NEW',
  tdsMode: 'PROJECTION',
  category: null,
  payLevel: null,
  payCell: null,
  contractStart: null,
  contractEnd: null,
  incrementMonth: null,
  payrollStatus: 'ACTIVE',
  payMode: 'BANK',
};
const FIELD_LABEL: Record<string, string> = {
  pf_applicable: 'PF',
  pf_wage_basis: 'PF wage',
  eps_applicable: 'Pension (EPS)',
  vpf_type: 'VPF',
  vpf_value: 'VPF value',
  nps_applicable: 'NPS',
  nps_ee_rate: 'NPS employee rate',
  nps_er_rate: 'NPS employer rate',
  esi_applicable: 'ESI',
  pwd: 'Person with disability',
  pt_applicable: 'Profession tax',
  pt_exempt_reason: 'PT exemption',
  tax_regime: 'Tax regime',
  tds_mode: 'TDS',
  category: 'Category',
  pay_level: 'Level',
  pay_cell: 'Cell',
  contract_start: 'Contract from',
  contract_end: 'Contract to',
  increment_month: 'Increment month',
  payroll_status: 'Payroll status',
  pay_mode: 'Paid by',
};
const PURPOSE = { GENERAL: 'General', GRATUITY: 'Gratuity', EDLI: 'EDLI' } as Record<
  string,
  string
>;

/** An employee's payroll profile (legacy Employee payroll details), nominees and the history of each change. */
export default async function PayrollProfilePage({
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
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let d: ProfileDetail;
  try {
    d = await apiFetch<ProfileDetail>(`/payroll/profiles/${employeeId}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const e = d.employee;
  const p = d.profile ?? DEFAULTS;
  const ro = !d.can.manage;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const pctOf = (v: string) => String(Math.round(Number(v) * 10000) / 100);
  const check = (name: keyof ProfileValues, label: string, help?: string) => (
    <label className="ep-check" htmlFor={`pf-${name}`}>
      <input
        id={`pf-${name}`}
        type="checkbox"
        name={name}
        defaultChecked={!!p[name]}
        disabled={ro}
      />{' '}
      <span>
        {label}
        {help ? (
          <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
            {help}
          </span>
        ) : null}
      </span>
    </label>
  );
  const select = (
    name: keyof ProfileValues,
    label: string,
    options: Array<[string, string]>,
    help?: string,
  ) => (
    <label className="ep-field" htmlFor={`pf-${name}`}>
      <span className="ep-field__label">{label}</span>
      <select
        id={`pf-${name}`}
        name={name}
        className="ep-select"
        defaultValue={String(p[name] ?? '')}
        disabled={ro}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {help ? <span className="ep-field__help">{help}</span> : null}
    </label>
  );
  const input = (
    name: keyof ProfileValues,
    label: string,
    opts: { type?: string; help?: string; value?: string; max?: number } = {},
  ) => (
    <label className="ep-field" htmlFor={`pf-${name}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`pf-${name}`}
        name={name}
        type={opts.type ?? 'text'}
        className="ep-input"
        maxLength={opts.max ?? 60}
        defaultValue={opts.value ?? String(p[name] ?? '')}
        disabled={ro}
      />
      {opts.help ? <span className="ep-field__help">{opts.help}</span> : null}
    </label>
  );
  const nominees = [
    ...d.nominees,
    ...Array.from({ length: Math.max(1, 3 - d.nominees.length) }, () => null),
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Payroll profiles', href: '/payroll/setup/profiles' },
          { label: e.code },
        ]}
      />
      <PageHeader
        kicker="Payroll profile"
        title={`${e.name} (${e.code})`}
        description={[
          e.designation,
          e.department,
          e.staffType,
          e.joinedOn ? `joined ${dmy(e.joinedOn)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <Notice params={sp} />
      {!d.exists ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <strong>No payroll profile yet.</strong> The form shows the defaults; saving makes the
            profile. An employee without one is not in a pay run.
          </div>
        </div>
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="Payroll status"
          value={
            d.exists
              ? ({ ACTIVE: 'Paid', HOLD: 'On hold', LEFT: 'Left' }[p.payrollStatus] ?? '')
              : 'No profile'
          }
        />
        <KpiTile
          label="Level · cell"
          value={p.payLevel ? `${p.payLevel} · ${String(p.payCell ?? '')}` : '—'}
        />
        <KpiTile label="Tax regime" value={p.taxRegime === 'NEW' ? 'New' : 'Old'} />
        <KpiTile label="Nominees" value={String(d.nominees.length)} />
      </div>
      <section className="ep-card" aria-labelledby="pf-ids">
        <h2 id="pf-ids" className="ep-card__title">
          From the employee record
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Kept on the employee record, not here: change them there.{' '}
          {d.can.reveal ? 'A full number is shown with a reason, and the look is logged.' : ''}
        </p>
        <div className="ep-profile__grid">
          <RevealValue
            employeeId={e.id}
            field="pan"
            label="PAN"
            masked={d.statutory.panMasked}
            canReveal={d.can.reveal}
          />
          <RevealValue
            employeeId={e.id}
            field="aadhaar"
            label="Aadhaar"
            masked={d.statutory.aadhaarMasked}
            canReveal={d.can.reveal}
          />
          <RevealValue
            employeeId={e.id}
            field="bank_account_no"
            label="Bank account"
            masked={d.statutory.bankMasked}
            canReveal={d.can.reveal}
          />
          <div className="ep-field">
            <span className="ep-field__label">Bank · IFSC</span>
            <span>{[e.bankName, e.bankIfsc].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div className="ep-field">
            <span className="ep-field__label">UAN · PF number</span>
            <span>{[e.uan, e.pfNo].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div className="ep-field">
            <span className="ep-field__label">ESI · NPS (PRAN)</span>
            <span>{[e.esiNo, e.npsNo].filter(Boolean).join(' · ') || '—'}</span>
          </div>
          <div className="ep-field">
            <span className="ep-field__label">Date of birth · gender</span>
            <span>{[dmy(e.dob), e.gender].filter(Boolean).join(' · ') || '—'}</span>
          </div>
        </div>
      </section>
      <form action={savePayrollProfile.bind(null, e.id)}>
        <section className="ep-card" aria-labelledby="pf-stat" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="pf-stat" className="ep-card__title">
            Statutory deductions
          </h2>
          <div className="ep-profile__grid">
            <div>
              {check('pfApplicable', 'Provident fund')}
              {check(
                'epsApplicable',
                'Pension (EPS)',
                'Stops by itself from the month of the age in the settings',
              )}
            </div>
            {select('pfWageBasis', 'PF on', [
              ['CEILING', 'The ceiling at most (₹15,000)'],
              ['ACTUAL', 'The whole PF wage'],
            ])}
            {select('vpfType', 'Voluntary PF', [
              ['NONE', 'None'],
              ['FLAT', 'A flat amount a month'],
              ['PERCENT', 'A per cent of the PF wage'],
            ])}
            {input('vpfValue', 'VPF amount or per cent', { help: '₹ a month, or a per cent' })}
            <div>
              {check('esiApplicable', 'ESI', 'Only while the gross is within the wage limit')}
              {check('pwd', 'Person with disability', 'The higher ESI wage limit applies')}
            </div>
            <div>{check('ptApplicable', 'Profession tax')}</div>
            {input('ptExemptReason', 'Why no profession tax', {
              help: 'Needed when it does not apply',
            })}
            <div>
              {check(
                'npsApplicable',
                'NPS instead of PF',
                'For staff under the National Pension System',
              )}
            </div>
            {input('npsEeRate', 'NPS employee (%)', { value: pctOf(p.npsEeRate) })}
            {input('npsErRate', 'NPS employer (%)', { value: pctOf(p.npsErRate) })}
          </div>
        </section>
        <section className="ep-card" aria-labelledby="pf-pay" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="pf-pay" className="ep-card__title">
            Pay and tax
          </h2>
          <div className="ep-profile__grid">
            <label className="ep-field" htmlFor="pf-payLevel">
              <span className="ep-field__label">Pay level</span>
              <select
                id="pf-payLevel"
                name="payLevel"
                className="ep-select"
                defaultValue={p.payLevel ?? ''}
                disabled={ro}
              >
                <option value="">Not on the matrix</option>
                {d.matrix.map((m) => (
                  <option key={m.level} value={m.level}>
                    Level {m.level} ({m.cells} cells)
                  </option>
                ))}
              </select>
            </label>
            {input('payCell', 'Cell', {
              type: 'number',
              help: 'Basic pay comes from the matrix at this level and cell',
            })}
            {select('incrementMonth', 'Increment month', [
              ['', 'None'],
              ...MONTHS.map((m, i): [string, string] => [String(i + 1), m]),
            ])}
            {select('taxRegime', 'Income-tax regime', [
              ['NEW', 'New regime'],
              ['OLD', 'Old regime'],
            ])}
            {select('tdsMode', 'Tax each month', [
              ['PROJECTION', 'Worked out from the year’s projection'],
              ['MANUAL', 'An amount typed in each month'],
            ])}
            {input('category', 'Category', {
              help: 'Optional: as the school groups staff for pay',
              max: 50,
            })}
          </div>
        </section>
        <section
          className="ep-card"
          aria-labelledby="pf-status"
          style={{ marginTop: 'var(--sp-4)' }}
        >
          <h2 id="pf-status" className="ep-card__title">
            Payment and status
          </h2>
          <div className="ep-profile__grid">
            {select('payMode', 'Paid by', [
              ['BANK', 'Bank transfer'],
              ['CHEQUE', 'Cheque'],
              ['CASH', 'Cash'],
            ])}
            {select('payrollStatus', 'Payroll status', [
              ['ACTIVE', 'Paid each month'],
              ['HOLD', 'On hold: worked out, not paid'],
              ['LEFT', 'Left: not in a run'],
            ])}
            {input('contractStart', 'Contract from', {
              type: 'date',
              value: p.contractStart ?? '',
            })}
            {input('contractEnd', 'Contract to', { type: 'date', value: p.contractEnd ?? '' })}
          </div>
        </section>
        {ro ? null : (
          <section
            className="ep-card"
            aria-labelledby="pf-save"
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <h2 id="pf-save" className="ep-card__title">
              Save
            </h2>
            <div className="ep-grid__toolbar">
              <label className="ep-field" htmlFor="pf-changesFrom">
                <span className="ep-field__label">The changes apply from</span>
                <input
                  id="pf-changesFrom"
                  name="changesFrom"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={today}
                />
                <span className="ep-field__help">
                  Each changed field is kept in the history with this date
                </span>
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                {d.exists ? 'Save the changes' : 'Make the profile'}
              </button>
            </div>
          </section>
        )}
      </form>
      <FoldCard
        id="pf-nominees"
        title="Nominees"
        hint={
          d.nominees.length
            ? d.nominees
                .map(
                  (n) => `${n.relation} ${n.sharePercent} % (${PURPOSE[n.purpose] ?? n.purpose})`,
                )
                .join(', ')
            : 'For gratuity, EDLI and dues: the shares of each purpose make 100 %'
        }
      >
        <form action={savePayrollNominees.bind(null, e.id)}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pf-nominees">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Relation</th>
                  <th scope="col">Date of birth</th>
                  <th scope="col">Share (%)</th>
                  <th scope="col">For</th>
                </tr>
              </thead>
              <tbody>
                {nominees.map((n, i) => (
                  <tr key={n?.id ?? `new-${String(i)}`}>
                    <td>
                      <input
                        aria-label={`Nominee ${String(i + 1)} name`}
                        name="nName"
                        className="ep-input"
                        maxLength={150}
                        defaultValue={n?.name ?? ''}
                        disabled={ro}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Nominee ${String(i + 1)} relation`}
                        name="nRelation"
                        className="ep-input"
                        maxLength={40}
                        defaultValue={n?.relation ?? ''}
                        disabled={ro}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Nominee ${String(i + 1)} date of birth`}
                        name="nDob"
                        type="date"
                        className="ep-input"
                        defaultValue={n?.dob ?? ''}
                        disabled={ro}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Nominee ${String(i + 1)} share`}
                        name="nShare"
                        className="ep-input"
                        inputMode="decimal"
                        defaultValue={n?.sharePercent ?? ''}
                        disabled={ro}
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Nominee ${String(i + 1)} purpose`}
                        name="nPurpose"
                        className="ep-select"
                        data-native
                        defaultValue={n?.purpose ?? 'GENERAL'}
                        disabled={ro}
                      >
                        <option value="GENERAL">General</option>
                        <option value="GRATUITY">Gratuity</option>
                        <option value="EDLI">EDLI</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ro ? null : (
            <p className="ep-grid__toolbar">
              <span className="ep-field__help">
                Leave a name empty to remove that row. Save and come back to add more than three.
              </span>
              <span className="ep-grid__spacer" />
              <button type="submit" className="ep-btn ep-btn--primary">
                Save the nominees
              </button>
            </p>
          )}
        </form>
      </FoldCard>
      <FoldCard
        id="pf-history"
        title="History"
        hint={
          d.changes.length
            ? `${String(d.changes.length)} change(s), the last on ${dmy(d.changes[0]?.changedAt.slice(0, 10))}`
            : 'Each change of a switch, the regime, level, cell or status, with its date'
        }
      >
        {d.changes.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pf-history">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Was</th>
                  <th scope="col">Now</th>
                  <th scope="col">From</th>
                  <th scope="col">Changed by · on</th>
                </tr>
              </thead>
              <tbody>
                {d.changes.map((c, i) => (
                  <tr key={`${c.field}-${String(i)}`}>
                    <td>{FIELD_LABEL[c.field] ?? c.field}</td>
                    <td>{c.oldValue ?? '—'}</td>
                    <td>{c.newValue ?? '—'}</td>
                    <td>{dmy(c.effectiveFrom)}</td>
                    <td>
                      {c.changedBy ?? ''} · {dmy(c.changedAt.slice(0, 10))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No changes yet.</p>
        )}
      </FoldCard>
      {d.employee.leftOn ? (
        <p className="ep-field__help">
          <Badge tone="neutral">Left</Badge> on {dmy(d.employee.leftOn)}.
        </p>
      ) : null}
    </>
  );
}
