/**
 * A register's subjects have a paper of their own in its exams (docs/design/72): Geography and History
 * are on Class VI's subject list but marked as parts of Social Science, so the builder data says whose
 * part each is, a register with them is refused with the cause (and so is locking one), and a copy for
 * another class leaves out a subject that class has on its list but no paper of.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultCodes, newRegisterDef, type RegisterDef, type RegSubject } from '@edupro/db';
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

describe('register subjects need a paper of their own (docs/design/72, e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const cls: Record<string, string> = {};
  const subject: Record<string, string> = {};
  let exam = '';
  const s = stamp('RSP');
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(admin.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });

  const plain = (code: string): RegSubject => ({
    key: code,
    subjectId: subject[code],
    columns: [{ key: 'P', name: 'PT1', kind: 'raw', exam: 'PT1', inTotal: true }],
    showTotal: true,
  });
  const def = (codes: string[]): RegisterDef => ({
    ...newRegisterDef(),
    exams: [{ key: 'PT1', examId: exam }],
    codes: { PT1: defaultCodes() },
    subjects: codes.map(plain),
  });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    for (const [code, order] of [
      ['VI', 6],
      ['VII', 7],
    ] as const)
      cls[code] = (
        await call('POST', '/academics/classes', {
          code,
          name: `Class ${code}`,
          displayOrder: order,
        })
      ).json().id;
    for (const [code, name, parent] of [
      ['ENG', 'English', null],
      ['SST', 'Social Science', null],
      ['GEO', 'Geography', 'SST'],
      ['HIST', 'History', 'SST'],
    ] as const) {
      const r = await call('POST', '/academics/subjects', {
        code,
        name,
        kind: 'scholastic',
        ...(parent ? { parentId: subject[parent] } : {}),
      });
      expect(r.statusCode).toBe(201);
      subject[code] = r.json().id;
    }
    // the classes' subject lists: VI has Geography and History beside Social Science; VII Social Science
    for (const [k, codes] of [
      ['VI', ['ENG', 'SST', 'GEO', 'HIST']],
      ['VII', ['ENG', 'SST']],
    ] as const) {
      const r = await call('PUT', `/academics/classes/${cls[k]!}/subjects`, {
        subjects: codes.map((code) => ({ subjectId: subject[code] })),
      });
      expect(r.statusCode).toBe(200);
    }
    const type = (await call('POST', '/exams/types', { code: 'PT', name: 'Tests' })).json().id;
    exam = (
      await call('POST', '/exams', {
        examTypeId: type,
        code: 'PT1',
        name: 'Periodic Test 1',
        classes: [{ classId: cls.VI }, { classId: cls.VII }],
      })
    ).json().id;
    const vi = await call('PUT', `/exams/${exam}/subjects`, {
      classId: cls.VI,
      subjects: [
        { subjectId: subject.ENG, maxMarks: 40 },
        { subjectId: subject.SST, maxMarks: 40 },
      ],
    });
    const sst = (vi.json().subjects as Array<{ id: string; subjectId: string }>).find(
      (x) => x.subjectId === subject.SST,
    )!;
    expect(
      (
        await call('PUT', `/exams/${exam}/subjects/${sst.id}/parts`, {
          parts: [
            { name: 'Geography', subjectId: subject.GEO, maxMarks: 20 },
            { name: 'History', subjectId: subject.HIST, maxMarks: 20 },
          ],
        })
      ).statusCode,
    ).toBe(200);
    // VII: English only in PT1 (Social Science is on its list, with no paper)
    await call('PUT', `/exams/${exam}/subjects`, {
      classId: cls.VII,
      subjects: [{ subjectId: subject.ENG, maxMarks: 40 }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('the builder data says whose part a sub-subject is', async () => {
    const b = (await call('GET', `/exams/schemes/builder?classIds=${cls.VI!}`)).json();
    const sst = b.subjects.find((x: { code: string }) => x.code === 'SST');
    expect(
      sst.papers[0].parts.map((p: { name: string; subjectId: string }) => [p.name, p.subjectId]),
    ).toEqual([
      ['Geography', subject.GEO],
      ['History', subject.HIST],
    ]);
    const geo = b.subjects.find((x: { code: string }) => x.code === 'GEO');
    expect(geo.papers).toEqual([]);
  });

  it('refuses a register with a subject marked only inside another, saves and locks one without', async () => {
    const bad = await call('POST', '/exams/schemes', {
      name: 'VI Register',
      purpose: 'register',
      classIds: [cls.VI],
      def: def(['ENG', 'GEO', 'HIST']),
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().type).toBe('exams.register_subject_no_paper');
    expect(bad.json().detail).toBe(
      "Geography and History have no paper of their own in this register's exams: they are marked inside Social Science. Take them out of the register (step 2, Subjects).",
    );
    expect(bad.json().subjects.map((x: { key: string }) => x.key)).toEqual(['GEO', 'HIST']);

    const ok = await call('POST', '/exams/schemes', {
      name: 'VI Register',
      purpose: 'register',
      classIds: [cls.VI],
      def: def(['ENG', 'SST']),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'draft', problems: [] });
    const lock = await call('POST', `/exams/schemes/${ok.json().id as string}/lock`);
    expect(lock.json().status).toBe('locked');

    // a copy for VII leaves out Social Science: on VII's list, no paper in PT1
    const copy = await call('POST', `/exams/schemes/${ok.json().id as string}/copy`, {
      name: 'VII Register',
      classIds: [cls.VII],
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json().dropped).toEqual(['Social Science']);
    expect(copy.json().def.subjects.map((x: { key: string }) => x.key)).toEqual(['ENG']);
  });
});
