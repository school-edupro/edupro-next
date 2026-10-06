import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { postDocument, removeDocument } from '../daily-work/actions';

interface Doc {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  remark: string | null;
  section: string | null;
  subject: string | null;
  fileIds: string[];
  publishAt: string;
  scheduled: boolean;
  ackRequired: boolean;
  ackCount: number;
  postedBy: string | null;
}
interface Assignment {
  classSectionId: string;
  classCode: string;
  section: string;
  subjectId: string | null;
  subjectName: string | null;
}
const KINDS: Array<[string, string]> = [
  ['session_plan', 'Session plan'],
  ['curriculum', 'Curriculum / syllabus'],
  ['date_sheet', 'Date sheet'],
  ['other', 'Other'],
];
const nowLocal = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Class documents: the teacher uploads a session plan, the curriculum or a date sheet (with a remark and
 * attachments) for the classes and subjects they hold. Parents and students see each from its publish
 * time; where asked, they acknowledge it and the teacher sees who has.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let docs: Doc[] = [];
  let assignments: Assignment[] = [];
  try {
    [docs, assignments] = await Promise.all([
      bff.api.fetch<{ data: Doc[] }>('/academics/documents').then((r) => r.data),
      bff.api
        .fetch<{ data: Assignment[] }>('/academics/teacher-assignments/mine')
        .then((r) => r.data),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (!(error instanceof ApiError && error.status === 403)) throw error;
  }
  const sections = [...new Map(assignments.map((a) => [a.classSectionId, a])).values()];
  const subjects = [
    ...new Map(
      assignments.filter((a) => a.subjectId).map((a) => [a.subjectId!, a.subjectName ?? '']),
    ).entries(),
  ];
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 960, margin: '0 auto' }}>
      <PageHeader
        kicker="Academics"
        title="Session plan, curriculum, date sheet"
        description="Upload for your classes; parents and students see it in their portal from the publish time."
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
          {sp.ok === 'removed' ? 'Removed.' : 'Uploaded.'}
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
      {sections.length ? (
        <Card title="Upload" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={postDocument} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <label className="ep-field">
                <span className="ep-field__label">What *</span>
                <select name="kind" className="ep-select" required>
                  {KINDS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ep-field">
                <span className="ep-field__label">Subject</span>
                <select name="subjectId" className="ep-select">
                  <option value="">All / not for one subject</option>
                  {subjects.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Classes *</legend>
              <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                {sections.map((s, i) => (
                  <label
                    key={s.classSectionId}
                    style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      name="classSectionIds"
                      value={s.classSectionId}
                      defaultChecked={sections.length === 1 && i === 0}
                    />
                    {s.classCode}-{s.section}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="ep-field">
              <span className="ep-field__label">Title *</span>
              <input name="title" className="ep-input" required minLength={2} maxLength={200} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Remark</span>
              <textarea name="remark" className="ep-input" rows={2} maxLength={2000} />
            </label>
            <label className="ep-field">
              <span className="ep-field__label">Attachments * (PDF or image, up to 5)</span>
              <input
                name="files"
                type="file"
                className="ep-input"
                multiple
                required
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
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
              </label>
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="ackRequired" value="1" />
                Ask the parent / student to acknowledge
              </label>
            </div>
            <div>
              <Button type="submit">Upload</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Card style={{ marginBottom: 'var(--sp-4)' }}>
          You have no class assigned in this session yet.
        </Card>
      )}
      <Card title="Uploaded">
        {docs.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            Nothing uploaded yet.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Class documents">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Class documents</caption>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Title</th>
                  <th scope="col">Class</th>
                  <th scope="col">Files</th>
                  <th scope="col">Published</th>
                  <th scope="col">Acknowledged</th>
                  <th scope="col">
                    <span className="ep-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>{d.kindLabel}</td>
                    <th scope="row">
                      {d.title}
                      <div className="ep-kicker">
                        {[d.subject, d.remark].filter(Boolean).join(' · ')}
                      </div>
                    </th>
                    <td>{d.section ?? 'Whole school'}</td>
                    <td>
                      {d.fileIds.map((f, i) => (
                        <FileLinks
                          key={f}
                          url={`/api/doc-file/document/${d.id}/${f}`}
                          saveUrl={`/api/doc-file/document/${d.id}/${f}?save=1`}
                          label={`attachment ${String(i + 1)} of ${d.title}`}
                        />
                      ))}
                    </td>
                    <td>
                      {when(d.publishAt)}{' '}
                      {d.scheduled ? <Badge tone="warning">Scheduled</Badge> : null}
                    </td>
                    <td>
                      {d.ackRequired && d.section ? (
                        <a
                          href={`/acknowledgements?type=document&id=${d.id}`}
                          style={{ textDecoration: 'underline' }}
                          aria-label={`Who acknowledged ${d.title}`}
                        >
                          {d.ackCount} · view
                        </a>
                      ) : (
                        '–'
                      )}
                    </td>
                    <td>
                      {d.section ? (
                        <form action={removeDocument}>
                          <input type="hidden" name="id" value={d.id} />
                          <button
                            type="submit"
                            className="ep-btn ep-btn--ghost ep-btn--sm"
                            aria-label={`Remove ${d.title}`}
                          >
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
