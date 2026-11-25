import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { notFound, redirect } from 'next/navigation';
import { FileNoteForm } from '@/components/FileNoteForm';
import { FilesNav } from '@/components/FilesNav';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/** Add new approval on the staff website, as the admin's: the subject, the note, attachments and the approvers. */
export default async function StaffNewFilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let people: { data: Array<{ id: string; name: string }> };
  try {
    people = await bff.api.fetch('/file-movement/people');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '60rem', margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'File movement')}
        title={t(lang, 'Add new approval')}
        description={t(
          lang,
          'Write what needs approval, attach the papers and choose who approves, in order.',
        )}
      />
      <FilesNav current="/files/new" lang={lang} />
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || t(lang, 'That did not work. Please try again.')}
        </p>
      ) : null}
      <Card>
        <FileNoteForm people={people.data.map((p) => ({ value: p.id, label: p.name }))} />
      </Card>
    </main>
  );
}
