import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { addHostelVisitor, decideHostelVisit, decideHostelVisitor } from '@/lib/hostel-actions';

interface Visit {
  id: string;
  number: string;
  state: string;
  visitorName: string;
  mobile: string | null;
  purpose: string;
  pupil: string;
  admissionNo: string;
  hostel: string;
  listed: boolean;
  inHours: boolean;
  wardenDecision: string | null;
  createdAt: string;
  inAt: string | null;
  outAt: string | null;
  hasPhoto: boolean;
}
interface Visitor {
  id: string;
  studentId: string;
  pupil: string;
  admissionNo: string;
  hostel: string | null;
  name: string;
  relation: string;
  mobile: string;
  status: string;
  source: string;
  hasPhoto: boolean;
}
interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  bed: string | null;
}

const TABS = [
  ['waiting', 'Waiting at the gate'],
  ['today', 'Visits today'],
  ['approve', 'Visitors to approve'],
  ['lists', 'Approved lists'],
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
const STATE: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral' | 'info']> = {
  waiting: ['Waiting for the warden', 'warning'],
  inside: ['Inside', 'info'],
  left: ['Left', 'neutral'],
  cancelled: ['Refused', 'danger'],
};

/** Hostel visitors: visits waiting for a warden, today's visits, visitors parents added, and each boarder's list. */
export default async function HostelVisitorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'waiting';
  const may = (p: string) => me.permissions.includes(p);
  const q = (sp.q ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [visits, pending, hits, list] = await Promise.all([
    tab === 'waiting' || tab === 'today'
      ? apiFetch<{ data: Visit[] }>(`/hostel/visits?show=${tab}`).then((r) => r.data)
      : Promise.resolve([] as Visit[]),
    tab === 'approve'
      ? apiFetch<{ data: Visitor[] }>('/hostel/visitors?status=pending').then((r) => r.data)
      : Promise.resolve([] as Visitor[]),
    tab === 'lists' && q.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/students?q=${encodeURIComponent(q)}`).then((r) =>
          r.data.filter((x) => x.bed),
        )
      : Promise.resolve([] as Hit[]),
    tab === 'lists' && studentId
      ? apiFetch<{ data: Visitor[] }>(`/hostel/visitors?status=all&studentId=${studentId}`).then(
          (r) => r.data,
        )
      : Promise.resolve([] as Visitor[]),
  ]);
  const here = `/hostel/visitors?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ''}${studentId ? `&student=${studentId}` : ''}`;
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Visitors"
        description="Who may visit each boarder, and the warden's part of the visits. The gate registers hostel visitors in the one visitor register (Visitors → Register a visitor → Hostel visit); a visitor not on the list, or outside visiting hours, waits here for a warden, and the parent is told either way."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {may('engagement.visitor.manage') ? (
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/engagement/visitors?state=all&type=${encodeURIComponent('Hostel visitor')}`}
              >
                In the visitor register
              </a>
            ) : null}
            {may('hostel.visit.gate') ? (
              <a
                className="ep-btn ep-btn--primary ep-btn--sm"
                href="/engagement/visitors/new?kind=hostel"
              >
                Register a visitor at the gate
              </a>
            ) : null}
          </span>
        }
      />
      <HostelNav current="/hostel/visitors" permissions={me.permissions} />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Visitors" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map(([k, label]) => (
          <a
            key={k}
            href={`/hostel/visitors?tab=${k}`}
            aria-current={k === tab ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      {tab === 'waiting' || tab === 'today' ? (
        <Card title={`${String(visits.length)} visit(s)`}>
          {visits.length === 0 ? (
            <p className="ep-field__help">
              {tab === 'waiting' ? 'Nobody is waiting.' : 'No hostel visitor today.'}
            </p>
          ) : (
            <ul className="fp-rcpts">
              {visits.map((v) => (
                <li key={v.id}>
                  <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                    {v.hasPhoto ? (
                      <img
                        src={`/api/hostel/photo/visit/${v.id}`}
                        alt={v.visitorName}
                        width={56}
                        height={56}
                        style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ) : null}
                    <span>
                      <strong>{v.visitorName}</strong> → {v.pupil}{' '}
                      <small className="ep-field__help">{v.admissionNo}</small>
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        {v.number} · {v.hostel} · {v.purpose} · {v.mobile ?? '—'} ·{' '}
                        {when(v.createdAt)}
                        {v.outAt ? ` · left ${when(v.outAt)}` : ''}
                      </span>
                      <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        <Badge tone={STATE[v.state]?.[1] ?? 'neutral'}>
                          {STATE[v.state]?.[0] ?? v.state}
                        </Badge>
                        {v.listed ? null : <Badge tone="danger">Not on the list</Badge>}
                        {v.inHours ? null : <Badge tone="warning">Outside hours</Badge>}
                        {v.wardenDecision ? (
                          <Badge tone="neutral">Warden: {v.wardenDecision}</Badge>
                        ) : null}
                      </span>
                    </span>
                  </span>
                  {v.state === 'waiting' && may('hostel.visit.decide') ? (
                    <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      {/* one form per choice: a button's own name/value does not reach a server action */}
                      <form action={decideHostelVisit}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="returnTo" value={here} />
                        <input type="hidden" name="outcome" value="allowed" />
                        <Button type="submit" size="sm">
                          Allow in
                        </Button>
                      </form>
                      <form action={decideHostelVisit}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="returnTo" value={here} />
                        <input type="hidden" name="outcome" value="refused" />
                        <Button type="submit" size="sm" variant="secondary">
                          Refuse
                        </Button>
                      </form>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'approve' ? (
        <Card title={`${String(pending.length)} visitor(s) to approve`}>
          {pending.length === 0 ? (
            <p className="ep-field__help">No visitor added by a parent is waiting.</p>
          ) : (
            <ul className="fp-rcpts">
              {pending.map((v) => (
                <li key={v.id}>
                  <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                    {v.hasPhoto ? (
                      <img
                        src={`/api/hostel/photo/visitor/${v.id}`}
                        alt={v.name}
                        width={48}
                        height={48}
                        style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ) : null}
                    <span>
                      <strong>{v.name}</strong> ({v.relation}) · {v.mobile}
                      <span className="ep-field__help" style={{ display: 'block' }}>
                        for {v.pupil} · {v.admissionNo} · {v.hostel ?? '—'}
                      </span>
                    </span>
                  </span>
                  {may('hostel.visit.decide') ? (
                    <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                      {/* one form per choice: a button's own name/value does not reach a server action */}
                      <form action={decideHostelVisitor}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="returnTo" value={here} />
                        <input type="hidden" name="outcome" value="approved" />
                        <Button type="submit" size="sm">
                          Approve
                        </Button>
                      </form>
                      <form action={decideHostelVisitor}>
                        <input type="hidden" name="id" value={v.id} />
                        <input type="hidden" name="returnTo" value={here} />
                        <input type="hidden" name="outcome" value="rejected" />
                        <Button type="submit" size="sm" variant="secondary">
                          Reject
                        </Button>
                      </form>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {tab === 'lists' ? (
        <>
          <Card title="Find a boarder" style={{ marginBottom: 'var(--sp-4)' }}>
            <form method="get" className="ep-hd__row">
              <input type="hidden" name="tab" value="lists" />
              <label className="ep-field" htmlFor="vl-q">
                <span className="ep-field__label">Name or admission no.</span>
                <input
                  id="vl-q"
                  name="q"
                  type="search"
                  className="ep-input"
                  defaultValue={q}
                  minLength={2}
                  required
                />
              </label>
              <Button type="submit" variant="secondary">
                Find
              </Button>
            </form>
            {hits.length ? (
              <ul className="fp-rcpts" style={{ marginTop: 'var(--sp-3)' }}>
                {hits.map((x) => (
                  <li key={x.id}>
                    <span>
                      <strong>{x.name}</strong>{' '}
                      <span className="ep-field__help">
                        {x.admissionNo} · {x.bed}
                      </span>
                    </span>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/hostel/visitors?tab=lists&q=${encodeURIComponent(q)}&student=${x.id}`}
                    >
                      Open the list
                    </a>
                  </li>
                ))}
              </ul>
            ) : q.length >= 2 ? (
              <p className="ep-field__help">No boarder matches “{q}”.</p>
            ) : null}
          </Card>
          {studentId ? (
            <Card title="Approved list">
              {list.length === 0 ? (
                <p className="ep-field__help">Only the parents on the school record.</p>
              ) : null}
              <ul className="fp-rcpts">
                {list.map((v) => (
                  <li key={v.id}>
                    <span>
                      <strong>{v.name}</strong>{' '}
                      <span className="ep-field__help">
                        {v.relation} · {v.mobile} · added by {v.source}
                      </span>
                    </span>
                    <Badge
                      tone={
                        v.status === 'approved'
                          ? 'success'
                          : v.status === 'pending'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {v.status}
                    </Badge>
                  </li>
                ))}
              </ul>
              {may('hostel.visit.decide') ? (
                <form
                  action={addHostelVisitor}
                  className="ep-hd__row"
                  style={{ marginTop: 'var(--sp-4)' }}
                >
                  <input type="hidden" name="studentId" value={studentId} />
                  <input type="hidden" name="returnTo" value={here} />
                  <label className="ep-field" htmlFor="va-name">
                    <span className="ep-field__label">Name</span>
                    <input
                      id="va-name"
                      name="name"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={120}
                    />
                  </label>
                  <label className="ep-field" htmlFor="va-rel">
                    <span className="ep-field__label">Relation</span>
                    <input
                      id="va-rel"
                      name="relation"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={60}
                    />
                  </label>
                  <label className="ep-field" htmlFor="va-mob">
                    <span className="ep-field__label">Mobile</span>
                    <input
                      id="va-mob"
                      name="mobile"
                      className="ep-input"
                      required
                      inputMode="numeric"
                      pattern="[6-9][0-9]{9}"
                      maxLength={10}
                    />
                  </label>
                  <Button type="submit">Add (approved)</Button>
                </form>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
