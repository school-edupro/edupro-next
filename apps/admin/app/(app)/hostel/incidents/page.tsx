import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { recordIncident } from '@/lib/hostel-actions';

interface Incident {
  id: string;
  studentId: string;
  name: string;
  admissionNo: string;
  hostel: string;
  occurredAt: string;
  category: string;
  severity: 'minor' | 'serious';
  what: string;
  action: string | null;
  tellParent: boolean;
  parentToldAt: string | null;
  principalToldAt: string | null;
  recordedBy: string | null;
}
interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  bed: string | null;
}

const CATEGORIES = [
  ['discipline', 'Discipline'],
  ['health', 'Health'],
  ['safety', 'Safety'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const;
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The hostel incident register: what happened, the action taken, and whether the parent was told. */
export default async function HostelIncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string;
    sq?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const category = CATEGORIES.some(([k]) => k === sp.category) ? sp.category! : '';
  const sq = (sp.sq ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const canRecord = me.permissions.includes('hostel.incident.manage');
  const [rows, hits] = await Promise.all([
    apiFetch<{ data: Incident[] }>(
      `/hostel/incidents${category ? `?category=${category}` : ''}`,
    ).then((r) => r.data),
    canRecord && sq.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/students?q=${encodeURIComponent(sq)}`).then((r) =>
          r.data.filter((x) => x.bed),
        )
      : Promise.resolve([] as Hit[]),
  ]);
  const pupil = hits.find((x) => x.id === studentId);
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Incidents"
        description="Discipline, health, safety and property incidents of the boarders. Tick “tell the parent” to send it to the family (they see it in the portal); a serious incident also goes to the principal and the school admins."
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
              <label className="ep-field" htmlFor="hi-when">
                <span className="ep-field__label">When (empty = now)</span>
                <input id="hi-when" name="occurredAt" type="datetime-local" className="ep-input" />
              </label>
              <label className="ep-field" htmlFor="hi-cat">
                <span className="ep-field__label">Kind</span>
                <select id="hi-cat" name="category" className="ep-select" defaultValue="discipline">
                  {CATEGORIES.map(([k, label]) => (
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
                  <option value="serious">Serious (the principal is told)</option>
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
              <label className="ep-field" htmlFor="hi-tell">
                <span>
                  <input id="hi-tell" name="tellParent" type="checkbox" /> Tell the parent (message
                  and the portal)
                </span>
              </label>
              <div>
                <Button type="submit">Record</Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}
      <nav className="ep-tabs-links" aria-label="Kind" style={{ marginBottom: 'var(--sp-3)' }}>
        <a href="/hostel/incidents" aria-current={!category ? 'page' : undefined}>
          All
        </a>
        {CATEGORIES.map(([k, label]) => (
          <a
            key={k}
            href={`/hostel/incidents?category=${k}`}
            aria-current={k === category ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
      </nav>
      <Card title={`${String(rows.length)} incident(s)`}>
        {rows.length === 0 ? (
          <p className="ep-field__help">No incident recorded.</p>
        ) : (
          <ul className="fp-rcpts">
            {rows.map((i) => (
              <li key={i.id}>
                <span>
                  <strong>{i.name}</strong>{' '}
                  <span className="ep-field__help">
                    {i.admissionNo} · {i.hostel} · {when(i.occurredAt)} · by {i.recordedBy ?? '—'}
                  </span>
                  <span style={{ display: 'block' }}>{i.what}</span>
                  {i.action ? (
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      Action: {i.action}
                    </span>
                  ) : null}
                </span>
                <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                  <Badge tone="info">
                    {CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category}
                  </Badge>
                  {i.severity === 'serious' ? <Badge tone="danger">Serious</Badge> : null}
                  {i.parentToldAt ? <Badge tone="success">Parent told</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
