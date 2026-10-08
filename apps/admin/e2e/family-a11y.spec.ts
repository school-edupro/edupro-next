/** Parent app (port 3001) frame and home: axe on key screens as parent and student, desktop and phone. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:3001';
const PAGES = [
  '/?welcome=1',
  '/profile',
  '/attendance',
  '/documents',
  '/directory',
  '/attendance?view=year',
  '/attendance?view=leave',
  '/calendar',
  '/calendar?view=holidays',
  '/calendar?view=events',
  '/fees',
  '/fees/tax-certificate',
  '/homework',
  '/homework?date=2026-10-07',
  '/homework?view=assignments&from=2026-09-01&to=2026-10-31',
  '/teachers',
  '/notices',
  '/messages',
  '/queries',
  '/queries/new?kind=query',
  '/queries/16',
  '/appointments',
  '/appointments/new',
  '/appointments/new?student=12307&host=47',
  '/health',
  '/health?kind=visit',
  '/health/visits/39',
  '/health/cards/2',
  '/transport',
  '/transport/apply?student=12307',
  '/gate-passes',
  '/gate-passes?view=calendar',
  '/gate-passes/new?student=12307&kind=early_leave',
  '/gate-passes/60',
  '/appointments?st=open&q=progress',
  '/appointments?view=calendar',
];

for (const sub of ['dev-parent', 'dev-student']) {
  for (const width of [1280, 375]) {
    test(`family ${sub} @${width}`, async ({ page }) => {
      // many screens in one sign-in: allow more than the default half minute
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
