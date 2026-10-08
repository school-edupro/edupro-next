import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ActivityNav } from '@/components/staff/ActivityNav';
import { markEmployeeLeave } from '@/lib/activity-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Row {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  logId: string | null;
  state: 'draft' | 'submitted' | 'reviewed' | 'returned' | 'missing';
  late: boolean;
  leave: 'full' | 'half' | null;
  leaveType: string | null;
  edited: boolean;
  submittedAt: string | null;
  minutes: number;
  entries: number;
}
interface Day {
  date: string;
  counts: {
    employees: number;
    submitted: number;
    reviewed: number;
    returned: number;
    draft: number;
    missing: number;
    late: number;
    leave: number;
    halfLeave: number;
  };
  departments: string[];
  data: Row[];
}
const STATE = {
  submitted: ['Submitted', 'success'],
  reviewed: ['Reviewed', 'info'],
  returned: ['Sent back', 'warning'],
  draft: ['Draft', 'neutral'],
  missing: ['Not filled', 'danger'],
} as const;
const LEAVE_TYPES = ['Casual leave', 'Sick leave', 'Earned leave', 'On duty', 'Other'];
const hm = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60).padStart(2, '0')}m`;
const when = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The activity logs of a day: who submitted, who is late, who has not filled; open one to review it. */
export default async function ActivityReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    department?: string;
    state?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const q = new URLSearchParams();
  if (/^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '')) q.set('date', sp.date!);
  if (sp.department) q.set('department', sp.department.slice(0, 120));
  const state = sp.state && (sp.state in STATE || sp.state === 'leave') ? sp.state : '';
  // the whole staff list (for the leave form), whatever tile is chosen
  const all = (await apiFetch<Day>(`/staff/activity/day?${q.toString()}`)).data;
  const day = await apiFetch<Day>(
    `/staff/activity/day?${q.toString()}${state ? `&state=${state}` : ''}`,
  );
  const tile = (label: string, value: number, s: string) => (
    <a
      key={label}
      href={`/staff/activity/review?${new URLSearchParams({ ...Object.fromEntries(q), ...(s ? { state: s } : {}) }).toString()}#list`}
      className="ep-tile-link"
      aria-current={state === s ? 'true' : undefined}
      aria-label={`${label}: ${String(value)}. Show the list`}
    >
      <Card title={label}>
        <div className="ep-cdash__big">
          <span className="ep-cdash__num">{value}</span>
        </div>
      </Card>
    </a>
  );
  return (
    <>
      <PageHeader
        kicker="Staff · Daily activity log"
        title={`Logs of ${day.date}`}
        description="A submitted log needs nothing more. Open one to read it, mark it reviewed, or send it back with a remark."
        actions={
          <>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/staff/activity-report?report=day&format=xlsx&date=${day.date}${sp.department ? `&department=${encodeURIComponent(sp.department)}` : ''}`}
            >
              Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/staff/activity-report?report=day&format=pdf&date=${day.date}${sp.department ? `&department=${encodeURIComponent(sp.department)}` : ''}`}
            >
              PDF
            </a>
          </>
        }
      />
      <ActivityNav current="/staff/activity/review" permissions={me.permissions} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <InputField id="rv-date" name="date" label="Date" type="date" defaultValue={day.date} />
          <SelectField
            id="rv-dept"
            name="department"
            label="Department"
            defaultValue={sp.department ?? ''}
            options={[
              { value: '', label: 'All departments' },
              ...day.departments.map((d) => ({ value: d, label: d })),
            ]}
          />
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Marked on leave.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}
      <div className="ep-cdash__kpis">
        {tile('All employees', day.counts.employees, '')}
        {tile('Submitted', day.counts.submitted, 'submitted')}
        {tile('Not filled', day.counts.missing, 'missing')}
        {tile('On leave', day.counts.leave + day.counts.halfLeave, 'leave')}
        {tile('Sent back', day.counts.returned, 'returned')}
      </div>
      <p className="ep-field__help">
        {day.counts.late} submitted late · {day.counts.reviewed} reviewed · {day.counts.draft} still
        a draft · {day.counts.halfLeave} on half-day leave. Click a tile to list those employees.
      </p>
      <Card id="list" style={{ marginTop: 'var(--sp-3)' }}>
        {day.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nobody in this list.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Logs of the day">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Activity logs of the day by employee</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted at</th>
                  <th scope="col" className="ep-num">
                    Activities
                  </th>
                  <th scope="col">Time logged</th>
                  <th scope="col">Log</th>
                </tr>
              </thead>
              <tbody>
                {day.data.map((r) => (
                  <tr key={r.employeeId}>
                    <th scope="row">
                      {r.name} <span className="ep-kicker">{r.employeeCode}</span>
                    </th>
                    <td>{r.department}</td>
                    <td>
                      <Badge tone={STATE[r.state][1]}>{STATE[r.state][0]}</Badge>{' '}
                      {r.late ? <Badge tone="warning">Late</Badge> : null}{' '}
                      {r.leave ? (
                        <Badge tone="info">
                          {r.leave === 'full' ? 'On leave' : 'Half day leave'}
                          {r.leaveType ? ` · ${r.leaveType}` : ''}
                        </Badge>
                      ) : null}{' '}
                      {r.edited ? <Badge tone="neutral">Edited</Badge> : null}
                    </td>
                    <td>{r.submittedAt ? when(r.submittedAt) : '–'}</td>
                    <td className="ep-num">{r.entries}</td>
                    <td>{r.minutes ? hm(r.minutes) : '–'}</td>
                    <td>
                      {r.logId && r.state !== 'draft' ? (
                        <a
                          href={`/staff/activity/review/${r.logId}`}
                          style={{ textDecoration: 'underline' }}
                          aria-label={`Open the log of ${r.name}`}
                        >
                          Open
                        </a>
                      ) : (
                        '–'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Mark an employee on leave" style={{ marginTop: 'var(--sp-4)' }}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          For someone who could not mark it on their own day. The day then counts as leave, not as
          “not filled”.
        </p>
        <form
          action={markEmployeeLeave}
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <input type="hidden" name="date" value={day.date} />
          <SelectField
            id="ml-emp"
            name="employeeId"
            label={`Employee (for ${day.date})`}
            required
            options={[
              { value: '', label: 'Choose' },
              ...all.map((r) => ({ value: r.employeeId, label: `${r.name} (${r.employeeCode})` })),
            ]}
          />
          <SelectField
            id="ml-kind"
            name="kind"
            label="Leave"
            options={[
              { value: 'full', label: 'Full day' },
              { value: 'half', label: 'Half day' },
            ]}
          />
          <SelectField
            id="ml-type"
            name="type"
            label="Kind of leave"
            options={LEAVE_TYPES.map((x) => ({ value: x, label: x }))}
          />
          <InputField id="ml-reason" name="reason" label="Reason" maxLength={300} />
          <Button type="submit" variant="secondary">
            Mark on leave
          </Button>
        </form>
      </Card>
    </>
  );
}
