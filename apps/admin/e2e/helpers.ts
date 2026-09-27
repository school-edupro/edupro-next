import type { Page } from '@playwright/test';

/** Signs in through the development bypass (AUTH_DEV_BYPASS=1) as the seeded developer administrator. */
export async function signInAsDeveloper(
  page: Page,
  sub = process.env.E2E_DEV_SUB ?? 'dev-admin',
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Developer subject').fill(sub);
  await page.getByRole('button', { name: 'Sign in as developer' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}
