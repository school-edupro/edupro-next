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

  test('redirects unauthenticated visitors to the login page', async ({ page }) => {
    await page.goto('/access/roles');
    await expect(page).toHaveURL(/\/login\?returnTo=%2Faccess%2Froles/);
  });
});
