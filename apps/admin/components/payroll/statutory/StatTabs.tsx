import { Badge, KpiTile } from '@edupro/ui';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { DialogButton } from '@/components/leave/DialogButton';
import { apiFetch } from '@/lib/api';
import { money } from '@/lib/payroll';
import { COMPLIANCE_TONE, COMPLIANCE_WORD, dmy } from '@/lib/payroll-pay';
import {
  dueDone,
  dueReopen,
  ecrFiled,
  seedCalendar,
  withdrawReturn,
} from '@/lib/payroll-pay-actions';

const file = (q: string) => `/api/payroll/pay-file?${q}`;

function Provisional({ on }: { on: boolean }) {
  return on ? (
    <p className="ep-alert ep-alert--warning" role="status">
      PROVISIONAL — an approved run of the month is not locked yet: these figures may still change,
      and the files wait for the lock.
    </p>
  ) : null;
}

function Registers({ month, of, label }: { month: string; of: string; label: string }) {
  return (
    <div className="ep-grid__toolbar">
      <a
        className="ep-btn ep-btn--secondary ep-btn--sm"
        href={file(`kind=register&month=${month}&of=${of}&format=xlsx`)}
        download
      >
        {label} (Excel)
      </a>
      <span className="ep-field__help">{label} (PDF)</span>
      <FileLinks
        href={file(`kind=register&month=${month}&of=${of}&format=pdf`)}
        label={`the ${label.toLowerCase()} of ${month}`}
      />
    </div>
  );
}

interface Member {
  employeeId: string;
  code: string;
  name: string;
  uan: string;
  gross: string;
  epf: string;
  eps: string;
  edli: string;
  ee: string;
  epsShare: string;
  diff: string;
  ncp: string;
  problems: string[];
  warnings: string[];
}
interface PfData {
  monthWords: string;
  provisional: boolean;
  pfCode: string | null;
  arrearMode: string;
  members: Member[];
  hiddenCount: number;
  totals: Record<string, string | number>;
  challan: Record<string, string | boolean>;
  ecr: {
    filed: Array<{
      id: string;
      seq: number;
      ack_no: string;
      filed_on: string;
      members: number;
      filed_by_name: string | null;
    }>;
    next: {
      seq: number;
      kind: string;
      count: number;
      problems: Array<{ code: string; problems: string[] }>;
    };
    changedAfterFiling: Array<{ code: string; name: string }>;
    notLocked: string[];
  };
  can: { file: boolean; withdraw: boolean };
}

export async function PfTab({ month }: { month: string }) {
  const d = await apiFetch<PfData>(`/payroll/statutory/pf?month=${month}`);
  const latest = d.ecr.filed[d.ecr.filed.length - 1];
  const ch = d.challan;
  return (
    <>
      <Provisional on={d.provisional} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="PF members" value={String(d.totals.members)} />
        <KpiTile label="EPF wages" value={`₹${money(String(d.totals.epf))}`} />
        <KpiTile label="Challan total" value={`₹${money(String(ch.total))}`} />
        <KpiTile label="ECR filed" value={String(d.ecr.filed.length)} />
      </div>
      <section className="ep-card" aria-labelledby="st-ecr">
        <h2 id="st-ecr" className="ep-card__title">
          The ECR for {d.monthWords}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The month’s file holds every locked run, one line a member (staff without PF are left
          out). Upload it on the EPFO portal; once the return is approved there, record it here: a
          later run of the month then gives a supplementary file of only the members not yet filed.
          PF code: {d.pfCode ?? 'not set (Settings)'} · arrears{' '}
          {d.arrearMode === 'SEPARATE' ? 'in a separate arrear file' : 'folded into the month'}.
        </p>
        {d.ecr.notLocked.length ? (
          <p className="ep-alert ep-alert--info" role="status">
            Not in the file until locked: {d.ecr.notLocked.join(', ')}.
          </p>
        ) : null}
        {d.ecr.changedAfterFiling.length ? (
          <p className="ep-alert ep-alert--warning" role="status">
            Paid again after their ECR was filed (a top-up):{' '}
            {d.ecr.changedAfterFiling.map((m) => m.code).join(', ')}. File a revised return for them
            on the EPFO portal.
          </p>
        ) : null}
        {d.ecr.next.count ? (
          <>
            <p>
              <strong>
                Next:{' '}
                {d.ecr.next.kind === 'regular'
                  ? 'the regular return'
                  : `supplementary return ${String(d.ecr.next.seq)}`}
              </strong>{' '}
              · {d.ecr.next.count} member(s)
            </p>
            {d.ecr.next.problems.length ? (
              <div className="ep-alert ep-alert--danger" role="alert">
                <div>
                  <strong>Fix these first (the file is refused until then):</strong>
                  <ul style={{ margin: 'var(--sp-2) 0 0' }}>
                    {d.ecr.next.problems.slice(0, 20).map((p) => (
                      <li key={p.code}>
                        {p.code}: {p.problems.join('; ')}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
            {d.can.file && !d.ecr.next.problems.length ? (
              <div className="ep-grid__toolbar">
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={file(`kind=ecr&month=${month}`)}
                  download
                >
                  Download the ECR
                </a>
                {d.arrearMode === 'SEPARATE' ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={file(`kind=ecr&month=${month}&part=arrear`)}
                    download
                  >
                    Arrear ECR
                  </a>
                ) : null}
                <DialogButton id="st-filed" label="Record as filed" title="The ECR is filed">
                  <form action={ecrFiled.bind(null, month)} className="ep-form-section__body">
                    <p className="ep-field__help">
                      Record it once the EPFO portal has approved the return: its {d.ecr.next.count}{' '}
                      member(s) are kept with their lines as filed.
                    </p>
                    <label className="ep-field" htmlFor="st-ack">
                      <span className="ep-field__label">
                        Acknowledgement (TRRN or return number)
                      </span>
                      <input
                        id="st-ack"
                        name="ackNo"
                        className="ep-input"
                        required
                        minLength={4}
                        maxLength={60}
                      />
                    </label>
                    <label className="ep-field" htmlFor="st-on">
                      <span className="ep-field__label">Filed on</span>
                      <input id="st-on" name="filedOn" type="date" className="ep-input" required />
                    </label>
                    <div className="ep-grid__toolbar">
                      <button type="submit" className="ep-btn ep-btn--primary">
                        Record as filed
                      </button>
                    </div>
                  </form>
                </DialogButton>
              </div>
            ) : null}
          </>
        ) : (
          <p>
            {d.ecr.filed.length
              ? 'Every member of the month is in a filed ECR.'
              : 'No locked run with PF yet.'}
          </p>
        )}
        {d.ecr.filed.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="ECRs filed">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Return</th>
                  <th scope="col">Acknowledgement</th>
                  <th scope="col">Filed on</th>
                  <th scope="col">Members</th>
                  <th scope="col">File</th>
                </tr>
              </thead>
              <tbody>
                {d.ecr.filed.map((f) => (
                  <tr key={f.id}>
                    <td>{f.seq === 1 ? 'Regular' : `Supplementary ${String(f.seq)}`}</td>
                    <td>{f.ack_no}</td>
                    <td>
                      {dmy(f.filed_on)}
                      {f.filed_by_name ? ` · ${f.filed_by_name}` : ''}
                    </td>
                    <td>{f.members}</td>
                    <td>
                      {d.can.file ? (
                        <a href={file(`kind=return&id=${f.id}`)} download>
                          As filed
                        </a>
                      ) : null}
                      {d.can.withdraw && latest?.id === f.id ? (
                        <>
                          {' '}
                          <DialogButton
                            id={`st-wd-${f.id}`}
                            label="Withdraw"
                            title="Withdraw this filing"
                            className="ep-btn ep-btn--secondary ep-btn--sm"
                          >
                            <form
                              action={withdrawReturn.bind(null, month, f.id)}
                              className="ep-form-section__body"
                            >
                              <p className="ep-field__help">
                                Only for a filing recorded here by mistake.
                              </p>
                              <label className="ep-field" htmlFor={`st-wr-${f.id}`}>
                                <span className="ep-field__label">Why</span>
                                <textarea
                                  id={`st-wr-${f.id}`}
                                  name="reason"
                                  className="ep-input"
                                  rows={3}
                                  required
                                  minLength={10}
                                  maxLength={300}
                                />
                              </label>
                              <div className="ep-grid__toolbar">
                                <button type="submit" className="ep-btn ep-btn--danger">
                                  Withdraw
                                </button>
                              </div>
                            </form>
                          </DialogButton>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      <section
        className="ep-card"
        aria-labelledby="st-challan"
        style={{ marginTop: 'var(--sp-4)' }}
      >
        <h2 id="st-challan" className="ep-card__title">
          PF challan
        </h2>
        <dl className="ep-facts">
          <dt>A/c 1 — employee share, VPF and employer difference</dt>
          <dd>₹{money(String(ch.ac1))}</dd>
          <dt>A/c 2 — admin charges{ch.adminMinApplied ? ' (the minimum)' : ''}</dt>
          <dd>₹{money(String(ch.ac2))}</dd>
          <dt>A/c 10 — pension</dt>
          <dd>₹{money(String(ch.ac10))}</dd>
          <dt>A/c 21 — EDLI{ch.edliMinApplied ? ' (the minimum)' : ''}</dt>
          <dd>₹{money(String(ch.ac21))}</dd>
          <dt>A/c 22</dt>
          <dd>₹{money(String(ch.ac22))}</dd>
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>₹{money(String(ch.total))}</strong>
          </dd>
        </dl>
      </section>
      <FoldCard
        id="st-members"
        title="PF register"
        hint={`${String(d.members.length)} member(s)${d.hiddenCount ? `, ${String(d.hiddenCount)} confidential not shown (counted in the totals)` : ''}; open for each line`}
      >
        <Registers month={month} of="pf" label="PF register" />
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="PF register">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">UAN</th>
                <th scope="col">Name</th>
                <th scope="col">Gross</th>
                <th scope="col">EPF wages</th>
                <th scope="col">EPS wages</th>
                <th scope="col">Employee PF</th>
                <th scope="col">Pension</th>
                <th scope="col">Employer diff.</th>
                <th scope="col">NCP</th>
              </tr>
            </thead>
            <tbody>
              {d.members.map((m) => (
                <tr key={m.employeeId}>
                  <td>{m.uan || '—'}</td>
                  <td>
                    {m.name} <span className="ep-field__help">{m.code}</span>
                    {m.problems.length ? (
                      <>
                        {' '}
                        <Badge tone="danger">{m.problems.join('; ')}</Badge>
                      </>
                    ) : null}
                  </td>
                  <td>{m.gross}</td>
                  <td>{m.epf}</td>
                  <td>{m.eps}</td>
                  <td>{m.ee}</td>
                  <td>{m.epsShare}</td>
                  <td>{m.diff}</td>
                  <td>{m.ncp}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FoldCard>
    </>
  );
}

interface EsiData {
  monthWords: string;
  provisional: boolean;
  esiCode: string | null;
  rows: Array<{
    employeeId: string;
    code: string;
    ip: string;
    name: string;
    days: number;
    wages: string;
    ee: string;
    er: string;
    reason: number;
    lastDay: string | null;
    problems: string[];
  }>;
  hiddenCount: number;
  uncovered: number;
  challan: { employees: number; wages: string; ee: string; er: string; total: string };
  problems: Array<{ code: string; problems: string[] }>;
  can: { file: boolean };
}
const REASON_WORD: Record<number, string> = { 0: '—', 1: 'On leave', 2: 'Left service' };

export async function EsiTab({ month }: { month: string }) {
  const d = await apiFetch<EsiData>(`/payroll/statutory/esi?month=${month}`);
  return (
    <>
      <Provisional on={d.provisional} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Covered staff" value={String(d.challan.employees)} />
        <KpiTile label="ESI wages" value={`₹${money(d.challan.wages)}`} />
        <KpiTile label="Employee share" value={`₹${money(d.challan.ee)}`} />
        <KpiTile label="Employer share" value={`₹${money(d.challan.er)}`} />
      </div>
      <section className="ep-card" aria-labelledby="st-esic">
        <h2 id="st-esic" className="ep-card__title">
          The ESIC upload for {d.monthWords}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The covered staff only, from the locked runs: IP number, name, days paid, the month’s ESI
          wages and — for someone with no paid day — the reason (left service with the last working
          day, or on leave). Upload it on the ESIC portal’s monthly contribution page; compare its
          columns with the portal’s sample template the first time. ESI code:{' '}
          {d.esiCode ?? 'not set (Settings)'} · total to pay ₹{money(d.challan.total)}.
          {d.uncovered
            ? ` ${String(d.uncovered)} employee(s) earn above the ESI limit and are not in it.`
            : ''}
        </p>
        {d.problems.length ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            <div>
              <strong>Fix these first (the portal refuses the file):</strong>
              <ul style={{ margin: 'var(--sp-2) 0 0' }}>
                {d.problems.slice(0, 20).map((p) => (
                  <li key={p.code}>
                    {p.code}: {p.problems.join('; ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : d.can.file && d.challan.employees ? (
          <div className="ep-grid__toolbar">
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={file(`kind=esic&month=${month}`)}
              download
            >
              Download the ESIC upload (Excel)
            </a>
          </div>
        ) : null}
      </section>
      <FoldCard
        id="st-esi-rows"
        title="ESI register"
        hint={`${String(d.rows.length)} covered employee(s)${d.hiddenCount ? `, ${String(d.hiddenCount)} confidential not shown` : ''}; open for each line`}
      >
        <Registers month={month} of="esi" label="ESI register" />
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="ESI register">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">IP number</th>
                <th scope="col">Name</th>
                <th scope="col">Days</th>
                <th scope="col">Wages</th>
                <th scope="col">Employee</th>
                <th scope="col">Employer</th>
                <th scope="col">No paid day</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td>{r.ip || '—'}</td>
                  <td>
                    {r.name} <span className="ep-field__help">{r.code}</span>
                  </td>
                  <td>{r.days}</td>
                  <td>{r.wages}</td>
                  <td>{money(r.ee)}</td>
                  <td>{money(r.er)}</td>
                  <td>
                    {REASON_WORD[r.reason] ?? r.reason}
                    {r.lastDay ? ` · ${r.lastDay}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FoldCard>
    </>
  );
}

interface PtData {
  monthWords: string;
  provisional: boolean;
  state: string | null;
  rows: Array<{ rate: string; men: number; women: number; employees: number; tax: string }>;
  employees: number;
  total: string;
  slabs: Array<{
    gender: string;
    wage_from: string;
    wage_to: string | null;
    monthly_amount: string;
  }>;
  formIIIB: { ptrcNo: string | null; period: string; employees: number; totalTax: string } | null;
}

export async function PtTab({ month }: { month: string }) {
  const d = await apiFetch<PtData>(`/payroll/statutory/pt?month=${month}`);
  return (
    <>
      <Provisional on={d.provisional} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="State" value={d.state ?? 'Not set'} />
        <KpiTile label="Staff paying" value={String(d.employees)} />
        <KpiTile label="Profession tax" value={`₹${money(d.total)}`} />
        <KpiTile
          label="Rates in use"
          value={String(d.rows.filter((r) => Number(r.rate) > 0).length)}
        />
      </div>
      <section className="ep-card" aria-labelledby="st-pt">
        <h2 id="st-pt" className="ep-card__title">
          Profession tax register — {d.monthWords}
        </h2>
        <Registers month={month} of="pt" label="Profession tax register" />
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-pt">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Monthly rate (₹)</th>
                <th scope="col">Men</th>
                <th scope="col">Women</th>
                <th scope="col">Staff</th>
                <th scope="col">Tax (₹)</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.rate}>
                  <td>{money(r.rate)}</td>
                  <td>{r.men}</td>
                  <td>{r.women}</td>
                  <td>{r.employees}</td>
                  <td>{money(r.tax)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                <td />
                <td />
                <td>{d.employees}</td>
                <td>
                  <strong>{money(d.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      {d.formIIIB ? (
        <section className="ep-card" aria-labelledby="st-iiib" style={{ marginTop: 'var(--sp-4)' }}>
          <h2 id="st-iiib" className="ep-card__title">
            Maharashtra: Form IIIB figures
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Key these into the Mahavat portal’s return; compare them with its form the first time.
          </p>
          <dl className="ep-facts">
            <dt>PTRC number</dt>
            <dd>{d.formIIIB.ptrcNo ?? 'not set (Settings)'}</dd>
            <dt>Period</dt>
            <dd>{d.formIIIB.period}</dd>
            <dt>Staff paying</dt>
            <dd>{d.formIIIB.employees}</dd>
            <dt>Tax</dt>
            <dd>₹{money(d.formIIIB.totalTax)}</dd>
          </dl>
        </section>
      ) : null}
      {d.slabs.length ? (
        <FoldCard
          id="st-slabs"
          title="The state’s slabs in force"
          hint={`${String(d.slabs.length)} slab(s)`}
        >
          <ul>
            {d.slabs.map((s, i) => (
              <li key={i}>
                {s.gender === 'ANY' ? 'Everyone' : s.gender === 'F' ? 'Women' : 'Men'}: ₹
                {money(s.wage_from)}
                {s.wage_to ? ` to ₹${money(s.wage_to)}` : ' and above'} → ₹{money(s.monthly_amount)}{' '}
                a month
              </li>
            ))}
          </ul>
        </FoldCard>
      ) : null}
    </>
  );
}

interface LwfData {
  monthWords: string;
  provisional: boolean;
  enabled: boolean;
  state: string | null;
  frequency: string | null;
  dueMonths: number[] | null;
  due: boolean;
  rows: Array<{
    code: string;
    name: string;
    state: string | null;
    ee: string;
    er: string;
    total: string;
  }>;
  hiddenCount: number;
  challan: { employees: number; ee: string; er: string; total: string };
}

export async function LwfTab({ month }: { month: string }) {
  const d = await apiFetch<LwfData>(`/payroll/statutory/lwf?month=${month}`);
  return (
    <>
      <Provisional on={d.provisional} />
      {!d.enabled ? (
        <p className="ep-alert ep-alert--info" role="status">
          LWF is switched off in the payroll settings: nothing is deducted.
        </p>
      ) : !d.due ? (
        <p className="ep-alert ep-alert--info" role="status">
          {d.monthWords} is not an LWF month in {d.state ?? 'the school’s state'}
          {d.dueMonths?.length ? ` (it falls in month(s) ${d.dueMonths.join(', ')})` : ''}.
        </p>
      ) : null}
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Staff" value={String(d.challan.employees)} />
        <KpiTile label="Employee share" value={`₹${money(d.challan.ee)}`} />
        <KpiTile label="Employer share" value={`₹${money(d.challan.er)}`} />
        <KpiTile label="To pay" value={`₹${money(d.challan.total)}`} />
      </div>
      <section className="ep-card" aria-labelledby="st-lwf">
        <h2 id="st-lwf" className="ep-card__title">
          Labour welfare fund — {d.monthWords}
        </h2>
        <Registers month={month} of="lwf" label="LWF register" />
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-lwf">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Emp. ID</th>
                  <th scope="col">Name</th>
                  <th scope="col">State</th>
                  <th scope="col">Employee (₹)</th>
                  <th scope="col">Employer (₹)</th>
                  <th scope="col">Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.code}>
                    <td>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.state ?? '—'}</td>
                    <td>{money(r.ee)}</td>
                    <td>{money(r.er)}</td>
                    <td>{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No LWF in the month.</p>
        )}
        {d.hiddenCount ? (
          <p className="ep-field__help">
            {d.hiddenCount} confidential employee(s) not shown; counted in the totals.
          </p>
        ) : null}
      </section>
    </>
  );
}

interface Calendar {
  fy: number;
  fyLabel: string;
  rows: Array<{
    id: string;
    item: string;
    itemWords: string;
    period: string;
    dueOn: string;
    description: string;
    status: string;
    doneByName: string | null;
    ackNo: string | null;
    ackDate: string | null;
    amountPaid: string | null;
    amountComputed: string | null;
    difference: string | null;
  }>;
  counts: { overdue: number; dueSoon: number; pending: number; done: number };
  seeded: boolean;
  can: { manage: boolean; reopen: boolean };
}

export async function CalendarTab({ fy }: { fy: number }) {
  const d = await apiFetch<Calendar>(`/payroll/compliance?fy=${String(fy)}`);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Overdue" value={String(d.counts.overdue)} />
        <KpiTile label="Due this week" value={String(d.counts.dueSoon)} />
        <KpiTile label="Pending" value={String(d.counts.pending)} />
        <KpiTile label="Done" value={String(d.counts.done)} />
      </div>
      <section className="ep-card" aria-labelledby="st-cal">
        <h2 id="st-cal" className="ep-card__title">
          Statutory dues of {d.fyLabel}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          PF ECR and ESI by the 15th of the next month, TDS by the 7th (March’s by 30 April),
          profession tax by the next month’s end, LWF after its months, the quarterly TDS returns.
          Mark each done with its challan or acknowledgement number: the amount paid is set against
          payroll’s figure. Nothing here pays or files by itself.
        </p>
        {d.can.manage ? (
          <form action={seedCalendar.bind(null, fy)} className="ep-grid__toolbar">
            <button
              type="submit"
              className={`ep-btn ${d.seeded ? 'ep-btn--secondary ep-btn--sm' : 'ep-btn--primary'}`}
            >
              {d.seeded ? 'Add any missing due' : `Set up ${d.fyLabel}`}
            </button>
          </form>
        ) : null}
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="st-cal">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Due on</th>
                  <th scope="col">What</th>
                  <th scope="col">Status</th>
                  <th scope="col">Acknowledgement</th>
                  <th scope="col">Paid (₹)</th>
                  <th scope="col">
                    <span className="ep-sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{dmy(r.dueOn)}</td>
                    <td>{r.description}</td>
                    <td>
                      <Badge tone={COMPLIANCE_TONE[r.status] ?? 'neutral'}>
                        {COMPLIANCE_WORD[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td>
                      {r.ackNo ? `${r.ackNo} · ${dmy(r.ackDate)}` : '—'}
                      {r.doneByName ? <div className="ep-field__help">{r.doneByName}</div> : null}
                    </td>
                    <td>
                      {r.amountPaid !== null ? money(r.amountPaid) : '—'}
                      {r.difference && r.difference !== '0.00' ? (
                        <div className="ep-field__help">
                          payroll: {money(r.amountComputed)} (difference {r.difference})
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {!r.ackNo && d.can.manage ? (
                        <DialogButton
                          id={`st-done-${r.id}`}
                          label="Mark done"
                          title={r.description}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <form
                            action={dueDone.bind(null, fy, r.id)}
                            className="ep-form-section__body"
                          >
                            <label className="ep-field" htmlFor={`st-an-${r.id}`}>
                              <span className="ep-field__label">
                                Challan or acknowledgement number
                              </span>
                              <input
                                id={`st-an-${r.id}`}
                                name="ackNo"
                                className="ep-input"
                                required
                                minLength={3}
                                maxLength={60}
                              />
                            </label>
                            <label className="ep-field" htmlFor={`st-ad-${r.id}`}>
                              <span className="ep-field__label">Paid or filed on</span>
                              <input
                                id={`st-ad-${r.id}`}
                                name="ackDate"
                                type="date"
                                className="ep-input"
                                required
                                max={today}
                              />
                            </label>
                            {r.item === 'TDS_RETURN' ? null : (
                              <label className="ep-field" htmlFor={`st-am-${r.id}`}>
                                <span className="ep-field__label">Amount paid (₹)</span>
                                <input
                                  id={`st-am-${r.id}`}
                                  name="amountPaid"
                                  className="ep-input"
                                  inputMode="decimal"
                                  pattern="[0-9,]+(\.[0-9]{1,2})?"
                                />
                              </label>
                            )}
                            <div className="ep-grid__toolbar">
                              <button type="submit" className="ep-btn ep-btn--primary">
                                Mark done
                              </button>
                            </div>
                          </form>
                        </DialogButton>
                      ) : null}
                      {r.ackNo && d.can.reopen ? (
                        <DialogButton
                          id={`st-ro-${r.id}`}
                          label="Reopen"
                          title={`Reopen: ${r.description}`}
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                        >
                          <form
                            action={dueReopen.bind(null, fy, r.id)}
                            className="ep-form-section__body"
                          >
                            <label className="ep-field" htmlFor={`st-rr-${r.id}`}>
                              <span className="ep-field__label">Why</span>
                              <textarea
                                id={`st-rr-${r.id}`}
                                name="reason"
                                className="ep-input"
                                rows={3}
                                required
                                minLength={10}
                                maxLength={300}
                              />
                            </label>
                            <div className="ep-grid__toolbar">
                              <button type="submit" className="ep-btn ep-btn--danger">
                                Reopen
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
          <p>The year is not set up yet.</p>
        )}
      </section>
    </>
  );
}

interface Voucher {
  monthWords: string;
  records: number;
  provisional: boolean;
  ledgersSet: boolean;
  debit: Array<{ ledger: string; amount: string; note: string }>;
  credit: Array<{ ledger: string; amount: string; note: string }>;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  words: string;
}

export async function VoucherTab({ month }: { month: string }) {
  const v = await apiFetch<Voucher>(`/payroll/voucher?month=${month}`);
  const side = (title: string, id: string, lines: Voucher['debit'], total: string) => (
    <section className="ep-card" aria-labelledby={id} style={{ marginTop: 'var(--sp-4)' }}>
      <h2 id={id} className="ep-card__title">
        {title}
      </h2>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby={id}>
        <table className="ep-table ep-table--dense">
          <thead>
            <tr>
              <th scope="col">Ledger</th>
              <th scope="col">What</th>
              <th scope="col">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.ledger}>
                <td>{l.ledger}</td>
                <td className="ep-field__help">{l.note}</td>
                <td>{money(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Total</th>
              <td />
              <td>
                <strong>{money(total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
  if (!v.records)
    return (
      <section className="ep-card">
        <p>{v.monthWords} has no approved or locked run.</p>
      </section>
    );
  return (
    <>
      <Provisional on={v.provisional} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Debit" value={`₹${money(v.totalDebit)}`} />
        <KpiTile label="Credit" value={`₹${money(v.totalCredit)}`} />
        <KpiTile label="Balanced" value={v.balanced ? 'Yes' : 'No'} />
        <KpiTile label="Salary records" value={String(v.records)} />
      </div>
      {v.balanced ? null : (
        <p className="ep-alert ep-alert--danger" role="alert">
          NOT BALANCED — do not post this voucher until it is looked into.
        </p>
      )}
      <section className="ep-card" aria-labelledby="st-jv">
        <h2 id="st-jv" className="ep-card__title">
          Journal voucher — salaries for {v.monthWords}
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          ({v.words}) The ledger names come from{' '}
          <a href="/payroll/setup/bank#ledgers">Payroll set-up → Bank accounts and ledgers</a>
          {v.ledgersSet ? '' : ' (not named yet: the default names are used)'}. Post it in the
          accounts package.
        </p>
        <div className="ep-grid__toolbar">
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={file(`kind=voucher&month=${month}&format=xlsx`)}
            download
          >
            Excel
          </a>
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={file(`kind=voucher&month=${month}&format=csv`)}
            download
          >
            CSV
          </a>
          <span className="ep-field__help">PDF</span>
          <FileLinks
            href={file(`kind=voucher&month=${month}&format=pdf`)}
            label={`the salary voucher of ${month}`}
          />
        </div>
      </section>
      {side('Debit', 'st-dr', v.debit, v.totalDebit)}
      {side('Credit', 'st-cr', v.credit, v.totalCredit)}
    </>
  );
}
