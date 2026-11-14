import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { SetupListBar } from '@/components/payroll/SetupListBar';
import { ApiError, getMe } from '@/lib/api';
import { setupList, type SetupList, type SetupListNav } from '@/lib/payroll-lists';
import { money } from '@/lib/payroll';
import { explain, sign } from '@/lib/payroll-golive-actions';

interface Results {
  batch: {
    id: string;
    kind: 'REPLAY' | 'PARALLEL';
    months: string[];
    counts: Record<string, unknown>;
  };
  rows: Array<{
    id: string;
    code: string;
    name: string;
    month: string;
    component: string;
    legacy: string | null;
    ours: string | null;
    diff: string;
    status: 'MATCH' | 'OPEN' | 'EXPLAINED';
    note: string | null;
    explanation_code: string | null;
    explanation: string | null;
    explained_by: string | null;
  }>;
  total: number;
  scoreboard: Array<{
    component: string;
    legacy: string;
    ours: string;
    match: number;
    explained: number;
    open: number;
  }>;
  byMonth: Array<{ month: string; open: number; explained: number; match: number }>;
}
const CODES: Record<string, string> = {
  ROUNDING: 'Rounding',
  LEGACY_DEFECT: 'A defect of the old payroll, fixed here',
  LABOUR_CODE: 'The labour codes’ wage rule',
  SETUP_GAP: 'A set-up difference',
  MISSING_INPUT: 'An input missing here',
  OTHER: 'Other',
};
const TONE = { MATCH: 'success', OPEN: 'warning', EXPLAINED: 'info' } as const;
const words = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** A comparison with the old payroll (docs/design/86, phase G): the scoreboard, every difference, explanations, sign. */
export default async function ParityPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { batchId } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(batchId)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  // the differences open first: a first visit shows the open ones; "All" is a choice
  const spx = { ...sp, status: sp.status === undefined ? 'OPEN' : sp.status };
  let d: Results;
  let list: SetupList<Results['rows'][number]>;
  let nav: SetupListNav;
  try {
    ({ list, nav } = await setupList<Results['rows'][number]>(
      'parity',
      `/payroll/setup/golive/parity/${batchId}`,
      spx,
      { params: { batchId } },
    ));
    d = { ...(list.extra as Omit<Results, 'rows' | 'total'>), rows: list.rows, total: list.total };
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const here = nav.href(list.page);
  const open = d.byMonth.reduce((t, m) => t + m.open, 0);
  const explained = d.byMonth.reduce((t, m) => t + m.explained, 0);
  const matched = d.byMonth.reduce((t, m) => t + m.match, 0);
  const checker =
    me.permissions.includes('payroll.run.approve') ||
    me.permissions.includes('payroll.settings.manage');
  const title = `${d.batch.kind === 'REPLAY' ? 'Replay' : 'The parallel months'} · ${d.batch.months.map(words).join(', ')}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll' },
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Moving from the old payroll', href: '/payroll/setup/golive' },
          { label: d.batch.kind === 'REPLAY' ? 'Replay' : 'Parallel months' },
        ]}
      />
      <PageHeader
        kicker="Parity"
        title={title}
        description="Every employee, head and month against the old payroll, to the paisa. A difference stays open until someone explains it."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Open" value={String(open)} />
        <KpiTile label="Explained" value={String(explained)} />
        <KpiTile label="Same to the paisa" value={String(matched)} />
        <KpiTile label="Months" value={String(d.batch.months.length)} />
        <KpiTile label="Heads and totals" value={String(d.scoreboard.length)} />
        <KpiTile label="Kind" value={d.batch.kind === 'REPLAY' ? 'Replay' : 'Parallel'} />
      </div>
      {d.batch.kind === 'PARALLEL' && checker ? (
        <form
          action={sign.bind(null, batchId)}
          className="ep-grid__toolbar"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <button type="submit" className="ep-btn ep-btn--primary">
            Sign the parallel months
          </button>
          <span className="ep-field__help">
            Once the second month has nothing open; the principal countersigns.
          </span>
        </form>
      ) : null}
      <FoldCard
        id="pp-score"
        title="Scoreboard"
        hint="Each head and total: the old payroll, EduPro, and what is open"
        open={open > 0}
      >
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Scoreboard">
          <table className="ep-table ep-table--dense">
            <thead>
              <tr>
                <th scope="col">Head or total</th>
                <th scope="col">Old payroll (₹)</th>
                <th scope="col">EduPro (₹)</th>
                <th scope="col">Same</th>
                <th scope="col">Explained</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {d.scoreboard.map((x) => (
                <tr key={x.component}>
                  <td>
                    <a
                      href={`/payroll/setup/golive/parity/${batchId}?status=all&component=${x.component}`}
                    >
                      {x.component}
                    </a>
                  </td>
                  <td>{money(x.legacy)}</td>
                  <td>{money(x.ours)}</td>
                  <td>{x.match}</td>
                  <td>{x.explained}</td>
                  <td>{x.open ? <strong>{x.open}</strong> : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FoldCard>
      <section className="ep-card" aria-labelledby="pp-list">
        <h2 id="pp-list" className="ep-card__title">
          Differences
        </h2>
        <SetupListBar list={list} nav={nav} id="pp">
          <form action={explain.bind(null, batchId, here)}>
            {d.rows.length ? (
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="pp-list">
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="ep-sr-only">Choose</span>
                      </th>
                      <th scope="col">Employee</th>
                      <th scope="col">Month</th>
                      <th scope="col">Head</th>
                      <th scope="col">Old payroll (₹)</th>
                      <th scope="col">EduPro (₹)</th>
                      <th scope="col">Difference (₹)</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.status !== 'MATCH' && checker ? (
                            <input
                              type="checkbox"
                              name="resultId"
                              value={r.id}
                              aria-label={`Choose ${r.name} ${r.component} ${r.month}`}
                            />
                          ) : null}
                        </td>
                        <td>
                          {r.name} <span className="ep-field__help">{r.code}</span>
                        </td>
                        <td>{words(r.month)}</td>
                        <td>{r.component}</td>
                        <td>{r.legacy === null ? '—' : money(r.legacy)}</td>
                        <td>{r.ours === null ? '—' : money(r.ours)}</td>
                        <td>{money(r.diff)}</td>
                        <td>
                          <Badge tone={TONE[r.status]}>
                            {r.status === 'MATCH'
                              ? 'Same'
                              : r.status === 'OPEN'
                                ? 'Open'
                                : 'Explained'}
                          </Badge>
                          {r.note ? <div className="ep-field__help">{r.note}</div> : null}
                          {r.status === 'EXPLAINED' && r.explanation ? (
                            <div className="ep-field__help">
                              {CODES[r.explanation_code ?? ''] ?? r.explanation_code}:{' '}
                              {r.explanation}
                              {r.explained_by ? ` (${r.explained_by})` : ''}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{list.all ? 'No difference matches the filters.' : 'Nothing to show.'}</p>
            )}
            {checker && d.rows.some((r) => r.status !== 'MATCH') ? (
              <fieldset className="ep-fieldset" style={{ marginTop: 'var(--sp-3)' }}>
                <legend className="ep-field__label">Explain the ticked differences</legend>
                <div className="ep-form-row" data-columns="3">
                  <label className="ep-field" htmlFor="pp-code">
                    <span className="ep-field__label">Why</span>
                    <select id="pp-code" name="code" className="ep-select" required defaultValue="">
                      <option value="" disabled>
                        Choose…
                      </option>
                      {Object.entries(CODES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="pp-def">
                    <span className="ep-field__label">
                      Which defect (for a defect of the old payroll)
                    </span>
                    <input id="pp-def" name="defect" className="ep-input" maxLength={60} />
                  </label>
                  <label className="ep-field" htmlFor="pp-note">
                    <span className="ep-field__label">The evidence</span>
                    <input
                      id="pp-note"
                      name="note"
                      className="ep-input"
                      required
                      minLength={10}
                      maxLength={480}
                    />
                  </label>
                </div>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Explain
                </button>
              </fieldset>
            ) : null}
          </form>
        </SetupListBar>
      </section>
    </>
  );
}
