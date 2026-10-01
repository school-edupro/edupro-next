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

/** Navigation is projected from permissions (ADR-004 point 10). Labels come from the message catalogue (S4-01). */
const NAV: Array<{
  section: string;
  items: Array<{ href: string; label: string; permission: string | null }>;
}> = [
  { section: 'overview', items: [{ href: '/', label: 'dashboard', permission: null }] },
  {
    section: 'people',
    items: [
      { href: '/people/students', label: 'students', permission: 'people.student.view' },
      { href: '/people/employees', label: 'employees', permission: 'people.employee.view' },
      { href: '/people/search', label: 'peopleSearch', permission: 'people.person.search' },
      { href: '/people/import', label: 'import', permission: 'people.import.run' },
      { href: '/people/tc', label: 'transferCertificates', permission: 'people.tc.view' },
      { href: '/people/withdrawals', label: 'withdrawals', permission: 'people.withdrawal.view' },
      { href: '/people/promotions', label: 'promotions', permission: 'people.promotion.view' },
      {
        href: '/people/profile-approvals',
        label: 'profileApprovals',
        permission: 'engagement.change_request.approve',
      },
      {
        href: '/people/portal-profile',
        label: 'portalProfile',
        permission: 'people.portal_profile.manage',
      },
    ],
  },
  {
    section: 'admissions',
    items: [
      {
        href: '/admissions',
        label: 'admissionsDashboard',
        permission: 'admissions.application.view',
      },
      { href: '/admissions/cycles', label: 'cycles', permission: 'admissions.cycle.view' },
      {
        href: '/admissions/applications',
        label: 'applications',
        permission: 'admissions.application.view',
      },
    ],
  },
  {
    section: 'fees',
    items: [
      { href: '/fees/masters', label: 'feeMasters', permission: 'fees.master.view' },
      { href: '/masters/fees', label: 'feesSetup', permission: 'fees.master.view' },
      { href: '/fees/structures', label: 'feeStructures', permission: 'fees.master.view' },
      { href: '/fees/demands', label: 'feeDemands', permission: 'fees.demand.view' },
      { href: '/fees/payments', label: 'payments', permission: 'payments.intent.view' },
      { href: '/fees/cashier', label: 'cashier', permission: 'fees.receipt.post' },
      { href: '/fees/refunds', label: 'refunds', permission: 'fees.refund.request' },
      { href: '/fees/settlements', label: 'settlements', permission: 'payments.settlement.view' },
      { href: '/fees/adjustments', label: 'adjustments', permission: 'fees.adjustment.request' },
      { href: '/fees/misc', label: 'miscReceipts', permission: 'fees.misc.view' },
      { href: '/fees/reports', label: 'feeReports', permission: 'fees.ledger.view' },
      { href: '/fees/bank', label: 'bankStatements', permission: 'payments.settlement.view' },
      { href: '/fees/shadow', label: 'shadowRun', permission: 'fees.shadow.view' },
      { href: '/fees/month-end', label: 'monthEnd', permission: 'fees.period.view' },
    ],
  },
  {
    section: 'attendance',
    items: [
      { href: '/attendance', label: 'attendanceDashboard', permission: 'attendance.session.view' },
      {
        href: '/attendance/register',
        label: 'attendanceRegister',
        permission: 'attendance.session.view',
      },
      { href: '/attendance/rfid', label: 'rfid', permission: 'attendance.rfid.manage' },
      {
        href: '/attendance/rfid/dashboard',
        label: 'rfidDashboard',
        permission: 'attendance.rfid.manage',
      },
      { href: '/attendance/bus', label: 'busAttendance', permission: 'attendance.bus.view' },
      { href: '/attendance/punches', label: 'punches', permission: 'attendance.punch.view' },
      { href: '/attendance/rules', label: 'attendanceRules', permission: 'attendance.rule.manage' },
    ],
  },
  {
    section: 'workflow',
    items: [
      { href: '/workflow/inbox', label: 'inbox', permission: 'workflow.inbox.act' },
      { href: '/workflow/instances', label: 'instances', permission: 'workflow.instance.view' },
      {
        href: '/workflow/definitions',
        label: 'definitions',
        permission: 'workflow.definition.view',
      },
    ],
  },
  {
    section: 'academics',
    items: [
      { href: '/academics/classes', label: 'classes', permission: 'academics.class.view' },
      { href: '/academics/subjects', label: 'subjects', permission: 'academics.subject.view' },
      { href: '/masters/academics', label: 'academicsSetup', permission: 'academics.class.view' },
      {
        href: '/academics/teacher-assignments',
        label: 'teacherAssignments',
        permission: 'academics.teacher_assignment.view',
      },
      { href: '/academics/timetable', label: 'timetable', permission: 'academics.timetable.view' },
      {
        href: '/academics/substitutions',
        label: 'substitutions',
        permission: 'academics.substitution.view',
      },
      {
        href: '/academics/lesson-plans',
        label: 'lessonPlans',
        permission: 'academics.lesson_plan.view',
      },
      {
        href: '/academics/daily-work',
        label: 'dailyWork',
        permission: 'academics.daily_work.view',
      },
      { href: '/academics/notices', label: 'notices', permission: 'academics.notice.view' },
      { href: '/academics/calendar', label: 'calendar', permission: 'academics.calendar.view' },
      { href: '/academics/gallery', label: 'gallery', permission: 'academics.gallery.view' },
    ],
  },
  {
    section: 'access',
    items: [
      { href: '/access/roles', label: 'roles', permission: 'access.role.view' },
      { href: '/access/assignments', label: 'assignments', permission: 'access.assignment.view' },
      { href: '/access/memberships', label: 'members', permission: 'access.assignment.view' },
      { href: '/access/delegations', label: 'delegations', permission: 'access.delegation.create' },
    ],
  },
  {
    section: 'communication',
    items: [
      { href: '/comms/compose', label: 'compose', permission: 'comms.request.create' },
      { href: '/comms/requests', label: 'requests', permission: 'comms.request.view' },
      { href: '/comms/groups', label: 'groups', permission: 'comms.group.view' },
      { href: '/comms/consents', label: 'consents', permission: 'comms.consent.view' },
      { href: '/comms/templates', label: 'templates', permission: 'comms.template.view' },
      {
        href: '/masters/communication',
        label: 'communicationSetup',
        permission: 'comms.template.view',
      },
      { href: '/comms/messages', label: 'deliveryLog', permission: 'comms.message.view' },
    ],
  },
  {
    section: 'engagement',
    items: [
      { href: '/engagement/queries', label: 'queries', permission: 'engagement.query.view' },
      {
        href: '/engagement/appointments',
        label: 'appointments',
        permission: 'engagement.appointment.view',
      },
      { href: '/engagement/visitors', label: 'visitors', permission: 'engagement.visitor.manage' },
      {
        href: '/engagement/gate-passes',
        label: 'gatePasses',
        permission: 'engagement.gate_pass.view',
      },
      {
        href: '/engagement/consent-forms',
        label: 'consentForms',
        permission: 'engagement.consent_form.manage',
      },
      {
        href: '/engagement/certificates',
        label: 'certificates',
        permission: 'engagement.certificate.issue',
      },
      { href: '/engagement/clinic', label: 'clinic', permission: 'engagement.clinic.manage' },
      { href: '/engagement/cctv', label: 'cctv', permission: 'engagement.cctv.decide' },
      {
        href: '/engagement/employee-queries',
        label: 'employeeQueries',
        permission: 'engagement.employee_query.answer',
      },
      { href: '/engagement/feedback', label: 'feedback', permission: 'engagement.feedback.view' },
    ],
  },
  {
    section: 'exams',
    items: [
      { href: '/exams', label: 'examList', permission: 'exams.master.view' },
      { href: '/exams/masters', label: 'examTypes', permission: 'exams.master.view' },
      { href: '/masters/exams', label: 'examsSetup', permission: 'exams.master.view' },
      { href: '/exams/report-cards', label: 'reportCards', permission: 'exams.report_card.view' },
      {
        href: '/exams/board-results',
        label: 'boardResults',
        permission: 'exams.board_result.view',
      },
    ],
  },
  {
    section: 'transport',
    items: [
      { href: '/transport/routes', label: 'routes', permission: 'transport.route.view' },
      { href: '/transport/vehicles', label: 'vehicles', permission: 'transport.fleet.view' },
      { href: '/masters/transport', label: 'transportSetup', permission: 'transport.route.view' },
      { href: '/transport/gps', label: 'gps', permission: 'transport.gps.view' },
      { href: '/transport/drivers', label: 'drivers', permission: 'transport.fleet.view' },
      {
        href: '/transport/requests',
        label: 'transportRequests',
        permission: 'transport.request.view',
      },
    ],
  },
  {
    section: 'library',
    items: [
      { href: '/library', label: 'catalogue', permission: 'library.catalogue.view' },
      { href: '/library/circulation', label: 'circulation', permission: 'library.loan.circulate' },
      { href: '/library/fines', label: 'fines', permission: 'library.loan.circulate' },
      { href: '/library/stock', label: 'stock', permission: 'library.stock.verify' },
      { href: '/masters/library', label: 'librarySetup', permission: 'library.catalogue.manage' },
    ],
  },
  {
    section: 'insights',
    items: [
      {
        href: '/insights/principal',
        label: 'principalDashboard',
        permission: 'insights.dashboard.view',
      },
      {
        href: '/insights/departments',
        label: 'departments',
        permission: 'insights.department.view',
      },
      { href: '/insights/alerts', label: 'alerts', permission: 'insights.alert.view' },
      { href: '/insights/reports', label: 'aiReports', permission: 'insights.report.view' },
      { href: '/insights/results', label: 'resultsAnalytics', permission: 'insights.results.view' },
      { href: '/insights/group', label: 'groupView', permission: 'insights.group.view' },
      { href: '/insights/assistant', label: 'assistant', permission: 'insights.assistant.use' },
      {
        href: '/insights/assistant/audit',
        label: 'assistantAudit',
        permission: 'insights.assistant.audit',
      },
      {
        href: '/insights/assistant/costs',
        label: 'assistantCosts',
        permission: 'insights.assistant.audit',
      },
    ],
  },
  {
    section: 'reports',
    items: [
      { href: '/reports/builder', label: 'reportBuilder', permission: 'reports.builder.use' },
      { href: '/reports/exports', label: 'exportCentre', permission: 'reports.export.view' },
      { href: '/reports/schedules', label: 'schedules', permission: 'reports.schedule.manage' },
      { href: '/reports/mis', label: 'misCentre', permission: 'insights.mis.view' },
    ],
  },
  {
    section: 'system',
    items: [
      { href: '/system/school', label: 'schoolProfile', permission: 'platform.school.view' },
      { href: '/masters/system', label: 'systemSetup', permission: 'platform.school.view' },
      { href: '/system/years', label: 'years', permission: 'platform.year.view' },
      { href: '/system/settings', label: 'settings', permission: 'platform.settings.view' },
      { href: '/system/privacy', label: 'privacy', permission: 'platform.privacy.manage' },
      { href: '/system/cutover', label: 'cutover', permission: 'platform.cutover.manage' },
      { href: '/system/hypercare', label: 'hypercare', permission: 'platform.hypercare.manage' },
      { href: '/system/templates', label: 'templates', permission: 'platform.template.view' },
      { href: '/system/audit', label: 'auditLog', permission: 'platform.audit.view' },
      { href: '/system/security', label: 'security', permission: 'platform.security.view' },
      {
        href: '/system/service-keys',
        label: 'serviceKeys',
        permission: 'platform.service_key.manage',
      },
      { href: '/system/jobs', label: 'jobs', permission: 'platform.jobs.view' },
    ],
  },
];

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
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const canSearch = allowed.has('people.person.search');
  // open alerts feed the bell; the count is best effort and never blocks the page
  const openAlerts = allowed.has('insights.alert.view')
    ? await apiFetch<{ data: unknown[] }>('/insights/alerts?open=true&size=100')
        .then((r) => r.data.length)
        .catch(() => 0)
    : 0;
  // approvals waiting for me (profile changes, workflow steps, withdrawal clearances): best effort
  const waiting = (await myApprovals(me.permissions).catch(() => [])).reduce(
    (n, g) => n + g.count,
    0,
  );
  const mayApprove = [
    'engagement.change_request.approve',
    'workflow.inbox.act',
    'people.withdrawal.clear',
  ].some((p) => allowed.has(p));
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
      (g.section === 'overview' || g.section === 'system' || !features || features.has(g.section)),
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
            <b>{t('portal')}</b>
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
          <a className="ep-header__user" href="/system/security" title={me.user.displayName}>
            <Icon name="user" size={20} />
            <span className="ep-header__user-name">{me.user.displayName}</span>
          </a>
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
