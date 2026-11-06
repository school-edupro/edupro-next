import { Alert, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IndentForm } from '@/components/purchase/IndentForm';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { IndentDetail, IndentFormLists } from '@/lib/purchase';

/** Change a draft indent, or one sent back for changes (docs/design/83, part 2). */
export default async function EditIndentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('purchase.indent.raise')) notFound();
  const pi = await apiFetch<IndentDetail>(`/purchase/indents/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  if (!pi.can.edit) notFound();
  const lists = await apiFetch<IndentFormLists>('/purchase/indent-form');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Indents', href: '/purchase/indents' },
          { label: pi.number ?? 'Draft', href: `/purchase/indents/${pi.id}` },
          { label: 'Change' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Indent"
        title={`Change ${pi.number ?? 'the draft'}`}
        description={pi.purpose}
      />
      {pi.status === 'sent_back' && pi.decisionNote ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone="warning" title="Sent back for changes">
            {pi.decisionNote}
          </Alert>
        </div>
      ) : null}
      <IndentForm indent={pi} lists={lists} />
    </>
  );
}
