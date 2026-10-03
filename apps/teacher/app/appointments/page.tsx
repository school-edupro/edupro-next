import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

type State = 'requested' | 'approved' | 'checked_in' | 'completed' | 'no_show';
interface Visit {
  id: string;
  number: string;
  state: State;
  startsAt: string;
  place: string | null;
  hostName: string | null;
  purpose: string;
  visitorName: string | null;
  visitorOrg: string | null;
  partySize: number;
  student: string | null;
  section: string | null;
}
const STATE: Record<State, [string, 'warning' | 'success' | 'info' | 'neutral' | 'danger']> = {
  requested: ['Waiting for the front desk', 'warning'],
  approved: ['Confirmed', 'success'],
  checked_in: ['Arrived', 'info'],
  completed: ['Completed', 'neutral'],
  no_show: ['Did not come', 'danger'],
};
const IST = 'Asia/Kolkata';
const dayOf = (v: string) =>
  new Date(v).toLocaleDateString('en-IN', {
    timeZone: IST,
    weekday: 'long',
    day: '2-digit',
    month: 'short',
  });
const timeOf = (v: string) =>
  new Date(v).toLocaleTimeString('en-IN', { timeZone: IST, hour: '2-digit', minute: '2-digit' });

/**
 * Appointments with me (0059): who is coming to meet this member of staff today and in the next 30 days.
 * The front desk confirms and moves appointments; the visitor's contact details stay with the front desk.
 */
export default async function MyAppointmentsPage() {
  const lang = await currentLang();
  let visits: Visit[];
  try {
    visits = (await bff.api.fetch<{ data: Visit[] }>('/appointments/with-me')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const days = [...new Set(visits.map((v) => dayOf(v.startsAt)))];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Appointments')}
        title={t(lang, 'Appointments with me')}
        description={t(
          lang,
          'Today and the next 30 days. The front desk confirms and moves appointments.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {visits.length === 0 ? (
        <Card>{t(lang, 'Nobody has an appointment with you in the next 30 days.')}</Card>
      ) : null}
      {days.map((day) => (
        <Card key={day} title={day} style={{ marginBottom: 'var(--sp-3)' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {visits
              .filter((v) => dayOf(v.startsAt) === day)
              .map((v) => (
                <li
                  key={v.id}
                  style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}
                  >
                    <strong>
                      {timeOf(v.startsAt)} · {v.visitorName ?? t(lang, 'Visitor')}
                      {v.partySize > 1 ? ` + ${String(v.partySize - 1)}` : ''}
                    </strong>
                    <Badge tone={STATE[v.state][1]}>{t(lang, STATE[v.state][0])}</Badge>
                  </div>
                  <div>{v.purpose}</div>
                  <div className="ep-field__help">
                    {[
                      v.number,
                      v.student ? `${v.student}${v.section ? ` (${v.section})` : ''}` : null,
                      v.visitorOrg,
                      v.place,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </main>
  );
}
