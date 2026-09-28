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
];

test.describe('accessibility (axe)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDeveloper(page, 'dev-admin');
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
