import { Badge, Card } from '@edupro/ui';

interface QueueReport {
  name: string;
  done?: number;
  failed?: number;
  lastDoneAt?: string | null;
  lastFailedAt?: string | null;
  lastError?: string | null;
  counts?: { waiting?: number; active?: number; delayed?: number; failed?: number } | null;
}
export interface WorkersState {
  redis: boolean;
  running: boolean;
  processes: Array<{
    id: string;
    host: string;
    pid: number;
    startedAt: string;
    at: string;
    alive: boolean;
    storage?: string;
    pdf?: string;
    queues: QueueReport[];
  }>;
  school: Record<string, string | null>;
}

const QUEUE: Record<string, string> = {
  notifications: 'Messages (SMS, WhatsApp, email, push)',
  exports: 'Excel, PDF and CSV files',
  maintenance: 'Scheduled housekeeping',
  reconciliation: 'Daily reconciliation',
  rfid: 'RFID device batches',
};
const when = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const ago = (v: string) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(v)) / 1000));
  return s < 90
    ? `${String(s)} s ago`
    : s < 5400
      ? `${String(Math.round(s / 60))} min ago`
      : when(v);
};
const num = (v: string | null | undefined) => Number(v ?? 0);

/**
 * Whether the background workers are running (each process reports itself every 20 seconds), what each
 * queue has done and has waiting, and this school's messages and files waiting for them.
 */
export function WorkersPanel({ state }: { state: WorkersState | null }) {
  const live = state?.processes.find((p) => p.alive) ?? null;
  const last = state?.processes[0] ?? null;
  const s = state?.school ?? {};
  const command =
    'cd ~/Documents/edupro-next && export PATH="$HOME/.local/node/bin:$PATH" && set -a && source .env && set +a && pnpm --filter @edupro/workers dev';
  return (
    <Card title="Workers" style={{ marginBottom: 'var(--sp-4)' }}>
      {!state ? (
        <p className="ep-field__help">The state of the workers could not be read.</p>
      ) : (
        <>
          <p
            style={{
              display: 'flex',
              gap: 'var(--sp-4)',
              flexWrap: 'wrap',
              alignItems: 'center',
              margin: 0,
            }}
          >
            <Badge tone={state.running ? 'success' : 'danger'}>
              {state.running ? 'Running' : 'Not running'}
            </Badge>
            {live ? (
              <span>
                Last report {ago(live.at)} · started {when(live.startedAt)} · {live.host} (process{' '}
                {live.pid})
              </span>
            ) : last ? (
              <span>Last seen {when(last.at)}</span>
            ) : (
              <span>No worker has reported yet</span>
            )}
            {!state.redis ? <Badge tone="warning">Redis cannot be reached</Badge> : null}
            {state.processes.filter((p) => p.alive).length > 1 ? (
              <Badge tone="warning">
                {state.processes.filter((p) => p.alive).length} worker processes are running
              </Badge>
            ) : null}
          </p>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-3)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
              margin: 'var(--sp-4) 0',
            }}
          >
            {(
              [
                [
                  'Messages waiting',
                  num(s.messagesQueued),
                  s.oldestQueued ? `oldest ${when(s.oldestQueued)}` : '',
                ],
                ['Messages sent today', num(s.messagesSentToday), ''],
                ['Messages failed today', num(s.messagesFailedToday), ''],
                ['Files waiting', num(s.exportsWaiting), ''],
                ['Jobs not yet handed over', num(s.outboxPending), ''],
                ['Jobs failed (dead letter)', num(s.outboxFailed), ''],
              ] as Array<[string, number, string]>
            ).map(([label, n, note]) => (
              <div key={label} className="ep-card" style={{ padding: 'var(--sp-3)' }}>
                <div className="ep-field__help">{label}</div>
                <strong style={{ fontSize: 'var(--fs-h4)' }}>{n}</strong>
                {note ? <div className="ep-field__help">{note}</div> : null}
              </div>
            ))}
          </div>
          {live ? (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Worker queues">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Worker queues</caption>
                <thead>
                  <tr>
                    <th scope="col">Queue</th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Waiting
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Working
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Scheduled
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Done since start
                    </th>
                    <th scope="col" style={{ textAlign: 'right' }}>
                      Failed since start
                    </th>
                    <th scope="col">Last done</th>
                    <th scope="col">Last failure</th>
                  </tr>
                </thead>
                <tbody>
                  {live.queues.map((q) => (
                    <tr key={q.name}>
                      <td>
                        <strong>{q.name}</strong>
                        <span className="ep-field__help" style={{ display: 'block' }}>
                          {QUEUE[q.name] ?? ''}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>{q.counts?.waiting ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{q.counts?.active ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{q.counts?.delayed ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>{q.done ?? 0}</td>
                      <td style={{ textAlign: 'right' }}>{q.failed ?? 0}</td>
                      <td>{when(q.lastDoneAt)}</td>
                      <td>
                        {q.lastFailedAt ? `${when(q.lastFailedAt)} · ${q.lastError ?? ''}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <details style={{ marginTop: 'var(--sp-3)' }}>
            <summary>How to start or restart the workers</summary>
            <ol>
              <li>In the Terminal where the workers run, press Ctrl+C to stop them.</li>
              <li>
                Run this command again (in a new Terminal if they were not running):
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  <code>{command}</code>
                </pre>
              </li>
              <li>This panel shows Running within 20 seconds.</li>
            </ol>
            <p className="ep-field__help">
              The workers send real SMS, WhatsApp and email through the school’s gateways, so they
              are started from the server, not from this page. They restart by themselves when their
              own code changes; a change in .env or in the database package needs a restart. Run
              only one copy at a time.
            </p>
          </details>
        </>
      )}
    </Card>
  );
}
