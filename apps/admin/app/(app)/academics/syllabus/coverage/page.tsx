import { Badge, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { BarChart, DonutChart, ProgressRows, type ChartTone } from '@/components/charts/Charts';
import { apiFetch, getMe } from '@/lib/api';

interface Row {
  classSectionId: string;
  section: string;
  classId: string;
  subjectId: string;
  subject: string;
  teacher: string | null;
  employeeId: string | null;
  chapters: number;
  topics: number;
  done: number;
  partial: number;
  due: number;
  percent: number;
  behind: number;
}
interface Group {
  label: string;
  percent: number;
  behind: number;
}
interface Dashboard {
  weekStart: string;
  kpis: {
    percent: number;
    topics: number;
    done: number;
    sections: number;
    lagging: number;
    noTeacher: number;
    plansApproved: number;
    plansWaiting: number;
    plansMissing: number;
  };
  byClass: Group[];
  bySubject: Group[];
  byTeacher: Group[];
  lagging: Row[];
  missing: Array<{ teacher: string; employeeCode: string; department: string }>;
}
const tone = (p: number): ChartTone => (p >= 75 ? 'success' : p >= 40 ? 'warning' : 'danger');

/**
 * The lesson planner's dashboard: how much of the syllabus is taught (by class, subject and teacher),
 * who is behind the plan, the week's lesson plans, and the coverage table with Excel and PDF.
 */
export default async function SyllabusCoveragePage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; subjectId?: string; employeeId?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  // coverage of every class and teacher is its own right (school admin and coordinator by default): without it, say
  // so instead of failing on the API's refusal
  if (!me.permissions.includes('academics.syllabus.report'))
    return (
      <>
        <PageHeader
          kicker="Academics · Lesson planner"
          title="Syllabus coverage"
          description="How much of the syllabus is taught, who is behind the plan, and this week's lesson plans."
          actions={
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/syllabus">
              Syllabus
            </a>
          }
        />
        <AcademicsNav current="/academics/syllabus/coverage" permissions={me.permissions} />
        <Card>
          Syllabus coverage is not part of your role. The school admin can add &ldquo;See syllabus
          coverage of every class and teacher&rdquo; to it under Access → Roles.
        </Card>
      </>
    );
  const q = new URLSearchParams();
  for (const k of ['classId', 'subjectId', 'employeeId'] as const)
    if (/^\d{1,18}$/.test(sp[k] ?? '')) q.set(k, sp[k]!);
  const filters = q.toString();
  const [d, all, rows] = await Promise.all([
    apiFetch<Dashboard>('/academics/syllabus/dashboard'),
    apiFetch<{ data: Row[] }>('/academics/syllabus/coverage').then((r) => r.data),
    apiFetch<{ data: Row[] }>(`/academics/syllabus/coverage?${filters}`).then((r) => r.data),
  ]);
  const uniq = (pairs: Array<[string, string]>) =>
    [...new Map(pairs).entries()].map(([value, label]) => ({ value, label }));
  const classes = uniq(all.map((r) => [r.classId, r.section.split('-')[0]!]));
  const subjects = uniq(all.map((r) => [r.subjectId, r.subject]));
  const teachers = uniq(
    all.filter((r) => r.employeeId).map((r) => [r.employeeId!, r.teacher ?? '']),
  );
  const k = d.kpis;
  return (
    <>
      <PageHeader
        kicker="Academics · Lesson planner"
        title="Syllabus coverage"
        description="How much of the syllabus is taught, who is behind the plan, and this week's lesson plans."
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/syllabus">
              Syllabus
            </a>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/lesson-plans">
              Lesson plans
            </a>
          </>
        }
      />
      <AcademicsNav current="/academics/syllabus/coverage" permissions={me.permissions} />
      {k.topics === 0 ? (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          The syllabus is not entered yet. Add chapters and topics under{' '}
          <a href="/academics/syllabus" style={{ textDecoration: 'underline' }}>
            Syllabus
          </a>{' '}
          (or upload them from Excel); coverage is counted from there.
        </Card>
      ) : null}
      <div className="ep-cdash__kpis">
        {(
          [
            [
              'Syllabus covered',
              `${String(k.percent)}%`,
              `${String(k.done)} of ${String(k.topics)} topics done`,
            ],
            [
              'Behind the plan',
              String(k.lagging),
              `of ${String(k.sections)} class and subject lines`,
            ],
            ['Lessons waiting for approval', String(k.plansWaiting), `week of ${d.weekStart}`],
            [
              'Teachers with no lesson',
              String(k.plansMissing),
              `${String(k.plansApproved)} lesson(s) acknowledged this week`,
            ],
          ] as Array<[string, string, string]>
        ).map(([title, value, note]) => (
          <Card key={title} title={title}>
            <div className="ep-cdash__big">
              <span className="ep-cdash__num">{value}</span>
            </div>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {note}
            </p>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          margin: 'var(--sp-4) 0',
        }}
      >
        <Card title="Covered, by class">
          <BarChart
            title="Syllabus covered by class, in per cent"
            data={d.byClass.map((g) => ({ label: g.label, values: [g.percent] }))}
            series={[{ label: 'Covered %', tone: 'navy' }]}
            valueLabel={(v) => `${String(v[0])}%`}
          />
        </Card>
        <Card title="Overall">
          <DonutChart
            title="Topics done and pending"
            parts={[
              { label: 'Done', tone: 'success', value: k.done },
              { label: 'Pending', tone: 'muted', value: Math.max(0, k.topics - k.done) },
            ]}
            centre={`${String(k.percent)}%`}
            caption="of the syllabus"
          />
          {k.noTeacher ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              {k.noTeacher} class and subject line(s) have no teacher assigned.
            </p>
          ) : null}
        </Card>
        <Card title="Covered, by subject">
          <ProgressRows
            label="Syllabus covered by subject"
            rows={d.bySubject.map((g) => ({
              name: g.label,
              value: g.percent,
              of: 100,
              text: `${String(g.percent)}%${g.behind ? ` · ${String(g.behind)} behind` : ''}`,
              tone: tone(g.percent),
            }))}
          />
        </Card>
        <Card title="Covered, by teacher (lowest first)">
          <ProgressRows
            label="Syllabus covered by teacher"
            rows={d.byTeacher.slice(0, 12).map((g) => ({
              name: g.label,
              value: g.percent,
              of: 100,
              text: `${String(g.percent)}%${g.behind ? ` · ${String(g.behind)} behind` : ''}`,
              tone: tone(g.percent),
            }))}
          />
        </Card>
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <Card title="Most behind the plan">
          {d.lagging.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nobody is behind: every topic planned up to last month is done (or no month is planned
              on the chapters).
            </p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Most behind the plan"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">
                  Class and subject lines most behind the plan
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Teacher</th>
                    <th scope="col" className="ep-num">
                      Behind
                    </th>
                    <th scope="col" className="ep-num">
                      Covered
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.lagging.map((r) => (
                    <tr key={`${r.classSectionId}-${r.subjectId}`}>
                      <td>{r.section}</td>
                      <th scope="row">{r.subject}</th>
                      <td>{r.teacher ?? 'Not assigned'}</td>
                      <td className="ep-num">{r.behind} topic(s)</td>
                      <td className="ep-num">{r.percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card
          title={`No lesson uploaded · week of ${d.weekStart}`}
          actions={
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href="/api/academics/syllabus-report?report=missing&format=xlsx"
              >
                Excel
              </a>
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href="/api/academics/syllabus-report?report=missing&format=pdf"
              >
                PDF
              </a>
            </span>
          }
        >
          {d.missing.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Every teacher has uploaded a lesson this week.
            </p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Plans not submitted"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Teachers who uploaded no lesson this week</caption>
                <thead>
                  <tr>
                    <th scope="col">Teacher</th>
                    <th scope="col">Emp. code</th>
                    <th scope="col">Department</th>
                  </tr>
                </thead>
                <tbody>
                  {d.missing.map((m, i) => (
                    <tr key={String(i)}>
                      <th scope="row">{m.teacher}</th>
                      <td>{m.employeeCode}</td>
                      <td>{m.department}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {k.plansMissing > d.missing.length ? (
                <p className="ep-field__help">
                  and {k.plansMissing - d.missing.length} more: download the list.
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>
      <Card title="Coverage report" id="report">
        <form
          method="get"
          action="/academics/syllabus/coverage#report"
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginBottom: 'var(--sp-4)',
          }}
        >
          <SelectField
            id="cv-class"
            name="classId"
            label="Class"
            defaultValue={sp.classId ?? ''}
            options={[{ value: '', label: 'All classes' }, ...classes]}
          />
          <SelectField
            id="cv-subject"
            name="subjectId"
            label="Subject"
            defaultValue={sp.subjectId ?? ''}
            options={[{ value: '', label: 'All subjects' }, ...subjects]}
          />
          <SelectField
            id="cv-teacher"
            name="employeeId"
            label="Teacher"
            defaultValue={sp.employeeId ?? ''}
            options={[{ value: '', label: 'All teachers' }, ...teachers]}
          />
          <Button type="submit" variant="secondary">
            Show
          </Button>
          <a
            className="ep-btn ep-btn--secondary"
            href={`/api/academics/syllabus-report?report=coverage&format=xlsx&${filters}`}
          >
            Excel
          </a>
          <a
            className="ep-btn ep-btn--secondary"
            href={`/api/academics/syllabus-report?report=coverage&format=pdf&${filters}`}
          >
            PDF
          </a>
        </form>
        {rows.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing for these filters.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Coverage report">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">
                Syllabus coverage by class, subject and teacher
              </caption>
              <thead>
                <tr>
                  <th scope="col">Class</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Teacher</th>
                  <th scope="col" className="ep-num">
                    Topics
                  </th>
                  <th scope="col" className="ep-num">
                    Done
                  </th>
                  <th scope="col" className="ep-num">
                    Partly
                  </th>
                  <th scope="col" className="ep-num">
                    Covered
                  </th>
                  <th scope="col" className="ep-num">
                    Due by now
                  </th>
                  <th scope="col" className="ep-num">
                    Behind
                  </th>
                  <th scope="col">Topic-wise</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.classSectionId}-${r.subjectId}`}>
                    <td>{r.section}</td>
                    <th scope="row">{r.subject}</th>
                    <td>{r.teacher ?? <Badge tone="warning">Not assigned</Badge>}</td>
                    <td className="ep-num">{r.topics}</td>
                    <td className="ep-num">{r.done}</td>
                    <td className="ep-num">{r.partial}</td>
                    <td className="ep-num">{r.percent}%</td>
                    <td className="ep-num">{r.due}</td>
                    <td className="ep-num">
                      {r.behind ? <Badge tone="danger">{r.behind}</Badge> : '0'}
                    </td>
                    <td>
                      <a
                        href={`/api/academics/syllabus-report?report=topics&format=pdf&classSectionId=${r.classSectionId}&subjectId=${r.subjectId}`}
                        style={{ textDecoration: 'underline' }}
                        aria-label={`Topic-wise status of ${r.subject} in ${r.section}, PDF`}
                      >
                        PDF
                      </a>{' '}
                      ·{' '}
                      <a
                        href={`/api/academics/syllabus-report?report=topics&format=xlsx&classSectionId=${r.classSectionId}&subjectId=${r.subjectId}`}
                        style={{ textDecoration: 'underline' }}
                        aria-label={`Topic-wise status of ${r.subject} in ${r.section}, Excel`}
                      >
                        Excel
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
