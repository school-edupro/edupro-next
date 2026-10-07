import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { createPlan, updatePlan } from '../actions';

interface Assignment {
  classSectionId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectName: string | null;
}
interface Subject {
  id: string;
  name: string;
}
interface Plan {
  id: string;
  classSectionId: string;
  section: string;
  subjectId: string;
  subject: string;
  weekStart: string;
  title: string;
  objectives: string | null;
  topics: Array<{
    day: number;
    topic: string;
    activities?: string;
    resources?: string;
    homework?: string;
    topicId?: string;
  }>;
  assessment: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'returned';
  decisionNote: string | null;
}
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const nextMonday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};

/** S11: write or edit a weekly plan; day-wise topics, activities, resources and homework. */
export default async function LessonPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === 'new';
  let plan: Plan | null = null;
  let assignments: Assignment[] = [];
  let subjects: Subject[] = [];
  let syllabus: Array<{ id: string; label: string; name: string }> = [];
  try {
    if (!isNew) {
      plan = await bff.api.fetch<Plan>(`/academics/lesson-plans/${id}`);
      // the syllabus of this class and subject, to pick the day's topic from
      const mine = await bff.api
        .fetch<{ data: Array<{ classSectionId: string; subjectId: string; classId: string }> }>(
          '/academics/syllabus/mine',
        )
        .then((r) => r.data)
        .catch(() => []);
      const row = mine.find(
        (m) => m.classSectionId === plan!.classSectionId && m.subjectId === plan!.subjectId,
      );
      if (row)
        syllabus = await bff.api
          .fetch<{
            chapters: Array<{
              number: number;
              name: string;
              topics: Array<{ id: string; number: number; name: string; status: string | null }>;
            }>;
          }>(
            `/academics/syllabus/tree?classId=${row.classId}&subjectId=${row.subjectId}&classSectionId=${row.classSectionId}`,
          )
          .then((t) =>
            t.chapters.flatMap((c) =>
              c.topics.map((t2) => ({
                id: t2.id,
                label: `${String(c.number)}.${String(t2.number)} ${t2.name}${t2.status === 'done' ? ' (done)' : ''}`,
                name: t2.name,
              })),
            ),
          )
          .catch(() => []);
    } else
      [assignments, subjects] = await Promise.all([
        bff.api
          .fetch<{ data: Assignment[] }>('/academics/teacher-assignments/mine')
          .then((r) => r.data),
        bff.api
          .fetch<{ data: Subject[] }>('/academics/subjects?size=200&status=active')
          .then((r) => r.data),
      ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  const editable = isNew || (plan && ['draft', 'returned', 'rejected'].includes(plan.status));
  const topic = (day: number) => plan?.topics.find((t) => t.day === day);
  const sections = Array.from(
    new Map(assignments.map((a) => [a.classSectionId, `${a.classCode}-${a.section}`])).entries(),
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 900, margin: '0 auto' }}>
      <PageHeader
        kicker={
          isNew
            ? 'Lesson plans'
            : `Week of ${plan!.weekStart} · ${plan!.section} · ${plan!.subject}`
        }
        title={isNew ? 'New weekly plan' : plan!.title}
        description={
          plan?.decisionNote
            ? `Decision: ${plan.decisionNote}`
            : isNew
              ? 'Save a draft or submit it for approval.'
              : ''
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-1)', alignItems: 'center' }}>
            {plan ? (
              <Badge
                tone={
                  plan.status === 'approved'
                    ? 'success'
                    : plan.status === 'submitted'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {plan.status}
              </Badge>
            ) : null}
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/lesson-plans">
              Back
            </a>
          </span>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Saved.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      <Card>
        <form
          action={isNew ? createPlan : updatePlan}
          style={{ display: 'grid', gap: 'var(--sp-3)' }}
        >
          {!isNew ? <input type="hidden" name="id" value={plan!.id} /> : null}
          {isNew ? (
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              }}
            >
              <label className="ep-field">
                <span className="ep-field__label">Section</span>
                <select className="ep-input" name="classSectionId" required>
                  {sections.map(([sid, label]) => (
                    <option key={sid} value={sid}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Subject</span>
                <select className="ep-input" name="subjectId" required>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Week starting (Monday)</span>
                <input
                  className="ep-input"
                  type="date"
                  name="weekStart"
                  defaultValue={nextMonday()}
                  required
                />
              </label>
            </div>
          ) : null}
          <label className="ep-field">
            <span className="ep-field__label">Title</span>
            <input
              className="ep-input"
              name="title"
              defaultValue={plan?.title ?? ''}
              required
              minLength={3}
              maxLength={160}
              disabled={!editable}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Objectives</span>
            <textarea
              className="ep-input"
              name="objectives"
              rows={3}
              defaultValue={plan?.objectives ?? ''}
              maxLength={4000}
              disabled={!editable}
            />
          </label>
          <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Day</th>
                {syllabus.length ? <th>Syllabus topic</th> : null}
                <th>Topic</th>
                <th>Activities</th>
                <th>Resources</th>
                <th>Homework</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6].map((day) => (
                <tr key={day}>
                  <td>{DAYS[day]}</td>
                  {syllabus.length ? (
                    <td>
                      <select
                        className="ep-select"
                        name={`syllabus-${day}`}
                        defaultValue={
                          syllabus
                            .filter((x) => x.id === topic(day)?.topicId)
                            .map((x) => `${x.id}|${x.name}`)[0] ?? ''
                        }
                        disabled={!editable}
                        aria-label={`${DAYS[day]} syllabus topic`}
                      >
                        <option value="">Not from the syllabus</option>
                        {syllabus.map((x) => (
                          <option key={x.id} value={`${x.id}|${x.name}`}>
                            {x.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : null}
                  <td>
                    <input
                      className="ep-input"
                      name={`topic-${day}`}
                      defaultValue={topic(day)?.topic ?? ''}
                      maxLength={200}
                      disabled={!editable}
                      aria-label={`${DAYS[day]} topic`}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      name={`activities-${day}`}
                      defaultValue={topic(day)?.activities ?? ''}
                      maxLength={2000}
                      disabled={!editable}
                      aria-label={`${DAYS[day]} activities`}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      name={`resources-${day}`}
                      defaultValue={topic(day)?.resources ?? ''}
                      maxLength={1000}
                      disabled={!editable}
                      aria-label={`${DAYS[day]} resources`}
                    />
                  </td>
                  <td>
                    <input
                      className="ep-input"
                      name={`homework-${day}`}
                      defaultValue={topic(day)?.homework ?? ''}
                      maxLength={1000}
                      disabled={!editable}
                      aria-label={`${DAYS[day]} homework`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="ep-field">
            <span className="ep-field__label">Assessment</span>
            <input
              className="ep-input"
              name="assessment"
              defaultValue={plan?.assessment ?? ''}
              maxLength={2000}
              disabled={!editable}
            />
          </label>
          {editable ? (
            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <Button type="submit" name="intent" value="draft" variant="secondary">
                Save draft
              </Button>
              <Button type="submit" name="intent" value="submit">
                Submit for approval
              </Button>
            </div>
          ) : (
            <p className="ep-field__help">
              This plan is {plan!.status}; it can be edited only when returned.
            </p>
          )}
        </form>
      </Card>
    </main>
  );
}
