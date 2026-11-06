/**
 * Holding report cards in bulk (docs/design/75): many students with one reason (also in another published
 * card), by admission number or by Excel with a check before saving; the held list by class, section or
 * words, as Excel or PDF; showing a card again on a published class tells the family. Scope: a class
 * teacher sees their section's holds only and cannot hold; a pupil outside the card's classes is refused.
 */
import ExcelJS from 'exceljs';
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

describe('report card holds in bulk (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let ct: SeededUser;
  let parent: SeededUser;
  const s = stamp('RH');
  const sec: Record<string, string> = {};
  const student: Record<string, string> = {};
  const no = (name: string) => `${s}-${name}`;
  let term = '';
  let pt = '';
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    json?: unknown,
  ) => inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const base = (id: string) => `/exams/report-cards/releases/${id}`;
  const told = () =>
    withMigrator(async (c) => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'result_published'`,
        [school.id],
      );
      return r.rows[0]!.n;
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const klass = async (code: string, order: number) =>
      (
        await call(admin, 'POST', '/academics/classes', {
          code,
          name: `Class ${code}`,
          displayOrder: order,
        })
      ).json().id as string;
    const xi = await klass('XI', 11);
    const xii = await klass('XII', 12);
    for (const [key, cls, name] of [
      ['XI-A', xi, 'A'],
      ['XI-B', xi, 'B'],
      ['XII-A', xii, 'A'],
    ] as const)
      sec[key] = (await call(admin, 'POST', `/academics/classes/${cls}/sections`, { name })).json()
        .id as string;
    for (const [first, place, roll] of [
      ['Asha', 'XI-A', 1],
      ['Bhanu', 'XI-A', 2],
      ['Chitra', 'XI-A', 3],
      ['Dev', 'XI-B', 1],
      ['Esha', 'XII-A', 1],
    ] as const) {
      const r = await call(admin, 'POST', '/people/students', {
        admissionNo: no(first),
        firstName: first,
        lastName: 'Hold',
        guardians: [],
        enrolment: { classSectionId: sec[place], rollNo: roll },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id as string;
    }
    // Asha's mother takes the messages; the class teacher of XI-A
    await withMigrator(async (c) => {
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, email, user_id)
         VALUES ($1, 'Mira', 'Hold', $2, $3) RETURNING id::text`,
        [school.id, `${s.toLowerCase()}-mira@example.com`, parent.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'mother', true)`,
        [school.id, student.Asha, g.rows[0]!.id],
      );
      ct = await seedUser(c, school, `${s}-ct`, 'class_teacher');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Class', 'Teacher', $3) RETURNING id::text`,
        [school.id, `${s}-CT`, ct.id],
      );
      await c.query(
        `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, kind)
         VALUES ($1, $2, $3, $4, 'class_teacher')`,
        [school.id, school.yearId, e.rows[0]!.id, sec['XI-A']],
      );
    });
    // a term card and a test card for XI, both published
    const publish = async (code: string, kind: 'term' | 'exam') => {
      const type = await call(admin, 'POST', '/exams/types', { code, name: code });
      const exam = await call(admin, 'POST', '/exams', {
        examTypeId: type.json().id,
        code: `${code}-26`,
        name: code,
        classes: [{ classId: xi }],
      });
      expect(exam.statusCode).toBe(201);
      const rel = await call(admin, 'POST', '/exams/report-cards/releases', {
        kind,
        termCode: code,
        name: code === 'T1' ? 'Term 1' : 'Periodic Test 1',
        examIds: [exam.json().id],
      });
      expect(rel.statusCode).toBe(201);
      const id = rel.json().id as string;
      expect((await call(admin, 'PATCH', base(id), { status: 'submitted' })).statusCode).toBe(200);
      expect((await call(admin, 'PATCH', base(id), { status: 'released' })).statusCode).toBe(200);
      return id;
    };
    term = await publish('T1', 'term');
    pt = await publish('PT1', 'exam');
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it('holds many cards with one reason, also in another published card; refuses what does not fit', async () => {
    const url = `${base(term)}/holds/bulk`;
    // a reason is needed, and only who manages report cards holds them
    expect(
      (await call(admin, 'POST', url, { admissionNos: [no('Asha')], held: true })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(ct, 'POST', url, {
          admissionNos: [no('Asha')],
          held: true,
          reason: 'Library books',
        })
      ).statusCode,
    ).toBe(403);
    const r = await call(admin, 'POST', url, {
      admissionNos: [no('Asha'), no('Bhanu'), no('Dev'), no('Esha'), `${s}-NOPE`],
      held: true,
      reason: 'Library books not returned',
      alsoReleaseIds: [pt],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ held: 3, alsoHeld: 3, lifted: 0, unchanged: [] });
    expect(
      (r.json().refused as Array<{ key: string; error: string }>).map((x) => [x.key, x.error]),
    ).toEqual(
      expect.arrayContaining([
        [`${s}-NOPE`, `No pupil with admission no ${s}-NOPE`],
        [no('Esha'), "XII-A is not one of this card's classes"],
      ]),
    );
    // asked again: left as it is, with its reason
    const again = await call(admin, 'POST', url, {
      studentIds: [student.Asha],
      held: true,
      reason: 'Another reason',
    });
    expect(again.json()).toMatchObject({
      held: 0,
      unchanged: [
        expect.objectContaining({ name: 'Asha Hold', reason: 'Library books not returned' }),
      ],
    });
    // only this year's published cards take the hold too
    expect(
      (
        await call(admin, 'POST', url, {
          studentIds: [student.Chitra],
          held: true,
          reason: 'Documents pending',
          alsoReleaseIds: ['999999999'],
        })
      ).statusCode,
    ).toBe(400);
    // the family sees the card held (no reason), in both cards
    const mine = (await call(parent, 'GET', '/exams/mine/results')).json() as {
      children: Array<{ terms: Array<{ releaseId: string; held: boolean }> }>;
    };
    const terms = mine.children[0]!.terms;
    expect(terms.find((x) => x.releaseId === term)).toMatchObject({ held: true });
    expect(terms.find((x) => x.releaseId === pt)).toMatchObject({ held: true });
  });

  it('lists the held cards by class, section and words; a class teacher sees their section only', async () => {
    const list = async (u: SeededUser, q = '') => call(u, 'GET', `${base(term)}/holds${q}`);
    const names = (r: Awaited<ReturnType<typeof list>>) =>
      (r.json().data as Array<{ name: string }>).map((x) => x.name);
    const all = await list(admin);
    expect(all.statusCode).toBe(200);
    expect(names(all)).toEqual(['Asha Hold', 'Bhanu Hold', 'Dev Hold']);
    expect(all.json().feeWithheld).toBeNull();
    expect(all.json().data[0]).toMatchObject({
      admissionNo: no('Asha'),
      section: 'XI-A',
      reason: 'Library books not returned',
      heldBy: expect.any(String),
    });
    expect(names(await list(admin, `?classSectionId=${sec['XI-B']}`))).toEqual(['Dev Hold']);
    expect(names(await list(admin, '?q=bhanu'))).toEqual(['Bhanu Hold']);
    expect(names(await list(admin, '?q=library'))).toHaveLength(3);
    expect(names(await list(ct))).toEqual(['Asha Hold', 'Bhanu Hold']);
    expect((await list(ct, `?classSectionId=${sec['XI-B']}`)).statusCode).toBe(403);
    // the list as Excel and PDF
    const x = await call(admin, 'GET', `${base(term)}/holds/file?format=xlsx`);
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    const cells = wb.worksheets[0]!.getSheetValues().flat().map(String);
    expect(cells).toEqual(expect.arrayContaining(['Bhanu Hold', 'Library books not returned']));
    const pdf = await call(admin, 'GET', `${base(term)}/holds/file?format=pdf`);
    expect(pdf.json()).toMatchObject({ contentType: 'application/pdf' });
    expect(
      Buffer.from(pdf.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('showing a card again on a published class tells the family; one without a guardian sends nothing', async () => {
    const before = await told();
    const r = await call(admin, 'POST', `${base(term)}/holds/bulk`, {
      studentIds: [student.Asha, student.Bhanu, student.Chitra],
      held: false,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      lifted: 2,
      notified: 1,
      unchanged: [expect.objectContaining({ name: 'Chitra Hold' })],
    });
    expect(await told()).toBe(before + 1);
    // the card opens for the family; the test card stays held
    const terms = (
      (await call(parent, 'GET', '/exams/mine/results')).json() as {
        children: Array<{ terms: Array<{ releaseId: string; held: boolean }> }>;
      }
    ).children[0]!.terms;
    expect(terms.find((x) => x.releaseId === term)).toMatchObject({ held: false });
    expect(terms.find((x) => x.releaseId === pt)).toMatchObject({ held: true });
    // the preview panel's single Show again tells the family too
    expect(
      (await call(admin, 'PUT', `${base(pt)}/holds`, { studentId: student.Asha, held: false }))
        .statusCode,
    ).toBe(200);
    expect(await told()).toBe(before + 2);
    // docs/design/81: the message names the exam ("PT1"), not the release ("Periodic Test 1"), and the
    // class; {{term}} stays the release's name for a school's own wording
    const last = await withMigrator(
      async (c) =>
        (
          await c.query<{ subject: string; body: string }>(
            `SELECT m.subject, m.body FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
              WHERE m.school_id = $1 AND t.code = 'result_published' ORDER BY m.id DESC LIMIT 1`,
            [school.id],
          )
        ).rows[0]!,
    );
    expect(last.subject).toBe('PT1 report card of Asha Hold is published');
    expect(last.body).toContain('the PT1 report card of <strong>Asha Hold</strong> (class XI-A)');
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_templates SET format = 'text', subject = 'Result: {{term}}', body = '{{term}} card of {{name}}, {{class}}'
          WHERE school_id = $1 AND code = 'result_published' AND channel = 'email'`,
        [school.id],
      ),
    );
    const own = (await call(admin, 'GET', `${base(pt)}/parent-message`)).json() as {
      channels: Array<{ channel: string; subject: string; body: string; format: string }>;
    };
    expect(own.channels[0]).toMatchObject({
      channel: 'email',
      format: 'text',
      subject: 'Result: Periodic Test 1',
      body: expect.stringMatching(/^Periodic Test 1 card of .+, XI-[AB]$/),
    });
  });

  it('holds from an Excel: every row checked first, then the good rows held', async () => {
    const t = await call(admin, 'GET', `${base(term)}/holds/template`);
    expect(t.statusCode).toBe(200);
    expect(t.json().filename).toBe('hold-report-cards-t1.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(t.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getRow(1).getCell(1).value)).toBe('Admission no *');
    for (const [k, row] of [
      [no('Chitra'), 'Chitra', 'Documents pending'],
      [no('Asha'), 'Asha', ''],
      [no('Dev'), 'Dev', 'Fee dues'],
      [no('Esha'), 'Esha', 'Fee dues'],
      [no('Chitra'), 'Chitra', 'Twice'],
      ['', 'Nobody', 'No number'],
    ].entries())
      ws.getRow(k + 2).values = row;
    const file = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const url = `${base(term)}/holds/upload`;
    // Asha's row has no reason and none is typed on the screen
    const bare = await call(admin, 'POST', url, { file });
    expect(bare.json()).toMatchObject({ ready: 1, errors: 5, applied: false });
    const check = await call(admin, 'POST', url, { file, reason: 'Meet the principal' });
    expect(check.statusCode).toBe(201);
    expect(check.json()).toMatchObject({ ready: 2, errors: 4, applied: false });
    expect(
      (check.json().rows as Array<{ row: number; error: string | null }>).map((x) => x.error),
    ).toEqual([
      null,
      null,
      'Held already: Library books not returned',
      "XII-A is not one of this card's classes",
      'In the sheet twice',
      'No admission no',
    ]);
    // nothing saved by the check
    expect(
      ((await call(admin, 'GET', `${base(term)}/holds`)).json().data as unknown[]).length,
    ).toBe(1);
    const saved = await call(admin, 'POST', url, {
      file,
      reason: 'Meet the principal',
      apply: true,
    });
    expect(saved.json()).toMatchObject({ ready: 2, applied: true });
    const held = (await call(admin, 'GET', `${base(term)}/holds`)).json().data as Array<{
      name: string;
      reason: string;
    }>;
    expect(held.map((x) => [x.name, x.reason])).toEqual([
      ['Asha Hold', 'Meet the principal'],
      ['Chitra Hold', 'Documents pending'],
      ['Dev Hold', 'Library books not returned'],
    ]);
    // the class teacher may not upload
    expect((await call(ct, 'POST', url, { file })).statusCode).toBe(403);
  });
});
