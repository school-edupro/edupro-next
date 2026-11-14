import { Badge, Breadcrumbs, KpiTile, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { FoldCard } from '@/components/FoldCard';
import { Notice } from '@/components/Notice';
import { DialogButton } from '@/components/leave/DialogButton';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  countersign,
  goLiveStep,
  replay,
  rollback,
  setParallel,
  switchOver,
} from '@/lib/payroll-golive-actions';

interface Problem {
  what: string;
  count: number;
  examples: string[];
}
interface Overview {
  cutover: {
    status: 'SETUP' | 'BROUGHT' | 'PARALLEL' | 'SIGNED' | 'SWITCHED';
    history_from: string;
    parallel: string[];
    switch_month: string | null;
    read_requested_at: string | null;
    read_at: string | null;
    read_counts: Record<string, number> | null;
    read_error: string | null;
    prepared: { counts: Record<string, number>; problems: Problem[]; until: string | null } | null;
    prepared_at: string | null;
    committed_at: string | null;
    first_live_lock_at: string | null;
  } | null;
  staged: Array<{ tbl: string; n: number }>;
  batches: Array<{
    id: string;
    kind: string;
    months: string[];
    open: number;
    created_at: string;
    by: string | null;
  }>;
  signoff: {
    id: string;
    batch_id: string;
    checksum: string;
    signed_by: string;
    signed_at: string;
    countersigned_by: string | null;
    countersigned_at: string | null;
    mine?: boolean;
  } | null;
  can: { admin: boolean; check: boolean; countersign: boolean; commit: boolean };
}
const STEPS = ['SETUP', 'BROUGHT', 'PARALLEL', 'SIGNED', 'SWITCHED'] as const;
const STATUS: Record<string, string> = {
  SETUP: 'Started',
  BROUGHT: 'Brought across',
  PARALLEL: 'Parallel months',
  SIGNED: 'Signed',
  SWITCHED: 'Switched',
};
const when = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
const words = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const COUNT_WORDS: Record<string, string> = {
  profiles: 'payroll profiles',
  structures: 'structure rows',
  loans: 'loans',
  nominees: 'nominees',
  payees: 'payees',
  recurring: 'recurring deductions',
  esiCoverage: 'ESI coverage periods',
  earlierEmployers: 'earlier employers',
  declarations: 'declarations',
  challans: 'TDS challans',
  runs: 'runs (history)',
  records: 'pay records (history)',
  attendance: 'attendance months',
};

function Problems({ problems }: { problems: Problem[] }) {
  return problems.length ? (
    <ul className="ep-list">
      {problems.map((p) => (
        <li key={p.what}>
          <strong>{p.count}</strong> · {p.what}
          {p.examples.length ? <div className="ep-field__help">{p.examples.join(', ')}</div> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="ep-field__help">Nothing stands in the way.</p>
  );
}
function Counts({ counts }: { counts: Record<string, number> }) {
  return (
    <ul className="ep-list">
      {Object.entries(counts).map(([k, n]) => (
        <li key={k}>
          {n} {COUNT_WORDS[k] ?? k}
        </li>
      ))}
    </ul>
  );
}

/**
 * Moving from the old payroll (docs/design/86, phase G): read the old payroll, bring its people and history (prepared by
 * the payroll admin, committed by a second person), prove EduPro pays the same (the replay, every difference explained),
 * run two months side by side, sign, countersign, switch — and switch back until EduPro locks its first live month.
 */
export default async function GoLivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.run.view')) notFound();
  let d: Overview;
  try {
    d = await apiFetch<Overview>('/payroll/golive');
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    throw e;
  }
  const c = d.cutover;
  let preview: {
    counts: Record<string, number>;
    problems: Problem[];
    until: string | null;
  } | null = null;
  if (c?.read_at && sp.preview === '1')
    try {
      preview = await apiFetch('/payroll/golive/preview');
    } catch {
      preview = null;
    }
  const at = c ? STEPS.indexOf(c.status) : -1;
  const staged = d.staged.reduce((t, x) => t + x.n, 0);
  const lastOpen = d.batches[0]?.open ?? null;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Payroll' },
          { label: 'Payroll set-up', href: '/payroll/setup' },
          { label: 'Moving from the old payroll' },
        ]}
      />
      <PageHeader
        kicker="Payroll set-up"
        title="Moving from the old payroll"
        description="Read the old payroll, bring its people and history, prove EduPro pays the same, run two months side by side, sign, then switch."
      />
      <Notice params={sp} />
      <div className="ep-dash-kpis">
        <KpiTile label="Stage" value={c ? STATUS[c.status]! : 'Not started'} />
        <KpiTile
          label="Rows read"
          value={String(staged)}
          hint={c?.read_at ? `on ${when(c.read_at)}` : undefined}
        />
        <KpiTile
          label="Brought"
          value={c?.committed_at ? 'Yes' : 'Not yet'}
          hint={c?.committed_at ? when(c.committed_at) : undefined}
        />
        <KpiTile
          label="Open differences"
          value={lastOpen === null ? '—' : String(lastOpen)}
          hint="In the latest comparison"
        />
        <KpiTile
          label="Parallel months"
          value={c?.parallel.length ? c.parallel.map((m) => words(m).slice(0, 3)).join(' + ') : '—'}
        />
        <KpiTile label="EduPro pays from" value={c?.switch_month ? words(c.switch_month) : '—'} />
      </div>
      <ol
        className="ep-grid__toolbar"
        aria-label="The steps"
        style={{ listStyle: 'none', padding: 0 }}
      >
        {['Start and read', 'Bring across', 'Parallel months', 'Signed', 'Switched'].map((x, i) => (
          <li key={x} aria-current={i === at ? 'step' : undefined}>
            <Badge tone={i < at ? 'success' : i === at ? 'info' : 'neutral'}>{x}</Badge>
          </li>
        ))}
      </ol>
      {!c ? (
        <section className="ep-card" aria-labelledby="gl-start">
          <h2 id="gl-start" className="ep-card__title">
            Start
          </h2>
          <p>
            EduPro reads the old payroll’s database through a connection IT sets on the server
            (never typed here; read only; the encrypted PAN and bank copies are never read — PAN and
            bank come from the employee record). The current and last financial year come across as
            history; older years as an archive file.
          </p>
          {d.can.admin ? (
            <form action={goLiveStep.bind(null, 'start')}>
              <button type="submit" className="ep-btn ep-btn--primary">
                Start
              </button>
            </form>
          ) : (
            <p className="ep-field__help">The payroll admin starts it.</p>
          )}
        </section>
      ) : (
        <>
          <section className="ep-card" aria-labelledby="gl-read">
            <h2 id="gl-read" className="ep-card__title">
              1. The old payroll
            </h2>
            {c.read_error ? (
              <p className="ep-alert ep-alert--danger" role="alert">
                {c.read_error}
              </p>
            ) : null}
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              History from {words(c.history_from.slice(0, 7))}. Last read: {when(c.read_at)}
              {c.read_requested_at && (!c.read_at || c.read_requested_at > c.read_at)
                ? ' · a read is waiting'
                : ''}
              .
            </p>
            <div className="ep-grid__toolbar">
              {d.can.admin && !c.first_live_lock_at ? (
                <form action={goLiveStep.bind(null, 'read')}>
                  <button type="submit" className="ep-btn ep-btn--secondary">
                    Read the old payroll {c.read_at ? 'again' : ''}
                  </button>
                </form>
              ) : null}
              {c.read_at ? (
                <>
                  <span className="ep-field__help">Older years (archive)</span>
                  <FileLinks
                    href="/api/payroll/pay-file?kind=golivearchive"
                    label="the old payroll's older years"
                  />
                </>
              ) : null}
            </div>
            {d.staged.length ? (
              <FoldCard
                id="gl-staged"
                title={`Rows read (${String(staged)})`}
                hint="Each table of the old payroll"
              >
                <ul className="ep-list">
                  {d.staged.map((x) => (
                    <li key={x.tbl}>
                      {x.tbl.replace(/^payroll_/, '').replace(/_/g, ' ')}: {x.n}
                    </li>
                  ))}
                </ul>
              </FoldCard>
            ) : null}
          </section>
          <section className="ep-card" aria-labelledby="gl-bring">
            <h2 id="gl-bring" className="ep-card__title">
              2. Bring it across
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              See what would come (nothing is kept), then the payroll admin prepares it and a second
              person commits it. Brought again later, each row updates what it became; history
              already brought never changes.
            </p>
            <div className="ep-grid__toolbar">
              {c.read_at ? (
                <a className="ep-btn ep-btn--secondary" href="/payroll/setup/golive?preview=1">
                  See what would come
                </a>
              ) : null}
              {d.can.admin && c.read_at ? (
                <form action={goLiveStep.bind(null, 'prepare')}>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Prepare
                  </button>
                </form>
              ) : null}
              {d.can.commit ? (
                <form action={goLiveStep.bind(null, 'commit')}>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Commit what was prepared
                  </button>
                </form>
              ) : null}
            </div>
            {preview ? (
              <div className="ep-chart__grid2">
                <div>
                  <h3 className="ep-field__label">Would come</h3>
                  <Counts counts={preview.counts} />
                </div>
                <div>
                  <h3 className="ep-field__label">Cannot come</h3>
                  <Problems problems={preview.problems} />
                </div>
              </div>
            ) : null}
            {c.prepared ? (
              <FoldCard
                id="gl-prepared"
                title={`Prepared ${when(c.prepared_at)}`}
                hint="Waiting for a second person to commit"
                open
              >
                <div className="ep-chart__grid2">
                  <Counts counts={c.prepared.counts} />
                  <Problems problems={c.prepared.problems} />
                </div>
              </FoldCard>
            ) : null}
          </section>
          <section className="ep-card" aria-labelledby="gl-parity">
            <h2 id="gl-parity" className="ep-card__title">
              3. Parity
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              The old payroll’s locked months worked out again here, each employee, head and month
              to the paisa. A difference stays open until someone explains it; an explanation stays
              while the difference is the same.
            </p>
            {d.can.check && c.status !== 'SETUP' ? (
              <form action={replay} className="ep-grid__toolbar">
                <label className="ep-field" htmlFor="gl-from">
                  <span className="ep-field__label">From</span>
                  <input
                    id="gl-from"
                    name="from"
                    type="month"
                    className="ep-input"
                    required
                    defaultValue={c.history_from.slice(0, 7)}
                  />
                </label>
                <label className="ep-field" htmlFor="gl-to">
                  <span className="ep-field__label">To</span>
                  <input id="gl-to" name="to" type="month" className="ep-input" required />
                </label>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Replay
                </button>
              </form>
            ) : null}
            {d.batches.length ? (
              <ul className="ep-list">
                {d.batches.map((b) => (
                  <li key={b.id}>
                    <a href={`/payroll/setup/golive/parity/${b.id}`}>
                      {b.kind === 'REPLAY' ? 'Replay' : 'Parallel months'} ·{' '}
                      {b.months.map(words).join(', ')}
                    </a>{' '}
                    <Badge tone={b.open ? 'warning' : 'success'}>
                      {b.open ? `${String(b.open)} open` : 'Nothing open'}
                    </Badge>{' '}
                    <span className="ep-field__help">
                      {when(b.created_at)}
                      {b.by ? ` · ${b.by}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section className="ep-card" aria-labelledby="gl-parallel">
            <h2 id="gl-parallel" className="ep-card__title">
              4. Two months side by side
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              The old payroll locks and pays them; EduPro runs them to Approved only (never locks
              them, makes no bank file). Then compare every employee: the registers, the bank total,
              PF, ESI, PT and TDS. Ideally across a quarter’s end.
            </p>
            {c.parallel.length ? <p>{c.parallel.map(words).join(' and ')}</p> : null}
            <div className="ep-grid__toolbar">
              {d.can.admin && ['BROUGHT', 'PARALLEL'].includes(c.status) ? (
                <form action={setParallel} className="ep-grid__toolbar">
                  <label className="ep-field" htmlFor="gl-p1">
                    <span className="ep-field__label">First of the two months</span>
                    <input
                      id="gl-p1"
                      name="first"
                      type="month"
                      className="ep-input"
                      required
                      defaultValue={c.parallel[0] ?? ''}
                    />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--secondary">
                    Set
                  </button>
                </form>
              ) : null}
              {d.can.check && c.parallel.length ? (
                <form action={goLiveStep.bind(null, 'parallel-compare')}>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Compare the two months
                  </button>
                </form>
              ) : null}
            </div>
          </section>
          <section className="ep-card" aria-labelledby="gl-sign">
            <h2 id="gl-sign" className="ep-card__title">
              5. Sign-off
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              A payroll checker signs the comparison once the second month has nothing open (from
              its page); the principal countersigns. EduPro locks no month and makes no bank file
              before that.
            </p>
            {d.signoff ? (
              <ul className="ep-list">
                <li>
                  Signed by {d.signoff.signed_by} on {when(d.signoff.signed_at)}{' '}
                  <span className="ep-field__help">
                    checksum {d.signoff.checksum.slice(0, 16)}…
                  </span>
                </li>
                <li>
                  {d.signoff.countersigned_by
                    ? `Countersigned by ${d.signoff.countersigned_by} on ${when(d.signoff.countersigned_at)}`
                    : 'Waiting for the countersignature'}
                </li>
              </ul>
            ) : (
              <p>Not signed yet.</p>
            )}
            {d.signoff && !d.signoff.countersigned_by && d.can.countersign && !d.signoff.mine ? (
              <form action={countersign.bind(null, d.signoff.id)}>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Countersign
                </button>
              </form>
            ) : null}
          </section>
          <section className="ep-card" aria-labelledby="gl-switch">
            <h2 id="gl-switch" className="ep-card__title">
              6. The switch
            </h2>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              From the switch month EduPro pays and the old payroll is read-only (set it so there);
              EduPro refuses the old months and removes its parallel runs. Then bring the old
              payroll’s months up to it as history (read again, prepare, commit). Until EduPro locks
              its first live month, the payroll admin may switch back.
            </p>
            <div className="ep-grid__toolbar">
              {d.can.admin && c.status === 'SIGNED' ? (
                <form action={switchOver} className="ep-grid__toolbar">
                  <label className="ep-field" htmlFor="gl-sw">
                    <span className="ep-field__label">EduPro pays from</span>
                    <input id="gl-sw" name="month" type="month" className="ep-input" required />
                  </label>
                  <button type="submit" className="ep-btn ep-btn--primary">
                    Switch
                  </button>
                </form>
              ) : null}
              {d.can.admin && c.status === 'SWITCHED' && !c.first_live_lock_at ? (
                <DialogButton
                  id="gl-back"
                  label="Switch back"
                  title="Switch back to the old payroll"
                  className="ep-btn ep-btn--ghost"
                >
                  <form action={rollback} className="ep-form-section__body">
                    <label className="ep-field" htmlFor="gl-why">
                      <span className="ep-field__label">Why</span>
                      <textarea
                        id="gl-why"
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
                        Switch back
                      </button>
                    </div>
                  </form>
                </DialogButton>
              ) : null}
            </div>
            {c.first_live_lock_at ? (
              <p>
                EduPro locked its first live month on {when(c.first_live_lock_at)}: the switch
                stays.
              </p>
            ) : null}
          </section>
        </>
      )}
    </>
  );
}
