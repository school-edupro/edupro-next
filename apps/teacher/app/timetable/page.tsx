import { Badge, Card, DataTable, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Assignment {
  id: string;
  classCode: string;
  section: string;
  classSectionId: string;
  kind: 'class_teacher' | 'subject_teacher' | 'coordinator' | 'indicator';
  subjectName: string | null;
  canMarkAttendance: boolean;
  canPostHomework: boolean;
}
interface Period {
  id: string;
  number: number;
  name: string;
  startsAt: string;
  endsAt: string;
  kind: 'teaching' | 'break' | 'assembly' | 'activity';
}
interface Slot {
  id: string;
  classCode: string;
  section: string;
  weekday: number;
  periodId: string;
  subjectCode: string | null;
  room: string | null;
}

const KIND_LABEL: Record<Assignment['kind'], string> = {
  class_teacher: 'Class teacher',
  subject_teacher: 'Subject teacher',
  coordinator: 'Coordinator',
  indicator: 'Indicator',
};
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** S6-08: my sections and my week, from teacher assignments and the timetable of the working year. */
export default async function TimetablePage() {
  let assignments: Assignment[];
  let periods: Period[];
  let slots: Slot[];
  try {
    [assignments, periods, slots] = await Promise.all([
      bff.api
        .fetch<{ data: Assignment[] }>('/academics/teacher-assignments/mine')
        .then((r) => r.data),
      bff.api.fetch<{ data: Period[] }>('/academics/timetable/periods').then((r) => r.data),
      bff.api.fetch<{ data: Slot[] }>('/academics/timetable/mine').then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="My classes" />
          <Card>
            You have no teaching assignment in this school yet. Ask the academic coordinator.
          </Card>
          <p style={{ marginTop: 'var(--sp-3)' }}>
            <a href="/">Back to home</a>
          </p>
        </main>
      );
    throw error;
  }
  const today = new Date().getDay() || 7; // 1 = Monday ... 7 = Sunday
  const slotAt = new Map(slots.map((s) => [`${s.weekday}:${s.periodId}`, s]));
  const lessonsToday = slots.filter((s) => s.weekday === today).length;

  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="My classes"
        title="Sections and timetable"
        description={
          today <= 6
            ? `${lessonsToday} lesson${lessonsToday === 1 ? '' : 's'} today`
            : 'No lessons on Sunday'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      <Card title="My sections">
        <DataTable<Assignment>
          caption="My sections"
          density="dense"
          columns={[
            {
              key: 'section',
              header: 'Section',
              render: (a) => <strong>{`${a.classCode}-${a.section}`}</strong>,
            },
            {
              key: 'kind',
              header: 'Role',
              render: (a) => (
                <Badge tone={a.kind === 'class_teacher' ? 'info' : 'neutral'}>
                  {KIND_LABEL[a.kind]}
                </Badge>
              ),
            },
            { key: 'subject', header: 'Subject', render: (a) => a.subjectName ?? '' },
            {
              key: 'can',
              header: 'Can',
              render: (a) =>
                [a.canMarkAttendance ? 'attendance' : null, a.canPostHomework ? 'homework' : null]
                  .filter(Boolean)
                  .join(', '),
            },
          ]}
          rows={assignments}
          rowKey={(a) => a.id}
          emptyTitle="No assignments in this year"
        />
      </Card>
      <Card title="My week" style={{ marginTop: 'var(--sp-4)' }}>
        <DataTable<Period>
          caption="My week"
          density="dense"
          columns={[
            {
              key: 'period',
              header: 'Period',
              render: (p) => (
                <span>
                  <strong>{p.name}</strong>
                  <br />
                  <span className="ep-kicker">
                    {p.startsAt}–{p.endsAt}
                  </span>
                </span>
              ),
            },
            ...DAYS.map((label, idx) => ({
              key: `d${idx + 1}`,
              header: idx + 1 === today ? `${label} (today)` : label,
              render: (p: Period) => {
                if (p.kind !== 'teaching') return <span className="ep-kicker">{p.kind}</span>;
                const s = slotAt.get(`${idx + 1}:${p.id}`);
                return s ? (
                  <span>
                    <strong>{`${s.classCode}-${s.section}`}</strong>
                    <br />
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-small)' }}>
                      {s.subjectCode ?? ''} {s.room ? `· ${s.room}` : ''}
                    </span>
                  </span>
                ) : (
                  <span className="ep-kicker">free</span>
                );
              },
            })),
          ]}
          rows={periods}
          rowKey={(p) => p.id}
          emptyTitle="The school has not defined its periods yet"
        />
      </Card>
    </main>
  );
}
