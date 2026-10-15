import { Card, KpiTile, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';

interface Bed {
  id: string;
  label: string;
  status: 'active' | 'blocked';
  studentId: string | null;
  name: string | null;
  admissionNo: string | null;
  section: string | null;
  since: string | null;
}
interface Room {
  id: string;
  hostelId: string;
  hostel: string;
  block: string | null;
  floor: number;
  roomNo: string;
  roomType: string;
  seater: number;
  ac: boolean;
  status: 'active' | 'maintenance' | 'closed';
  beds: Bed[];
}
interface Board {
  on: string;
  totals: { rooms: number; beds: number; taken: number; free: number; blocked: number };
  byType: Array<{ roomType: string; beds: number; taken: number; free: number }>;
  rooms: Room[];
}
interface Hostel {
  id: string;
  name: string;
  code: string;
  gender: string;
}

const floorName = (f: number) => (f === 0 ? 'Ground floor' : `Floor ${String(f)}`);

/** The occupancy board: every room of a hostel by block and floor, each bed free, taken or blocked. */
export default async function HostelBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    on?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const hostels = (await apiFetch<{ data: Hostel[] }>('/hostel/hostels')).data;
  const hostel = hostels.find((h) => h.id === sp.hostel) ?? hostels[0];
  const on = /^\d{4}-\d{2}-\d{2}$/.test(sp.on ?? '') ? sp.on! : '';
  const board = hostel
    ? await apiFetch<Board>(`/hostel/board?hostelId=${hostel.id}${on ? `&on=${on}` : ''}`)
    : null;
  const canAllot = me.permissions.includes('hostel.allot.manage');
  // rooms grouped by block, then floor
  const groups = new Map<string, Room[]>();
  for (const r of board?.rooms ?? []) {
    const k = `${r.block ? `Block ${r.block} · ` : ''}${floorName(r.floor)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const pct =
    board && board.totals.beds ? Math.round((board.totals.taken / board.totals.beds) * 100) : 0;
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Occupancy"
        description="Every room and bed of the hostel on a day: who holds each bed, the free beds and the blocked ones. Click a free bed to allot it."
      />
      <HostelNav current="/hostel" permissions={me.permissions} />
      <Notice params={sp} />
      {!hostel ? (
        <Card>
          No hostel is set up yet.{' '}
          {me.permissions.includes('hostel.setup.manage') ? (
            <a href="/hostel/setup" style={{ textDecoration: 'underline' }}>
              Set up the first hostel
            </a>
          ) : (
            'Ask the hostel office to set one up.'
          )}
        </Card>
      ) : (
        <>
          <form method="get" className="ep-hd__row" style={{ marginBottom: 'var(--sp-4)' }}>
            <label className="ep-field" htmlFor="hb-hostel">
              <span className="ep-field__label">Hostel</span>
              <select id="hb-hostel" name="hostel" className="ep-select" defaultValue={hostel.id}>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="hb-on">
              <span className="ep-field__label">On</span>
              <input
                id="hb-on"
                name="on"
                type="date"
                className="ep-input"
                defaultValue={board?.on}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--secondary">
              Show
            </button>
          </form>
          {board ? (
            <>
              <div className="ep-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
                <KpiTile label="Beds" value={String(board.totals.beds)} />
                <KpiTile label="Taken" value={`${String(board.totals.taken)} (${String(pct)}%)`} />
                <KpiTile label="Free" value={String(board.totals.free)} />
                <KpiTile label="Blocked / closed" value={String(board.totals.blocked)} />
              </div>
              {board.byType.length ? (
                <Card title="By room type" style={{ marginBottom: 'var(--sp-4)' }}>
                  <table className="ep-table ep-table--dense">
                    <thead>
                      <tr>
                        <th scope="col">Room type</th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Beds
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Taken
                        </th>
                        <th scope="col" style={{ textAlign: 'right' }}>
                          Free
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {board.byType.map((t) => (
                        <tr key={t.roomType}>
                          <td>{t.roomType}</td>
                          <td style={{ textAlign: 'right' }}>{t.beds}</td>
                          <td style={{ textAlign: 'right' }}>{t.taken}</td>
                          <td style={{ textAlign: 'right' }}>{t.free}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ) : null}
              {[...groups.entries()].map(([title, rooms]) => (
                <Card key={title} title={title} style={{ marginBottom: 'var(--sp-4)' }}>
                  <div className="hs-rooms">
                    {rooms.map((r) => (
                      <section
                        key={r.id}
                        className={`hs-room${r.status !== 'active' ? ' hs-room--off' : ''}`}
                        aria-label={`Room ${r.roomNo}`}
                      >
                        <header className="hs-room__head">
                          <strong>Room {r.roomNo}</strong>
                          <span className="ep-field__help">
                            {r.roomType}
                            {r.status !== 'active' ? ` · ${r.status}` : ''}
                          </span>
                        </header>
                        <ul className="hs-beds">
                          {r.beds.map((b) => {
                            const usable = r.status === 'active' && b.status === 'active';
                            const state = b.studentId ? 'taken' : usable ? 'free' : 'blocked';
                            return (
                              <li key={b.id} className={`hs-bed hs-bed--${state}`}>
                                <span className="hs-bed__label">{b.label}</span>
                                {b.studentId ? (
                                  <a
                                    href={`/hostel/allot?student=${b.studentId}`}
                                    className="hs-bed__who"
                                  >
                                    {b.name}
                                    <small>
                                      {b.admissionNo}
                                      {b.section ? ` · ${b.section}` : ''}
                                    </small>
                                  </a>
                                ) : usable && canAllot ? (
                                  <a href={`/hostel/allot?bed=${b.id}`} className="hs-bed__who">
                                    Free <small>Allot</small>
                                  </a>
                                ) : (
                                  <span className="hs-bed__who">{usable ? 'Free' : 'Blocked'}</span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                </Card>
              ))}
              {board.rooms.length === 0 ? (
                <Card>
                  No rooms yet in this hostel.{' '}
                  {me.permissions.includes('hostel.setup.manage') ? (
                    <a href="/hostel/setup?tab=rooms" style={{ textDecoration: 'underline' }}>
                      Add rooms
                    </a>
                  ) : null}
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </>
  );
}
