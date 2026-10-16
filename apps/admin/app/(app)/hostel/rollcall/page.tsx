import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { RollcallTabs } from '@/components/hostel/RollcallTabs';
import { apiFetch, getMe } from '@/lib/api';

interface Roll {
  id: string;
  on: string;
  hostel: string;
  session: string;
  atTime: string;
  takenBy: string | null;
  present: number;
  absent: number;
  onLeave: number;
  sick: number;
  absentees: Array<{ name: string; admissionNo: string; note: string | null }>;
}
interface Session {
  id: string;
  hostel: string;
  name: string;
  atTime: string;
  active: boolean;
  takenToday: string | null;
}

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** The roll-calls of a period: per day and session, the counts and who was absent; today's sessions not yet taken. */
export default async function HostelRollcallPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; hostel?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : today();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : from;
  const hostelId = /^\d{1,18}$/.test(sp.hostel ?? '') ? sp.hostel! : '';
  const [hostels, rolls, sessions] = await Promise.all([
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels').then((r) => r.data),
    apiFetch<{ data: Roll[] }>(
      `/hostel/rollcall/report?from=${from}&to=${to}${hostelId ? `&hostelId=${hostelId}` : ''}`,
    ).then((r) => r.data),
    apiFetch<{ data: Session[] }>(
      `/hostel/sessions${hostelId ? `?hostelId=${hostelId}` : ''}`,
    ).then((r) => r.data.filter((s) => s.active)),
  ]);
  const pending = sessions.filter((s) => !s.takenToday);
  const canMark = me.permissions.includes('hostel.rollcall.mark');
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Roll-call"
        description="The wardens take the roll of each session, here or in the staff app. Pupils away on leave are marked by the system; an absence tells the head warden and, by the school's rule, the parent."
      />
      <HostelNav current="/hostel/rollcall" permissions={me.permissions} />
      <RollcallTabs current="rolls" />
      {pending.length ? (
        <div
          className="ep-alert ep-alert--warning"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          Not taken yet today:{' '}
          {pending.map((s) => `${s.hostel} · ${s.name} (${s.atTime})`).join(', ')}
        </div>
      ) : null}
      {canMark && sessions.length ? (
        <Card title="Take the roll today" style={{ marginBottom: 'var(--sp-4)' }}>
          <ul className="hs-approval">
            {sessions.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  <strong>
                    {s.name} · {s.atTime}
                  </strong>{' '}
                  <span className="ep-field__help">{s.hostel}</span>
                </span>
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <Badge tone={s.takenToday ? 'success' : 'warning'}>
                    {s.takenToday ? 'Taken' : 'Not taken'}
                  </Badge>
                  <a
                    className={`ep-btn ep-btn--sm ${s.takenToday ? 'ep-btn--secondary' : 'ep-btn--primary'}`}
                    href={`/hostel/rollcall/take?sessionId=${s.id}`}
                  >
                    {s.takenToday ? 'Open the roll' : 'Take the roll'}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="rr-hostel">
            <span className="ep-field__label">Hostel</span>
            <select id="rr-hostel" name="hostel" className="ep-select" defaultValue={hostelId}>
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="rr-from">
            <span className="ep-field__label">From</span>
            <input id="rr-from" name="from" type="date" className="ep-input" defaultValue={from} />
          </label>
          <label className="ep-field" htmlFor="rr-to">
            <span className="ep-field__label">To</span>
            <input id="rr-to" name="to" type="date" className="ep-input" defaultValue={to} />
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <Card title={`${String(rolls.length)} roll-call(s)`}>
        {rolls.length === 0 ? (
          <p className="ep-field__help">No roll-call was taken in these days.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Hostel · session</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Present
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    On leave
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Sick
                  </th>
                  <th scope="col">Absent</th>
                  <th scope="col">Taken by</th>
                </tr>
              </thead>
              <tbody>
                {rolls.map((r) => (
                  <tr key={r.id}>
                    <td>{r.on.split('-').reverse().join('-')}</td>
                    <td>
                      {r.hostel} · {r.session} ({r.atTime})
                    </td>
                    <td style={{ textAlign: 'right' }}>{r.present}</td>
                    <td style={{ textAlign: 'right' }}>{r.onLeave}</td>
                    <td style={{ textAlign: 'right' }}>{r.sick}</td>
                    <td>
                      {r.absent ? (
                        <>
                          <Badge tone="danger">{r.absent}</Badge>{' '}
                          <small className="ep-field__help">
                            {r.absentees
                              .map(
                                (a) => `${a.name} (${a.admissionNo})${a.note ? `: ${a.note}` : ''}`,
                              )
                              .join('; ')}
                          </small>
                        </>
                      ) : (
                        <Badge tone="success">None</Badge>
                      )}
                    </td>
                    <td>{r.takenBy ?? '—'}</td>
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
