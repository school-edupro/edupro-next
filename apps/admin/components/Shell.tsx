import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { endImpersonation } from '@/lib/actions';
import type { Me } from '@/lib/api';
import { SchoolYearSwitcher } from './SchoolYearSwitcher';

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
      { href: '/comms/messages', label: 'deliveryLog', permission: 'comms.message.view' },
    ],
  },
  {
    section: 'engagement',
    items: [
      { href: '/engagement/queries', label: 'queries', permission: 'engagement.query.view' },
      { href: '/engagement/feedback', label: 'feedback', permission: 'engagement.feedback.view' },
      {
        href: '/engagement/change-requests',
        label: 'changeRequests',
        permission: 'engagement.change_request.view',
      },
    ],
  },
  {
    section: 'exams',
    items: [
      { href: '/exams', label: 'examList', permission: 'exams.master.view' },
      { href: '/exams/masters', label: 'examTypes', permission: 'exams.master.view' },
    ],
  },
  {
    section: 'transport',
    items: [
      { href: '/transport/routes', label: 'routes', permission: 'transport.route.view' },
      { href: '/transport/vehicles', label: 'vehicles', permission: 'transport.fleet.view' },
      { href: '/transport/drivers', label: 'drivers', permission: 'transport.fleet.view' },
      {
        href: '/transport/requests',
        label: 'transportRequests',
        permission: 'transport.request.view',
      },
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
    items: [{ href: '/reports/exports', label: 'exportCentre', permission: 'reports.export.view' }],
  },
  {
    section: 'system',
    items: [
      { href: '/system/school', label: 'schoolProfile', permission: 'platform.school.view' },
      { href: '/system/years', label: 'years', permission: 'platform.year.view' },
      { href: '/system/settings', label: 'settings', permission: 'platform.settings.view' },
      { href: '/system/privacy', label: 'privacy', permission: 'platform.privacy.manage' },
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
  const allowed = new Set(me.permissions);
  const isCurrent = (href: string) =>
    href === '/' ? currentPath === '/' : currentPath === href || currentPath.startsWith(`${href}/`);
  const canSearch = allowed.has('people.person.search');
  return (
    <div className="ep-shell">
      <aside className="ep-sidebar" aria-label="Sidebar">
        <div className="ep-sidebar__brand">
          Edu<b>Pro</b>&nbsp;Next
        </div>
        <nav aria-label={t('primaryNavigation')}>
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) => i.permission === null || allowed.has(i.permission),
            );
            if (items.length === 0) return null;
            return (
              <div key={group.section}>
                <div className="ep-nav__section">{nav(group.section)}</div>
                {items.map((item) => (
                  <a
                    key={item.href}
                    className="ep-nav__link"
                    href={item.href}
                    aria-current={isCurrent(item.href) ? 'page' : undefined}
                  >
                    {nav(item.label)}
                  </a>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <header className="ep-header">
        <div className="ep-header__context">
          <SchoolYearSwitcher me={me} />
          {canSearch ? (
            <form
              method="get"
              action="/people/search"
              role="search"
              style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
            >
              <input
                className="ep-input"
                type="search"
                name="q"
                placeholder={t('searchPlaceholder')}
                aria-label={t('search')}
                minLength={2}
                required
                style={{ minWidth: 240 }}
              />
              <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                {t('search')}
              </button>
            </form>
          ) : null}
        </div>
        <div className="ep-header__context">
          <form
            method="post"
            action="/api/locale"
            style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}
          >
            <label className="ep-field__label" htmlFor="locale" style={{ margin: 0 }}>
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
          <span style={{ fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>
            {me.user.displayName}
          </span>
          <form method="post" action="/api/auth/logout">
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              {t('signOut')}
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
