import { Badge, Button, Card, KpiTile, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { apiFetch, getMe } from '@/lib/api';

interface Today {
  boarders: number;
  away: number;
  overdue: number;
  toHandOver: number;
  waiting: number;
  sessions: number;
  rollsTaken: number;
  absentToday: number;
}
interface Leave {
  id: string;
  number: string;
  kind: 'hostel_home' | 'hostel_outing';
  state: string;
  name: string;
  admissionNo: string;
  hostel: string | null;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  outAt: string | null;
  inAt: string | null;
  lateMinutes: number | null;
  reason: string;
  escortName: string | null;
  overdue: boolean;
  escalated: boolean;
}

const SHOW = [
  ['out', 'Away now'],
  ['overdue', 'Overdue'],
  ['handover', 'To hand over today'],
  ['pending', 'Waiting for the warden'],
  ['all', 'All'],
] as const;
const STATE: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  handed_over: 'Handed over',
  out: 'Away',
  returned: 'Back',
  rejected: 'Not approved',
  cancelled: 'Cancelled',
};
const when = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** Hostel leave and outings for the office: away now, overdue, to hand over, waiting, and the history. */
export default async function HostelLeavePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; hostel?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const show = SHOW.some(([k]) => k === sp.show) ? sp.show! : 'out';
  const hostelId = /^\d{1,18}$/.test(sp.hostel ?? '') ? sp.hostel! : '';
  const [today, hostels, rows] = await Promise.all([
    apiFetch<Today>('/hostel/today'),
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels').then((r) => r.data),
    apiFetch<{ data: Leave[] }>(
      `/hostel/leaves?show=${show}${hostelId ? `&hostelId=${hostelId}` : ''}`,
    ).then((r) => r.data),
  ]);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Leave and outings"
        description="Home leave and outings asked by parents and approved by the wardens: who is away now, who is late back, who is to be handed over today. The gate checks pupils out and back in against the pass."
      />
      <HostelNav current="/hostel/leave" permissions={me.permissions} />
      <div className="ep-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <KpiTile label="Boarders" value={String(today.boarders)} />
        <KpiTile label="Away now" value={String(today.away)} />
        <KpiTile label="Overdue" value={String(today.overdue)} />
        <KpiTile label="Waiting for a warden" value={String(today.waiting)} />
        <KpiTile label="Absent at roll-call today" value={String(today.absentToday)} />
      </div>
      <nav className="ep-tabs-links" aria-label="Show" style={{ marginBottom: 'var(--sp-3)' }}>
        {SHOW.map(([k, label]) => (
          <a
            key={k}
            href={`/hostel/leave?show=${k}${hostelId ? `&hostel=${hostelId}` : ''}`}
            aria-current={k === show ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <form method="get" className="ep-hd__row" style={{ marginBottom: 'var(--sp-4)' }}>
        <input type="hidden" name="show" value={show} />
        <label className="ep-field" htmlFor="hl-hostel">
          <span className="ep-field__label">Hostel</span>
          <select id="hl-hostel" name="hostel" className="ep-select" defaultValue={hostelId}>
            <option value="">All hostels</option>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>
      <Card title={`${String(rows.length)} pass(es)`}>
        {rows.length === 0 ? (
          <p className="ep-field__help">Nothing here.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Pupil</th>
                  <th scope="col">Hostel</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Leaves</th>
                  <th scope="col">Back by</th>
                  <th scope="col">Out</th>
                  <th scope="col">Back</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {me.permissions.includes('engagement.gate_pass.view') ? (
                        <a
                          href={`/engagement/gate-passes/${r.id}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {r.name}
                        </a>
                      ) : (
                        r.name
                      )}{' '}
                      <small className="ep-field__help">
                        {r.admissionNo} · {r.number}
                      </small>
                      <small className="ep-field__help" style={{ display: 'block' }}>
                        {r.reason}
                        {r.escortName ? ` · with ${r.escortName}` : ''}
                      </small>
                    </td>
                    <td>{r.hostel ?? '—'}</td>
                    <td>{r.kind === 'hostel_home' ? 'Home leave' : 'Outing'}</td>
                    <td>
                      {r.onDate.split('-').reverse().join('-')}
                      {r.atTime ? ` ${r.atTime}` : ''}
                    </td>
                    <td>{when(r.returnBy)}</td>
                    <td>{when(r.outAt)}</td>
                    <td>{when(r.inAt)}</td>
                    <td>
                      {r.overdue ? (
                        <Badge tone="danger">Overdue{r.escalated ? ' · principal told' : ''}</Badge>
                      ) : r.lateMinutes ? (
                        <Badge tone="warning">Back {r.lateMinutes} min late</Badge>
                      ) : (
                        <Badge tone={r.state === 'out' ? 'info' : 'neutral'}>
                          {STATE[r.state] ?? r.state}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
