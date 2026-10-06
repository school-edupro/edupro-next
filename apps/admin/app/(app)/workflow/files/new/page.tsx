import { Card, PageHeader } from '@edupro/ui';
import { FileNoteForm } from '@/components/files/FileNoteForm';
import { FilesNav } from '@/components/files/FilesNav';
import { Notice } from '@/components/Notice';
import { apiFetch } from '@/lib/api';

/** Add new approval: the subject, the note, the attachments and the approvers the creator chooses. */
export default async function NewFilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const people = await apiFetch<{ data: Array<{ id: string; name: string }> }>(
    '/file-movement/people',
  );
  return (
    <>
      <PageHeader
        kicker="File movement"
        title="Add new approval"
        description="Write what needs approval, attach the papers and choose who approves, in order."
      />
      <FilesNav current="/workflow/files/new" />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <Card>
        <FileNoteForm people={people.data.map((p) => ({ value: p.id, label: p.name }))} />
      </Card>
    </>
  );
}
