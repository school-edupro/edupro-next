import { Badge, Button, Card, DataTable, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { postDailyWork } from './actions';

interface Work {
  id: string;
  kind: 'homework' | 'classwork' | 'assignment';
  section: string;
  subjectName: string | null;
  title: string;
  body: string;
  assignedOn: string;
  dueOn: string | null;
  files: Array<{ id: string; name: string | null }>;
  publishAt: string;
  scheduled: boolean;
  ackRequired: boolean;
  ackCount: number;
}
interface Assignment {
  classSectionId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectName: string | null;
  canPostHomework: boolean;
}
interface Subject {
  id: string;
  code: string;
  name: string;
}

/** The school's time now, as a date-time field takes it. */
const nowLocal = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** S7-07: the teacher posts homework and classwork for the sections assigned to them. */
export default async function DailyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let work: Work[];
  let assignments: Assignment[];
  let subjects: Subject[];
  try {
    [work, assignments, subjects] = await Promise.all([
      bff.api.fetch<{ data: Work[] }>('/academics/daily-work?size=50').then((r) => r.data),
      bff.api
        .fetch<{ data: Assignment[] }>('/academics/teacher-assignments/mine')
        .then((r) => r.data),
      bff.api
        .fetch<{ data: Subject[] }>('/academics/subjects?size=200&status=active')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Daily work" />
          <Card>You have no teaching assignment in this school yet.</Card>
        </main>
      );
    throw error;
  }
  const sections = [
    ...new Map(
      assignments.filter((a) => a.canPostHomework).map((a) => [a.classSectionId, a]),
    ).values(),
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="Daily work"
        title="Homework and classwork"
        description={`${work.length} recent posts for your sections`}
        actions={
          <>
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/documents">
              Session plan, curriculum, date sheet
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
          Posted.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error === 'scope-denied'
            ? 'That section is not assigned to you.'
            : `Could not post (${sp.error}). ${sp.detail ?? ''}`}
        </div>
      ) : null}
      {sections.length > 0 ? (
        <Card title="Post for your section" style={{ marginBottom: 'var(--sp-4)' }}>
          <form
            action={postDailyWork}

            style={{ display: 'grid', gap: 'var(--sp-3)' }}
          >
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-3)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              }}
            >
              <label className="ep-field">
                <span className="ep-field__label">Section</span>
                <select name="classSectionId" className="ep-select" required>
                  {sections.map((s) => (
                    <option key={s.classSectionId} value={s.classSectionId}>
                      {s.classCode}-{s.section}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Kind</span>
                <select name="kind" className="ep-select">
                  <option value="homework">Homework</option>
                  <option value="classwork">Classwork</option>
                  <option value="assignment">Assignment</option>
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Subject</span>
                <select name="subjectId" className="ep-select">
                  <option value="">None</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Due on</span>
                <input name="dueOn" type="date" className="ep-input" />
              </label>
            </div>
            <label className="ep-field">
              <span className="ep-field__label">Title</span>
              <input name="title" className="ep-input" required maxLength={160} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Details</span>
              <textarea name="body" className="ep-input" rows={3} maxLength={8000} />
            </label>
            <div
              style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'end' }}
            >
              <label className="ep-field">
                <span className="ep-field__label">Publish on (date and time)</span>
                <input
                  name="publishAt"
                  type="datetime-local"
                  className="ep-input"
                  defaultValue={nowLocal()}
                />
                <span className="ep-field__help">
                  Parents and students see it from this time. Now by default.
                </span>
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="ackRequired" value="1" />
                Ask the parent / student to acknowledge
              </label>
            </div>
            <label className="ep-field">
              <span className="ep-field__label">Attachment (PDF or image)</span>
              <input
                name="files"
                type="file"
                className="ep-input"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
            </label>
            <div>
              <Button type="submit">Post</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="Recent posts">
        <DataTable<Work>
          caption="Recent posts"
          density="dense"
          columns={[
            { key: 'date', header: 'Given', render: (w) => w.assignedOn },
            {
              key: 'kind',
              header: 'Kind',
              render: (w) => (
                <Badge
                  tone={
                    w.kind === 'homework' ? 'info' : w.kind === 'assignment' ? 'warning' : 'neutral'
                  }
                >
                  {w.kind}
                </Badge>
              ),
            },
            { key: 'section', header: 'Section', render: (w) => w.section },
            { key: 'subject', header: 'Subject', render: (w) => w.subjectName ?? '' },
            {
              key: 'title',
              header: 'Title',
              render: (w) => (
                <span>
                  <strong>{w.title}</strong>
                  {w.files.length ? (
                    <span className="ep-kicker"> · {w.files.length} file(s)</span>
                  ) : null}
                </span>
              ),
            },
            { key: 'due', header: 'Due', render: (w) => w.dueOn ?? '' },
            {
              key: 'publish',
              header: 'Published',
              render: (w) => (
                <span>
                  {when(w.publishAt)} {w.scheduled ? <Badge tone="warning">Scheduled</Badge> : null}
                </span>
              ),
            },
            {
              key: 'ack',
              header: 'Acknowledged',
              render: (w) =>
                w.ackRequired ? (
                  <a
                    href={`/acknowledgements?type=daily_work&id=${w.id}`}
                    style={{ textDecoration: 'underline' }}
                    aria-label={`Who acknowledged ${w.title}`}
                  >
                    {w.ackCount} · view
                  </a>
                ) : (
                  '–'
                ),
            },
          ]}
          rows={work}
          rowKey={(w) => w.id}
          emptyTitle="Nothing posted yet"
        />
      </Card>
    </main>
  );
}
