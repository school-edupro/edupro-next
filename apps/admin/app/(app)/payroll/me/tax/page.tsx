import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { DeclareForm, type TaxLabel } from '@/components/payroll/tax/DeclareForm';
import { TaxSheet, type Sheet } from '@/components/payroll/tax/TaxSheet';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { money } from '@/lib/payroll';
import { declareMine, prevMine, regimeMine, withdrawMine } from '@/lib/payroll-tax-actions';

interface MyTax {
  employee: { id: string; code: string; name: string };
  fy: string;
  years: string[];
  year: {
    declareFrom: string;
    declareTo: string;
    proofDue: string;
    frozen: boolean;
    open: boolean;
  };
  labels: TaxLabel[];
  declarations: Array<{
    id: string;
    lineCode: string;
    declared: string;
    verified: string | null;
    status: 'SUBMITTED' | 'VERIFIED' | 'REJECTED';
    rejectReason: string | null;
    enteredFor: boolean;
  }>;
  prev: {
    employerName: string;
    employerTan: string | null;
    gross: string;
    tds: string;
    status: string;
    rejectReason: string | null;
  } | null;
  regime: { current: string | null; cutoffMonth: number; open: boolean };
  tax: Sheet;
  certificate: { released: boolean } | null;
}
const STATUS = {
  SUBMITTED: ['Declared', 'neutral'],
  VERIFIED: ['Verified', 'success'],
  REJECTED: ['Rejected', 'danger'],
} as const;
const MONTH = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

/**
 * My tax (docs/design/86, phase D): the year's tax as payroll works it out, my declarations with their proofs (HRA by
 * month), my earlier employer this year, my regime until the cut-off, my declaration form and my certificate.
 */
export default async function MyTaxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.own.view')) notFound();
  let d: MyTax;
  try {
    d = await apiFetch<MyTax>(
      `/payroll/me/tax${/^\d{4}-\d{2}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : ''}`,
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const labelOf = Object.fromEntries(d.labels.map((l) => [l.code, l.label]));
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll' }, { label: 'My tax' }]} />
      <PageHeader
        kicker="My payroll"
        title={`My tax · ${d.fy}`}
        description={`Declarations are taken from ${dmy(d.year.declareFrom)} to ${dmy(d.year.declareTo)}. They count in your monthly tax until ${dmy(d.year.proofDue)}; after that, only what payroll verified from your proofs.`}
      />
      <Notice params={sp} />
      {d.years.length > 1 ? (
        <nav
          aria-label="Financial year"
          className="ep-field__help"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {d.years.map((y, i) => (
            <span key={y}>
              {i ? ' · ' : ''}
              {y === d.fy ? <strong>{y}</strong> : <a href={`/payroll/me/tax?fy=${y}`}>{y}</a>}
            </span>
          ))}
        </nav>
      ) : null}
      <TaxSheet d={d.tax} labels={labelOf} />
      <section className="ep-card" aria-labelledby="mt-decl" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="mt-decl" className="ep-card__title">
          My declarations
        </h2>
        {d.declarations.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="mt-decl">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Section</th>
                  <th scope="col">Declared (₹)</th>
                  <th scope="col">Verified (₹)</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.declarations.map((x) => (
                  <tr key={x.id}>
                    <td>{labelOf[x.lineCode] ?? x.lineCode}</td>
                    <td>{money(x.declared)}</td>
                    <td>{x.verified ? money(x.verified) : '—'}</td>
                    <td>
                      <Badge tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Badge>
                      {x.rejectReason ? (
                        <div className="ep-field__help">{x.rejectReason}</div>
                      ) : null}
                    </td>
                    <td>
                      {x.status !== 'VERIFIED' && d.year.open ? (
                        <form action={withdrawMine.bind(null, d.fy, x.id)}>
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            Withdraw
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
          <p>Nothing declared for {d.fy}.</p>
        )}
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          {d.year.open ? (
            <DialogButton id="mt-declare" label="＋ Declare" title={`Declare for ${d.fy}`}>
              <DeclareForm
                fy={d.fy}
                labels={d.labels}
                action={declareMine.bind(null, d.fy)}
                idp="mt"
              />
            </DialogButton>
          ) : (
            <span className="ep-field__help">
              The declaration window is closed: ask the payroll office.
            </span>
          )}
          <span className="ep-field__help">My declaration form (PDF)</span>
          <FileLinks
            href={`/api/payroll/pay-file?kind=declform&fy=${d.fy}`}
            label={`my declaration form of ${d.fy}`}
          />
        </div>
        <p className="ep-field__help">
          Declaring a section again replaces it (until it is verified). Do not declare the PF and
          VPF payroll deducts: they are added to 80C by themselves.
        </p>
      </section>
      <section className="ep-card" aria-labelledby="mt-prev" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="mt-prev" className="ep-card__title">
          Salary from an earlier employer this year
        </h2>
        {d.prev ? (
          <p>
            {d.prev.employerName}
            {d.prev.employerTan ? ` (TAN ${d.prev.employerTan})` : ''}: salary ₹
            {money(d.prev.gross)}, tax deducted ₹{money(d.prev.tds)} ·{' '}
            <Badge
              tone={
                d.prev.status === 'VERIFIED'
                  ? 'success'
                  : d.prev.status === 'REJECTED'
                    ? 'danger'
                    : 'neutral'
              }
            >
              {d.prev.status === 'VERIFIED'
                ? 'Verified'
                : d.prev.status === 'REJECTED'
                  ? 'Rejected'
                  : 'Waiting for payroll'}
            </Badge>
            {d.prev.rejectReason ? ` ${d.prev.rejectReason}` : ''}
          </p>
        ) : (
          <p>
            None entered. If you worked elsewhere earlier this year, enter that salary: your tax
            counts it.
          </p>
        )}
        {!d.year.frozen && d.prev?.status !== 'VERIFIED' ? (
          <DialogButton
            id="mt-prev-form"
            label={d.prev ? 'Change it' : '＋ Earlier employer'}
            title="Salary from an earlier employer"
            className="ep-btn ep-btn--secondary ep-btn--sm"
          >
            <form action={prevMine.bind(null, d.fy)} className="ep-form-section__body">
              <div className="ep-form-row" data-columns="2">
                <label className="ep-field" htmlFor="mt-pn">
                  <span className="ep-field__label">Employer</span>
                  <input
                    id="mt-pn"
                    name="employerName"
                    className="ep-input"
                    required
                    minLength={2}
                    maxLength={150}
                  />
                </label>
                <label className="ep-field" htmlFor="mt-pt">
                  <span className="ep-field__label">Employer’s TAN</span>
                  <input
                    id="mt-pt"
                    name="employerTan"
                    className="ep-input"
                    pattern="[A-Za-z]{4}[0-9]{5}[A-Za-z]"
                    maxLength={10}
                  />
                </label>
                <label className="ep-field" htmlFor="mt-pf">
                  <span className="ep-field__label">From</span>
                  <input id="mt-pf" name="periodFrom" type="date" className="ep-input" />
                </label>
                <label className="ep-field" htmlFor="mt-pto">
                  <span className="ep-field__label">To</span>
                  <input id="mt-pto" name="periodTo" type="date" className="ep-input" />
                </label>
                {(
                  [
                    ['gross', 'Gross salary (₹)', true],
                    ['exempt', 'Exempt allowances (₹)', false],
                    ['pf', 'PF deducted (₹)', false],
                    ['pt', 'Profession tax deducted (₹)', false],
                    ['tds', 'Tax deducted (₹)', false],
                  ] as const
                ).map(([n, l, req]) => (
                  <label key={n} className="ep-field" htmlFor={`mt-p-${n}`}>
                    <span className="ep-field__label">{l}</span>
                    <input
                      id={`mt-p-${n}`}
                      name={n}
                      className="ep-input"
                      required={req}
                      inputMode="decimal"
                      pattern="[0-9,]+(\.[0-9]{1,2})?"
                    />
                  </label>
                ))}
              </div>
              <label className="ep-field" htmlFor="mt-pproof">
                <span className="ep-field__label">
                  Proof (the earlier employer’s Form 16 / 130 or salary statement)
                </span>
                <input
                  id="mt-pproof"
                  name="proofs"
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png"
                  className="ep-input"
                />
              </label>
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Save
                </button>
              </div>
            </form>
          </DialogButton>
        ) : null}
      </section>
      <section className="ep-card" aria-labelledby="mt-regime" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="mt-regime" className="ep-card__title">
          My regime: {d.regime.current === 'OLD' ? 'old' : 'new'}
        </h2>
        {d.regime.open ? (
          <form action={regimeMine.bind(null, d.fy)} className="ep-grid__toolbar">
            <label className="ep-field" htmlFor="mt-reg">
              <span className="ep-field__label">Change to</span>
              <select
                id="mt-reg"
                name="regime"
                className="ep-select"
                defaultValue={d.regime.current === 'OLD' ? 'NEW' : 'OLD'}
              >
                <option value="NEW">New regime</option>
                <option value="OLD">Old regime</option>
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Change my regime
            </button>
          </form>
        ) : null}
        <p className="ep-field__help">
          {d.regime.open
            ? `You can change it until the end of ${MONTH[d.regime.cutoffMonth] ?? ''}. The year is then worked out again, and the rest of the tax spread over the months left.`
            : 'The regime can no longer be changed this year: ask the payroll office.'}
        </p>
      </section>
      <section className="ep-card" aria-labelledby="mt-cert" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="mt-cert" className="ep-card__title">
          My tax certificate
        </h2>
        {d.certificate?.released ? (
          <p>
            Form 16 / 130 for {d.fy}:{' '}
            <FileLinks
              href={`/api/payroll/pay-file?kind=cert&fy=${d.fy}`}
              label={`my tax certificate of ${d.fy}`}
            />{' '}
            <span className="ep-field__help">It opens with your payslip password.</span>
          </p>
        ) : (
          <p>It appears here once payroll issues it after the year closes.</p>
        )}
      </section>
    </>
  );
}
