import { Badge, KpiTile } from '@edupro/ui';
import { DialogButton } from '@/components/leave/DialogButton';
import { apiFetch } from '@/lib/api';
import { money } from '@/lib/payroll';
import type {
  AdhocList,
  ClaimList,
  HoldList,
  LoanList,
  OvertimeList,
  PayeeList,
  RecurringList,
  StaffOption,
  TdsList,
} from '@/lib/payroll-inputs';
import {
  addAdhoc,
  addClaim,
  addRecurring,
  decideClaim,
  deleteAdhoc,
  deleteOvertime,
  deleteTds,
  liftHold,
  lopAction,
  recurringStatus,
  saveOvertime,
  savePayee,
  setHold,
  setTds,
} from '@/lib/payroll-inputs-actions';
import { LoanForm } from './LoanForm';
import { LopForm } from './LopForm';
import { MonthField, ReasonField, StaffSelect } from './StaffSelect';

const help = (t: string) => (
  <p className="ep-field__help" style={{ marginTop: 0 }}>
    {t}
  </p>
);
const sub = (t: string | null | undefined) =>
  t ? (
    <span className="ep-field__help" style={{ display: 'block', margin: 0 }}>
      {t}
    </span>
  ) : null;
const frozenOf = (runs: string[]) =>
  runs.some((s) => ['PROCESSING', 'APPROVED', 'LOCKED', 'PAID'].includes(s));

// ---- salary hold ------------------------------------------------------------------------------------------
export async function HoldTab({ month, staff }: { month: string; staff: StaffOption[] }) {
  const d = await apiFetch<HoldList>(`/payroll/inputs/holds?month=${month}`);
  const frozen = frozenOf(d.runs);
  return (
    <section className="ep-card" aria-labelledby="ih-t">
      <div className="ep-grid__toolbar">
        <h2 id="ih-t" className="ep-card__title">
          Salary hold
        </h2>
        <span className="ep-grid__spacer" />
        {d.can.approve && !frozen ? (
          <DialogButton id="ih-add" label="＋ Hold or skip" title="Hold or skip a salary">
            <form action={setHold.bind(null, month)} className="ep-form-section__body">
              <StaffSelect id="ih-emp" staff={staff} />
              <fieldset className="ep-field">
                <legend className="ep-field__label">How</legend>
                <label className="ep-check">
                  <input type="radio" name="mode" value="HOLD" defaultChecked /> Hold: worked out
                  this month, paid only when a checker releases it
                </label>
                <label className="ep-check">
                  <input type="radio" name="mode" value="SKIP" /> Skip: left out of this month (no
                  attendance needed)
                </label>
              </fieldset>
              <ReasonField id="ih-why" />
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {help(
        'A checker holds or skips an employee for the month. A held salary is worked out and paid when released; a skipped one is not in the month at all.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ih-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">How</th>
              <th scope="col">Reason</th>
              <th scope="col">By</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>
                    <Badge tone={!r.active ? 'neutral' : r.mode === 'HOLD' ? 'warning' : 'info'}>
                      {!r.active ? 'Lifted' : r.mode === 'HOLD' ? 'Held' : 'Skipped'}
                    </Badge>
                  </td>
                  <td>{r.reason}</td>
                  <td>{r.byName ?? ''}</td>
                  <td>
                    {r.active && d.can.approve && !frozen ? (
                      <DialogButton
                        id={`ih-lift-${r.id}`}
                        label="Lift"
                        title="Lift the hold"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                      >
                        <form
                          action={liftHold.bind(null, month, r.id)}
                          className="ep-form-section__body"
                        >
                          <ReasonField id={`ih-lw-${r.id}`} />
                          <p>
                            <button type="submit" className="ep-btn ep-btn--primary">
                              Lift
                            </button>
                          </p>
                        </form>
                      </DialogButton>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>Nobody is held or skipped this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- a month's tax typed by hand -----------------------------------------------------------------------------
export async function TaxTab({ month, staff }: { month: string; staff: StaffOption[] }) {
  const d = await apiFetch<TdsList>(`/payroll/inputs/tds?month=${month}`);
  return (
    <section className="ep-card" aria-labelledby="it-t">
      <div className="ep-grid__toolbar">
        <h2 id="it-t" className="ep-card__title">
          This month’s tax typed by hand
        </h2>
        <span className="ep-grid__spacer" />
        {d.can.manage ? (
          <DialogButton id="it-add" label="＋ Type a tax" title="This month’s tax for an employee">
            <form action={setTds.bind(null, month)} className="ep-form-section__body">
              <StaffSelect id="it-emp" staff={staff} />
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="it-it">
                  <span className="ep-field__label">Income tax (₹)</span>
                  <input
                    id="it-it"
                    name="itAmount"
                    className="ep-input"
                    required
                    inputMode="decimal"
                  />
                </label>
                <label className="ep-field" htmlFor="it-cess">
                  <span className="ep-field__label">Cess (₹)</span>
                  <input
                    id="it-cess"
                    name="cessAmount"
                    className="ep-input"
                    required
                    inputMode="decimal"
                    defaultValue="0"
                  />
                </label>
              </div>
              <ReasonField id="it-why" />
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {help(
        'Usually the run works out each month’s tax from the year’s projection. An amount typed here is taken instead, for this month only.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="it-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Income tax (₹)</th>
              <th scope="col">Cess (₹)</th>
              <th scope="col">Reason</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>{money(r.itAmount)}</td>
                  <td>{money(r.cessAmount)}</td>
                  <td>{r.reason}</td>
                  <td>
                    {d.can.manage ? (
                      <form action={deleteTds.bind(null, month, r.id)}>
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>No tax is typed for this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- loans and advances ----------------------------------------------------------------------------------------
export async function LoansTab({
  month,
  staff,
  sp,
}: {
  month: string;
  staff: StaffOption[];
  sp: Record<string, string | undefined>;
}) {
  const status = ['all', 'ACTIVE', 'HOLD', 'CLOSED'].includes(sp.status ?? '')
    ? sp.status!
    : 'ACTIVE';
  const d = await apiFetch<LoanList>(`/payroll/inputs/loans?status=${status}&size=100`);
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--3">
        <KpiTile label="Active" value={String(d.figures.active)} />
        <KpiTile label="On hold" value={String(d.figures.hold)} />
        <KpiTile label="Still owed" value={`₹${money(d.figures.owed)}`} />
      </div>
      <section className="ep-card" aria-labelledby="il-t">
        <div className="ep-grid__toolbar">
          <h2 id="il-t" className="ep-card__title">
            Loans and advances
          </h2>
          <nav aria-label="Show" className="ep-field__help">
            {(['ACTIVE', 'HOLD', 'CLOSED', 'all'] as const).map((x, i) => (
              <span key={x}>
                {i ? ' · ' : ''}
                {x === status ? (
                  <strong>{x === 'all' ? 'All' : x[0] + x.slice(1).toLowerCase()}</strong>
                ) : (
                  <a href={`/payroll/inputs?month=${month}&tab=loans&status=${x}`}>
                    {x === 'all' ? 'All' : x[0] + x.slice(1).toLowerCase()}
                  </a>
                )}
              </span>
            ))}
          </nav>
          <span className="ep-grid__spacer" />
          {d.can.manage ? (
            <DialogButton id="il-add" label="＋ New loan or advance" title="A loan or advance">
              <LoanForm month={month} staff={staff} />
            </DialogButton>
          ) : null}
        </div>
        {help(
          'Each run deducts the instalment (interest first) until nothing is owed. A loan on hold is skipped; a foreclosed one stops.',
        )}
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="il-t">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Kind</th>
                <th scope="col">Amount (₹)</th>
                <th scope="col">Instalment (₹)</th>
                <th scope="col">Interest</th>
                <th scope="col">Owed (₹)</th>
                <th scope="col">From</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/payroll/inputs/loans/${r.id}?month=${month}`}>{r.name}</a>
                      {sub(r.code)}
                    </td>
                    <td>{r.loanType}</td>
                    <td>{money(r.principal)}</td>
                    <td>{money(r.emi)}</td>
                    <td>
                      {r.interestMethod === 'NONE'
                        ? 'None'
                        : `${r.interestRate} % ${r.interestMethod === 'FLAT' ? 'flat' : 'reducing'}`}
                    </td>
                    <td>{money(r.balance)}</td>
                    <td>{r.startMonth}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'ACTIVE'
                            ? 'success'
                            : r.status === 'HOLD'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {r.status === 'ACTIVE'
                          ? 'Active'
                          : r.status === 'HOLD'
                            ? 'On hold'
                            : 'Closed'}
                      </Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8}>None.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---- one-off earnings and deductions ---------------------------------------------------------------------------
export async function AdhocTab({ month, staff }: { month: string; staff: StaffOption[] }) {
  const d = await apiFetch<AdhocList>(`/payroll/inputs/adhoc?month=${month}&size=100`);
  const REF: Record<string, string> = {
    FEE: 'Fee recovery',
    CLAIM: 'Claim',
    OT: 'Overtime',
    RECOVERY: 'Recovery',
    BONUS: 'Bonus',
    FNF: 'Full and final',
  };
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--3">
        <KpiTile label="Lines" value={String(d.figures.count)} />
        <KpiTile label="Earnings" value={`₹${money(d.figures.earnings)}`} />
        <KpiTile label="Deductions" value={`₹${money(d.figures.deductions)}`} />
      </div>
      <section className="ep-card" aria-labelledby="ix-t">
        <div className="ep-grid__toolbar">
          <h2 id="ix-t" className="ep-card__title">
            One-off earnings and deductions
          </h2>
          <span className="ep-grid__spacer" />
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={`/payroll/inputs/fee-recovery?month=${month}`}
          >
            Fee recovery
          </a>
          {d.can.manage ? (
            <DialogButton id="ix-add" label="＋ Add a line" title="A one-off earning or deduction">
              <form action={addAdhoc.bind(null, month)} className="ep-form-section__body">
                <StaffSelect id="ix-emp" staff={staff} />
                <div className="ep-profile__grid">
                  <label className="ep-field" htmlFor="ix-head">
                    <span className="ep-field__label">Pay head</span>
                    <select
                      id="ix-head"
                      name="payHeadId"
                      className="ep-select"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Choose…
                      </option>
                      {d.heads.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.code} · {h.name} ({h.headType === 'EARNING' ? 'earning' : 'deduction'})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="ix-amt">
                    <span className="ep-field__label">Amount (₹)</span>
                    <input
                      id="ix-amt"
                      name="amount"
                      className="ep-input"
                      required
                      inputMode="decimal"
                    />
                  </label>
                </div>
                <label className="ep-field" htmlFor="ix-why">
                  <span className="ep-field__label">Remarks</span>
                  <input
                    id="ix-why"
                    name="remarks"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={200}
                  />
                </label>
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Add
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
        </div>
        {help(
          'Paid or deducted once, with this month’s run. PF, ESI, tax and the like are worked out by payroll and are not typed here; an earning on the salary structure is changed there.',
        )}
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ix-t">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Pay head</th>
                <th scope="col">Earning (₹)</th>
                <th scope="col">Deduction (₹)</th>
                <th scope="col">From</th>
                <th scope="col">Remarks</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.length ? (
                d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {sub(r.code)}
                    </td>
                    <td>
                      <code>{r.headCode}</code> {r.headName}
                    </td>
                    <td>{r.headType === 'EARNING' ? money(r.amount) : ''}</td>
                    <td>{r.headType === 'DEDUCTION' ? money(r.amount) : ''}</td>
                    <td>
                      {r.refModule ? (REF[r.refModule] ?? r.refModule) : 'Typed'}
                      {r.receiptPending ? sub('Fee receipt at lock') : null}
                    </td>
                    <td>{r.remarks ?? ''}</td>
                    <td>
                      {r.paidInRecordId ? (
                        <Badge tone="success">Paid</Badge>
                      ) : d.can.manage && !['CLAIM', 'OT'].includes(r.refModule ?? '') ? (
                        <form action={deleteAdhoc.bind(null, month, r.id)}>
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No one-off lines this month.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---- recurring deductions and payees -----------------------------------------------------------------------------
const PARTY: Record<string, string> = {
  LIC: 'LIC',
  SOCIETY: 'Society',
  UNION: 'Union',
  COURT: 'Court order',
  OTHER: 'Other',
};
export async function RecurringTab({
  month,
  staff,
  sp,
}: {
  month: string;
  staff: StaffOption[];
  sp: Record<string, string | undefined>;
}) {
  if (sp.view === 'payees') return <PayeesView month={month} />;
  const status = ['all', 'ACTIVE', 'HOLD', 'ENDED'].includes(sp.status ?? '')
    ? sp.status!
    : 'ACTIVE';
  const d = await apiFetch<RecurringList>(`/payroll/inputs/recurring?status=${status}&size=100`);
  return (
    <section className="ep-card" aria-labelledby="ir-t">
      <div className="ep-grid__toolbar">
        <h2 id="ir-t" className="ep-card__title">
          Recurring deductions
        </h2>
        <nav aria-label="Show" className="ep-field__help">
          {(['ACTIVE', 'HOLD', 'ENDED', 'all'] as const).map((x, i) => (
            <span key={x}>
              {i ? ' · ' : ''}
              {x === status ? (
                <strong>{x === 'all' ? 'All' : x[0] + x.slice(1).toLowerCase()}</strong>
              ) : (
                <a href={`/payroll/inputs?month=${month}&tab=recurring&status=${x}`}>
                  {x === 'all' ? 'All' : x[0] + x.slice(1).toLowerCase()}
                </a>
              )}
            </span>
          ))}
        </nav>
        <span className="ep-grid__spacer" />
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/payroll/inputs?month=${month}&tab=recurring&view=payees`}
        >
          Payees
        </a>
        {d.can.manage ? (
          <DialogButton id="ir-add" label="＋ New deduction" title="A recurring deduction">
            <form action={addRecurring.bind(null, month)} className="ep-form-section__body">
              <StaffSelect id="ir-emp" staff={staff} />
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="ir-head">
                  <span className="ep-field__label">Pay head</span>
                  <select
                    id="ir-head"
                    name="payHeadId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {d.heads.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.code} · {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="ir-payee">
                  <span className="ep-field__label">Paid to</span>
                  <select id="ir-payee" name="payeeId" className="ep-select" defaultValue="">
                    <option value="">Nobody outside (the school keeps it)</option>
                    {d.payees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="ir-amt">
                  <span className="ep-field__label">Amount a month (₹)</span>
                  <input
                    id="ir-amt"
                    name="amount"
                    className="ep-input"
                    required
                    inputMode="decimal"
                  />
                </label>
                <label className="ep-field" htmlFor="ir-ref">
                  <span className="ep-field__label">Policy or reference</span>
                  <input id="ir-ref" name="referenceNo" className="ep-input" maxLength={60} />
                </label>
                <MonthField id="ir-from" name="startMonth" label="From" value={month} />
                <MonthField
                  id="ir-to"
                  name="endMonth"
                  label="Until"
                  required={false}
                  help="Empty: until stopped"
                />
              </div>
              <label className="ep-field" htmlFor="ir-rem">
                <span className="ep-field__label">Remarks</span>
                <input id="ir-rem" name="remarks" className="ep-input" maxLength={200} />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Add
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {help(
        'Deducted every month from its start until it ends: LIC premiums, society or union dues, court orders. The same deduction cannot run twice over the same months.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ir-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Pay head</th>
              <th scope="col">Paid to</th>
              <th scope="col">Amount (₹)</th>
              <th scope="col">Months</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>
                    <code>{r.headCode}</code> {r.headName}
                    {sub(r.referenceNo)}
                  </td>
                  <td>{r.payee ?? ''}</td>
                  <td>{money(r.amount)}</td>
                  <td>
                    {r.startMonth} – {r.endMonth ?? 'on'}
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.status === 'ACTIVE'
                          ? 'success'
                          : r.status === 'HOLD'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {r.status === 'ACTIVE' ? 'Active' : r.status === 'HOLD' ? 'On hold' : 'Ended'}
                    </Badge>
                  </td>
                  <td>
                    {d.can.manage && r.status !== 'ENDED' ? (
                      <DialogButton
                        id={`ir-st-${r.id}`}
                        label="Change"
                        title="Hold, resume or end it"
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                      >
                        <form
                          action={recurringStatus.bind(null, month, r.id)}
                          className="ep-form-section__body"
                        >
                          <label className="ep-field" htmlFor={`ir-s-${r.id}`}>
                            <span className="ep-field__label">Now</span>
                            <select
                              id={`ir-s-${r.id}`}
                              name="status"
                              className="ep-select"
                              defaultValue={r.status === 'ACTIVE' ? 'HOLD' : 'ACTIVE'}
                            >
                              <option value="ACTIVE">Active</option>
                              <option value="HOLD">On hold (skipped)</option>
                              <option value="ENDED">Ended</option>
                            </select>
                          </label>
                          <MonthField
                            id={`ir-e-${r.id}`}
                            name="endMonth"
                            label="Last month deducted (when ending)"
                            required={false}
                          />
                          <ReasonField id={`ir-w-${r.id}`} />
                          <p>
                            <button type="submit" className="ep-btn ep-btn--primary">
                              Save
                            </button>
                          </p>
                        </form>
                      </DialogButton>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>None.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function PayeesView({ month }: { month: string }) {
  const d = await apiFetch<PayeeList>('/payroll/inputs/payees');
  const form = (p: PayeeList['rows'][number] | null) => (
    <form action={savePayee.bind(null, month, p?.id ?? null)} className="ep-form-section__body">
      <div className="ep-profile__grid">
        <label className="ep-field" htmlFor={`py-n-${p?.id ?? 'new'}`}>
          <span className="ep-field__label">Name</span>
          <input
            id={`py-n-${p?.id ?? 'new'}`}
            name="name"
            className="ep-input"
            required
            maxLength={120}
            defaultValue={p?.name ?? ''}
          />
        </label>
        <label className="ep-field" htmlFor={`py-t-${p?.id ?? 'new'}`}>
          <span className="ep-field__label">Kind</span>
          <select
            id={`py-t-${p?.id ?? 'new'}`}
            name="partyType"
            className="ep-select"
            defaultValue={p?.partyType ?? 'LIC'}
          >
            {Object.entries(PARTY).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field" htmlFor={`py-a-${p?.id ?? 'new'}`}>
          <span className="ep-field__label">Their account</span>
          <input
            id={`py-a-${p?.id ?? 'new'}`}
            name="payeeAccount"
            className="ep-input"
            maxLength={80}
            defaultValue={p?.payeeAccount ?? ''}
          />
        </label>
      </div>
      <label className="ep-field" htmlFor={`py-r-${p?.id ?? 'new'}`}>
        <span className="ep-field__label">Remarks</span>
        <input
          id={`py-r-${p?.id ?? 'new'}`}
          name="remarks"
          className="ep-input"
          maxLength={200}
          defaultValue={p?.remarks ?? ''}
        />
      </label>
      {p ? (
        <label className="ep-check">
          <input type="checkbox" name="active" value="off" defaultChecked={!p.active} /> No longer
          in use
        </label>
      ) : null}
      <p>
        <button type="submit" className="ep-btn ep-btn--primary">
          Save
        </button>
      </p>
    </form>
  );
  return (
    <section className="ep-card" aria-labelledby="py-t">
      <div className="ep-grid__toolbar">
        <h2 id="py-t" className="ep-card__title">
          Payees
        </h2>
        <span className="ep-grid__spacer" />
        <a
          className="ep-btn ep-btn--ghost ep-btn--sm"
          href={`/payroll/inputs?month=${month}&tab=recurring`}
        >
          Back to the deductions
        </a>
        {d.can.manage ? (
          <DialogButton id="py-add" label="＋ New payee" title="A payee">
            {form(null)}
          </DialogButton>
        ) : null}
      </div>
      {help('Who the recurring deductions are paid to: LIC, the staff society, a union, a court.')}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="py-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Payee</th>
              <th scope="col">Kind</th>
              <th scope="col">Account</th>
              <th scope="col">Deductions</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name} {p.active ? null : <Badge tone="neutral">Not in use</Badge>}
                  </td>
                  <td>{PARTY[p.partyType] ?? p.partyType}</td>
                  <td>{p.payeeAccount ?? ''}</td>
                  <td>{p.deductions}</td>
                  <td>
                    {d.can.manage ? (
                      <DialogButton
                        id={`py-e-${p.id}`}
                        label="Change"
                        title={`Change ${p.name}`}
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                      >
                        {form(p)}
                      </DialogButton>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>No payees yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- claims --------------------------------------------------------------------------------------------------
export async function ClaimsTab({
  month,
  staff,
  sp,
}: {
  month: string;
  staff: StaffOption[];
  sp: Record<string, string | undefined>;
}) {
  const status = ['all', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'].includes(sp.status ?? '')
    ? sp.status!
    : 'SUBMITTED';
  const d = await apiFetch<ClaimList>(`/payroll/inputs/claims?status=${status}&size=100`);
  const WORD: Record<string, string> = {
    SUBMITTED: 'Waiting',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    PAID: 'Paid',
    all: 'All',
  };
  return (
    <section className="ep-card" aria-labelledby="ic-t">
      <div className="ep-grid__toolbar">
        <h2 id="ic-t" className="ep-card__title">
          Claims {d.waiting ? <Badge tone="warning">{`${String(d.waiting)} waiting`}</Badge> : null}
        </h2>
        <nav aria-label="Show" className="ep-field__help">
          {(['SUBMITTED', 'APPROVED', 'PAID', 'REJECTED', 'all'] as const).map((x, i) => (
            <span key={x}>
              {i ? ' · ' : ''}
              {x === status ? (
                <strong>{WORD[x]}</strong>
              ) : (
                <a href={`/payroll/inputs?month=${month}&tab=claims&status=${x}`}>{WORD[x]}</a>
              )}
            </span>
          ))}
        </nav>
        <span className="ep-grid__spacer" />
        {d.can.manage && d.heads.length ? (
          <DialogButton id="ic-add" label="＋ Enter a claim" title="A claim (reimbursement)">
            <form action={addClaim.bind(null, month)} className="ep-form-section__body">
              <StaffSelect id="ic-emp" staff={staff} />
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="ic-head">
                  <span className="ep-field__label">For</span>
                  <select
                    id="ic-head"
                    name="payHeadId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {d.heads.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="ic-amt">
                  <span className="ep-field__label">Amount claimed (₹)</span>
                  <input
                    id="ic-amt"
                    name="amountClaimed"
                    className="ep-input"
                    required
                    inputMode="decimal"
                  />
                </label>
                <label className="ep-field" htmlFor="ic-bill">
                  <span className="ep-field__label">Bill date</span>
                  <input id="ic-bill" name="billDate" type="date" className="ep-input" />
                </label>
              </div>
              <label className="ep-field" htmlFor="ic-desc">
                <span className="ep-field__label">What it is for</span>
                <input
                  id="ic-desc"
                  name="description"
                  className="ep-input"
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Enter
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {help(
        d.heads.length
          ? 'A checker who did not enter a claim approves it — paid with the month chosen — or rejects it with a reason.'
          : 'No pay head of the kind “Reimbursement” is in use: add one in Pay heads to take claims.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="ic-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">For</th>
              <th scope="col">Claimed (₹)</th>
              <th scope="col">Approved (₹)</th>
              <th scope="col">Status</th>
              <th scope="col">Entered · decided by</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>
                    {r.headName}
                    {sub(`${r.description}${r.billDate ? ` · bill ${r.billDate}` : ''}`)}
                  </td>
                  <td>{money(r.amountClaimed)}</td>
                  <td>
                    {r.amountApproved ? money(r.amountApproved) : ''}
                    {sub(r.payMonth ? `with ${r.payMonth}` : null)}
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.status === 'SUBMITTED'
                          ? 'warning'
                          : r.status === 'REJECTED'
                            ? 'danger'
                            : 'success'
                      }
                    >
                      {WORD[r.status]}
                    </Badge>
                    {sub(r.decisionRemark)}
                  </td>
                  <td>
                    {r.byName ?? ''}
                    {r.decidedByName ? ` · ${r.decidedByName}` : ''}
                  </td>
                  <td>
                    {r.status === 'SUBMITTED' && d.can.approve && !r.mine ? (
                      <DialogButton
                        id={`ic-d-${r.id}`}
                        label="Decide"
                        title="Decide the claim"
                        className="ep-btn ep-btn--primary ep-btn--sm"
                      >
                        <form
                          action={decideClaim.bind(null, month, r.id)}
                          className="ep-form-section__body"
                        >
                          <div className="ep-profile__grid">
                            <label className="ep-field" htmlFor={`ic-a-${r.id}`}>
                              <span className="ep-field__label">Approve (₹)</span>
                              <input
                                id={`ic-a-${r.id}`}
                                name="amountApproved"
                                className="ep-input"
                                inputMode="decimal"
                                defaultValue={r.amountClaimed}
                              />
                            </label>
                            <MonthField
                              id={`ic-m-${r.id}`}
                              name="payMonth"
                              label="Paid with"
                              value={month}
                              required={false}
                            />
                          </div>
                          <label className="ep-field" htmlFor={`ic-r-${r.id}`}>
                            <span className="ep-field__label">Remark (needed to reject)</span>
                            <input
                              id={`ic-r-${r.id}`}
                              name="remark"
                              className="ep-input"
                              maxLength={300}
                            />
                          </label>
                          <p className="ep-grid__toolbar">
                            <button
                              type="submit"
                              name="decision"
                              value="APPROVED"
                              className="ep-btn ep-btn--primary"
                            >
                              Approve
                            </button>
                            <button
                              type="submit"
                              name="decision"
                              value="REJECTED"
                              className="ep-btn ep-btn--danger"
                            >
                              Reject
                            </button>
                          </p>
                        </form>
                      </DialogButton>
                    ) : r.status === 'SUBMITTED' && r.mine ? (
                      sub('Entered by you: another checker decides')
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>None.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- rate-based overtime ----------------------------------------------------------------------------------------
export async function OvertimeTab({ month, staff }: { month: string; staff: StaffOption[] }) {
  const d = await apiFetch<OvertimeList>(`/payroll/inputs/overtime?month=${month}`);
  return (
    <section className="ep-card" aria-labelledby="io-t">
      <div className="ep-grid__toolbar">
        <h2 id="io-t" className="ep-card__title">
          Overtime at the school’s rate — ₹{money(d.total)}
        </h2>
        <span className="ep-grid__spacer" />
        {d.can.manage ? (
          <DialogButton id="io-add" label="＋ Overtime" title="Overtime for the month">
            <form action={saveOvertime.bind(null, month)} className="ep-form-section__body">
              <StaffSelect id="io-emp" staff={staff} />
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="io-basis">
                  <span className="ep-field__label">By the</span>
                  <select id="io-basis" name="basis" className="ep-select" defaultValue="HOUR">
                    <option value="HOUR">Hour</option>
                    <option value="DAY">Day</option>
                  </select>
                </label>
                <label className="ep-field" htmlFor="io-qty">
                  <span className="ep-field__label">How many</span>
                  <input id="io-qty" name="qty" className="ep-input" required inputMode="decimal" />
                </label>
                <label className="ep-field" htmlFor="io-amt">
                  <span className="ep-field__label">Pay instead (₹)</span>
                  <input id="io-amt" name="amount" className="ep-input" inputMode="decimal" />
                  <span className="ep-field__help">Empty: rate × how many</span>
                </label>
              </div>
              <label className="ep-field" htmlFor="io-why">
                <span className="ep-field__label">Reason (needed when the amount differs)</span>
                <input id="io-why" name="reason" className="ep-input" maxLength={200} />
              </label>
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </p>
            </form>
          </DialogButton>
        ) : null}
      </div>
      {help(
        'Paid at the dated overtime rate of the employee’s type (Payroll set-up → Rates → Overtime rates). One entry an employee a month: saving again replaces it. The OT formula head on the structure is then not worked out for that month.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="io-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">How many</th>
              <th scope="col">Rate (₹)</th>
              <th scope="col">Rate × how many (₹)</th>
              <th scope="col">Paid (₹)</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>
                    {r.qty} {r.basis === 'DAY' ? 'day(s)' : 'hour(s)'}
                  </td>
                  <td>{money(r.rate)}</td>
                  <td>{money(r.derivedAmount)}</td>
                  <td>
                    {money(r.amount)}
                    {sub(r.reason)}
                  </td>
                  <td>
                    {r.paid ? (
                      <Badge tone="success">Paid</Badge>
                    ) : d.can.manage ? (
                      <form action={deleteOvertime.bind(null, month, r.id)}>
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6}>No overtime entered this month.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- loss-of-pay reversal ---------------------------------------------------------------------------------------
interface LopList {
  rows: Array<{
    id: string;
    code: string;
    name: string;
    sourceMonth: string;
    days: string;
    amountPf: string;
    amountOther: string;
    reason: string;
    status: 'DRAFT' | 'APPROVED' | 'CANCELLED';
    cancelledReason: string | null;
    byName: string | null;
    approvedByName: string | null;
    mine: boolean;
    paid: boolean | null;
  }>;
  can: { manage: boolean; approve: boolean; admin: boolean };
}
export async function LopTab({
  month,
  staff,
  sp,
}: {
  month: string;
  staff: StaffOption[];
  sp: Record<string, string | undefined>;
}) {
  const status = ['all', 'DRAFT', 'APPROVED', 'CANCELLED'].includes(sp.status ?? '')
    ? sp.status!
    : 'DRAFT';
  const d = await apiFetch<LopList>(`/payroll/lop-reversals?status=${status}`);
  const WORD: Record<string, string> = {
    DRAFT: 'Waiting',
    APPROVED: 'Approved',
    CANCELLED: 'Cancelled',
    all: 'All',
  };
  return (
    <section className="ep-card" aria-labelledby="iv-t">
      <div className="ep-grid__toolbar">
        <h2 id="iv-t" className="ep-card__title">
          Loss-of-pay reversal
        </h2>
        <nav aria-label="Show" className="ep-field__help">
          {(['DRAFT', 'APPROVED', 'CANCELLED', 'all'] as const).map((x, i) => (
            <span key={x}>
              {i ? ' · ' : ''}
              {x === status ? (
                <strong>{WORD[x]}</strong>
              ) : (
                <a href={`/payroll/inputs?month=${month}&tab=lop&status=${x}`}>{WORD[x]}</a>
              )}
            </span>
          ))}
        </nav>
        <span className="ep-grid__spacer" />
        {d.can.manage ? (
          <DialogButton id="iv-add" label="＋ New reversal" title="A loss-of-pay reversal">
            <LopForm month={month} staff={staff} />
          </DialogButton>
        ) : null}
      </div>
      {help(
        'Days of a locked month given back or charged after it was paid. A checker who did not stage it approves; it is paid as two arrears (with and without PF) by the next run.',
      )}
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="iv-t">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Employee</th>
              <th scope="col">Month</th>
              <th scope="col">Days</th>
              <th scope="col">With PF (₹)</th>
              <th scope="col">Without (₹)</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="ep-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {d.rows.length ? (
              d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name}
                    {sub(r.code)}
                  </td>
                  <td>
                    {r.sourceMonth}
                    {sub(r.reason)}
                  </td>
                  <td>{r.days}</td>
                  <td>{money(r.amountPf)}</td>
                  <td>{money(r.amountOther)}</td>
                  <td>
                    <Badge
                      tone={
                        r.status === 'APPROVED'
                          ? 'success'
                          : r.status === 'DRAFT'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {WORD[r.status]}
                    </Badge>
                    {r.paid ? sub('Paid') : null}
                    {sub(r.cancelledReason)}
                    {sub([r.byName, r.approvedByName].filter(Boolean).join(' · '))}
                  </td>
                  <td>
                    <div className="ep-grid__toolbar">
                      {r.status === 'DRAFT' && d.can.approve && (!r.mine || d.can.admin) ? (
                        <form action={lopAction.bind(null, month, r.id, 'approve')}>
                          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                            Approve
                          </button>
                        </form>
                      ) : null}
                      {(r.status === 'DRAFT' && d.can.manage) ||
                      (r.status === 'APPROVED' && d.can.approve && !r.paid) ? (
                        <DialogButton
                          id={`iv-c-${r.id}`}
                          label="Cancel"
                          title="Cancel the reversal"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                        >
                          <form
                            action={lopAction.bind(null, month, r.id, 'cancel')}
                            className="ep-form-section__body"
                          >
                            <ReasonField id={`iv-cw-${r.id}`} />
                            <p>
                              <button type="submit" className="ep-btn ep-btn--danger">
                                Cancel it
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
                <td colSpan={7}>None.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
