import { PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { IndentForm } from '@/components/IndentForm';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { IndentFormLists } from '@/lib/purchase';

/** Raise a Purchase Indent from the staff app (docs/design/83, part 2). */
export default async function StaffNewIndentPage() {
  const lang = await currentLang();
  let lists: IndentFormLists;
  try {
    lists = await bff.api.fetch<IndentFormLists>('/purchase/indent-form');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Purchase indents')}
        title={t(lang, 'Raise an indent')}
        description={t(
          lang,
          'Save it as a draft to finish later, or send it to your department’s approvers. It gets its number when sent.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/purchase">
            {t(lang, 'Back')}
          </a>
        }
      />
      <IndentForm indent={null} lists={lists} />
    </main>
  );
}
