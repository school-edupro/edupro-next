import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { PortalPolicyEditor } from '@/components/PortalPolicyEditor';
import { apiFetch, getMe } from '@/lib/api';
import type { PolicyScreen } from '@/lib/portal-profile';

/** What the parent and student portals show of the student profile, what families may change and who approves. */
export default async function PortalProfilePage() {
  const me = await getMe();
  if (!me.permissions.includes('people.portal_profile.manage')) notFound();
  const screen = await apiFetch<PolicyScreen>('/people/portal-profile/policy');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Portal profile settings' },
        ]}
      />
      <PageHeader
        kicker="People"
        title="Portal profile settings"
        description="Choose, field by field, what parents and students see on their portal and what they may change: straight away or after approval, with a proof document where needed. Set who approves and when updates are open."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/people/profile-approvals">
            Profile approvals
          </a>
        }
      />
      <PortalPolicyEditor screen={screen} />
    </>
  );
}
