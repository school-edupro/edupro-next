/**
 * Online admission (docs/design/39): part 1 — the form builder (ready forms, checks, mapping to the
 * student master, additional student fields). Later parts add their cases here.
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

describe('online admission (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let formIx: string;
  let formXi: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('AV');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('part 1: form builder', () => {
    it('makes forms from the ready forms; their "copy" answers become additional student fields', async () => {
      const ix = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'Registration IX', template: 'general' },
      });
      expect(ix.statusCode).toBe(201);
      formIx = ix.json().id;
      expect(ix.json().def.steps).toHaveLength(8);
      const xi = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'Registration XI', template: 'class_xi' },
      });
      expect(xi.statusCode).toBe(201);
      formXi = xi.json().id;
      const meta = await inject({ method: 'GET', url: '/admissions/forms/meta', headers: h() });
      expect(meta.statusCode).toBe(200);
      const extra = (meta.json().extraFields as Array<{ key: string }>).map((x) => x.key);
      expect(extra).toEqual(
        expect.arrayContaining(['second_language', 'mother_maiden_name', 'subjects', 'medium']),
      );
      expect(meta.json().options.Language).toContain('Sanskrit');
      expect(meta.json().templates).toHaveLength(2);
      const dup = await inject({
        method: 'POST',
        url: '/admissions/forms',
        headers: h(),
        json: { name: 'registration ix', template: 'general' },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('refuses a form whose mapping does not match the student master or whose rules point nowhere', async () => {
      const form = (
        await inject({ method: 'GET', url: `/admissions/forms/${formIx}`, headers: h() })
      ).json();
      const badList = structuredClone(form.def);
      badList.fields.find((f: { key: string }) => f.key === 'gender').list = 'YesNo';
      const r1 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: badList },
      });
      expect(r1.statusCode).toBe(400);
      expect(r1.json().detail).toMatch(/use the Gender list/);
      const badRule = structuredClone(form.def);
      badRule.fields[0].rules = [
        { logic: 'all', action: 'show', conditions: [{ field: 'nowhere', op: 'eq', value: 'x' }] },
      ];
      const r2 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: badRule },
      });
      expect(r2.statusCode).toBe(400);
      expect(r2.json().detail).toMatch(/does not exist/);
      const auto = structuredClone(form.def);
      auto.fields.push({ key: 'my_age', label: 'Age', type: 'text', step: 'student', maps: 'age' });
      const r3 = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formIx}`,
        headers: h(),
        json: { name: form.name, def: auto },
      });
      expect(r3.statusCode).toBe(400);
    });

    it('edits, copies and archives a form; only managers may change it', async () => {
      const form = (
        await inject({ method: 'GET', url: `/admissions/forms/${formXi}`, headers: h() })
      ).json();
      const def = structuredClone(form.def);
      def.settings.dobFrom = '2009-04-01';
      def.settings.dobTo = '2012-03-31';
      def.fields.push({ key: 'hobby', label: 'Hobby', type: 'text', step: 'other', copy: true });
      const ok = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formXi}`,
        headers: h(),
        json: { name: 'Registration XI', description: 'Written test', def },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().def.settings.dobTo).toBe('2012-03-31');
      const denied = await inject({
        method: 'PUT',
        url: `/admissions/forms/${formXi}`,
        headers: h(clerk),
        json: { name: 'x', def },
      });
      expect(denied.statusCode).toBe(403);
      const seen = await inject({
        method: 'GET',
        url: `/admissions/forms/${formXi}`,
        headers: h(clerk),
      });
      expect(seen.statusCode).toBe(200);
      const copy = await inject({
        method: 'POST',
        url: `/admissions/forms/${formXi}/copy`,
        headers: h(),
        json: { name: 'Registration XI (copy)' },
      });
      expect(copy.statusCode).toBe(201);
      const arch = await inject({
        method: 'POST',
        url: `/admissions/forms/${copy.json().id}/archive`,
        headers: h(),
      });
      expect(arch.json().status).toBe('archived');
      const list = await inject({ method: 'GET', url: '/admissions/forms', headers: h() });
      expect(list.json().data.map((f: { name: string }) => f.name)).toEqual(
        expect.arrayContaining(['Registration IX', 'Registration XI', 'Registration XI (copy)']),
      );
    });
  });
});
