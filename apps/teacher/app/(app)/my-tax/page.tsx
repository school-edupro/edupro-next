import { ApiError } from '@edupro/bff';
import { Badge, Card, PageHeader } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { DeclareForm, type TaxLabel } from '@/components/TaxDeclareForm';
import { TaxSheet, type Sheet } from '@/components/TaxSheet';
import { bff } from '@/lib/bff';
import { declareMine, prevMine, regimeMine, withdrawMine } from './actions';

interface MyTax {
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
  }>;
  prev: {
    employerName: string;
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
const money = (v: string | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * My tax in the staff app (docs/design/86, phase D): the year's tax as payroll works it out, my declarations with their
 * proofs (HRA by month), my earlier employer, my regime until the cut-off, my declaration form and my certificate.
 */
export default async function MyTaxPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let d: MyTax | null = null;
  try {
    d = await bff.api.fetch<MyTax>(
      `/payroll/me/tax${/^\d{4}-\d{2}$/.test(sp.fy ?? '') ? `?fy=${sp.fy!}` : ''}`,
    );
  } catch (e) {
    if (!(e instanceof ApiError && (e.status === 403 || e.status === 404))) throw e;
  }
  if (!d)
    return (
      <>
        <PageHeader kicker="My payroll" title="My tax" />
        <Card>
          <p>Your sign-in is not linked to an employee record, so you have no tax here.</p>
        </Card>
      </>
    );
  const labelOf = Object.fromEntries(d.labels.map((l) => [l.code, l.label]));
  const file = (kind: string) => `/api/my-tax-file?kind=${kind}&fy=${d.fy}`;
  return (
    <>
      <PageHeader
        kicker="My payroll"
        title={`My tax · ${d.fy}`}
        description={`Declarations are taken from ${dmy(d.year.declareFrom)} to ${dmy(d.year.declareTo)}. They count in your monthly tax until ${dmy(d.year.proofDue)}; after that, only what payroll verified from your proofs.`}
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? 'Done.'}
        </p>
      ) : sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail ?? 'That did not work.'}
        </p>
      ) : null}
      {d.years.length > 1 ? (
        <nav aria-label="Financial year" className="ep-field__help">
          {d.years.map((y, i) => (
            <span key={y}>
              {i ? ' · ' : ''}
              {y === d.fy ? <strong>{y}</strong> : <a href={`/my-tax?fy=${y}`}>{y}</a>}
            </span>
          ))}
        </nav>
      ) : null}
      <TaxSheet d={d.tax} labels={labelOf} />
      <Card>
        <h2 className="ep-card__title">My declarations</h2>
        {d.declarations.length ? (
          <ul className="ep-list">
            {d.declarations.map((x) => (
              <li key={x.id}>
                <strong>{labelOf[x.lineCode] ?? x.lineCode}</strong>: declared ₹{money(x.declared)}
                {x.verified ? `, verified ₹${money(x.verified)}` : ''}{' '}
                <Badge tone={STATUS[x.status][1]}>{STATUS[x.status][0]}</Badge>
                {x.rejectReason ? <span className="ep-field__help"> {x.rejectReason}</span> : null}
                {x.status !== 'VERIFIED' && d.year.open ? (
                  <form action={withdrawMine.bind(null, d.fy, x.id)} style={{ display: 'inline' }}>
                    {' '}
                    <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                      Withdraw
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing declared for {d.fy}.</p>
        )}
        <p className="ep-field__help">
          Declaring a section again replaces it (until it is verified). Do not declare the PF
          payroll deducts: it is added to 80C by itself. My declaration form (PDF):{' '}
          <FileLinks
            url={file('decl')}
            saveUrl={`${file('decl')}&save=1`}
            label={`my declaration form of ${d.fy}`}
          />
        </p>
        {d.year.open ? (
          <details>
            <summary>Declare</summary>
            <DeclareForm
              fy={d.fy}
              labels={d.labels}
              action={declareMine.bind(null, d.fy)}
              idp="st"
            />
          </details>
        ) : (
          <p className="ep-field__help">
            The declaration window is closed: ask the payroll office.
          </p>
        )}
      </Card>
      <Card>
        <h2 className="ep-card__title">Salary from an earlier employer this year</h2>
        {d.prev ? (
          <p>
            {d.prev.employerName}: salary ₹{money(d.prev.gross)}, tax ₹{money(d.prev.tds)}{' '}
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
          </p>
        ) : (
          <p>None entered.</p>
        )}
        {!d.year.frozen && d.prev?.status !== 'VERIFIED' ? (
          <details>
            <summary>{d.prev ? 'Change it' : 'Enter an earlier employer'}</summary>
            <form action={prevMine.bind(null, d.fy)} className="ep-form-section__body">
              <label className="ep-field" htmlFor="st-pn">
                <span className="ep-field__label">Employer</span>
                <input
                  id="st-pn"
                  name="employerName"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={150}
                />
              </label>
              <label className="ep-field" htmlFor="st-pt">
                <span className="ep-field__label">Employer’s TAN</span>
                <input
                  id="st-pt"
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
                  ['pt', 'Profession tax deducted (₹)', false],
                  ['tds', 'Tax deducted (₹)', false],
                ] as const
              ).map(([n, l, req]) => (
                <label key={n} className="ep-field" htmlFor={`st-p-${n}`}>
                  <span className="ep-field__label">{l}</span>
                  <input
                    id={`st-p-${n}`}
                    name={n}
                    className="ep-input"
                    required={req}
                    inputMode="decimal"
                    pattern="[0-9,]+(\.[0-9]{1,2})?"
                  />
                </label>
              ))}
              <label className="ep-field" htmlFor="st-pp">
                <span className="ep-field__label">Proof (PDF or photo)</span>
                <input
                  id="st-pp"
                  name="proofs"
                  type="file"
                  multiple
                  accept="application/pdf,image/jpeg,image/png"
                  className="ep-input"
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save
              </button>
            </form>
          </details>
        ) : null}
      </Card>
      <Card>
        <h2 className="ep-card__title">My regime: {d.regime.current === 'OLD' ? 'old' : 'new'}</h2>
        {d.regime.open ? (
          <form action={regimeMine.bind(null, d.fy)} className="ep-grid__toolbar">
            <label className="ep-field" htmlFor="st-reg">
              <span className="ep-field__label">Change to</span>
              <select
                id="st-reg"
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
            ? `You can change it until the end of ${MONTH[d.regime.cutoffMonth] ?? ''}.`
            : 'The regime can no longer be changed this year: ask the payroll office.'}
        </p>
      </Card>
      <Card>
        <h2 className="ep-card__title">My tax certificate</h2>
        {d.certificate?.released ? (
          <p>
            Form 16 / 130 for {d.fy}:{' '}
            <FileLinks
              url={file('cert')}
              saveUrl={`${file('cert')}&save=1`}
              label={`my tax certificate of ${d.fy}`}
            />{' '}
            (opens with your payslip password)
          </p>
        ) : (
          <p>It appears here once payroll issues it after the year closes.</p>
        )}
      </Card>
    </>
  );
}
