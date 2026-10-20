import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ApprovalLevelsEditor } from '@/components/recruitment/ApprovalLevelsEditor';
import { NoticesEditor } from '@/components/recruitment/NoticesEditor';
import { StagesEditor } from '@/components/recruitment/StagesEditor';
import { VacancyShare } from '@/components/recruitment/VacancyShare';
import { apiFetch, getMe } from '@/lib/api';
import type { ApprovalSetup, RecruitmentNotices, RecruitmentSetup } from '@/lib/recruitment';

/**
 * Recruitment set-up (docs/design/34-recruitment.md): who approves a vacancy, the school's careers page,
 * the screening stages candidates go through and the notices they get.
 */
export default async function RecruitmentSetupPage() {
  const [me, s, notices, approval, careers] = await Promise.all([
    getMe(),
    apiFetch<RecruitmentSetup>('/people/recruitment/setup'),
    apiFetch<RecruitmentNotices>('/people/recruitment/setup/notices'),
    apiFetch<ApprovalSetup>('/people/recruitment/setup/approval'),
    apiFetch<{ url: string; open: number }>('/people/recruitment/setup/careers'),
  ]).catch(() => notFound());
  if (!me.permissions.includes('people.recruitment.view')) notFound();
  const school =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ?? 'our school';
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
        description="Who approves a vacancy, the school’s careers page, the screening stages candidates go through and the notices they get."
      />
      <ApprovalLevelsEditor setup={approval} />
      <section
        className="ep-card"
        aria-labelledby="rc-h"
        style={{ padding: 'var(--sp-4)', marginTop: 'var(--sp-4)' }}
      >
        <h2 id="rc-h" className="ep-card__title">
          Careers page
        </h2>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Every vacancy open now, on one page: put the link on the school website, or the QR on the
          notice board. Candidates sign in with their mobile number or email to apply.
        </p>
        <VacancyShare
          url={careers.url}
          qrSrc="/api/vacancy-share?kind=careers"
          qrSave="/api/vacancy-share?kind=careers&save=1"
          qrAlt="QR code of the school’s careers page"
          shareText={`Jobs at ${school}:`}
          note={
            careers.open
              ? `${String(careers.open)} vacanc${careers.open > 1 ? 'ies are' : 'y is'} open now.`
              : 'No vacancy is open now: the page says so until one is published.'
          }
        />
      </section>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <StagesEditor stages={s.stages} canEdit={s.can.manage} />
      </div>
      <NoticesEditor initial={notices} canEdit={s.can.manage} />
    </>
  );
}
