import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { signInAsDeveloper } from './helpers';

test.describe('admin smoke', () => {
  test('signs in, sees the dashboard shell and navigates the foundation screens', async ({
    page,
  }) => {
    await signInAsDeveloper(page);
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toContainText(
      'Roles and permissions',
    );

    await page.getByRole('link', { name: 'Classes and sections' }).click();
    await expect(page.getByRole('heading', { name: 'Classes and sections' })).toBeVisible();

    await page.getByRole('link', { name: 'Roles and permissions' }).click();
    await expect(page.getByRole('heading', { name: 'Roles and permissions' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Roles' })).toContainText('school_admin');

    await page.getByRole('link', { name: 'Years' }).click();
    await expect(page.getByRole('heading', { name: 'Academic and financial years' })).toBeVisible();

    await page.getByRole('link', { name: 'Audit log' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: /search audit log/i })).toBeVisible();
  });

  test('switches school and keeps the session', async ({ page }) => {
    await signInAsDeveloper(page);
    const switcher = page.getByRole('combobox', { name: /school/i }).first();
    await expect(switcher).toBeVisible();
    const options = await switcher.locator('option').allTextContents();
    test.skip(options.length < 2, 'developer has one school only');
    await switcher.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Switch' }).click();
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
  });

  test('every drop-down is searchable: type to filter, Enter picks, the select keeps the id', async ({
    page,
  }) => {
    await signInAsDeveloper(page);
    await page.goto('/people/roll-numbers');
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
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['x-powered-by']).toBeUndefined();
    // the Content-Security-Policy is added by production builds only (next.config.ts)
  });
});
