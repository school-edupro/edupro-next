import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { endImpersonation } from '@/lib/actions';
import type { Me } from '@/lib/api';
import { apiFetch } from '@/lib/api';
import { myApprovals } from '@/lib/approvals';
import { tourFor } from '@/lib/tours';
import { Icon, SECTION_ICON } from './nav-icons';
import { Tour } from './Tour';
import { SchoolYearSwitcher } from './SchoolYearSwitcher';
import { SidebarToggle } from './SidebarToggle';
import { NAV } from '@/lib/nav';

export async function Shell({
  me,
  currentPath,
  children,
}: {
  me: Me;
  currentPath: string;
  children: ReactNode;
}) {
  const [t, nav, common, banner, locale] = await Promise.all([
    getTranslations('shell'),
    getTranslations('nav'),
    getTranslations('common'),
    getTranslations('impersonationBanner'),
    getLocale(),
  ]);
  const tours = await getTranslations('tours');
  const tour = tourFor(currentPath);
  const tourSteps = tour
    ? Array.from({ length: tour.steps }, (_, n) => ({
        title: tours(`${tour.id}.${n + 1}_title`),
        body: tours(`${tour.id}.${n + 1}_body`),
      }))
    : [];
  const allowed = new Set(me.permissions);
  // a menu entry that opens a sub-page (the notices report) still stands for its whole section
  const SECTION_OF: Record<string, string> = { '/academics/notices/report': '/academics/notices' };
  const ALSO: Record<string, string[]> = {
    '/fees/demands': ['/fees/bills'],
    '/fees/cashier': ['/fees/ledger', '/fees/receipt', '/fees/parent-view'],
    '/fees/refunds': ['/fees/refund', '/fees/refund-voucher'],
    '/masters/fees': [
      '/fees/masters',
      '/fees/structures',
      '/fees/rules',
      '/fees/hostel-calendar',
      '/fees/gateways',
      '/fees/layout-preview',
      '/fees/discounts',
      '/fees/approval',
    ],
  };
  const matches = (link: string) => {
    const href = SECTION_OF[link] ?? link;
    // one menu entry can stand for several screens (Fee setup and its tabs)
    const also = ALSO[link] ?? [];
    return href === '/'
      ? currentPath === '/'
      : [href, ...also].some((h) => currentPath === h || currentPath.startsWith(`${h}/`));
  };
  // the most specific link wins: /comms/templates, not also /comms; /people/withdrawals/bulk, not also /people/withdrawals
  const best = NAV.flatMap((g) => g.items.map((i) => i.href))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  const isCurrent = (href: string) => href === best;
  const canSearch = allowed.has('people.person.search');
  // open alerts feed the bell; the count is best effort and never blocks the page
  const openAlerts = allowed.has('insights.alert.view')
    ? await apiFetch<{ data: unknown[] }>('/insights/alerts?open=true&size=100')
        .then((r) => r.data.length)
        .catch(() => 0)
    : 0;
  // approvals waiting for me (profile changes, workflow steps, withdrawal clearances, gate passes): best effort
  const waiting = (await myApprovals(me.permissions).catch(() => [])).reduce(
    (n, g) => n + g.count,
    0,
  );
  // consent forms the signed-in staff member has to answer (docs/design/28-consent-forms.md): best effort
  const isStaff = me.memberships.some((m) => m.personType === 'employee');
  const myForms = isStaff
    ? await apiFetch<{
        forms: Array<{ people: Array<{ kind: string; canAnswer: boolean }> }>;
      }>('/engagement/mine/consent-forms')
        .then((r) => r.forms.filter((f) => f.people.some((p) => p.kind === 'staff')))
        .catch(() => [])
    : [];
  const formsToAnswer = myForms.filter((f) =>
    f.people.some((p) => p.kind === 'staff' && p.canAnswer),
  ).length;
  const mayApprove =
    ['engagement.change_request.approve', 'workflow.inbox.act', 'people.withdrawal.clear'].some(
      (p) => allowed.has(p),
    ) || waiting > 0;
  // queries with me now (header icon) and the user card: best effort, never block the page.
  // Queries are not approvals, so they show only here; people who may only raise still get the icon.
  const mayAnswer = ['helpdesk.ticket.respond', 'helpdesk.provider.respond'].some((p) =>
    allowed.has(p),
  );
  const mayRaise = allowed.has('helpdesk.ticket.raise');
  interface Waiting {
    total: number;
    overdue: number;
    latest: Array<{
      id: string;
      number: string;
      desk: string;
      subject: string;
      overdue: boolean;
      level: number;
    }>;
  }
  const none: Waiting = { total: 0, overdue: 0, latest: [] };
  const [queries, card] = await Promise.all([
    !mayAnswer && !mayRaise
      ? Promise.resolve(null)
      : !mayAnswer
        ? Promise.resolve(none)
        : apiFetch<Waiting>('/helpdesk/waiting').catch(() => (mayRaise ? none : null)),
    apiFetch<{
      name: string;
      roles: string[];
      designation: string | null;
      school: string | null;
      academicYear: string | null;
      mobile: string | null;
      email: string | null;
      thisLogin: { at: string; device: string | null; app: string | null } | null;
      lastLogin: { at: string; device: string | null; app: string | null } | null;
    }>('/me/card').catch(() => null),
  ]);
  const roleLabel = card?.roles.length ? card.roles.join(' · ') : t('portal');
  const at = (v: string) =>
    new Date(v).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  // Sprint 22: pilot feature flags hide whole navigation groups (setting platform.modules_enabled)
  const features = await apiFetch<{ modules: Array<{ module: string; enabled: boolean }> }>(
    '/ops/features',
  )
    .then((f) => new Set(f.modules.filter((m) => m.enabled).map((m) => m.module)))
    .catch(() => null);
  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => i.permission === null || allowed.has(i.permission)),
  })).filter(
    (g) =>
      g.items.length > 0 &&
      (g.section === 'overview' ||
        g.section === 'system' ||
        !features ||
        features.has(g.section) ||
        // appointments ride on the engagement module switch
        ((g.section === 'appointments' || g.section === 'clinic') && features.has('engagement')) ||
        // the hostel rides on the fee module switch (its fee is on the hostel ledger)
        (g.section === 'hostel' && features.has('fees'))),
  );
  const portal =
    me.memberships.find((m) => m.schoolId === me.school?.id)?.schoolName ??
    me.memberships[0]?.schoolName ??
    'EduPro Next';
  return (
    <div className="ep-shell">
      <aside className="ep-sidebar" aria-label="Sidebar">
        <div className="ep-sidebar__brand">
          <span className="ep-sidebar__logo" aria-hidden="true">
            <Icon name="book" size={22} />
          </span>
          <span className="ep-sidebar__brand-text">
            <small>EduPro Next</small>
            <b className="ep-sidebar__role" title={roleLabel}>
              {roleLabel}
            </b>
          </span>
        </div>
        <nav className="ep-nav" aria-label={t('primaryNavigation')}>
          {groups.map((group) => {
            const icon = SECTION_ICON[group.section] ?? 'grid';
            // a single-link section (the dashboard) is a top-level row; the others fold like a tree
            if (group.items.length === 1 && group.items[0]!.href === '/') {
              const item = group.items[0]!;
              return (
                <a
                  key={group.section}
                  className="ep-nav__link ep-nav__link--top"
                  href={item.href}
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                  title={nav(item.label)}
                >
                  <Icon name={icon} />
                  <span className="ep-nav__text">{nav(item.label)}</span>
                </a>
              );
            }
            const active = group.items.some((i) => isCurrent(i.href));
            return (
              <details key={group.section} className="ep-nav__group" open={active}>
                <summary
                  className="ep-nav__link ep-nav__link--top"
                  data-active={active ? 'true' : undefined}
                  title={nav(group.section)}
                >
                  <Icon name={icon} />
                  <span className="ep-nav__text">{nav(group.section)}</span>
                  <span className="ep-nav__chevron" aria-hidden="true">
                    <Icon name="chevron" size={16} />
                  </span>
                </summary>
                <div className="ep-nav__children">
                  {group.items.map((item) => (
                    <a
                      key={item.href}
                      className="ep-nav__link"
                      href={item.href}
                      aria-current={isCurrent(item.href) ? 'page' : undefined}
                      title={nav(item.label)}
                    >
                      <span className="ep-nav__dot" aria-hidden="true" />
                      <span className="ep-nav__text">{nav(item.label)}</span>
                    </a>
                  ))}
                </div>
              </details>
            );
          })}
        </nav>
        <div className="ep-sidebar__foot">
          <SidebarToggle className="ep-sidebar__collapse" label={t('collapse')}>
            <Icon name="back" size={18} />
            <span className="ep-nav__text">{t('collapse')}</span>
          </SidebarToggle>
        </div>
      </aside>
      <header className="ep-header">
        <div className="ep-header__context">
          <SidebarToggle className="ep-header__icon-btn" label={t('toggleSidebar')}>
            <Icon name="menu" size={22} />
          </SidebarToggle>
          <div className="ep-header__module">
            <SchoolYearSwitcher me={me} />
          </div>
          <span className="ep-header__crumb">{portal}</span>
          {canSearch ? (
            <form method="get" action="/people/search" role="search" className="ep-header__search">
              <Icon name="search" size={18} />
              <input
                className="ep-header__search-input"
                type="search"
                name="q"
                placeholder={t('searchPlaceholder')}
                aria-label={t('search')}
                minLength={2}
                required
              />
            </form>
          ) : null}
        </div>
        <div className="ep-header__context">
          <form method="post" action="/api/locale" className="ep-header__locale">
            <label className="ep-sr-only" htmlFor="locale">
              {t('language')}
            </label>
            <select id="locale" name="locale" className="ep-select" defaultValue={locale}>
              <option value="en">English</option>
              <option value="hi">हिन्दी</option>
            </select>
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              {common('apply')}
            </button>
          </form>
          <a className="ep-header__icon-btn" href="/help" aria-label={t('help')} title={t('help')}>
            <Icon name="book" size={20} />
          </a>
          {tour ? (
            <Tour
              id={tour.id}
              steps={tourSteps}
              labels={{
                show: tours('show'),
                next: tours('next'),
                back: tours('back'),
                done: tours('done'),
                skip: tours('skip'),
                stepOfTemplate: String(tours.raw('stepOf')),
              }}
            />
          ) : null}
          {queries ? (
            <details className="ep-qmenu">
              <summary
                className="ep-header__icon-btn ep-header__bell"
                aria-label={`Queries with me: ${String(queries.total)}${queries.overdue ? `, ${String(queries.overdue)} past due` : ''}`}
                title={`Queries with me: ${String(queries.total)}`}
              >
                <Icon name="message" size={22} />
                {queries.total > 0 ? (
                  <span
                    className={`ep-header__badge ${queries.overdue ? '' : 'ep-header__badge--calm'}`}
                  >
                    {queries.total > 99 ? '99+' : queries.total}
                  </span>
                ) : null}
              </summary>
              <div className="ep-qmenu__panel">
                <div className="ep-qmenu__head">
                  Queries with me · {queries.total}
                  {queries.overdue ? ` · ${String(queries.overdue)} past due` : ''}
                </div>
                {queries.latest.length ? (
                  <ul className="ep-qmenu__list">
                    {queries.latest.map((q) => (
                      <li key={q.id}>
                        <a href={`/engagement/helpdesk/${q.desk}/${q.id}`}>
                          <span className="ep-qmenu__no">{q.number}</span> {q.subject}
                          {q.overdue ? <span className="ep-qmenu__late"> · past due</span> : null}
                          {q.level > 1 ? (
                            <span className="ep-qmenu__late"> · level {q.level}</span>
                          ) : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="ep-qmenu__empty">Nothing waiting for you.</p>
                )}
                <div className="ep-qmenu__links">
                  {mayAnswer ? (
                    <>
                      <a href="/engagement/helpdesk/parent?view=assigned">Parent queries</a>
                      <a href="/engagement/helpdesk/staff?view=assigned">Staff queries</a>
                      <a href="/engagement/helpdesk/provider?view=assigned">ERP tickets</a>
                    </>
                  ) : (
                    <a href="/engagement/helpdesk/staff?view=mine">Queries I raised</a>
                  )}
                </div>
                {mayRaise ? (
                  <div className="ep-qmenu__actions">
                    <a
                      className="ep-btn ep-btn--primary ep-btn--sm"
                      href="/engagement/helpdesk/staff/new"
                    >
                      Raise a query
                    </a>
                    <a
                      className="ep-btn ep-btn--ghost ep-btn--sm"
                      href="/engagement/helpdesk/provider/new"
                    >
                      Raise an ERP ticket
                    </a>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
          {myForms.length ? (
            <a
              className="ep-header__icon-btn ep-header__bell"
              href="/my-forms"
              aria-label={`My forms: ${String(formsToAnswer)} to answer`}
              title={`My forms: ${String(formsToAnswer)} to answer`}
            >
              <Icon name="clipboard" size={22} />
              {formsToAnswer > 0 ? (
                <span className="ep-header__badge">
                  {formsToAnswer > 99 ? '99+' : formsToAnswer}
                </span>
              ) : null}
            </a>
          ) : null}
          {mayApprove ? (
            <a
              className="ep-header__icon-btn ep-header__bell"
              href="/approvals"
              aria-label={t('approvals', { count: waiting })}
              title={t('approvals', { count: waiting })}
            >
              <Icon name="inbox" size={22} />
              {waiting > 0 ? (
                <span className="ep-header__badge">{waiting > 99 ? '99+' : waiting}</span>
              ) : null}
            </a>
          ) : null}
          {allowed.has('insights.alert.view') ? (
            <a
              className="ep-header__icon-btn ep-header__bell"
              href="/insights/alerts"
              aria-label={t('notifications', { count: openAlerts })}
              title={t('notifications', { count: openAlerts })}
            >
              <Icon name="bell" size={22} />
              {openAlerts > 0 ? (
                <span className="ep-header__badge">{openAlerts > 99 ? '99+' : openAlerts}</span>
              ) : null}
            </a>
          ) : null}
          <div className="ep-usercard">
            <a
              className="ep-header__user"
              href="/system/security"
              aria-label={`My account: ${me.user.displayName}`}
              aria-describedby="ep-usercard-panel"
            >
              <Icon name="user" size={20} />
              <span className="ep-header__user-name">{me.user.displayName}</span>
            </a>
            <div className="ep-usercard__panel" id="ep-usercard-panel" role="tooltip">
              <div className="ep-usercard__name">{card?.name ?? me.user.displayName}</div>
              {card?.designation ? (
                <div className="ep-usercard__muted">{card.designation}</div>
              ) : null}
              <dl className="ep-usercard__facts">
                <div>
                  <dt>Role</dt>
                  <dd>{card?.roles.length ? card.roles.join(', ') : '—'}</dd>
                </div>
                <div>
                  <dt>School</dt>
                  <dd>
                    {card?.school ?? portal}
                    {card?.academicYear ? ` · ${card.academicYear}` : ''}
                  </dd>
                </div>
                {card?.mobile ? (
                  <div>
                    <dt>Mobile</dt>
                    <dd>{card.mobile}</dd>
                  </div>
                ) : null}
                {card?.email ? (
                  <div>
                    <dt>Email</dt>
                    <dd>{card.email}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Last sign-in</dt>
                  <dd>
                    {card?.lastLogin
                      ? `${at(card.lastLogin.at)}${card.lastLogin.device ? ` · ${card.lastLogin.device}` : ''}`
                      : 'This is the first recorded sign-in'}
                  </dd>
                </div>
                {card?.thisLogin ? (
                  <div>
                    <dt>Signed in now</dt>
                    <dd>
                      {at(card.thisLogin.at)}
                      {card.thisLogin.device ? ` · ${card.thisLogin.device}` : ''}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          </div>
          <form method="post" action="/api/auth/logout">
            <button
              type="submit"
              className="ep-header__icon-btn"
              aria-label={t('signOut')}
              title={t('signOut')}
            >
              <Icon name="logout" size={22} />
            </button>
          </form>
        </div>
      </header>
      <main className="ep-main">
        {me.impersonation ? (
          <div
            className="ep-alert ep-alert--warning"
            role="status"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--sp-3)',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <span>
              {banner('acting', {
                name: me.user.displayName,
                until: new Date(me.impersonation.expiresAt).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
            </span>
            <form action={endImpersonation}>
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {banner('end')}
              </button>
            </form>
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
