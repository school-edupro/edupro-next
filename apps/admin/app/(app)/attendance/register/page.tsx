import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { lockAttendance, markAttendance } from '@/lib/actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { AttendanceCode, AttendanceSession, AttendanceSummary } from '@/lib/types';

const CODES: AttendanceCode[] = ['P', 'A', 'L', 'SR', 'H', 'OD', 'SB'];
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** S9-06: the section register for a date; coordinators lock it once the day is closed. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{
    classSectionId?: string;
    date?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, me, summary] = await Promise.all([
    getTranslations('pages.attendance_register'),
    getTranslations('attendance'),
    getMe(),
    apiFetch<AttendanceSummary>(`/attendance/summary?date=${date}`),
  ]);
  const canMark = me.permissions.includes('attendance.session.mark');
  const canLock = me.permissions.includes('attendance.session.lock');
  const sectionId = sp.classSectionId ?? summary.sections[0]?.classSectionId;
  let session: AttendanceSession | null = null;
  let problem: string | null = null;
  if (sectionId) {
    try {
      session = await apiFetch<AttendanceSession>(
        `/attendance/session?classSectionId=${sectionId}&date=${date}`,
      );
    } catch (error) {
      if (error instanceof ApiError) problem = error.problem.detail ?? error.problem.type;
      else throw error;
    }
  }
  const counts = session?.counts ?? {};
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={session ? a('sessionOf', { section: session.section, date }) : t('title')}
        description={
          session?.id
            ? `${a('totals', { present: counts.P ?? 0, absent: counts.A ?? 0, late: counts.L ?? 0 })} · ${a('markedBy')} ${session.markedBy ?? a(`sources.${session.source ?? 'manual'}`)}`
            : t('description')
        }
        actions={
          session?.id && canLock ? (
            <form action={lockAttendance}>
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="classSectionId" value={session.classSectionId} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="locked" value={session.locked ? 'false' : 'true'} />
              <Button type="submit" variant="secondary">
                {session.locked ? a('unlock') : a('lock')}
              </Button>
            </form>
          ) : null
        }
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <SelectField
            id="classSectionId"
            name="classSectionId"
            label={a('section')}
            defaultValue={sectionId ?? ''}
            options={summary.sections.map((s) => ({
              value: s.classSectionId,
              label: `${s.section}${s.sessionId ? '' : ` · ${a('notMarked')}`}`,
            }))}
          />
          <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
          <Button type="submit" variant="secondary">
            {a('open')}
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
          {a('helpCodes')} · {a('alerts')}
        </p>
      </Card>
      {problem ? <Card>{problem}</Card> : null}
      {session ? (
        <Card
          title={a('register')}
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-1)' }}>
              {session.source === 'rfid' ? <Badge tone="info">{a('sources.rfid')}</Badge> : null}
              {session.locked ? <Badge tone="warning">{a('locked')}</Badge> : null}
              <Badge tone="neutral">{session.roster.length}</Badge>
            </span>
          }
        >
          <form action={markAttendance}>
            <input type="hidden" name="classSectionId" value={session.classSectionId} />
            <input type="hidden" name="date" value={date} />
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{a('student')}</th>
                  <th>{a('code')}</th>
                  <th>{a('inAt')}</th>
                  <th>{a('remarks')}</th>
                </tr>
              </thead>
              <tbody>
                {session.roster.map((r) => (
                  <tr key={r.studentId}>
                    <td>{r.rollNo ?? ''}</td>
                    <td>
                      <a href={`/people/students/${r.studentId}`}>{r.name}</a>
                      <div className="ep-kicker">{r.admissionNo}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                        {CODES.map((code) => (
                          <label
                            key={code}
                            title={a(`codes.${code}`)}
                            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
                          >
                            <input
                              type="radio"
                              name={`code-${r.studentId}`}
                              value={code}
                              defaultChecked={(r.code ?? 'P') === code}
                              disabled={!canMark || session.locked}
                            />
                            {code}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      {r.inAt
                        ? new Date(r.inAt).toLocaleTimeString('en-IN', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : ''}
                      {r.outAt
                        ? ` → ${new Date(r.outAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                        : ''}
                    </td>
                    <td>
                      <input
                        className="ep-input"
                        name={`remarks-${r.studentId}`}
                        aria-label={`${a('remarks')} · ${r.name}`}
                        defaultValue={r.remarks ?? ''}
                        maxLength={200}
                        disabled={!canMark || session.locked}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canMark && !session.locked ? (
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
              >
                <Button type="submit">{session.id ? a('update') : a('save')}</Button>
              </div>
            ) : null}
          </form>
        </Card>
      ) : null}
    </>
  );
}
