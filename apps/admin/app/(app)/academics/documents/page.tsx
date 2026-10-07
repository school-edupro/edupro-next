import {
  Badge,
  Button,
  Card,
  ClassSectionPicker,
  InputField,
  PageHeader,
  RichEditor,
  SelectField,
  type ClassSectionOption,
} from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { createDocument, deleteDocument } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';

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
 * Class documents: session plans, the curriculum and date sheets by class, and the school magazine and
 * almanac for everyone. Teachers upload for their own classes in the teacher app; the office uploads
 * here for any class or for the whole school. Parents and students see each from its publish time.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    kind?: string;
    new?: string;
  }>;
}) {
  const sp = await searchParams;
  const adding = sp.new === '1';
  const [me, list, classOptions] = await Promise.all([
    getMe(),
    apiFetch<{ data: Doc[]; kinds: Array<{ value: string; label: string }> }>(
      `/academics/documents${sp.kind ? `?kind=${encodeURIComponent(sp.kind)}` : ''}`,
    ),
    apiFetch<{ data: ClassSectionOption[] }>('/academics/daily-work/sheet/options')
      .then((r) => r.data)
      .catch(() => [] as ClassSectionOption[]),
  ]);
  const canPost = me.permissions.includes('academics.daily_work.post');
  return (
    <>
      <PageHeader
        kicker="Academics"
        title="Session plans, curriculum, date sheets and the magazine"
        description="Documents shared with parents and students: by class, or for the whole school."
        actions={
          adding ? (
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/documents">
              Back to the list
            </a>
          ) : canPost ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/academics/documents?new=1">
              + Upload
            </a>
          ) : null
        }
      />
      <AcademicsNav current="/academics/documents" permissions={me.permissions} />
      <Notice params={sp} />
      {canPost && adding ? (
        <Card title="Upload" style={{ marginBottom: 'var(--sp-4)' }}>
          <form action={createDocument} className="ep-hd__form">
            <div className="ep-hd__row">
              <SelectField
                id="doc-kind"
                name="kind"
                label="What *"
                options={list.kinds.map((k) => ({ value: k.value, label: k.label }))}
              />
            </div>
            <ClassSectionPicker
              name="classSectionIds"
              options={classOptions}
              whole={me.permissions.includes('academics.notice.manage')}
            />
            <p className="ep-field__help">
              Pick the class: all its sections come ticked. Whole school is for the magazine and the
              almanac.
            </p>
            <InputField id="doc-title" name="title" label="Title *" required maxLength={200} />
            <RichEditor name="remark" label="Remark" />
            <div className="ep-hd__row">
              <InputField
                id="doc-files"
                name="files"
                label="Attachments * (PDF or image, up to 5 files)"
                type="file"
                multiple
                required
                accept=".pdf,.png,.jpg,.jpeg,.webp"
              />
              <InputField
                id="doc-publish"
                name="publishAt"
                label="Publish on (date and time)"
                type="datetime-local"
                defaultValue={new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16)}
              />
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="ackRequired" value="1" /> Ask for an acknowledgement
              </label>
            </div>
            <div>
              <Button type="submit">Upload</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div hidden={adding}>
        <nav
          className="ep-tabs-links"
          aria-label="Kind"
          style={{ marginBottom: 'var(--sp-3)', flexWrap: 'wrap' }}
        >
          <a href="/academics/documents" aria-current={!sp.kind ? 'page' : undefined}>
            All
          </a>
          {list.kinds.map((k) => (
            <a
              key={k.value}
              href={`/academics/documents?kind=${k.value}`}
              aria-current={sp.kind === k.value ? 'page' : undefined}
            >
              {k.label}
            </a>
          ))}
        </nav>
        <Card>
          {list.data.length === 0 ? (
            <p className="ep-field__help" style={{ margin: 0 }}>
              Nothing uploaded yet.
            </p>
          ) : (
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Documents">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Class and school documents</caption>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Title</th>
                    <th scope="col">For</th>
                    <th scope="col">Files</th>
                    <th scope="col">Uploaded by</th>
                    <th scope="col">Published</th>
                    <th scope="col">Acknowledged</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((d) => (
                    <tr key={d.id}>
                      <td>{d.kindLabel}</td>
                      <th scope="row">
                        {d.title}
                        {d.remark ? (
                          <div
                            className="ep-richtext ep-field__help"
                            dangerouslySetInnerHTML={{ __html: d.remark }}
                          />
                        ) : null}
                      </th>
                      <td>{d.section ?? 'Whole school'}</td>
                      <td>
                        {d.fileIds.map((f, i) => (
                          <FileLinks
                            key={f}
                            href={`/api/academics/doc-file/document/${d.id}/${f}`}
                            label={`attachment ${String(i + 1)} of ${d.title}`}
                          />
                        ))}
                      </td>
                      <td>{d.postedBy ?? ''}</td>
                      <td>
                        {when(d.publishAt)}{' '}
                        {d.scheduled ? <Badge tone="warning">Scheduled</Badge> : null}
                      </td>
                      <td>
                        {d.ackRequired ? (
                          <a
                            href={`/academics/acknowledgements?type=document&id=${d.id}`}
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
                        {canPost ? (
                          <form action={deleteDocument}>
                            <input type="hidden" name="id" value={d.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${d.title}`}
                            >
                              Remove
                            </Button>
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
      </div>
    </>
  );
}
