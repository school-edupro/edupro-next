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

/**
 * Grade registers like the legacy Grade Register (docs/design/69, part 2): saved registers of indicator
 * grades with the mark registers' rights, versions, bin, copy and assign.
 */
describe('grade registers like the legacy Grade Register (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  const s = stamp('GR');
  const ids = {
    vi: '',
    vii: '',
    t1: '',
    pt: '',
    set: '',
    work: '',
    art: '',
    listens: '',
    neat: '',
  };
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url: `/exams/grade-registers${url}`,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const def = (over: Record<string, unknown> = {}) => ({
    v: 1,
    exams: [{ examId: ids.t1, label: 'T1' }],
    exAreas: [],
    exLeaves: [],
    labels: {},
    order: { areas: [], items: {}, leaves: {} },
    orderBy: 'roll',
    descHeader: 'full',
    showLegend: true,
    properCase: true,
    blankText: '',
    overall: 'off',
    scale: [],
    studentCols: [
      { key: 'sr', show: true },
      { key: 'adm', show: true },
      { key: 'roll', show: true },
      { key: 'name', show: true },
    ],
    ...over,
  });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-t`, 'class_teacher');
      other = await seedUser(c, school, `${s}-o`, 'class_teacher');
      for (const [key, code, order] of [
        ['vi', 'VI', 6],
        ['vii', 'VII', 7],
      ] as const)
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, $2, $3, $4) RETURNING id::text`,
            [school.id, code, `Class ${code}`, order],
          )
        ).rows[0]!.id;
      const type = await c.query<{ id: string }>(
        `INSERT INTO exam_types (school_id, code, name) VALUES ($1, 'T', 'Term') RETURNING id::text`,
        [school.id],
      );
      for (const [key, code, areas] of [
        ['t1', 'TERM1', '{marks,indicators}'],
        ['pt', 'PT1', '{marks}'],
      ] as const) {
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name, areas) VALUES ($1, $2, $3, $4, $5, $6::text[]) RETURNING id::text`,
            [school.id, school.yearId, type.rows[0]!.id, code, code, areas],
          )
        ).rows[0]!.id;
        for (const k of [ids.vi, ids.vii])
          await c.query(
            `INSERT INTO exam_classes (school_id, exam_id, class_id) VALUES ($1, $2, $3)`,
            [school.id, ids[key], k],
          );
      }
      // a set: Co-scholastic (two items rated themselves), Discipline (a heading with two)
      await c.query(
        `INSERT INTO indicator_areas (school_id, name, sort_order) VALUES ($1, 'Discipline', 1), ($1, 'Co-scholastic', 2)`,
        [school.id],
      );
      ids.set = (
        await c.query<{ id: string }>(
          `INSERT INTO indicator_sets (school_id, code, name, grades) VALUES ($1, 'COSCH', 'Co-scholastic', '{A,B,C}') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      const add = async (
        code: string,
        name: string,
        area: string,
        order: number,
        parent?: string,
      ) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO indicators (school_id, set_id, code, name, area, sort_order, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
            [school.id, ids.set, code, name, area, order, parent ?? null],
          )
        ).rows[0]!.id;
      ids.work = await add('WORK', 'Work education', 'Co-scholastic', 1);
      ids.art = await add('ART', 'Art education', 'Co-scholastic', 2);
      const conduct = await add('COND', 'Conduct', 'Discipline', 3);
      ids.listens = await add('LIS', 'Listens', 'Discipline', 4, conduct);
      ids.neat = await add('NEAT', 'Neat work', 'Discipline', 5, conduct);
      for (const k of [ids.vi, ids.vii])
        await c.query(
          `INSERT INTO exam_indicator_sets (school_id, exam_id, class_id, set_id) VALUES ($1, $2, $3, $4)`,
          [school.id, ids.t1, k, ids.set],
        );
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  let regId = '';

  it('the builder: classes, the exams that rate indicators, the tree in the areas order, the levels', async () => {
    const b = await call(admin, 'GET', `/builder?classIds=${ids.vi}&examIds=${ids.t1}`);
    expect(b.statusCode).toBe(200);
    const body = b.json() as {
      classes: Array<{ code: string; noGrades: boolean }>;
      exams: Array<{ id: string; classes: string[] }>;
      tree: {
        areas: Array<{ name: string }>;
        leaves: Array<{ id: string; itemName: string | null }>;
      };
      levels: string[];
    };
    expect(body.classes.map((k) => [k.code, k.noGrades])).toEqual([
      ['VI', true],
      ['VII', true],
    ]);
    // only the exam that rates indicators, with the classes it covers
    expect(body.exams).toEqual([{ id: ids.t1, code: 'TERM1', name: 'TERM1', classes: ['VI'] }]);
    // Discipline first (the areas master's order); a heading is not a column, its items are
    expect(body.tree.areas.map((a) => a.name)).toEqual(['Discipline', 'Co-scholastic']);
    expect(body.tree.leaves.map((l) => l.id)).toEqual([ids.listens, ids.neat, ids.work, ids.art]);
    expect(body.tree.leaves[0]!.itemName).toBe('Conduct');
    expect(body.levels).toEqual(['A', 'B', 'C']);
  });

  it('saves a register: names unique in the year, a register needs an indicator; a teacher cannot make one', async () => {
    const made = await call(admin, 'POST', '', {
      name: 'Indicator Register Class VI',
      classIds: [ids.vi],
      def: def({ labels: { [ids.listens]: 'Listens well' } }),
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ status: 'draft', version: 1, accessType: 'all' });
    regId = made.json().id;
    expect(
      (
        await call(admin, 'POST', '', {
          name: '  indicator register   class vi ',
          classIds: [ids.vii],
          def: def(),
        })
      ).json().type,
    ).toBe('exams.register_name');
    const none = await call(admin, 'POST', '', {
      name: 'Nothing ticked',
      classIds: [ids.vi],
      def: def({ exAreas: ['discipline', 'co-scholastic'] }),
    });
    expect(none.statusCode).toBe(400);
    expect(none.json().detail).toContain('Tick at least one indicator');
    expect(
      (await call(teacher, 'POST', '', { name: 'Mine', classIds: [ids.vi], def: def() }))
        .statusCode,
    ).toBe(403);
  });

  it('a teacher sees only what is given to them; Run alone does not edit', async () => {
    expect((await call(teacher, 'GET', '')).json()).toMatchObject({
      data: [],
      canCreate: false,
      canAssign: false,
    });
    const given = await call(admin, 'PUT', `/${regId}/access`, {
      rows: [{ userId: teacher.id, run: true, edit: false, delete: false, assign: false }],
    });
    expect(given.statusCode).toBe(200);
    const list = (await call(teacher, 'GET', '')).json().data as Array<{
      id: string;
      rights: Record<string, boolean>;
      assessments: string[];
    }>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: regId,
      assessments: ['TERM1'],
      rights: { run: true, edit: false, delete: false, assign: false },
    });
    expect((await call(teacher, 'GET', `/${regId}`)).statusCode).toBe(200);
    expect((await call(teacher, 'PUT', `/${regId}`, { name: 'Changed' })).statusCode).toBe(403);
    const admins = (await call(admin, 'GET', '')).json().data as Array<{
      assignees: Array<{ rights: string }>;
    }>;
    expect(admins[0]!.assignees[0]!.rights).toBe('Run');
  });

  it('a draft changes in place; a locked one makes the next version; locking it replaces the old', async () => {
    const saved = await call(admin, 'PUT', `/${regId}`, { def: def({ overall: 'mode' }) });
    expect(saved.json()).toMatchObject({ id: regId, version: 1 });
    expect((await call(admin, 'POST', `/${regId}/lock`)).json().status).toBe('locked');
    // a locked register is not deleted
    expect((await call(admin, 'DELETE', `/${regId}`)).statusCode).toBe(409);
    const v2 = await call(admin, 'PUT', `/${regId}`, { def: def({ blankText: '-' }) });
    expect(v2.json()).toMatchObject({ version: 2, status: 'draft' });
    const v2id = v2.json().id as string;
    // the people come with it (the chain's)
    const list = (await call(admin, 'GET', '')).json().data as Array<{ id: string; inUse: number }>;
    expect(list).toEqual([expect.objectContaining({ id: v2id, inUse: 1 })]);
    expect((await call(teacher, 'GET', `/${v2id}`)).statusCode).toBe(200);
    expect((await call(admin, 'POST', `/${v2id}/lock`)).json().status).toBe('locked');
    const versions = (await call(admin, 'GET', `/${v2id}/versions`)).json().data as Array<{
      version: number;
      status: string;
    }>;
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'locked'],
      [1, 'superseded'],
    ]);
    // unlock to change it in place again
    expect((await call(admin, 'POST', `/${v2id}/unlock`)).json().status).toBe('draft');
    regId = v2id;
  });

  it('the bin, restore (renamed when the name is taken), restore a version as a new register', async () => {
    expect((await call(admin, 'DELETE', `/${regId}`)).statusCode).toBe(200);
    const bin = (await call(admin, 'GET', '/deleted')).json().data as Array<{ id: string }>;
    expect(bin.map((b) => b.id)).toEqual([regId]);
    // the name is free now: another takes it
    const taker = await call(admin, 'POST', '', {
      name: 'Indicator Register Class VI',
      classIds: [ids.vi],
      def: def(),
    });
    expect(taker.statusCode).toBe(201);
    expect((await call(admin, 'POST', `/${regId}/restore`, {})).json().type).toBe(
      'exams.register_name',
    );
    const back = await call(admin, 'POST', `/${regId}/restore`, {
      name: 'Indicator Register VI (old)',
    });
    expect(back.json()).toMatchObject({ name: 'Indicator Register VI (old)' });
    const v1 = (
      (await call(admin, 'GET', `/${regId}/versions`)).json().data as Array<{
        id: string;
        version: number;
      }>
    ).find((v) => v.version === 1)!;
    const restored = await call(admin, 'POST', `/${v1.id}/restore-version`, {
      name: 'Indicator Register VI (v1)',
    });
    expect(restored.json()).toMatchObject({ version: 1, status: 'draft' });
    // with the people of the register it came from
    expect((await call(teacher, 'GET', `/${restored.json().id}`)).statusCode).toBe(200);
  });

  it('copy for another class (not the people); access type All or As per mapping (managers)', async () => {
    const copy = await call(admin, 'POST', `/${regId}/copy`, {
      name: 'Indicator Register Class VII',
      classIds: [ids.vii],
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ classIds: [ids.vii], version: 1 });
    expect((await call(teacher, 'GET', `/${copy.json().id}`)).statusCode).toBe(403);
    const typed = await call(admin, 'PUT', `/${regId}/access-type`, { type: 'mapping' });
    expect(typed.json().accessType).toBe('mapping');
    expect((await call(teacher, 'PUT', `/${regId}/access-type`, { type: 'all' })).statusCode).toBe(
      403,
    );
  });

  it('a person given Assign passes on only the rights they hold, never Assign; the Rights report', async () => {
    await call(admin, 'PUT', `/${regId}/access`, {
      rows: [{ userId: teacher.id, run: true, edit: true, delete: false, assign: true }],
    });
    const keep = { userId: teacher.id, run: true, edit: true, delete: false, assign: true };
    const ok = await call(teacher, 'PUT', `/${regId}/access`, {
      rows: [keep, { userId: other.id, run: true, edit: true, delete: false, assign: false }],
    });
    expect(ok.statusCode).toBe(200);
    for (const bad of [
      { userId: other.id, run: true, edit: false, delete: true, assign: false },
      { userId: other.id, run: true, edit: false, delete: false, assign: true },
    ])
      expect(
        (await call(teacher, 'PUT', `/${regId}/access`, { rows: [keep, bad] })).statusCode,
      ).toBe(403);
    expect((await call(teacher, 'GET', '/rights')).statusCode).toBe(403);
    const report = (await call(admin, 'GET', '/rights')).json().data as Array<{
      chainId: string;
      userId: string;
    }>;
    const mine = report.find((x) => x.userId === other.id)!;
    expect(mine).toBeDefined();
    const removed = await call(admin, 'POST', '/rights/remove', {
      pairs: [{ chainId: mine.chainId, userId: other.id }],
    });
    expect(removed.json()).toEqual({ removed: 1 });
  });

  // ---- Run (part 3) ----------------------------------------------------------------------------------
  interface Cell {
    t: string;
    tone?: string;
    span?: number;
    drill?: { rows: string[][] };
  }
  interface RunSheet {
    place: string;
    title?: string;
    head: Cell[][];
    body: Array<{ cells: Cell[] }>;
  }
  const run = async (u: SeededUser, id: string, q: string) =>
    (await call(u, 'GET', `/${id}/run?${q}`)).json() as {
      places: Array<{ value: string; label: string }>;
      areas: Array<{ key: string; name: string }>;
      items: Array<{ key: string; name: string }>;
      sheets: RunSheet[];
      notes: string[];
      mapped: boolean;
    };
  const texts = (cells: Cell[]) => cells.map((c) => c.t);
  const sec = { a: '', b: '' };
  const pupil: Record<string, string> = {};
  let runId = '';

  it('runs a section as the class sheet: the grades, blanks, and the Overall per area', async () => {
    await withMigrator(async (c) => {
      for (const [key, name] of [
        ['a', 'A'],
        ['b', 'B'],
      ] as const)
        sec[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, $4, 40) RETURNING id::text`,
            [school.id, school.yearId, ids.vi, name],
          )
        ).rows[0]!.id;
      for (const [i, [first, last, section]] of (
        [
          ['Asha', 'Reg', sec.a],
          ['BHANU', 'PRATAP', sec.a],
          ['Chitra', 'Reg', sec.b],
        ] as const
      ).entries()) {
        const st = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [school.id, `${s}-${String(i + 1)}`, first, last],
        );
        pupil[first] = st.rows[0]!.id;
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE - 30)`,
          [school.id, st.rows[0]!.id, school.yearId, section, i + 1],
        );
      }
      for (const [st, ind, g] of [
        [pupil.Asha, ids.work, 'A'],
        [pupil.Asha, ids.art, 'B'],
        [pupil.Asha, ids.listens, 'B'],
        [pupil.Asha, ids.neat, 'B'],
        [pupil.BHANU, ids.work, 'C'],
        [pupil.BHANU, ids.art, 'C'],
        [pupil.BHANU, ids.listens, 'A'],
        [pupil.Chitra, ids.work, 'A'],
      ] as const)
        await c.query(
          `INSERT INTO indicator_entries (school_id, exam_id, indicator_id, student_id, grade) VALUES ($1, $2, $3, $4, $5)`,
          [school.id, ids.t1, ind, st, g],
        );
    });
    const made = await call(admin, 'POST', '', {
      name: 'Run register VI',
      classIds: [ids.vi],
      def: def({
        overall: 'mode',
        blankText: '-',
        scale: [
          { g: 'A', p: 3 },
          { g: 'B', p: 2 },
          { g: 'C', p: 1 },
        ],
        labels: { [ids.listens]: 'Listens well' },
      }),
    });
    runId = made.json().id;
    const r = await run(admin, runId, `classSectionId=${sec.a}`);
    expect(r.places.map((p) => p.label)).toEqual(['VI-A', 'VI-B']);
    expect(r.areas.map((a) => a.name)).toEqual(['Discipline', 'Co-scholastic']);
    const [sheet] = r.sheets;
    expect(texts(sheet!.head[1]!)).toEqual([
      'Conduct',
      'Overall',
      'Work education',
      'Art education',
      'Overall',
    ]);
    expect(texts(sheet!.head[2]!)).toEqual(['Listens well', 'Neat work']);
    // Asha: B B | B | A B | A (a tie: the better grade); Bhanu (proper case): A - | A | C C | C
    expect(texts(sheet!.body[0]!.cells).slice(3)).toEqual([
      'Asha Reg',
      'B',
      'B',
      'B',
      'A',
      'B',
      'A',
    ]);
    expect(texts(sheet!.body[1]!.cells).slice(3)).toEqual([
      'Bhanu Pratap',
      'A',
      '-',
      'A',
      'C',
      'C',
      'C',
    ]);
    expect(sheet!.body[1]!.cells[9]).toMatchObject({ t: 'C', tone: 'calc' });
  });

  it('student-wise, the filters, the Grade summary and the Analysis (a section, every section)', async () => {
    const sw = await run(admin, runId, `classSectionId=${sec.a}&layout=student`);
    expect(sw.sheets.map((x) => x.title)).toEqual([
      `1. Asha Reg · Adm ${s}-1 · Roll 1`,
      `2. Bhanu Pratap · Adm ${s}-2 · Roll 2`,
    ]);
    expect(texts(sw.sheets[0]!.body[0]!.cells)).toEqual([
      'Discipline',
      'Conduct',
      'Listens well',
      'B',
    ]);
    expect(sw.sheets[0]!.body[2]!.cells[1]).toMatchObject({ t: 'Overall — Discipline', span: 2 });
    // filters: one area, one item
    const area = await run(admin, runId, `classSectionId=${sec.a}&areas=co-scholastic`);
    expect(texts(area.sheets[0]!.head[0]!).slice(4)).toEqual(['Co-scholastic']);
    const item = await run(admin, runId, `classSectionId=${sec.a}&items=${ids.work}`);
    expect(texts(item.sheets[0]!.head[1]!)).toEqual(['Work education', 'Overall']);
    // the summary: Work education A 1 (Asha), C 1 (Bhanu); a count opens its students
    const sum = (await run(admin, runId, `classSectionId=${sec.a}&report=summary`)).sheets[0]!;
    expect(texts(sum.head[0]!)).toEqual([
      'Area',
      'Indicator',
      'Description',
      'A',
      'B',
      'C',
      'Blank',
      'Students',
    ]);
    const work = sum.body.find((x) => x.cells[1]!.t === 'Work education')!;
    expect(texts(work.cells).slice(3)).toEqual(['1', '0', '1', '0', '2']);
    expect(work.cells[3]!.drill!.rows).toEqual([['1', 'Asha Reg', `${s}-1`, '1']]);
    const an = (await run(admin, runId, `classSectionId=${sec.a}&report=analysis`)).sheets[0]!;
    // Discipline: B 2, A 1 of 3 given, 1 blank
    expect(texts(an.body[0]!.cells)).toEqual([
      'Discipline',
      '33.3% (1)',
      '66.7% (2)',
      '—',
      '3',
      '1',
    ]);
    const all = (await run(admin, runId, 'report=analysis-all')).sheets[0]!;
    expect(texts(all.head[0]!)).toEqual(['Area', 'VI-A', 'VI-B']);
    expect(all.body.find((x) => x.cells[0]!.t === 'Co-scholastic')!.cells[2]!.t).toBe(
      'A 100.0% (1)',
    );
  });

  it('downloads the sheet (a section or all), student-wise a page each, as PDF or Excel', async () => {
    for (const [q, name] of [
      [`classSectionId=${sec.a}&format=pdf`, 'grade-register-run-register-vi-vi-a.pdf'],
      [`classSectionId=${sec.a}&format=xlsx&all=1`, 'grade-register-run-register-vi-all.xlsx'],
      [
        `classSectionId=${sec.a}&format=pdf&layout=student`,
        'grade-register-run-register-vi-vi-a-student-wise.pdf',
      ],
      ['report=analysis-all&format=pdf', 'grade-register-run-register-vi-all-analysis-all.pdf'],
    ] as const) {
      const f = await call(admin, 'GET', `/${runId}/run?${q}`);
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toBe(name);
      expect(Buffer.from(f.json().base64 as string, 'base64').length).toBeGreaterThan(500);
    }
  });

  it('as per mapping: a teacher sees the areas of their Indicator assignment of the section', async () => {
    await call(admin, 'PUT', `/${runId}/access`, {
      rows: [{ userId: other.id, run: true, edit: false, delete: false, assign: false }],
    });
    await call(admin, 'PUT', `/${runId}/access-type`, { type: 'mapping' });
    // no Indicator assignment: nothing, and why
    const none = await run(other, runId, `classSectionId=${sec.a}`);
    expect(none.mapped).toBe(true);
    expect(none.areas).toEqual([]);
    expect(none.notes.join(' ')).toContain('no Indicator assignment of this section is yours');
    // an Indicator assignment of VI-A for Discipline
    const discipline = await withMigrator(async (c) => {
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'GR-IND', 'Ira', 'Indicator', $2) RETURNING id::text`,
        [school.id, other.id],
      );
      const ta = await c.query<{ id: string }>(
        `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, kind) VALUES ($1, $2, $3, $4, 'indicator') RETURNING id::text`,
        [school.id, school.yearId, e.rows[0]!.id, sec.a],
      );
      const ar = await c.query<{ id: string }>(
        `SELECT id::text FROM indicator_areas WHERE school_id = $1 AND name = 'Discipline'`,
        [school.id],
      );
      return { assignment: ta.rows[0]!.id, area: ar.rows[0]!.id };
    });
    // no area named: every area
    expect((await run(other, runId, `classSectionId=${sec.a}`)).areas.map((a) => a.name)).toEqual([
      'Discipline',
      'Co-scholastic',
    ]);
    const set = await inject({
      method: 'PUT',
      url: `/academics/teacher-assignments/${discipline.assignment}/areas`,
      headers: headersFor(admin.sub, school.id),
      json: { areaIds: [discipline.area] },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().indicatorAreas).toEqual([{ id: discipline.area, name: 'Discipline' }]);
    const only = await run(other, runId, `classSectionId=${sec.a}`);
    expect(only.areas.map((a) => a.name)).toEqual(['Discipline']);
    expect(texts(only.sheets[0]!.head[0]!).slice(4)).toEqual(['Discipline']);
    // another section: no assignment there
    expect((await run(other, runId, `classSectionId=${sec.b}`)).areas).toEqual([]);
    // the manager sees every area
    expect((await run(admin, runId, `classSectionId=${sec.a}`)).areas).toHaveLength(2);
  });
});
