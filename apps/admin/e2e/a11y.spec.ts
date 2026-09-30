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
  '/attendance/rfid/dashboard',
  '/comms/compose',
  '/comms/requests',
  '/comms/consents',
  '/engagement/queries',
  '/engagement/feedback',
  '/engagement/change-requests',
  '/transport/routes',
  '/academics/substitutions',
  '/academics/lesson-plans',
  '/attendance/rules',
  '/system/privacy',
  '/fees/masters',
  '/transport/vehicles',
  '/transport/drivers',
  '/insights/principal',
  '/fees/cashier',
  '/fees/refunds',
  '/fees/settlements',
  '/transport/requests',
  '/insights/departments',
  '/insights/departments/fees',
  '/fees/adjustments',
  '/fees/misc',
  '/fees/reports',
  '/fees/reports?report=defaulters',
  '/fees/bank',
  '/exams',
  '/exams/masters',
  '/insights/assistant',
  '/insights/alerts',
  // Sprint 16
  '/fees/shadow',
  '/system/service-keys',
  '/insights/reports',
  '/insights/assistant/costs',
  // master-data framework
  '/masters/fees?tab=fee_periods',
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
  '/engagement/visitors',
  '/engagement/gate-passes',
  '/engagement/consent-forms?new=1',
  '/engagement/certificates',
  '/engagement/clinic',
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
  // Student 360 profile
  '/people/students/quick-add',
  '/masters/system?tab=profile_lists',
  '/people/students/bulk',
  '/people/students/bulk?mode=create',
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
    for (const tab of ['student', 'address', 'father']) {
      await page.goto(`${href!}/profile?tab=${tab}`);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
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

  for (const path of PAGES) {
    test(`no serious or critical violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
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
