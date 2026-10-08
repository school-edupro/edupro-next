import {
  Badge,
  Button,
  Card,
  InputField,
  LessonReport,
  LessonUploadForm,
  PageHeader,
  SelectField,
  type LessonFilters,
  type LessonListData,
  type LessonOptions,
} from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { BarChart, ProgressRows } from '@/components/charts/Charts';
import { apiFetch, getMe } from '@/lib/api';
import { removeLessonApprovers, saveLessonApprovers, uploadLesson } from '@/lib/lesson-actions';

type Tab = 'report' | 'upload' | 'dashboard' | 'approvers';
interface Rules {
  data: Array<{
    id: string;
    scope: 'employee' | 'class' | 'department' | 'default';
    label: string;
    levels: Array<{ level: number; label: string; kind: 'employee' | 'role' }>;
  }>;
  employees: Array<{ value: string; label: string }>;
  classes: Array<{ value: string; label: string }>;
  departments: string[];
  roles: Array<{ value: string; label: string }>;
}
interface Dashboard {
  from: string;
  to: string;
  kpis: {
    total: number;
    pending: number;
    acknowledged: number;
    rejected: number;
    notUploaded: number;
  };
  pendingByLevel: Array<{ level: number; n: number }>;
  pendingByApprover: Array<{ approver: string; n: number; oldest: string }>;
  byDepartment: Array<{ label: string; n: number; pending: number }>;
  byClass: Array<{ label: string; n: number }>;
  byEmployee: Array<{ label: string; n: number; acknowledged: number; rejected: number }>;
  trend: Array<{ d: string; n: number }>;
  notUploaded: Array<{ name: string; code: string; department: string }>;
}
const SCOPE = {
  default: 'School default',
  department: 'Department',
  class: 'Class',
  employee: 'Employee',
} as const;
const KEYS = ['by', 'q', 'from', 'to', 'status', 'level', 'record', 'mine', 'page'] as const;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * Lesson planner: Lesson Report (every lesson with its level and approver), Upload Lesson, the
 * dashboard, and who approves whose lessons (by employee, class, department, or the school default).
 */
export default async function LessonPlansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const office = me.permissions.includes('academics.lesson_plan.setup');
  const canUpload = me.permissions.includes('academics.lesson_plan.manage');
  const asked = sp.tab ?? 'report';
  const tab: Tab =
    asked === 'upload' && canUpload
      ? 'upload'
      : (asked === 'dashboard' || asked === 'approvers') && office
        ? asked
        : 'report';
  const filters: LessonFilters = {};
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = (sp[k] ?? '').slice(0, 80);
    if (!v) continue;
    q.set(k, v);
    if (k !== 'page') filters[k] = v;
  }
  const range = new URLSearchParams();
  for (const k of ['from', 'to'] as const)
    if (/^\d{4}-\d{2}-\d{2}$/.test(sp[k] ?? '')) range.set(k, sp[k]!);
  const [list, options, rules, dash] = await Promise.all([
    tab === 'report'
      ? apiFetch<LessonListData>(`/academics/lessons?${q.toString()}`)
      : Promise.resolve(null),
    tab === 'upload'
      ? apiFetch<LessonOptions>('/academics/lessons/options')
      : Promise.resolve(null),
    tab === 'approvers' ? apiFetch<Rules>('/academics/lessons/approvers') : Promise.resolve(null),
    tab === 'dashboard'
      ? apiFetch<Dashboard>(`/academics/lessons/dashboard?${range.toString()}`)
      : Promise.resolve(null),
  ]);
  const link = (v: Tab, label: string) => (
    <a
      key={v}
      href={`/academics/lesson-plans?tab=${v}`}
      aria-current={tab === v ? 'page' : undefined}
    >
      {label}
    </a>
  );
  const who = rules
    ? [
        { value: '', label: 'No one (no such level)' },
        ...rules.roles.map((r) => ({ value: `role:${r.value}`, label: `Role: ${r.label}` })),
        ...rules.employees.map((e) => ({ value: `emp:${e.value}`, label: e.label })),
      ]
    : [];
  return (
    <>
      <PageHeader
        kicker="Academics · Lesson planner"
        title="Lesson setup"
        description="Teachers upload a lesson for their classes; it goes level by level to the approvers set for that teacher, the class or the department."
      />
      <AcademicsNav current="/academics/lesson-plans" permissions={me.permissions} />
      <nav
        className="ep-tabs-links"
        aria-label="Lesson setup"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {canUpload ? link('upload', 'Upload Lesson') : null}
        {link('report', 'Lesson Report')}
        {office ? link('dashboard', 'Dashboard') : null}
        {office ? link('approvers', 'Approvers') : null}
      </nav>
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'deleted' ? 'The lesson was deleted.' : 'Saved.'}
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

      {tab === 'upload' && options ? (
        <Card>
          <LessonUploadForm options={options} action={uploadLesson} today={today()} />
        </Card>
      ) : null}

      {tab === 'report' && list ? (
        <LessonReport
          list={list}
          filters={filters}
          path="/academics/lesson-plans"
          keep={{ tab: 'report' }}
          exportPath="/api/academics/lesson-report"
          detailHref={(id) => `/academics/lesson-plans/${id}`}
        />
      ) : null}

      {tab === 'dashboard' && dash ? (
        <>
          <Card style={{ marginBottom: 'var(--sp-4)' }}>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <input type="hidden" name="tab" value="dashboard" />
              <InputField
                id="ld-from"
                name="from"
                label="Requested from"
                type="date"
                defaultValue={dash.from}
              />
              <InputField id="ld-to" name="to" label="To" type="date" defaultValue={dash.to} />
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </form>
          </Card>
          <div className="ep-lesson__tiles" style={{ marginBottom: 'var(--sp-4)' }}>
            {(
              [
                ['Total requests', dash.kpis.total, 'total', ''],
                ['Pending', dash.kpis.pending, 'pending', 'pending'],
                ['Acknowledged', dash.kpis.acknowledged, 'acknowledged', 'acknowledged'],
                ['Rejected', dash.kpis.rejected, 'rejected', 'rejected'],
              ] as Array<[string, number, string, string]>
            ).map(([label, n, tone, status]) => (
              <a
                key={label}
                className="ep-lesson__tile"
                data-tone={tone}
                href={`/academics/lesson-plans?tab=report&from=${dash.from}&to=${dash.to}${status ? `&status=${status}` : ''}`}
              >
                <span className="ep-lesson__tilelabel">{label}</span>
                <span className="ep-lesson__tilenum">{n}</span>
              </a>
            ))}
            <div className="ep-lesson__tile" data-tone="rejected">
              <span className="ep-lesson__tilelabel">Teachers with no lesson</span>
              <span className="ep-lesson__tilenum">{dash.kpis.notUploaded}</span>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 'var(--sp-4)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
            }}
          >
            <Card title="Lessons uploaded, day by day">
              <BarChart
                title="Lessons uploaded on each of the last days"
                data={dash.trend.map((t) => ({ label: t.d.slice(5), values: [t.n] }))}
                series={[{ label: 'Lessons', tone: 'navy' }]}
              />
            </Card>
            <Card title="Pending, by level">
              {dash.pendingByLevel.length === 0 ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  Nothing is pending.
                </p>
              ) : (
                <ProgressRows
                  label="Pending lessons by approval level"
                  rows={dash.pendingByLevel.map((l) => ({
                    name: `Level ${String(l.level)}`,
                    value: l.n,
                    of: Math.max(1, dash.kpis.pending),
                    text: String(l.n),
                    tone: 'warning',
                    href: `/academics/lesson-plans?tab=report&level=${String(l.level)}`,
                  }))}
                />
              )}
            </Card>
            <Card title="Pending, by approver">
              {dash.pendingByApprover.length === 0 ? (
                <p className="ep-field__help" style={{ margin: 0 }}>
                  No approver has anything waiting.
                </p>
              ) : (
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Pending by approver"
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Lessons waiting, by approver</caption>
                    <thead>
                      <tr>
                        <th scope="col">Approver</th>
                        <th scope="col" className="ep-num">
                          Waiting
                        </th>
                        <th scope="col">Oldest request</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.pendingByApprover.map((a) => (
                        <tr key={a.approver}>
                          <th scope="row">{a.approver}</th>
                          <td className="ep-num">{a.n}</td>
                          <td>{a.oldest}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card title="By department">
              <ProgressRows
                label="Lessons by department"
                rows={dash.byDepartment.map((g) => ({
                  name: g.label,
                  value: g.n,
                  of: Math.max(1, dash.kpis.total),
                  text: `${String(g.n)} · ${String(g.pending)} pending`,
                  tone: 'cyan',
                }))}
              />
            </Card>
            <Card title="By class">
              <BarChart
                title="Lessons uploaded for each class"
                data={dash.byClass.map((g) => ({ label: g.label, values: [g.n] }))}
                series={[{ label: 'Lessons', tone: 'cyan' }]}
              />
            </Card>
            <Card title="By employee (most lessons first)">
              <ProgressRows
                label="Lessons by employee"
                rows={dash.byEmployee.map((g) => ({
                  name: g.label,
                  value: g.n,
                  of: Math.max(1, ...dash.byEmployee.map((x) => x.n)),
                  text: `${String(g.n)} · ${String(g.acknowledged)} acknowledged${g.rejected ? ` · ${String(g.rejected)} rejected` : ''}`,
                  tone: 'navy',
                }))}
              />
            </Card>
          </div>
          <Card
            title={`Teachers who uploaded no lesson (${String(dash.kpis.notUploaded)})`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            {dash.notUploaded.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                Every teacher uploaded at least one lesson in these dates.
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 'var(--sp-4)', columns: '16rem' }}>
                {dash.notUploaded.map((t) => (
                  <li key={t.code}>
                    {t.name}{' '}
                    <span className="ep-kicker">
                      {[t.code, t.department].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      {tab === 'approvers' && rules ? (
        <>
          <Card title="Who approves whose lessons" style={{ marginBottom: 'var(--sp-4)' }}>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              When a teacher uploads a lesson the first rule that fits decides the approvers: the
              teacher’s own rule, else the rule of the class, else of the teacher’s department, else
              the school default. With no rule at all it goes to the principal / school admin.
            </p>
            {rules.data.length === 0 ? (
              <p className="ep-field__help">No rule yet: add the school default first.</p>
            ) : (
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Approver rules">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Approver rules</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rule for</th>
                      <th scope="col">Whose lessons</th>
                      <th scope="col">Level 1</th>
                      <th scope="col">Level 2</th>
                      <th scope="col">Level 3</th>
                      <th scope="col">
                        <span className="ep-sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.data.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <Badge tone={r.scope === 'default' ? 'neutral' : 'info'}>
                            {SCOPE[r.scope]}
                          </Badge>
                        </td>
                        <th scope="row">{r.label}</th>
                        {[1, 2, 3].map((n) => (
                          <td key={n}>{r.levels.find((l) => l.level === n)?.label ?? '–'}</td>
                        ))}
                        <td>
                          <form action={removeLessonApprovers}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove the rule for ${r.label}`}
                            >
                              Remove
                            </Button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Add or replace a rule">
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Choose what the rule is for and fill only that one box (employee, class or
              department); then the approver of each level. Saving a rule that already exists
              replaces its levels.
            </p>
            <form action={saveLessonApprovers} className="ep-lesson__filters">
              <SelectField
                id="ar-scope"
                name="scope"
                label="Rule for *"
                options={[
                  { value: 'default', label: 'School default (everyone else)' },
                  { value: 'department', label: 'A department' },
                  { value: 'class', label: 'A class' },
                  { value: 'employee', label: 'An employee' },
                ]}
              />
              <SelectField
                id="ar-dept"
                name="department"
                label="Department"
                options={[
                  { value: '', label: 'Choose for a department rule' },
                  ...rules.departments.map((d) => ({ value: d, label: d })),
                ]}
              />
              <SelectField
                id="ar-class"
                name="classId"
                label="Class"
                options={[{ value: '', label: 'Choose for a class rule' }, ...rules.classes]}
              />
              <SelectField
                id="ar-emp"
                name="employeeId"
                label="Employee"
                options={[{ value: '', label: 'Choose for an employee rule' }, ...rules.employees]}
              />
              <SelectField
                id="ar-l1"
                name="level1"
                label="Level 1 approver *"
                required
                options={who.slice(1)}
              />
              <SelectField id="ar-l2" name="level2" label="Level 2 approver" options={who} />
              <SelectField id="ar-l3" name="level3" label="Level 3 approver" options={who} />
              <span className="ep-lesson__buttons">
                <Button type="submit">Save rule</Button>
              </span>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
