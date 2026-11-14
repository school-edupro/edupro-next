import { Badge, KpiTile } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { DialogButton } from '@/components/leave/DialogButton';
import { apiFetch } from '@/lib/api';
import { money } from '@/lib/payroll';
import {
  addChallan,
  certificateStep,
  declareFor,
  decideDeclaration,
  decidePrev,
  freezeYear,
  panCheck,
  partA,
  perqAction,
  prevFor,
  removeChallan,
  savePerq,
  saveTaxYear,
} from '@/lib/payroll-tax-actions';
import { DeclareForm, type TaxLabel } from './DeclareForm';

type Staff = Array<{ id: string; code: string; name: string }>;
const file = (q: string) => `/api/payroll/pay-file?${q}`;
const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
const STATUS = {
  SUBMITTED: ['Waiting', 'neutral'],
  VERIFIED: ['Verified', 'success'],
  REJECTED: ['Rejected', 'danger'],
} as const;
const reasonField = (id: string, label = 'Why') => (
  <label className="ep-field" htmlFor={id}>
    <span className="ep-field__label">{label}</span>
    <textarea
      id={id}
      name="reason"
      className="ep-input"
      rows={3}
      required
      minLength={3}
      maxLength={300}
    />
  </label>
);
const staffSelect = (id: string, staff: Staff) => (
  <label className="ep-field" htmlFor={id}>
    <span className="ep-field__label">Employee</span>
    <select id={id} name="employeeId" className="ep-select" required defaultValue="">
      <option value="" disabled>
        Choose…
      </option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} · {s.name}
        </option>
      ))}
    </select>
  </label>
);

// ---- declarations ------------------------------------------------------------------------------------------------
interface DeclList {
  year: { proofDue: string; declareFrom: string; declareTo: string };
  labels: TaxLabel[];
  rows: Array<{
    id: string;
    employeeId: string;
    code: string;
    name: string;
    lineCode: string;
    label: string | null;
    declared: string;
    verified: string | null;
    status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
    rejectReason: string | null;
    enteredFor: boolean;
    proofFileIds: string[];
    own: boolean;
    detail: {
      city?: string;
      listedCity?: boolean;
      landlord?: { name: string; relation: string; panMasked: string | null };
    };
  }>;
  counts: Record<string, number>;
  can: { manage: boolean; decide: boolean };
}

export async function DeclarationsTab({
  fy,
  status,
  staff,
}: {
  fy: string;
  status: string;
  staff: Staff;
}) {
  const d = await apiFetch<DeclList>(`/payroll/tax/declarations?fy=${fy}&status=${status}`);
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Waiting" value={String(d.counts.SUBMITTED ?? 0)} />
        <KpiTile label="Verified" value={String(d.counts.VERIFIED ?? 0)} />
        <KpiTile label="Rejected" value={String(d.counts.REJECTED ?? 0)} />
        <KpiTile label="Proof deadline" value={dmy(d.year.proofDue)} />
      </div>
      <section className="ep-card" aria-labelledby="tc-decl">
        <h2 id="tc-decl" className="ep-card__title">
          Declarations
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          A declared amount counts in the monthly tax until {dmy(d.year.proofDue)}; after that only
          a verified one does. Verify all or part of it from the proofs, or reject it with a reason.
          Your own declaration is verified by another checker.
        </p>
        <nav className="ep-tabs" aria-label="Show">
          {(['SUBMITTED', 'VERIFIED', 'REJECTED', 'ALL'] as const).map((x) => (
            <a
              key={x}
              className="ep-tabs__tab"
              href={`/payroll/tax?fy=${fy}&tab=declarations&status=${x}`}
              aria-current={x === status ? 'page' : undefined}
            >
              {x === 'ALL' ? 'All' : STATUS[x][0]}
            </a>
          ))}
        </nav>
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tc-decl">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Section</th>
                  <th scope="col">Declared (₹)</th>
                  <th scope="col">Verified (₹)</th>
                  <th scope="col">Proofs</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/payroll/tax/employees/${r.employeeId}?fy=${fy}`}>{r.name}</a>{' '}
                      <span className="ep-field__help">{r.code}</span>
                    </td>
                    <td>
                      {r.label ?? r.lineCode}
                      {r.detail.landlord ? (
                        <div className="ep-field__help">
                          {r.detail.city}
                          {r.detail.listedCity ? ' (50 %)' : ' (40 %)'} · {r.detail.landlord.name},{' '}
                          {r.detail.landlord.relation}
                          {r.detail.landlord.panMasked
                            ? ` · PAN ${r.detail.landlord.panMasked}`
                            : ''}
                        </div>
                      ) : null}
                      {r.enteredFor ? (
                        <div className="ep-field__help">Entered by payroll</div>
                      ) : null}
                    </td>
                    <td>{money(r.declared)}</td>
                    <td>{r.verified ? money(r.verified) : '—'}</td>
                    <td>
                      {r.proofFileIds.length
                        ? r.proofFileIds.map((p, i) => (
                            <FileLinks
                              key={p}
                              href={file(`kind=proof&id=${p}`)}
                              label={`proof ${String(i + 1)} of ${r.name}`}
                            />
                          ))
                        : '—'}
                    </td>
                    <td>
                      <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                      {r.rejectReason ? (
                        <div className="ep-field__help">{r.rejectReason}</div>
                      ) : null}
                    </td>
                    <td>
                      {d.can.decide && !r.own && r.status === 'SUBMITTED' ? (
                        <>
                          <DialogButton
                            id={`tc-v-${r.id}`}
                            label="Verify"
                            title={`Verify: ${r.name}, ${r.label ?? r.lineCode}`}
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                          >
                            <form
                              action={decideDeclaration.bind(null, fy, r.id, 'verify')}
                              className="ep-form-section__body"
                            >
                              <label className="ep-field" htmlFor={`tc-va-${r.id}`}>
                                <span className="ep-field__label">
                                  Verified amount (₹; up to ₹{money(r.declared)})
                                </span>
                                <input
                                  id={`tc-va-${r.id}`}
                                  name="verified"
                                  className="ep-input"
                                  defaultValue={r.declared}
                                  inputMode="decimal"
                                  pattern="[0-9,]+(\.[0-9]{1,2})?"
                                />
                              </label>
                              <div className="ep-grid__toolbar">
                                <button type="submit" className="ep-btn ep-btn--primary">
                                  Verify
                                </button>
                              </div>
                            </form>
                          </DialogButton>{' '}
                          <DialogButton
                            id={`tc-r-${r.id}`}
                            label="Reject"
                            title={`Reject: ${r.name}, ${r.label ?? r.lineCode}`}
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                          >
                            <form
                              action={decideDeclaration.bind(null, fy, r.id, 'reject')}
                              className="ep-form-section__body"
                            >
                              {reasonField(`tc-rr-${r.id}`, 'Why (the employee sees it)')}
                              <div className="ep-grid__toolbar">
                                <button type="submit" className="ep-btn ep-btn--danger">
                                  Reject
                                </button>
                              </div>
                            </form>
                          </DialogButton>
                        </>
                      ) : null}
                      {d.can.decide && !r.own && r.status !== 'SUBMITTED' ? (
                        <form action={decideDeclaration.bind(null, fy, r.id, 'reopen')}>
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            Reopen
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No declaration here.</p>
        )}
        {d.can.manage ? (
          <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
            <DialogButton
              id="tc-for"
              label="＋ Declare for an employee"
              title="Declare for an employee without a sign-in"
            >
              <DeclareForm
                fy={fy}
                labels={d.labels}
                action={declareFor.bind(null, fy)}
                idp="tcf"
                staff={staff}
              />
            </DialogButton>
          </div>
        ) : null}
      </section>
    </>
  );
}

// ---- earlier employers -----------------------------------------------------------------------------------------
export async function PrevTab({
  fy,
  staff,
  canManage,
}: {
  fy: string;
  staff: Staff;
  canManage: boolean;
}) {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      employeeId: string;
      code: string;
      name: string;
      employerName: string;
      employerTan: string | null;
      gross: string;
      exempt: string;
      pf: string;
      pt: string;
      tds: string;
      status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
      rejectReason: string | null;
      proofFileIds: string[];
      own: boolean;
    }>;
    can: { decide: boolean };
  }>(`/payroll/tax/prev?fy=${fy}`);
  return (
    <section className="ep-card" aria-labelledby="tc-prev">
      <h2 id="tc-prev" className="ep-card__title">
        Earlier employers this year
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Salary and tax from an employer before this school in the year (Form 122; 12B before
        2026-27). It counts in the tax like a declaration: until the proof deadline as entered, then
        once verified.
      </p>
      {d.rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tc-prev">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Employer</th>
                <th scope="col">Salary (₹)</th>
                <th scope="col">Tax (₹)</th>
                <th scope="col">Proof</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} <span className="ep-field__help">{r.code}</span>
                  </td>
                  <td>
                    {r.employerName}
                    {r.employerTan ? (
                      <div className="ep-field__help">TAN {r.employerTan}</div>
                    ) : null}
                  </td>
                  <td>{money(r.gross)}</td>
                  <td>{money(r.tds)}</td>
                  <td>
                    {r.proofFileIds.length
                      ? r.proofFileIds.map((p) => (
                          <FileLinks
                            key={p}
                            href={file(`kind=proof&id=${p}`)}
                            label={`proof of ${r.name}`}
                          />
                        ))
                      : '—'}
                  </td>
                  <td>
                    <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                    {r.rejectReason ? <div className="ep-field__help">{r.rejectReason}</div> : null}
                  </td>
                  <td>
                    {d.can.decide && !r.own && r.status === 'SUBMITTED' ? (
                      <>
                        <form
                          action={decidePrev.bind(null, fy, r.id, 'verify')}
                          style={{ display: 'inline' }}
                        >
                          <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                            Verify
                          </button>
                        </form>{' '}
                        <DialogButton
                          id={`tc-pr-${r.id}`}
                          label="Reject"
                          title={`Reject: ${r.name}`}
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                        >
                          <form
                            action={decidePrev.bind(null, fy, r.id, 'reject')}
                            className="ep-form-section__body"
                          >
                            {reasonField(`tc-prr-${r.id}`)}
                            <div className="ep-grid__toolbar">
                              <button type="submit" className="ep-btn ep-btn--danger">
                                Reject
                              </button>
                            </div>
                          </form>
                        </DialogButton>
                      </>
                    ) : d.can.decide && !r.own ? (
                      <form action={decidePrev.bind(null, fy, r.id, 'reopen')}>
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          Reopen
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>None this year.</p>
      )}
      {canManage ? (
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <DialogButton
            id="tc-prev-for"
            label="＋ For an employee"
            title="An earlier employer, for an employee without a sign-in"
          >
            <form action={prevFor.bind(null, fy)} className="ep-form-section__body">
              {staffSelect('tc-pe', staff)}
              <div className="ep-form-row" data-columns="2">
                <label className="ep-field" htmlFor="tc-pn">
                  <span className="ep-field__label">Employer</span>
                  <input
                    id="tc-pn"
                    name="employerName"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={150}
                  />
                </label>
                <label className="ep-field" htmlFor="tc-pt">
                  <span className="ep-field__label">Employer’s TAN</span>
                  <input
                    id="tc-pt"
                    name="employerTan"
                    className="ep-input"
                    pattern="[A-Za-z]{4}[0-9]{5}[A-Za-z]"
                    maxLength={10}
                  />
                </label>
                {(
                  [
                    ['gross', 'Gross salary (₹)', true],
                    ['exempt', 'Exempt allowances (₹)', false],
                    ['pf', 'PF deducted (₹)', false],
                    ['pt', 'Profession tax (₹)', false],
                    ['tds', 'Tax deducted (₹)', false],
                  ] as const
                ).map(([n, l, req]) => (
                  <label key={n} className="ep-field" htmlFor={`tc-p-${n}`}>
                    <span className="ep-field__label">{l}</span>
                    <input
                      id={`tc-p-${n}`}
                      name={n}
                      className="ep-input"
                      required={req}
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                ))}
              </div>
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </DialogButton>
        </div>
      ) : null}
    </section>
  );
}

// ---- perquisites ----------------------------------------------------------------------------------------------
const PERQ: Record<string, string> = {
  EDUCATION: 'Free or concessional education of a ward',
  ACCOMMODATION: 'Accommodation',
  VEHICLE: 'Vehicle',
  LOAN_INTEREST: 'Interest-free or concessional loan',
  MEDICAL: 'Medical',
  OTHER: 'Other',
};

export async function PerqTab({ fy, staff }: { fy: string; staff: Staff }) {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      code: string;
      name: string;
      perqType: string;
      amount: string;
      description: string | null;
      verified: boolean;
    }>;
    can: { manage: boolean; verify: boolean };
  }>(`/payroll/tax/perquisites?fy=${fy}`);
  return (
    <section className="ep-card" aria-labelledby="tc-perq">
      <h2 id="tc-perq" className="ep-card__title">
        Perquisites
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        The taxable value for the year of what the school gives besides pay (never a pay line). It
        counts in the tax once a checker who did not enter it verifies it.
      </p>
      {d.rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tc-perq">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Perquisite</th>
                <th scope="col">Value (₹)</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="ep-sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} <span className="ep-field__help">{r.code}</span>
                  </td>
                  <td>
                    {PERQ[r.perqType] ?? r.perqType}
                    {r.description ? <div className="ep-field__help">{r.description}</div> : null}
                  </td>
                  <td>{money(r.amount)}</td>
                  <td>
                    <Badge tone={r.verified ? 'success' : 'neutral'}>
                      {r.verified ? 'Verified' : 'Waiting'}
                    </Badge>
                  </td>
                  <td>
                    {d.can.verify ? (
                      <form
                        action={perqAction.bind(null, fy, r.id, r.verified ? 'unverify' : 'verify')}
                        style={{ display: 'inline' }}
                      >
                        <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                          {r.verified ? 'Unverify' : 'Verify'}
                        </button>
                      </form>
                    ) : null}{' '}
                    {d.can.manage ? (
                      <form
                        action={perqAction.bind(null, fy, r.id, 'delete')}
                        style={{ display: 'inline' }}
                      >
                        <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                          Remove
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>None this year.</p>
      )}
      {d.can.manage ? (
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <DialogButton
            id="tc-perq-add"
            label="＋ Perquisite"
            title="A perquisite’s value for the year"
          >
            <form action={savePerq.bind(null, fy)} className="ep-form-section__body">
              {staffSelect('tc-qe', staff)}
              <label className="ep-field" htmlFor="tc-qt">
                <span className="ep-field__label">Perquisite</span>
                <select id="tc-qt" name="perqType" className="ep-select">
                  {Object.entries(PERQ).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="tc-qa">
                <span className="ep-field__label">Taxable value for the year (₹)</span>
                <input
                  id="tc-qa"
                  name="amount"
                  className="ep-input"
                  required
                  inputMode="decimal"
                  pattern="[0-9,]+(\.[0-9]{1,2})?"
                />
              </label>
              <label className="ep-field" htmlFor="tc-qd">
                <span className="ep-field__label">How it was valued</span>
                <input id="tc-qd" name="description" className="ep-input" maxLength={200} />
              </label>
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </DialogButton>
        </div>
      ) : null}
    </section>
  );
}

// ---- challans and the return ---------------------------------------------------------------------------------------
const MONTHS = [
  '',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const QUARTERS: Record<number, number[]> = {
  1: [4, 5, 6],
  2: [7, 8, 9],
  3: [10, 11, 12],
  4: [1, 2, 3],
};

export async function ChallansTab({ fy }: { fy: string }) {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      quarter: number;
      bsrCode: string;
      challanNo: string;
      depositedOn: string;
      amount: string;
      interest: string;
      months: number[];
      deducted: string;
      difference: string;
    }>;
    months: Array<{ month: number; deducted: string; covered: boolean }>;
    can: { manage: boolean; remove: boolean };
  }>(`/payroll/tax/challans?fy=${fy}`);
  const uncovered = d.months.filter((m) => !m.covered && Number(m.deducted) > 0);
  return (
    <>
      {uncovered.length ? (
        <p className="ep-alert ep-alert--warning" role="status">
          TDS deducted with no challan yet:{' '}
          {uncovered.map((m) => `${MONTHS[m.month] ?? ''} ₹${money(m.deducted)}`).join(', ')}.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="tc-ch">
        <h2 id="tc-ch" className="ep-card__title">
          TDS challans
        </h2>
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tc-ch">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Quarter</th>
                  <th scope="col">Challan</th>
                  <th scope="col">Deposited</th>
                  <th scope="col">Months</th>
                  <th scope="col">Amount (₹)</th>
                  <th scope="col">Deducted (₹)</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>Q{r.quarter}</td>
                    <td>
                      {r.bsrCode} / {r.challanNo}
                    </td>
                    <td>{dmy(r.depositedOn)}</td>
                    <td>{r.months.map((m) => MONTHS[m]).join(', ')}</td>
                    <td>{money(r.amount)}</td>
                    <td>
                      {money(r.deducted)}
                      {Number(r.difference) ? (
                        <div className="ep-field__help">differs by {money(r.difference)}</div>
                      ) : null}
                    </td>
                    <td>
                      {d.can.remove ? (
                        <DialogButton
                          id={`tc-chr-${r.id}`}
                          label="Remove"
                          title="Remove the challan"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                        >
                          <form
                            action={removeChallan.bind(null, fy, r.id)}
                            className="ep-form-section__body"
                          >
                            {reasonField(`tc-chrr-${r.id}`)}
                            <div className="ep-grid__toolbar">
                              <button type="submit" className="ep-btn ep-btn--danger">
                                Remove
                              </button>
                            </div>
                          </form>
                        </DialogButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No challan entered for {fy}.</p>
        )}
        {d.can.manage ? (
          <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
            <DialogButton id="tc-ch-add" label="＋ Challan" title="A TDS challan">
              <form action={addChallan.bind(null, fy)} className="ep-form-section__body">
                <div className="ep-form-row" data-columns="2">
                  <label className="ep-field" htmlFor="tc-cq">
                    <span className="ep-field__label">Quarter</span>
                    <select id="tc-cq" name="quarter" className="ep-select">
                      {[1, 2, 3, 4].map((q) => (
                        <option key={q} value={q}>
                          Q{q} ({QUARTERS[q]!.map((m) => MONTHS[m]).join(', ')})
                        </option>
                      ))}
                    </select>
                  </label>
                  <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="ep-field__label">Months it pays (in its quarter)</legend>
                    {[4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3].map((m) => (
                      <label
                        key={m}
                        className="ep-check"
                        htmlFor={`tc-cm-${String(m)}`}
                        style={{ marginRight: 'var(--sp-2)' }}
                      >
                        <input id={`tc-cm-${String(m)}`} type="checkbox" name="months" value={m} />{' '}
                        {MONTHS[m]}
                      </label>
                    ))}
                  </fieldset>
                  <label className="ep-field" htmlFor="tc-cb">
                    <span className="ep-field__label">BSR code (7 digits)</span>
                    <input
                      id="tc-cb"
                      name="bsrCode"
                      className="ep-input"
                      required
                      pattern="[0-9]{7}"
                      maxLength={7}
                    />
                  </label>
                  <label className="ep-field" htmlFor="tc-cn">
                    <span className="ep-field__label">Challan serial</span>
                    <input
                      id="tc-cn"
                      name="challanNo"
                      className="ep-input"
                      required
                      pattern="[0-9]{1,5}"
                      maxLength={5}
                    />
                  </label>
                  <label className="ep-field" htmlFor="tc-cd">
                    <span className="ep-field__label">Deposited on</span>
                    <input
                      id="tc-cd"
                      name="depositedOn"
                      type="date"
                      className="ep-input"
                      required
                    />
                  </label>
                  <label className="ep-field" htmlFor="tc-ca">
                    <span className="ep-field__label">Tax and cess (₹)</span>
                    <input
                      id="tc-ca"
                      name="amount"
                      className="ep-input"
                      required
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                  <label className="ep-field" htmlFor="tc-ci">
                    <span className="ep-field__label">Interest (₹)</span>
                    <input
                      id="tc-ci"
                      name="interest"
                      className="ep-input"
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                  <label className="ep-field" htmlFor="tc-cf">
                    <span className="ep-field__label">Late fee (₹)</span>
                    <input
                      id="tc-cf"
                      name="lateFee"
                      className="ep-input"
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                </div>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Save
                  </button>
                </div>
              </form>
            </DialogButton>
          </div>
        ) : null}
      </section>
    </>
  );
}

export function ReturnsTab({ fy, canFile }: { fy: string; canFile: boolean }) {
  return (
    <section className="ep-card" aria-labelledby="tc-ret">
      <h2 id="tc-ret" className="ep-card__title">
        The quarterly TDS return
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Each quarter’s files (Form 24Q to 2025-26; Form 138 from 2026-27), for the
        return-preparation utility. They are made once every month of the quarter is locked and each
        month’s TDS has its challan.
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="tc-ret">
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Quarter</th>
              <th scope="col">Files</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3, 4].map((q) => (
              <tr key={q}>
                <td>
                  Q{q} ({QUARTERS[q]!.map((m) => MONTHS[m]).join(', ')})
                </td>
                <td>
                  {canFile ? (
                    <>
                      <a
                        href={file(`kind=taxreturn&fy=${fy}&quarter=${String(q)}&file=challans`)}
                        download
                      >
                        Challans
                      </a>
                      {' · '}
                      <a
                        href={file(`kind=taxreturn&fy=${fy}&quarter=${String(q)}&file=annexure1`)}
                        download
                      >
                        Annexure I
                      </a>
                      {q === 4 ? (
                        <>
                          {' · '}
                          <a
                            href={file(`kind=taxreturn&fy=${fy}&quarter=4&file=annexure2`)}
                            download
                          >
                            Annexure II
                          </a>
                        </>
                      ) : null}
                    </>
                  ) : (
                    'A payroll checker downloads them'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---- certificates -----------------------------------------------------------------------------------------------
export async function CertificatesTab({ fy }: { fy: string }) {
  const d = await apiFetch<{
    yearLocked: boolean;
    title: string;
    rows: Array<{
      employeeId: string;
      code: string;
      name: string;
      hasPan: boolean;
      partA: boolean;
      madeAt: string | null;
      releasedAt: string | null;
      emailedAt: string | null;
    }>;
  }>(`/payroll/tax/certificates?fy=${fy}`);
  const n = (f: (r: (typeof d.rows)[number]) => boolean) => d.rows.filter(f).length;
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Staff paid this year" value={String(d.rows.length)} />
        <KpiTile label="With Part A" value={String(n((r) => r.partA))} />
        <KpiTile label="Made" value={String(n((r) => !!r.madeAt))} />
        <KpiTile label="Released" value={String(n((r) => !!r.releasedAt))} />
      </div>
      {!d.yearLocked ? (
        <p className="ep-alert ep-alert--info" role="status">
          A run of {fy} is not locked: the certificates are made from the locked year only.
        </p>
      ) : null}
      <section className="ep-card" aria-labelledby="tc-cert">
        <h2 id="tc-cert" className="ep-card__title">
          {d.title} for {fy}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          1. Upload the Part A files from TRACES (each named with the employee’s PAN). 2. Make the
          certificates: Part A, then Part B from the year’s pay, one PDF locked with the payslip
          password. 3. Release them in My tax. 4. Send the e-mails (nothing is e-mailed before).
        </p>
        <form action={partA.bind(null, fy)} className="ep-grid__toolbar">
          <label className="ep-field" htmlFor="tc-pa">
            <span className="ep-field__label">Part A PDFs</span>
            <input
              id="tc-pa"
              name="files"
              type="file"
              multiple
              accept="application/pdf"
              className="ep-input"
            />
          </label>
          <button type="submit" className="ep-btn ep-btn--secondary">
            Upload Part A
          </button>
        </form>
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <form action={certificateStep.bind(null, fy, 'make')}>
            <button type="submit" className="ep-btn ep-btn--primary" disabled={!d.yearLocked}>
              Make the certificates
            </button>
          </form>
          <form action={certificateStep.bind(null, fy, 'release')}>
            <button
              type="submit"
              className="ep-btn ep-btn--secondary"
              disabled={!n((r) => !!r.madeAt && !r.releasedAt)}
            >
              Release in My tax
            </button>
          </form>
          <form action={certificateStep.bind(null, fy, 'send')}>
            <button
              type="submit"
              className="ep-btn ep-btn--secondary"
              disabled={!n((r) => !!r.releasedAt && !r.emailedAt)}
            >
              Send pending e-mails
            </button>
          </form>
        </div>
        {d.rows.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-labelledby="tc-cert"
            style={{ marginTop: 'var(--sp-3)' }}
          >
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">PAN</th>
                  <th scope="col">Part A</th>
                  <th scope="col">Certificate</th>
                  <th scope="col">Released</th>
                  <th scope="col">E-mailed</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>
                      {r.name} <span className="ep-field__help">{r.code}</span>
                    </td>
                    <td>{r.hasPan ? 'On record' : <Badge tone="danger">Missing</Badge>}</td>
                    <td>{r.partA ? <Badge tone="success">Uploaded</Badge> : '—'}</td>
                    <td>
                      {r.madeAt ? (
                        <FileLinks
                          href={file(`kind=cert&fy=${fy}&id=${r.employeeId}`)}
                          label={`the certificate of ${r.name}`}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{r.releasedAt ? dmy(String(r.releasedAt).slice(0, 10)) : '—'}</td>
                    <td>{r.emailedAt ? dmy(String(r.emailedAt).slice(0, 10)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </>
  );
}

// ---- the year ----------------------------------------------------------------------------------------------------
export async function YearTab({ fy, canCheck }: { fy: string; canCheck: boolean }) {
  const y = await apiFetch<{
    declareFrom: string;
    declareTo: string;
    proofDue: string;
    listedCities: string[];
    frozen: boolean;
    can: { manage: boolean };
  }>(`/payroll/tax/years/${fy}`);
  return (
    <>
      <section className="ep-card" aria-labelledby="tc-year">
        <h2 id="tc-year" className="ep-card__title">
          The tax year {fy} {y.frozen ? <Badge tone="neutral">Closed</Badge> : null}
        </h2>
        <form action={saveTaxYear.bind(null, fy)} className="ep-form-section__body">
          <fieldset
            className="ep-field"
            style={{ border: 0, padding: 0, margin: 0 }}
            disabled={!y.can.manage || y.frozen}
          >
            <div className="ep-form-row" data-columns="3">
              <label className="ep-field" htmlFor="ty-from">
                <span className="ep-field__label">Declarations from</span>
                <input
                  id="ty-from"
                  name="declareFrom"
                  type="date"
                  className="ep-input"
                  defaultValue={y.declareFrom}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ty-to">
                <span className="ep-field__label">Declarations until</span>
                <input
                  id="ty-to"
                  name="declareTo"
                  type="date"
                  className="ep-input"
                  defaultValue={y.declareTo}
                  required
                />
              </label>
              <label className="ep-field" htmlFor="ty-due">
                <span className="ep-field__label">
                  Proof deadline (after it, only verified amounts count)
                </span>
                <input
                  id="ty-due"
                  name="proofDue"
                  type="date"
                  className="ep-input"
                  defaultValue={y.proofDue}
                  required
                />
              </label>
            </div>
            <label className="ep-field" htmlFor="ty-cities">
              <span className="ep-field__label">
                Cities where HRA counts at 50 % (comma between)
              </span>
              <textarea
                id="ty-cities"
                name="listedCities"
                className="ep-input"
                rows={2}
                defaultValue={y.listedCities.join(', ')}
              />
            </label>
          </fieldset>
          {y.can.manage && !y.frozen ? (
            <div className="ep-grid__toolbar">
              <button type="submit" className="ep-btn ep-btn--primary">
                Save
              </button>
            </div>
          ) : null}
        </form>
      </section>
      <section className="ep-card" aria-labelledby="tc-tools" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="tc-tools" className="ep-card__title">
          Checks and closing
        </h2>
        <div className="ep-grid__toolbar">
          {canCheck ? (
            <form action={panCheck.bind(null, fy)}>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Check the PANs
              </button>
            </form>
          ) : null}
          {y.can.manage && !y.frozen ? (
            <DialogButton
              id="ty-freeze"
              label="Close the year"
              title={`Close ${fy}`}
              className="ep-btn ep-btn--danger"
            >
              <form action={freezeYear.bind(null, fy)} className="ep-form-section__body">
                <p className="ep-field__help">
                  Once closed, nothing in {fy} changes: no declaration, verification, earlier
                  employer, perquisite, final figure or challan. Close it after the fourth quarter’s
                  return is filed and the certificates are out.
                </p>
                <div className="ep-grid__toolbar">
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Close the year
                  </button>
                </div>
              </form>
            </DialogButton>
          ) : null}
        </div>
      </section>
    </>
  );
}
