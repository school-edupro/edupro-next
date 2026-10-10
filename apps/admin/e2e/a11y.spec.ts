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
  '/fees/masters',
  '/fees/rules',
  '/fees/rules?classId=3282',
  '/fees/structures?classId=3282',
  '/fees/discounts',
  '/fees/approval',
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
  '/transport/requests/92',
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
  '/library/fines',
  // Sprint 18
  '/exams/board-results',
  '/library/stock',
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
  '/engagement/consent-forms?new=1',
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

  for (const path of PAGES) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
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
            `${v.id}: ${v.help} (${v.nodes.length})\n  ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join('\n  ')}`,
        ),
      ).toEqual([]);
    });
  }
});
