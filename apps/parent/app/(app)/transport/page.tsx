import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { chosenChild } from '@/lib/child';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { cancelTransportRequest } from './actions';

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
interface Period {
  id: string;
  service: 'pick' | 'drop' | 'both';
  serviceLabel: string;
  pickRoute: string | null;
  pickStop: string | null;
  pickTime: string | null;
  dropRoute: string | null;
  dropStop: string | null;
  dropTime: string | null;
  vehicle: string | null;
  slab: string | null;
  monthlyAmount: number;
  fromMonth: string;
  toMonth: string;
  status: string;
  phase: 'running' | 'upcoming' | 'over' | 'cancelled';
}
interface Mine {
  children: Array<{
    id: string;
    name: string;
    section: string | null;
    current: Period | null;
    periods: Period[];
    requests: Array<{
      id: string;
      number: string;
      kind: 'join' | 'change' | 'leave';
      kindLabel: string;
      what: string;
      monthlyAmount: number | null;
      status: 'pending' | 'approved' | 'rejected' | 'cancelled';
      waitingOn: string | null;
      requestedAt: string;
      decisionNote: string | null;
    }>;
  }>;
  canApply: boolean;
}

const statusWord = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
} as const;
const phaseWord = {
  running: 'Riding now',
  upcoming: 'To start',
  over: 'Over',
  cancelled: 'Cancelled',
} as const;
const phaseTone = {
  running: 'success',
  upcoming: 'info',
  over: 'neutral',
  cancelled: 'danger',
} as const;
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const rideLines = (p: Period): string[] =>
  [
    p.service !== 'drop' && p.pickStop
      ? `Pick: ${p.pickStop} · ${p.pickRoute ?? ''}${p.pickTime ? ` · ${p.pickTime}` : ''}`
      : null,
    p.service !== 'pick' && p.dropStop
      ? `Drop: ${p.dropStop} · ${p.dropRoute ?? ''}${p.dropTime ? ` · ${p.dropTime}` : ''}`
      : null,
  ].filter((x): x is string => Boolean(x));
interface Track {
  children: Array<{
    student: { id: string; name: string };
    route: { code: string; name: string; stop: string | null; pickup: string | null } | null;
    vehicle: { id: string; regNo: string } | null;
    position: {
      recordedAt: string;
      lat: string;
      lng: string;
      speedKmh: string | null;
      ageSeconds: number;
    } | null;
  }>;
}

/**
 * School transport for the family: the live bus, each child's transport as approved (service, stoppages,
 * slab and charge, and until which month it runs), the request to start, change or stop it, the history,
 * and the taps from the bus reader.
 */
export default async function TransportPage({
  searchParams,
}: {
  searchParams: Promise<{
    requested?: string;
    cancelled?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let res: Res;
  let mine: Mine = { children: [], canApply: false };
  let track: Track = { children: [] };
  try {
    res = await bff.api.fetch<Res>('/attendance/bus/mine');
    mine = await bff.api.fetch<Mine>('/transport/requests/mine').catch(() => mine);
    track = await bff.api.fetch<Track>('/transport/gps/mine').catch(() => track);
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
  const kid = await chosenChild();
  const mineOf = <T,>(list: T[], id: (x: T) => string) =>
    list.filter((x) => !kid || id(x) === kid.id);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'School bus')}
        title={t(lang, 'Transport')}
        description="The live bus, your child’s transport and its history, and the taps from the bus reader over the last seven days. You get a WhatsApp alert for each tap unless you withdraw the transport consent in your profile."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      <ChildSwitch lang={lang} back="/transport" />
      {sp.requested ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Request sent. The transport office and the fee department will approve it.')}
        </div>
      ) : null}
      {sp.cancelled ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Request cancelled.')}
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
      {mineOf(track.children, (c) => c.student.id)
        .filter((c) => c.route)
        .map((c) => (
          <Card
            key={`bus-${c.student.id}`}
            title={`${t(lang, 'Live bus')} · ${c.student.name}`}
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            <div className="ep-kicker">
              {c.route!.code} · {c.route!.name}
              {c.route!.stop ? ` · ${c.route!.stop}` : ''}
              {c.route!.pickup ? ` · ${c.route!.pickup}` : ''}
            </div>
            {c.position ? (
              <p style={{ margin: 'var(--sp-2) 0 0' }}>
                <strong>{c.vehicle?.regNo}</strong> · {t(lang, 'seen')}{' '}
                {Math.round(c.position.ageSeconds / 60)} {t(lang, 'min ago')}
                {c.position.speedKmh ? ` · ${c.position.speedKmh} km/h` : ''} ·{' '}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${c.position.lat}&mlon=${c.position.lng}#map=16/${c.position.lat}/${c.position.lng}`}
                  target="_blank"
                  style={{ textDecoration: 'underline' }}
                  rel="noreferrer"
                >
                  {t(lang, 'Open map')}
                </a>
              </p>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
                {t(lang, 'No position from the bus yet.')}
              </p>
            )}
          </Card>
        ))}
      {mineOf(mine.children, (c) => c.id).map((c) => {
        const pending = c.requests.find((r) => r.status === 'pending') ?? null;
        const next = c.periods.find((p) => p.phase === 'upcoming') ?? null;
        // cut short by a withdrawal: the bus stays until the end of that month
        const stops = c.current?.status === 'ended' && !next;
        return (
          <Card
            key={`req-${c.id}`}
            title={`${t(lang, 'Transport')} · ${c.name}`}
            actions={
              mine.canApply && !pending ? (
                <a
                  className="ep-btn ep-btn--primary ep-btn--sm"
                  href={`/transport/apply?student=${c.id}`}
                >
                  {c.current || next ? t(lang, 'Change or stop') : t(lang, 'Apply for transport')}
                </a>
              ) : null
            }
            style={{ marginBottom: 'var(--sp-3)' }}
          >
            {c.current ? (
              <>
                <p style={{ marginTop: 0 }}>
                  <strong>{c.current.serviceLabel}</strong> · {c.current.slab ?? ''}{' '}
                  {rupees(c.current.monthlyAmount)} {t(lang, 'a month')} ·{' '}
                  {t(lang, 'valid until the end of')}{' '}
                  <strong>{monthLabel(c.current.toMonth)}</strong>
                </p>
                {rideLines(c.current).map((l) => (
                  <div key={l} className="ep-field__help">
                    {l}
                    {c.current!.vehicle ? ` · ${c.current!.vehicle}` : ''}
                  </div>
                ))}
                {stops ? (
                  <p className="ep-field__help">
                    {t(
                      lang,
                      'The route, the stoppage and the live bus position stay here until then.',
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <p style={{ marginTop: 0 }}>{t(lang, 'Not on a bus this month.')}</p>
            )}
            {next ? (
              <p className="ep-field__help">
                {t(lang, 'From')} {monthLabel(next.fromMonth)}: {next.serviceLabel} ·{' '}
                {rideLines(next).join(' · ')} · {rupees(next.monthlyAmount)} {t(lang, 'a month')}
              </p>
            ) : null}
            {pending ? (
              <div
                className="ep-alert ep-alert--info"
                role="status"
                style={{ marginTop: 'var(--sp-3)' }}
              >
                <strong>{pending.number}</strong> · {pending.what}
                {pending.monthlyAmount !== null ? ` · ${rupees(pending.monthlyAmount)}` : ''} ·{' '}
                {t(lang, 'waiting with')} {pending.waitingOn ?? t(lang, 'the school')}
                <form action={cancelTransportRequest} style={{ marginTop: 'var(--sp-2)' }}>
                  <input type="hidden" name="id" value={pending.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    {t(lang, 'Cancel this request')}
                  </Button>
                </form>
              </div>
            ) : null}
            {c.periods.length ? (
              <>
                <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
                  {t(lang, 'Transport history')}
                </h3>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label={`${t(lang, 'Transport history')} · ${c.name}`}
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">
                      {t(lang, 'Transport history')} · {c.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{t(lang, 'Months')}</th>
                        <th scope="col">{t(lang, 'Service and stoppage')}</th>
                        <th scope="col">{t(lang, 'Monthly')}</th>
                        <th scope="col">{t(lang, 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.periods.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {monthLabel(p.fromMonth)} – {monthLabel(p.toMonth)}
                          </td>
                          <td>
                            {p.serviceLabel}
                            {rideLines(p).map((l) => (
                              <div key={l} className="ep-field__help">
                                {l}
                              </div>
                            ))}
                          </td>
                          <td>
                            {rupees(p.monthlyAmount)}
                            {p.slab ? <div className="ep-field__help">{p.slab}</div> : null}
                          </td>
                          <td>
                            <Badge tone={phaseTone[p.phase]}>{t(lang, phaseWord[p.phase])}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {c.requests.length ? (
              <>
                <h3 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-4)' }}>
                  {t(lang, 'Your requests')}
                </h3>
                <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
                  {c.requests.map((r) => (
                    <li key={r.id}>
                      {new Date(r.requestedAt).toLocaleDateString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                      })}{' '}
                      · {r.number} · {r.what}{' '}
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
        );
      })}
      {mineOf(res.children, (c) => c.id).map((c) => (
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
                          style={{ textDecoration: 'underline' }}
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
