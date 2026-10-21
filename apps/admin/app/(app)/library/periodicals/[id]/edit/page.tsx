import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SubscriptionForm } from '@/components/library/Periodicals';
import { ApiError, apiFetch } from '@/lib/api';
import type { SubscriptionSetup, SubscriptionView } from '@/lib/library-books';

/** A subscription changed (docs/design/36-library.md, part 6): its expected issues follow. */
export default async function EditSubscriptionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const [setup, s] = await Promise.all([
    apiFetch<SubscriptionSetup>('/library/subscriptions/setup'),
    apiFetch<SubscriptionView>(`/library/subscriptions/${id}`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
  ]);
  if (!s.can.manage || s.status === 'cancelled') notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Periodicals', href: '/library/periodicals' },
          { label: s.periodical, href: `/library/periodicals/${s.id}` },
          { label: 'Edit' },
        ]}
      />
      <PageHeader
        kicker="Periodicals"
        title={`Edit ${s.periodical}`}
        description="The issues received or marked missing stay; the expected ones follow the new dates and frequency."
      />
      <SubscriptionForm setup={setup} initial={s} />
    </>
  );
}
