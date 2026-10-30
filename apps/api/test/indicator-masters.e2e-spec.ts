/**
 * Indicator areas and level scales (docs/design/65): the school's lists a set picks from. A set's area is
 * spelt as the list has it (a new one joins the end), an item under a heading is in the heading's area,
 * the list's order is the order a set's items come back in, a rename renames the area in every set, and
 * a scale a set uses keeps its levels.
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

interface Area {
  id: string;
  name: string;
  sortOrder: number;
  status: string;
  items: number;
}
interface Scale {
  id: string;
  name: string;
  levels: string[];
  used: number;
}
interface SetItem {
  code: string;
  area: string | null;
  levels: string[] | null;
}

describe('indicator areas and level scales (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const s = stamp('IAS');
  const HPC = ['Beginner', 'Progressing', 'Proficient'];
  const FREQ = ['Rarely', 'Sometimes', 'Mostly', 'Always'];
  const call = (u: SeededUser, method: 'GET' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const areas = async () =>
    (await call(admin, 'GET', '/exams/indicator-areas')).json().data as Area[];
  const items = async () =>
    (
      (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
        code: string;
        indicators: SetItem[];
      }>
    ).find((x) => x.code === 'CARD1')!.indicators;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('a set uses the lists: the area as the list spells it, a heading’s area for its items, new ones at the end', async () => {
    const lang = await call(admin, 'PUT', '/exams/indicator-areas', { name: 'Language' });
    expect(lang.statusCode).toBe(200);
    const put = await call(admin, 'PUT', '/exams/indicator-sets', {
      code: 'CARD1',
      name: 'Card one',
      kind: 'hpc',
      grades: HPC,
      levelWords: {},
      indicators: [
        { code: 'L1', name: 'Speaks clearly', area: 'language', sortOrder: 1 },
        { code: 'P1', name: 'Moves with control', area: 'Physical', sortOrder: 2 },
        // under P1: P1's area, whatever was sent
        { code: 'P1A', name: 'Runs and jumps', area: 'Elsewhere', parentCode: 'P1', sortOrder: 3 },
        { code: 'O1', name: 'Observation', area: 'Observation', sortOrder: 4, levels: FREQ },
        { code: 'O1A', name: 'Shares', area: 'Observation', parentCode: 'O1', sortOrder: 5 },
      ],
    });
    expect(put.statusCode).toBe(200);
    const list = await areas();
    expect(list.map((a) => a.name)).toEqual(['Language', 'Physical', 'Observation']);
    expect(list.find((a) => a.name === 'Physical')!.items).toBe(2);
    expect(list.map((a) => a.name)).not.toContain('Elsewhere');
    const got = await items();
    expect(got.find((i) => i.code === 'L1')!.area).toBe('Language');
    expect(got.find((i) => i.code === 'P1A')!.area).toBe('Physical');
    const scales = (await call(admin, 'GET', '/exams/indicator-scales')).json().data as Scale[];
    expect(scales.map((x) => x.levels)).toEqual(expect.arrayContaining([HPC, FREQ]));
    expect(scales.find((x) => x.levels.join() === FREQ.join())!.used).toBe(1);
  });

  it('the list’s order is the order items come back in; a rename renames the area in every set', async () => {
    const physical = (await areas()).find((a) => a.name === 'Physical')!;
    expect(
      (
        await call(admin, 'PUT', '/exams/indicator-areas', {
          id: physical.id,
          name: 'Physical development',
          sortOrder: 1,
        })
      ).statusCode,
    ).toBe(200);
    const got = await items();
    expect(got.map((i) => i.code)).toEqual(['P1', 'P1A', 'L1', 'O1', 'O1A']);
    expect(got.filter((i) => i.area === 'Physical development').map((i) => i.code)).toEqual([
      'P1',
      'P1A',
    ]);
    const dup = await call(admin, 'PUT', '/exams/indicator-areas', { name: 'language' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().type).toBe('exams.area_exists');
  });

  it('a scale a set uses keeps its levels; its name may change; a new scale is added', async () => {
    const scales = (await call(admin, 'GET', '/exams/indicator-scales')).json().data as Scale[];
    const freq = scales.find((x) => x.levels.join() === FREQ.join())!;
    const change = await call(admin, 'PUT', '/exams/indicator-scales', {
      id: freq.id,
      name: 'Frequency',
      levels: ['Never', 'Sometimes', 'Always'],
    });
    expect(change.statusCode).toBe(409);
    expect(change.json().type).toBe('exams.scale_in_use');
    expect(
      (
        await call(admin, 'PUT', '/exams/indicator-scales', {
          id: freq.id,
          name: 'Frequency',
          levels: FREQ,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(admin, 'PUT', '/exams/indicator-scales', {
          name: 'Yes / Not yet',
          levels: ['Not yet', 'Yes'],
        })
      ).statusCode,
    ).toBe(200);
    const again = await call(admin, 'PUT', '/exams/indicator-scales', {
      name: 'Same levels',
      levels: ['Not yet', 'Yes'],
    });
    expect(again.json().type).toBe('exams.scale_exists');
    const twice = await call(admin, 'PUT', '/exams/indicator-scales', {
      name: 'Twice',
      levels: ['Yes', 'yes'],
    });
    expect(twice.statusCode).toBe(400);
  });

  it('a teacher sees the lists but does not change them', async () => {
    expect((await call(teacher, 'GET', '/exams/indicator-areas')).statusCode).toBe(200);
    expect(
      (await call(teacher, 'PUT', '/exams/indicator-areas', { name: 'Music' })).statusCode,
    ).toBe(403);
  });
});
