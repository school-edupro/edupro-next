/**
 * Sprint 16: due-date peak at 5x. Sprint 13 proved 20 concurrent receipts number correctly; this spec posts
 * 100 concurrent receipts (five per pupil over twenty pupils, the shape of a due-date morning at five
 * counters) and then reads the ledgers and the day book under budget. Numbers go to the sprint record.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(s.length * 0.95) - 1)] ?? s[s.length - 1] ?? 0;
};

describe('due-date peak at 5x (e2e, Sprint 16)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const students: string[] = [];
  const results: Array<{ what: string; value: string }> = [];
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('PF16');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', kind: 'regular', ledger: 'school', sortOrder: 1 },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [{ headId: head.json().id, amount: 2000, frequency: 'monthly' }],
      },
    });
    for (let i = 1; i <= 20; i += 1) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${i}`,
          firstName: `Pupil${i}`,
          lastName: 'Peak',
          guardians: [],
          enrolment: { classSectionId: sec.json().id, rollNo: i },
        },
      });
      expect(r.statusCode).toBe(201);
      students.push(r.json().id);
      expect(
        (
          await inject({
            method: 'POST',
            url: `/fees/students/${r.json().id}/demands/generate`,
            headers: h(),
          })
        ).statusCode,
      ).toBe(201);
    }
    await withMigrator((c) =>
      c.query('ANALYZE fee_demands, fee_payments, fee_payment_allocations, students, enrolments'),
    );
  }, 180_000);

  afterAll(async () => {
    console.table(results);
    await app?.close();
  });

  it('100 concurrent receipts post with unique numbers and correct balances; reads stay under budget', async () => {
    const started = Date.now();
    const posts = await Promise.all(
      students.flatMap((studentId, i) =>
        [0, 1, 2, 3, 4].map((k) =>
          inject({
            method: 'POST',
            url: '/payments/receipts',
            headers: h(),
            json: {
              studentId,
              amount: 1200,
              mode: k % 2 ? 'upi' : 'cash',
              reference: k % 2 ? `UPI-${i}-${k}` : undefined,
              receivedOn: '2026-04-10',
              collectLateFee: false,
            },
          }),
        ),
      ),
    );
    const wall = Date.now() - started;
    expect(posts.every((r) => r.statusCode === 201)).toBe(true);
    const numbers = posts.map((r) => r.json().receiptNo as string);
    expect(new Set(numbers).size).toBe(100);
    results.push({ what: '100 concurrent receipts (wall clock)', value: `${wall} ms` });
    results.push({ what: 'receipts/second', value: String(Math.round((100 * 1000) / wall)) });
    expect(wall).toBeLessThan(20_000);
    // every pupil paid 6,000 of the April instalment: settled, no advance
    const ledgers = await Promise.all(
      students.map((id) =>
        inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h() }),
      ),
    );
    for (const l of ledgers) {
      expect(l.statusCode).toBe(200);
      expect(l.json().instalments[0]).toMatchObject({ balance: '0.00', status: 'paid' });
      expect(l.json().payments).toHaveLength(5);
    }
    const measure = async (what: string, url: string, budgetMs: number, runs = 12) => {
      const times: number[] = [];
      for (let i = 0; i < runs; i += 1) {
        const t = Date.now();
        const r = await inject({ method: 'GET', url, headers: h() });
        expect(r.statusCode).toBe(200);
        if (i >= 2) times.push(Date.now() - t);
      }
      const v = p95(times);
      results.push({ what, value: `p95 ${v} ms (budget ${budgetMs})` });
      expect(v).toBeLessThan(budgetMs);
    };
    await measure('student ledger', `/fees/students/${students[0]}/ledger`, 400);
    await measure(
      'day book (100 receipts)',
      '/reports/datasets/fee_day_book/rows?from=2026-04-10&to=2026-04-10',
      800,
    );
    await measure(
      'head-wise tally (April)',
      '/reports/datasets/fee_head_tally/rows?from=2026-04-01&to=2026-04-30',
      800,
    );
    await measure('fees department dashboard', '/insights/departments/fees', 1500);
  }, 120_000);
});
