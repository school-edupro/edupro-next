import { AdmissionReview, PageHeader, type AdmissionReviewData } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { approvalDecide, approvalPoints, approvalSendBack } from '../actions';

/** The review of a registration waiting at my level (docs/design/50). */
export default async function AdmissionApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const data = await bff.api
    .fetch<AdmissionReviewData>(`/admissions/approvals/${id}`)
    .catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    });
  return (
    <>
      <PageHeader
        kicker="Admission approvals"
        title={data.candidate ?? 'Registration'}
        description="Look at the form, the documents and the points, then decide with your remark."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admission-approvals">
            All approvals
          </a>
        }
      />
      <AdmissionReview
        data={data}
        backHref="/admission-approvals"
        fileBase={`/api/admission-approvals/${id}/files`}
        actions={{
          decide: approvalDecide.bind(null, id),
          sendBack: approvalSendBack.bind(null, id),
          points: approvalPoints.bind(null, id),
        }}
      />
    </>
  );
}
