import { FileLinks } from '@/components/FileLinks';
import { Badge, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

interface Notice {
  id: string;
  kind: 'notice' | 'circular';
  title: string;
  body: string;
  publishFrom: string;
  isPinned: boolean;
  targets: Array<{ label: string }>;
  files: Array<{ id: string; name: string | null }>;
}

/** S7-08: notices visible to the family (audience and targets are applied by the API). */
export default async function NoticesPage() {
  const lang = await currentLang();
  let notices: Notice[];
  try {
    notices = await bff.api
      .fetch<{ data: Notice[] }>('/academics/notices?size=50')
      .then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Notices')} />
          <Card>{t(lang, 'Notices are not available for this account.')}</Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Notices')}
        title={t(lang, 'Notices and circulars')}
        description={`${notices.length} ${t(lang, 'current')}`}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {notices.length === 0 ? <Card>{t(lang, 'No notices right now.')}</Card> : null}
      {notices.map((n) => (
        <Card key={n.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
          <div
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}
          >
            {n.isPinned ? <Badge tone="warning">{t(lang, 'Pinned')}</Badge> : null}
            <Badge tone={n.kind === 'circular' ? 'info' : 'neutral'}>{t(lang, n.kind)}</Badge>
            <span className="ep-kicker">{n.publishFrom}</span>
            {n.targets.length ? (
              <span className="ep-kicker">· {n.targets.map((x) => x.label).join(', ')}</span>
            ) : null}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontWeight: 600,
              color: 'var(--text-heading)',
              marginTop: 'var(--sp-2)',
            }}
          >
            {n.title}
          </div>
          <p style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--sp-1)' }}>{n.body}</p>
          {n.files.length ? (
            <div className="pp-attachments ep-filecell">
              <span>{t(lang, 'Attachments')}</span>
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
          ) : null}
        </Card>
      ))}
    </main>
  );
}
