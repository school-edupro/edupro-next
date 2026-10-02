import { Badge, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import { CHANNEL_LABEL, type Channel, type Dashboard } from '@/lib/comms';

const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shift = (m: string, by: number) => {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mm - 1 + by, 1));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
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
      <div className="ep-cdash__kpis">
        {d.channels.map((c) => {
          const prev = d.previous.find((p) => p.channel === c.channel);
          const bal = d.balances.find((b) => b.channel === c.channel);
          return (
            <Card key={c.channel} title={CHANNEL_LABEL[c.channel]}>
              <div className="ep-cdash__big">{c.messages.toLocaleString('en-IN')}</div>
              <div className="ep-field__help">
                messages{prev ? ` · ${prev.messages.toLocaleString('en-IN')} last month` : ''}
              </div>
              <dl className="ep-cdash__facts">
                <div>
                  <dt>Delivered</dt>
                  <dd>{pct(c.delivered, c.messages)}</dd>
                </div>
                {c.channel === 'whatsapp' ? (
                  <div>
                    <dt>Read</dt>
                    <dd>{pct(c.read, c.messages)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Failed</dt>
                  <dd>{c.failed.toLocaleString('en-IN')}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>{c.pending.toLocaleString('en-IN')}</dd>
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
