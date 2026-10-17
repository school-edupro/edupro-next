import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { addHostelVisitor, decideHostelVisit, decideHostelVisitor } from '@/lib/hostel-actions';
import { exitVisitor } from '@/lib/visitor-actions';

interface Visit {
  id: string;
  number: string;
  state: string;
  visitorName: string;
  mobile: string | null;
  purpose: string;
  partySize: number;
  idProofKind: string | null;
  gate: string | null;
  exitGate: string | null;
  pupil: string;
  admissionNo: string;
  hostel: string;
  room: string | null;
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

interface VisitPage {
  data: Visit[];
  total: number;
  counts: {
    waiting: number;
    inside: number;
    today: number;
    left: number;
    all: number;
    peopleInside: number;
  };
}
const TABS = [
  ['register', 'Visitor register'],
  ['approve', 'Visitors to approve'],
  ['lists', 'Approved lists'],
  ['download', 'Download (Excel / PDF)'],
] as const;
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
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
const SHOWS = [
  ['inside', 'Inside now'],
  ['waiting', 'Waiting for the warden'],
  ['today', 'Today'],
  ['left', 'Left'],
  ['all', 'Everything'],
] as const;
const SIZES = [10, 25, 50, 100];
const time = (v: string | null) =>
  v
    ? new Date(v).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
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
    show?: string;
    hostel?: string;
    from?: string;
    to?: string;
    find?: string;
    page?: string;
    size?: string;
    q?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  // the old tabs open the register on that state
  const oldTab = sp.tab === 'waiting' || sp.tab === 'today' ? sp.tab : '';
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'register';
  const isDay = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
  const r = {
    show: SHOWS.some(([k]) => k === sp.show) ? sp.show! : oldTab || 'inside',
    hostel: /^\d{1,18}$/.test(sp.hostel ?? '') ? sp.hostel! : '',
    from: isDay(sp.from) ? sp.from! : '',
    to: isDay(sp.to) ? sp.to! : '',
    find: (sp.find ?? '').trim().slice(0, 80),
  };
  const rSize = SIZES.includes(Number(sp.size)) ? Number(sp.size) : 25;
  const rPage = Math.max(1, Number(sp.page) || 1);
  const rQs = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          tab: 'register',
          ...r,
          size: String(rSize),
          page: String(rPage),
          ...extra,
        }).filter(([, v]) => v),
      ),
    ).toString();
  const may = (p: string) => me.permissions.includes(p);
  const q = (sp.q ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [reg, pending, hits, list, hostels] = await Promise.all([
    tab === 'register'
      ? apiFetch<VisitPage>(
          `/hostel/visits?${new URLSearchParams(
            Object.fromEntries(
              Object.entries({
                show: r.show,
                hostelId: r.hostel,
                from: r.from,
                to: r.to,
                q: r.find,
                page: String(rPage),
                size: String(rSize),
              }).filter(([, v]) => v),
            ),
          ).toString()}`,
        )
      : Promise.resolve(null),
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
    tab === 'download'
      ? apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels').then(
          (r) => r.data,
        )
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  const here =
    tab === 'register'
      ? `/hostel/visitors?${rQs()}`
      : `/hostel/visitors?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ''}${studentId ? `&student=${studentId}` : ''}`;
  const rPages = reg ? Math.max(1, Math.ceil(reg.total / rSize)) : 1;
  const fileQs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({
        kind: 'visits',
        hostelId: r.hostel,
        from: r.from,
        to: r.to,
        show: r.show,
        q: r.find,
      }).filter(([, v]) => v),
    ),
  ).toString();
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

      {tab === 'register' && reg ? (
        <>
          <nav
            className="ep-tabs-links"
            aria-label="Which visitors"
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {SHOWS.map(([k, label]) => (
              <a
                key={k}
                href={`/hostel/visitors?${rQs({ show: k, page: '1' })}`}
                aria-current={k === r.show ? 'page' : undefined}
              >
                {label} · {reg.counts[k]}
              </a>
            ))}
          </nav>
          <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
            <form method="get" className="ep-dlog__filters">
              <input type="hidden" name="tab" value="register" />
              <input type="hidden" name="show" value={r.show} />
              <label className="ep-field" htmlFor="vr-hostel">
                <span className="ep-field__label">Hostel</span>
                <select id="vr-hostel" name="hostel" className="ep-select" defaultValue={r.hostel}>
                  <option value="">All hostels</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="vr-from">
                <span className="ep-field__label">From</span>
                <input
                  id="vr-from"
                  name="from"
                  type="date"
                  className="ep-input"
                  defaultValue={r.from}
                />
              </label>
              <label className="ep-field" htmlFor="vr-to">
                <span className="ep-field__label">To</span>
                <input id="vr-to" name="to" type="date" className="ep-input" defaultValue={r.to} />
              </label>
              <label className="ep-field" htmlFor="vr-find">
                <span className="ep-field__label">Search</span>
                <input
                  id="vr-find"
                  name="find"
                  type="search"
                  className="ep-input"
                  defaultValue={r.find}
                  placeholder="Pass no., visitor, mobile or boarder"
                />
              </label>
              <label className="ep-field" htmlFor="vr-size">
                <span className="ep-field__label">Rows per page</span>
                <select id="vr-size" name="size" className="ep-select" defaultValue={String(rSize)}>
                  {SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="ep-btn ep-btn--secondary">
                Show
              </button>
            </form>
          </div>
          <Card
            title={`${String(reg.total)} hostel visitor(s)${r.show === 'inside' ? ` · ${String(reg.counts.peopleInside)} people inside` : ''} · latest first`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/hostel/mess-file?${fileQs}&format=xlsx`}
                >
                  Excel
                </a>
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/api/hostel/mess-file?${fileQs}&format=pdf`}
                >
                  PDF
                </a>
              </span>
            }
          >
            {reg.data.length === 0 ? (
              <p className="ep-field__help">No hostel visitor matches.</p>
            ) : (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Hostel visitors"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Hostel visitor register</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pass</th>
                      <th scope="col">Visitor</th>
                      <th scope="col">To meet</th>
                      <th scope="col">In</th>
                      <th scope="col">Out</th>
                      <th scope="col">Status</th>
                      <th scope="col">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.data.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <a href={`/engagement/visitors/${v.id}`}>{v.number}</a>
                          <div className="ep-field__help">{when(v.createdAt)}</div>
                        </td>
                        <td>
                          <span
                            style={{
                              display: 'flex',
                              gap: 'var(--sp-2)',
                              alignItems: 'flex-start',
                            }}
                          >
                            {v.hasPhoto ? (
                              <img
                                src={`/api/hostel/photo/visit/${v.id}`}
                                alt={v.visitorName}
                                width={44}
                                height={44}
                                style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                              />
                            ) : null}
                            <span>
                              <strong>{v.visitorName}</strong>
                              <div className="ep-field__help">
                                {[
                                  v.mobile,
                                  v.idProofKind,
                                  v.partySize > 1 ? `${String(v.partySize)} people` : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            </span>
                          </span>
                        </td>
                        <td>
                          {v.pupil} <small className="ep-field__help">{v.admissionNo}</small>
                          <div className="ep-field__help">
                            {v.hostel}
                            {v.room ? ` · Room ${v.room}` : ''} · {v.purpose}
                          </div>
                        </td>
                        <td>
                          {time(v.inAt)}
                          {v.gate ? <div className="ep-field__help">{v.gate}</div> : null}
                        </td>
                        <td>
                          {time(v.outAt)}
                          {v.exitGate ? <div className="ep-field__help">{v.exitGate}</div> : null}
                        </td>
                        <td>
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
                        </td>
                        <td>
                          {v.state === 'waiting' && may('hostel.visit.decide') ? (
                            <span style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                              {/* one form per choice: a button's own name/value does not reach a server action */}
                              <form action={decideHostelVisit}>
                                <input type="hidden" name="id" value={v.id} />
                                <input type="hidden" name="returnTo" value={here} />
                                <input type="hidden" name="outcome" value="allowed" />
                                <Button
                                  type="submit"
                                  size="sm"
                                  aria-label={`Allow ${v.visitorName} in`}
                                >
                                  Allow in
                                </Button>
                              </form>
                              <form action={decideHostelVisit}>
                                <input type="hidden" name="id" value={v.id} />
                                <input type="hidden" name="returnTo" value={here} />
                                <input type="hidden" name="outcome" value="refused" />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="secondary"
                                  aria-label={`Refuse ${v.visitorName}`}
                                >
                                  Refuse
                                </Button>
                              </form>
                            </span>
                          ) : v.state === 'inside' && may('engagement.visitor.manage') ? (
                            <form action={exitVisitor} className="ep-gate__act">
                              <input type="hidden" name="id" value={v.id} />
                              <input type="hidden" name="returnTo" value={here} />
                              <input type="hidden" name="exitGate" value={v.gate ?? ''} />
                              <Button
                                type="submit"
                                size="sm"
                                aria-label={`Record exit of ${v.number}`}
                              >
                                Exit
                              </Button>
                            </form>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {rPages > 1 ? (
              <nav
                aria-label="Pages"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  marginTop: 'var(--sp-3)',
                }}
              >
                {rPage > 1 ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/visitors?${rQs({ page: String(rPage - 1) })}`}
                  >
                    Previous
                  </a>
                ) : null}
                <span className="ep-field__help">
                  Page {rPage} of {rPages}
                </span>
                {rPage < rPages ? (
                  <a
                    className="ep-btn ep-btn--ghost ep-btn--sm"
                    href={`/hostel/visitors?${rQs({ page: String(rPage + 1) })}`}
                  >
                    Next
                  </a>
                ) : null}
              </nav>
            ) : null}
          </Card>
        </>
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
      {tab === 'download' ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
          }}
        >
          <Card title="Visit register">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Every hostel visit of a period: the date, in and out times, the visitor and relation,
              the boarder and room, whether the visitor was on the list and within visiting hours,
              and the warden’s decision. The last 30 days when no date is given.
            </p>
            <form method="get" action="/api/hostel/mess-file" className="ep-hd__form">
              <input type="hidden" name="kind" value="visits" />
              <label className="ep-field" htmlFor="vd-hostel">
                <span className="ep-field__label">Hostel</span>
                <select id="vd-hostel" name="hostelId" className="ep-select" defaultValue="">
                  <option value="">All hostels</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="vd-from">
                  <span className="ep-field__label">From</span>
                  <input
                    id="vd-from"
                    name="from"
                    type="date"
                    className="ep-input"
                    max={istToday()}
                  />
                </label>
                <label className="ep-field" htmlFor="vd-to">
                  <span className="ep-field__label">To</span>
                  <input id="vd-to" name="to" type="date" className="ep-input" max={istToday()} />
                </label>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <button
                  type="submit"
                  name="format"
                  value="xlsx"
                  className="ep-btn ep-btn--secondary"
                >
                  Excel
                </button>
                <button
                  type="submit"
                  name="format"
                  value="pdf"
                  className="ep-btn ep-btn--secondary"
                >
                  PDF
                </button>
              </div>
            </form>
          </Card>
          <Card title="Approved visitors">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Who may visit each boarder today: the parents and guardians on the school record, and
              the people a warden approved (or who wait for approval), with who added them.
            </p>
            <form method="get" action="/api/hostel/mess-file" className="ep-hd__form">
              <input type="hidden" name="kind" value="visitor-list" />
              <label className="ep-field" htmlFor="vl-hostel">
                <span className="ep-field__label">Hostel</span>
                <select id="vl-hostel" name="hostelId" className="ep-select" defaultValue="">
                  <option value="">All hostels</option>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <button
                  type="submit"
                  name="format"
                  value="xlsx"
                  className="ep-btn ep-btn--secondary"
                >
                  Excel
                </button>
                <button
                  type="submit"
                  name="format"
                  value="pdf"
                  className="ep-btn ep-btn--secondary"
                >
                  PDF
                </button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
