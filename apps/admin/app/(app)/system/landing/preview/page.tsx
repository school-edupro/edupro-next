import { LandingView, menuActions, pinnedActions } from '@/components/dashboard/LandingView';
import { apiFetch, getMe } from '@/lib/api';
import { loadWidgets, type Layout } from '@/lib/dashboard';

/**
 * Preview of a role's landing page: the widgets and quick actions its permissions show, in the school's
 * order and titles. The figures are read with your own rights, so a widget the role sees but you cannot
 * open stays empty.
 */
export default async function LandingPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const sp = await searchParams;
  const role = sp.role ?? 'school_admin';
  const [me, p] = await Promise.all([
    getMe(),
    apiFetch<Layout & { permissions: string[] }>(`/dashboard/preview/${encodeURIComponent(role)}`),
  ]);
  const school = me.memberships.find((m) => m.schoolId === me.school?.id);
  const [data, actions] = await Promise.all([
    loadWidgets(p, p.permissions),
    menuActions(p.permissions),
  ]);
  const roleName = p.roleName ?? role;
  return (
    <LandingView
      kicker={`Preview · ${roleName}`}
      title={`Landing Page of ${roleName}`}
      sub={`${school?.schoolName ?? ''} · figures are read with your own rights`}
      aside={
        <a
          className="ep-btn ep-btn--secondary ep-btn--sm"
          href={`/system/landing?role=${encodeURIComponent(role)}`}
        >
          Back to settings
        </a>
      }
      layout={p}
      data={data}
      permissions={p.permissions}
      actions={actions}
      pinned={pinnedActions(p, actions)}
      profile={{ name: 'Sample User', role: roleName, school: school?.schoolName ?? '' }}
    />
  );
}
