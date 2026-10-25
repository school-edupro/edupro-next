import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { EnquiryImport } from '@/components/admissions/EnquiryImport';
import { getMe } from '@/lib/api';

/** Enquiries from a sheet (docs/design/45, part 2): the format, then the upload. */
export default async function EnquiryImportPage() {
  const me = await getMe();
  if (!me.permissions.includes('admissions.enquiry.manage')) notFound();
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Enquiries', href: '/admissions/enquiries' }, { label: 'Import' }]}
      />
      <PageHeader
        kicker="Admissions · Enquiries"
        title="Import enquiries"
        description="Add many enquiries at once from an Excel sheet: a fair's list, a campaign's leads, last year's enquiries. A family already among the last year's enquiries (the same mobile or email) is left out as a duplicate."
      />
      <Card title="1. Get the format" style={{ marginBottom: 'var(--sp-4)' }}>
        <p style={{ marginTop: 0 }}>
          One row a family: the parent&rsquo;s name, the mobile or the email, and what else you
          know. Class and source are picked from the school&rsquo;s own lists.
        </p>
        <a className="ep-btn ep-btn--secondary" href="/api/admissions/enquiries-format">
          Download the format (.xlsx)
        </a>
      </Card>
      <Card title="2. Upload the filled sheet">
        <EnquiryImport />
      </Card>
    </>
  );
}
