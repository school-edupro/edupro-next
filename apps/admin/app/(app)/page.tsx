import { getTranslations } from 'next-intl/server';
import { ArrangePanel } from '@/components/dashboard/ArrangePanel';
import { QuickActions, type Action } from '@/components/dashboard/QuickActions';
import { Widget, renderWidget } from '@/components/dashboard/Widgets';
import { Notice } from '@/components/Notice';
import { SECTION_ICON } from '@/components/nav-icons';
import { apiFetch, getMe } from '@/lib/api';
import { loadWidgets, type Layout } from '@/lib/dashboard';
import { NAV_ITEMS } from '@/lib/nav';

const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const initials = (name: string) =>
  name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');

/**
 * The landing page by role (docs/design/26-admin-landing.md): the widgets of the user's role in the user's
 * own order, each one only when its permission is held; quick actions with a search over every page the
 * user may open; "Arrange my page" to reorder, hide and pin.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, nav] = await Promise.all([getMe(), getTranslations('nav')]);
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
  const data = await loadWidgets(layout, me.permissions);
  const allowed = new Set(me.permissions);
  const actions: Action[] = NAV_ITEMS.filter(
    (i) => i.href !== '/' && (i.permission === null || allowed.has(i.permission)),
  ).map((i) => ({
    href: i.href,
    label: nav(i.label),
    section: i.section,
    sectionLabel: nav(i.section),
    icon: SECTION_ICON[i.section] ?? 'grid',
  }));
  const byHref = new Map(actions.map((a) => [a.href, a]));
  const pinned = (
    layout.quickActions.length ? layout.quickActions : actions.slice(0, 8).map((a) => a.href)
  )
    .map((h) => byHref.get(h))
    .filter((a): a is Action => !!a);
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
  return (
    <>
      <section className="db-hero">
        <div>
          <p className="db-hero__kicker">
            {dateText}
            {me.academicYear?.code ? ` · Session ${me.academicYear.code}` : ''}
          </p>
          <h1 className="db-hero__title">
            {greeting()}, {me.user.displayName.split(' ')[0]}
          </h1>
          <p className="db-hero__sub">
            {layout.roleName ?? 'Staff'}
            {school ? ` · ${school.schoolName}` : ''}
          </p>
        </div>
        <ArrangePanel
          shown={layout.widgets}
          available={layout.available}
          actions={actions.map(({ href, label, sectionLabel }) => ({ href, label, sectionLabel }))}
          pinned={pinned.map((p) => p.href)}
        />
      </section>
      <Notice
        params={{
          ok: sp.ok,
          error: sp.error,
          detail: sp.ok && okText[sp.ok] ? okText[sp.ok] : sp.detail,
        }}
      />
      <div className="db-grid">
        {layout.widgets.map((w) => {
          if (w.key === 'profile')
            return (
              <div key={w.key} className="db-cell">
                <Widget title={w.title} icon="user">
                  <div className="db-profile">
                    <span className="db-avatar db-avatar--lg" aria-hidden="true">
                      {initials(me.user.displayName)}
                    </span>
                    <div>
                      <strong>{me.user.displayName}</strong>
                      <span className="db-muted" style={{ display: 'block' }}>
                        {layout.roleName ?? 'Staff'}
                      </span>
                      <span className="db-muted" style={{ display: 'block' }}>
                        {school?.schoolName ?? ''}
                        {me.academicYear?.code ? ` · ${me.academicYear.code}` : ''}
                      </span>
                    </div>
                  </div>
                </Widget>
              </div>
            );
          if (w.key === 'quick_actions')
            return (
              <div key={w.key} className={w.wide ? 'db-cell db-cell--wide' : 'db-cell'}>
                <Widget title={w.title} icon="grid">
                  <QuickActions pinned={pinned} all={actions} />
                </Widget>
              </div>
            );
          const node = renderWidget(w.key, w.title, data, { permissions: me.permissions });
          return node ? (
            <div key={w.key} className={w.wide ? 'db-cell db-cell--wide' : 'db-cell'}>
              {node}
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}
