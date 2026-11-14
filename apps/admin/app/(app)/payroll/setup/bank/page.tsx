import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { BankAccountForm } from '@/components/payroll/bank/BankAccountForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { FORMAT_WORD, type BankAccount } from '@/lib/payroll-pay';
import { saveBankAccount, saveLedgers } from '@/lib/payroll-pay-actions';

interface Ledgers {
  salary?: Record<string, string>;
  heads?: Record<string, string>;
  employer?: Record<string, string>;
  payable?: Record<string, string>;
  net?: string;
}

/**
 * Bank accounts and ledgers (docs/design/86, phase C): the school's accounts salaries are paid from, each with the
 * file its bank takes; how arrears go in the PF ECR; the salary voucher's ledger names. The payroll admin changes
 * them; a payroll checker reads them.
 */
export default async function PayrollBankSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const p = me.permissions;
  if (!p.includes('payroll.run.approve') && !p.includes('payroll.settings.manage')) notFound();
  let d: { rows: BankAccount[]; fallback: { fileFormat: string }; can: { manage: boolean } };
  let settings: Record<string, unknown> = {};
  try {
    d = await apiFetch('/payroll/bank/accounts');
    if (p.includes('payroll.setup.view'))
      settings = (await apiFetch<{ settings: Record<string, unknown> }>('/payroll/settings'))
        .settings;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const led = (settings.jvLedgers ?? {}) as Ledgers;
  const lines = (r: Record<string, string> | undefined) =>
    Object.entries(r ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join('\n');
  const can = d.can.manage;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Bank accounts and ledgers' },
        ]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Bank accounts and ledgers"
        description="The school’s accounts the salaries are paid from, each with the file its bank takes; how arrears go in the PF ECR; the salary voucher’s ledger names."
      />
      <Notice params={sp} />
      <section className="ep-card" aria-labelledby="sb-acc">
        <h2 id="sb-acc" className="ep-card__title">
          The school’s bank accounts
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          One account a bank: a salary goes in the file of its bank (the first four letters of the
          employee’s IFSC). For the bank’s own layout, take its sample salary file and set its
          columns in the same order; try it before you save. A bank with no account here gets the{' '}
          {FORMAT_WORD[d.fallback.fileFormat] ?? d.fallback.fileFormat} set in Settings.
        </p>
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="sb-acc">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Bank</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Account</th>
                  <th scope="col">File</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.bankCode}</strong> · {a.bankName}
                      {a.active ? null : (
                        <>
                          {' '}
                          <Badge tone="neutral">Not in use</Badge>
                        </>
                      )}
                    </td>
                    <td>{a.branch ?? '—'}</td>
                    <td>{a.accountNo}</td>
                    <td>
                      {FORMAT_WORD[a.fileFormat] ?? a.fileFormat}
                      {a.fileFormat === 'CUSTOM_CSV'
                        ? ` · ${String(a.layout.columns?.length ?? 0)} column(s)`
                        : ''}
                    </td>
                    <td>
                      {can ? (
                        <DialogButton
                          id={`sb-edit-${a.id}`}
                          label="Change"
                          title={`Bank account: ${a.bankCode}`}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <BankAccountForm
                            account={a}
                            save={saveBankAccount.bind(null, a.id)}
                            idp={`sb-${a.id}`}
                          />
                        </DialogButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No account yet: every bank gets the default file.</p>
        )}
        {can ? (
          <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
            <DialogButton id="sb-add" label="＋ Add a bank account" title="Add a bank account">
              <BankAccountForm
                account={null}
                save={saveBankAccount.bind(null, null)}
                idp="sb-new"
              />
            </DialogButton>
          </div>
        ) : null}
      </section>
      <section className="ep-card" aria-labelledby="ledgers" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="ledgers" className="ep-card__title">
          The PF ECR and the salary voucher
        </h2>
        <form action={saveLedgers} className="ep-form-section__body">
          <fieldset
            className="ep-field"
            style={{ border: 0, padding: 0, margin: 0 }}
            disabled={!can}
          >
            <label className="ep-field" htmlFor="sb-arr">
              <span className="ep-field__label">Arrears in the PF ECR</span>
              <select
                id="sb-arr"
                name="ecrArrearMode"
                className="ep-input"
                defaultValue={String(settings.ecrArrearMode ?? 'FOLDED')}
              >
                <option value="FOLDED">Folded into the month’s wages (one file)</option>
                <option value="SEPARATE">A separate arrear file</option>
              </select>
            </label>
            <p className="ep-field__help">
              The voucher debits salaries by staff type and the employer’s contributions, and
              credits each deduction payable and the net salaries. Name the ledgers as your accounts
              package has them; one “name = ledger” a line. Left blank, the default names are used.
            </p>
            <div className="ep-form-row" data-columns="2">
              <label className="ep-field" htmlFor="sb-sal">
                <span className="ep-field__label">
                  Salaries, by staff type (Teaching = Salaries – Teaching Staff)
                </span>
                <textarea
                  id="sb-sal"
                  name="salary"
                  className="ep-input"
                  rows={4}
                  defaultValue={lines(led.salary)}
                />
              </label>
              <label className="ep-field" htmlFor="sb-heads">
                <span className="ep-field__label">
                  Deductions, by pay head (PT = Profession Tax Payable)
                </span>
                <textarea
                  id="sb-heads"
                  name="heads"
                  className="ep-input"
                  rows={4}
                  defaultValue={lines(led.heads)}
                />
              </label>
            </div>
            <div className="ep-form-row" data-columns="4">
              {(['PF', 'ESI', 'NPS', 'LWF'] as const).map((k) => (
                <label key={`e${k}`} className="ep-field" htmlFor={`sb-er-${k}`}>
                  <span className="ep-field__label">Employer {k} (cost)</span>
                  <input
                    id={`sb-er-${k}`}
                    name={`employer.${k}`}
                    className="ep-input"
                    maxLength={80}
                    defaultValue={led.employer?.[k] ?? ''}
                  />
                </label>
              ))}
            </div>
            <div className="ep-form-row" data-columns="4">
              {(['PF', 'ESI', 'NPS', 'LWF'] as const).map((k) => (
                <label key={`p${k}`} className="ep-field" htmlFor={`sb-pay-${k}`}>
                  <span className="ep-field__label">{k} payable</span>
                  <input
                    id={`sb-pay-${k}`}
                    name={`payable.${k}`}
                    className="ep-input"
                    maxLength={80}
                    defaultValue={led.payable?.[k] ?? ''}
                  />
                </label>
              ))}
            </div>
            <label className="ep-field" htmlFor="sb-net">
              <span className="ep-field__label">Net salaries payable</span>
              <input
                id="sb-net"
                name="net"
                className="ep-input"
                maxLength={80}
                defaultValue={led.net ?? ''}
              />
            </label>
          </fieldset>
          {can ? (
            <div className="ep-grid__toolbar">
              <button type="submit" className="ep-btn ep-btn--primary">
                Save
              </button>
            </div>
          ) : (
            <p className="ep-field__help">Only the payroll admin changes these.</p>
          )}
        </form>
      </section>
    </>
  );
}
