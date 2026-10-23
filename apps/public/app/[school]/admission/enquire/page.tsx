import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PublicApiError } from '@/lib/api';
import { admissionFetch, type PortalSession } from '@/lib/admission';
import { AdmissionEnquiryForm } from '@/components/AdmissionEnquiryForm';

/** An admission enquiry from the school's website (docs/design/39, part 8). */
export default async function AdmissionEnquiryPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school } = await params;
  const open = await admissionFetch<{
    school: { name: string; code: string };
    sessions: PortalSession[];
  }>(`/schools/${encodeURIComponent(school)}`, {}, null).catch((error: unknown) => {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  });
  const classes = new Map<string, string>();
  for (const s of open.sessions) for (const k of s.classes) classes.set(k.id, k.name);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title={`Ask ${open.school.name} about admission`}
        description="Leave your details and your question; the admission office will call or write to you."
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}/admission`}>
            Register online
          </a>
        }
      />
      <Card elevated>
        <AdmissionEnquiryForm
          school={school}
          classes={[...classes.entries()].map(([id, name]) => ({ id, name }))}
        />
      </Card>
    </>
  );
}
