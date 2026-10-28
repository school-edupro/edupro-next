/**
 * Test and interview papers by class (0265, docs/design/57, part 1): a Test or Interview stage's paper
 * for a class lists its parts with maximum marks and an optional pass mark, and a minimum total %; the
 * class's maximum for the stage is the sum of the parts (else the stage's own); a part taken off is
 * switched off; a paper is copied to other classes; only set-up managers change papers.
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

describe('admission test and interview papers by class (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const s = stamp('APP');
  const ids: Record<string, string> = {};
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, u?: SeededUser) =>
    inject({
      method,
      url,
      headers: headersFor((u ?? admin).sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const stageMax = (stageId: string, classId: string) =>
    withMigrator(async (c) =>
      Number(
        (
          await c.query<{ m: string | null }>(`SELECT app.admission_stage_max($1, $2)::text AS m`, [
            stageId,
            classId,
          ])
        ).rows[0]!.m,
      ),
    );

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    for (const [code, name, order] of [
      ['I', 'Class I', 1],
      ['IX', 'Class IX', 9],
      ['X', 'Class X', 10],
    ] as const) {
      const r = await call('POST', '/academics/classes', { code, name, displayOrder: order });
      expect(r.statusCode).toBe(201);
      ids[code] = r.json().id as string;
    }
    const setup = (await call('GET', '/admissions/process-setup')).json();
    for (const st of setup.stages as Array<{ id: string; kind: string }>)
      if (st.kind === 'test' || st.kind === 'interview' || st.kind === 'document_check')
        ids[st.kind] = st.id;
    await withMigrator((c) =>
      c.query(
        `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'ENG', 'English'), ($1, 'MAT', 'Mathematics')`,
        [school.id],
      ),
    );
  });
  afterAll(async () => app.close());

  it("the school's list starts with its subjects and the usual extras; set-up managers change it", async () => {
    const first = (await call('GET', '/admissions/paper-items')).json();
    const kinds = Object.fromEntries(
      (first.items as Array<{ name: string; kind: string }>).map((i) => [i.name, i.kind]),
    );
    expect(kinds).toMatchObject({
      English: 'test',
      Mathematics: 'test',
      'Mental Ability': 'test',
      Communication: 'interview',
    });
    expect(first.subjects).toEqual([]);
    const items = first.items as Array<{ id: string; name: string; kind: string }>;
    const keep = items.map(({ id, name, kind }) => ({ id, name, kind }));
    const added = await call('PUT', '/admissions/paper-items', {
      items: [
        ...keep,
        { name: 'Science', kind: 'test', maxMarks: 30 },
        { name: 'Group discussion', kind: 'both' },
      ],
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().items.find((i: { name: string }) => i.name === 'Science')).toMatchObject({
      kind: 'test',
      maxMarks: 30,
      used: 0,
    });
    const twice = await call('PUT', '/admissions/paper-items', {
      items: [...keep, { name: 'english', kind: 'test' }],
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().detail).toBe('english is on the list twice');
    expect(
      (await call('PUT', '/admissions/paper-items', { items: keep }, coordinator)).statusCode,
    ).toBe(403);
  });

  it('lists every class without a paper, the stage maximum, and the list for the stage', async () => {
    const r = await call('GET', `/admissions/stages/${ids.test!}/papers`);
    expect(r.statusCode).toBe(200);
    expect(r.json().stage).toMatchObject({ kind: 'test', maxMarks: 100 });
    expect(r.json().classes.map((k: { name: string }) => k.name)).toEqual([
      'Class I',
      'Class IX',
      'Class X',
    ]);
    expect(r.json().classes.every((k: { paper: unknown }) => k.paper === null)).toBe(true);
    const names = (x: { items: Array<{ name: string }> }) => x.items.map((i) => i.name);
    expect(names(r.json())).toEqual(
      expect.arrayContaining(['English', 'Mathematics', 'Mental Ability', 'Science']),
    );
    expect(names(r.json())).not.toContain('Communication');
    const iv = names((await call('GET', `/admissions/stages/${ids.interview!}/papers`)).json());
    expect(iv).toEqual(expect.arrayContaining(['Communication', 'Group discussion']));
    expect(iv).not.toContain('English');
    // a document check has no paper
    expect((await call('GET', `/admissions/stages/${ids.document_check!}/papers`)).statusCode).toBe(
      400,
    );
    expect(await stageMax(ids.test!, ids.IX!)).toBe(100);
  });

  it("saves a class's paper: the maximum becomes the sum of its parts; checks the parts", async () => {
    const saved = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      minPercent: 40,
      parts: [
        { name: 'English', maxMarks: 50, passMarks: 15 },
        { name: 'Mathematics', maxMarks: 50 },
        { name: 'Science', maxMarks: 30 },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().paper).toMatchObject({
      minPercent: 40,
      total: 130,
      parts: [
        { name: 'English', maxMarks: 50, passMarks: 15 },
        { name: 'Mathematics', maxMarks: 50, passMarks: null },
        { name: 'Science', maxMarks: 30, passMarks: null },
      ],
    });
    expect(await stageMax(ids.test!, ids.IX!)).toBe(130);
    // other classes keep the stage's own maximum
    expect(await stageMax(ids.test!, ids.I!)).toBe(100);
    const twice = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      parts: [
        { name: 'English', maxMarks: 50 },
        { name: 'english ', maxMarks: 20 },
      ],
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().detail).toBe('English is on the paper twice');
    // only the list's entries, and only those for the stage
    const missing = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      parts: [{ name: 'Hindi Dictation', maxMarks: 20 }],
    });
    expect(missing.json().detail).toBe(
      'Hindi Dictation is not on Subjects and parameters: add it there first',
    );
    const wrong = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      parts: [{ name: 'Communication', maxMarks: 10 }],
    });
    expect(wrong.json().detail).toBe('Communication is not for the written test');
    const over = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      parts: [{ name: 'English', maxMarks: 50, passMarks: 60 }],
    });
    expect(over.statusCode).toBe(400);
    expect(
      (
        await call(
          'PUT',
          `/admissions/stages/${ids.test!}/papers/${ids.IX!}`,
          { parts: [{ name: 'English', maxMarks: 50 }] },
          coordinator,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('a list entry renamed renames its parts; reorders; a part taken off is switched off, not deleted', async () => {
    const list = (await call('GET', '/admissions/paper-items')).json().items as Array<{
      id: string;
      name: string;
      kind: string;
    }>;
    const renamed = await call('PUT', '/admissions/paper-items', {
      items: list.map(({ id, name, kind }) => ({
        id,
        name: name === 'Mathematics' ? 'Maths' : name,
        kind,
      })),
    });
    expect(renamed.statusCode).toBe(200);
    const before = (await call('GET', `/admissions/stages/${ids.test!}/papers`)).json();
    const paper = before.classes.find((k: { id: string }) => k.id === ids.IX).paper;
    expect(paper.parts.map((p: { name: string }) => p.name)).toEqual([
      'English',
      'Maths',
      'Science',
    ]);
    const [eng, mat, sci] = paper.parts as Array<{ id: string; itemId: string }>;
    // an entry on a written test paper cannot become interview-only
    const misfit = await call('PUT', '/admissions/paper-items', {
      items: list.map(({ id, name, kind }) => ({
        id,
        name: name === 'Mathematics' ? 'Maths' : name,
        kind: name === 'Mathematics' ? 'interview' : kind,
      })),
    });
    expect(misfit.json().detail).toBe(
      'Maths is on a written test paper: keep it for the written test or both',
    );
    const r = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      minPercent: null,
      parts: [
        { id: mat!.id, itemId: mat!.itemId, maxMarks: 60 },
        { id: eng!.id, itemId: eng!.itemId, maxMarks: 50, passMarks: 15 },
      ],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().paper).toMatchObject({ minPercent: null, total: 110 });
    expect(r.json().paper.parts.map((p: { id: string; name: string }) => [p.id, p.name])).toEqual([
      [mat!.id, 'Maths'],
      [eng!.id, 'English'],
    ]);
    const science = await withMigrator((c) =>
      c.query<{ status: string }>(`SELECT status FROM admission_paper_parts WHERE id = $1`, [
        sci!.id,
      ]),
    );
    expect(science.rows[0]!.status).toBe('inactive');
    // a part may take back an entry left by one switched off
    const again = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.IX!}`, {
      parts: [
        { id: mat!.id, itemId: mat!.itemId, maxMarks: 60 },
        { id: eng!.id, itemId: eng!.itemId, maxMarks: 50, passMarks: 15 },
        { itemId: sci!.itemId, maxMarks: 30 },
      ],
    });
    expect(again.json().paper.total).toBe(140);
    // an entry in use taken off the list is switched off: its papers keep it, new papers cannot pick it
    const now = (await call('GET', '/admissions/paper-items')).json().items as Array<{
      id: string;
      name: string;
      kind: string;
    }>;
    const off = await call('PUT', '/admissions/paper-items', {
      items: now
        .filter((i) => i.name !== 'Science')
        .map(({ id, name, kind }) => ({ id, name, kind })),
    });
    expect(off.json().items.find((i: { name: string }) => i.name === 'Science')).toMatchObject({
      status: 'inactive',
      used: 1,
    });
    const page = (await call('GET', `/admissions/stages/${ids.test!}/papers`)).json();
    expect(page.items.find((i: { name: string }) => i.name === 'Science')).toMatchObject({
      off: true,
    });
    const refused = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.I!}`, {
      parts: [{ itemId: sci!.itemId, maxMarks: 30 }],
    });
    expect(refused.json().detail).toBe('Science is switched off on the list');
    await call('PUT', '/admissions/paper-items', {
      items: off
        .json()
        .items.map(({ id, name, kind }: { id: string; name: string; kind: string }) => ({
          id,
          name,
          kind,
          status: 'active',
        })),
    });
    // the school's subjects not on the list yet are added in one go
    await withMigrator((c) =>
      c.query(`INSERT INTO subjects (school_id, code, name) VALUES ($1, 'HIN', 'Hindi')`, [
        school.id,
      ]),
    );
    // (Mathematics too: the list calls it Maths now)
    expect((await call('GET', '/admissions/paper-items')).json().subjects).toEqual([
      'Hindi',
      'Mathematics',
    ]);
    const imp = await call('POST', '/admissions/paper-items/import-subjects');
    expect(imp.json()).toMatchObject({ added: 2, subjects: [] });
    expect(imp.json().items.find((i: { name: string }) => i.name === 'Hindi')).toMatchObject({
      kind: 'test',
      status: 'active',
    });
  });

  it('copies a paper to other classes; an empty paper leaves the stage maximum', async () => {
    const r = await call('POST', `/admissions/stages/${ids.test!}/papers/copy`, {
      fromClassId: ids.IX,
      toClassIds: [ids.X, ids.IX],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ copied: 1 });
    const list = (await call('GET', `/admissions/stages/${ids.test!}/papers`)).json();
    const x = list.classes.find((k: { id: string }) => k.id === ids.X).paper;
    expect(x).toMatchObject({ total: 140 });
    expect(x.parts.map((p: { name: string }) => p.name)).toEqual(['Maths', 'English', 'Science']);
    expect(
      (
        await call('POST', `/admissions/stages/${ids.test!}/papers/copy`, {
          fromClassId: ids.I,
          toClassIds: [ids.X],
        })
      ).statusCode,
    ).toBe(400);
    // the interview's parameters are a paper of their own
    const iv = await call('PUT', `/admissions/stages/${ids.interview!}/papers/${ids.I!}`, {
      parts: [
        { name: 'Communication', maxMarks: 10 },
        { name: 'Confidence', maxMarks: 10 },
      ],
    });
    expect(iv.json().paper.total).toBe(20);
    expect(await stageMax(ids.interview!, ids.I!)).toBe(20);
    const empty = await call('PUT', `/admissions/stages/${ids.test!}/papers/${ids.X!}`, {
      minPercent: 50,
      parts: [],
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ paper: null });
    expect(await stageMax(ids.test!, ids.X!)).toBe(100);
  });
});
