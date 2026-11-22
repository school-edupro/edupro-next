import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { StaffLayoutSetup } from '@/lib/staff-layout';
import { StaffLayoutEditor } from './StaffLayoutEditor';

/**
 * Staff app layout (System settings, 0413, docs/design/94): what the staff mobile app shows — the bottom tabs, the Home
 * shortcuts and the Home work cards — as a draft with a preview, published to staff.
 */
export default async function StaffAppLayoutPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('platform.settings.view')) notFound();
  let setup: StaffLayoutSetup;
  try {
    setup = await apiFetch<StaffLayoutSetup>('/platform/staff-app-layout');
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) notFound();
    throw e;
  }
  const canEdit = me.permissions.includes('platform.settings.edit');
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'System settings', href: '/system/settings' },
          { label: 'Staff app layout' },
        ]}
      />
      <PageHeader
        kicker="System settings"
        title="Staff app layout"
        description="What the staff mobile app shows: the bottom tabs, the Home shortcuts and the Home work cards. Each person gets only the screens their rights open, and may pin their own shortcuts. Edit the draft, check the preview, then publish."
      />
      <Notice params={sp} />
      {canEdit ? null : (
        <p className="ep-alert ep-alert--info" role="status">
          You can see the layout; changing it needs the right to edit settings.
        </p>
      )}
      <StaffLayoutEditor
        initial={setup}
        canEdit={canEdit}
        firstName={me.user.displayName.split(/\s+/)[0] ?? ''}
      />
    </>
  );
}
