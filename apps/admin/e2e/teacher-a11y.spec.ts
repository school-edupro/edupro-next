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
  '/bus-attendance',
  '/documents',
  '/office-orders',
  '/daily-work',
  '/daily-work?date=2026-10-07&s=143',
  '/daily-work?view=assignments&s=143',
  '/daily-work?view=report',
  '/bus-attendance/register',
  '/leaves',
  '/gate-passes',
  '/gate-passes/new',
];

for (const sub of ['dev-teacher']) {
  for (const width of [1280, 375]) {
    test(`teacher ${sub} @${width}`, async ({ page }) => {
      // the list of pages has grown: the default 30 s is not enough for all of them
      test.setTimeout(120_000);
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
