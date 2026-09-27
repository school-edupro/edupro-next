import { expect, test } from '@playwright/test';
import { signInAsDeveloper } from '../helpers';

/**
 * Visual baselines (S3-06). Baselines are platform-specific; the nightly workflow generates and compares
 * Linux baselines, and a change over 0.1 percent of pixels fails the run.
 */
const screens = [
  { path: '/', name: 'dashboard' },
  { path: '/access/roles', name: 'roles' },
  { path: '/system/years', name: 'years' },
  { path: '/system/settings', name: 'settings' },
];

for (const screen of screens) {
  test(`renders ${screen.name} like the baseline`, async ({ page }) => {
    await signInAsDeveloper(page);
    await page.goto(screen.path);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      mask: [page.locator('time'), page.getByText(/\d{1,2}\/\d{1,2}\/\d{4}/)],
    });
  });
}
