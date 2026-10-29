/**
 * The Holistic Progress Card and three-level indicators (docs/design/65, part 5): the NCERT
 * foundational-stage set added once, a three-level set's rules, levels and written observations per
 * child (a heading is not entered), the child's / parent's / teacher's words, portfolio photos, the
 * parent writing in the parent app (kept as theirs), the indicators lock, and the HPC card printing
 * the levels with their words, the feedback and the photos.
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

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface Item {
  id: string;
  code: string;
  name: string;
  area: string | null;
  sortOrder: number;
  parentCode: string | null;
  kind: string;
  description: string | null;
  descriptors: Record<string, string>;
}

describe('the holistic progress card (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let parent: SeededUser;
  let classId: string;
  let section: string;
  let examId: string;
  let setId: string;
  const student: Record<string, string> = {};
  const item: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const s = stamp('HPC');
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'BV3',
        name: 'Balvatika 3',
        displayOrder: 0,
      })
    ).json().id;
    section = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'A' })
    ).json().id;
    for (const [i, first] of ['Anu', 'Bela'].entries())
      student[first] = (
        await call(admin, 'POST', '/people/students', {
          admissionNo: `${s}-${String(i + 1)}`,
          firstName: first,
          lastName: 'Hpc',
          guardians:
            i === 0
              ? [
                  {
                    guardian: { firstName: 'Mala', lastName: 'Hpc', mobile: '9876512399' },
                    relation: 'mother',
                    isPrimary: true,
                  },
                ]
              : [],
          enrolment: { classSectionId: section, rollNo: i + 1 },
        })
      ).json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876512399' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
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
    if (app) await app.close();
  });

  it('adds the NCERT foundational set once: domains, goals and competencies with three levels', async () => {
    const r = await call(admin, 'POST', '/exams/indicator-sets/hpc');
    expect(r.statusCode).toBe(201);
    expect(r.json().installed).toBe(true);
    setId = r.json().id;
    expect((await call(admin, 'POST', '/exams/indicator-sets/hpc')).json()).toEqual({
      id: setId,
      installed: false,
    });
    const sets = (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
      id: string;
      code: string;
      kind: string;
      grades: string[];
      levelWords: Record<string, string>;
      indicators: Item[];
    }>;
    const set = sets.find((x) => x.id === setId)!;
    expect(set.code).toBe('HPC_FOUNDATION');
    expect(set.kind).toBe('hpc');
    expect(set.grades).toEqual(['Beginner', 'Progressing', 'Proficient']);
    expect(set.levelWords.Progressing).toBe('Mountain');
    const areas = new Set(set.indicators.map((i) => i.area));
    expect(areas.size).toBe(6);
    const pd1a = set.indicators.find((i) => i.code === 'PD1A')!;
    expect(pd1a.parentCode).toBe('PD1');
    expect(pd1a.descriptors.Proficient).toBe('Does it on their own');
    for (const i of set.indicators) item[i.code] = i.id;

    // three levels at most; an item goes under one of the set
    const bad = (parentCode: string) =>
      call(admin, 'PUT', '/exams/indicator-sets', {
        code: 'DEEP',
        name: 'Too deep',
        grades: ['A', 'B'],
        indicators: [
          { code: 'G1', name: 'Goal' },
          { code: 'C1', name: 'Competency', parentCode: 'G1' },
          { code: 'X1', name: 'Below', parentCode },
        ],
      });
    expect((await bad('C1')).statusCode).toBe(400);
    expect((await bad('NONE')).statusCode).toBe(400);

    // a written item under a goal (the school edits the set)
    const items = set.indicators.map(({ id: _id, ...rest }) => rest);
    const put = await call(admin, 'PUT', '/exams/indicator-sets', {
      code: 'HPC_FOUNDATION',
      name: 'Holistic progress card (foundational stage)',
      kind: 'hpc',
      grades: set.grades,
      levelWords: set.levelWords,
      indicators: [
        ...items,
        {
          code: 'PD1N',
          name: 'What the teacher noticed',
          area: 'Physical development',
          parentCode: 'PD1',
          kind: 'text',
          sortOrder: 3,
        },
      ],
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().id).toBe(setId);
    const again = (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
      id: string;
      indicators: Item[];
    }>;
    const now = again.find((x) => x.id === setId)!.indicators;
    // the items keep their ids (entries stay)
    expect(now.find((i) => i.code === 'PD1A')!.id).toBe(item.PD1A);
    item.PD1N = now.find((i) => i.code === 'PD1N')!.id;
  });

  it('enters levels and observations for a section; a heading is not entered', async () => {
    expect(
      (await call(admin, 'PUT', `/exams/${examId}/indicator-sets`, { classId, setId })).statusCode,
    ).toBe(200);
    const sheet = await call(clerk, 'GET', `/exams/${examId}/indicators?classSectionId=${section}`);
    expect(sheet.statusCode).toBe(200);
    const body = sheet.json();
    expect(body.set.kind).toBe('hpc');
    expect(body.locked).toBe(false);
    expect(body.indicators.find((i: Item) => i.code === 'PD1').heading).toBe(true);
    expect(body.rows[0].feedback).toEqual({});
    expect(body.rows[0].photos).toBe(0);
    const put = (rows: unknown[]) =>
      call(clerk, 'PUT', `/exams/${examId}/indicators`, { classSectionId: section, rows });
    const heading = await put([
      { studentId: student.Anu, indicatorId: item.PD1, grade: 'Proficient' },
    ]);
    expect(heading.statusCode).toBe(409);
    expect(heading.json().type).toBe('exams.indicator_heading');
    const text = await put([
      { studentId: student.Anu, indicatorId: item.PD1N, grade: 'Proficient' },
    ]);
    expect(text.json().type).toBe('exams.indicator_text');
    expect(
      (await put([{ studentId: student.Anu, indicatorId: item.PD1A, grade: 'A1' }])).json().type,
    ).toBe('exams.grade_not_allowed');
    const ok = await put([
      { studentId: student.Anu, indicatorId: item.PD1A, grade: 'Progressing' },
      { studentId: student.Anu, indicatorId: item.PD1B, grade: 'Proficient' },
      {
        studentId: student.Anu,
        indicatorId: item.PD1N,
        note: 'Washes hands before lunch on her own',
      },
      { studentId: student.Bela, indicatorId: item.PD1A, grade: 'Beginner' },
    ]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().changed).toBe(4);
    // nothing given: the entry goes
    expect((await put([{ studentId: student.Bela, indicatorId: item.PD1A }])).json().changed).toBe(
      1,
    );
    const rows = (
      await call(clerk, 'GET', `/exams/${examId}/indicators?classSectionId=${section}`)
    ).json().rows as Array<{
      studentId: string;
      grades: Record<string, { grade: string | null; note: string | null }>;
    }>;
    const anu = rows.find((r) => r.studentId === student.Anu)!;
    expect(anu.grades[item.PD1A!]!.grade).toBe('Progressing');
    expect(anu.grades[item.PD1N!]).toEqual({
      grade: null,
      note: 'Washes hands before lunch on her own',
    });
    expect(rows.find((r) => r.studentId === student.Bela)!.grades).toEqual({});
  });

  it("keeps the child's, the parent's and the teacher's words and portfolio photos", async () => {
    const fb = await call(clerk, 'PUT', `/exams/${examId}/hpc-feedback`, {
      classSectionId: section,
      rows: [
        { studentId: student.Anu, kind: 'self', text: 'I like painting and my cat.' },
        { studentId: student.Anu, kind: 'teacher', text: 'A curious learner.' },
        { studentId: student.Bela, kind: 'parent', text: 'Sings at home.' },
      ],
    });
    expect(fb.statusCode).toBe(200);
    expect(fb.json().changed).toBe(3);
    const add = (studentId: string, base64: string, contentType = 'image/png') =>
      call(clerk, 'POST', `/exams/${examId}/portfolio`, {
        classSectionId: section,
        studentId,
        caption: 'My painting',
        indicatorId: item.AC1A,
        image: { contentType, base64 },
      });
    const p = await add(student.Anu!, PNG);
    expect(p.statusCode).toBe(201);
    ids.photo = p.json().id;
    expect((await add(student.Anu!, PNG, 'image/jpeg')).statusCode).toBe(400);
    const second = await add(student.Anu!, PNG);
    ids.photo2 = second.json().id;
    const list = (
      await call(
        clerk,
        'GET',
        `/exams/${examId}/portfolio?classSectionId=${section}&studentId=${student.Anu!}`,
      )
    ).json().data as Array<{ id: string; indicator: string; caption: string }>;
    expect(list).toHaveLength(2);
    expect(list[0]!.indicator).toBe('Draws, paints and makes things');
    const img = await call(admin, 'GET', `/exams/${examId}/portfolio/${ids.photo}/image`);
    expect(img.json()).toMatchObject({ contentType: 'image/png', base64: PNG });
    expect(
      (await call(clerk, 'DELETE', `/exams/${examId}/portfolio/${ids.photo2}`)).statusCode,
    ).toBe(200);
    const sheet = (
      await call(clerk, 'GET', `/exams/${examId}/indicators?classSectionId=${section}`)
    ).json().rows as Array<{
      studentId: string;
      photos: number;
      feedback: Record<string, { text: string }>;
    }>;
    const anu = sheet.find((r) => r.studentId === student.Anu)!;
    expect(anu.photos).toBe(1);
    expect(anu.feedback.self!.text).toBe('I like painting and my cat.');
  });

  it('lets a parent write their feedback in the app, kept as theirs; the lock closes it', async () => {
    const mine = await call(parent, 'GET', `/exams/mine/feedback?studentId=${student.Anu!}`);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().exams).toEqual([
      expect.objectContaining({ examId, code: 'T1', open: true, text: null }),
    ]);
    expect(
      (await call(parent, 'GET', `/exams/mine/feedback?studentId=${student.Bela!}`)).statusCode,
    ).toBe(404);
    const put = await call(parent, 'PUT', '/exams/mine/feedback', {
      studentId: student.Anu,
      examId,
      text: 'She tells us stories from school every day.',
    });
    expect(put.statusCode).toBe(200);
    const teacher = await call(clerk, 'PUT', `/exams/${examId}/hpc-feedback`, {
      classSectionId: section,
      rows: [{ studentId: student.Anu, kind: 'parent', text: 'Changed by the school' }],
    });
    expect(teacher.statusCode).toBe(409);
    expect(teacher.json().type).toBe('exams.feedback_by_family');
    // staff cannot use the family route
    expect(
      (
        await call(clerk, 'PUT', '/exams/mine/feedback', {
          studentId: student.Anu,
          examId,
          text: 'x',
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (await call(admin, 'PUT', `/exams/${examId}/class-locks`, { classId, indicators: true }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(parent, 'GET', `/exams/mine/feedback?studentId=${student.Anu!}`)).json().exams[0]
        .open,
    ).toBe(false);
    expect(
      (
        await call(parent, 'PUT', '/exams/mine/feedback', {
          studentId: student.Anu,
          examId,
          text: 'Too late',
        })
      ).json().type,
    ).toBe('exams.entry_locked');
    const locked = await call(clerk, 'PUT', `/exams/${examId}/hpc-feedback`, {
      classSectionId: section,
      rows: [{ studentId: student.Bela, kind: 'self', text: 'Too late' }],
    });
    expect(locked.json().type).toBe('exams.entry_locked');
    expect(
      (await call(clerk, 'GET', `/exams/${examId}/indicators?classSectionId=${section}`)).json()
        .locked,
    ).toBe(true);
  });

  it('prints the HPC card: levels with their words and meaning, the three voices, the portfolio', async () => {
    const t = await call(admin, 'POST', '/exams/report-cards/templates/hpc');
    expect(t.statusCode).toBe(201);
    const tpl = (t.json().data as Array<{ id: string; code: string; band: string }>).find(
      (x) => x.code === 'hpc_foundational',
    )!;
    expect(tpl.band).toBe('pre_primary');
    const rel = await call(admin, 'POST', '/exams/report-cards/releases', {
      termCode: 'T1',
      name: 'Term 1',
      examIds: [examId],
      templates: { [`class_${classId}`]: tpl.id },
    });
    expect(rel.statusCode).toBe(201);
    const pv = await call(admin, 'POST', `/exams/report-cards/templates/${tpl.id}/preview`, {
      releaseId: rel.json().id,
      studentId: student.Anu,
    });
    expect(pv.statusCode).toBe(201);
    const html = pv.json().html as string;
    expect(html).toContain('My progress');
    expect(html).toContain('Physical development');
    expect(html).toContain('Develops habits that keep them healthy and safe');
    expect(html).toContain('Progressing<small>Mountain</small>');
    expect(html).toContain('Does it with some help');
    expect(html).toContain('Washes hands before lunch on her own');
    expect(html).toContain('I like painting and my cat.');
    expect(html).toContain('She tells us stories from school every day.');
    expect(html).toContain('A curious learner.');
    expect(html).toContain(`data:image/png;base64,${PNG}`);
    expect(html).toContain('My painting');
  });
});
