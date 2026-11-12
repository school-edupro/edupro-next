import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { VersionFields } from '@/components/payroll/VersionFields';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { CALC_LABEL, CATEGORY, dmy, type HeadListRow, type PayrollCan } from '@/lib/payroll';
import { addPayHead } from '@/lib/payroll-actions';

/** Pay heads (legacy Pay Heads): one line of the payslip each, worked out by its version in force. */
export default async function PayHeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let d: { heads: HeadListRow[]; can: PayrollCan };
  try {
    d = await apiFetch<{ heads: HeadListRow[]; can: PayrollCan }>('/payroll/heads');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const groups = [
    { type: 'EARNING', title: 'Earnings' },
    { type: 'DEDUCTION', title: 'Deductions' },
  ] as const;
  const flags = (h: HeadListRow) =>
    [
      h.pfWage && 'PF',
      h.esiWage && 'ESI',
      h.ptWage && 'PT',
      h.isTaxable && 'Tax',
      h.prorateOnLop && 'LOP',
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Payroll set-up', href: '/payroll/setup' }, { label: 'Pay heads' }]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Pay heads"
        description="Each line of the payslip. How a head is worked out lives in dated versions: a new formula is a new version, tested and approved before the month it applies from."
      />
      <Notice params={sp} />
      {d.can.manage ? (
        <div className="ep-grid__toolbar" style={{ marginBottom: 'var(--sp-4)' }}>
          <span className="ep-grid__spacer" />
          <DialogButton id="ph-new" label="＋ New pay head" title="A new pay head">
            <form action={addPayHead} className="ep-form-section__body">
              <div className="ep-profile__grid">
                <label className="ep-field" htmlFor="ph-code">
                  <span className="ep-field__label">Code</span>
                  <input
                    id="ph-code"
                    name="code"
                    className="ep-input"
                    required
                    maxLength={20}
                    pattern="[A-Za-z][A-Za-z0-9_]*"
                  />
                  <span className="ep-field__help">
                    The name formulas use: [CODE] (capital letters, digits, _)
                  </span>
                </label>
                <label className="ep-field" htmlFor="ph-name">
                  <span className="ep-field__label">Name on the payslip</span>
                  <input id="ph-name" name="name" className="ep-input" required maxLength={100} />
                </label>
                <label className="ep-field" htmlFor="ph-cat">
                  <span className="ep-field__label">Kind</span>
                  <select
                    id="ph-cat"
                    name="category"
                    className="ep-select"
                    defaultValue="ALLOWANCE"
                  >
                    {Object.entries(CATEGORY).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field" htmlFor="ph-order">
                  <span className="ep-field__label">Order on the payslip</span>
                  <input
                    id="ph-order"
                    name="printOrder"
                    type="number"
                    min={0}
                    max={9999}
                    className="ep-input"
                    defaultValue={100}
                  />
                </label>
              </div>
              <label className="ep-check" htmlFor="ph-zero">
                <input id="ph-zero" type="checkbox" name="showIfZero" /> Print it even when it is
                nil
              </label>
              <h4 className="ep-card__title" style={{ marginTop: 'var(--sp-3)' }}>
                Its first version
              </h4>
              <VersionFields id="ph-v" headType={null} />
              <p>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Add the head
                </button>
              </p>
            </form>
          </DialogButton>
        </div>
      ) : null}
      {groups.map((g) => {
        const rows = d.heads.filter((h) => h.headType === g.type);
        return (
          <section
            key={g.type}
            className="ep-card"
            aria-labelledby={`ph-${g.type}`}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <h2 id={`ph-${g.type}`} className="ep-card__title">
              {g.title} ({rows.length})
            </h2>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-labelledby={`ph-${g.type}`}
            >
              <table className="ep-table ep-table--dense">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Name</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Worked out</th>
                    <th scope="col">Counts for</th>
                    <th scope="col">In force from</th>
                    <th scope="col">Versions</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => (
                    <tr key={h.id}>
                      <td>
                        <a href={`/payroll/setup/heads/${h.id}`}>
                          <code>{h.code}</code>
                        </a>
                      </td>
                      <td>{h.name}</td>
                      <td>{CATEGORY[h.category] ?? h.category}</td>
                      <td>
                        {h.calcType ? CALC_LABEL[h.calcType] : ''}
                        {h.formula ? (
                          <>
                            {' '}
                            <code className="ep-field__help">{h.formula}</code>
                          </>
                        ) : null}
                      </td>
                      <td>{flags(h)}</td>
                      <td>
                        {h.liveFrom ? dmy(h.liveFrom) : <Badge tone="danger">None in force</Badge>}
                      </td>
                      <td>
                        {h.versions}
                        {h.drafts ? (
                          <>
                            {' '}
                            <Badge tone="warning">{`${String(h.drafts)} draft`}</Badge>
                          </>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={h.status === 'active' ? 'success' : 'neutral'}>
                          {h.status === 'active' ? 'In use' : 'Not in use'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
