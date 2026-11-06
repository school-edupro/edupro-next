import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CondemnationForm } from '@/components/purchase/CondemnationForm';
import { apiFetch, ApiError } from '@/lib/api';
import type { CondemnationCandidates } from '@/lib/purchase';

/** A new condemnation proposal. */
export default async function NewCondemnationPage() {
  let lists: CondemnationCandidates;
  try {
    lists = await apiFetch<CondemnationCandidates>('/purchase/condemnation-candidates');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Purchase', href: '/purchase' },
          { label: 'Condemnation', href: '/purchase/condemnations' },
          { label: 'Propose' },
        ]}
      />
      <PageHeader
        kicker="Purchase · Condemnation"
        title="Propose condemnation"
        description="List the assets (unserviceable ones come first) and the stock to write off, with why. Saved as a draft; send it to the condemnation committee from its page."
      />
      <CondemnationForm lists={lists} existing={null} />
    </>
  );
}
