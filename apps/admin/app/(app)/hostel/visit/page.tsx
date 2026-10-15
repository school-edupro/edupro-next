import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { VisitPhoto } from '@/components/hostel/VisitPhoto';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';
import { registerHostelVisit } from '@/lib/hostel-actions';

interface Hit {
  id: string;
  name: string;
  admissionNo: string;
  hostel: string;
  room: string;
}
interface Check {
  pupil: { id: string; name: string; admissionNo: string };
  hostel: { id: string; name: string };
  inHours: boolean;
  hours: string;
  listed: boolean;
  list: {
    onRecord: Array<{ name: string; relation: string; mobile: string | null }>;
    approved: Array<{
      id: string;
      name: string;
      relation: string;
      mobile: string;
      hasPhoto: boolean;
    }>;
  };
}

/**
 * The gate: a visitor for a boarder. Find the pupil, see who is on the approved list and whether visiting
 * hours are on, then register the visitor — let in at once when listed and in hours, else wait for the warden.
 */
export default async function HostelVisitGatePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    student?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 60);
  const studentId = /^\d{1,18}$/.test(sp.student ?? '') ? sp.student! : '';
  const [hits, check] = await Promise.all([
    q.length >= 2
      ? apiFetch<{ data: Hit[] }>(`/hostel/visits/boarders?q=${encodeURIComponent(q)}`).then(
          (r) => r.data,
        )
      : Promise.resolve([] as Hit[]),
    studentId
      ? apiFetch<Check>(`/hostel/visits/check?studentId=${studentId}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const here = `/hostel/visit?${new URLSearchParams({ ...(q ? { q } : {}), ...(studentId ? { student: studentId } : {}) }).toString()}`;
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Hostel visitor at the gate"
        description="Find the boarder the visitor has come to meet. People on the approved list are let in during visiting hours; anyone else waits for the warden, and the parent is told."
      />
      <Notice params={sp} />
      <Card title="1. The boarder" style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-hd__row">
          <label className="ep-field" htmlFor="gv-q">
            <span className="ep-field__label">Name or admission no.</span>
            <input
              id="gv-q"
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
        {q.length >= 2 ? (
          hits.length ? (
            <ul className="fp-rcpts" style={{ marginTop: 'var(--sp-3)' }}>
              {hits.map((x) => (
                <li key={x.id}>
                  <span>
                    <strong>{x.name}</strong>{' '}
                    <span className="ep-field__help">
                      {x.admissionNo} · {x.hostel} · Room {x.room}
                    </span>
                  </span>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/hostel/visit?q=${encodeURIComponent(q)}&student=${x.id}`}
                  >
                    Choose
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help">No boarder matches “{q}”.</p>
          )
        ) : null}
      </Card>
      {check ? (
        <>
          <Card
            title={`2. ${check.pupil.name} · ${check.hostel.name}`}
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            {check.inHours ? (
              <Alert tone="success">Visiting hours are on ({check.hours}).</Alert>
            ) : (
              <Alert tone="warning">
                Outside visiting hours ({check.hours}): the visitor waits for the warden.
              </Alert>
            )}
            <h3 className="hs-h" style={{ margin: 'var(--sp-3) 0 var(--sp-2)' }}>
              Approved list
            </h3>
            <ul className="fp-rcpts">
              {check.list.onRecord.map((g) => (
                <li key={`r-${g.relation}-${g.mobile ?? ''}`}>
                  <span>
                    <strong>{g.name}</strong>{' '}
                    <span className="ep-field__help">
                      {g.relation} · {g.mobile ?? '—'}
                    </span>
                  </span>
                  <Badge tone="success">On the school record</Badge>
                </li>
              ))}
              {check.list.approved.map((v) => (
                <li key={v.id}>
                  <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                    {v.hasPhoto ? (
                      <img
                        src={`/api/hostel/photo/visitor/${v.id}`}
                        alt={v.name}
                        width={56}
                        height={56}
                        style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                      />
                    ) : null}
                    <span>
                      <strong>{v.name}</strong>{' '}
                      <span className="ep-field__help">
                        {v.relation} · {v.mobile}
                      </span>
                    </span>
                  </span>
                  <Badge tone="success">Approved</Badge>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="3. The visitor">
            <form action={registerHostelVisit} className="hs-form" style={{ maxWidth: '40rem' }}>
              <input type="hidden" name="studentId" value={check.pupil.id} />
              <input type="hidden" name="returnTo" value={here} />
              <label className="ep-field" htmlFor="gv-name">
                <span className="ep-field__label">Visitor’s name *</span>
                <input
                  id="gv-name"
                  name="visitorName"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={120}
                />
              </label>
              <label className="ep-field" htmlFor="gv-mob">
                <span className="ep-field__label">Mobile *</span>
                <input
                  id="gv-mob"
                  name="mobile"
                  className="ep-input"
                  required
                  inputMode="numeric"
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                />
                <span className="ep-field__help">Matched with the approved list.</span>
              </label>
              <label className="ep-field" htmlFor="gv-rel">
                <span className="ep-field__label">Relation to the pupil *</span>
                <input
                  id="gv-rel"
                  name="relation"
                  className="ep-input"
                  required
                  minLength={2}
                  maxLength={60}
                />
              </label>
              <label className="ep-field" htmlFor="gv-size">
                <span className="ep-field__label">How many people</span>
                <input
                  id="gv-size"
                  name="partySize"
                  type="number"
                  min={1}
                  max={20}
                  className="ep-input"
                  defaultValue={1}
                />
              </label>
              <label className="ep-field" htmlFor="gv-id">
                <span className="ep-field__label">ID seen</span>
                <input
                  id="gv-id"
                  name="idProofKind"
                  className="ep-input"
                  maxLength={40}
                  placeholder="e.g. Aadhaar"
                />
              </label>
              <VisitPhoto />
              <div>
                <Button type="submit">Register the visitor</Button>
              </div>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
