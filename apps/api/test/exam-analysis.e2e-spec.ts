/**
 * Examination analysis and exports (docs/design/65, part 6): the section-wise subject analysis (a
 * class line under several sections), mark ranges (the class's grade scale, or the school's own
 * ranges), toppers (top N in the class or section, at or above / below a %, a subject's), the subject
 * teachers' analysis, the upload status and the missing marks, the merit list by division of a locked
 * result scheme; each as Excel and PDF; the report builder's exam datasets.
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

type Cell = string | number | null;
interface Report {
  title: string;
  subtitle: string[];
  tables: Array<{ columns: Array<{ key: string; label: string }>; rows: Cell[][] }>;
}

describe('exam analysis and exports (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let classId: string;
  let examId: string;
  const section: Record<string, string> = {};
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const s = stamp('AN');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const report = async (kind: string, q = '') => {
    const r = await call(clerk, 'GET', `/exams/${examId}/reports/${kind}${q ? `?${q}` : ''}`);
    expect(r.statusCode).toBe(200);
    return r.json() as Report;
  };
  const row = (rep: Report, ...first: Cell[]) =>
    rep.tables[0]!.rows.find((r) => first.every((v, i) => r[i] === v));

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'VI',
        name: 'Class VI',
        displayOrder: 6,
      })
    ).json().id;
    for (const n of ['A', 'B'])
      section[n] = (
        await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: n })
      ).json().id;
    for (const [code, name] of [
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
    ])
      subject[code!] = (
        await call(admin, 'POST', '/academics/subjects', { code, name, kind: 'scholastic' })
      ).json().id;
    for (const [i, [first, sec]] of (
      [
        ['Asha', 'A'],
        ['Bhanu', 'A'],
        ['Chitra', 'A'],
        ['Dev', 'B'],
        ['Esha', 'B'],
      ] as const
    ).entries())
      student[first] = (
        await call(admin, 'POST', '/people/students', {
          admissionNo: `${s}-${String(i + 1)}`,
          firstName: first,
          lastName: 'Analysis',
          guardians: [],
          enrolment: { classSectionId: section[sec], rollNo: i + 1 },
        })
      ).json().id;
    const scales = (await call(admin, 'POST', '/exams/grade-scales/presets')).json().data as Array<{
      id: string;
      code: string;
    }>;
    const type = (await call(admin, 'POST', '/exams/types', { code: 'TRM', name: 'Term' })).json()
      .id;
    examId = (
      await call(admin, 'POST', '/exams', {
        examTypeId: type,
        code: 'T1',
        name: 'Term 1',
        classes: [{ classId, gradeScaleId: scales.find((x) => x.code === 'CBSE_8POINT')!.id }],
      })
    ).json().id;
    await call(admin, 'PUT', `/exams/${examId}/subjects`, {
      classId,
      subjects: [
        { subjectId: subject.ENG, maxMarks: 100, passMarks: 33 },
        { subjectId: subject.MAT, maxMarks: 100, passMarks: 33 },
      ],
    });
    const marks: Record<string, Record<string, number | string | null>> = {
      Asha: { ENG: 92, MAT: 88 },
      Bhanu: { ENG: 30, MAT: 'AB' },
      Chitra: { ENG: 75, MAT: 95 },
      Dev: { ENG: 60, MAT: 45 },
      Esha: { ENG: 81, MAT: null },
    };
    for (const sub of ['ENG', 'MAT'])
      for (const sec of ['A', 'B']) {
        const rows = Object.entries(marks)
          .filter(([name]) => (['Dev', 'Esha'].includes(name) ? 'B' : 'A') === sec)
          .filter(([, m]) => m[sub] !== null)
          .map(([name, m]) =>
            typeof m[sub] === 'number'
              ? { studentId: student[name], marks: m[sub] }
              : { studentId: student[name], code: m[sub] },
          );
        const r = await call(clerk, 'PUT', `/exams/${examId}/marks`, {
          classSectionId: section[sec],
          subjectId: subject[sub],
          rows,
        });
        expect(r.statusCode).toBe(200);
      }
    expect((await call(admin, 'POST', `/exams/${examId}/results/compute`)).statusCode).toBe(201);
    // Tara teaches English in both sections; Mathematics has no subject teacher
    await withMigrator(async (c) => {
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name) VALUES ($1, 'T1', 'Tara', 'Teacher') RETURNING id::text`,
        [school.id],
      );
      for (const sec of ['A', 'B'])
        await c.query(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind)
           VALUES ($1, $2, $3, $4, $5, 'subject_teacher')`,
          [school.id, school.yearId, e.rows[0]!.id, section[sec], subject.ENG],
        );
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('analyses each subject by section, with the class line under them', async () => {
    const r = await report('subjects', `classId=${classId}`);
    expect(r.title).toBe('Section-wise subject analysis');
    expect(r.subtitle[0]).toBe('Term 1 (T1) · Class VI');
    // students, appeared, absent, mean, mean %, highest, lowest, passed, pass %
    expect(row(r, 'VI-A', 'English (100)')!.slice(2)).toEqual([
      3, 3, 0, 65.7, 65.7, 92, 30, 2, 66.7,
    ]);
    expect(row(r, 'VI-A', 'Mathematics (100)')!.slice(2)).toEqual([
      3, 2, 1, 91.5, 91.5, 95, 88, 2, 100,
    ]);
    expect(row(r, 'Class VI', 'English (100)')!.slice(2)).toEqual([
      5, 5, 0, 67.6, 67.6, 92, 30, 4, 80,
    ]);
    expect(row(r, 'VI-B', 'Mathematics (100)')!.slice(2, 4)).toEqual([2, 1]);
  });

  it("counts students in the class's grade bands, or the school's own ranges", async () => {
    const scale = await report('ranges', `classId=${classId}`);
    const cols = scale.tables[0]!.columns.map((c) => c.label);
    expect(cols.slice(3, 5)).toEqual(['A1 (91-100)', 'A2 (81-90.99)']);
    // English in VI-A: 92 A1, 75 B1, 30 E
    const eng = row(scale, 'VI-A', 'English')!;
    expect(eng[2]).toBe(3);
    expect(eng[cols.indexOf('A1 (91-100)')]).toBe(1);
    expect(eng[cols.indexOf('B1 (71-80.99)')]).toBe(1);
    expect(eng[cols.indexOf('E (0-32.99)')]).toBe(1);
    const own = await report('ranges', 'ranges=90,75,33');
    expect(own.tables[0]!.columns.slice(3).map((c) => c.label)).toEqual([
      '90-100',
      '75-89.99',
      '33-74.99',
    ]);
    expect(row(own, 'VI-A', 'English')!.slice(2)).toEqual([3, 1, 1, 0]);
    expect(
      (await call(clerk, 'GET', `/exams/${examId}/reports/ranges?ranges=90,x`)).statusCode,
    ).toBe(400);
  });

  it('lists toppers: top N, at or above / below a %, by section, in a subject', async () => {
    const names = (r: Report) => r.tables[0]!.rows.map((x) => x[4]);
    const top2 = await report('toppers', `classId=${classId}&top=2`);
    expect(top2.title).toBe('Toppers · top 2 of each class');
    expect(names(top2)).toEqual(['Asha Analysis', 'Chitra Analysis']);
    expect(top2.tables[0]!.rows[0]!.slice(5, 9)).toEqual(['180 / 200', 90, 'A2', 'Pass']);
    expect(names(await report('toppers', 'minPct=85'))).toEqual([
      'Asha Analysis',
      'Chitra Analysis',
    ]);
    expect(names(await report('toppers', 'belowPct=60'))).toContain('Dev Analysis');
    expect(names(await report('toppers', 'by=section&top=1'))).toEqual([
      'Asha Analysis',
      'Dev Analysis',
    ]);
    const maths = await report('toppers', `subjectId=${subject.MAT!}&top=1`);
    expect(maths.title).toBe('Toppers · Mathematics');
    expect(maths.tables[0]!.rows).toEqual([[1, 'VI-A', 3, `${s}-3`, 'Chitra Analysis', 95, 95]]);
  });

  it("analyses each subject teacher's sections", async () => {
    const r = await report('teachers');
    const rows = r.tables[0]!.rows;
    const at = rows.findIndex((x) => x[0] === 'Tara Teacher');
    expect(at).toBeGreaterThanOrEqual(0);
    // students, appeared, mean %, pass %, highest %
    expect(rows[at + 1]).toEqual(['VI-A', 'English', 3, 3, 65.7, 66.7, 92]);
    expect(rows[at + 2]).toEqual(['VI-B', 'English', 2, 2, 70.5, 100, 81]);
    expect(rows[at + 3]!.slice(0, 4)).toEqual(['All', 'Tara Teacher', 5, 5]);
    expect(rows.some((x) => x[0] === '(no subject teacher)')).toBe(true);
  });

  it('shows the upload status and the missing marks', async () => {
    const st = await report('status');
    expect(row(st, 'VI-B', 'Mathematics')!.slice(2, 6)).toEqual([2, 1, 1, 'Open']);
    expect(st.tables[1]!.rows).toContainEqual(['Marks still to enter', 1]);
    const miss = await report('missing');
    expect(miss.tables[0]!.rows).toEqual([
      ['VI-B · Mathematics', null, null, null],
      ['VI-B', 5, `${s}-5`, 'Esha Analysis'],
    ]);
    // one section only
    expect((await report('missing', `classSectionId=${section.A!}`)).tables[0]!.rows).toEqual([]);
    expect((await call(clerk, 'GET', `/exams/${examId}/reports/nothing`)).statusCode).toBe(404);
  });

  it('gives each report as Excel and PDF', async () => {
    for (const [kind, format, magic] of [
      ['subjects', 'xlsx', 'PK'],
      ['ranges', 'pdf', '%PDF'],
      ['toppers', 'pdf', '%PDF'],
      ['status', 'xlsx', 'PK'],
      ['missing', 'pdf', '%PDF'],
      ['teachers', 'xlsx', 'PK'],
    ] as const) {
      const f = await call(clerk, 'GET', `/exams/${examId}/reports/${kind}?format=${format}`);
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toBe(`${kind}-${examId}.${format}`);
      expect(
        Buffer.from(f.json().base64 as string, 'base64')
          .subarray(0, magic.length)
          .toString(),
      ).toBe(magic);
    }
  });

  it('prints the merit list by division of a locked result scheme', async () => {
    const sc = await call(admin, 'POST', '/exams/schemes', {
      name: 'Term 1 result',
      purpose: 'result',
      termCode: 'T1',
      classIds: [classId],
      def: {
        exams: [{ key: 'T1', examId }],
        columns: [{ key: 'T1', label: 'Term (100)', kind: 'raw', exam: 'T1', total: true }],
        result: {
          passPct: 33,
          compartmentUpTo: 0,
          rankBy: 'pct',
          divisions: [
            { name: 'First', minPct: 60 },
            { name: 'Second', minPct: 45 },
          ],
        },
      },
    });
    expect(sc.statusCode).toBe(201);
    const id = sc.json().id as string;
    const draft = await call(clerk, 'GET', `/exams/schemes/${id}/divisions`);
    expect(draft.statusCode).toBe(409);
    expect(draft.json().type).toBe('exams.scheme_not_locked');
    expect((await call(admin, 'POST', `/exams/schemes/${id}/lock`)).statusCode).toBe(201);
    expect((await call(admin, 'POST', `/exams/schemes/${id}/compute`)).statusCode).toBe(201);
    const r = (
      await call(clerk, 'GET', `/exams/schemes/${id}/divisions?classId=${classId}`)
    ).json() as Report;
    expect(r.title).toBe('Merit list by division · Term 1 result');
    const heads = r.tables[0]!.rows.filter((x) => x[1] === null).map((x) => x[0]);
    expect(heads.slice(0, 2)).toEqual(['First (2)', 'Second (1)']);
    expect(r.tables[0]!.rows[1]!.slice(0, 5)).toEqual([1, 'VI-A', 1, `${s}-1`, 'Asha Analysis']);
    const by = r.tables[1]!;
    expect(by.columns.slice(2, 4).map((c) => c.label)).toEqual(['First', 'Second']);
    expect(by.rows.find((x) => x[0] === 'VI-A')!.slice(1, 4)).toEqual([3, 2, 0]);
    expect(by.rows.find((x) => x[0] === 'All')![1]).toBe(5);
    const pdf = await call(clerk, 'GET', `/exams/schemes/${id}/divisions?format=pdf`);
    expect(
      Buffer.from(pdf.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('has the marks, exam results and term results datasets in the report builder', async () => {
    const list = (await call(admin, 'GET', '/reports/datasets')).json() as
      { data: Array<{ id: string }> } | Array<{ id: string }>;
    const ids = (Array.isArray(list) ? list : list.data).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['exam_marks', 'exam_results', 'term_results']));
    const marks = await call(admin, 'GET', `/reports/datasets/exam_marks/rows?examId=${examId}`);
    expect(marks.statusCode).toBe(200);
    const rows = (marks.json().rows ?? marks.json().data) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(10);
    expect(
      rows.find((x) => x.student === 'Bhanu Analysis' && x.subject === 'Mathematics'),
    ).toMatchObject({ code: 'AB', marks: null });
    const res = await call(admin, 'GET', `/reports/datasets/exam_results/rows?examId=${examId}`);
    expect(((res.json().rows ?? res.json().data) as unknown[]).length).toBeGreaterThanOrEqual(4);
    const term = await call(admin, 'GET', '/reports/datasets/term_results/rows?termCode=T1');
    const t = (term.json().rows ?? term.json().data) as Array<Record<string, unknown>>;
    expect(t.find((x) => x.student === 'Asha Analysis')).toMatchObject({
      division: 'First',
      rank_in_class: 1,
    });
  });
});
