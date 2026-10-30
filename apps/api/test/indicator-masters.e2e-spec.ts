/**
 * Indicator areas and level scales (docs/design/65): the school's lists a set picks from. A set's area is
 * spelt as the list has it (a new one joins the end), an item under a heading is in the heading's area,
 * the list's order is the order a set's items come back in, a rename renames the area in every set, and
 * a scale's new levels are the levels of every set and item rating on it (a renamed level's entries
 * follow it; a level with entries is not dropped). A set's save keeps its saved entries: an item that
 * has them is not removed or made a written note, and keeps the levels they are rated on.
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
  id: string;
  code: string;
  name: string;
  area: string | null;
  sortOrder: number;
  parentCode: string | null;
  kind: 'level' | 'text';
  levels: string[] | null;
  descriptors: Record<string, string>;
}

describe('indicator areas and level scales (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let classId: string;
  let section: string;
  let examId: string;
  let studentId: string;
  const s = stamp('IAS');
  const HPC = ['Beginner', 'Progressing', 'Proficient'];
  const FREQ = ['Rarely', 'Sometimes', 'Mostly', 'Always'];
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const areas = async () =>
    (await call(admin, 'GET', '/exams/indicator-areas')).json().data as Area[];
  const card = async () =>
    (
      (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
        id: string;
        code: string;
        grades: string[];
        levelWords: Record<string, string>;
        indicators: SetItem[];
      }>
    ).find((x) => x.code === 'CARD1')!;
  const items = async () => (await card()).indicators;
  /** the student's level per item, as the entry sheet has it */
  const grades = async (): Promise<Record<string, string | null>> => {
    const sheet = (
      await call(admin, 'GET', `/exams/${examId}/indicators?classSectionId=${section}`)
    ).json() as { rows: Array<{ grades: Record<string, { grade: string | null }> }> };
    return Object.fromEntries(Object.entries(sheet.rows[0]!.grades).map(([k, v]) => [k, v.grade]));
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'C1',
        name: 'Class 1',
        displayOrder: 0,
      })
    ).json().id;
    section = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'A' })
    ).json().id;
    studentId = (
      await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-1`,
        firstName: 'Ira',
        lastName: 'Scale',
        enrolment: { classSectionId: section, rollNo: 1 },
      })
    ).json().id;
    const type = (await call(admin, 'POST', '/exams/types', { code: 'TRM', name: 'Term' })).json()
      .id;
    examId = (
      await call(admin, 'POST', '/exams', {
        examTypeId: type,
        code: 'T1',
        name: 'Term 1',
        classes: [{ classId }],
      })
    ).json().id;
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
      levelWords: { Proficient: 'Sky' },
      indicators: [
        {
          code: 'L1',
          name: 'Speaks clearly',
          area: 'language',
          sortOrder: 1,
          descriptors: { Beginner: 'In words', Proficient: 'In full sentences' },
        },
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

  it('a scale’s new levels are its sets’ and items’; a renamed level’s entries follow; a level with entries stays', async () => {
    const set = await card();
    expect(
      (await call(admin, 'PUT', `/exams/${examId}/indicator-sets`, { classId, setId: set.id }))
        .statusCode,
    ).toBe(200);
    const by = (code: string) => set.indicators.find((i) => i.code === code)!.id;
    const entered = await call(admin, 'PUT', `/exams/${examId}/indicators`, {
      classSectionId: section,
      rows: [
        { studentId, indicatorId: by('L1'), grade: 'Proficient' },
        { studentId, indicatorId: by('O1A'), grade: 'Mostly' },
      ],
    });
    expect(entered.statusCode).toBe(200);
    const scales = (await call(admin, 'GET', '/exams/indicator-scales')).json().data as Scale[];
    const freq = scales.find((x) => x.levels.join() === FREQ.join())!;
    const hpc = scales.find((x) => x.levels.join() === HPC.join())!;
    const put = (x: Scale, name: string, levels: string[]) =>
      call(admin, 'PUT', '/exams/indicator-scales', { id: x.id, name, levels });

    // a level added at the top: the set rates on it, entries and words stay
    const four = [...HPC, 'Advanced'];
    expect((await put(hpc, 'Four steps', four)).statusCode).toBe(200);
    let now = await card();
    expect(now.grades).toEqual(four);
    expect(now.levelWords).toEqual({ Proficient: 'Sky' });
    expect((await grades())[by('L1')]).toBe('Proficient');

    // a level with entries is not taken out
    const out = await put(hpc, 'Four steps', ['Beginner', 'Progressing', 'Advanced']);
    expect(out.statusCode).toBe(409);
    expect(out.json()).toMatchObject({
      type: 'exams.level_has_entries',
      level: 'Proficient',
      entries: 1,
    });

    // new words in a level's place rename it: the entries, the set's words and the item's meanings follow
    expect(
      (await put(hpc, 'Four steps', ['Beginner', 'Progressing', 'Skilled', 'Advanced'])).statusCode,
    ).toBe(200);
    now = await card();
    expect(now.levelWords).toEqual({ Skilled: 'Sky' });
    expect(now.indicators.find((i) => i.code === 'L1')!.descriptors).toEqual({
      Beginner: 'In words',
      Skilled: 'In full sentences',
    });
    expect((await grades())[by('L1')]).toBe('Skilled');

    // a heading's own scale: the heading's levels change, its item's entry follows; a level with no
    // entries can go
    expect(
      (await put(freq, 'Frequency', ['Rarely', 'Sometimes', 'Often', 'Always'])).statusCode,
    ).toBe(200);
    expect((await items()).find((i) => i.code === 'O1')!.levels).toEqual([
      'Rarely',
      'Sometimes',
      'Often',
      'Always',
    ]);
    expect((await grades())[by('O1A')]).toBe('Often');
    expect((await put(freq, 'Frequency', ['Rarely', 'Sometimes', 'Often'])).statusCode).toBe(200);
    // the scale's name alone may change; levels another scale has are refused
    expect((await put(freq, 'How often', ['Rarely', 'Sometimes', 'Often'])).statusCode).toBe(200);
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
    // a used scale's new levels another scale has: refused, and nothing moved
    await call(admin, 'PUT', '/exams/indicator-scales', {
      name: 'Never / Often',
      levels: ['Never', 'Often'],
    });
    expect((await put(freq, 'How often', ['Never', 'Often'])).json().type).toBe(
      'exams.scale_exists',
    );
    expect((await items()).find((i) => i.code === 'O1')!.levels).toEqual([
      'Rarely',
      'Sometimes',
      'Often',
    ]);
    const twice = await call(admin, 'PUT', '/exams/indicator-scales', {
      name: 'Twice',
      levels: ['Yes', 'yes'],
    });
    expect(twice.statusCode).toBe(400);
  });

  it('a set’s save keeps its saved entries: an item with them stays, takes a level and keeps its levels', async () => {
    const set = await card();
    const id = (code: string) => set.indicators.find((i) => i.code === code)!.id;
    const before = await grades();
    expect(before[id('L1')]).toBe('Skilled');
    expect(before[id('O1A')]).toBe('Often');
    /** the set as it is, with a change to its items or its levels */
    const save = (change: (x: SetItem[]) => SetItem[], levels = set.grades) =>
      call(admin, 'PUT', '/exams/indicator-sets', {
        code: 'CARD1',
        name: 'Card one',
        kind: 'hpc',
        grades: levels,
        levelWords: Object.fromEntries(
          Object.entries(set.levelWords).filter(([g]) => levels.includes(g)),
        ),
        indicators: change(set.indicators).map(({ id: _, area, ...i }) => ({
          ...i,
          area: area ?? undefined,
        })),
      });
    const edit = (code: string, patch: Partial<SetItem>) => (x: SetItem[]) =>
      x.map((i) => (i.code === code ? { ...i, ...patch } : i));

    // an item with entries is not removed (the delete would take them with it)
    const removed = await save((x) => x.filter((i) => i.code !== 'L1'));
    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({
      type: 'exams.item_has_entries',
      code: 'L1',
      entries: 1,
    });
    expect(removed.json().detail).toContain('L1 has 1 saved entry');

    // nor made a written note while it holds a level
    const text = await save(edit('L1', { kind: 'text' }));
    expect(text.statusCode).toBe(409);
    expect(text.json()).toMatchObject({
      type: 'exams.item_text_has_entries',
      code: 'L1',
      entries: 1,
    });

    // the set's levels without an entry's level: refused for the item rating on them
    const setLevels = await save((x) => x, ['Not yet', 'Yes']);
    expect(setLevels.statusCode).toBe(409);
    expect(setLevels.json()).toMatchObject({
      type: 'exams.item_level_has_entries',
      code: 'L1',
      entries: 1,
      levels: ['Skilled'],
    });
    expect(setLevels.json().detail).toContain('L1 has 1 saved entry rated Skilled');
    // a heading's levels: its item's entries count; so does moving the item off the heading
    const heading = await save(edit('O1', { levels: ['Not yet', 'Yes'] }));
    expect(heading.json()).toMatchObject({ type: 'exams.item_level_has_entries', code: 'O1A' });
    const moved = await save(edit('O1A', { parentCode: null }));
    expect(moved.json()).toMatchObject({ type: 'exams.item_level_has_entries', code: 'O1A' });

    // each refusal rolled back: the set, its items and the entries are as they were
    const now = await card();
    expect(now.grades).toEqual(set.grades);
    expect(now.indicators.map((i) => [i.code, i.kind, i.levels, i.parentCode])).toEqual(
      set.indicators.map((i) => [i.code, i.kind, i.levels, i.parentCode]),
    );
    expect(await grades()).toEqual(before);

    // an item with no entries still goes, and a level that keeps the entries may be added
    const ok = await save((x) => x.filter((i) => i.code !== 'P1A'), [...set.grades, 'Expert']);
    expect(ok.statusCode).toBe(200);
    expect((await items()).map((i) => i.code)).not.toContain('P1A');
    expect(await grades()).toEqual(before);
  });

  it('a teacher sees the lists but does not change them', async () => {
    expect((await call(teacher, 'GET', '/exams/indicator-areas')).statusCode).toBe(200);
    expect(
      (await call(teacher, 'PUT', '/exams/indicator-areas', { name: 'Music' })).statusCode,
    ).toBe(403);
  });
});
