import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Notice {
  id: string;
  kind: 'notice' | 'circular' | 'office_order';
  title: string;
  body: string;
  bodyFormat?: 'text' | 'html';
  audience: string;
  publishFrom: string;
  publishUntil: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  isPinned: boolean;
  ackRequired?: boolean;
  targets: Array<{ type: string; id: string; label: string }>;
  files: Array<{ id: string }>;
}
const KIND = { notice: 'Notice', circular: 'Circular', office_order: 'Office order' };
const FOR: Record<string, string> = {
  everyone: 'Students, parents and employees',
  students: 'Students and parents',
  employees: 'Employees',
};

/** One notice, circular or office order in full: what it says, whom it is for, its attachments. */
export default async function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  let n: Notice;
  const me = await getMe();
  try {
    n = await apiFetch<Notice>(`/academics/notices/${id}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const office = me.permissions.includes('academics.notice.manage');
  return (
    <>
      <PageHeader
        kicker={`Communication · ${KIND[n.kind]}`}
        title={n.title}
        description={`${n.publishedAt ? `Published ${n.publishFrom}` : 'Draft'}${n.publishedBy ? ` by ${n.publishedBy}` : ''}${n.publishUntil ? ` · shown till ${n.publishUntil}` : ''}`}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href={office ? '/academics/notices/report' : '/academics/notices'}
          >
            Back to the list
          </a>
        }
      />
      <Card title="Who it is for" style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ marginTop: 0 }}>
          <Badge tone="info">{FOR[n.audience] ?? n.audience}</Badge>{' '}
          {n.isPinned ? <Badge tone="warning">Pinned</Badge> : null}{' '}
          {n.ackRequired ? <Badge tone="neutral">Acknowledgement asked</Badge> : null}
        </p>
        {n.targets.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            All of them.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            {n.targets
              .slice(0, 60)
              .map((t) => t.label)
              .join(', ')}
            {n.targets.length > 60 ? ` and ${String(n.targets.length - 60)} more` : ''}
          </p>
        )}
        {office && n.ackRequired ? (
          <p style={{ marginBottom: 0 }}>
            <a
              href={`/academics/acknowledgements?type=notice&id=${n.id}`}
              style={{ textDecoration: 'underline' }}
            >
              See who acknowledged
            </a>
          </p>
        ) : null}
      </Card>
      <Card title="Message" style={{ marginBottom: 'var(--sp-4)' }}>
        {n.bodyFormat === 'html' ? (
          <div className="ep-prose ep-richtext" dangerouslySetInnerHTML={{ __html: n.body }} />
        ) : (
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{n.body}</p>
        )}
      </Card>
      {n.files.length ? (
        <Card title="Attachments">
          <span className="ep-filecell">
            {n.files.map((f, i) => (
              <FileLinks
                key={f.id}
                href={`/api/academics/doc-file/notice/${n.id}/${f.id}`}
                label={`attachment ${String(i + 1)}`}
              />
            ))}
          </span>
        </Card>
      ) : null}
    </>
  );
}
