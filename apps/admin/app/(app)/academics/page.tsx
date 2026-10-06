import { Badge, Card, PageHeader } from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { BarChart, ProgressRows } from '@/components/charts/Charts';
import { apiFetch, getMe } from '@/lib/api';

interface Dashboard {
  scoped: boolean;
  counts: {
    classes: number;
    sections: number;
    subjects: number;
    noClassTeacher: number;
    noSubjectTeacher: number;
    postsWeek: number;
    scheduled: number;
    documents: number;
    noticesMonth: number;
  };
  days: Array<{ date: string; homework: number; classwork: number; assignment: number }>;
  quiet: Array<{ id: string; section: string; lastOn: string | null; teacher: string | null }>;
  acks: Array<{
    type: string;
    id: string;
    title: string;
    section: string;
    asked: number;
    got: number;
  }>;
  coming: Array<{ what: string; title: string; date: string }>;
}
const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * Academics dashboard: what is set up for the session and what is missing, the homework and class work
 * posted in the last 14 days, classes that got nothing this week, acknowledgements asked and received,
 * and the holidays and events coming up.
 */
export default async function AcademicsDashboardPage() {
  const [me, d] = await Promise.all([getMe(), apiFetch<Dashboard>('/academics/dashboard')]);
  const c = d.counts;
  const kpis: Array<[string, string, string, string]> = [
    [
      'Classes and sections',
      `${String(c.classes)} / ${String(c.sections)}`,
      `${String(c.subjects)} subjects`,
      '/masters/academics',
    ],
    [
      'Without a class teacher',
      String(c.noClassTeacher),
      c.noClassTeacher ? 'sections still to be assigned' : 'every section has one',
      '/academics/teacher-assignments',
    ],
    [
      'Subjects without a teacher',
      String(c.noSubjectTeacher),
      'class subjects nobody is assigned to yet',
      '/academics/teacher-assignments',
    ],
    [
      'Posted this week',
      String(c.postsWeek),
      'homework, class work and assignments',
      '/academics/daily-work',
    ],
    ['Scheduled', String(c.scheduled), 'waiting for their publish time', '/academics/daily-work'],
    [
      'Class documents',
      String(c.documents),
      'session plans, date sheets, magazine',
      '/academics/documents',
    ],
    [
      'Notices this month',
      String(c.noticesMonth),
      'notices, circulars, office orders',
      '/academics/notices',
    ],
  ];
  return (
    <>
      <PageHeader
        kicker="Academics"
        title="Academics dashboard"
        description={
          d.scoped
            ? 'Your classes this session: set-up, daily work, acknowledgements and what is coming.'
            : 'This session at a glance: set-up, daily work, acknowledgements and what is coming.'
        }
      />
      <AcademicsNav current="/academics" permissions={me.permissions} />
      <div className="ep-cdash__kpis">
        {kpis.map(([title, value, help, href]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <a className="ep-cdash__num" href={href} aria-label={`${title}: ${value}`}>
                {value}
              </a>
            </div>
            <div className="ep-field__help">{help}</div>
          </Card>
        ))}
      </div>
      <div className="ep-chart__grid2" style={{ marginTop: 'var(--sp-4)' }}>
        <Card title="Daily work posted, last 14 days">
          <BarChart
            title="Homework, class work and assignments given on each of the last 14 days"
            stacked
            series={[
              { label: 'Homework', tone: 'navy' },
              { label: 'Class work', tone: 'cyan' },
              { label: 'Assignment', tone: 'warning' },
            ]}
            data={d.days.map((x) => ({
              label: x.date.slice(8),
              values: [x.homework, x.classwork, x.assignment],
            }))}
          />
        </Card>
        <Card
          title={`Acknowledgements asked · ${String(d.acks.length)}`}
          actions={
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/daily-work">
              Daily work
            </a>
          }
        >
          {d.acks.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nothing asked for an acknowledgement in the last 30 days.
            </p>
          ) : (
            <ProgressRows
              label="Acknowledged of the class strength"
              rows={d.acks.map((a) => ({
                name: `${a.title} · ${a.section}`,
                href: `/academics/acknowledgements?type=${a.type}&id=${a.id}`,
                value: a.got,
                of: a.asked,
                tone: a.asked && a.got >= a.asked ? ('success' as const) : ('warning' as const),
                text: `${String(a.got)} of ${String(a.asked)}`,
              }))}
            />
          )}
        </Card>
      </div>
      <div className="ep-chart__grid2">
        <Card title={`Classes with no daily work this week · ${String(d.quiet.length)}`}>
          {d.quiet.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Every class got homework or class work in the last 7 days.
            </p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Classes with no daily work"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  Classes with no daily work in the last 7 days
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Class teacher</th>
                    <th scope="col">Last posted</th>
                  </tr>
                </thead>
                <tbody>
                  {d.quiet.slice(0, 20).map((q) => (
                    <tr key={q.id}>
                      <th scope="row">{q.section}</th>
                      <td>{q.teacher ?? <Badge tone="warning">Not assigned</Badge>}</td>
                      <td>{q.lastOn ? day(q.lastOn) : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card
          title="Coming up"
          actions={
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/calendar">
              Calendar
            </a>
          }
        >
          {d.coming.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              No holiday or event is on the calendar ahead.
            </p>
          ) : (
            <ul className="ep-cdash__list">
              {d.coming.map((e, i) => (
                <li key={String(i)}>
                  <strong>{day(e.date)}</strong> · {e.title}{' '}
                  <Badge tone={e.what === 'Holiday' ? 'success' : 'info'}>{e.what}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
