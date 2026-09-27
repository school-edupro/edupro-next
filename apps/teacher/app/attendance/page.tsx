import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { markAttendance } from './actions';

interface Assignment {
  classSectionId: string;
  classCode: string;
  section: string;
  kind: string;
  subjectId: string | null;
  subjectName: string | null;
  canMarkAttendance: boolean;
}
interface Roster {
  studentId: string;
  name: string;
  admissionNo: string;
  rollNo: number | null;
  code: string | null;
  remarks: string | null;
  inAt: string | null;
  source: string | null;
}
interface Session {
  id: string | null;
  section: string;
  date: string;
  kind: 'day' | 'subject';
  subjectName: string | null;
  source: string | null;
  markedBy: string | null;
  markedAt: string | null;
  locked: boolean;
  roster: Roster[];
  counts: Record<string, number>;
}

const CODES: Array<[string, string]> = [
  ['P', 'Present'],
  ['A', 'Absent'],
  ['L', 'Late'],
  ['SR', 'Short leave'],
  ['H', 'Half day'],
  ['OD', 'On duty'],
  ['SB', 'Stay back'],
];
const ERRORS: Record<string, string> = {
  'attendance.future_date': 'Attendance cannot be marked for a future date.',
  'attendance.weekly_off': 'That day is a weekly off.',
  'attendance.holiday': 'That day is a holiday.',
  'attendance.locked': 'This register is locked; ask the coordinator to unlock it.',
  'attendance.year_closed': 'The academic year does not accept attendance any more.',
  'attendance.not_assigned': 'You are not assigned to mark this section.',
  forbidden: 'You are not allowed to mark this section.',
};

const today = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST calendar day
  return d.toISOString().slice(0, 10);
};

/** S9-06: the teacher's attendance register, one section and date at a time. */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    subject?: string;
    date?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  let assignments: Assignment[];
  try {
    assignments = await bff.api
      .fetch<{ data: Assignment[] }>('/academics/teacher-assignments/mine')
      .then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Attendance" />
          <Card>You have no teaching assignment in this school yet.</Card>
        </main>
      );
    throw error;
  }
  const options = assignments
    .filter((a) => a.canMarkAttendance || a.subjectId)
    .map((a) => ({
      value: `${a.classSectionId}|${a.subjectId ?? ''}`,
      label: `${a.classCode}-${a.section} · ${a.subjectId ? a.subjectName : 'Day attendance'}`,
      classSectionId: a.classSectionId,
      subjectId: a.subjectId,
    }));
  const chosen =
    options.find(
      (o) => o.classSectionId === sp.section && (o.subjectId ?? '') === (sp.subject ?? ''),
    ) ?? options[0];
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  let session: Session | null = null;
  let loadError: string | null = null;
  if (chosen) {
    try {
      session = await bff.api.fetch<Session>(
        `/attendance/session?classSectionId=${chosen.classSectionId}&date=${date}${chosen.subjectId ? `&kind=subject&subjectId=${chosen.subjectId}` : ''}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const counts = session?.counts ?? {};
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Attendance"
        title={chosen ? chosen.label : 'Attendance'}
        description={
          session?.id
            ? `${counts.P ?? 0} present · ${counts.A ?? 0} absent · ${counts.L ?? 0} late · marked by ${session.markedBy ?? '—'}${session.source === 'rfid' ? ' (RFID gate)' : ''}`
            : 'Not marked yet for this date.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Attendance saved. Guardians of absent students receive a WhatsApp alert.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {ERRORS[sp.error] ?? sp.error}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 260 }}>
            <span className="ep-field__label">Section</span>
            <select className="ep-input" name="pick" defaultValue={chosen?.value ?? ''}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Date</span>
            <input className="ep-input" type="date" name="date" defaultValue={date} max={today()} />
          </label>
          <Button type="submit" variant="secondary">
            Open register
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
          Codes: P present · A absent · L late · SR short leave · H half day · OD on duty · SB stay
          back.
        </p>
      </Card>
      {loadError ? <Card>{loadError}</Card> : null}
      {session && chosen ? (
        <Card
          title={`Register · ${session.date}`}
          actions={
            session.locked ? (
              <Badge tone="warning">Locked</Badge>
            ) : (
              <Badge tone="neutral">{session.roster.length} students</Badge>
            )
          }
        >
          <form action={markAttendance}>
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            <input type="hidden" name="subjectId" value={chosen.subjectId ?? ''} />
            <input type="hidden" name="date" value={session.date} />
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Student</th>
                  <th>Mark</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {session.roster.map((r) => (
                  <tr key={r.studentId}>
                    <td>{r.rollNo ?? ''}</td>
                    <td>
                      {r.name}
                      <div className="ep-kicker">
                        {r.admissionNo}
                        {r.inAt
                          ? ` · in ${new Date(r.inAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                          : ''}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                        {CODES.map(([code, label]) => (
                          <label
                            key={code}
                            title={label}
                            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                          >
                            <input
                              type="radio"
                              name={`code-${r.studentId}`}
                              value={code}
                              defaultChecked={(r.code ?? 'P') === code}
                              disabled={session.locked}
                            />
                            {code}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <input
                        className="ep-input"
                        name={`remarks-${r.studentId}`}
                        aria-label={`Remarks · ${r.name}`}
                        defaultValue={r.remarks ?? ''}
                        maxLength={200}
                        disabled={session.locked}
                        style={{ minWidth: 120 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!session.locked ? (
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
              >
                <Button type="submit">
                  {session.id ? 'Update attendance' : 'Save attendance'}
                </Button>
              </div>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                This register was locked by the coordinator.
              </p>
            )}
          </form>
        </Card>
      ) : null}
    </main>
  );
}
