import type { ReactNode } from 'react';
import { Badge, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import {
  CHANNEL_LABEL,
  reportXlsxHref,
  type Channel,
  type CountBucket,
  type Dashboard,
} from '@/lib/comms';

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shift = (m: string, by: number) => {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mm - 1 + by, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const shortMonth = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
const CHANNELS: Channel[] = ['sms', 'whatsapp', 'email'];
const BUCKET_LABEL: Record<CountBucket, string> = {
  all: 'all messages',
  delivered: 'delivered',
  failed: 'failed',
  pending: 'pending',
  read: 'read',
};

/** A count that downloads the Excel delivery report (student, class, admission no.) behind it. */
function Count({
  n,
  month,
  channel,
  bucket,
  children,
}: {
  n: number;
  month: string;
  channel?: Channel;
  bucket: CountBucket;
  children?: ReactNode;
}) {
  const text = children ?? n.toLocaleString('en-IN');
  if (!n) return <>{text}</>;
  const what = `${channel ? CHANNEL_LABEL[channel] : 'All channels'} · ${monthLabel(month)} · ${BUCKET_LABEL[bucket]}`;
  return (
    <a
      className="ep-cdash__num"
      href={reportXlsxHref('comms_delivery_log', { month, channel, bucket })}
      download
      title={`Download Excel: ${what}`}
      aria-label={`${String(text)}, download Excel of ${what}`}
    >
      {text}
    </a>
  );
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  sent: 'success',
  pending_approval: 'warning',
  approved: 'info',
  sending: 'info',
  rejected: 'danger',
  cancelled: 'neutral',
};

/**
 * Communication dashboard (v2): this month per channel against last month, the daily trend, credit
 * balances and providers, recent requests, the busiest senders and why messages failed.
 */
export default async function CommsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const [me, d] = await Promise.all([
    getMe(),
    apiFetch<Dashboard>(
      `/comms/dashboard${sp.month ? `?month=${encodeURIComponent(sp.month)}` : ''}`,
    ),
  ]);
  const can = (p: string) => me.permissions.includes(p);
  const total = d.channels.reduce((n, c) => n + c.messages, 0);
  const cost = d.channels.reduce((n, c) => n + c.cost, 0);
  const prevTotal = d.previous.reduce((n, c) => n + c.messages, 0);
  const days = [...new Set(d.daily.map((x) => x.day))];
  const maxDay = Math.max(
    1,
    ...days.map((day) => d.daily.filter((x) => x.day === day).reduce((n, x) => n + x.messages, 0)),
  );
  const months = [...new Set(d.trend.map((x) => x.month))];
  const monthTotal = (m: string) =>
    d.trend.filter((x) => x.month === m).reduce((n, x) => n + x.messages, 0);
  const maxMonth = Math.max(1, ...months.map(monthTotal));
  const sixTotal = d.trend.reduce((n, x) => n + x.messages, 0);
  const sixCost = d.trend.reduce((n, x) => n + x.cost, 0);
  const notSetUp = (['sms', 'whatsapp', 'email'] as Channel[]).filter(
    (c) => !d.providers.some((p) => p.channel === c && p.active && p.provider !== 'console'),
  );
  return (
    <>
      <PageHeader
        kicker="Communication"
        title="Communication dashboard"
        description={`${monthLabel(d.month)} · ${total.toLocaleString('en-IN')} messages (${prevTotal.toLocaleString('en-IN')} in ${monthLabel(d.previousMonth)}) · ${money(cost)}`}
        actions={
          <span className="ep-wdset__actions" style={{ margin: 0 }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/comms?month=${shift(d.month, -1)}`}
            >
              ← {monthLabel(shift(d.month, -1))}
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/comms?month=${shift(d.month, 1)}`}
            >
              {monthLabel(shift(d.month, 1))} →
            </a>
            {can('comms.request.create') ? (
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/comms/compose">
                Compose
              </a>
            ) : null}
          </span>
        }
      />
      {notSetUp.length && can('comms.settings.manage') ? (
        <p className="ep-alert ep-alert--warning">
          {notSetUp.map((c) => CHANNEL_LABEL[c]).join(', ')} {notSetUp.length === 1 ? 'is' : 'are'}{' '}
          not connected to a provider yet: messages are only logged.{' '}
          <a href="/comms/settings">Set up providers</a>
        </p>
      ) : null}
      <Card
        title={`Last 6 months · ${months.length ? `${shortMonth(months[0]!)} – ${shortMonth(months[months.length - 1]!)}` : ''}`}
      >
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {sixTotal.toLocaleString('en-IN')} messages · {money(sixCost)}. Click any number to
          download its Excel delivery report (student, class, admission no., message).
        </p>
        <div className="ep-cdash__six">
          <div
            className="ep-cdash__chart ep-cdash__chart--months"
            role="img"
            aria-label={`Messages per month: ${months.map((m) => `${shortMonth(m)} ${String(monthTotal(m))}`).join(', ')}`}
          >
            {months.map((m) => {
              const sum = monthTotal(m);
              const cost = d.trend.filter((x) => x.month === m).reduce((n, x) => n + x.cost, 0);
              return (
                <div
                  key={m}
                  className="ep-cdash__day"
                  title={`${monthLabel(m)}: ${String(sum)} · ${money(cost)}`}
                >
                  <span className="ep-cdash__mval">{sum.toLocaleString('en-IN')}</span>
                  <div
                    className="ep-cdash__stack"
                    style={{ height: `${String(Math.max(3, (100 * sum) / maxMonth))}%` }}
                  >
                    {CHANNELS.map((ch) => {
                      const n =
                        d.trend.find((x) => x.month === m && x.channel === ch)?.messages ?? 0;
                      return n ? <span key={ch} data-ch={ch} style={{ flexGrow: n }} /> : null;
                    })}
                  </div>
                  <span className="ep-cdash__dlabel">{shortMonth(m)}</span>
                  <span className="ep-cdash__dlabel">{money(cost)}</span>
                </div>
              );
            })}
          </div>
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Month-wise count and price"
          >
            <table className="ep-table ep-cdash__mtable">
              <caption className="ep-sr-only">Month-wise messages and cost per channel</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  {CHANNELS.map((ch) => (
                    <th key={ch} scope="col" className="ep-num">
                      <i data-ch={ch} aria-hidden="true" className="ep-cdash__dot" />{' '}
                      {CHANNEL_LABEL[ch]}
                    </th>
                  ))}
                  <th scope="col" className="ep-num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => {
                  const rows = d.trend.filter((x) => x.month === m);
                  const sum = rows.reduce((n, x) => n + x.messages, 0);
                  const cost = rows.reduce((n, x) => n + x.cost, 0);
                  return (
                    <tr key={m}>
                      <th scope="row">
                        <a href={`/comms?month=${m}`}>{monthLabel(m)}</a>
                      </th>
                      {CHANNELS.map((ch) => {
                        const k = rows.find((x) => x.channel === ch);
                        return (
                          <td key={ch} className="ep-num">
                            <Count n={k?.messages ?? 0} month={m} channel={ch} bucket="all" />
                            <div className="ep-field__help">
                              {money(k?.cost ?? 0)}
                              {k?.failed ? (
                                <>
                                  {' · '}
                                  <Count n={k.failed} month={m} channel={ch} bucket="failed">
                                    {k.failed.toLocaleString('en-IN')} failed
                                  </Count>
                                </>
                              ) : null}
                            </div>
                          </td>
                        );
                      })}
                      <td className="ep-num">
                        <strong>
                          <Count n={sum} month={m} bucket="all" />
                        </strong>
                        <div className="ep-field__help">{money(cost)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">6 months</th>
                  {CHANNELS.map((ch) => {
                    const rows = d.trend.filter((x) => x.channel === ch);
                    return (
                      <td key={ch} className="ep-num">
                        <strong>
                          {rows.reduce((n, x) => n + x.messages, 0).toLocaleString('en-IN')}
                        </strong>
                        <div className="ep-field__help">
                          {money(rows.reduce((n, x) => n + x.cost, 0))}
                        </div>
                      </td>
                    );
                  })}
                  <td className="ep-num">
                    <strong>{sixTotal.toLocaleString('en-IN')}</strong>
                    <div className="ep-field__help">{money(sixCost)}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <div className="ep-cdash__legend">
          {CHANNELS.map((ch) => (
            <span key={ch}>
              <i data-ch={ch} aria-hidden="true" /> {CHANNEL_LABEL[ch]}
            </span>
          ))}
        </div>
      </Card>
      <h2 className="ep-cdash__h3">{monthLabel(d.month)}</h2>
      <div className="ep-cdash__kpis">
        {d.channels.map((c) => {
          const prev = d.previous.find((p) => p.channel === c.channel);
          const bal = d.balances.find((b) => b.channel === c.channel);
          return (
            <Card key={c.channel} title={CHANNEL_LABEL[c.channel]}>
              <div className="ep-cdash__big">
                <Count n={c.messages} month={d.month} channel={c.channel} bucket="all" />
              </div>
              <div className="ep-field__help">
                messages{prev ? ` · ${prev.messages.toLocaleString('en-IN')} last month` : ''}
              </div>
              <dl className="ep-cdash__facts">
                <div>
                  <dt>Delivered</dt>
                  <dd>
                    <Count n={c.delivered} month={d.month} channel={c.channel} bucket="delivered">
                      {pct(c.delivered, c.messages)}
                    </Count>
                  </dd>
                </div>
                {c.channel === 'whatsapp' ? (
                  <div>
                    <dt>Read</dt>
                    <dd>
                      <Count n={c.read} month={d.month} channel={c.channel} bucket="read">
                        {pct(c.read, c.messages)}
                      </Count>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>Failed</dt>
                  <dd>
                    <Count n={c.failed} month={d.month} channel={c.channel} bucket="failed" />
                  </dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>
                    <Count n={c.pending} month={d.month} channel={c.channel} bucket="pending" />
                  </dd>
                </div>
                {c.channel === 'sms' ? (
                  <div>
                    <dt>SMS parts</dt>
                    <dd>{c.units.toLocaleString('en-IN')}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Cost</dt>
                  <dd>{money(c.cost)}</dd>
                </div>
                {bal?.tracked ? (
                  <div>
                    <dt>Credits left</dt>
                    <dd>
                      {bal.balance.toLocaleString('en-IN')}{' '}
                      {bal.low ? <Badge tone="danger">low</Badge> : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Card>
          );
        })}
      </div>
      <Card title="Messages per day" style={{ marginTop: 'var(--sp-4)' }}>
        {days.length ? (
          <>
            <div
              className="ep-cdash__chart"
              role="img"
              aria-label={`Messages per day in ${monthLabel(d.month)}`}
            >
              {days.map((day) => {
                const parts = (['sms', 'whatsapp', 'email'] as Channel[]).map((ch) => ({
                  ch,
                  n: d.daily.find((x) => x.day === day && x.channel === ch)?.messages ?? 0,
                }));
                const sum = parts.reduce((n, p) => n + p.n, 0);
                return (
                  <div key={day} className="ep-cdash__day" title={`${day}: ${String(sum)}`}>
                    <div
                      className="ep-cdash__stack"
                      style={{ height: `${String(Math.max(4, (100 * sum) / maxDay))}%` }}
                    >
                      {parts.map((p) =>
                        p.n ? <span key={p.ch} data-ch={p.ch} style={{ flexGrow: p.n }} /> : null,
                      )}
                    </div>
                    <span className="ep-cdash__dlabel">{day.slice(8)}</span>
                  </div>
                );
              })}
            </div>
            <div className="ep-cdash__legend">
              {(['sms', 'whatsapp', 'email'] as Channel[]).map((ch) => (
                <span key={ch}>
                  <i data-ch={ch} aria-hidden="true" /> {CHANNEL_LABEL[ch]}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p className="ep-field__help">Nothing sent this month.</p>
        )}
      </Card>
      <div className="ep-cdash__two">
        <Card title="Recent requests">
          {d.requests.length ? (
            <ul className="ep-cdash__list">
              {d.requests.map((r) => (
                <li key={r.id}>
                  <a href={`/comms/requests/${r.id}`}>{r.title}</a>{' '}
                  <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                    {r.status.replace('_', ' ')}
                  </Badge>
                  <div className="ep-field__help">
                    {r.channels.map((c) => CHANNEL_LABEL[c as Channel] ?? c).join(' + ')} ·{' '}
                    {r.recipients} recipients · {r.delivered} delivered
                    {r.failed ? ` · ${String(r.failed)} failed` : ''} · {r.by ?? ''} ·{' '}
                    {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No requests yet.</p>
          )}
        </Card>
        <Card title="Who sent the most">
          {d.senders.length ? (
            <ul className="ep-cdash__list">
              {d.senders.map((s) => (
                <li key={s.name}>
                  {s.name}{' '}
                  <span className="ep-field__help">
                    · {s.messages.toLocaleString('en-IN')} messages · {money(s.cost)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">—</p>
          )}
          <h3 className="ep-cdash__h3">Why messages failed</h3>
          {d.failures.length ? (
            <ul className="ep-cdash__list">
              {d.failures.map((f) => (
                <li key={`${f.channel}-${f.reason}`}>
                  {CHANNEL_LABEL[f.channel as Channel] ?? f.channel}: {f.reason}{' '}
                  <span className="ep-field__help">· {f.messages}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No failures this month.</p>
          )}
          {can('comms.report.view') ? (
            <p>
              <a href="/comms/reports">Monthly statement and delivery reports →</a>
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}
