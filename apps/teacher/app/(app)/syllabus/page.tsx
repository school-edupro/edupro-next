import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { markTopic } from './actions';

interface Row {
  classSectionId: string;
  section: string;
  classId: string;
  subjectId: string;
  subject: string;
  topics: number;
  done: number;
  partial: number;
  percent: number;
  behind: number;
}
interface Tree {
  chapters: Array<{
    id: string;
    number: number;
    name: string;
    term: string | null;
    plannedMonth: number | null;
    topics: Array<{
      id: string;
      number: number;
      name: string;
      plannedPeriods: number;
      status: 'done' | 'partial' | 'not_done' | null;
      doneOn: string | null;
      reason: string | null;
    }>;
  }>;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = {
  done: ['Done', 'success'],
  partial: ['Partly done', 'warning'],
  not_done: ['Not done', 'danger'],
} as const;
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * My syllabus: the classes and subjects I teach with how much is covered; opening one lists its
 * chapters and topics, and each topic is marked done, partly done or not done for that class.
 */
export default async function SyllabusPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    subject?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  let rows: Row[] = [];
  try {
    rows = (await bff.api.fetch<{ data: Row[] }>('/academics/syllabus/mine')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const open = rows.find((r) => r.classSectionId === sp.section && r.subjectId === sp.subject);
  const tree = open
    ? await bff.api.fetch<Tree>(
        `/academics/syllabus/tree?classId=${open.classId}&subjectId=${open.subjectId}&classSectionId=${open.classSectionId}`,
      )
    : null;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="Lesson planner"
        title={open ? `${open.section} · ${open.subject}` : 'My syllabus'}
        description={
          open
            ? `${String(open.percent)}% covered: ${String(open.done)} of ${String(open.topics)} topics done${open.behind ? ` · ${String(open.behind)} behind the plan` : ''}`
            : 'The classes and subjects you teach. Open one to mark what you have taught.'
        }
        actions={
          <>
            {open ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/syllabus">
                All my classes
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/lesson-plans">
              Lesson plans
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
              Home
            </a>
          </>
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
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}
      {!open ? (
        <Card>
          {rows.length === 0 ? (
            <p style={{ margin: 0 }}>
              No syllabus is entered yet for a class and subject assigned to you. The coordinator
              enters it under Academics → Syllabus.
            </p>
          ) : (
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="My classes and subjects"
            >
              <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
                <caption className="ep-sr-only">Coverage of my classes and subjects</caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Topics done</th>
                    <th scope="col">Covered</th>
                    <th scope="col">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.classSectionId}-${r.subjectId}`}>
                      <td>{r.section}</td>
                      <th scope="row">
                        <a
                          href={`/syllabus?section=${r.classSectionId}&subject=${r.subjectId}`}
                          style={{ textDecoration: 'underline' }}
                        >
                          {r.subject}
                        </a>
                      </th>
                      <td>
                        {r.done} of {r.topics}
                        {r.partial ? ` (+${String(r.partial)} partly)` : ''}
                      </td>
                      <td>{r.percent}%</td>
                      <td>
                        <Badge tone={r.behind ? 'danger' : 'success'}>
                          {r.behind ? `${String(r.behind)} behind` : 'On track'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        tree!.chapters.map((c) => (
          <Card
            key={c.id}
            title={`Chapter ${String(c.number)}: ${c.name}`}
            style={{ marginBottom: 'var(--sp-4)' }}
            actions={
              <span className="ep-kicker">
                {[c.term, c.plannedMonth ? `planned ${MONTHS[c.plannedMonth - 1]!}` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            }
          >
            {c.topics.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                No topic in this chapter yet.
              </p>
            ) : null}
            {c.topics.map((t) => (
              <form key={t.id} id={`t${t.id}`} className="ep-hw__subject">
                <input type="hidden" name="classSectionId" value={open.classSectionId} />
                <input type="hidden" name="subjectId" value={open.subjectId} />
                <input type="hidden" name="topicId" value={t.id} />
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <strong>
                    {c.number}.{t.number} {t.name}
                  </strong>
                  <span className="ep-kicker">{t.plannedPeriods} period(s)</span>
                  {t.status ? (
                    <Badge tone={STATUS[t.status][1]}>
                      {STATUS[t.status][0]}
                      {t.doneOn ? ` · ${t.doneOn}` : ''}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Pending</Badge>
                  )}
                </div>
                {t.reason ? <div className="ep-field__help">{t.reason}</div> : null}
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                    alignItems: 'flex-end',
                    marginTop: 'var(--sp-2)',
                  }}
                >
                  <label className="ep-field">
                    <span className="ep-field__label">Taught on</span>
                    <input
                      className="ep-input"
                      type="date"
                      name="doneOn"
                      max={today()}
                      defaultValue={t.doneOn ?? today()}
                      aria-label={`${t.name}: taught on`}
                    />
                  </label>
                  <label className="ep-field">
                    <span className="ep-field__label">Remark (needed for Not done)</span>
                    <input
                      className="ep-input"
                      name="reason"
                      maxLength={300}
                      defaultValue={t.reason ?? ''}
                      aria-label={`${t.name}: remark`}
                    />
                  </label>
                  <Button type="submit" size="sm" formAction={markTopic.bind(null, 'done')}>
                    Done
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="secondary"
                    formAction={markTopic.bind(null, 'partial')}
                  >
                    Partly
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    variant="ghost"
                    formAction={markTopic.bind(null, 'not_done')}
                  >
                    Not done
                  </Button>
                </div>
              </form>
            ))}
          </Card>
        ))
      )}
    </main>
  );
}
