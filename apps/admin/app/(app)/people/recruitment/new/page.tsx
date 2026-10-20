import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { VacancyForm } from '@/components/recruitment/VacancyForm';
import { apiFetch, getMe } from '@/lib/api';
import type { RecruitmentSetup } from '@/lib/recruitment';
import { createVacancy } from '@/lib/recruitment-actions';

/** Raise a vacancy: saved as a draft, then sent for approval from its page. */
export default async function NewVacancyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('people.recruitment.raise')) notFound();
  const setup = await apiFetch<RecruitmentSetup>('/people/recruitment/setup');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Vacancies', href: '/people/recruitment' },
          { label: 'Raise a vacancy' },
        ]}
      />
      <PageHeader
        kicker="Recruitment"
        title="Raise a vacancy"
        description="Saved as a draft; send it for approval from its page."
      />
      <Notice params={sp} />
      <VacancyForm setup={setup} action={createVacancy} submitLabel="Save as draft" />
    </>
  );
}
