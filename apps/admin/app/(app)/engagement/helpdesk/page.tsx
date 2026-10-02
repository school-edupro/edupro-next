import { Badge, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import {
  DESKS,
  DESK_LABEL,
  dueText,
  when,
  type Desk,
  type HelpdeskDashboard,
} from '@/lib/helpdesk';

const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
type Bucket = 'raised' | 'resolved' | 'escalated' | 'breached' | 'open';
const BUCKET: Record<Bucket, string> = {
  raised: 'raised',
  resolved: 'resolved',
  escalated: 'escalated',
  breached: 'SLA missed',
  open: 'still open',
};

/** A count that downloads the tickets behind it as Excel. */
function Count({
  n,
  month,
  desk,
  bucket,
}: {
  n: number;
  month: string;
  desk?: Desk;
  bucket: Bucket;
}) {
  if (!n) return <>0</>;
  const what = `${desk ? DESK_LABEL[desk] : 'All desks'} · ${monthLabel(month)} · ${BUCKET[bucket]}`;
  const q = new URLSearchParams({ month, bucket, ...(desk ? { desk } : {}) });
  return (
    <a
      className="ep-cdash__num"
      href={`/api/helpdesk/report?${q.toString()}`}
      download
      title={`Download Excel: ${what}`}
      aria-label={`${String(n)}, download Excel of ${what}`}
    >
      {n.toLocaleString('en-IN')}
    </a>
  );
}

/**
 * Helpdesk dashboard: the last six months per desk (raised, resolved, escalated, SLA missed, time to
 * close, closed within SLA, rating), what is open now by escalation level, the busiest query types and
 * the tickets past due. Every count downloads its tickets.
 */
export default async function HelpdeskDashboardPage() {
  const [me, d] = await Promise.all([getMe(), apiFetch<HelpdeskDashboard>('/helpdesk/dashboard')]);
  const months = [...new Set(d.months.map((m) => m.month))];
  const thisMonth = months[months.length - 1]!;
  const sum = (desk: Desk, k: 'raised' | 'resolved' | 'escalated' | 'breached') =>
    d.months.filter((m) => m.desk === desk).reduce((n, m) => n + m[k], 0);
  const maxRaised = Math.max(
    1,
    ...months.map((m) => d.months.filter((x) => x.month === m).reduce((n, x) => n + x.raised, 0)),
  );
  return (
    <>
      <PageHeader
        kicker="Helpdesk"
        title="Helpdesk dashboard"
        description={`Last six months (${monthLabel(months[0]!)} – ${monthLabel(thisMonth)}). Click any number to download its tickets as Excel.`}
        actions={
          me.permissions.includes('helpdesk.settings.manage') ? (
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/engagement/helpdesk/setup">
              Set-up and escalation matrix
            </a>
          ) : null
        }
      />
      <div className="ep-cdash__kpis">
        {DESKS.map((desk) => {
          const open = d.openNow.filter((x) => x.desk === desk);
          const n = open.reduce((a, x) => a + x.open, 0);
          const late = open.reduce((a, x) => a + x.overdue, 0);
          const up = open.filter((x) => x.level > 1).reduce((a, x) => a + x.open, 0);
          return (
            <Card key={desk} title={DESK_LABEL[desk]}>
              <div className="ep-cdash__big">
                <a className="ep-cdash__num" href={`/engagement/helpdesk/${desk}`}>
                  {n.toLocaleString('en-IN')}
                </a>
              </div>
              <div className="ep-field__help">open now</div>
              <dl className="ep-cdash__facts">
                <div>
                  <dt>Past due</dt>
                  <dd>
                    {late ? (
                      <a
                        className="ep-cdash__num"
                        href={`/engagement/helpdesk/${desk}?status=overdue`}
                      >
                        {late}
                      </a>
                    ) : (
                      0
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Escalated (level 2+)</dt>
                  <dd>{up}</dd>
                </div>
                <div>
                  <dt>Raised in 6 months</dt>
                  <dd>{sum(desk, 'raised').toLocaleString('en-IN')}</dd>
                </div>
                <div>
                  <dt>SLA missed</dt>
                  <dd>{sum(desk, 'breached').toLocaleString('en-IN')}</dd>
                </div>
              </dl>
            </Card>
          );
        })}
      </div>
      <Card title="Raised per month" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="ep-cdash__six">
          <div
            className="ep-cdash__chart ep-cdash__chart--months"
            role="img"
            aria-label={`Tickets raised per month: ${months.map((m) => `${monthLabel(m)} ${String(d.months.filter((x) => x.month === m).reduce((n, x) => n + x.raised, 0))}`).join(', ')}`}
          >
            {months.map((m) => {
              const rows = d.months.filter((x) => x.month === m);
              const total = rows.reduce((n, x) => n + x.raised, 0);
              return (
                <div key={m} className="ep-cdash__day">
                  <span className="ep-cdash__mval">{total}</span>
                  <div
                    className="ep-cdash__stack"
                    style={{ height: `${String(Math.max(3, (100 * total) / maxRaised))}%` }}
                  >
                    {DESKS.map((desk) => {
                      const n = rows.find((x) => x.desk === desk)?.raised ?? 0;
                      return n ? (
                        <span key={desk} data-desk={desk} style={{ flexGrow: n }} />
                      ) : null;
                    })}
                  </div>
                  <span className="ep-cdash__dlabel">{monthLabel(m)}</span>
                </div>
              );
            })}
          </div>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Open now by escalation level"
          >
            <table className="ep-table">
              <caption className="ep-sr-only">Open now by escalation level</caption>
              <thead>
                <tr>
                  <th scope="col">Open now</th>
                  {[1, 2, 3, 4].map((l) => (
                    <th key={l} scope="col" className="ep-num">
                      Level {l}
                      {l === 4 ? '+' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DESKS.map((desk) => (
                  <tr key={desk}>
                    <th scope="row">{DESK_LABEL[desk]}</th>
                    {[1, 2, 3, 4].map((l) => {
                      const rows = d.openNow.filter(
                        (x) => x.desk === desk && (l === 4 ? x.level >= 4 : x.level === l),
                      );
                      const n = rows.reduce((a, x) => a + x.open, 0);
                      const late = rows.reduce((a, x) => a + x.overdue, 0);
                      return (
                        <td key={l} className="ep-num">
                          {n}
                          {late ? <div className="ep-field__help">{late} late</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="ep-cdash__legend">
          {DESKS.map((desk) => (
            <span key={desk}>
              <i data-desk={desk} aria-hidden="true" /> {DESK_LABEL[desk]}
            </span>
          ))}
        </div>
      </Card>
      <Card title="Month by month" style={{ marginTop: 'var(--sp-4)' }}>
        <div
          className="ep-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Helpdesk month by month"
        >
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Helpdesk tickets month by month per desk</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Desk</th>
                <th scope="col" className="ep-num">
                  Raised
                </th>
                <th scope="col" className="ep-num">
                  Resolved
                </th>
                <th scope="col" className="ep-num">
                  Escalated
                </th>
                <th scope="col" className="ep-num">
                  SLA missed
                </th>
                <th scope="col" className="ep-num">
                  Still open
                </th>
                <th scope="col" className="ep-num">
                  Avg hours to close
                </th>
                <th scope="col" className="ep-num">
                  Closed within SLA
                </th>
                <th scope="col" className="ep-num">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().flatMap((m) =>
                DESKS.map((desk, i) => {
                  const x = d.months.find((r) => r.month === m && r.desk === desk)!;
                  return (
                    <tr key={`${m}-${desk}`}>
                      {i === 0 ? (
                        <th scope="rowgroup" rowSpan={3}>
                          {monthLabel(m)}
                        </th>
                      ) : null}
                      <td>{DESK_LABEL[desk]}</td>
                      <td className="ep-num">
                        <Count n={x.raised} month={m} desk={desk} bucket="raised" />
                      </td>
                      <td className="ep-num">
                        <Count n={x.resolved} month={m} desk={desk} bucket="resolved" />
                      </td>
                      <td className="ep-num">
                        <Count n={x.escalated} month={m} desk={desk} bucket="escalated" />
                      </td>
                      <td className="ep-num">
                        <Count n={x.breached} month={m} desk={desk} bucket="breached" />
                      </td>
                      <td className="ep-num">
                        <Count n={x.open} month={m} desk={desk} bucket="open" />
                      </td>
                      <td className="ep-num">{x.avgHours ?? '—'}</td>
                      <td className="ep-num">
                        {x.withinSla === null ? '—' : `${String(x.withinSla)}%`}
                      </td>
                      <td className="ep-num">{x.rating ?? '—'}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="ep-cdash__two">
        <Card title="Busiest query types (6 months)">
          {d.heads.length ? (
            <ul className="ep-cdash__list">
              {d.heads.map((h) => (
                <li key={`${h.desk}-${h.head}`}>
                  {h.head}{' '}
                  <span className="ep-field__help">
                    · {DESK_LABEL[h.desk]} · {h.raised} raised · {h.open} open · {h.escalated}{' '}
                    escalated
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nothing raised yet.</p>
          )}
        </Card>
        <Card title="Past due now">
          {d.overdue.length ? (
            <ul className="ep-cdash__list">
              {d.overdue.map((t) => (
                <li key={t.id}>
                  <a href={`/engagement/helpdesk/${t.desk}/${t.id}`}>
                    {t.number} {t.subject}
                  </a>{' '}
                  <Badge tone="danger">{dueText(t)}</Badge>
                  <div className="ep-field__help">
                    {DESK_LABEL[t.desk]} · with {t.assignedTo ?? t.assignedRoleName ?? '—'}
                    {t.level > 1 ? ` · level ${String(t.level)}` : ''} · raised {when(t.openedAt)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">Nothing past due.</p>
          )}
        </Card>
      </div>
    </>
  );
}
