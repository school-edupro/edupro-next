import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { type PayMatrix } from '@/lib/payroll';
import { removeMatrixCell, saveMatrixCell } from '@/lib/payroll-actions';

const rupees = (v: string) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/** The pay matrix (legacy Pay Matrix): basic pay by level (across) and cell (down); profiles name a level and cell. */
export default async function PayMatrixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  const code = /^[A-Z0-9_]{1,30}$/.test(sp.code ?? '') ? `?code=${sp.code!}` : '';
  let d: PayMatrix;
  try {
    d = await apiFetch<PayMatrix>(`/payroll/matrix${code}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const maxCell = Math.max(0, ...d.levels.flatMap((l) => l.cells.map((c) => c.cell)));
  const cellRows = Array.from({ length: maxCell }, (_, i) => i + 1);
  const used = d.levels.reduce((n, l) => n + l.cells.reduce((m, c) => m + c.used, 0), 0);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Payroll set-up', href: '/payroll/setup' }, { label: 'Pay matrix' }]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title={`Pay matrix ${d.code}`}
        description={`Basic pay by level and cell.${d.code === d.active ? ' This is the matrix in use: every profile’s level and cell must be in it.' : ` The matrix in use is ${d.active}.`} ${String(used)} profile(s) sit on it.`}
      />
      <Notice params={sp} />
      <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-4)' }}>
        {d.codes.length > 1 ? (
          <form method="get" className="ep-grid__toolbar">
            <label className="ep-field" htmlFor="pm-code">
              <span className="ep-field__label">Matrix</span>
              <select id="pm-code" name="code" className="ep-select" defaultValue={d.code}>
                {d.codes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="ep-btn ep-btn--ghost">
              Show
            </button>
          </form>
        ) : null}
        <span className="ep-grid__spacer" />
        {d.can.approve ? (
          <>
            <DialogButton id="pm-set" label="＋ Add or change a cell" title="A cell of the matrix">
              <form action={saveMatrixCell} className="ep-form-section__body">
                <input type="hidden" name="matrixCode" value={d.code} />
                <p className="ep-field__help">
                  A new level, a new cell or a changed amount. A changed amount applies to months
                  from its date.
                </p>
                <div className="ep-profile__grid">
                  <label className="ep-field" htmlFor="pm-level">
                    <span className="ep-field__label">Level</span>
                    <input
                      id="pm-level"
                      name="payLevel"
                      className="ep-input"
                      required
                      maxLength={10}
                      list="pm-levels"
                    />
                    <datalist id="pm-levels">
                      {d.levels.map((l) => (
                        <option key={l.level} value={l.level} />
                      ))}
                    </datalist>
                  </label>
                  <label className="ep-field" htmlFor="pm-order">
                    <span className="ep-field__label">Level’s place</span>
                    <input
                      id="pm-order"
                      name="levelOrder"
                      type="number"
                      min={0}
                      max={999}
                      className="ep-input"
                      defaultValue={d.levels.length + 1}
                    />
                    <span className="ep-field__help">
                      For a level already there, its place stays
                    </span>
                  </label>
                  <label className="ep-field" htmlFor="pm-cell">
                    <span className="ep-field__label">Cell</span>
                    <input
                      id="pm-cell"
                      name="cellNo"
                      type="number"
                      min={1}
                      max={60}
                      className="ep-input"
                      required
                    />
                  </label>
                  <label className="ep-field" htmlFor="pm-basic">
                    <span className="ep-field__label">Basic pay (₹ a month)</span>
                    <input
                      id="pm-basic"
                      name="basic"
                      className="ep-input"
                      required
                      inputMode="decimal"
                    />
                  </label>
                  <label className="ep-field" htmlFor="pm-from">
                    <span className="ep-field__label">From</span>
                    <input
                      id="pm-from"
                      name="effectiveFrom"
                      type="date"
                      className="ep-input"
                      required
                    />
                  </label>
                </div>
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Save the cell
                  </button>
                </p>
              </form>
            </DialogButton>
            <DialogButton
              id="pm-del"
              label="Remove"
              title="Remove a cell or a level"
              className="ep-btn ep-btn--ghost ep-btn--sm"
            >
              <form action={removeMatrixCell} className="ep-form-section__body">
                <input type="hidden" name="matrixCode" value={d.code} />
                <p className="ep-field__help">
                  Not while a profile sits on it: move those staff first.
                </p>
                <div className="ep-profile__grid">
                  <label className="ep-field" htmlFor="pm-del-level">
                    <span className="ep-field__label">Level</span>
                    <select id="pm-del-level" name="payLevel" className="ep-select" required>
                      {d.levels.map((l) => (
                        <option key={l.level} value={l.level}>
                          {l.level}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="pm-del-cell">
                    <span className="ep-field__label">Cell</span>
                    <input
                      id="pm-del-cell"
                      name="cellNo"
                      type="number"
                      min={1}
                      max={60}
                      className="ep-input"
                    />
                    <span className="ep-field__help">Empty: the whole level</span>
                  </label>
                </div>
                <p>
                  <button type="submit" className="ep-btn ep-btn--danger">
                    Remove
                  </button>
                </p>
              </form>
            </DialogButton>
          </>
        ) : null}
      </div>
      <section className="ep-card" aria-labelledby="pm-grid">
        <h2 id="pm-grid" className="ep-card__title">
          {d.levels.length} levels, up to {maxCell} cells
        </h2>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pm-grid">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Cell</th>
                {d.levels.map((l) => (
                  <th key={l.level} scope="col">
                    Level {l.level}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cellRows.map((n) => (
                <tr key={n}>
                  <th scope="row">{n}</th>
                  {d.levels.map((l) => {
                    const c = l.cells.find((x) => x.cell === n);
                    return (
                      <td key={l.level} title={c ? `From ${c.effectiveFrom}` : undefined}>
                        {c ? rupees(c.basic) : ''}
                        {c?.used ? (
                          <>
                            {' '}
                            <Badge tone="info">{String(c.used)}</Badge>
                          </>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ep-field__help">
          A number beside an amount is how many profiles sit on that cell.
        </p>
      </section>
    </>
  );
}
