import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { Icon } from '@/components/nav-icons';
import { QuickOnboard } from '@/components/employees/QuickOnboard';
import { onboardEmployee } from '@/lib/employee-actions';
import { apiFetch } from '@/lib/api';
import type { EmployeeCatalogue } from '@/lib/employee';

/** Quick onboarding of an employee: the minimum now, the full profile later (or upload an Excel). */
export default async function OnboardEmployeePage() {
  const catalogue = await apiFetch<EmployeeCatalogue>('/people/staff/catalogue');
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Employees', href: '/people/employees' }, { label: 'Onboard' }]}
      />
      <PageHeader
        kicker="People"
        title="Onboard an employee"
        description="The minimum to start: name, gender, mobile, type, department, designation and the date of joining. The rest is filled on the profile; the completeness shows what is missing."
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/masters/staff"
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="settings" size={16} /> Staff setup
          </a>
        }
      />
      <div style={{ maxWidth: '60rem' }}>
        <QuickOnboard catalogue={catalogue} onboard={onboardEmployee} />
      </div>
    </>
  );
}
