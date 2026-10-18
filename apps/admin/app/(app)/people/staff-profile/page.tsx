import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { StaffPolicyEditor, type StaffPolicyView } from '@/components/StaffPolicyEditor';
import { apiFetch, getMe } from '@/lib/api';

/** What staff see and change on their own profile from the staff app (docs/design/33-people-dashboards.md). */
export default async function StaffProfileSettingsPage() {
  const me = await getMe();
  if (!me.permissions.includes('people.staff_profile.manage')) notFound();
  const data = await apiFetch<StaffPolicyView>('/people/staff-profile/policy');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Staff profile settings' },
        ]}
      />
      <PageHeader
        kicker="Employee management"
        title="Staff profile settings"
        description="What staff see on their own profile in the staff app, what they may change (at once or with approval), the document a change needs, who approves, and when."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/people/staff-profile-approvals">
            Approvals
          </a>
        }
      />
      <StaffPolicyEditor data={data} />
    </>
  );
}
