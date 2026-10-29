/** Teacher app (port 3002): axe on the helpdesk screens (queries to answer, my requests, raise, a ticket), desktop and phone. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3002';
const PAGES = [
  '/',
  '/queries',
  '/queries?tab=leave',
  '/queries?tab=mine',
  '/queries/new?desk=provider',
  '/queries/t/208',
  '/appointments',
  '/appointments?view=calendar',
  '/attendance',
  '/marks',
  '/verify-marks',
  '/exam-register',
  '/bus-attendance',
  '/documents',
  '/office-orders',
  '/daily-work',
  '/syllabus',
  '/lesson-plans',
  '/lesson-plans?tab=report',
  '/lesson-plans/9',
  '/activity-log',
  '/daily-work?date=2026-10-07&c=169&s=143',
  '/daily-work?view=assignments&c=169',
  '/daily-work?view=report&kind=daily',
  '/bus-attendance/register',
  '/leaves',
  '/gate-passes',
  '/gate-passes/new',
  '/library',
  '/library?view=history',
  '/library?view=find&q=a',
  '/resignation',
  '/exit-approvals',
  '/no-dues',
  // docs/design/50: dev-teacher is named in level 1 of the sample registrations' Document check
  '/admission-approvals',
  '/admission-approvals?tab=decided',
];

for (const sub of ['dev-teacher']) {
  for (const width of [1280, 375]) {
    test(`teacher ${sub} @${width}`, async ({ page }) => {
      // the list of pages has grown: the default 30 s is not enough for all of them
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/login`);
      await page.selectOption('select[name=sub]', sub);
      await page
        .locator('select[name=sub]')
        .evaluate((s) => (s as HTMLSelectElement).form!.requestSubmit());
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      const problems: string[] = [];
      for (const p of PAGES) {
        await page.goto(`${BASE}${p}`);
        await page.waitForTimeout(400);
        const r = await new AxeBuilder({ page })
          // email previews sit in sandboxed frames (no scripts) the checker cannot enter
          .options({ iframes: false })
          .setLegacyMode()
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze();
        for (const v of r.violations.filter(
          (x) => x.impact === 'serious' || x.impact === 'critical',
        ))
          problems.push(
            `${p}: ${v.id} — ${v.nodes
              .map((n) => n.target.join(' '))
              .slice(0, 3)
              .join(' | ')}`,
          );
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
}

// docs/design/50: the review of a registration waiting for dev-teacher (the first on the list, so a
// new sample seed does not break it), desktop and phone
for (const width of [1280, 375]) {
  test(`teacher admission review @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${BASE}/login`);
    await page.selectOption('select[name=sub]', 'dev-teacher');
    await page
      .locator('select[name=sub]')
      .evaluate((s) => (s as HTMLSelectElement).form!.requestSubmit());
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.goto(`${BASE}/admission-approvals`);
    const first = page.locator('table a[href^="/admission-approvals/"]').first();
    test.skip((await first.count()) === 0, 'nothing waits for dev-teacher (seed the sample data)');
    await first.click();
    await expect(page.getByRole('heading', { name: 'Your decision' })).toBeVisible();
    await page.mouse.move(0, 0);
    const r = await new AxeBuilder({ page })
      .setLegacyMode()
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(
      bad.map(
        (v) =>
          `${v.id}: ${v.help} ${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')}`,
      ),
    ).toEqual([]);
  });
}
