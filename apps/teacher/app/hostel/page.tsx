import { Badge, Card, KpiTile, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { decideVisit, decideVisitor } from './actions';

interface Today {
  boarders: number;
  away: number;
  overdue: number;
  toHandOver: number;
  waiting: number;
  sessions: number;
  rollsTaken: number;
  absentToday: number;
}
interface Session {
  id: string;
  hostel: string;
  name: string;
  atTime: string;
  active: boolean;
  takenToday: string | null;
}
interface Leave {
  id: string;
  number: string;
  kind: 'hostel_home' | 'hostel_outing';
  state: string;
  name: string;
  admissionNo: string;
  hostel: string | null;
  onDate: string;
  atTime: string | null;
  returnBy: string | null;
  outAt: string | null;
  reason: string;
  escortName: string | null;
  escortRelation: string | null;
  overdue: boolean;
}

interface Visit {
  id: string;
  number: string;
  visitorName: string;
  mobile: string | null;
  purpose: string;
  pupil: string;
  hostel: string;
  listed: boolean;
  inHours: boolean;
  createdAt: string;
  hasPhoto: boolean;
}
interface Visitor {
  id: string;
  pupil: string;
  admissionNo: string;
  name: string;
  relation: string;
  mobile: string;
  hasPhoto: boolean;
}
interface Complaint {
  id: string;
  number: string;
  status: string;
  subject: string;
  head: string;
  room: string | null;
  pupil: string | null;
  openedAt: string;
  overdue: boolean;
}
interface Meal {
  id: string;
  hostelId: string;
  hostel: string;
  name: string;
  atTime: string;
  active: boolean;
  markedToday: string | null;
}

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
const KIND = { hostel_home: 'Home leave', hostel_outing: 'Outing' } as const;

/** The warden's hostel desk: today in numbers, the roll-call sessions, and the leave to act on. */
export default async function HostelDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; detail?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let today: Today;
  let sessions: Session[];
  let pending: Leave[];
  let handover: Leave[];
  let away: Leave[];
  let visits: Visit[];
  let visitors: Visitor[];
  let meals: Meal[];
  let complaints: Complaint[];
  try {
    [today, sessions, pending, handover, away, visits, visitors, meals, complaints] =
      await Promise.all([
        bff.api.fetch<Today>('/hostel/today'),
        bff.api
          .fetch<{ data: Session[] }>('/hostel/sessions')
          .then((r) => r.data.filter((s) => s.active)),
        bff.api.fetch<{ data: Leave[] }>('/hostel/leaves?show=pending').then((r) => r.data),
        bff.api.fetch<{ data: Leave[] }>('/hostel/leaves?show=handover').then((r) => r.data),
        bff.api.fetch<{ data: Leave[] }>('/hostel/leaves?show=out').then((r) => r.data),
        bff.api
          .fetch<{ data: Visit[] }>('/hostel/visits?show=waiting')
          .then((r) => r.data)
          .catch(() => [] as Visit[]),
        bff.api
          .fetch<{ data: Visitor[] }>('/hostel/visitors?status=pending')
          .then((r) => r.data)
          .catch(() => [] as Visitor[]),
        bff.api
          .fetch<{ data: Meal[] }>('/hostel/meals')
          .then((r) => r.data.filter((m) => m.active))
          .catch(() => [] as Meal[]),
        bff.api
          .fetch<{ data: Complaint[] }>('/hostel/complaints?show=open')
          .then((r) => r.data)
          .catch(() => [] as Complaint[]),
      ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Hostel')}
        title={t(lang, 'Hostel desk')}
        description={t(
          lang,
          'Roll-call, leave waiting for you, pupils to hand over and pupils away.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail ?? t(lang, 'Saved.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <div className="ep-kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        <KpiTile label={t(lang, 'Boarders')} value={String(today.boarders)} />
        <KpiTile label={t(lang, 'Away on leave')} value={String(today.away)} />
        <KpiTile label={t(lang, 'Overdue')} value={String(today.overdue)} />
        <KpiTile label={t(lang, 'Absent at roll-call today')} value={String(today.absentToday)} />
      </div>

      {visits.length ? (
        <Card
          title={`${t(lang, 'Visitors waiting at the gate')} (${String(visits.length)})`}
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          <ul className="fp-rcpts">
            {visits.map((v) => (
              <li key={v.id}>
                <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                  {v.hasPhoto ? (
                    <img
                      src={`/hostel/photo/visit/${v.id}`}
                      alt={v.visitorName}
                      width={56}
                      height={56}
                      style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                    />
                  ) : null}
                  <span>
                    <strong>{v.visitorName}</strong> → {v.pupil}
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {v.purpose} · {v.mobile ?? '—'} · {when(v.createdAt)}
                    </span>
                    <span style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                      {v.listed ? null : (
                        <Badge tone="danger">{t(lang, 'Not on the approved list')}</Badge>
                      )}
                      {v.inHours ? null : (
                        <Badge tone="warning">{t(lang, 'Outside visiting hours')}</Badge>
                      )}
                    </span>
                  </span>
                </span>
                <form
                  action={decideVisit}
                  style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                >
                  <input type="hidden" name="id" value={v.id} />
                  <button
                    type="submit"
                    name="outcome"
                    value="allowed"
                    className="ep-btn ep-btn--primary ep-btn--sm"
                  >
                    {t(lang, 'Allow in')}
                  </button>
                  <button
                    type="submit"
                    name="outcome"
                    value="refused"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                  >
                    {t(lang, 'Refuse')}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title={t(lang, 'Roll-call')} style={{ marginBottom: 'var(--sp-4)' }}>
        {sessions.length === 0 ? (
          <p className="ep-field__help">
            {t(lang, 'No roll-call sessions are set up for your hostel. Ask the hostel office.')}
          </p>
        ) : (
          <ul className="fp-rcpts">
            {sessions.map((s) => (
              <li key={s.id}>
                <span>
                  <strong>
                    {s.name} · {s.atTime}
                  </strong>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {s.hostel}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  {s.takenToday ? (
                    <Badge tone="success">{t(lang, 'Taken')}</Badge>
                  ) : (
                    <Badge tone="warning">{t(lang, 'Not taken')}</Badge>
                  )}
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/hostel/rollcall?sessionId=${s.id}`}
                  >
                    {s.takenToday ? t(lang, 'Open') : t(lang, 'Take the roll')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={`${t(lang, 'Leave waiting for you')} (${String(pending.length)})`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {pending.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'Nothing is waiting.')}</p>
        ) : (
          <>
            <ul className="fp-rcpts">
              {pending.map((l) => (
                <li key={l.id}>
                  <span>
                    <strong>{l.name}</strong> <Badge tone="info">{t(lang, KIND[l.kind])}</Badge>
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {l.onDate}
                      {l.atTime ? ` ${l.atTime}` : ''} → {when(l.returnBy)} · {l.reason}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p style={{ marginTop: 'var(--sp-3)' }}>
              <a className="ep-btn ep-btn--primary ep-btn--sm" href="/gate-passes">
                {t(lang, 'Approve or reject')}
              </a>
            </p>
          </>
        )}
      </Card>

      <Card
        title={`${t(lang, 'To hand over today')} (${String(handover.length)})`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {handover.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No home leave to hand over today.')}</p>
        ) : (
          <ul className="fp-rcpts">
            {handover.map((l) => (
              <li key={l.id}>
                <span>
                  <strong>{l.name}</strong> · {l.number}
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {t(lang, 'Collected by')} {l.escortName ?? '—'}
                    {l.escortRelation ? ` (${l.escortRelation})` : ''} · {t(lang, 'back by')}{' '}
                    {when(l.returnBy)}
                  </span>
                </span>
                <a className="ep-btn ep-btn--primary ep-btn--sm" href={`/hostel/handover/${l.id}`}>
                  {t(lang, 'Hand over')}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`${t(lang, 'Away now')} (${String(away.length)})`}>
        {away.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'Every boarder is in.')}</p>
        ) : (
          <ul className="fp-rcpts">
            {away.map((l) => (
              <li key={l.id}>
                <span>
                  <strong>{l.name}</strong> <Badge tone="neutral">{t(lang, KIND[l.kind])}</Badge>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {t(lang, 'Out')} {when(l.outAt)} · {t(lang, 'back by')} {when(l.returnBy)}
                  </span>
                </span>
                {l.overdue ? <Badge tone="danger">{t(lang, 'Overdue')}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card
        title={t(lang, 'Mess today')}
        style={{ marginTop: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}
      >
        {meals.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No meals are set up for your hostel.')}</p>
        ) : (
          <ul className="fp-rcpts">
            {meals.map((m) => (
              <li key={m.id}>
                <span>
                  <strong>
                    {t(lang, m.name)} · {m.atTime}
                  </strong>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {m.hostel}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  {m.markedToday ? <Badge tone="success">{t(lang, 'Marked')}</Badge> : null}
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/hostel/meal?mealId=${m.id}`}
                  >
                    {t(lang, 'Who skipped')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
        {meals.length ? (
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/hostel/diets?hostelId=${meals[0]!.hostelId}`}
            >
              {t(lang, 'Diet list for the kitchen')}
            </a>
          </p>
        ) : null}
      </Card>

      <Card
        title={`${t(lang, 'Open complaints')} (${String(complaints.length)})`}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        {complaints.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No open complaint.')}</p>
        ) : (
          <ul className="fp-rcpts">
            {complaints.map((c) => (
              <li key={c.id}>
                <span>
                  <strong>{c.subject}</strong>{' '}
                  <span className="ep-field__help">
                    {c.number} · {c.head}
                  </span>
                  <span className="ep-field__help" style={{ display: 'block' }}>
                    {c.room ? `${t(lang, 'Room')} ${c.room}` : ''}
                    {c.pupil ? ` · ${c.pupil}` : ''} · {when(c.openedAt)}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  {c.overdue ? <Badge tone="danger">{t(lang, 'Late')}</Badge> : null}
                  <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`/queries/t/${c.id}`}>
                    {t(lang, 'Answer')}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`${t(lang, 'Visitors to approve')} (${String(visitors.length)})`}>
        {visitors.length === 0 ? (
          <p className="ep-field__help">{t(lang, 'No visitor is waiting for approval.')}</p>
        ) : (
          <ul className="fp-rcpts">
            {visitors.map((v) => (
              <li key={v.id}>
                <span style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                  {v.hasPhoto ? (
                    <img
                      src={`/hostel/photo/visitor/${v.id}`}
                      alt={v.name}
                      width={48}
                      height={48}
                      style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                    />
                  ) : null}
                  <span>
                    <strong>{v.name}</strong> ({v.relation}) · {v.mobile}
                    <span className="ep-field__help" style={{ display: 'block' }}>
                      {t(lang, 'for')} {v.pupil} · {v.admissionNo}
                    </span>
                  </span>
                </span>
                <form
                  action={decideVisitor}
                  style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
                >
                  <input type="hidden" name="id" value={v.id} />
                  <button
                    type="submit"
                    name="outcome"
                    value="approved"
                    className="ep-btn ep-btn--primary ep-btn--sm"
                  >
                    {t(lang, 'Approve')}
                  </button>
                  <button
                    type="submit"
                    name="outcome"
                    value="rejected"
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                  >
                    {t(lang, 'Reject')}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
