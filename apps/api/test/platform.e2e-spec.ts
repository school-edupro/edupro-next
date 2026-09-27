/** Platform settings, years and school profile (S2-06, S2-07). */
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

describe('platform settings, years and school (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let viewer: SeededUser;

  beforeAll(async () => {
    const s = stamp('PLT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      viewer = await seedUser(c, school, `${s}-auditor`, 'auditor');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = (sub: string) => headersFor(sub, school.id);

  describe('settings', () => {
    it('returns catalogue defaults, validates values and keeps history', async () => {
      const defaults = await inject({
        method: 'GET',
        url: '/platform/settings',
        headers: A(viewer.sub),
      });
      expect(defaults.statusCode).toBe(200);
      const lateFee = defaults
        .json()
        .data.find((s: { key: string }) => s.key === 'fees.late_fee_mode');
      expect(lateFee).toMatchObject({ value: 'daywise', isDefault: true, module: 'fees' });

      const bad = await inject({
        method: 'PUT',
        url: '/platform/settings/fees.late_fee_mode',
        headers: A(admin.sub),
        json: { value: 'monthly' },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ type: 'validation-failed' });

      const unknown = await inject({
        method: 'PUT',
        url: '/platform/settings/nope.key',
        headers: A(admin.sub),
        json: { value: 1 },
      });
      expect(unknown.statusCode).toBe(404);

      const ok = await inject({
        method: 'PUT',
        url: '/platform/settings/fees.late_fee_mode',
        headers: A(admin.sub),
        json: { value: 'slab' },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toMatchObject({
        key: 'fees.late_fee_mode',
        value: 'slab',
        isDefault: false,
      });

      const history = await inject({
        method: 'GET',
        url: '/platform/settings/fees.late_fee_mode/history',
        headers: A(viewer.sub),
      });
      expect(history.json().data).toHaveLength(1);

      const denied = await inject({
        method: 'PUT',
        url: '/platform/settings/fees.late_fee_mode',
        headers: A(viewer.sub),
        json: { value: 'daywise' },
      });
      expect(denied.statusCode).toBe(403);
    });

    it('is readable from SQL through app.setting()', async () => {
      const value = await withMigrator(async (c) => {
        await c.query(`SELECT set_config('app.school_id', $1, false)`, [school.id]);
        const r = await c.query<{ v: string }>(
          `SELECT app.setting('fees.late_fee_mode')::text AS v`,
        );
        return r.rows[0]?.v;
      });
      expect(value).toBe('"slab"');
    });
  });

  describe('years', () => {
    let newYearId: string;

    it('creates a planned academic year and rejects overlaps', async () => {
      const res = await inject({
        method: 'POST',
        url: '/platform/years',
        headers: A(admin.sub),
        json: {
          kind: 'academic',
          code: '2027-28',
          name: 'Session 2027-28',
          startDate: '2027-04-01',
          endDate: '2028-03-31',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ kind: 'academic', status: 'planned' });
      newYearId = res.json().id;
      const overlap = await inject({
        method: 'POST',
        url: '/platform/years',
        headers: A(admin.sub),
        json: {
          kind: 'academic',
          code: '2027-29',
          name: 'Bad',
          startDate: '2027-06-01',
          endDate: '2028-05-31',
        },
      });
      expect(overlap.statusCode).toBe(409);
      expect(overlap.json()).toMatchObject({ type: 'year.overlap' });
    });

    it('activates the new year; the previous one locks and /me follows', async () => {
      const res = await inject({
        method: 'POST',
        url: `/platform/years/academic/${newYearId}/activate`,
        headers: A(admin.sub),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ status: 'active' });
      const list = await inject({ method: 'GET', url: '/platform/years', headers: A(viewer.sub) });
      const old = list.json().data.find((y: { id: string }) => y.id === school.yearId);
      expect(old.status).toBe('locked');
      const me = await inject({ method: 'GET', url: '/me', headers: A(admin.sub) });
      expect(me.json().academicYear).toMatchObject({ id: newYearId, status: 'active' });
      const listed = me
        .json()
        .academicYears.map((y: { id: string; status: string }) => [y.id, y.status]);
      expect(listed).toEqual(
        expect.arrayContaining([
          [newYearId, 'active'],
          [school.yearId, 'locked'],
        ]),
      );
      // A member without platform.year.view still sees the open years for the year switch
      const viewerMe = await inject({ method: 'GET', url: '/me', headers: A(viewer.sub) });
      expect(viewerMe.json().academicYears.length).toBeGreaterThanOrEqual(2);
    });

    it('locks and reopens a stage, which the procedure layer enforces', async () => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: A(admin.sub),
        json: { code: 'IX', name: 'Class IX' },
      });
      expect(cls.statusCode).toBe(201);
      const lock = await inject({
        method: 'POST',
        url: `/platform/years/academic/${newYearId}/lock`,
        headers: A(admin.sub),
        json: { stage: 'academics', reason: 'timetable frozen' },
      });
      expect(lock.statusCode).toBe(201);
      expect(lock.json().locks).toMatchObject({ academics: true });
      const blocked = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'A' },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ type: 'year.stage_locked' });
      const reopen = await inject({
        method: 'POST',
        url: `/platform/years/academic/${newYearId}/reopen`,
        headers: A(admin.sub),
        json: { stage: 'academics', reason: 'late change' },
      });
      expect(reopen.statusCode).toBe(201);
      const allowed = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'A' },
      });
      expect(allowed.statusCode).toBe(201);
    });

    it('refuses to close the active year', async () => {
      const res = await inject({
        method: 'POST',
        url: `/platform/years/academic/${newYearId}/close`,
        headers: A(admin.sub),
        json: { reason: 'oops' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'year.active' });
    });
  });

  describe('school profile and campuses', () => {
    it('reads and updates the profile, adds a campus, rejects duplicate campus codes', async () => {
      const get = await inject({ method: 'GET', url: '/platform/school', headers: A(viewer.sub) });
      expect(get.statusCode).toBe(200);
      expect(get.json().campuses.map((c: { code: string }) => c.code)).toEqual(['MAIN']);

      const patch = await inject({
        method: 'PATCH',
        url: '/platform/school',
        headers: A(admin.sub),
        json: { shortName: 'PLT', board: 'ICSE' },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json()).toMatchObject({ shortName: 'PLT', board: 'ICSE' });

      const campus = await inject({
        method: 'POST',
        url: '/platform/school/campuses',
        headers: A(admin.sub),
        json: { code: 'ANNEX', name: 'Annex', geo: { lat: 28.6, lng: 77.2 } },
      });
      expect(campus.statusCode).toBe(201);
      const dup = await inject({
        method: 'POST',
        url: '/platform/school/campuses',
        headers: A(admin.sub),
        json: { code: 'ANNEX', name: 'Annex again' },
      });
      expect(dup.statusCode).toBe(409);
    });
  });
});
