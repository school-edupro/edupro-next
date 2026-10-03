import { Badge, Card, PageHeader } from '@edupro/ui';
import { AppointmentNav } from '@/components/appointments/AppointmentNav';
import { apiFetch, getMe } from '@/lib/api';
import {
  STATE_LABEL,
  STATE_TONE,
  dayLabel,
  dayOf,
  timeOf,
  type AppointmentState,
} from '@/lib/appointments';

interface Visit {
  id: string;
  number: string;
  state: AppointmentState;
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

/**
 * My appointments: who is coming to meet me (the principal, a teacher, any member of staff), today and in
 * the next 30 days. Only what the front desk has confirmed shows here; the front desk confirms, moves and
 * cancels, and keeps the visitor's contact details.
 */
export default async function MyAppointmentsPage() {
  const [me, list] = await Promise.all([
    getMe(),
    apiFetch<{ data: Visit[] }>('/appointments/with-me'),
  ]);
  const days = [...new Set(list.data.map((v) => dayOf(v.startsAt)))];
  return (
    <>
      <PageHeader
        kicker="Appointments"
        title="My appointments"
        description="Confirmed appointments with you, today and the next 30 days. The front desk confirms and moves them."
      />
      <AppointmentNav current="/engagement/appointments/mine" permissions={me.permissions} />
      {list.data.length === 0 ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nobody has a confirmed appointment with you in the next 30 days.
          </p>
        </Card>
      ) : null}
      {days.map((day) => (
        <Card key={day} title={dayLabel(day)} style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={dayLabel(day)}>
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Appointments with me on {dayLabel(day)}</caption>
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Visitor</th>
                  <th scope="col">Purpose</th>
                  <th scope="col">Where</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data
                  .filter((v) => dayOf(v.startsAt) === day)
                  .map((v) => (
                    <tr key={v.id}>
                      <td>{timeOf(v.startsAt)}</td>
                      <td>
                        {v.visitorName ?? 'Visitor'}
                        {v.partySize > 1 ? ` + ${String(v.partySize - 1)}` : ''}
                        <div className="ep-field__help">
                          {[
                            v.number,
                            v.student ? `${v.student}${v.section ? ` (${v.section})` : ''}` : null,
                            v.visitorOrg,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </td>
                      <td>{v.purpose}</td>
                      <td>{v.place ?? v.hostName ?? '—'}</td>
                      <td>
                        <Badge tone={STATE_TONE[v.state]}>{STATE_LABEL[v.state]}</Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
