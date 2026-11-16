import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { OpenWhenReady } from '@/components/certificates/OpenWhenReady';

/**
 * The short step between a certificate's View and its PDF when the PDF is being made (it was cleared after its seven
 * days, or never made): it opens the PDF here by itself once it is ready.
 */
export default async function CertificateOpening({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(sp.export ?? '')) notFound();
  const save = sp.save === '1';
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Certificate register', href: '/certificates' },
          { label: 'Certificate', href: `/certificates/${id}` },
          { label: 'PDF' },
        ]}
      />
      <PageHeader kicker="Certificate" title="Opening the PDF" />
      <OpenWhenReady
        exportId={sp.export!}
        save={save}
        retry={`/certificates/${id}/pdf${save ? '?save=1' : ''}`}
      />
    </>
  );
}
