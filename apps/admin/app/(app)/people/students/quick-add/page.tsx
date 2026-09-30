import { Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { QuickAddStudent } from '@/components/QuickAddStudent';
import { nextStudentNumbers, quickAddStudent } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ProfileCatalogue } from '@/lib/profile';
import { sectionOptions } from '@/lib/sections';

export default async function QuickAddPage({
  searchParams,
}: {
  searchParams: Promise<{ classSectionId?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.student.create')) notFound();
  const [catalogue, sections] = await Promise.all([
    apiFetch<ProfileCatalogue>('/people/profile/catalogue'),
    sectionOptions(),
  ]);
  const sectionId =
    sp.classSectionId && sections.some((s) => s.value === sp.classSectionId)
      ? sp.classSectionId
      : '';
  const numbers = await nextStudentNumbers(sectionId);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Students', href: '/people/students' },
          { label: 'Quick add' },
        ]}
      />
      <PageHeader
        kicker="People"
        title="Quick add student"
        description="The minimum the ERP needs to run fees, attendance and SMS from today. Complete the full profile later; the student shows as incomplete until then."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/people/students/new">
            Full admission form
          </a>
        }
      />
      <Card>
        <QuickAddStudent
          catalogue={catalogue}
          sections={sections}
          initialSectionId={sectionId}
          initialNumbers={numbers}
          add={quickAddStudent}
          next={nextStudentNumbers}
        />
      </Card>
    </>
  );
}
