import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { SubscriptionForm } from '@/components/library/Periodicals';
import { apiFetch } from '@/lib/api';
import type { SubscriptionSetup } from '@/lib/library-books';

/** A new periodical subscription (docs/design/36-library.md, part 6). */
export default async function NewSubscriptionPage() {
  const setup = await apiFetch<SubscriptionSetup>('/library/subscriptions/setup');
  if (!setup.can.manage) notFound();
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Library', href: '/library' },
          { label: 'Periodicals', href: '/library/periodicals' },
          { label: 'Subscribe' },
        ]}
      />
      <PageHeader
        kicker="Periodicals"
        title="Subscribe"
        description="A periodical for a period: its issues are expected at its frequency, ready to receive."
      />
      <SubscriptionForm setup={setup} />
    </>
  );
}
