import { Badge, type BadgeTone } from '@edupro/ui';
import { DialogButton } from '@/components/leave/DialogButton';
import { apiFetch } from '@/lib/api';
import { money } from '@/lib/payroll';
import { draftRevision, proposeIncrements } from '@/lib/payroll-people-actions';

export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
export const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const REV_STATUS: Record<string, [string, BadgeTone]> = {
  DRAFT: ['Draft', 'neutral'],
  APPLIED: ['Applied', 'success'],
  CANCELLED: ['Cancelled', 'danger'],
};
export const FNF_STATUS: Record<string, [string, BadgeTone]> = {
  DRAFT: ['To work out', 'warning'],
  COMPUTED: ['To approve', 'info'],
  APPROVED: ['To pay', 'info'],
  STAGED: ['In a run', 'info'],
  DUES: ['Dues to collect', 'warning'],
  SETTLED: ['Settled', 'success'],
  CANCELLED: ['Cancelled', 'neutral'],
};
export const REASONS: Record<string, string> = {
  RESIGNATION: 'Resignation',
  RETIREMENT: 'Retirement',
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal',
  DEATH: 'Death',
  DISABLEMENT: 'Disablement',
  CONTRACT_END: 'Contract end',
};
const what = (r: { kind: string; detail: Record<string, unknown> }) =>
  r.kind === 'RATE'
    ? `${String(r.detail.rateCode)} to ${String(r.detail.newValue)}`
    : r.kind === 'FORMULA'
      ? `${String(r.detail.headCode)}: ${String(r.detail.formula)}`
      : `Increments of ${String((r.detail.employees as unknown[] | undefined)?.length ?? 0)} staff`;

// ---- revisions ------------------------------------------------------------------------------------------------
export async function RevisionsTab({ canDraft }: { canDraft: boolean }) {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      kind: string;
      detail: Record<string, unknown>;
      effectiveFrom: string;
      reason: string;
      status: string;
      arrearsTotal: string | null;
      arrearsCount: number | null;
      createdByName: string | null;
      appliedByName: string | null;
    }>;
  }>('/payroll/revisions');
  let rates: string[] = [];
  try {
    rates = [
      ...new Set(
        (
          await apiFetch<{ rows: Array<{ rateCode?: string; code?: string }> }>(
            '/payroll/config/rates',
          )
        ).rows
          .map((r) => r.rateCode ?? r.code ?? '')
          .filter(Boolean),
      ),
    ];
  } catch {
    rates = [];
  }
  return (
    <section className="ep-card" aria-labelledby="pp-rev">
      <h2 id="pp-rev" className="ep-card__title">
        Revisions
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        A change of a rate (DA) or of a head’s formula, dated back if need be. Locked months are
        worked out again through the engine and the difference is paid as arrears in the next run;
        the new rate holds from the first open month. A checker who did not draft it applies it.
      </p>
      {d.rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-rev">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">What</th>
                <th scope="col">From</th>
                <th scope="col">Why</th>
                <th scope="col">Arrears (₹)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/payroll/people/revisions/${r.id}`}>{what(r)}</a>
                  </td>
                  <td>{dmy(r.effectiveFrom)}</td>
                  <td>{r.reason}</td>
                  <td>
                    {r.arrearsTotal === null ? '—' : money(r.arrearsTotal)}
                    {r.arrearsCount ? (
                      <div className="ep-field__help">{r.arrearsCount} line(s)</div>
                    ) : null}
                  </td>
                  <td>
                    <Badge tone={REV_STATUS[r.status]?.[1] ?? 'neutral'}>
                      {REV_STATUS[r.status]?.[0] ?? r.status}
                    </Badge>
                    <div className="ep-field__help">
                      {r.appliedByName
                        ? `by ${r.appliedByName}`
                        : r.createdByName
                          ? `drafted by ${r.createdByName}`
                          : ''}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No revision yet.</p>
      )}
      {canDraft ? (
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          <DialogButton id="pp-rev-new" label="＋ Draft a revision" title="Draft a revision">
            <form action={draftRevision} className="ep-form-section__body">
              <div className="ep-form-row" data-columns="2">
                <label className="ep-field" htmlFor="pp-rk">
                  <span className="ep-field__label">What changes</span>
                  <select id="pp-rk" name="kind" className="ep-select" defaultValue="RATE">
                    <option value="RATE">A rate (DA and the like)</option>
                    <option value="FORMULA">A head’s formula (a correction)</option>
                  </select>
                </label>
                <label className="ep-field" htmlFor="pp-rm">
                  <span className="ep-field__label">From the month</span>
                  <input id="pp-rm" name="month" type="month" className="ep-input" required />
                </label>
                <label className="ep-field" htmlFor="pp-rc">
                  <span className="ep-field__label">Rate code (for a rate)</span>
                  <input
                    id="pp-rc"
                    name="rateCode"
                    className="ep-input"
                    list="pp-rates"
                    placeholder="DA_RATE"
                    maxLength={30}
                  />
                  <datalist id="pp-rates">
                    {rates.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </label>
                <label className="ep-field" htmlFor="pp-rv">
                  <span className="ep-field__label">New value (for a rate)</span>
                  <input
                    id="pp-rv"
                    name="newValue"
                    className="ep-input"
                    inputMode="decimal"
                    placeholder="0.64"
                  />
                  <span className="ep-field__help">As the registry holds it: 64 % is 0.64.</span>
                </label>
                <label className="ep-field" htmlFor="pp-rh">
                  <span className="ep-field__label">Pay head code (for a formula)</span>
                  <input id="pp-rh" name="headCode" className="ep-input" maxLength={20} />
                </label>
                <label className="ep-field" htmlFor="pp-rf">
                  <span className="ep-field__label">New formula (for a formula)</span>
                  <input id="pp-rf" name="formula" className="ep-input" maxLength={255} />
                </label>
                <label className="ep-field" htmlFor="pp-rn">
                  <span className="ep-field__label">Notified on</span>
                  <input id="pp-rn" name="notifiedOn" type="date" className="ep-input" />
                </label>
                <label className="ep-field" htmlFor="pp-rr">
                  <span className="ep-field__label">Why</span>
                  <input
                    id="pp-rr"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                  />
                </label>
              </div>
              <div className="ep-grid__toolbar">
                <button type="submit" className="ep-btn ep-btn--primary">
                  Draft
                </button>
              </div>
            </form>
          </DialogButton>
        </div>
      ) : null}
    </section>
  );
}

// ---- the yearly increments ------------------------------------------------------------------------------------
export async function IncrementsTab({ month }: { month: string }) {
  const d = await apiFetch<{
    rule: { month: number; minMonths: number; pct: string; matrix: string };
    rows: Array<{
      employeeId: string;
      code: string;
      name: string;
      joinedOn: string | null;
      lastIncrement: string | null;
      level: string | null;
      cellFrom: number | null;
      cellTo: number | null;
      from: string;
      to: string | null;
      status: string;
      note: string;
    }>;
    can: { propose: boolean };
  }>(`/payroll/increments?month=${month}`);
  const due = d.rows.filter((r) => r.status === 'DUE');
  return (
    <section className="ep-card" aria-labelledby="pp-inc">
      <h2 id="pp-inc" className="ep-card__title">
        Increments of {monthLabel(month)}
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Once a year in {monthLabel(`2026-${String(d.rule.month).padStart(2, '0')}`).split(' ')[0]}{' '}
        (or each employee’s own month), for staff with at least {d.rule.minMonths} months’ service:
        the next cell of their pay level, or {d.rule.pct} % for staff off the pay matrix. A maker
        proposes; another checker applies them, and each gets a numbered letter.
      </p>
      <form method="get" action="/payroll/people" className="ep-grid__toolbar">
        <input type="hidden" name="tab" value="increments" />
        <label className="ep-field" htmlFor="pp-im">
          <span className="ep-field__label">Month</span>
          <input
            id="pp-im"
            name="month"
            type="month"
            className="ep-input"
            defaultValue={month}
            required
          />
        </label>
        <button type="submit" className="ep-btn ep-btn--secondary">
          Show
        </button>
      </form>
      {d.rows.length ? (
        <form action={proposeIncrements.bind(null, month)}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-inc">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="ep-sr-only">Choose</span>
                  </th>
                  <th scope="col">Employee</th>
                  <th scope="col">Level · cell</th>
                  <th scope="col">Basic now (₹)</th>
                  <th scope="col">Basic after (₹)</th>
                  <th scope="col">Last increment</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.employeeId}>
                    <td>
                      {r.status === 'DUE' && d.can.propose ? (
                        <input
                          type="checkbox"
                          name="employeeId"
                          value={r.employeeId}
                          defaultChecked
                          aria-label={`Increment ${r.name}`}
                        />
                      ) : null}
                    </td>
                    <td>
                      {r.name} <span className="ep-field__help">{r.code}</span>
                    </td>
                    <td>
                      {r.level
                        ? `${r.level} · ${String(r.cellFrom ?? '—')}${r.cellTo ? ` → ${String(r.cellTo)}` : ''}`
                        : '—'}
                    </td>
                    <td>{money(r.from)}</td>
                    <td>{r.to ? money(r.to) : '—'}</td>
                    <td>{r.lastIncrement ? dmy(r.lastIncrement) : '—'}</td>
                    <td>
                      <Badge tone={r.status === 'DUE' ? 'info' : 'neutral'}>
                        {r.status === 'DUE' ? 'Due' : r.status === 'TOP' ? 'At the top' : 'Not due'}
                      </Badge>
                      <div className="ep-field__help">{r.note}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {due.length && d.can.propose ? (
            <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
              <label className="ep-field" htmlFor="pp-ir">
                <span className="ep-field__label">Why</span>
                <input
                  id="pp-ir"
                  name="reason"
                  className="ep-input"
                  defaultValue="Yearly increment"
                  maxLength={300}
                />
              </label>
              <button type="submit" className="ep-btn ep-btn--primary">
                Propose the ticked increments
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <p>No staff with a basic pay this month.</p>
      )}
    </section>
  );
}

// ---- settlements ----------------------------------------------------------------------------------------------
export async function SettlementsTab({ status }: { status: string }) {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      code: string;
      name: string;
      lastDay: string;
      reason: string;
      status: string;
      gratuity: string;
      encashAmount: string;
      net: string;
      statementStatus: string | null;
    }>;
  }>(`/payroll/settlements${status === 'ALL' ? '' : `?status=${status}`}`);
  const filters = ['ALL', 'DRAFT', 'COMPUTED', 'APPROVED', 'STAGED', 'DUES', 'SETTLED'];
  return (
    <section className="ep-card" aria-labelledby="pp-fnf">
      <h2 id="pp-fnf" className="ep-card__title">
        Leavers’ settlements
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Every accepted exit comes here as a draft. Payroll works out gratuity, leave encashment, the
        notice short and what is owed; the figures go on the exit statement. Another checker
        approves; it is paid by the month’s run, or the employee is asked for the dues.
      </p>
      <nav aria-label="Status" className="ep-field__help" style={{ marginBottom: 'var(--sp-3)' }}>
        {filters.map((f, i) => (
          <span key={f}>
            {i ? ' · ' : ''}
            {f === status ? (
              <strong>{f === 'ALL' ? 'All' : FNF_STATUS[f]![0]}</strong>
            ) : (
              <a href={`/payroll/people?tab=settlements&status=${f}`}>
                {f === 'ALL' ? 'All' : FNF_STATUS[f]![0]}
              </a>
            )}
          </span>
        ))}
      </nav>
      {d.rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-fnf">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Last day</th>
                <th scope="col">Why</th>
                <th scope="col">Gratuity (₹)</th>
                <th scope="col">Leave (₹)</th>
                <th scope="col">Net (₹)</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/payroll/people/settlements/${r.id}`}>{r.name}</a>{' '}
                    <span className="ep-field__help">{r.code}</span>
                  </td>
                  <td>{dmy(r.lastDay)}</td>
                  <td>{REASONS[r.reason] ?? r.reason}</td>
                  <td>{money(r.gratuity)}</td>
                  <td>{money(r.encashAmount)}</td>
                  <td>
                    {Number(r.net) < 0
                      ? `${money(String(-Number(r.net)))} due from them`
                      : money(r.net)}
                  </td>
                  <td>
                    <Badge tone={FNF_STATUS[r.status]?.[1] ?? 'neutral'}>
                      {FNF_STATUS[r.status]?.[0] ?? r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>None.</p>
      )}
    </section>
  );
}

// ---- transfers from a sister school ---------------------------------------------------------------------------
export async function TransfersTab() {
  const d = await apiFetch<{
    rows: Array<{
      id: string;
      onDate: string;
      fromSchool: string | null;
      code: string;
      name: string;
      importedAt: string | null;
      importedBy: string | null;
    }>;
    can: { bring: boolean };
  }>('/payroll/transfers');
  return (
    <section className="ep-card" aria-labelledby="pp-tr">
      <h2 id="pp-tr" className="ep-card__title">
        Staff from a sister school
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        Once this school has taken an employee transferred within the group, a checker brings their
        payroll across: the earlier-employer record for this year’s tax, the payroll profile, the
        pay structure (as drafts for another checker to approve) and the loans still owed. The date
        of joining comes with the employee, so gratuity counts the whole service.
      </p>
      {d.rows.length ? (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-tr">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">From</th>
                <th scope="col">On</th>
                <th scope="col">Payroll</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {d.can.bring ? (
                      <a href={`/payroll/people/transfers/${r.id}`}>{r.name}</a>
                    ) : (
                      r.name
                    )}{' '}
                    <span className="ep-field__help">{r.code}</span>
                  </td>
                  <td>{r.fromSchool ?? '—'}</td>
                  <td>{dmy(r.onDate)}</td>
                  <td>
                    {r.importedAt ? (
                      <Badge tone="success">Brought across</Badge>
                    ) : (
                      <Badge tone="warning">To bring</Badge>
                    )}
                    {r.importedBy ? <div className="ep-field__help">by {r.importedBy}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No one has come from a sister school.</p>
      )}
    </section>
  );
}
