/**
 * Public app (port 3003): axe on the appointment booking page behind the school's QR code, signed out and
 * after the mobile one-time code (the development code shown on the page), with slots and the visitor
 * form, desktop and phone.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3003';

// a stand-in camera, so the live photo can be taken in the test browser
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

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
    // only the mobile number is asked before the one-time code (the name comes in the booking form)
    await expect(page.locator('main input.ep-input')).toHaveCount(1);
    await page.locator('main input.ep-input').fill(mobile);
    await page.getByRole('button', { name: 'Send code' }).click();
    const code = /(\d{6})/.exec(
      (await page.locator('.ep-kicker', { hasText: 'Development code' }).textContent()) ?? '',
    )![1]!;
    await page.locator('main input.ep-input').first().fill(code);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/lang=en/);
    // a new visitor goes straight to booking: whom to meet, an open day, then the time and the form
    await check('whom to meet');
    await page.locator('.ep-choice').first().click();
    await page.waitForURL(/host=/);
    await check('open days');
    await page.locator('.ep-choice').first().click();
    await page.waitForURL(/date=/);
    await page.goto(page.url().replace('lang=en', 'lang=hi'));
    await expect(page.locator('.ep-slots__slot').first()).toBeVisible();
    // the photo is taken live: there is a camera button and no file picker anywhere on the page
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    await page.getByRole('button', { name: 'कैमरा खोलें' }).click();
    // the site's own security header must let this page use the camera
    await expect(page.locator('video.ep-appt__camera')).toBeVisible();
    await page.waitForFunction(
      () => (document.querySelector('video.ep-appt__camera') as HTMLVideoElement).videoWidth > 0,
    );
    await page.getByRole('button', { name: 'फ़ोटो लें' }).click();
    await expect(page.locator('img.ep-appt__photo')).toBeVisible();
    expect(await page.locator('input[name=photo]').inputValue()).toMatch(
      /^data:image\/jpeg;base64,/,
    );
    await check('photo taken');
    await check('slots and form (Hindi)');
    // on the school's tablet (kiosk) the visitor's own list is never shown
    await page.goto(`${BASE}/alpha/appointment?lang=en`);
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.goto(`${BASE}/alpha/appointment?lang=en&kiosk=1`);
    await expect(page.getByText('Your appointments')).toHaveCount(0);
    await expect(page.locator('.ep-choice').first()).toBeVisible();
    await check('kiosk');
    // the pass of a confirmed appointment, laid out like the visitor card
    await page.goto(`${BASE}/alpha/pass/UBEV3EDGVY`);
    await check('pass');
    // a walk-in visitor's own form (not sent: the entry would mail the person being met)
    await page.goto(`${BASE}/alpha/visitor?lang=en`);
    await expect(page.getByRole('button', { name: 'Get my visitor pass' })).toBeVisible();
    await check('visitor pass form');
    // signing out leaves the sign-in step
    await page.goto(`${BASE}/alpha/appointment?lang=en`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
    expect(problems).toEqual([]);
  });
}
