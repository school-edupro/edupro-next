import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { dmy, type CutoverOverview, type CutoverPreview, type CutoverProblem } from '@/lib/leave';
import {
  requestCutoverRead,
  runCutoverStep,
  saveCutoverSettings,
  switchCutover,
} from '@/lib/leave-actions';

const STATUS: Record<
  CutoverOverview['status'],
  { label: string; tone: 'info' | 'warning' | 'success' }
> = {
  setup: { label: 'Setting up', tone: 'info' },
  parallel: { label: 'Parallel month', tone: 'warning' },
  switched: { label: 'Switched', tone: 'success' },
};
const STEP: Record<string, { title: string; text: string }> = {
  setup: {
    title: 'Bring the set-up',
    text: 'Leave types, policies, weekly offs, staff holidays, shifts and postings, timings, who approves, the settings, the reports’ “Not required” list and who opens each report. Brought again, the same rows are updated.',
  },
  balances: {
    title: 'Bring the balances',
    text: 'The balance ledger from 1 April to the month before the parallel month, as the old module closed it; the parallel month opens at that closing and is credited by the policies here. Starts the parallel month.',
  },
  history: {
    title: 'Bring this year’s history',
    text: 'Leave and its days, the days before the parallel month as the old module had them, late marks, missing punches, corrections and locked months. Bring it again each day of the parallel month: the old module is still the record.',
  },
};
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(iso))
    : '—';

function Problems({ id, list }: { id: string; list: CutoverProblem[] }) {
  if (!list.length) return <p className="ep-field__help">Nothing stood in the way.</p>;
  return (
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby={id}>
      <table className="ep-table ep-table--dense">
        <caption id={id} className="ep-sr-only">
          What could not come
        </caption>
        <thead>
          <tr>
            <th scope="col">What could not come</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              Rows
            </th>
            <th scope="col">For example</th>
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.what}>
              <td>{p.what}</td>
              <td style={{ textAlign: 'right' }}>{p.count}</td>
              <td>{p.examples.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Counts = ({ counts }: { counts: Record<string, number> }) =>
  Object.keys(counts).length ? (
    <p className="ep-field__help">
      {Object.entries(counts)
        .map(([k, v]) => `${String(v)} ${k}`)
        .join(' · ')}
    </p>
  ) : null;

/**
 * Moving from the earlier leave module (docs/design/85, phase E): the months (the parallel month, the
 * freeze), reading the old database (the workers, read only), the preview, the three steps, the comparison
 * of the parallel month and the switch.
 */
export default async function CutoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  let d: CutoverOverview;
  try {
    d = await apiFetch<CutoverOverview>('/staff-cutover');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const manage = me.permissions.includes('leave.setup.manage');
  const preview = sp.preview
    ? await apiFetch<CutoverPreview>('/staff-cutover/preview').catch(() => null)
    : null;
  const done = d.status === 'switched';
  const next = (() => {
    const t = new Date(`${d.today}T00:00:00Z`);
    t.setUTCMonth(t.getUTCMonth() + 1);
    return t.toISOString().slice(0, 7);
  })();
  const readTotal = Object.values(d.read.counts).reduce((a, b) => a + Math.max(0, b), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Leave & attendance set-up', href: '/leave/setup' },
          { label: 'Moving from the old module' },
        ]}
      />
      <PageHeader
        kicker="Leave & attendance"
        title="Moving from the old module"
        description="Bring the old leave module’s set-up, balances and this year’s history, run both for a parallel month and compare them, then switch on the freeze date. Nothing in the old database is changed: it is read only."
        actions={
          d.status !== 'setup' ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/setup/cutover/compare">
              Compare the parallel month
            </a>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis ep-dash-kpis--4">
        <KpiTile label="Status" value={STATUS[d.status].label} />
        <KpiTile label="Parallel month" value={d.parallelWords ?? 'Not set'} />
        <KpiTile label="Freeze date" value={d.freezeOn ? dmy(d.freezeOn) : 'Not set'} />
        <KpiTile
          label="Last read of the old database"
          value={d.read.at ? when(d.read.at) : 'Never'}
        />
      </div>
      {done ? (
        <p className="ep-alert ep-alert--success" role="status">
          Switched on {when(d.switchedAt)}: EduPro is the record for leave and attendance. The old
          module is not read any more.
        </p>
      ) : null}

      <section className="ep-card" aria-labelledby="cu-1">
        <h2 id="cu-1" className="ep-card__title">
          1. The months
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The parallel month: both systems run, the old one still the record (this month or the
          next). The freeze date: approvals stop in the old module; the switch comes on or after it.
        </p>
        {manage && !done ? (
          <form
            action={saveCutoverSettings}
            className="ep-grid__toolbar"
            style={{ flexWrap: 'wrap' }}
          >
            <label className="ep-field" htmlFor="cu-month">
              <span className="ep-field__label">Parallel month</span>
              <input
                id="cu-month"
                name="parallelMonth"
                type="month"
                className="ep-input"
                required
                min={d.today.slice(0, 7)}
                max={next}
                defaultValue={d.parallelMonth ?? d.today.slice(0, 7)}
              />
            </label>
            <label className="ep-field" htmlFor="cu-freeze">
              <span className="ep-field__label">Freeze date</span>
              <input
                id="cu-freeze"
                name="freezeOn"
                type="date"
                className="ep-input"
                defaultValue={d.freezeOn ?? ''}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Save
            </button>
          </form>
        ) : null}
      </section>

      <section className="ep-card" aria-labelledby="cu-2" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="cu-2" className="ep-card__title">
          2. Read the old database
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          The workers read the old module’s tables (read only, through the connection IT set on the
          server) — every night too during the parallel month.
        </p>
        {d.read.error ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            The last read did not work: {d.read.error}
          </p>
        ) : null}
        {d.read.waiting ? (
          <p className="ep-alert ep-alert--info" role="status">
            Asked on {when(d.read.requestedAt)}: waiting for the workers (they read in a minute or
            two when running).
          </p>
        ) : null}
        {d.read.at ? (
          <p className="ep-field__help">
            Read on {when(d.read.at)}: {readTotal.toLocaleString('en-IN')} rows —{' '}
            {Object.entries(d.read.counts)
              .map(
                ([k, v]) =>
                  `${k.replace(/^al_|^tbl_/, '').replaceAll('_', ' ')} ${v < 0 ? 'not in the old database' : String(v)}`,
              )
              .join(' · ')}
          </p>
        ) : null}
        {manage && !done ? (
          <form action={requestCutoverRead}>
            <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
              Read the old database now
            </button>
          </form>
        ) : null}
      </section>

      <section className="ep-card" aria-labelledby="cu-3" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="cu-3" className="ep-card__title">
          3. Preview
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Every step run and undone: what would come and what could not (an employee code not found
          here, a scope this module does not have, a credit that changes).
        </p>
        {preview ? (
          preview.steps.map((s) => (
            <div key={s.step} style={{ marginBottom: 'var(--sp-3)' }}>
              <h3 className="ep-field__label">
                {STEP[s.step]?.title} {s.ready ? null : <Badge tone="neutral">{s.why}</Badge>}
              </h3>
              <Counts counts={s.counts} />
              {s.ready ? <Problems id={`pv-${s.step}`} list={s.problems} /> : null}
            </div>
          ))
        ) : d.read.at && !done ? (
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/leave/setup/cutover?preview=1#cu-3"
          >
            Preview
          </a>
        ) : (
          <p className="ep-field__help">Read the old database first.</p>
        )}
      </section>

      {(['setup', 'balances', 'history'] as const).map((step, i) => {
        const last = d.steps[step];
        const ready =
          !done &&
          !!d.read.at &&
          (step === 'setup' || (d.started && (step === 'balances' || !!d.steps.balances)));
        return (
          <FoldCard
            key={step}
            id={`cu-step-${step}`}
            title={`${String(i + 4)}. ${STEP[step]!.title}`}
            hint={
              last ? `Brought on ${when(last.at)}${last.by ? ` by ${last.by}` : ''}` : 'Not yet'
            }
            open={!last || !!last.problems?.length}
          >
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {STEP[step]!.text}
            </p>
            {last ? (
              <>
                <Counts counts={last.counts} />
                <Problems id={`lr-${step}`} list={last.problems ?? []} />
              </>
            ) : null}
            {manage ? (
              ready ? (
                <form action={runCutoverStep.bind(null, step)} style={{ marginTop: 'var(--sp-2)' }}>
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    {last ? 'Bring again' : STEP[step]!.title}
                  </button>
                </form>
              ) : (
                <p className="ep-field__help">
                  {done
                    ? 'The switch is done.'
                    : !d.read.at
                      ? 'Read the old database first.'
                      : !d.started
                        ? 'Comes in once the parallel month has begun.'
                        : 'Bring the balances first.'}
                </p>
              )
            ) : null}
          </FoldCard>
        );
      })}

      <section className="ep-card" aria-labelledby="cu-7" style={{ marginTop: 'var(--sp-4)' }}>
        <h2 id="cu-7" className="ep-card__title">
          7. Compare and switch
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          During the parallel month, compare the days and balances of both systems and look into
          each difference. After the freeze date (and a read of the old database after it), switch:
          the last leave and corrections come in, what still waits starts at the first level of Who
          approves here, and the old module is no longer read.
        </p>
        {d.status !== 'setup' ? (
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/leave/setup/cutover/compare">
            Compare the parallel month
          </a>
        ) : null}{' '}
        {manage && !done ? (
          <ConfirmAction
            action={switchCutover}
            fields={{ step: 'switch' }}
            label="Switch to EduPro"
            title="Switch to EduPro?"
            confirmLabel="Switch"
            confirmVariant="danger"
            variant="primary"
            blocked={
              d.canSwitch
                ? undefined
                : d.status !== 'parallel'
                  ? 'Bring the balances first: the parallel month has not started.'
                  : !d.freezeOn || d.today < d.freezeOn
                    ? `The switch comes on or after the freeze date${d.freezeOn ? ` (${dmy(d.freezeOn)})` : ''}.`
                    : 'Read the old database again after the freeze date, then switch.'
            }
          >
            The last leave and corrections come from the old module; those still waiting start at
            the first level of Who approves here. From now on staff apply in EduPro only, and the
            old module is not read again. This cannot be undone.
          </ConfirmAction>
        ) : null}
      </section>
    </>
  );
}
