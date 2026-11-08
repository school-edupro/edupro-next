import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signInAsDeveloper } from './helpers';

/** The first visit shows the tour, which covers the page: skip it. */
async function skipTour(page: Page) {
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}
const GREETING = /good (morning|afternoon|evening)/i;

test.describe('admin smoke', () => {
  test('signs in, sees the dashboard shell and opens the foundation screens', async ({ page }) => {
    await signInAsDeveloper(page);
    await skipTour(page);
    await expect(page.getByRole('heading', { name: GREETING })).toBeVisible();
    // the menu holds only what the role may do; its groups fold
    await expect(page.getByRole('navigation', { name: 'Primary' })).toContainText(
      'Roles and permissions',
    );

    // classes and sections are a tab of Academics setup
    await page.goto('/academics/classes');
    await expect(page.getByRole('heading', { name: /academics set-?up/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /class name/i })).toBeVisible();

    await page.goto('/access/roles');
    await expect(page.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();
    await expect(page.locator('main')).toContainText(/school[ _]admin/i);

    await page.goto('/system/years');
    await expect(page.getByRole('heading', { name: 'Academic and financial years' })).toBeVisible();

    await page.goto('/system/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: /search audit log/i })).toBeVisible();
  });

  test('switches school from the header and keeps the session', async ({ page }) => {
    await signInAsDeveloper(page);
    await skipTour(page);
    const chip = page.locator('summary[aria-label^="Switch school or year"]');
    test.skip(!(await chip.count()), 'developer has one school and one year only');
    await chip.click();
    const others = page.locator(
      '.ep-hmenu__panel form:has(input[name="schoolId"]):not(:has(input[name="academicYearId"])) button:not([aria-current])',
    );
    test.skip(!(await others.count()), 'developer has one school only');
    const name = (await others.first().innerText()).trim();
    await others.first().click();
    await skipTour(page);
    await expect(page.getByRole('heading', { name: GREETING })).toBeVisible();
    await expect(chip).toContainText(name);
  });

  test('every drop-down is searchable: type to filter, Enter picks, the select keeps the id', async ({
    page,
  }) => {
    await signInAsDeveloper(page);
    await page.goto('/people/roll-numbers');
    await skipTour(page);
    const section = page.getByRole('combobox', { name: 'Section' });
    await section.click();
    const search = page.getByRole('combobox', { name: 'Search Section' });
    await expect(search).toBeFocused();
    await search.fill('vi a');
    const options = page.getByRole('listbox', { name: 'Section' }).getByRole('option');
    await expect(options.first()).toContainText('VI-A');
    // the open picker passes the accessibility check
    const axe = await new AxeBuilder({ page }).include('.ep-ss').analyze();
    expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
      [],
    );
    await search.press('Enter');
    await expect(page.locator('.ep-ss')).toHaveCount(0);
    await expect(section).toBeFocused();
    await expect(section.locator('option:checked')).toContainText('VI-A');
    expect(await section.inputValue()).toMatch(/^\d+$/);
    // Escape closes without changing; a short list opens without a search box
    await section.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('.ep-ss')).toHaveCount(0);
  });

  test('redirects unauthenticated visitors to the login page', async ({ page }) => {
    await page.goto('/access/roles');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccess%2Froles/);
  });
});

test.describe('security headers (Sprint 21 VAPT readiness)', () => {
  test('every response carries the framing, sniffing, referrer and permissions headers', async ({
    request,
  }) => {
    const res = await request.get('/login');
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    // the gate takes a walk-in visitor's photo, so the site itself may use the camera (nobody else);
    // the microphone is off
    expect(h['permissions-policy']).toContain('camera=(self)');
    expect(h['permissions-policy']).toContain('microphone=()');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['x-powered-by']).toBeUndefined();
    // the Content-Security-Policy is added by production builds only (next.config.ts)
  });
});
