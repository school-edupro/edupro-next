import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { markdownTitle, markdownToHtml } from '@/lib/markdown';

/** Sprint 22: one help page rendered from its Markdown source. */
export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  let md: string;
  try {
    md = readFileSync(join(process.cwd(), 'content', 'help', `${slug}.md`), 'utf8');
  } catch {
    notFound();
  }
  const [t, o] = await Promise.all([getTranslations('pages.help'), getTranslations('ops')]);
  const body = markdownToHtml(md.replace(/^#\s+.*$/m, ''));
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={markdownTitle(md)}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/help">
            {o('helpBack')}
          </a>
        }
      />
      <Card>
        <article className="ep-prose" dangerouslySetInnerHTML={{ __html: body }} />
      </Card>
    </>
  );
}
