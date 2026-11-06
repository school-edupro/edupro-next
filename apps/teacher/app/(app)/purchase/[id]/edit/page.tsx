import { PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { IndentForm } from '@/components/IndentForm';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import type { IndentDetail, IndentFormLists } from '@/lib/purchase';

/** Change a draft indent, or one sent back for changes (docs/design/83, part 2). */
export default async function StaffEditIndentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const lang = await currentLang();
  let pi: IndentDetail;
  let lists: IndentFormLists;
  try {
    [pi, lists] = await Promise.all([
      bff.api.fetch<IndentDetail>(`/purchase/indents/${id}`),
      bff.api.fetch<IndentFormLists>('/purchase/indent-form'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }
  if (!pi.can.edit) notFound();
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Purchase indents')}
        title={`${t(lang, 'Change')} ${pi.number ?? t(lang, 'Draft')}`}
        description={pi.purpose}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/purchase/${pi.id}`}>
            {t(lang, 'Back')}
          </a>
        }
      />
      {pi.status === 'sent_back' && pi.decisionNote ? (
        <p className="ep-alert ep-alert--warning" role="status">
          <strong>{t(lang, 'What to change')}:</strong> {pi.decisionNote}
        </p>
      ) : null}
      <IndentForm indent={pi} lists={lists} />
    </main>
  );
}
