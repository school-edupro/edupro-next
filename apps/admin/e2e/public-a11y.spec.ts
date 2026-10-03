/**
 * Public app (port 3003): axe on the appointment booking page behind the school's QR code, signed out and
 * after the mobile one-time code (the development code shown on the page), with slots and the visitor
 * form, desktop and phone.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3003';

for (const width of [1280, 375]) {
  test(`public appointment booking @${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const problems: string[] = [];
    const check = async (label: string) => {
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
        problems.push(`${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    await page.goto(`${BASE}/alpha/appointment`);
    await check('signed out');
    // a fresh mobile each run: at most three live codes are kept per mobile
    const mobile = `9${String(Date.now()).slice(-9)}`;
    const boxes = page.locator('main input.ep-input');
    await boxes.nth(0).fill('Axe Visitor');
    await boxes.nth(1).fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = /(\d{6})/.exec(
      (await page.locator('.ep-kicker', { hasText: 'Development code' }).textContent()) ?? '',
    )![1]!;
    await page.locator('main input.ep-input').first().fill(code);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/lang=en/);
    await check('signed in');
    // a school day a week ahead, so the slots and the visitor form show
    const d = new Date(Date.now() + 7 * 86_400_000);
    while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
    const host = await page.locator('#v-host option').nth(1).getAttribute('value');
    await page.goto(
      `${BASE}/alpha/appointment?lang=hi&host=${host ?? ''}&date=${d.toISOString().slice(0, 10)}`,
    );
    await expect(page.locator('.ep-slots__slot').first()).toBeVisible();
    // the photo is taken live: there is a camera button and no file picker anywhere on the page
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'कैमरा खोलें' })).toBeVisible();
    await check('slots and form (Hindi)');
    // the visitor's own list is there on a personal phone and hidden on the school's tablet (kiosk)
    await page.goto(`${BASE}/alpha/appointment?lang=en`);
    await expect(page.getByText('Your appointments')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goto(`${BASE}/alpha/appointment?lang=en&kiosk=1`);
    await expect(page.getByText('Your appointments')).toHaveCount(0);
    await check('kiosk');
    // the pass of a confirmed appointment, laid out like the visitor card
    await page.goto(`${BASE}/alpha/pass/UBEV3EDGVY`);
    await check('pass');
    // signing out leaves the sign-in step
    await page.goto(`${BASE}/alpha/appointment?lang=en`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
    expect(problems).toEqual([]);
  });
}
