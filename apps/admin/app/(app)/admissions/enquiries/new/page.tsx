import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { EnquiryFields } from '@/components/admissions/EnquiryFields';
import { Notice } from '@/components/Notice';
import type { EnquiryMeta } from '@/lib/admission-enquiry';
import { createEnquiry } from '@/lib/admission-enquiry-actions';
import { apiFetch, getMe } from '@/lib/api';

/** A new admission enquiry: a walk-in, a phone call or a campaign lead (docs/design/39, part 8). */
export default async function NewEnquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('admissions.enquiry.manage')) notFound();
  const meta = await apiFetch<EnquiryMeta>('/admissions/enquiries/meta');
  return (
    <>
      <PageHeader
        kicker="Admissions · Enquiries"
        title="New enquiry"
        description="Note who asked, for which child and class, and where they heard of the school; set the next follow-up."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/admissions/enquiries">
            Enquiries
          </a>
        }
      />
      <Notice params={sp} />
      <Card elevated>
        <form action={createEnquiry} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
          <EnquiryFields meta={meta} />
          <div className="ep-form-actions">
            <button className="ep-btn ep-btn--primary" type="submit">
              Save the enquiry
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}
