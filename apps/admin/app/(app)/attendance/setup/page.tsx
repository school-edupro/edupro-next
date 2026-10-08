import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { AttendanceSetupForm } from '@/components/attendance/AttendanceSetupForm';
import { LeaveSetupForm } from '@/components/attendance/LeaveSetupForm';
import { RouteTeachersPanel } from '@/components/attendance/RouteTeachersPanel';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { reopenAttendance } from '@/lib/attendance-actions';
import { istToday, type AttendanceSetup, type LeaveSetup } from '@/lib/attendance-plus';
import { when } from '@/lib/appointments';

interface AbsentTemplate {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  active: boolean;
  reference: string | null;
}
interface AbsentTemplates {
  code: string;
  variables: string[];
  whatsapp: AbsentTemplate | null;
  sms: AbsentTemplate | null;
  email: AbsentTemplate | null;
  emailFallback: { subject: string; body: string };
}

/**
 * Attendance set-up: the marking windows, the teacher of each bus route and trip, who the class teacher
 * of each class is (mapped under Academics), and reopening a closed day for a teacher.
 */
export default async function AttendanceSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, setup, leave, absent] = await Promise.all([
    getMe(),
    apiFetch<AttendanceSetup>('/attendance/desk/setup'),
    apiFetch<LeaveSetup>('/attendance/leaves/setup'),
    apiFetch<AbsentTemplates>('/attendance/desk/absent-templates').catch(() => null),
  ]);
  const canTemplates = me.permissions.includes('comms.template.view');
  const unmapped = setup.sections.filter((s) => !s.teacher);
  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Attendance set-up"
        description="When teachers may mark, who marks each bus route, and reopening a day."
      />
      <AttendanceNav current="/attendance/setup" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <AttendanceSetupForm setup={setup} />
      </Card>
      {absent ? (
        <Card
          title="Message to parents when a student is absent"
          style={{ marginBottom: 'var(--sp-4)' }}
          actions={
            canTemplates ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/comms/templates">
                Open the templates
              </a>
            ) : null
          }
        >
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            The school’s templates with the code <strong>{absent.code}</strong>, one for each
            channel. The words in double braces are filled in: {absent.variables.join(', ')}. To
            change a message, or to add a channel that is missing, use Communication → Templates.
          </p>
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Absence messages">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">The absence message of each channel</caption>
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Used when</th>
                  <th scope="col">Message</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['WhatsApp', 'A teacher marks the class register', absent.whatsapp],
                    ['SMS', 'Attendance from Excel, with the SMS tick', absent.sms],
                    ['E-mail', 'Attendance from Excel, with the e-mail tick', absent.email],
                  ] as Array<[string, string, AbsentTemplate | null]>
                ).map(([channel, used, tpl]) => (
                  <tr key={channel}>
                    <th scope="row">{channel}</th>
                    <td>{used}</td>
                    <td>
                      {tpl ? (
                        <>
                          {tpl.subject ? <strong>{tpl.subject}</strong> : null}
                          <div style={{ whiteSpace: 'pre-wrap' }}>{tpl.body}</div>
                          {tpl.reference ? (
                            <div className="ep-field__help">Provider template: {tpl.reference}</div>
                          ) : null}
                        </>
                      ) : channel === 'E-mail' ? (
                        <>
                          <strong>{absent.emailFallback.subject}</strong>
                          <div>{absent.emailFallback.body}</div>
                          <div className="ep-field__help">
                            The standard card; add an e-mail template with this code to use your own
                            words.
                          </div>
                        </>
                      ) : (
                        <span className="ep-field__help">
                          No {channel} template with the code {absent.code}: nothing is sent on this
                          channel.
                        </span>
                      )}
                    </td>
                    <td>
                      {tpl ? (
                        <Badge tone={tpl.active ? 'success' : 'warning'}>
                          {tpl.active ? 'Active' : 'Not active'}
                        </Badge>
                      ) : channel === 'E-mail' ? (
                        <Badge tone="info">Standard</Badge>
                      ) : (
                        <Badge tone="neutral">Not set</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
      <Card title="Bus attendance: teacher of each route" style={{ marginBottom: 'var(--sp-4)' }}>
        <RouteTeachersPanel setup={setup} />
      </Card>
      <Card
        title="Class teachers (class attendance)"
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/teacher-assignments">
            Teacher assignments
          </a>
        }
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          A class is marked by its class teacher (mapped under Academics → Teacher assignments), a
          coordinator or an admin.{' '}
          {unmapped.length
            ? `${String(unmapped.length)} class(es) have no class teacher: ${unmapped.map((s) => s.name).join(', ')}.`
            : 'Every class has a class teacher.'}
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Class teachers">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">The class teacher of each class</caption>
            <thead>
              <tr>
                <th scope="col">Class</th>
                <th scope="col">Class teacher</th>
              </tr>
            </thead>
            <tbody>
              {setup.sections.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>{s.teacher ?? <Badge tone="warning">Not mapped</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card
        title="Student leave: approval levels"
        style={{ marginBottom: 'var(--sp-4)' }}
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/masters/attendance">
            Leave types
          </a>
        }
      >
        <LeaveSetupForm setup={leave} />
      </Card>
      <Card title="Reopen a day for a teacher">
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          When a teacher missed the window: open the day again for that class or route for some
          hours. What they mark then is flagged “marked late”.
        </p>
        <form action={reopenAttendance} className="ep-hd__row">
          <label className="ep-field" htmlFor="ro-target">
            <span className="ep-field__label">Class, or route and trip</span>
            <select id="ro-target" name="target" className="ep-select" required defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {setup.sections.map((s) => (
                <option key={`c${s.id}`} value={`class|${s.id}`}>
                  Class {s.name}
                </option>
              ))}
              {setup.routes.flatMap((r) => [
                <option key={`p${r.id}`} value={`bus|${r.id}|pick`}>
                  Route {r.name} · morning
                </option>,
                <option key={`d${r.id}`} value={`bus|${r.id}|drop`}>
                  Route {r.name} · afternoon
                </option>,
              ])}
            </select>
          </label>
          <label className="ep-field" htmlFor="ro-date">
            <span className="ep-field__label">Day</span>
            <input
              id="ro-date"
              name="date"
              type="date"
              className="ep-input"
              required
              defaultValue={istToday()}
              max={istToday()}
            />
          </label>
          <label className="ep-field" htmlFor="ro-hours">
            <span className="ep-field__label">Open for (hours)</span>
            <input
              id="ro-hours"
              name="hours"
              type="number"
              className="ep-input"
              min={1}
              max={72}
              defaultValue={4}
              required
            />
          </label>
          <label className="ep-field" htmlFor="ro-reason">
            <span className="ep-field__label">Reason</span>
            <input
              id="ro-reason"
              name="reason"
              className="ep-input"
              required
              minLength={3}
              maxLength={200}
            />
          </label>
          <div>
            <Button type="submit">Reopen</Button>
          </div>
        </form>
        {setup.reopens.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Reopened lately">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Days reopened lately</caption>
              <thead>
                <tr>
                  <th scope="col">For</th>
                  <th scope="col">Day</th>
                  <th scope="col">Open until</th>
                  <th scope="col">Reason</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {setup.reopens.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.what}</th>
                    <td>{r.date}</td>
                    <td>
                      {when(r.openUntil)} {r.open ? <Badge tone="success">Open</Badge> : null}
                    </td>
                    <td>{r.reason}</td>
                    <td>{r.by ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </>
  );
}
