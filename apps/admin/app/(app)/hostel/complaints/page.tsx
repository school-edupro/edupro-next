import { Badge, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { HostelComplaintForm } from '@/components/hostel/HostelComplaintForm';

interface Complaint {
  id: string;
  number: string;
  status: string;
  subject: string;
  head: string;
  hostel: string;
  room: string | null;
  pupil: string | null;
  openedAt: string;
  closedAt: string | null;
  dueAt: string | null;
  level: number;
  resolution: string | null;
  rating: number | null;
  assignedTo: string | null;
  overdue: boolean;
}

const SHOW = [
  ['open', 'Open'],
  ['closed', 'Closed'],
  ['all', 'All'],
] as const;
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
const STATUS: Record<string, [string, 'warning' | 'info' | 'success' | 'neutral']> = {
  open: ['Open', 'warning'],
  in_progress: ['In progress', 'info'],
  answered: ['Answered', 'success'],
  closed: ['Closed', 'neutral'],
};

/** Room and maintenance complaints of the hostels (the helpdesk's hostel desk): raise, see where each stands. */
export default async function HostelComplaintsPage({
  searchParams,
}: {
  searchParams: Promise<{
    show?: string;
    hostel?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const show = SHOW.some(([k]) => k === sp.show) ? sp.show! : 'open';
  const rows = await apiFetch<{ data: Complaint[] }>(`/hostel/complaints?show=${show}`).then(
    (r) => r.data,
  );
  const canRaise = me.permissions.includes('helpdesk.ticket.raise');
  const canAnswer = me.permissions.includes('helpdesk.ticket.respond');
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Complaints"
        description="Room and maintenance complaints raised by parents, wardens and the office. Each goes to the head warden of the hostel (or the owner set for its type), runs on the helpdesk clock and moves up the escalation matrix when late (Helpdesk set-up → Hostel complaints)."
        actions={
          canAnswer ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/engagement/helpdesk/hostel">
              Open the hostel desk
            </a>
          ) : null
        }
      />
      <HostelNav current="/hostel/complaints" permissions={me.permissions} />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Show" style={{ marginBottom: 'var(--sp-4)' }}>
        {SHOW.map(([k, label]) => (
          <a
            key={k}
            href={`/hostel/complaints?show=${k}`}
            aria-current={k === show ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Card title={`${String(rows.length)} complaint(s)`} style={{ marginBottom: 'var(--sp-4)' }}>
        {rows.length === 0 ? (
          <p className="ep-field__help">Nothing here.</p>
        ) : (
          <ul className="fp-rcpts">
            {rows.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.subject}</strong>{' '}
                  <span className="ep-field__help">
                    {c.number} · {c.head}
                  </span>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {c.hostel}
                    {c.room ? ` · Room ${c.room}` : ''}
                    {c.pupil ? ` · from the parent of ${c.pupil}` : ''} · raised {when(c.openedAt)}{' '}
                    · with {c.assignedTo ?? '—'}
                    {c.level > 1 ? ` (level ${String(c.level)})` : ''}
                  </span>
                  {c.resolution ? (
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      Resolution: {c.resolution}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <Badge tone={STATUS[c.status]?.[1] ?? 'neutral'}>
                    {STATUS[c.status]?.[0] ?? c.status}
                  </Badge>
                  {c.overdue ? <Badge tone="danger">Late</Badge> : null}
                  {canAnswer ? (
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href={`/engagement/helpdesk/hostel/${c.id}`}
                    >
                      Open
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canRaise ? (
        <Card title="Raise a complaint" id="raise">
          <HostelComplaintForm
            hostelId={sp.hostel}
            pickerPath="/hostel/complaints"
            keep={{ show }}
          />
        </Card>
      ) : null}
    </>
  );
}
