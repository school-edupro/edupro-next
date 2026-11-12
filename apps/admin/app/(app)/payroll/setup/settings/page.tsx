import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ChipPickerField } from '@/components/ChipPickerField';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { MONTHS, type PayrollSettings } from '@/lib/payroll';
import { savePayrollSettings } from '@/lib/payroll-actions';
import type { Employee } from '@/lib/types';

/** Payroll settings (legacy Settings gear): the school's payroll identity and switches — a payroll admin. */
export default async function PayrollSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let d: PayrollSettings;
  try {
    d = await apiFetch<PayrollSettings>('/payroll/settings');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const s = d.settings;
  const ro = !d.can.admin;
  const staff = ro
    ? []
    : (await apiFetch<{ data: Employee[] }>('/people/employees?status=active&size=200')).data;
  const text = (name: keyof typeof s, label: string, help: string, max = 40, placeholder = '') => (
    <label className="ep-field" htmlFor={`ps-${name}`}>
      <span className="ep-field__label">{label}</span>
      <input
        id={`ps-${name}`}
        name={name}
        className="ep-input"
        maxLength={max}
        defaultValue={(s[name] as string | null) ?? ''}
        placeholder={placeholder}
        disabled={ro}
      />
      <span className="ep-field__help">{help}</span>
    </label>
  );
  const check = (name: keyof typeof s, label: string, help: string) => (
    <label className="ep-check" htmlFor={`ps-${name}`}>
      <input
        id={`ps-${name}`}
        name={name}
        type="checkbox"
        defaultChecked={!!s[name]}
        disabled={ro}
      />
      <span>
        {label}
        <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
          {help}
        </span>
      </span>
    </label>
  );
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Payroll set-up', href: '/payroll/setup' }, { label: 'Settings' }]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Payroll settings"
        description={
          ro
            ? 'The school’s payroll identity and switches. Only a payroll admin changes them.'
            : 'The school’s payroll identity and switches. Changes apply to the next run; every change is in the audit log.'
        }
      />
      <Notice params={sp} />
      <form action={savePayrollSettings}>
        <section className="ep-card" aria-labelledby="ps-id">
          <h2 id="ps-id" className="ep-card__title">
            The school’s payroll identity
          </h2>
          <div className="ep-profile__grid">
            {text(
              'stateCode',
              'State (two letters)',
              'Profession tax and LWF follow it: MH, DL, HR, KA …',
              2,
              'MH',
            )}
            {text(
              'pfEstablishmentCode',
              'PF establishment code',
              'On the ECR file and the PF challan',
            )}
            {text('tan', 'TAN', 'On the tax return and the annual certificate (ABCD12345E)', 10)}
            {text('ptrcNo', 'PTRC number', 'Profession tax registration (where the state has one)')}
            {text('esiCode', 'ESI employer code', 'On the ESI contribution statement')}
          </div>
        </section>
        <section className="ep-card" aria-labelledby="ps-calc" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="ps-calc" className="ep-card__title">
            The calculation
          </h2>
          <div className="ep-profile__grid">
            <label className="ep-field" htmlFor="ps-matrixCode">
              <span className="ep-field__label">Pay matrix in use</span>
              <select
                id="ps-matrixCode"
                name="matrixCode"
                className="ep-select"
                defaultValue={s.matrixCode}
                disabled={ro}
              >
                {[...new Set([s.matrixCode, ...d.matrices])].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">
                Profiles’ level and cell are checked against it
              </span>
            </label>
            <label className="ep-field" htmlFor="ps-epsStopAge">
              <span className="ep-field__label">EPS stops at age</span>
              <input
                id="ps-epsStopAge"
                name="epsStopAge"
                type="number"
                min={50}
                max={70}
                className="ep-input"
                defaultValue={s.epsStopAge}
                disabled={ro}
              />
              <span className="ep-field__help">
                Pension contribution stops from the month the employee turns this age (58)
              </span>
            </label>
            <label className="ep-field" htmlFor="ps-payCycleFromDay">
              <span className="ep-field__label">Pay cycle starts on day</span>
              <input
                id="ps-payCycleFromDay"
                name="payCycleFromDay"
                type="number"
                min={2}
                max={28}
                className="ep-input"
                defaultValue={s.payCycleFromDay ?? ''}
                disabled={ro}
              />
              <span className="ep-field__help">Empty: the calendar month</span>
            </label>
            <label className="ep-field" htmlFor="ps-otHoursLimit">
              <span className="ep-field__label">Overtime hours limit a month</span>
              <input
                id="ps-otHoursLimit"
                name="otHoursLimit"
                type="number"
                min={1}
                max={744}
                step="0.5"
                className="ep-input"
                defaultValue={s.otHoursLimit}
                disabled={ro}
              />
            </label>
            <label className="ep-field" htmlFor="ps-regimeCutoffMonth">
              <span className="ep-field__label">Staff may switch tax regime until</span>
              <select
                id="ps-regimeCutoffMonth"
                name="regimeCutoffMonth"
                className="ep-select"
                defaultValue={String(s.regimeCutoffMonth)}
                disabled={ro}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </select>
              <span className="ep-field__help">
                After it, only a payroll admin switches, from the next month on
              </span>
            </label>
          </div>
          {check(
            'pfCeilingProrate',
            'PF ceiling prorated by paid days',
            'For staff on the CEILING basis, the ₹15,000 ceiling shrinks with loss of pay (the legacy default)',
          )}
          {check(
            'lwfEnabled',
            'Labour welfare fund is deducted',
            'Off by default; the state’s LWF rule decides the amounts and months',
          )}
        </section>
        <section className="ep-card" aria-labelledby="ps-pay" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="ps-pay" className="ep-card__title">
            Payslips and payment
          </h2>
          <div className="ep-profile__grid">
            {text(
              'payslipPassword',
              'Payslip PDF password',
              'From these parts: {EMPID} {NAME4} {PAN4} {AADHAAR4} {DOB_DDMMYYYY} — empty: no password',
              80,
              '{EMPID}{DOB_DDMMYYYY}',
            )}
            <label className="ep-field" htmlFor="ps-bankFileFormat">
              <span className="ep-field__label">Bank file</span>
              <select
                id="ps-bankFileFormat"
                name="bankFileFormat"
                className="ep-select"
                defaultValue={s.bankFileFormat}
                disabled={ro}
              >
                <option value="GENERIC_CSV">CSV: name, account, IFSC, amount, narration</option>
                <option value="CUSTOM_CSV">CSV in the bank’s own columns</option>
                <option value="BANK_LETTER_XLSX">Letter to the bank with the list</option>
              </select>
            </label>
          </div>
        </section>
        <section className="ep-card" aria-labelledby="ps-who" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="ps-who" className="ep-card__title">
            Confidential staff and formula attributes
          </h2>
          {ro ? (
            <p>
              Confidential staff:{' '}
              {d.confidential.length
                ? d.confidential.map((c) => `${c.name} (${c.code})`).join(', ')
                : 'none'}
            </p>
          ) : (
            <ChipPickerField
              name="confidentialEmployeeIds"
              label="Confidential staff"
              options={staff.map((e) => ({
                value: e.id,
                label: `${e.displayName} (${e.employeeCode})`,
              }))}
              initial={s.confidentialEmployeeIds}
              help="Type a name or code to pick. Hidden from payroll makers in lists, reports and files; still paid and in the statutory files."
            />
          )}
          <label className="ep-field" htmlFor="ps-attrs">
            <span className="ep-field__label">Formula attributes</span>
            <textarea
              id="ps-attrs"
              name="formulaAttributes"
              className="ep-input"
              rows={3}
              disabled={ro}
              defaultValue={s.formulaAttributes
                .map((a) => `${a.code} | ${a.field} | ${a.value}`)
                .join('\n')}
            />
            <span className="ep-field__help">
              One a line: CODE | employee field | value — CODE is 1 in a formula when the employee’s
              field has that value, else 0 (IS_PERMANENT | nature_of_appointment | Permanent).
            </span>
          </label>
        </section>
        {ro ? null : (
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <button type="submit" className="ep-btn ep-btn--primary">
              Save the settings
            </button>
          </p>
        )}
      </form>
    </>
  );
}
