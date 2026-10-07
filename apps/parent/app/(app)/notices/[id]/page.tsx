import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { AckButton } from '@/components/AckButton';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { chosenChild } from '@/lib/child';
import { currentLang, t } from '@/lib/i18n';
import type { Notice } from '../shared';

/** One notice or circular in full, with its attachments and the acknowledgement when it is asked. */
export default async function NoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  const kid = await chosenChild();
  let n: Notice;
  try {
    n = await bff.api.fetch<Notice>(`/academics/notices/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }
  const date = new Date(`${n.publishFrom}T00:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, n.kind)}
        title={n.title}
        description={[date, n.publishedBy].filter(Boolean).join(' · ')}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/notices">
            {t(lang, 'Back')}
          </a>
        }
      />
      <Card elevated style={{ marginBottom: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
          {n.isPinned ? <Badge tone="warning">{t(lang, 'Pinned')}</Badge> : null}
          <Badge tone={n.kind === 'circular' ? 'info' : 'neutral'}>{t(lang, n.kind)}</Badge>
          {n.targets.length ? (
            <span className="ep-kicker">
              {n.targets
                .slice(0, 6)
                .map((x) => x.label)
                .join(', ')}
            </span>
          ) : null}
        </div>
        {n.bodyFormat === 'html' ? (
          <div className="ep-prose ep-note" dangerouslySetInnerHTML={{ __html: n.body }} />
        ) : (
          <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{n.body}</p>
        )}
      </Card>
      {n.files.length ? (
        <Card title={t(lang, 'Attachments')} style={{ marginBottom: 'var(--sp-3)' }}>
          <div className="pp-attachments ep-filecell">
            {n.files.map((f, i) => (
              <FileLinks
                key={f.id}
                url={`/api/attachment/notice/${n.id}/${f.id}`}
                saveUrl={`/api/attachment/notice/${n.id}/${f.id}?save=1`}
                label={`${t(lang, 'Attachment')} ${String(i + 1)}`}
                viewLabel={t(lang, 'View')}
                saveLabel={t(lang, 'Download')}
              />
            ))}
          </div>
        </Card>
      ) : null}
      {n.ackRequired && kid ? (
        <Card>
          <AckButton
            type="notice"
            id={n.id}
            studentId={kid.id}
            done={(n.ackedFor ?? []).includes(kid.id)}
            back={`/notices/${n.id}`}
            label={t(lang, 'Acknowledge')}
            doneLabel={t(lang, 'Acknowledged')}
          />
        </Card>
      ) : null}
    </main>
  );
}
