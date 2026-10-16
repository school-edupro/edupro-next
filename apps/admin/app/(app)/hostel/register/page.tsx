import { Button, Card, PageHeader } from '@edupro/ui';
import { HostelReportView } from '@/components/hostel/HostelReportView';
import { Notice } from '@/components/Notice';
import { HostelNav } from '@/components/hostel/HostelNav';
import { apiFetch, getMe } from '@/lib/api';

/** Every stay: who held which bed, from and to. Filter by hostel, dates, now-staying or ended, or a name. */
export default async function HostelRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    from?: string;
    to?: string;
    open?: string;
    q?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
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
  // this page with its filters, for the column choice to come back to
  const here = new URLSearchParams({ open });
  if (q.get('hostelId')) here.set('hostel', q.get('hostelId')!);
  for (const k of ['from', 'to', 'q']) if (q.get(k)) here.set(k, q.get(k)!);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Allotment register"
        description="Every stay on a bed, with the hostel, room, bed, room type and the days it covers, and the parents to reach. A move to another bed ends one stay and starts the next. Choose the columns; Excel and PDF follow them."
      />
      <HostelNav current="/hostel/register" permissions={me.permissions} />
      <Notice params={sp} />
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
      <HostelReportView report="register" query={q} back={`/hostel/register?${here.toString()}`} />
    </>
  );
}
