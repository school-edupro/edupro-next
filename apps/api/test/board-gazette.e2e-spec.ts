/**
 * CBSE board result analysis, phase A (docs/design/88): the result gazette (.TXT) read with a built-in or kept
 * layout, or one Claude learns from masked lines; checks, preview, confirm, replace; layouts kept and switched off.
 * Claude is replaced by a scripted stand-in that records every request (so the test proves no student data is sent).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { StructuredProvider, StructuredRequest } from '@edupro/ai';
import { BoardLayoutAi } from '../src/modules/exams/board-layout-ai';
import {
  gazetteNewX,
  gazetteX,
  gazetteXII,
  NEW_X_LAYOUT,
  sampleX,
  WRONG_X_LAYOUT,
} from './board-gazette-fixture';
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

describe('CBSE board result gazette (e2e, docs/design/88 phase A)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let auditor: SeededUser;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const rolls = ['27100001', '27100002', '27100003', '27100004', '27100005', '27100006'];
  const names = ['ASHA GAZETTE', 'RAVI GAZETTE', 'MEERA GAZETTE'];
  const students: string[] = [];

  // the scripted stand-in for Claude
  const requests: StructuredRequest[] = [];
  let answers: unknown[] = [];
  let aiOn = true;
  const fake: StructuredProvider = {
    name: 'claude',
    model: 'claude-opus-5-5',
    structured: (req) => {
      requests.push(req);
      const a = answers.shift();
      return Promise.resolve({
        json: a === 'refuse' ? null : (a ?? null),
        refused: a === 'refuse',
        stopReason: a === 'refuse' ? 'refusal' : 'end_turn',
        usage: { inputTokens: 1500, outputTokens: 400 },
        model: 'claude-opus-5-5',
        provider: 'claude',
        latencyMs: 5,
      });
    },
  };

  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const upload = (text: string, classLabel = 'X', fileName = 'gazette.txt') =>
    post('/exams/board-results/gazette', {
      classLabel,
      academicYearId: school.yearId,
      fileName,
      text,
    });
  const count = async (table: 'board_candidates' | 'board_results') =>
    withMigrator(async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${table} WHERE school_id = $1`,
            [school.id],
          )
        ).rows[0]!.n,
      ),
    );

  beforeAll(async () => {
    const s = stamp('BGZ');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
    });
    app = await createApp();
    inject = injector(app);
    jest
      .spyOn(app.get(BoardLayoutAi, { strict: false }), 'provider')
      .mockImplementation(() => (aiOn ? fake : null));
    const cls = await post('/academics/classes', { code: 'X', name: 'Class X', displayOrder: 10 });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' });
    for (const [k, full] of names.entries()) {
      const [first, last] = full.split(' ');
      const st = await post('/people/students', {
        admissionNo: `${s}-${String(k)}`,
        firstName: first,
        lastName: last,
        dob: '2011-04-04',
        gender: k === 1 ? 'male' : 'female',
        guardians: [],
        enrolment: { classSectionId: sec.json().id, rollNo: k + 1 },
      });
      expect(st.statusCode).toBe(201);
      students.push(st.json().id as string);
    }
    // the first two carry their board roll numbers; the third is found by name
    await withMigrator(async (c) => {
      await c.query(`UPDATE enrolments SET board_roll_no = $2 WHERE student_id = $1`, [
        students[0],
        rolls[0],
      ]);
      await c.query(`UPDATE enrolments SET board_roll_no = $2 WHERE student_id = $1`, [
        students[1],
        rolls[1],
      ]);
    });
  });
  afterAll(async () => {
    await app.close();
  });

  let first = '';
  it('reads a Class X gazette with the built-in layout: a preview with figures and matches; saved only on confirm', async () => {
    const text = gazetteX(sampleX(rolls, names));
    const u = await upload(text);
    expect(u.statusCode).toBe(201);
    first = u.json().id as string;
    expect(u.json()).toMatchObject({
      kind: 'gazette',
      status: 'validated',
      classLabel: 'X',
      examYear: 2027,
      layoutHow: 'fingerprint',
      figures: {
        candidates: 6,
        appeared: 6,
        results: { PASS: 6 },
        matched: { roll: 2, name: 1, none: 3 },
        problems: { errors: 0 },
      },
    });
    expect((u.json().figures.subjects as Array<{ code: string }>).map((x) => x.code)).toEqual([
      '041',
      '085',
      '086',
      '087',
      '184',
      '402',
    ]);
    expect(requests).toHaveLength(0);
    expect(await count('board_candidates')).toBe(0);
    const d = await get(`/exams/board-results/imports/${first}`);
    expect(d.json()).toMatchObject({
      layout: { key: 'builtin:cbse-x-2026', source: 'built-in' },
      replaces: null,
      academicYear: 'Session 2026-27',
    });
    expect(d.json().candidates[2]).toMatchObject({
      roll: rolls[2],
      studentId: students[2],
      match: 'name',
    });
    expect((await get(`/exams/board-results/imports/${first}/file`)).json()).toEqual({
      fileName: 'gazette.txt',
      text,
    });
    const ok = await post(`/exams/board-results/imports/${first}/commit`, {});
    expect(ok.json()).toMatchObject({ status: 'committed' });
    expect(await count('board_candidates')).toBe(6);
    expect(await count('board_results')).toBe(31);
    const saved = await withMigrator((c) =>
      c.query<{ total: string; percent: string; student_id: string | null; match: string }>(
        `SELECT total::text, percent::text, student_id::text, match FROM board_candidates WHERE school_id = $1 AND roll_no = $2`,
        [school.id, rolls[4]],
      ),
    );
    // the fifth: five subjects with marks (absent in the sixth): 74+84+68+86+79
    expect(saved.rows[0]).toMatchObject({
      total: '391.00',
      percent: '78.20',
      student_id: null,
      match: 'none',
    });
    const list = await get('/exams/board-results?classLabel=X');
    expect(list.statusCode).toBe(200);
    // the auditor sees it; uploading needs the import right
    expect((await get(`/exams/board-results/imports/${first}`, auditor)).statusCode).toBe(200);
    expect(
      (
        await post(
          '/exams/board-results/gazette',
          { classLabel: 'X', academicYearId: school.yearId, text: gazetteX(sampleX(rolls, names)) },
          auditor,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('a second file of the same class and year replaces the first on confirm', async () => {
    const cands = sampleX(rolls, names);
    cands[0]!.subjects[0] = ['184', '99', 'A1'];
    const u = await upload(gazetteX(cands), 'X', 'gazette-corrected.txt');
    const d = await get(`/exams/board-results/imports/${u.json().id as string}`);
    expect(d.json().replaces).toMatchObject({ id: first, fileName: 'gazette.txt' });
    await post(`/exams/board-results/imports/${u.json().id as string}/commit`, {});
    const earlier = await get(`/exams/board-results/imports/${first}`);
    expect(earlier.json().replacedAt).not.toBeNull();
    expect(earlier.json().replacedBy).toBe(u.json().id);
    expect(await count('board_candidates')).toBe(6);
    const marks = await withMigrator((c) =>
      c.query<{ total: string }>(
        `SELECT total::text FROM board_results WHERE school_id = $1 AND roll_no = $2 AND subject_code = '184'`,
        [school.id, rolls[0]],
      ),
    );
    expect(marks.rows.map((r) => r.total)).toEqual(['99.00']);
  });

  let learned = '';
  it('a new layout: Claude learns it from masked lines only; kept on confirm, so the next such file needs no AI', async () => {
    answers = [NEW_X_LAYOUT];
    const text = gazetteNewX(sampleX(rolls, names));
    const u = await upload(text, 'X', 'gazette-2027.txt');
    expect(u.statusCode).toBe(201);
    expect(u.json()).toMatchObject({
      status: 'validated',
      layoutHow: 'claude',
      figures: { candidates: 6, layout: { model: 'claude-opus-5-5' } },
    });
    expect(requests).toHaveLength(1);
    const sent = `${requests[0]!.system}\n${requests[0]!.prompt}`;
    for (const secret of [
      ...names.map((n) => n.split(' ')[0]!),
      ...rolls,
      'SAMPLE PUBLIC',
      '071 B1',
    ])
      expect(sent).not.toContain(secret);
    expect(sent).toContain('SUBJECT CODE / MARKS / GRADE');
    expect(requests[0]!.schema).toMatchObject({ type: 'object', additionalProperties: false });
    const audit = await withMigrator((c) =>
      c.query<{ kind: string; input_tokens: number; redactions: number }>(
        `SELECT kind, input_tokens, redactions FROM ai_audit WHERE school_id = $1 ORDER BY id`,
        [school.id],
      ),
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({ kind: 'board_layout', input_tokens: 1500 }),
    ]);
    expect(audit.rows[0]!.redactions).toBeGreaterThan(0);
    // not kept until the file is saved
    const before = (await get('/exams/board-results/layouts')).json().data as Array<{
      source: string;
    }>;
    expect(before.filter((l) => l.source === 'claude')).toHaveLength(0);
    await post(`/exams/board-results/imports/${u.json().id as string}/commit`, {});
    const after = (await get('/exams/board-results/layouts')).json().data as Array<{
      key: string;
      source: string;
      active: boolean;
      model: string;
      learnedFrom: { fileName: string };
    }>;
    expect(after.map((l) => l.source)).toEqual(['built-in', 'built-in', 'claude']);
    expect(after[2]).toMatchObject({
      active: true,
      model: 'claude-opus-5-5',
      learnedFrom: { fileName: 'gazette-2027.txt' },
    });
    learned = after[2]!.key.slice(3);
    // the same layout again: read by its fingerprint, no AI call
    const again = await upload(text, 'X', 'gazette-2027-again.txt');
    expect(again.json()).toMatchObject({ status: 'validated', layoutHow: 'fingerprint' });
    expect(requests).toHaveLength(1);
    // switched off: the next such file is learned again
    const off = await post(`/exams/board-results/layouts/${learned}/active`, { active: false });
    expect(off.json()).toMatchObject({ active: false });
    answers = [NEW_X_LAYOUT];
    expect((await upload(text)).json()).toMatchObject({ layoutHow: 'claude' });
    expect(requests).toHaveLength(2);
  });

  it('a wrong layout fails its checks; asking again tells Claude what failed; no AI, a refusal or a bad reply stop clearly', async () => {
    answers = [WRONG_X_LAYOUT, NEW_X_LAYOUT];
    const text = gazetteNewX(sampleX(rolls, names));
    const u = await upload(text);
    expect(u.json()).toMatchObject({ status: 'failed', layoutHow: 'claude' });
    expect(u.json().figures.problems.errors).toBeGreaterThan(0);
    expect(
      (await post(`/exams/board-results/imports/${u.json().id as string}/commit`, {})).statusCode,
    ).toBe(409);
    const again = await post(`/exams/board-results/imports/${u.json().id as string}/relearn`, {});
    expect(again.json()).toMatchObject({ status: 'validated', figures: { candidates: 6 } });
    expect(requests.at(-1)!.prompt).toContain('failed on the full file');
    for (const r of rolls) expect(requests.at(-1)!.prompt).not.toContain(r);
    // no AI set up
    aiOn = false;
    const none = await upload(text);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toMatchObject({ type: 'board.ai_not_set_up' });
    aiOn = true;
    // a refusal, and a reply that is not a layout
    answers = ['refuse'];
    expect((await upload(text)).json()).toMatchObject({ type: 'board.ai_no_layout' });
    answers = [{ hello: 'world' }];
    expect((await upload(text)).json()).toMatchObject({ type: 'board.ai_bad_layout' });
  });

  it('reads Class XII with its own built-in layout; refuses a file that is not a gazette', async () => {
    const xii = await upload(
      gazetteXII([
        {
          roll: '27200001',
          sex: 'F',
          name: 'TARA GAZETTE',
          subjects: [
            ['301', '91', 'A1'],
            ['027', '84', 'A2'],
            ['028', '88', 'A2'],
            ['029', '79', 'B1'],
            ['037', '93', 'A1'],
          ],
          internal: ['A1', 'A1', 'A1'],
          result: 'PASS',
        },
      ]),
      'XII',
    );
    expect(xii.json()).toMatchObject({
      status: 'validated',
      classLabel: 'XII',
      layoutHow: 'fingerprint',
      figures: { candidates: 1, matched: { none: 1 } },
    });
    const bad = await upload('ROLL NO,NAME,MARKS\nx,y,1\nnothing here at all');
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ type: 'board.not_a_gazette' });
  });
});
