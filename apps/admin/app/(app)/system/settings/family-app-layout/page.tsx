import { Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { AUDIENCE_NAME, type FamilyAudience, type FamilyLayoutSetup } from '@/lib/family-layout';
import { FamilyLayoutEditor } from './FamilyLayoutEditor';

/**
 * Family app layout (System settings, 0407, docs/design/90): what the student and the parent app show — the bottom
 * tabs, the Home shortcuts, the Home cards and the Academics tab — as a draft with a preview, published to families.
 */
export default async function FamilyAppLayoutPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const audience: FamilyAudience = sp.for === 'parent' ? 'parent' : 'student';
  const me = await getMe();
  if (!me.permissions.includes('platform.settings.view')) notFound();
  let setup: FamilyLayoutSetup;
  try {
    setup = await apiFetch<FamilyLayoutSetup>('/platform/family-app-layout');
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
          { label: 'Family app layout' },
        ]}
      />
      <PageHeader
        kicker="System settings"
        title="Family app layout"
        description="What the student and the parent app show: the bottom tabs, the Home shortcuts, the Home cards and the Academics tab. The website's Home follows the same shortcuts and cards. Edit the draft, check the preview, then publish."
      />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Whose app">
        {(['student', 'parent'] as const).map((a) => (
          <a
            key={a}
            href={`/system/settings/family-app-layout?for=${a}`}
            aria-current={a === audience ? 'page' : undefined}
          >
            {AUDIENCE_NAME[a]}
            {setup.layouts[a].changed ? ' · draft not published' : ''}
          </a>
        ))}
      </nav>
      {canEdit ? null : (
        <p className="ep-alert ep-alert--info" role="status">
          You can see the layout; changing it needs the right to edit settings.
        </p>
      )}
      <FamilyLayoutEditor key={audience} audience={audience} initial={setup} canEdit={canEdit} />
    </>
  );
}
