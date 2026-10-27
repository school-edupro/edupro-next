import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionRefundsList } from '@/components/admissions/AdmissionRefundsList';
import { Notice } from '@/components/Notice';
import { getMe } from '@/lib/api';

/**
 * Admission fee refunds of cancelled admissions (docs/design/39, part 6; 54): approved at the levels
 * of Fees → Approval, paid out by Accounts (Fees → Refunds → Admission refunds shows the same).
 */
export default async function AdmissionRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.application.view')) notFound();
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission fee refunds"
        description="When an admission is cancelled after the admission fee (or parts of it), the amount paid less the session's deduction is refunded once the approval levels agree; Accounts pay it out. The registration fee is not refunded."
      />
      <Notice params={sp} />
      <AdmissionRefundsList base="/admissions/refunds" view={sp.view} />
    </>
  );
}
