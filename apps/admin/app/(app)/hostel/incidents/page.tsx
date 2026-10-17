import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { recordIncident } from '@/lib/hostel-actions';
import { INCIDENT_CATEGORIES, INCIDENT_STATUS, incidentWhen, type Incident } from '@/lib/incidents';

interface IncidentPage {
  data: Incident[];
  total: number;
  page: number;
  size: number;
  counts: { open: number; follow_up: number; closed: number };
}
interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  bed: string | null;
}
const SIZES = [25, 50, 100];
const isDate = (v?: string) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');

/**
 * The hostel incident register: record an incident (with photos or documents, a minor one may be closed
 * at once), and follow the open ones. Filters, pages, Excel and PDF; each incident opens with its trail.
 */
export default async function HostelIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    hostel?: string;
    category?: string;
    severity?: string;
    status?: string;
    from?: string;
    to?: string;
    q?: string;
    page?: string;
    size?: string;
    sq?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canRecord = me.permissions.includes('hostel.incident.manage');
  const hostels = (await apiFetch<{ data: Array<{ id: string; name: string }> }>('/hostel/hostels'))
    .data;
  const f = {
    hostelId: hostels.some((h) => h.id === sp.hostel) ? sp.hostel! : '',
    category: INCIDENT_CATEGORIES.some(([k]) => k === sp.category) ? sp.category! : '',
    severity: sp.severity === 'minor' || sp.severity === 'serious' ? sp.severity : '',
    status: ['open', 'follow_up', 'closed', 'not_closed'].includes(sp.status ?? '')
      ? sp.status!
      : '',
    from: isDate(sp.from) ? sp.from! : '',
    to: isDate(sp.to) ? sp.to! : '',
    q: (sp.q ?? '').trim().slice(0, 60),
  };
  const size = SIZES.includes(Number(sp.size)) ? Number(sp.size) : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({
          ...f,
          hostel: f.hostelId,
          hostelId: '',
          size: String(size),
          page: String(page),
          ...extra,
        }).filter(([, v]) => v),
      ),
    ).toString();
  const apiQs = new URLSearchParams(
    Object.fromEntries(
      Object.entries({ ...f, page: String(page), size: String(size) }).filter(([, v]) => v),
    ),
  ).toString();
  const sq = (sp.sq ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [list, hits] = await Promise.all([
    apiFetch<IncidentPage>(`/hostel/incidents?${apiQs}`),
    canRecord && sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/students?q=${encodeURIComponent(sq)}`).then((r) =>
          r.data.filter((x) => x.bed),
        )
      : Promise.resolve([] as Hit[]),
  ]);
  const pupil = hits.find((x) => x.id === studentId);
  const pages = Math.max(1, Math.ceil(list.total / size));
  const fileQs = new URLSearchParams(
    Object.fromEntries(Object.entries({ kind: 'incidents', ...f }).filter(([, v]) => v)),
  ).toString();
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Incidents"
        description="Discipline, health, safety and property incidents of the boarders, followed until they are closed. Tick “tell the parent” to send it to the family; a serious incident also goes to the principal and the school admins and stays open until it is closed with a remark."
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
      />
      <HostelNav current="/hostel/incidents" permissions={me.permissions} />
      <Notice params={sp} />
      {canRecord ? (
        <Card title="Record an incident" style={{ marginBottom: 'var(--sp-4)' }}>
          <form method="get" className="ep-hd__row">
            <label className="ep-field" htmlFor="hi-sq">
              <span className="ep-field__label">Boarder (name or admission no.)</span>
              <input
                id="hi-sq"
                name="sq"
                type="search"
                className="ep-input"
                defaultValue={sq}
                minLength={2}
                required
              />
            </label>
            <Button type="submit" variant="secondary">
              Find
            </Button>
          </form>
          {sq.length >= 2 && !pupil ? (
            hits.length ? (
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
                      href={`/hostel/incidents?sq=${encodeURIComponent(sq)}&student=${x.id}`}
                    >
                      Choose
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help">No boarder matches “{sq}”.</p>
            )
          ) : null}
          {pupil ? (
            <form
              action={recordIncident}
              className="hs-form"
              style={{ marginTop: 'var(--sp-3)', maxWidth: '44rem' }}
            >
              <h3 className="hs-h">
                {pupil.name} · {pupil.admissionNo}
              </h3>
              <input type="hidden" name="studentId" value={pupil.id} />
              <input
                type="hidden"
                name="returnTo"
                value={`/hostel/incidents?sq=${encodeURIComponent(sq)}&student=${pupil.id}`}
              />
              <label className="ep-field" htmlFor="hi-when">
                <span className="ep-field__label">When (empty = now)</span>
                <input id="hi-when" name="occurredAt" type="datetime-local" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="hi-cat">
                <span className="ep-field__label">Kind</span>
                <select id="hi-cat" name="category" className="ep-select" defaultValue="discipline">
                  {INCIDENT_CATEGORIES.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field" htmlFor="hi-sev">
                <span className="ep-field__label">How serious</span>
                <select id="hi-sev" name="severity" className="ep-select" defaultValue="minor">
                  <option value="minor">Minor</option>
                  <option value="serious">
                    Serious (the principal is told; stays open until closed)
                  </option>
                </select>
              </label>
              <label className="ep-field" htmlFor="hi-what">
                <span className="ep-field__label">What happened *</span>
                <textarea
                  id="hi-what"
                  name="what"
                  className="ep-input"
                  rows={3}
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </label>
              <label className="ep-field" htmlFor="hi-act">
                <span className="ep-field__label">Action taken</span>
                <textarea
                  id="hi-act"
                  name="action"
                  className="ep-input"
                  rows={2}
                  maxLength={1000}
                />
              </label>
              <label className="ep-field" htmlFor="hi-files">
                <span className="ep-field__label">
                  Photos or documents (PDF, JPEG, PNG; up to 5 MB each)
                </span>
                <input
                  id="hi-files"
                  name="files"
                  type="file"
                  multiple
                  className="ep-input"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                />
              </label>
              <label className="ep-check" htmlFor="hi-tell">
                <input id="hi-tell" name="tellParent" type="checkbox" /> Tell the parent (message
                and the parent app)
              </label>
              <label className="ep-check" htmlFor="hi-close">
                <input id="hi-close" name="closeNow" type="checkbox" /> Dealt with: close it now
                (minor only)
              </label>
              <div>
                <Button type="submit">Record</Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}
      <div className="ep-filter-band" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-dlog__filters">
          <label className="ep-field" htmlFor="if-hostel">
            <span className="ep-field__label">Hostel</span>
            <select id="if-hostel" name="hostel" className="ep-select" defaultValue={f.hostelId}>
              <option value="">All hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="if-cat">
            <span className="ep-field__label">Kind</span>
            <select id="if-cat" name="category" className="ep-select" defaultValue={f.category}>
              <option value="">All</option>
              {INCIDENT_CATEGORIES.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" htmlFor="if-sev">
            <span className="ep-field__label">Severity</span>
            <select id="if-sev" name="severity" className="ep-select" defaultValue={f.severity}>
              <option value="">All</option>
              <option value="minor">Minor</option>
              <option value="serious">Serious</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="if-status">
            <span className="ep-field__label">Status</span>
            <select id="if-status" name="status" className="ep-select" defaultValue={f.status}>
              <option value="">All (open first)</option>
              <option value="not_closed">Not closed</option>
              <option value="open">Open</option>
              <option value="follow_up">In follow-up</option>
              <option value="closed">Closed</option>
            </select>
          </label>
          <label className="ep-field" htmlFor="if-from">
            <span className="ep-field__label">From</span>
            <input
              id="if-from"
              name="from"
              type="date"
              className="ep-input"
              defaultValue={f.from}
            />
          </label>
          <label className="ep-field" htmlFor="if-to">
            <span className="ep-field__label">To</span>
            <input id="if-to" name="to" type="date" className="ep-input" defaultValue={f.to} />
          </label>
          <label className="ep-field" htmlFor="if-q">
            <span className="ep-field__label">Pupil</span>
            <input
              id="if-q"
              name="q"
              type="search"
              className="ep-input"
              defaultValue={f.q}
              placeholder="Name or admission no."
            />
          </label>
          <label className="ep-field" htmlFor="if-size">
            <span className="ep-field__label">Rows per page</span>
            <select id="if-size" name="size" className="ep-select" defaultValue={String(size)}>
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
        title={`${String(list.total)} incident(s)`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
            <Badge tone="warning">Open {list.counts.open}</Badge>
            <Badge tone="info">In follow-up {list.counts.follow_up}</Badge>
            <Badge tone="success">Closed {list.counts.closed}</Badge>
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
        {list.data.length === 0 ? (
          <p className="ep-field__help">No incident matches.</p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Incidents">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Hostel incidents</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Pupil</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="ep-sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {incidentWhen(i.occurredAt)}
                      <div className="ep-field__help">by {i.recordedBy ?? '—'}</div>
                    </td>
                    <td>
                      <strong>{i.name}</strong>
                      <div className="ep-field__help">
                        {i.admissionNo} · {i.hostel}
                      </div>
                    </td>
                    <td>
                      {i.what.length > 140 ? `${i.what.slice(0, 140)}…` : i.what}
                      {i.notes || i.files ? (
                        <div className="ep-field__help">
                          {i.notes ? `${String(i.notes)} note(s)` : ''}
                          {i.notes && i.files ? ' · ' : ''}
                          {i.files ? `${String(i.files)} file(s)` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        <Badge tone="neutral">
                          {INCIDENT_CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category}
                        </Badge>
                        {i.severity === 'serious' ? <Badge tone="danger">Serious</Badge> : null}
                        {i.parentToldAt ? <Badge tone="success">Parent told</Badge> : null}
                      </span>
                    </td>
                    <td>
                      <Badge tone={INCIDENT_STATUS[i.status][1]}>
                        {INCIDENT_STATUS[i.status][0]}
                      </Badge>
                    </td>
                    <td>
                      <a
                        className="ep-btn ep-btn--secondary ep-btn--sm"
                        href={`/hostel/incidents/${i.id}`}
                        aria-label={`Open the incident of ${i.name}`}
                      >
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 ? (
          <nav
            aria-label="Pages"
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              marginTop: 'var(--sp-3)',
            }}
          >
            {page > 1 ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/hostel/incidents?${qs({ page: String(page - 1) })}`}
              >
                Previous
              </a>
            ) : null}
            <span className="ep-field__help">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/hostel/incidents?${qs({ page: String(page + 1) })}`}
              >
                Next
              </a>
            ) : null}
          </nav>
        ) : null}
      </Card>
    </>
  );
}
