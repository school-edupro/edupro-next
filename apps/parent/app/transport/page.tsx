import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

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

/** S10: bus boarding and alighting of the family's children over the last week. */
export default async function TransportPage() {
  let res: Res;
  try {
    res = await bff.api.fetch<Res>('/attendance/bus/mine');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="School bus" />
          <Card>
            Your account is not linked to a student yet. Please contact the school office.
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="School bus"
        title="Boarding and alighting"
        description="Taps from the bus reader over the last seven days. You get a WhatsApp alert for each one unless you withdraw the transport consent in your profile."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
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
