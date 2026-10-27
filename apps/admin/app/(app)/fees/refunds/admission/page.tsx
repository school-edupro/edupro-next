import { PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AdmissionRefundsList } from '@/components/admissions/AdmissionRefundsList';
import { RefundTabs } from '@/components/fees/RefundTabs';
import { getMe } from '@/lib/api';

/**
 * Fees → Refunds → Admission refunds (docs/design/54): Accounts see the admission fee refunds without
 * the Admissions module, act on their level of Fees → Approval and pay the approved ones out.
 */
export default async function FeeAdmissionRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (
    ![
      'fees.refund.request',
      'fees.receipt.post',
      'fees.refund.approve',
      'admissions.application.view',
    ].some((p) => me.permissions.includes(p))
  )
    notFound();
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Refunds"
        description="Admission fee refunds of cancelled registrations and admissions: the amount paid less the session's deduction, approved at the levels of Fees → Approval, then paid out by Accounts with a voucher."
      />
      <RefundTabs current="admission" />
      <AdmissionRefundsList base="/fees/refunds/admission" view={sp.view} />
    </>
  );
}
