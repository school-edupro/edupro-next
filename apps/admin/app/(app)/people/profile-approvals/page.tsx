import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ProfileApprovals } from '@/components/ProfileApprovals';
import { apiFetch, getMe } from '@/lib/api';
import type { Inbox } from '@/lib/portal-profile';

const SECTIONS = [
  { id: 'student', title: 'Student' },
  { id: 'govt_ids', title: 'Government IDs' },
  { id: 'academic', title: 'Academic' },
  { id: 'previous_school', title: 'Previous school' },
  { id: 'father', title: 'Father' },
  { id: 'mother', title: 'Mother' },
  { id: 'guardian', title: 'Guardian' },
  { id: 'family', title: 'Family' },
  { id: 'address', title: 'Address' },
  { id: 'contact', title: 'Contact' },
  { id: 'sibling', title: 'Sibling' },
  { id: 'transport_health', title: 'Transport and health' },
  { id: 'bank', title: 'Bank details' },
];

/** Profile changes asked for by parents and students, routed to the approvers the school chose. */
export default async function ProfileApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('engagement.change_request.approve')) notFound();
  const canSeeAll =
    me.permissions.includes('engagement.change_request.view') ||
    me.permissions.includes('engagement.change_request.override');
  const box = canSeeAll && (sp.box === 'all' || sp.box === 'decided') ? sp.box : 'mine';
  const initial = await apiFetch<Inbox>(`/engagement/profile-approvals?box=${box}&size=50`);
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'People', href: '/people/students' }, { label: 'Profile approvals' }]}
      />
      <PageHeader
        kicker="People"
        title="Profile approvals"
        description="Changes parents and students asked for on their portal. Compare the value on file with the new one and the proof, then accept or refuse each field; select several to decide them together."
        actions={
          me.permissions.includes('people.portal_profile.manage') ? (
            <a className="ep-btn ep-btn--secondary" href="/people/portal-profile">
              Portal profile settings
            </a>
          ) : undefined
        }
      />
      <ProfileApprovals initial={initial} initialBox={box} sections={SECTIONS} />
    </>
  );
}
