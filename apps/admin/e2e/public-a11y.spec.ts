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

// the careers page (docs/design/34-recruitment.md, part 2): the open posts, one post with the sign-in
// (mobile or email), signed out, desktop and phone
for (const width of [1280, 375]) {
  test(`public careers pages @${width}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 900 });
    const problems: string[] = [];
    const check = async (label: string) => {
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
        problems.push(`${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    await page.goto(`${BASE}/alpha/careers`);
    await check('open posts');
    const first = page.locator('main article a').first();
    if (await first.count()) {
      await first.click();
      await page.waitForURL(/\/careers\/\d+/);
      await check('one post');
      await page.getByLabel('My email').check();
      await check('sign-in by email');
    }
    await page.goto(`${BASE}/alpha/careers/mine`);
    await check('my applications, signed out');
    expect(problems).toEqual([]);
  });
}

// the application as steps, signed in (a test school's candidate: the code shows on screen in
// development and the school has no providers, so nothing is sent), each step and the mistakes summary
for (const width of [1280, 375]) {
  test(`careers application steps @${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const res = await page.goto(`${BASE}/rcpmvgl1kms166/careers/form`);
    test.skip(res?.status() === 404, 'the test school is not in this database');
    const problems: string[] = [];
    const check = async (label: string) => {
      // the pointer off the buttons: a button under it is measured in its hover colours, half way
      await page.mouse.move(0, 0);
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
        problems.push(`${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    if (await page.getByRole('button', { name: 'Send code' }).count()) {
      await page.getByLabel('My email').check();
      await page.getByLabel('Email address').fill('browser.check@example.invalid');
      await page.getByRole('button', { name: 'Send code' }).click();
      const code = (await page.getByText(/Development code: \d{6}/).textContent())!.match(
        /\d{6}/,
      )![0];
      await check('the code sent');
      await page.getByLabel('Code').fill(code);
      await page.getByRole('button', { name: 'Sign in' }).click();
    }
    await page.locator('.ep-wiz').waitFor();
    // the form is drawn on the server first: wait until it answers clicks
    await page.waitForLoadState('networkidle');
    const steps = page.locator('.ep-wiz__step');
    for (let i = 0; i < 6; i += 1) {
      await steps.nth(i).click();
      await expect(steps.nth(i)).toHaveAttribute('aria-current', 'step');
      await check(`step ${String(i + 1)}`);
    }
    // a required answer left empty: the mistakes summary and the field marked
    await steps.nth(0).click();
    await page.getByLabel('First name').fill('');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Please put these right:')).toBeVisible();
    await check('mistakes shown');
    // the applications as cards, with their PDF
    await page.goto(`${BASE}/rcpmvgl1kms166/careers/mine`);
    await check('my applications, signed in');
    expect(problems).toEqual([]);
  });
}

// every public page of a school carries the school: its name (and logo) at the top, how to reach the
// office at the foot, and its name in the browser tab
test('every public page carries the school', async ({ page }) => {
  test.setTimeout(90_000);
  for (const path of [
    '/alpha',
    '/alpha/status',
    '/alpha/appointment',
    '/alpha/visitor',
    '/alpha/careers',
    '/alpha/careers/form',
    '/alpha/careers/mine',
  ]) {
    await page.goto(`${BASE}${path}`);
    await expect(page.getByRole('banner'), path).toContainText('Alpha Public School');
    await expect(page.getByRole('contentinfo'), path).toContainText('Alpha Public School');
    await expect(page.getByRole('main'), path).toBeVisible();
    await expect(page, path).toHaveTitle(/Alpha Public School/);
  }
});

// the admission portal (docs/design/42, part 1): the sign-in card with the open classes, then the
// portal's own shell after the development code, desktop and phone
for (const width of [1280, 375]) {
  test(`admission portal sign-in and shell @${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const problems: string[] = [];
    const check = async (label: string) => {
      await page.waitForTimeout(400);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical'))
        problems.push(`${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    };
    await page.goto(`${BASE}/api/lang?to=en&back=%2Falpha%2Fadmission`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admission portal');
    await expect(page.getByRole('heading', { name: 'Open for registration' })).toBeVisible();
    await check('signed out');
    await page
      .getByLabel('Mobile number, email or registration number')
      .fill(`90000${String(Date.now()).slice(-5)}`);
    await page.getByRole('button', { name: 'Send code' }).click();
    const dev = page.getByText(/Development code: \d{6}/i);
    await expect(dev).toBeVisible({ timeout: 60_000 });
    const code = /(\d{6})/.exec((await dev.textContent()) ?? '')![1]!;
    await page.getByLabel('Code', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.ep-shell')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('navigation', { name: width > 800 ? 'Main menu' : 'Quick menu' }),
    ).toBeVisible();
    await check('signed in');
    expect(problems).toEqual([]);
  });
}
