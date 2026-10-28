/**
 * Accessibility pass on the Phase 2 admin screens (S10): axe-core against each page as the school admin,
 * failing on serious and critical violations. Run with the API and admin app up (AUTH_DEV_BYPASS=1).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInAsDeveloper } from './helpers';

const PAGES = [
  '/',
  '/people/students',
  '/academics/timetable',
  '/academics/daily-work',
  '/academics/notices',
  '/admissions',
  '/admissions/applications',
  '/admissions/forms',
  '/admissions/forms/1',
  '/admissions/setup',
  '/admissions/setup/score-tables',
  '/admissions/setup/score-tables?t=locality',
  '/admissions/setup/score-tables?t=alumni_school',
  '/admissions/setup/numbers',
  '/admissions/score-report',
  '/admissions/approvals',
  '/admissions/approvals?tab=decided',
  // a sample registration's review (scripts/seed-admission-merit.mjs); a new seed changes the ids
  '/admissions/approvals/1404',
  // Fees → Cashier, admission fees (docs/design/52)
  '/fees/cashier/admission',
  // admission fee refunds through the levels of Fees → Approval (docs/design/54)
  '/fees/refunds/admission',
  '/fees/refunds/admission?view=all',
  '/fees/cashier/admission?due=0&q=GOEL',
  '/admissions/desk',
  // a sample registration of scripts/seed-admission-merit.mjs (docs/design/49); a new seed changes the ids
  '/admissions/desk/1404',
  '/admissions/registrations/1404',
  '/admissions/schedule',
  '/admissions/schedule/143',
  '/admissions/schedule/143?tab=excel',
  '/admissions/schedule/143?tab=allot',
  '/admissions/schedule/143?tab=details',
  '/admissions/selection',
  '/admissions/setup/papers',
  '/admissions/setup/papers?view=list',
  '/admissions/results',
  '/admissions/admit',
  '/admissions/refunds',
  '/admissions/list',
  '/admissions/fee-collection',
  '/admissions/enquiries',
  '/admissions/enquiries/new',
  '/admissions/enquiries/report',
  '/admissions/enquiries/7',
  '/admissions/cycles',
  '/admissions/cycles/4',
  '/fees/demands',
  '/fees/payments',
  '/workflow/inbox',
  '/attendance',
  '/attendance/register',
  '/attendance/bus-roll',
  '/attendance/bus-roll?route=16&trip=pick',
  '/attendance/registers',
  '/attendance/registers?kind=bus&route=16&trip=pick',
  '/attendance/setup',
  '/academics',
  '/academics/notices/new',
  '/academics/daily-work?view=report',
  '/academics/daily-work?date=2026-10-07&c=169&s=143',
  '/academics/daily-work?view=assignments&c=169',
  '/academics/settings',
  '/attendance/upload',
  '/academics/syllabus',
  '/academics/lesson-plans?tab=report',
  '/academics/lesson-plans?tab=dashboard',
  '/academics/lesson-plans?tab=approvers',
  '/academics/lesson-plans/9',
  '/staff/activity',
  '/staff/activity/review',
  '/staff/activity/dashboard',
  '/staff/activity/setup',
  '/academics/syllabus/coverage',
  '/academics/documents?new=1',
  '/academics/teacher-assignments?new=1',
  '/academics/calendar?new=event',
  '/masters/academics?tab=class_subjects',
  '/academics/notices/report',
  '/academics/documents',
  '/academics/acknowledgements?type=notice&id=1',
  '/workflow/files',
  '/workflow/files/new',
  '/workflow/files/9',
  '/workflow/files/dashboard',
  '/masters/attendance',
  '/attendance/leaves',
  '/attendance/registers?kind=bus&route=16',
  '/academics/teacher-assignments',
  '/attendance/rfid/dashboard',
  '/comms/compose',
  '/comms/requests',
  '/comms/consents',
  '/engagement/queries',
  '/engagement/feedback',
  '/engagement/change-requests',
  '/masters/transport',
  '/masters/transport?tab=transport_stoppages&add=1',
  '/masters/transport?tab=transport_vehicles&add=1',
  '/masters/transport?tab=transport_drivers',
  '/masters/transport?tab=transport_route_vehicles&add=1',
  '/transport/routes/16',
  '/academics/substitutions',
  '/academics/lesson-plans',
  '/attendance/rules',
  '/system/privacy',
  '/system/sign-in',
  '/fees/masters',
  '/fees/rules',
  '/fees/hostel-calendar',
  '/fees/gateways',
  '/fees/rules?classId=3282',
  '/fees/structures?classId=3282',
  '/fees/discounts',
  '/fees/approval',
  '/fees/parent-view/89816',
  '/fees/opening-balances',
  '/fees/fnf/12312',
  '/people/withdrawals/225',
  '/fees/refund/13740',
  '/fees/refund-voucher/76',
  '/fees/ledger/89816?tab=waive',
  '/fees/ledger/89816?tab=latefee',
  '/access/roles',
  '/access/roles/37',
  '/workflow/definitions',
  '/fees/carry-forward',
  '/fees/deposit-slips',
  '/fees/requests',
  '/fees/requests?tab=new',
  '/fees/requests?tab=settlement',
  '/fees/requests?tab=collection',
  '/fees/bills?classId=3282',
  '/fees/demands?classId=3282',
  '/fees/bills?studentId=12229&view=parent',
  '/fees/tax-certificate/12229',
  '/fees/fnf/12229',
  '/hostel',
  '/system/landing',
  '/system/landing/preview?role=accountant',
  '/hostel/withdrawals?status=all',
  '/hostel/withdrawals/new?student=12307',
  '/hostel/withdrawals/settings',
  '/hostel/withdrawals/42',
  '/hostel/withdrawals/87',
  '/people/withdrawals/79',
  '/hostel/allot?student=12307',
  '/hostel/allot?sq=sharma',
  '/hostel/register',
  '/hostel/setup',
  '/hostel/setup?tab=types',
  '/hostel/setup?tab=rooms',
  '/hostel/upload',
  '/hostel/leave',
  '/hostel/leave?show=all',
  '/hostel/rollcall',
  '/hostel/setup?tab=rules',
  '/hostel/setup?tab=approval',
  '/hostel/rollcall/register?hostel=14&month=2026-10',
  '/hostel/visitors',
  '/hostel/visitors?show=all',
  '/engagement/helpdesk/hostel/new?hostel=14',
  '/hostel/complaints?hostel=14',
  '/hostel/visitors?tab=approve',
  '/hostel/visitors?tab=download',
  '/hostel/visitors?tab=lists&q=sharma&student=12307',
  '/engagement/visitors/new?kind=hostel&q=sharma&student=12307',
  '/hostel/mess?hostel=14',
  '/hostel/mess/menu?hostel=14',
  '/hostel/mess/attendance?hostel=14',
  '/hostel/mess/register?hostel=14&month=2026-10',
  '/hostel/mess/headcount',
  '/hostel/mess/diets',
  '/hostel/mess/diets?hostel=14&edit=12307',
  '/hostel/mess/feedback',
  '/hostel/mess/setup',
  '/hostel/dashboard',
  '/hostel/complaints',
  '/hostel/incidents',
  '/hostel/incidents?status=not_closed&severity=serious',
  '/hostel/incidents/20',
  '/hostel/incidents?sq=sharma&student=12307',
  '/engagement/helpdesk/hostel',
  '/fees/reports?report=mode_summary&from=2026-04-01&to=2026-10-08',
  '/fees/reports?report=cheque_bounce',
  '/fees/structures',
  '/insights/principal',
  '/fees/cashier',
  '/fees/cashier?q=demo',
  '/fees/ledger/89814',
  '/fees/ledger/89814?tab=receipts',
  '/fees/ledger/89814?tab=dues',
  '/fees/receipt/8942',
  '/fees/refunds',
  '/fees/settlements',
  '/transport',
  '/transport/requests',
  '/transport/requests?tab=all',
  '/transport/requests/new?sq=diya',
  '/transport/requests/new?sq=diya&student=12387',
  '/transport/requests/approvals',
  '/transport/requests/394',
  '/transport/history',
  '/transport/history?when=all&studentId=12307',
  '/transport/setup',
  '/transport/papers',
  '/transport/papers?state=all',
  '/transport/replacements',
  '/transport/replacements?add=1',
  '/transport/reports',
  '/transport/reports?r=fee-months',
  '/transport/reports?r=fee-students',
  '/transport/reports/fee/12387',
  '/insights/departments',
  '/insights/departments/fees',
  '/fees/adjustments',
  '/fees/misc',
  '/fees/misc-fees',
  '/fees/misc-fees?tab=announce',
  '/fees/misc-fees/collect',
  '/fees/reports',
  '/fees/reports?report=defaulters',
  '/fees/bank',
  '/exams',
  '/exams/masters',
  '/academics/subjects',
  '/exams/5',
  '/insights/assistant',
  '/insights/alerts',
  // Sprint 16
  '/fees/shadow',
  '/system/service-keys',
  '/insights/reports',
  '/insights/assistant/costs',
  // master-data framework
  '/masters/fees?tab=fee_heads',
  '/masters/academics?tab=class_sections&add=1',
  '/masters/exams?tab=grade_bands&upload=1',
  // Sprint 17
  '/workflow/definitions?new=1',
  '/exams/report-cards',
  '/exams/report-cards/templates',
  '/transport/gps',
  '/library',
  '/library/circulation',
  '/library/circulation?tab=return',
  '/library/circulation?tab=borrower',
  '/library/circulation?tab=class',
  '/library/history',
  '/library/history?view=circulation&what=overdue&from=&to=',
  '/library/history?view=student&show=all&sort=holding',
  '/library/history?view=employee',
  '/library/history/student/12261',
  '/library/history/student/12261?from=2026-08-01&to=2026-08-31',
  '/library/fines',
  '/library/fines?tab=requests&rstatus=pending',
  '/library/fines?tab=collected&from=2026-04-01',
  '/library/fines?tab=waived&borrower=student',
  '/library/fines?tab=outstanding&act=l302',
  // Sprint 18
  '/exams/board-results',
  '/library/stock',
  '/library/dashboard',
  '/library/check',
  '/library/check?view=history',
  '/library/check?view=find&q=a',
  '/library/check/18',
  '/library/stock?new=1',
  '/library/stock/1',
  '/library/stock/52',
  '/library/stock/1?state=extras',
  '/library/stock/1?state=all&q=a',
  '/library/sales',
  '/library/sales?from=&to=&state=due&buyer=other',
  '/library/sales/new',
  '/library/sales/upload',
  '/library?view=copies&status=stock_missing',
  '/library?view=copies&sort=accession',
  '/library/accession',
  '/library/charges',
  '/library/charges?status=paid&from=2026-04-01&to=2026-10-31',
  '/fees/misc-fees/collect?staff=riya',
  '/fees/misc-fees/collect?employeeId=31',
  '/library/charges?kind=lost&acc=1001',
  '/library/charges?kind=damaged&acc=1001',
  '/library/accession?preview=1&from=1001&start=1001',
  '/library?author=a&stock=never',
  '/library/import',
  '/library/import?mode=update',
  '/library/import/14',
  '/library/import/14?kind=warnings',
  '/library/labels',
  '/library/labels?title=1',
  '/library/periodicals',
  '/library/periodicals?tab=subscriptions&status=all',
  '/library/periodicals/new',
  '/library/books/new',
  '/library/books/1',
  '/library/books/1?tab=loans',
  '/library/books/1?tab=history',
  '/library/books/1/edit',
  '/masters/library',
  '/library/staff',
  '/library/reservations',
  '/library/reservations?status=ended',
  '/masters/library?tab=library_accession_series',
  '/masters/library?tab=library_borrow_rules&add=1',
  '/masters/library?tab=library_periodicals&add=1',
  '/masters/library?tab=library_authors&edit=35',
  '/masters/library?tab=library_periodical_kinds',
  '/masters/library?tab=library_vendors',
  '/insights/results',
  // Sprint 19
  '/engagement/appointments',
  '/engagement/appointments?state=all',
  '/engagement/appointments/new?host=43&date=2026-10-12',
  '/engagement/appointments/57',
  '/engagement/appointments/57?rhost=44&rdate=2026-10-12',
  '/engagement/appointments/calendar?day=2026-10-05',
  '/engagement/appointments/dashboard',
  '/engagement/appointments/gate',
  '/engagement/appointments/setup',
  '/engagement/appointments/mine',
  '/engagement/appointments/mine?when=past',
  '/engagement/appointments/mine?view=calendar',
  '/engagement/appointments/64/card',
  '/engagement/appointments/new?host=43&date=2026-10-12&sq=aarav',
  '/engagement/visitors',
  '/engagement/visitors?state=all',
  '/engagement/visitors/new',
  '/engagement/visitors/7',
  '/engagement/visitors/7/card',
  '/engagement/front-office',
  '/engagement/clinic',
  '/engagement/clinic/visits?tab=all',
  '/engagement/clinic/visits/new',
  '/engagement/clinic/visits/40',
  '/engagement/clinic/checkups',
  '/engagement/clinic/checkups/2',
  '/engagement/clinic/checkups/2/143?student=12307',
  '/engagement/clinic/stock',
  '/engagement/clinic/visits/100',
  '/engagement/clinic/cards/7',
  '/engagement/clinic/checkups/5?q=sharma',
  '/engagement/clinic/checkups/5/143?student=12307&from=search',
  '/engagement/clinic/setup',
  '/engagement/clinic/setup?tab=medicine&add=1',
  '/engagement/clinic/setup?tab=form',
  '/engagement/clinic/setup?tab=messages',
  '/engagement/clinic/stock?view=batches',
  '/engagement/clinic/stock?view=moves',
  '/engagement/clinic/stock?view=receive',
  '/engagement/gate-passes',
  '/engagement/gate-passes?stage=all',
  '/engagement/gate-passes/new?sq=aarav',
  '/engagement/gate-passes/approvals',
  '/engagement/gate-passes/gate?found=60',
  '/engagement/gate-passes/mine',
  '/engagement/gate-passes/mine/new',
  '/engagement/gate-passes/setup',
  '/engagement/gate-passes/60',
  '/engagement/gate-passes/61',
  '/engagement/gate-passes/60/card',
  '/engagement/consent-forms',
  '/engagement/consent-forms/new',
  '/engagement/consent-forms/6',
  '/engagement/consent-forms/6?tab=pending',
  '/engagement/consent-forms/6/fill?who=student:12230',
  '/engagement/consent-forms/6/edit',
  '/engagement/consent-forms/1/responses/1',
  '/engagement/consent-forms/1/analytics',
  '/engagement/consent-forms/6/connect',
  '/engagement/consent-forms/6/share',
  '/engagement/consent-forms/6/preview',
  '/engagement/consent-forms/dashboard',
  '/fees/dashboard',
  '/fees/dashboard?ledger=misc',
  '/fees/dashboard?by=term',
  '/people/employees',
  '/people/employees/new',
  '/people/employees/bulk',
  '/people/employees/bulk?mode=create',
  '/reports/builder/new?dataset=employee_profile',
  '/people/employees/37',
  '/people/employees/37?tab=profile',
  '/people/employees/37?tab=education',
  '/people/employees/37?tab=training',
  '/people/employees/37?tab=history',
  '/people/employees/37?tab=posting',
  '/people/employees/37?tab=documents',
  '/masters/staff?tab=employee_document_types',
  '/masters/staff',
  '/transport?by=month',
  '/my-forms',
  '/me/profile',
  '/me/acr',
  '/engagement/certificates',
  '/engagement/cctv',
  '/engagement/employee-queries',
  '/reports/schedules',
  '/reports/mis',
  // Sprints 22-23
  '/system/school',
  '/masters/system?tab=countries',
  '/masters/fees?tab=bank_accounts&add=1',
  '/system/cutover',
  '/system/hypercare',
  '/fees/month-end',
  '/help',
  '/help/fees',
  '/help/students',
  // Student 360 profile
  '/people/students/quick-add',
  '/masters/system?tab=profile_lists',
  '/people/students/bulk',
  '/people/students/bulk?mode=create',
  '/reports/builder',
  '/reports/builder/new',
  // portal profile and profile approvals (2026-10-01)
  '/people/portal-profile',
  '/people/profile-approvals',
  '/people/profile-approvals?box=all',
  '/people/profile-approvals?box=decided',
  '/approvals',
  '/people/roll-numbers?section=143',
  '/people/school-transfers',
  '/people/staff-transfers',
  '/people/dashboard',
  '/people/staff-dashboard',
  '/people/staff-profile',
  '/people/staff-profile-approvals',
  '/people/acr',
  '/people/acr/38',
  '/people/acr/print?ids=38',
  '/people/employees/36?tab=acr',
  '/people/acr/setup',
  '/people/acr/setup?tab=levels',
  '/people/acr/setup?tab=assessors',
  '/people/acr/setup?tab=questions&part=rate&group=non_teaching',
  '/people/acr/setup?tab=grades',
  '/people/acr/setup?tab=remarks',
  '/people/recruitment',
  '/people/recruitment/new',
  '/people/recruitment/setup',
  '/people/exits',
  '/people/exits/new',
  '/people/exits/clearance',
  '/people/exits/register',
  '/people/exits/setup',
  '/people/exits/setup?type=non_teaching',
  '/people/recruitment/4',
  '/people/recruitment/35',
  '/people/recruitment/candidates',
  '/people/recruitment/candidates?vacancy=4&stage=9',
  '/people/recruitment/applications/7',
  '/people/recruitment/applications/7?tab=application',
  '/people/recruitment/applications/7?tab=education',
  '/people/recruitment/applications/7?tab=documents',
  '/people/recruitment/applications/7?tab=history',
  '/comms',
  '/comms/groups?new=1',
  '/comms/templates?channel=whatsapp',
  '/comms/templates?channel=variables',
  '/comms/templates/new?channel=email',
  '/comms/settings',
  '/comms/reports',
  '/comms/messages',
  '/comms/requests/106',
  '/engagement/helpdesk',
  '/engagement/helpdesk/parent',
  '/engagement/helpdesk/staff?status=closed',
  '/engagement/helpdesk/provider',
  '/engagement/helpdesk/provider/new',
  '/engagement/helpdesk/provider/164',
  '/engagement/helpdesk/staff/224',
  '/engagement/helpdesk/setup',
  '/engagement/leave',
  '/people/withdrawals/95',
  '/reports/strength?report=classwise&run=1&groupBy=section',
  '/reports/strength?report=category&run=1&groupBy=class_stream',
  '/reports/strength?report=age&run=1&groupBy=section&asOn=2027-03-31',
  '/people/withdrawals',
  '/people/withdrawals/settings',
  '/people/withdrawals/bulk?tab=start&section=143',
  '/people/withdrawals/bulk?tab=clear',
  '/people/withdrawals/bulk?tab=tc',
];

test.describe('accessibility (axe)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDeveloper(page, 'dev-admin');
  });

  test('no serious or critical violations on the full student profile', async ({ page }) => {
    // every tab of the student page and every section of the full profile: a long walk
    test.setTimeout(90_000);
    await page.goto('/people/students');
    await page.waitForLoadState('networkidle');
    const href = await page
      .locator('a[href^="/people/students/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/people\/students\/\d+$/.test(h)),
      );
    expect(href).toBeTruthy();
    // the student page tabs
    for (const tab of ['overview', 'profile', 'academics', 'documents', 'fees', 'status']) {
      await page.goto(`${href!}?tab=${tab}`);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page })
        // email previews sit in sandboxed frames (no scripts) the checker cannot enter
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map(
          (v) =>
            `student ${tab} ${v.id}: ${v.help} ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    }
    for (const tab of ['student', 'address', 'father', 'mother', 'contact']) {
      await page.goto(`${href!}/profile?tab=${tab}`);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page })
        // email previews sit in sandboxed frames (no scripts) the checker cannot enter
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(
          (v) =>
            `${tab} ${v.id}: ${v.help} ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    }
  });

  test('no serious or critical violations on the session Merit points tab, a criterion open', async ({
    page,
  }) => {
    await page.goto('/admissions/cycles/4');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByRole('tab', { name: 'Merit points' }).click();
    await expect(
      page.getByRole('heading', { name: '1. Which points each class goes by' }),
    ).toBeVisible();
    // a criterion added (never saved) and its editor open, the save bar showing
    await page.getByRole('button', { name: /^Add Child with special needs/ }).click();
    await expect(page.getByRole('region', { name: 'Unsaved merit points' })).toBeVisible();
    await page.mouse.move(0, 0);
    const r = await new AxeBuilder({ page })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      bad.map(
        (v) =>
          `${v.id}: ${v.help} ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      ),
    ).toEqual([]);
  });

  test('no serious or critical violations on the students list and its dialogs', async ({
    page,
  }) => {
    await page.goto('/people/students');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    const check = async (where: string) => {
      const r = await new AxeBuilder({ page })
        // email previews sit in sandboxed frames (no scripts) the checker cannot enter
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map(
          (v) =>
            `${where} ${v.id}: ${v.help} ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    };
    await check('list');
    await page.getByRole('button', { name: /^Columns/ }).click();
    await page.waitForTimeout(400); // let the dialog's fade-in finish before measuring contrast
    await check('columns dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^More filters/ }).click();
    await page.waitForTimeout(400);
    await check('filters dialog');
  });

  test('no serious or critical violations on the portal profile tabs and the review drawer', async ({
    page,
  }) => {
    const check = async (where: string) => {
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page })
        // email previews sit in sandboxed frames (no scripts) the checker cannot enter
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map(
          (v) =>
            `${where} ${v.id}: ${v.help} ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
      ).toEqual([]);
    };
    await page.goto('/people/portal-profile');
    await page.waitForLoadState('networkidle');
    for (const tab of ['Approvers', 'Proof documents', 'Update window']) {
      await page.getByRole('tab', { name: tab }).click();
      await check(tab);
    }
    await page.goto('/people/profile-approvals?box=all');
    await page.waitForLoadState('networkidle');
    const open = page.getByRole('button', { name: /^(Review|Details)$/ }).first();
    if (await open.isVisible().catch(() => false)) {
      await open.click();
      await check('review drawer');
    }
  });

  test('no serious or critical violations on a saved report with its preview', async ({ page }) => {
    await page.goto('/reports/builder');
    await page.waitForLoadState('networkidle');
    const href = await page
      .locator('a[href^="/reports/builder/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/reports\/builder\/\d+$/.test(h)),
      );
    test.skip(!href, 'no saved report in this school');
    await page.goto(href!);
    await page.waitForLoadState('networkidle');
    // the guided tour opens on a first visit; close it before using the page
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByRole('region', { name: 'Preview', exact: true }).waitFor();
    const results = await new AxeBuilder({ page })
      // email previews sit in sandboxed frames (no scripts) the checker cannot enter
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map(
        (v) =>
          `${v.id}: ${v.help} ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      ),
    ).toEqual([]);
  });

  test('no serious or critical violations on a book copy’s status panel', async ({ page }) => {
    await page.goto('/library/books/1');
    await page.waitForLoadState('networkidle');
    const status = page.getByRole('button', { name: /^Change the status of copy/ }).first();
    test.skip(!(await status.isVisible().catch(() => false)), 'no copy to change in this school');
    await status.click();
    await page.getByRole('heading', { name: /^Status of copy/ }).waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
    ).toEqual([]);
  });

  test('no serious or critical violations on the book list export picker', async ({ page }) => {
    await page.goto('/library?view=copies');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Customise export' }).click();
    await page.getByRole('heading', { name: /^Columns in the file/ }).waitFor();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map(
          (v) =>
            `${v.id}: ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
        ),
    ).toEqual([]);
  });

  test('no serious or critical violations on the candidates export picker', async ({ page }) => {
    await page.goto('/people/recruitment/candidates');
    await page.waitForLoadState('networkidle');
    const open = page.getByRole('button', { name: 'Customise export' });
    test.skip(!(await open.isVisible().catch(() => false)), 'no candidates in this school');
    await open.click();
    await page.getByRole('heading', { name: /^Columns in the file/ }).waitFor();
    // the pointer off the buttons: a button under it is measured in its hover colours, half way
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    const results = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map(
        (v) =>
          `${v.id}: ${v.help} ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      ),
    ).toEqual([]);
  });

  // the admission desk (docs/design/45, part 4): find any registration; start for the parent
  test('admission desk: find and start for the parent', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/admissions/desk?q=AARAV');
    await page.waitForLoadState('networkidle');
    const tour = page.getByRole('button', { name: 'Skip' });
    if (await tour.isVisible()) await tour.click();
    const results = page.getByRole('region', { name: 'Registrations found' });
    await expect(results).toBeVisible();
    await expect(results.getByRole('link', { name: /^View the form of / }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send the form link' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fill it now' })).toBeVisible();
    await expect(page.getByLabel("Child's date of birth")).toBeVisible();
    await page.screenshot({
      path: `${process.env.SHOT_DIR ?? test.info().outputDir}/desk.png`,
      fullPage: true,
    });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  // enquiries as lead management (docs/design/45, part 2): the board, the list's bulk bar, a lead, import
  test('enquiries: board, list, a lead and the import', async ({ page }) => {
    test.setTimeout(150_000);
    const shot = (name: string) =>
      page.screenshot({
        path: `${process.env.SHOT_DIR ?? test.info().outputDir}/${name}.png`,
        fullPage: true,
      });
    const axe = async (label: string) => {
      const r = await new AxeBuilder({ page })
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      return r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${label} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    const problems: string[] = [];
    await page.goto('/admissions/enquiries');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    const board = page.getByRole('region', { name: 'Leads by stage' });
    await expect(board).toBeVisible();
    // the school's own stages: the columns follow its set-up (renamed, removed), Lost is always there
    await expect(board.getByRole('heading').first()).toBeVisible();
    await expect(board.getByRole('heading', { name: /^Lost/ })).toBeVisible();
    problems.push(...(await axe('board')));
    await shot('leads-board');
    await page
      .getByRole('navigation', { name: 'View' })
      .getByRole('link', { name: 'List' })
      .click();
    await page.waitForLoadState('networkidle');
    // the export of the leads of the filters (docs/design/46, part 1)
    const excel = page.getByRole('link', { name: 'Excel' });
    await expect(excel).toHaveAttribute('href', /^\/api\/admissions\/enquiries-list/);
    const file = await page.request.get((await excel.getAttribute('href'))!);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-type']).toMatch(/spreadsheetml/);
    await expect(page.getByRole('button', { name: 'PDF' })).toBeVisible();
    const first = page.getByRole('checkbox', { name: /^Pick (?!every)/ }).first();
    await first.check();
    await expect(page.getByText('1 picked')).toBeVisible();
    await page.getByLabel('What to do').selectOption('score');
    await expect(page.getByRole('button', { name: 'Apply to 1' })).toBeVisible();
    problems.push(...(await axe('list')));
    await shot('leads-list');
    const lead = await page
      .locator('a[href^="/admissions/enquiries/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/admissions\/enquiries\/\d+$/.test(h)),
      );
    await page.goto(lead!);
    await page.waitForLoadState('networkidle');
    await expect(
      page
        .getByRole('region', { name: 'Stage of the lead' })
        .or(page.getByLabel('Stage of the lead')),
    ).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveCount(1);
    problems.push(...(await axe('lead')));
    await shot('lead-page');
    await page.goto('/admissions/enquiries/import');
    await expect(page.getByRole('link', { name: 'Download the format (.xlsx)' })).toBeVisible();
    problems.push(...(await axe('import')));
    expect(problems).toEqual([]);
  });

  // the class line's rules live on the session (25 Oct 2026): not on the form page
  test('class rules on the session, not on the form', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/admissions/forms/1');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    for (const gone of [
      'Age as on',
      'Date of birth from',
      'Date of birth to',
      'PIN codes must start with',
      'Alumni pass-out year must be before',
    ])
      await expect(page.getByLabel(gone, { exact: true })).toHaveCount(0);
    await page.goto('/admissions/cycles/4');
    await page.waitForLoadState('networkidle');
    const pin = page.getByLabel(/: PIN codes must start with/).first();
    await expect(pin).toBeVisible();
    await expect(page.getByLabel(/: alumni pass-out year must be before/).first()).toBeVisible();
    await page.screenshot({
      path: `${process.env.SHOT_DIR ?? test.info().outputDir}/class-rules.png`,
      fullPage: true,
    });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  // fee categories the form cannot decide (docs/design/43, part 5): the set-up and the session's Fee tab
  test('fee category gaps: set-up and the Fee tab', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/admissions/setup');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    const note = page.getByRole('note', { name: 'Fee categories the form cannot decide' });
    test.skip(!(await note.count()), 'every category is decided by its forms');
    await expect(note.first()).toBeVisible();
    await page.goto('/admissions/cycles');
    await page.waitForLoadState('networkidle');
    const cycle = await page
      .locator('a[href^="/admissions/cycles/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .filter((h) => /^\/admissions\/cycles\/\d+$/.test(h)),
      );
    let seen = false;
    for (const c of cycle.slice(0, 6)) {
      await page.goto(c);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: 'Fee table' }).click();
      if (await page.getByRole('note', { name: 'Fee categories the form cannot decide' }).count()) {
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
    await page.screenshot({
      path: `${process.env.SHOT_DIR ?? test.info().outputDir}/fee-gaps.png`,
      fullPage: true,
    });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  // the admission desk of the Helpdesk (docs/design/43, part 4): the families' questions, one opened
  test('helpdesk: admission queries desk and a question', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/engagement/helpdesk/candidate');
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    await expect(page.getByRole('heading', { name: 'Admission queries' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Raise/ })).toHaveCount(0);
    const href = await page
      .locator('a[href^="/engagement/helpdesk/candidate/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/engagement\/helpdesk\/candidate\/\d+$/.test(h)),
      );
    test.skip(!href, 'no admission query yet');
    await page.goto(href!);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: /Class/ }).first()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('admission-query.png'), fullPage: true });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  // the enquiry desk answers (docs/design/43, part 3): the desk set-up, an enquiry with Reply to family
  test('enquiry desk: set-up card and reply to family', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/admissions/setup');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Enquiry desk' })).toBeVisible();
    // the desk's assignment rules (docs/design/45, part 3), like the approval processes
    const tour = page.getByRole('button', { name: 'Skip' });
    if (await tour.isVisible()) await tour.click();
    await expect(page.getByText('Everything else', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await expect(page.getByRole('group', { name: 'New rule' })).toBeVisible();
    await expect(page.getByLabel('First contact within (working hours)')).toBeVisible();
    // a pool by role (docs/design/46, part 2)
    await expect(
      page.getByRole('group', { name: 'Roles: whoever holds one when a lead arrives' }),
    ).toBeVisible();
    await page.getByRole('region', { name: 'Enquiry desk' }).screenshot({
      path: `${process.env.SHOT_DIR ?? test.info().outputDir}/enquiry-rules.png`,
    });
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.goto('/admissions/enquiries?q=Browser%20Enquiry');
    await page.waitForLoadState('networkidle');
    const href = await page
      .locator('a[href^="/admissions/enquiries/"]')
      .evaluateAll((as) =>
        as
          .map((a) => a.getAttribute('href') ?? '')
          .find((h) => /^\/admissions\/enquiries\/\d+$/.test(h)),
      );
    test.skip(!href, 'no website enquiry from the browser test yet');
    await page.goto(href!);
    await page.waitForLoadState('networkidle');
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    await expect(page.getByText(/Enquiry ENQ-\d{6}/)).toBeVisible();
    await page.getByLabel('Message *').fill('Yes, the bus runs from Sector 15.');
    await page.getByRole('button', { name: 'Send the reply' }).click();
    await expect(page.getByText(/Reply sent/)).toBeVisible();
    await expect(
      page.getByText('Reply by email: Yes, the bus runs from Sector 15.').first(),
    ).toBeVisible();
    // the invitation's link to copy or share (docs/design/46, part 3); the address cannot receive mail
    await page.getByRole('button', { name: /^(Send the invitation|Invite again)$/ }).click();
    await expect(page.getByLabel('The invitation link')).toHaveValue(
      /\/admission\?session=.+&enquiry=/,
    );
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\//,
    );
    await page.screenshot({ path: test.info().outputPath('enquiry-reply.png'), fullPage: true });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  // a notice for candidates is chosen as in Compose: session, classes, statuses (docs/design/43, part 2)
  test('notice for candidates: session, classes and status', async ({ page }) => {
    await page.goto('/academics/notices/new');
    await page.waitForLoadState('networkidle');
    // the first-visit tour, when it shows, is closed first
    const skip = page.getByRole('button', { name: 'Skip' });
    if (await skip.isVisible()) await skip.click();
    await page.getByRole('radio', { name: /Candidates/ }).check();
    const session = page.getByLabel('Admission session *');
    await expect(session).toBeVisible();
    await expect(page.getByRole('group', { name: /Classes sought/ })).toBeVisible();
    const status = page.getByRole('group', { name: /Status \(none: every registration\)/ });
    await expect(status).toBeVisible();
    const count = page.getByText(/Reaches \d+ registration\(s\)/);
    await expect(count).toBeVisible();
    const every = Number(/\d+/.exec((await count.textContent()) ?? '')![0]);
    // one status chosen: the count follows (never more than every registration of the session)
    await status.getByLabel('Admitted').check();
    await page.waitForTimeout(1000);
    const admitted = Number(/\d+/.exec((await count.textContent()) ?? '')![0]);
    expect(admitted).toBeLessThanOrEqual(every);
    await page.screenshot({
      path: test.info().outputPath('notice-candidates.png'),
      fullPage: true,
    });
    const r = await new AxeBuilder({ page })
      .options({ iframes: false })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    ).toEqual([]);
  });

  for (const path of PAGES) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      // a page that does not load (404, error) has nothing to check: it fails here instead of passing
      expect(res?.status() ?? 200, `${path} did not load`).toBeLessThan(400);
      await page.waitForLoadState('networkidle');
      await expect(page.getByText('This page could not be found')).toHaveCount(0);
      const results = await new AxeBuilder({ page })
        // email previews sit in sandboxed frames (no scripts) the checker cannot enter
        .options({ iframes: false })
        .setLegacyMode()
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const serious = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        serious.map(
          (v) =>
            `${v.id}: ${v.help} (${v.nodes.length})\n  ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join('\n  ')}`,
        ),
      ).toEqual([]);
    });
  }
});
