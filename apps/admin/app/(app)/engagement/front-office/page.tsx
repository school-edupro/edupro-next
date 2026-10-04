import { Badge, Card, PageHeader } from '@edupro/ui';
import { apiFetch, getMe } from '@/lib/api';
import { when, type AppointmentDashboard } from '@/lib/appointments';
import { KIND_LABEL, whoOfPass, type GatePass, type PassCounts } from '@/lib/gate-passes';

interface PassDashboard {
  counts: PassCounts;
  overdue: number;
  studentsToday: number;
  staffToday: number;
  rejectedToday: number;
  itemsDue: number;
  outNow: GatePass[];
}
interface VisitorCounts {
  counts: { inside: number; waiting: number; today: number; peopleInside: number };
}
type Kpi = [title: string, n: number, help: string, href: string];

const Kpis = ({ items }: { items: Kpi[] }) => (
  <div className="ep-cdash__kpis">
    {items.map(([title, n, help, href]) => (
      <Card key={title} title={title}>
        <div className="ep-cdash__big">
          <a className="ep-cdash__num" href={href} aria-label={`${title}: ${String(n)}`}>
            {n.toLocaleString('en-IN')}
          </a>
        </div>
        <div className="ep-field__help">{help}</div>
      </Card>
    ))}
  </div>
);

/**
 * One dashboard for the front office and the gate: appointments, gate passes and walk-in visitors
 * together. Each person sees the parts of their role (front desk, gate, admin), and everyone sees what
 * waits on them: gate passes to approve and today's appointments with them.
 */
export default async function FrontOfficeDashboardPage() {
  const me = await getMe();
  const may = (code: string) => me.permissions.includes(code);
  const [appts, passes, visitors, inbox, withMe] = await Promise.all([
    may('engagement.appointment.view')
      ? apiFetch<AppointmentDashboard>('/appointments/dashboard').catch(() => null)
      : null,
    may('engagement.gate_pass.view')
      ? apiFetch<PassDashboard>('/gate-passes/dashboard').catch(() => null)
      : null,
    may('engagement.visitor.manage')
      ? apiFetch<VisitorCounts>('/visitors?state=inside&size=5').catch(() => null)
      : null,
    apiFetch<{ data: GatePass[] }>('/gate-passes/inbox').catch(() => ({ data: [] })),
    apiFetch<{ counts: { today: number; upcoming: number } }>(
      '/appointments/with-me?when=today&size=5',
    ).catch(() => ({ counts: { today: 0, upcoming: 0 } })),
  ]);
  return (
    <>
      <PageHeader
        kicker="Front office and gate"
        title="Dashboard"
        description="Appointments, gate passes and visitors in one place. The numbers open the lists behind them."
      />
      <h2 className="ep-cdash__h3">Waiting on you</h2>
      <Kpis
        items={[
          [
            'Gate passes to approve',
            inbox.data.length,
            'waiting for your approval',
            '/engagement/gate-passes/approvals',
          ],
          [
            'Appointments with you today',
            withMe.counts.today,
            `${String(withMe.counts.upcoming)} still to come in all`,
            '/engagement/appointments/mine?when=today',
          ],
        ]}
      />
      {appts ? (
        <>
          <h2 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-5)' }}>
            Appointments
          </h2>
          <Kpis
            items={[
              [
                'Appointments today',
                appts.today.total,
                `${String(appts.today.expected)} still expected · ${String(appts.today.done)} done · ${String(appts.today.noShow)} did not come`,
                '/engagement/appointments?state=today',
              ],
              [
                'Requests waiting',
                appts.waiting,
                appts.waitingLong
                  ? `${String(appts.waitingLong)} waiting over 4 hours`
                  : 'for the front desk to decide',
                '/engagement/appointments?state=open',
              ],
              [
                'Appointment visitors inside',
                appts.today.inside,
                'checked in, not out yet',
                '/engagement/appointments?state=checked_in',
              ],
            ]}
          />
          <p className="ep-field__help">
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href="/engagement/appointments/dashboard"
            >
              Appointment trends: the week ahead and six months
            </a>
          </p>
        </>
      ) : null}
      {passes ? (
        <>
          <h2 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-5)' }}>
            Gate passes
          </h2>
          <Kpis
            items={[
              [
                'Waiting for approval',
                passes.counts.approval,
                'with the class teacher, coordinator, vice principal or principal',
                '/engagement/gate-passes?stage=approval',
              ],
              [
                'To hand over',
                passes.counts.handover,
                'approved: the child is collected at the front desk',
                '/engagement/gate-passes?stage=handover',
              ],
              [
                'At the gate',
                passes.counts.gate,
                'handed over or approved, not yet out',
                '/engagement/gate-passes?stage=gate',
              ],
              [
                'Staff out, to come back',
                passes.counts.out,
                passes.overdue
                  ? `${String(passes.overdue)} past the return time`
                  : 'on a returnable pass (RGP)',
                '/engagement/gate-passes?stage=out',
              ],
              [
                'Gate passes today',
                passes.counts.today,
                `${String(passes.studentsToday)} pupils · ${String(passes.staffToday)} staff · ${String(passes.rejectedToday)} not approved`,
                '/engagement/gate-passes?stage=today',
              ],
              [
                'Items not back',
                passes.itemsDue,
                'returnable equipment still outside',
                '/engagement/gate-passes?stage=all&audience=staff',
              ],
            ]}
          />
          {passes.outNow.length ? (
            <Card title="Out now and due back" style={{ marginTop: 'var(--sp-4)' }}>
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Out now">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Staff out on a returnable pass</caption>
                  <thead>
                    <tr>
                      <th scope="col">Pass</th>
                      <th scope="col">Employee</th>
                      <th scope="col">Out</th>
                      <th scope="col">Back by</th>
                      <th scope="col">Items not back</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passes.outNow.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <a href={`/engagement/gate-passes/${p.id}`}>{p.number}</a>
                          <div className="ep-field__help">{KIND_LABEL[p.kind]}</div>
                        </td>
                        <td>{whoOfPass(p)}</td>
                        <td>{p.outAt ? when(p.outAt) : '—'}</td>
                        <td>
                          {p.returnBy ? when(p.returnBy) : '—'}{' '}
                          {p.returnBy && new Date(p.returnBy).getTime() < Date.now() ? (
                            <Badge tone="danger">Late</Badge>
                          ) : null}
                        </td>
                        <td>{p.itemsDue || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
      {visitors ? (
        <>
          <h2 className="ep-cdash__h3" style={{ marginTop: 'var(--sp-5)' }}>
            Visitors
          </h2>
          <Kpis
            items={[
              [
                'Visitors inside now',
                visitors.counts.inside,
                `${String(visitors.counts.peopleInside)} people in the campus`,
                '/engagement/visitors?state=inside',
              ],
              [
                'Waiting at the gate',
                visitors.counts.waiting,
                'registered on their own phone, not let in yet',
                '/engagement/visitors?state=waiting',
              ],
              [
                'Visitors today',
                visitors.counts.today,
                'walk-ins and appointment visitors',
                '/engagement/visitors?state=today',
              ],
            ]}
          />
        </>
      ) : null}
    </>
  );
}
