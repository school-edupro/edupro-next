import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { NoticesEditor } from '@/components/recruitment/NoticesEditor';
import { StagesEditor } from '@/components/recruitment/StagesEditor';
import { apiFetch, getMe } from '@/lib/api';
import type { RecruitmentNotices, RecruitmentSetup } from '@/lib/recruitment';

/** Recruitment set-up (docs/design/34-recruitment.md): the school's screening stages; vacancy approval levels live under Workflow. */
export default async function RecruitmentSetupPage() {
  const me = await getMe();
  if (!me.permissions.includes('people.recruitment.view')) notFound();
  const [s, notices] = await Promise.all([
    apiFetch<RecruitmentSetup>('/people/recruitment/setup'),
    apiFetch<RecruitmentNotices>('/people/recruitment/setup/notices'),
  ]);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Vacancies', href: '/people/recruitment' },
          { label: 'Set-up' },
        ]}
      />
      <PageHeader
        kicker="Recruitment"
        title="Recruitment set-up"
        description="The screening stages candidates go through and the notices they get. Who approves a vacancy is set under Workflow (Vacancy approval)."
        actions={
          me.permissions.includes('workflow.definition.view') ? (
            <a className="ep-btn ep-btn--secondary" href="/workflow/definitions">
              Approval levels
            </a>
          ) : undefined
        }
      />
      <StagesEditor stages={s.stages} canEdit={s.can.manage} />
      <NoticesEditor initial={notices} canEdit={s.can.manage} />
    </>
  );
}
