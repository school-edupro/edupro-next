import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { VersionFields } from '@/components/payroll/VersionFields';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { CALC_LABEL, CATEGORY, dmy, STATUS_TONE, type HeadDetail } from '@/lib/payroll';
import {
  addFormulaTest,
  addHeadVersion,
  endHeadVersion,
  testAction,
  updatePayHead,
  versionAction,
} from '@/lib/payroll-actions';

const ROUND_LABEL: Record<string, string> = {
  NONE: 'Not rounded',
  NEAREST_1: 'Nearest ₹1',
  FLOOR_1: 'Down to ₹1',
  CEIL_1: 'Up to ₹1',
  NEAREST_10: 'Nearest ₹10',
  NEAREST_100: 'Nearest ₹100',
  CEIL_100: 'Up to ₹100',
};

/** One pay head: its name and kind, its dated versions (draft → approved by another person), its formula tests. */
export default async function PayHeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.setup.view')) notFound();
  let d: HeadDetail;
  try {
    d = await apiFetch<HeadDetail>(`/payroll/heads/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const h = d.head;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const live = d.versions.find(
    (v) =>
      v.status === 'active' &&
      v.effectiveFrom <= today &&
      (!v.effectiveTo || v.effectiveTo >= today),
  );
  const latest = d.versions.find((v) => v.status !== 'draft') ?? d.versions[0];
  const drafts = d.versions.filter((v) => v.status === 'draft').length;
  const failing = d.tests.filter((t) => t.lastStatus === 'fail').length;
  const flags = (v: HeadDetail['versions'][number]) =>
    [
      v.pfWage && 'PF',
      v.esiWage && 'ESI',
      v.ptWage && 'PT',
      v.isTaxable && 'Tax',
      v.prorateOnLop && 'LOP',
    ]
      .filter(Boolean)
      .join(' · ');
  const slabsOf = (vid: string) => d.slabs.filter((s) => s.versionId === vid);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Pay heads', href: '/payroll/setup/heads' },
          { label: h.code },
        ]}
      />
      <PageHeader
        kicker={h.headType === 'EARNING' ? 'Earning' : 'Deduction'}
        title={`${h.name} (${h.code})`}
        description={`${CATEGORY[h.category] ?? h.category}. In a formula it is [${h.code}].`}
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile
          label="In force"
          value={
            live
              ? `${CALC_LABEL[live.calcType] ?? live.calcType} from ${dmy(live.effectiveFrom)}`
              : 'None'
          }
        />
        <KpiTile label="Versions" value={String(d.versions.length)} />
        <KpiTile label="Drafts" value={String(drafts)} />
        <KpiTile
          label="Tests"
          value={`${String(d.tests.length)}${failing ? ` (${String(failing)} failing)` : ''}`}
        />
      </div>
      <section className="ep-card" aria-labelledby="hd-versions">
        <div className="ep-grid__toolbar">
          <h2 id="hd-versions" className="ep-card__title">
            Versions
          </h2>
          <span className="ep-grid__spacer" />
          {d.can.manage ? (
            <DialogButton id="hd-new" label="＋ New version" title={`A new version of ${h.code}`}>
              <form action={addHeadVersion.bind(null, h.id)} className="ep-form-section__body">
                <p className="ep-field__help">
                  It starts as a draft. The saved tests run against it; a payroll checker who did
                  not make it approves it, and the version in force then ends the day before.
                </p>
                <VersionFields
                  id="hd-v"
                  headType={h.headType}
                  last={latest ?? null}
                  lastSlabs={latest ? slabsOf(latest.id) : []}
                />
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Save as a draft
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
        </div>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="hd-versions">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Worked out</th>
                <th scope="col">Counts for</th>
                <th scope="col">Rounding</th>
                <th scope="col">Status</th>
                <th scope="col">Made · approved by</th>
                <th scope="col">Why</th>
                <th scope="col">
                  <span className="ep-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {d.versions.map((v) => (
                <tr key={v.id}>
                  <td>{dmy(v.effectiveFrom)}</td>
                  <td>{v.effectiveTo ? dmy(v.effectiveTo) : 'Open'}</td>
                  <td>
                    {CALC_LABEL[v.calcType] ?? v.calcType}
                    {v.formula ? (
                      <>
                        {' '}
                        <code>{v.formula}</code>
                      </>
                    ) : null}
                    {v.calcType === 'SLAB'
                      ? slabsOf(v.id).map((s) => (
                          <span
                            key={s.rangeFrom}
                            className="ep-field__help"
                            style={{ display: 'block', margin: 0 }}
                          >
                            ₹{s.rangeFrom}–{s.rangeTo ? `₹${s.rangeTo}` : 'above'}:{' '}
                            {s.percent ? `${s.percent} %` : `₹${s.flatAmount ?? ''}`}
                          </span>
                        ))
                      : null}
                  </td>
                  <td>{flags(v)}</td>
                  <td>{ROUND_LABEL[v.rounding] ?? v.rounding}</td>
                  <td>
                    <Badge tone={STATUS_TONE[v.status]}>
                      {v.status === 'draft'
                        ? 'Draft'
                        : v === live
                          ? 'In force'
                          : v.status === 'active'
                            ? 'Approved'
                            : 'Ended'}
                    </Badge>
                  </td>
                  <td>
                    {v.createdByName ?? 'Default'}
                    {v.approvedByName ? ` · ${v.approvedByName}` : ''}
                  </td>
                  <td>{v.changeReason ?? ''}</td>
                  <td>
                    <div className="ep-grid__toolbar">
                      {v.status === 'draft' && d.can.approve ? (
                        <form action={versionAction.bind(null, h.id, v.id, 'approve')}>
                          <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                            Approve
                          </button>
                        </form>
                      ) : null}
                      {v.status === 'draft' && (v.mine || d.can.approve) ? (
                        <form action={versionAction.bind(null, h.id, v.id, 'delete')}>
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            Delete
                          </button>
                        </form>
                      ) : null}
                      {v.status === 'active' && !v.effectiveTo && d.can.approve ? (
                        <DialogButton
                          id={`hd-end-${v.id}`}
                          label="End"
                          title="End this version"
                          className="ep-btn ep-btn--ghost ep-btn--sm"
                        >
                          <form
                            action={endHeadVersion.bind(null, h.id, v.id)}
                            className="ep-form-section__body"
                          >
                            <p className="ep-field__help">
                              After this day the head is not worked out at all. To change how it is
                              worked out, add a new version instead.
                            </p>
                            <label className="ep-field" htmlFor={`hd-end-to-${v.id}`}>
                              <span className="ep-field__label">Last day</span>
                              <input
                                id={`hd-end-to-${v.id}`}
                                name="effectiveTo"
                                type="date"
                                className="ep-input"
                                required
                              />
                            </label>
                            <label className="ep-field" htmlFor={`hd-end-why-${v.id}`}>
                              <span className="ep-field__label">Why</span>
                              <input
                                id={`hd-end-why-${v.id}`}
                                name="reason"
                                className="ep-input"
                                required
                                minLength={3}
                                maxLength={200}
                              />
                            </label>
                            <p>
                              <button type="submit" className="ep-btn ep-btn--primary">
                                End it
                              </button>
                            </p>
                          </form>
                        </DialogButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <FoldCard
        id="hd-tests"
        title="Formula tests"
        hint={
          d.tests.length
            ? `${String(d.tests.length)} saved, ${failing ? `${String(failing)} failing` : 'all passing'}: they run whenever a version is saved or approved`
            : 'Sample values with the answer expected: a version that gets a test wrong cannot be saved'
        }
        open={failing > 0}
      >
        {d.tests.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="hd-tests">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Values</th>
                  <th scope="col">Expected (₹)</th>
                  <th scope="col">Last result (₹)</th>
                  <th scope="col">
                    <span className="ep-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.tests.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>
                      <code>
                        {Object.entries(t.inputs)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(', ')}
                      </code>
                    </td>
                    <td>{t.expected}</td>
                    <td>
                      {t.lastResult ?? ''}{' '}
                      {t.lastStatus ? (
                        <Badge tone={t.lastStatus === 'pass' ? 'success' : 'danger'}>
                          {t.lastStatus === 'pass' ? 'Passes' : 'Fails'}
                        </Badge>
                      ) : null}
                    </td>
                    <td>
                      {d.can.manage ? (
                        <form action={testAction.bind(null, h.id, t.id)}>
                          <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                            Delete
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="ep-grid__toolbar" style={{ marginTop: 'var(--sp-3)' }}>
          {d.tests.length ? (
            <form action={testAction.bind(null, h.id, null)}>
              <button type="submit" className="ep-btn ep-btn--ghost">
                Run them against the version in force
              </button>
            </form>
          ) : null}
          {d.can.manage ? (
            <DialogButton id="hd-test" label="＋ New test" title={`A test for ${h.code}`}>
              <form action={addFormulaTest.bind(null, h.id)} className="ep-form-section__body">
                <label className="ep-field" htmlFor="hd-t-name">
                  <span className="ep-field__label">Name</span>
                  <input
                    id="hd-t-name"
                    name="name"
                    className="ep-input"
                    required
                    maxLength={80}
                    placeholder="Level 7 cell 1 at 55 %"
                  />
                </label>
                <label className="ep-field" htmlFor="hd-t-in">
                  <span className="ep-field__label">Values</span>
                  <textarea
                    id="hd-t-in"
                    name="inputs"
                    className="ep-input"
                    rows={3}
                    required
                    placeholder={'BASIC=44900\nDA_RATE=0.55'}
                  />
                  <span className="ep-field__help">
                    One a line (or with commas): CODE=value — heads in rupees, rates as decimals
                  </span>
                </label>
                <label className="ep-field" htmlFor="hd-t-exp">
                  <span className="ep-field__label">Expected (₹)</span>
                  <input
                    id="hd-t-exp"
                    name="expected"
                    className="ep-input"
                    required
                    inputMode="decimal"
                  />
                </label>
                <p>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Save the test
                  </button>
                </p>
              </form>
            </DialogButton>
          ) : null}
        </div>
      </FoldCard>
      {d.can.manage ? (
        <FoldCard
          id="hd-about"
          title="Name and order"
          hint="The name on the payslip, its kind, its place in the list, in use or not"
        >
          <form action={updatePayHead.bind(null, h.id)} className="ep-form-section__body">
            <div className="ep-profile__grid">
              <label className="ep-field" htmlFor="hd-name">
                <span className="ep-field__label">Name on the payslip</span>
                <input
                  id="hd-name"
                  name="name"
                  className="ep-input"
                  required
                  maxLength={100}
                  defaultValue={h.name}
                />
              </label>
              <label className="ep-field" htmlFor="hd-cat">
                <span className="ep-field__label">Kind</span>
                <select id="hd-cat" name="category" className="ep-select" defaultValue={h.category}>
                  {Object.entries(CATEGORY).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="hd-order">
                <span className="ep-field__label">Order on the payslip</span>
                <input
                  id="hd-order"
                  name="printOrder"
                  type="number"
                  min={0}
                  max={9999}
                  className="ep-input"
                  defaultValue={h.printOrder}
                />
              </label>
              <label className="ep-field" htmlFor="hd-status">
                <span className="ep-field__label">In use</span>
                <select id="hd-status" name="status" className="ep-select" defaultValue={h.status}>
                  <option value="active">In use</option>
                  <option value="inactive">Not in use (kept for earlier months)</option>
                </select>
              </label>
            </div>
            <p>
              <button type="submit" className="ep-btn ep-btn--primary">
                Save
              </button>
            </p>
          </form>
        </FoldCard>
      ) : null}
    </>
  );
}
