import { DialogButton } from '@/components/leave/DialogButton';
import type { TaxYear } from '@/lib/payroll';
import { removeTaxLine, removeTaxYear, saveTaxLine, saveTaxRegime } from '@/lib/payroll-actions';

/** a rate (0.05) as the per cent typed (5) */
const per = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(Number((Number(v) * 100).toFixed(4)));
/** an amount without the trailing .00 */
const amt = (v: string | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(Number(v));
const words = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** A year an approved run used: the warning and the tick a change needs. */
function InUse({ id, inUse }: { id: string; inUse: string[] }) {
  if (!inUse.length) return null;
  return (
    <div className="ep-alert ep-alert--warning" role="status">
      <div>
        <strong>This year is in use.</strong> The runs of {inUse.map(words).join(', ')} are
        approved: their TDS stays as deducted. The months after are projected on the new figures.
        <label className="ep-check" htmlFor={`${id}-confirm`} style={{ marginTop: 'var(--sp-2)' }}>
          <input id={`${id}-confirm`} type="checkbox" name="confirm" required /> I understand:
          change it for the rest of the year
        </label>
      </div>
    </div>
  );
}

function Reason({ id }: { id: string }) {
  return (
    <label className="ep-field" htmlFor={`${id}-why`}>
      <span className="ep-field__label">Why (the notification, the Budget)</span>
      <input
        id={`${id}-why`}
        name="reason"
        className="ep-input"
        required
        minLength={10}
        maxLength={300}
      />
    </label>
  );
}

/**
 * Change a regime of a year: its slabs (each from where the one before ends, the last open), its rules and its
 * surcharges, saved together with a reason. Empty rows are left out: two spare rows add a slab or a surcharge.
 */
export function RegimeEditor({ fy, regime, d }: { fy: string; regime: 'NEW' | 'OLD'; d: TaxYear }) {
  const id = `tx-${regime.toLowerCase()}`;
  const slabs = d.slabs.filter((x) => x.regime === regime);
  const cfg = d.config.find((x) => x.regime === regime);
  const sur = d.surcharges.filter((x) => x.regime === regime);
  const slabRows = [...slabs, null, null];
  const surRows = [...sur, null, null];
  const label = regime === 'NEW' ? 'new regime' : 'old regime';
  return (
    <DialogButton
      id={`${id}-edit`}
      label="Change"
      title={`Change the ${label} of ${fy}`}
      className="ep-btn ep-btn--secondary ep-btn--sm"
    >
      <form action={saveTaxRegime.bind(null, fy, regime)} className="ep-form-section__body">
        <InUse id={id} inUse={d.inUse ?? []} />
        <fieldset className="ep-fieldset">
          <legend className="ep-field__label">Slabs</legend>
          <p className="ep-field__help">
            The first starts at ₹0; each starts where the one before ends; leave the last “up to”
            empty (and above). Empty rows are left out; clear a row to remove it.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Taxable income from (₹)</th>
                  <th scope="col">up to (₹)</th>
                  <th scope="col">Rate (%)</th>
                </tr>
              </thead>
              <tbody>
                {slabRows.map((s, i) => (
                  <tr key={`${String(i)}-${s?.slabFrom ?? 'new'}`}>
                    <td>
                      <input
                        name="sFrom"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label={`Slab ${String(i + 1)} from`}
                        defaultValue={amt(s?.slabFrom)}
                      />
                    </td>
                    <td>
                      <input
                        name="sTo"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label={`Slab ${String(i + 1)} up to`}
                        defaultValue={amt(s?.slabTo)}
                      />
                    </td>
                    <td>
                      <input
                        name="sRate"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label={`Slab ${String(i + 1)} rate per cent`}
                        defaultValue={per(s?.rate)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        <fieldset className="ep-fieldset">
          <legend className="ep-field__label">Rules</legend>
          <div className="ep-profile__grid">
            {(
              [
                ['standardDeduction', 'Standard deduction (₹)', amt(cfg?.standardDeduction)],
                [
                  'rebateIncomeLimit',
                  'Rebate when taxable income is at most (₹)',
                  amt(cfg?.rebateIncomeLimit),
                ],
                ['rebateMax', 'Rebate at most (₹)', amt(cfg?.rebateMax)],
                ['cessRate', 'Cess (%)', per(cfg?.cessRate)],
                ['panAbsentRate', 'Rate without a PAN, at least (%)', per(cfg?.panAbsentRate)],
              ] as const
            ).map(([name, text, value]) => (
              <label key={name} className="ep-field" htmlFor={`${id}-${name}`}>
                <span className="ep-field__label">{text}</span>
                <input
                  id={`${id}-${name}`}
                  name={name}
                  className="ep-input"
                  inputMode="decimal"
                  required
                  defaultValue={value}
                />
              </label>
            ))}
          </div>
          <label className="ep-check" htmlFor={`${id}-mr`}>
            <input
              id={`${id}-mr`}
              type="checkbox"
              name="marginalRelief"
              defaultChecked={cfg?.marginalRelief ?? true}
            />{' '}
            Marginal relief just above the rebate limit
          </label>
        </fieldset>
        <fieldset className="ep-fieldset">
          <legend className="ep-field__label">Surcharges</legend>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Above an income of (₹)</th>
                  <th scope="col">Rate (%)</th>
                </tr>
              </thead>
              <tbody>
                {surRows.map((s, i) => (
                  <tr key={`${String(i)}-${s?.incomeFrom ?? 'new'}`}>
                    <td>
                      <input
                        name="xFrom"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label={`Surcharge ${String(i + 1)} above`}
                        defaultValue={amt(s?.incomeFrom)}
                      />
                    </td>
                    <td>
                      <input
                        name="xRate"
                        className="ep-input"
                        inputMode="decimal"
                        aria-label={`Surcharge ${String(i + 1)} rate per cent`}
                        defaultValue={per(s?.rate)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>
        <Reason id={id} />
        <p>
          <button type="submit" className="ep-btn ep-btn--primary">
            Save the {label}
          </button>
        </p>
      </form>
    </DialogButton>
  );
}

type Line = TaxYear['labels'][number];

/** Add a line (no `line`) or change one: label, regime, cap, the group limit it counts in, whether staff declare it. */
export function LineEditor({ fy, line, d }: { fy: string; line: Line | null; d: TaxYear }) {
  const id = line ? `tl-${line.lineCode}` : 'tl-new';
  const groups = d.labels.filter(
    (l) => !l.declarable && l.capAmount && l.lineCode !== line?.lineCode,
  );
  return (
    <DialogButton
      id={`${id}-edit`}
      label={line ? 'Edit' : '＋ Add a line'}
      title={line ? `Change ${line.lineCode}` : `A new line of ${fy}`}
      className={line ? 'ep-btn ep-btn--ghost ep-btn--sm' : 'ep-btn ep-btn--primary ep-btn--sm'}
    >
      <form
        action={saveTaxLine.bind(null, fy, line ? line.lineCode : null)}
        className="ep-form-section__body"
      >
        <InUse id={id} inUse={d.inUse ?? []} />
        {line ? null : (
          <p className="ep-field__help">
            A line staff declare, with a cap, is a deduction the projection counts (up to its cap,
            and within its group limit). Other lines are printed words.
          </p>
        )}
        <div className="ep-profile__grid">
          {line ? null : (
            <label className="ep-field" htmlFor={`${id}-code`}>
              <span className="ep-field__label">Code</span>
              <input
                id={`${id}-code`}
                name="lineCode"
                className="ep-input"
                required
                maxLength={30}
                pattern="[A-Za-z][A-Za-z0-9_]{1,29}"
              />
              <span className="ep-field__help">Capital letters, digits and _ (CHAPVIA_80EEB)</span>
            </label>
          )}
          <label className="ep-field" htmlFor={`${id}-label`}>
            <span className="ep-field__label">Label</span>
            <input
              id={`${id}-label`}
              name="label"
              className="ep-input"
              required
              maxLength={150}
              defaultValue={line?.label ?? ''}
            />
          </label>
          <label className="ep-field" htmlFor={`${id}-regime`}>
            <span className="ep-field__label">Regime</span>
            <select
              id={`${id}-regime`}
              name="appliesTo"
              className="ep-select"
              defaultValue={line?.appliesTo ?? 'OLD'}
            >
              <option value="OLD">Old regime</option>
              <option value="NEW">New regime</option>
              <option value="BOTH">Both</option>
            </select>
          </label>
          <label className="ep-field" htmlFor={`${id}-cap`}>
            <span className="ep-field__label">Cap (₹)</span>
            <input
              id={`${id}-cap`}
              name="capAmount"
              className="ep-input"
              inputMode="decimal"
              defaultValue={amt(line?.capAmount)}
            />
            <span className="ep-field__help">Empty: no cap</span>
          </label>
          <label className="ep-field" htmlFor={`${id}-group`}>
            <span className="ep-field__label">Counts within the limit of</span>
            <select
              id={`${id}-group`}
              name="capGroup"
              className="ep-select"
              defaultValue={line?.capGroup ?? ''}
            >
              <option value="">No group limit</option>
              {groups.map((g) => (
                <option key={g.lineCode} value={g.lineCode}>
                  {g.lineCode} (₹{amt(g.capAmount)})
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="ep-check" htmlFor={`${id}-decl`}>
          <input
            id={`${id}-decl`}
            type="checkbox"
            name="declarable"
            defaultChecked={line?.declarable ?? true}
          />{' '}
          Staff declare it (in My tax)
        </label>
        <Reason id={id} />
        <p>
          <button type="submit" className="ep-btn ep-btn--primary">
            {line ? 'Save the line' : 'Add the line'}
          </button>
        </p>
      </form>
    </DialogButton>
  );
}

/** Remove a line EduPro does not name and no declaration uses. */
export function LineRemove({ fy, line }: { fy: string; line: Line }) {
  const id = `tl-${line.lineCode}-rm`;
  return (
    <DialogButton
      id={id}
      label="Remove"
      title={`Remove ${line.lineCode}`}
      className="ep-btn ep-btn--ghost ep-btn--sm"
    >
      <form action={removeTaxLine.bind(null, fy, line.lineCode)} className="ep-form-section__body">
        <p className="ep-field__help">
          It goes from {fy} only; no declaration uses it. Recorded in the payroll audit trail.
        </p>
        <Reason id={id} />
        <p>
          <button type="submit" className="ep-btn ep-btn--primary">
            Remove it
          </button>
        </p>
      </form>
    </DialogButton>
  );
}

/** Remove a year added by mistake, while nothing belongs to it. */
export function YearRemove({ fy }: { fy: string }) {
  return (
    <DialogButton
      id="tx-year-rm"
      label="Remove this year"
      title={`Remove ${fy}`}
      className="ep-btn ep-btn--ghost ep-btn--sm"
    >
      <form action={removeTaxYear.bind(null, fy)} className="ep-form-section__body">
        <p className="ep-field__help">
          Its slabs, rules, surcharges and lines go. Nothing uses the year: no pay run, declaration,
          challan or certificate. Recorded in the payroll audit trail.
        </p>
        <Reason id="tx-year-rm" />
        <p>
          <button type="submit" className="ep-btn ep-btn--primary">
            Remove {fy}
          </button>
        </p>
      </form>
    </DialogButton>
  );
}
