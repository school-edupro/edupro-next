import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { apiFetch, getMe } from '@/lib/api';

interface Row {
  id: string;
  studentId: string;
  name: string;
  admissionNo: string;
  section: string | null;
  hostel: string;
  block: string | null;
  roomNo: string;
  bed: string;
  roomType: string;
  kind: 'allot' | 'transfer';
  fromDate: string;
  toDate: string | null;
  endReason: string | null;
}

const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '—');
const END: Record<string, string> = {
  transfer: 'Moved to another bed',
  vacate: 'Left the hostel',
  withdrawn: 'Left the school',
};

/** Every stay: who held which bed, from and to. Filter by hostel, dates, now-staying or ended, or a name. */
export default async function HostelRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ hostel?: string; from?: string; to?: string; open?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const hostels = (await apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels'))
    .data;
  const open = sp.open === 'open' || sp.open === 'ended' ? sp.open : 'all';
  const q = new URLSearchParams({ open });
  if (/^\d{1,18}$/.test(sp.hostel ?? '')) q.set('hostelId', sp.hostel!);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '')) q.set('from', sp.from!);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '')) q.set('to', sp.to!);
  if ((sp.q ?? '').trim()) q.set('q', sp.q!.trim().slice(0, 60));
  const rows = (await apiFetch<{ data: Row[] }>(`/hostel/register?${q.toString()}`)).data;
  const canAllot = me.permissions.includes('hostel.allot.manage');
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Allotment register"
        description="Every stay on a bed, with the hostel, room, bed, room type and the days it covers. A move to another bed ends one stay and starts the next."
      />
      <HostelNav current="/hostel/register" permissions={me.permissions} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="hr-hostel">
            <span className="ep-field__label">Hostel</span>
            <select
              id="hr-hostel"
              name="hostel"
              className="ep-select"
              defaultValue={sp.hostel ?? ''}
            >
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="hr-open">
            <span className="ep-field__label">Stays</span>
            <select id="hr-open" name="open" className="ep-select" defaultValue={open}>
              <option value="all">All</option>
              <option value="open">Staying now</option>
              <option value="ended">Ended</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="hr-from">
            <span className="ep-field__label">Covering from</span>
            <input
              id="hr-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={sp.from}
            />
          </label>
          <label className="ep-field" htmlFor="hr-to">
            <span className="ep-field__label">to</span>
            <input id="hr-to" name="to" type="date" className="ep-input" defaultValue={sp.to} />
          </label>
          <label className="ep-field" htmlFor="hr-q">
            <span className="ep-field__label">Pupil</span>
            <input
              id="hr-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={sp.q}
              placeholder="Name or admission no."
            />
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <Card title={`${String(rows.length)} stay(s)`}>
        {rows.length === 0 ? (
          <p className="ep-field__help">No stay matches.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">Pupil</th>
                  <th scope="col">Class</th>
                  <th scope="col">Hostel</th>
                  <th scope="col">Room · Bed</th>
                  <th scope="col">Room type</th>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {canAllot ? (
                        <a href={`/hostel/allot?student=${r.studentId}`}>{r.name}</a>
                      ) : (
                        r.name
                      )}{' '}
                      <small className="ep-field__help">{r.admissionNo}</small>
                    </td>
                    <td>{r.section ?? '—'}</td>
                    <td>
                      {r.hostel}
                      {r.block ? ` · ${r.block}` : ''}
                    </td>
                    <td>
                      {r.roomNo} · {r.bed}
                    </td>
                    <td>{r.roomType}</td>
                    <td>{dmy(r.fromDate)}</td>
                    <td>{dmy(r.toDate)}</td>
                    <td>
                      {r.endReason ? (
                        <Badge tone="neutral">{END[r.endReason] ?? r.endReason}</Badge>
                      ) : (
                        <Badge tone="success">Staying</Badge>
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
