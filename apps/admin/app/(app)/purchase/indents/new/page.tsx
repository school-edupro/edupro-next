import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IndentForm } from '@/components/purchase/IndentForm';
import { apiFetch, getMe } from '@/lib/api';
import type { IndentFormLists } from '@/lib/purchase';

/** Raise a Purchase Indent (docs/design/83, part 2). */
export default async function NewIndentPage() {
  const me = await getMe();
  if (!me.permissions.includes('purchase.indent.raise')) notFound();
  const lists = await apiFetch<IndentFormLists>('/purchase/indent-form');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase Indents', href: '/purchase/indents' },
          { label: 'Raise an indent' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Indent"
        title="Raise an indent"
        description="Save it as a draft to finish later, or send it to your department’s approvers. It gets its number when sent."
      />
      <IndentForm indent={null} lists={lists} />
    </>
  );
}
