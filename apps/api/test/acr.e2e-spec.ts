/**
 * Employee ACR (0184, docs/design/32-employee-acr.md), part 1: the set-up a school starts with, the levels
 * it sets (how many, who fills each), the question bank, grade bands and cycles, and who may change them.
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

describe('employee ACR set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('ACR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  const setup = async () =>
    (await inject({ method: 'GET', url: '/people/acr/setup', headers: h(admin) })).json();

  it('a school starts with two levels per staff group, five grades and the earlier question bank', async () => {
    const s = await setup();
    expect(
      s.levels.teaching.map((l: { label: string; kind: string; action: string }) => [
        l.label,
        l.kind,
        l.action,
      ]),
    ).toEqual([
      ['HOD', 'acr_hod', 'rate'],
      ['Principal', 'designation', 'review'],
    ]);
    expect(s.bands.map((b: { label: string }) => b.label)).toEqual([
      'Outstanding',
      'Very good',
      'Good',
      'Average',
      'Below average',
    ]);
    expect(s.settings).toEqual({
      scaleLabels: ['Outstanding', 'Very good', 'Good', 'Average', 'Below average'],
      representationDays: 15,
    });
    const q = s.questions as Array<{ part: string; staffGroup: string; kind: string }>;
    expect(q.filter((x) => x.part === 'rate' && x.staffGroup === 'non_teaching')).toHaveLength(21);
    expect(
      q.filter((x) => x.part === 'self' && x.staffGroup === 'teaching' && x.kind === 'scale'),
    ).toHaveLength(10);
    const no = await inject({ method: 'GET', url: '/people/acr/setup', headers: h(teacher) });
    expect(no.statusCode).toBe(403);
  });

  it('levels: as many as the school wants, each one complete, at least one that rates', async () => {
    const put = (levels: unknown[]) =>
      inject({
        method: 'PUT',
        url: '/people/acr/setup/levels',
        headers: h(admin),
        json: { staffGroup: 'non_teaching', levels },
      });
    const noRate = await put([
      { label: 'Principal', kind: 'role', roleCode: 'school_admin', action: 'review' },
    ]);
    expect(noRate.statusCode).toBe(400);
    const incomplete = await put([{ label: 'HOD', kind: 'role', action: 'rate' }]);
    expect(incomplete.statusCode).toBe(400);
    const ok = await put([
      { label: 'Section head', kind: 'approver_l1', action: 'rate' },
      { label: 'Administrator', kind: 'approver_l2', action: 'rate' },
      { label: 'Principal', kind: 'designation', designation: 'Principal', action: 'review' },
      { label: 'Director', kind: 'role', roleCode: 'school_admin', action: 'review' },
    ]);
    expect(ok.statusCode).toBe(200);
    const s = await setup();
    expect(
      s.levels.non_teaching.map(
        (l: { seq: number; label: string }) => `${String(l.seq)} ${l.label}`,
      ),
    ).toEqual(['1 Section head', '2 Administrator', '3 Principal', '4 Director']);
    // the teaching levels are untouched
    expect(s.levels.teaching).toHaveLength(2);
    const byTeacher = await inject({
      method: 'PUT',
      url: '/people/acr/setup/levels',
      headers: h(teacher),
      json: { staffGroup: 'teaching', levels: [{ label: 'x', kind: 'acr_hod', action: 'rate' }] },
    });
    expect(byTeacher.statusCode).toBe(403);
  });

  it('grades need a 0% start and distinct names; the scale words and days to object are saved', async () => {
    const put = (bands: unknown[]) =>
      inject({
        method: 'PUT',
        url: '/people/acr/setup/settings',
        headers: h(admin),
        json: { scaleLabels: ['Excellent', 'Good', 'Fair', 'Poor'], representationDays: 10, bands },
      });
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 50, label: 'B' },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 0, label: 'A' },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 50, label: 'B' },
          { minPct: 0, label: 'C', adverse: true },
        ])
      ).statusCode,
    ).toBe(200);
    const s = await setup();
    expect(s.settings).toEqual({
      scaleLabels: ['Excellent', 'Good', 'Fair', 'Poor'],
      representationDays: 10,
    });
    expect(s.bands).toEqual([
      { minPct: 80, label: 'A', adverse: false },
      { minPct: 50, label: 'B', adverse: false },
      { minPct: 0, label: 'C', adverse: true },
    ]);
  });

  it('questions are added, changed and switched off; cycles one per year', async () => {
    const add = await inject({
      method: 'POST',
      url: '/people/acr/setup/questions',
      headers: h(admin),
      json: {
        part: 'rate',
        staffGroup: 'both',
        section: 'Values',
        text: 'Care for children',
        kind: 'scale',
        weight: 2,
      },
    });
    expect(add.statusCode).toBe(201);
    const off = await inject({
      method: 'PUT',
      url: `/people/acr/setup/questions/${add.json().id}`,
      headers: h(admin),
      json: {
        part: 'rate',
        staffGroup: 'both',
        section: 'Values',
        text: 'Care for children',
        kind: 'scale',
        weight: 2,
        active: false,
      },
    });
    expect(off.statusCode).toBe(200);
    const q = (await setup()).questions.find((x: { id: string }) => x.id === add.json().id);
    expect(q).toMatchObject({ weight: 2, active: false, staffGroup: 'both' });

    const year = await withMigrator((c) =>
      c.query<{ id: string }>('SELECT id::text FROM academic_years WHERE school_id = $1 LIMIT 1', [
        school.id,
      ]),
    );
    const cycle = {
      academicYearId: year.rows[0]!.id,
      name: 'ACR 2026-27',
      selfFrom: '2027-02-01',
      selfTo: '2027-02-28',
    };
    const bad = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: { ...cycle, selfTo: '2027-01-01' },
    });
    expect(bad.statusCode).toBe(400);
    const made = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: cycle,
    });
    expect(made.statusCode).toBe(201);
    const twice = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: cycle,
    });
    expect(twice.statusCode).toBe(409);
    const s = await setup();
    expect(s.cycles[0]).toMatchObject({ name: 'ACR 2026-27', status: 'draft', reports: 0 });
  });
});
