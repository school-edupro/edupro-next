import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { requestBus } from './actions';

interface Res {
  date: string;
  children: Array<{
    id: string;
    name: string;
    section: string | null;
    events: Array<{
      id: string;
      occurredAt: string;
      outcome: string;
      route: string | null;
      lat: string | null;
      lng: string | null;
    }>;
  }>;
}
interface Mine {
  children: Array<{
    id: string;
    name: string;
    section: string | null;
    assignment: {
      routeCode: string;
      routeName: string;
      stopName: string | null;
      pickupTime: string | null;
      dropTime: string | null;
    } | null;
    requests: Array<{
      id: string;
      kind: 'join' | 'change' | 'leave';
      routeCode: string | null;
      stopName: string | null;
      status: 'pending' | 'approved' | 'rejected' | 'cancelled';
      requestedAt: string;
      decisionNote: string | null;
    }>;
  }>;
  routes: Array<{
    id: string;
    code: string;
    name: string;
    stops: Array<{ id: string; name: string; pickupTime: string | null }>;
  }>;
}

const statusWord = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const;
const kindWord = {
  join: 'Request a seat',
  change: 'Change stop or route',
  leave: 'Leave the bus',
} as const;

/** S10: bus boarding and alighting of the family's children; S13: seat, stop and leave requests. */
export default async function TransportPage({
  searchParams,
}: {
  searchParams: Promise<{ requested?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let res: Res;
  let mine: Mine = { children: [], routes: [] };
  try {
    res = await bff.api.fetch<Res>('/attendance/bus/mine');
    mine = await bff.api.fetch<Mine>('/transport/requests/mine').catch(() => mine);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'School bus')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'School bus')}
        title={t(lang, 'Boarding and alighting')}
        description="Taps from the bus reader over the last seven days. You get a WhatsApp alert for each one unless you withdraw the transport consent in your profile."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.requested ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Request sent. The office will confirm.')}
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
      {mine.children.map((c) => (
        <Card
          key={`req-${c.id}`}
          title={`${t(lang, 'Bus seat request')} · ${c.name}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <p>
            <strong>{t(lang, 'Current bus')}:</strong>{' '}
            {c.assignment
              ? `${c.assignment.routeCode} ${c.assignment.routeName}${c.assignment.stopName ? ` · ${c.assignment.stopName}` : ''}${c.assignment.pickupTime ? ` · ${t(lang, 'Pickup')} ${c.assignment.pickupTime}` : ''}`
              : t(lang, 'Not on a bus this year')}
          </p>
          {c.requests.some((r) => r.status === 'pending') ? null : (
            <form action={requestBus} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
              <input type="hidden" name="studentId" value={c.id} />
              <label className="ep-field">
                <span className="ep-field__label">{t(lang, 'Request a seat')}</span>
                <select
                  className="ep-input"
                  name="kind"
                  defaultValue={c.assignment ? 'change' : 'join'}
                >
                  {(c.assignment ? (['change', 'leave'] as const) : (['join'] as const)).map(
                    (k) => (
                      <option key={k} value={k}>
                        {t(lang, kindWord[k])}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: '1fr 1fr' }}>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Route')}</span>
                  <select className="ep-input" name="routeId">
                    <option value="">—</option>
                    {mine.routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Stop')}</span>
                  <select className="ep-input" name="stopId">
                    <option value="">—</option>
                    {mine.routes.flatMap((r) =>
                      r.stops.map((s) => (
                        <option key={s.id} value={s.id}>
                          {r.code} · {s.name}
                          {s.pickupTime ? ` (${s.pickupTime})` : ''}
                        </option>
                      )),
                    )}
                  </select>
                </label>
              </div>
              <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: '1fr 2fr' }}>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'From')}</span>
                  <input className="ep-input" type="date" name="effectiveFrom" />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">{t(lang, 'Note for the office')}</span>
                  <input className="ep-input" name="note" maxLength={300} />
                </label>
              </div>
              <div>
                <Button type="submit">{t(lang, 'Send request')}</Button>
              </div>
            </form>
          )}
          {c.requests.length ? (
            <>
              <h4
                style={{ fontFamily: 'var(--font-heading)', margin: 'var(--sp-3) 0 var(--sp-2)' }}
              >
                {t(lang, 'Your requests')}
              </h4>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                {c.requests.map((r) => (
                  <li key={r.id}>
                    {new Date(r.requestedAt).toLocaleDateString('en-IN')} ·{' '}
                    {t(lang, kindWord[r.kind])}
                    {r.routeCode
                      ? ` · ${r.routeCode}${r.stopName ? ` · ${r.stopName}` : ''}`
                      : ''}{' '}
                    <Badge
                      tone={
                        r.status === 'approved'
                          ? 'success'
                          : r.status === 'rejected'
                            ? 'danger'
                            : r.status === 'pending'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {t(lang, statusWord[r.status])}
                    </Badge>
                    {r.decisionNote ? <small> · {r.decisionNote}</small> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ))}
      {res.children.map((c) => (
        <Card
          key={c.id}
          title={`${c.name}${c.section ? ` · ${c.section}` : ''}`}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {c.events.length === 0 ? (
            <p className="ep-field__help">No bus taps in the last week.</p>
          ) : (
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Route</th>
                  <th>Event</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {c.events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {new Date(e.occurredAt).toLocaleString('en-IN', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>{e.route ?? '—'}</td>
                    <td>
                      <Badge tone={e.outcome === 'boarded' ? 'success' : 'info'}>
                        {e.outcome === 'boarded' ? 'Boarded' : 'Got off'}
                      </Badge>
                    </td>
                    <td>
                      {e.lat && e.lng ? (
                        <a
                          href={`https://maps.google.com/?q=${e.lat},${e.lng}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          map
                        </a>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ))}
    </main>
  );
}
