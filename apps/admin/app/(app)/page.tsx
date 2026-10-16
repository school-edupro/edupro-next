import { ArrangePanel } from '@/components/dashboard/ArrangePanel';
import { LandingView, menuActions, pinnedActions } from '@/components/dashboard/LandingView';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { loadWidgets, type Layout } from '@/lib/dashboard';

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';
};

/**
 * The landing page by role (docs/design/26-admin-landing.md): the widgets of the user's role in the
 * school's or the user's own order, each one only when its permission is held; quick actions with a
 * search over every page the user may open; "Arrange my page" unless the school locked the role.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const school = me.memberships.find((m) => m.schoolId === me.school?.id);
  const layout = me.school ? await apiFetch<Layout>('/dashboard').catch(() => null) : null;
  if (!layout) {
    return (
      <section className="db-hero">
        <div>
          <h1 className="db-hero__title">Welcome, {me.user.displayName}</h1>
          <p className="db-hero__sub">Choose a school at the top to begin.</p>
        </div>
      </section>
    );
  }
  const [data, actions] = await Promise.all([
    loadWidgets(layout, me.permissions),
    menuActions(me.permissions),
  ]);
  const pinned = pinnedActions(layout, actions);
  const dateText = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
  const okText: Record<string, string> = {
    layout: 'Your page is saved.',
    reset: 'Back to the page of your role.',
  };
  const roleName = layout.roleName ?? 'Staff';
  return (
    <LandingView
      kicker={`${dateText}${me.academicYear?.code ? ` · Session ${me.academicYear.code}` : ''}`}
      title={`${greeting()}, ${me.user.displayName.split(' ')[0] ?? ''}`}
      sub={`${roleName}${school ? ` · ${school.schoolName}` : ''}`}
      aside={
        layout.locked ? (
          <span className="db-muted">Page set by the school</span>
        ) : (
          <ArrangePanel
            shown={layout.widgets}
            available={layout.available}
            actions={[
              ...layout.links.map((l) => ({
                href: l.href,
                label: l.label ?? l.href,
                sectionLabel: 'School link',
              })),
              ...actions.map(({ href, label, sectionLabel }) => ({ href, label, sectionLabel })),
            ]}
            pinned={pinned.map((p) => p.href)}
          />
        )
      }
      notice={
        <Notice
          params={{
            ok: sp.ok,
            error: sp.error,
            detail: sp.ok && okText[sp.ok] ? okText[sp.ok] : sp.detail,
          }}
        />
      }
      layout={layout}
      data={data}
      permissions={me.permissions}
      actions={actions}
      pinned={pinned}
      profile={{
        name: me.user.displayName,
        role: roleName,
        school: `${school?.schoolName ?? ''}${me.academicYear?.code ? ` · ${me.academicYear.code}` : ''}`,
      }}
    />
  );
}
