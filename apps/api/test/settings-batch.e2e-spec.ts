/**
 * School settings saved together (docs/design/95): each setting comes with its standard value; several are saved in
 * one call (each checked by its own schema, all or none), from today or a later date; only the edit right saves.
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

interface Setting {
  key: string;
  value: unknown;
  default: unknown;
  isDefault: boolean;
  validFrom: string | null;
}

describe('school settings saved together (e2e, docs/design/95)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const list = async () => {
    const r = await inject({ method: 'GET', url: '/platform/settings', headers: h(admin) });
    expect(r.statusCode).toBe(200);
    return new Map((r.json().data as Setting[]).map((s) => [s.key, s]));
  };
  const put = (json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url: '/platform/settings', headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('SB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('each setting comes with its standard value', async () => {
    const s = await list();
    expect(s.get('library.loan_days')).toMatchObject({ value: 14, default: 14, isDefault: true });
    expect(s.get('attendance.in_window')!.default).toEqual({ start: '07:00', end: '10:00' });
  });

  it('several saved together; one bad value and none is saved', async () => {
    const bad = await put({
      values: { 'library.loan_days': 21, 'library.fine_per_day': 'two rupees', 'no.such': 1 },
    });
    expect(bad.statusCode).toBe(400);
    const errors = bad.json().errors as Array<{ path: string; message: string }>;
    expect(errors.map((e) => e.path)).toEqual(
      expect.arrayContaining(['library.fine_per_day', 'no.such']),
    );
    expect((await list()).get('library.loan_days')!.value).toBe(14);

    const ok = await put({ values: { 'library.loan_days': 21, 'library.fine_per_day': '5.00' } });
    expect(ok.statusCode).toBe(200);
    expect((ok.json().data as Setting[]).map((x) => x.key).sort()).toEqual([
      'library.fine_per_day',
      'library.loan_days',
    ]);
    const s = await list();
    expect(s.get('library.loan_days')).toMatchObject({ value: 21, isDefault: false, default: 14 });
    expect(s.get('library.fine_per_day')!.value).toBe('5.00');
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'platform.settings.edit'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBe(2);
  });

  it('from a later date: today keeps its value', async () => {
    const later = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await put({ values: { 'library.loan_days': 30 }, validFrom: later })).statusCode).toBe(
      200,
    );
    expect((await list()).get('library.loan_days')!.value).toBe(21);
    const hist = await inject({
      method: 'GET',
      url: '/platform/settings/library.loan_days/history',
      headers: h(admin),
    });
    expect((hist.json().data as Array<{ validFrom: string }>)[0]!.validFrom).toBe(later);
  });

  it('nothing to save, or no right to edit: refused', async () => {
    expect((await put({ values: {} })).statusCode).toBe(400);
    expect((await put({ values: { 'library.loan_days': 7 } }, teacher)).statusCode).toBe(403);
  });
});
