/**
 * Mark registers like the school's Term Mark Register (docs/design/68): a register with its own column
 * chain per subject (UT-1 + UT-2 summed and converted to 20, the term out of 80) and a slot (the third
 * language, each student's own), codes per exam (ML filled pro-rata and printed with "*", AB holding the
 * final); Run for a section, the class ranked together (by rank and by division), an exam-wise view and
 * one subject's sheet; files of every section; unique names; a copy for another class; the bin; locked
 * versions (a save makes the next, a version restored as a new register, unlock); rights per register
 * with delegated Assign and the Rights report; what the builder reads.
 */
import ExcelJS from 'exceljs';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { defaultCodes, newRegisterDef, type RegColumn, type RegisterDef } from '@edupro/db';
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

interface Cell {
  t: string;
  badge?: { label: string };
  drill?: { rows: string[][] };
  tone?: string;
  span?: number;
  rows?: number;
}
interface Sheet {
  note?: string;
  head: Cell[][];
  body: Array<{ studentId: string; cells: Cell[] }>;
  foot: Cell[] | null;
}

/** "group · label" of every column of a sheet, left to right */
function columnsOf(sheet: Sheet): string[] {
  const out: string[] = [];
  let k = 0;
  for (const h of sheet.head[0]!) {
    if ((h.rows ?? 1) === 2) out.push(h.t);
    else
      for (let i = 0; i < (h.span ?? 1); i += 1) {
        out.push(`${h.t} · ${sheet.head[1]![k]!.t}`);
        k += 1;
      }
  }
  return out;
}
const cell = (sheet: Sheet, studentId: string, column: string) => {
  const at = columnsOf(sheet).indexOf(column);
  if (at < 0) throw new Error(`no column ${column}: ${columnsOf(sheet).join(' | ')}`);
  return sheet.body.find((r) => r.studentId === studentId)!.cells[at]!.t;
};

describe('mark registers like the legacy Term Mark Register (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  const t: Record<string, SeededUser> = {};
  const cls: Record<string, string> = {};
  const section: Record<string, string> = {};
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const exam: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const s = stamp('MR');
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

  const chain = (): RegColumn[] => [
    { key: 'U1', name: 'UT-1', kind: 'raw', exam: 'UT1', hidden: true },
    { key: 'U2', name: 'UT-2', kind: 'raw', exam: 'UT2', hidden: true },
    { key: 'S', name: 'UT sum', kind: 'avg', mode: 'sum', of: ['U1', 'U2'], hidden: true },
    {
      key: 'C',
      name: 'UT',
      kind: 'conv',
      source: 'S',
      method: 'scale',
      target: 20,
      inTotal: true,
      grade: true,
    },
    { key: 'T', name: 'Term', kind: 'raw', exam: 'TERM', inTotal: true },
  ];
  const def = (): RegisterDef => {
    const d = newRegisterDef();
    const codes = defaultCodes().map((c) => (c.code === 'ML' ? { ...c, showValue: true } : c));
    return {
      ...d,
      exams: [
        { key: 'UT1', examId: exam.UT1! },
        { key: 'UT2', examId: exam.UT2! },
        { key: 'TERM', examId: exam.TERM! },
      ],
      subjects: [
        { key: 'ENG', subjectId: subject.ENG, columns: chain(), round: 'up', showTotal: true },
        { key: 'MAT', subjectId: subject.MAT, columns: chain(), round: 'up', showTotal: true },
        {
          key: 'L3',
          slot: { name: 'THIRD LANGUAGE', members: [subject.SAN!, subject.FRE!] },
          columns: [{ key: 'T', name: 'Term', kind: 'raw', exam: 'TERM', inTotal: true }],
          showTotal: true,
        },
      ],
      codes: { UT1: codes, UT2: codes, TERM: codes },
      display: { ...d.display, averages: true },
    };
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'exam_office');
      for (const n of ['t1', 't2', 't3'])
        t[n] = await seedUser(c, school, `${s}-${n}`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    for (const [code, order] of [
      ['VI', 6],
      ['VII', 7],
    ] as const)
      cls[code] = (
        await call(admin, 'POST', '/academics/classes', {
          code,
          name: `Class ${code}`,
          displayOrder: order,
        })
      ).json().id;
    for (const [k, c, n] of [
      ['VI-A', 'VI', 'A'],
      ['VI-B', 'VI', 'B'],
      ['VII-A', 'VII', 'A'],
    ] as const)
      section[k] = (
        await call(admin, 'POST', `/academics/classes/${cls[c]!}/sections`, { name: n })
      ).json().id;
    for (const [code, name] of [
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
      ['SAN', 'Sanskrit'],
      ['FRE', 'French'],
    ])
      subject[code!] = (
        await call(admin, 'POST', '/academics/subjects', { code, name, kind: 'scholastic' })
      ).json().id;
    const langs: Array<[string, string, string]> = [];
    for (const [i, [first, sec, lang]] of (
      [
        ['Asha', 'VI-A', 'SAN'],
        ['Bhanu', 'VI-A', 'FRE'],
        ['Chitra', 'VI-A', 'SAN'],
        ['Dev', 'VI-B', 'FRE'],
        ['Esha', 'VII-A', null],
      ] as const
    ).entries()) {
      student[first] = (
        await call(admin, 'POST', '/people/students', {
          admissionNo: `${s}-${String(i + 1)}`,
          firstName: first,
          lastName: 'REGISTER',
          guardians: [],
          enrolment: { classSectionId: section[sec], rollNo: i + 1 },
        })
      ).json().id;
      if (lang) langs.push([first, sec, lang]);
    }
    const scales = (await call(admin, 'POST', '/exams/grade-scales/presets')).json().data as Array<{
      id: string;
      code: string;
    }>;
    const cbse = scales.find((x) => x.code === 'CBSE_8POINT')!.id;
    const type = (await call(admin, 'POST', '/exams/types', { code: 'UT', name: 'Tests' })).json()
      .id;
    for (const [code, max] of [
      ['UT1', 40],
      ['UT2', 40],
      ['TERM', 80],
    ] as const) {
      exam[code] = (
        await call(admin, 'POST', '/exams', {
          examTypeId: type,
          code,
          name: code,
          classes: [
            { classId: cls.VI, gradeScaleId: cbse },
            { classId: cls.VII, gradeScaleId: cbse },
          ],
        })
      ).json().id;
      const langs = code === 'TERM' ? [subject.SAN, subject.FRE] : [];
      await call(admin, 'PUT', `/exams/${exam[code]!}/subjects`, {
        classId: cls.VI,
        subjects: [subject.ENG, subject.MAT, ...langs].map((id) => ({
          subjectId: id,
          maxMarks: max,
        })),
      });
      await call(admin, 'PUT', `/exams/${exam[code]!}/subjects`, {
        classId: cls.VII,
        subjects: [subject.ENG, subject.MAT].map((id) => ({ subjectId: id, maxMarks: max })),
      });
    }
    // the languages chosen (each class's subjects are known from its exams now)
    for (const [first, sec, lang] of langs)
      expect(
        (
          await call(admin, 'PUT', '/exams/subject-choices', {
            classSectionId: section[sec],
            rows: [
              {
                studentId: student[first],
                subjects: [
                  { subjectId: subject.ENG, kind: 'compulsory' },
                  { subjectId: subject.MAT, kind: 'compulsory' },
                  { subjectId: subject[lang], kind: 'optional' },
                ],
              },
            ],
          })
        ).statusCode,
      ).toBe(200);
    // [UT1, UT2, TERM] per subject; the language's term only
    const marks: Record<string, Record<string, Array<number | string>>> = {
      Asha: { ENG: [36, 34, 70], MAT: [40, 40, 80], SAN: [60] },
      Bhanu: { ENG: ['ML', 30, 50], MAT: [20, 20, 30], FRE: [40] },
      Chitra: { ENG: [30, 30, 60], MAT: ['AB', 30, 70], SAN: [72] },
      Dev: { ENG: [20, 20, 40], MAT: [20, 20, 40], FRE: [50] },
      Esha: { ENG: [30, 30, 60], MAT: [30, 30, 60] },
    };
    const secOf = (n: string) => (n === 'Dev' ? 'VI-B' : n === 'Esha' ? 'VII-A' : 'VI-A');
    for (const [name, bySub] of Object.entries(marks))
      for (const [sub, list] of Object.entries(bySub))
        for (const [i, v] of list.entries()) {
          const code = list.length === 1 ? 'TERM' : (['UT1', 'UT2', 'TERM'] as const)[i]!;
          const r = await call(office, 'PUT', `/exams/${exam[code]!}/marks`, {
            classSectionId: section[secOf(name)],
            subjectId: subject[sub],
            rows: [
              typeof v === 'number'
                ? { studentId: student[name], marks: v }
                : { studentId: student[name], code: v },
            ],
          });
          expect(r.statusCode).toBe(200);
        }
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it('the builder reads the classes’ subjects with each exam’s maximum, the slots and the school’s codes', async () => {
    const b = (await call(office, 'GET', `/exams/schemes/builder?classIds=${cls.VI!}`)).json();
    const eng = b.subjects.find((x: { code: string }) => x.code === 'ENG');
    expect(
      eng.papers
        .map((p: { examId: string; max: number }) => p.max)
        .sort((a: number, z: number) => a - z),
    ).toEqual([40, 40, 80]);
    expect(b.codes.map((x: { code: string }) => x.code)).toContain('AB');
    expect(b.grades[0]).toMatchObject({ grade: 'A1' });
  });

  it('a register with its own chain per subject and a language slot; names are unique in the year', async () => {
    const r = await call(office, 'POST', '/exams/schemes', {
      name: 'Term Register',
      purpose: 'register',
      classIds: [cls.VI, cls.VII],
      def: def(),
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'draft', version: 1, problems: [] });
    ids.reg = r.json().id;
    const twin = await call(office, 'POST', '/exams/schemes', {
      name: '  term   register ',
      purpose: 'register',
      classIds: [cls.VI],
      def: def(),
    });
    expect(twin.statusCode).toBe(409);
    expect(twin.json().type).toBe('exams.register_name');
  });

  it('runs a section: the chain, ML filled pro-rata with "*", AB holding the final, ranks and the class average', async () => {
    const r = await call(
      office,
      'GET',
      `/exams/schemes/${ids.reg!}/register?classSectionId=${section['VI-A']!}`,
    );
    expect(r.statusCode).toBe(200);
    const sheet = r.json().sheet as Sheet;
    // Asha: UT (36 + 34)/80 of 20 = 17.5, + term 70 = 87.5 → 88
    expect(cell(sheet, student.Asha!, 'English · UT (20)')).toBe('17.5');
    expect(cell(sheet, student.Asha!, 'English · Gr')).toBe('A2');
    expect(cell(sheet, student.Asha!, 'English · Total (100)')).toBe('88');
    expect(cell(sheet, student.Asha!, 'THIRD LANGUAGE · Subject')).toBe('SAN');
    expect(cell(sheet, student.Bhanu!, 'THIRD LANGUAGE · Subject')).toBe('FRE');
    // Bhanu's ML in UT-1 is filled from his other exams: (30 + 50)/(40 + 80) of 40 = 26.67
    const bhanu = (
      r.json().rows as Array<{
        studentId: string;
        subjects: Array<{
          code: string;
          values: Record<string, { v: number; star?: boolean }>;
          total: number;
        }>;
      }>
    ).find((x) => x.studentId === student.Bhanu)!;
    const bEng = bhanu.subjects.find((x) => x.code === 'ENG')!;
    expect(bEng.values.U1).toMatchObject({ v: 26.67, star: true });
    expect(bEng.total).toBe(64);
    // Chitra's AB in Maths UT-1 holds Maths and the final
    expect(cell(sheet, student.Chitra!, 'Mathematics · Total (100)')).toBe('–');
    expect(cell(sheet, student.Chitra!, 'FINAL RESULT · Result')).toBe('Absent');
    expect(cell(sheet, student.Chitra!, 'FINAL RESULT · Rank')).toBe('–');
    expect(cell(sheet, student.Asha!, 'FINAL RESULT · Total')).toBe('248 / 280');
    expect(cell(sheet, student.Asha!, 'FINAL RESULT · Rank')).toBe('1');
    expect(cell(sheet, student.Bhanu!, 'FINAL RESULT · Rank')).toBe('2');
    expect(sheet.foot![columnsOf(sheet).indexOf('English · Total (100)')]!.t).toBe('75.67');
    expect(r.json().notes.join(' ')).toContain('Final withheld');
  });

  it('the class ranked together, by rank and by division; one subject’s sheet; an exam-wise view', async () => {
    const merit = (
      await call(office, 'GET', `/exams/schemes/${ids.reg!}/register?classId=${cls.VI!}&view=merit`)
    ).json();
    expect(
      merit.rows.map((x: { name: string; rankInClass: number | null }) => [
        x.name.split(' ')[0],
        x.rankInClass,
      ]),
    ).toEqual([
      ['Asha', 1],
      ['Dev', 2],
      ['Bhanu', 3],
      ['Chitra', null],
    ]);
    expect(columnsOf(merit.sheet)).toContain('Section');
    const div = (
      await call(
        office,
        'GET',
        `/exams/schemes/${ids.reg!}/register?classId=${cls.VI!}&view=division`,
      )
    ).json();
    expect(
      div.rows.map((x: { division: string | null; result: string }) => x.division ?? x.result),
    ).toEqual(['1st Div', '2nd Div', '2nd Div', 'absent']);
    const eng = (
      await call(
        office,
        'GET',
        `/exams/schemes/${ids.reg!}/register?classSectionId=${section['VI-A']!}&subject=ENG`,
      )
    ).json().sheet as Sheet;
    expect(columnsOf(eng)).not.toContain('Mathematics · Total (100)');
    expect(cell(eng, student.Chitra!, 'RESULT · Rank')).toBe('2');
    expect(cell(eng, student.Bhanu!, 'RESULT · Rank')).toBe('3');
    // the same register exam-wise: each subject's total is the exam's marks
    const cur = (await call(office, 'GET', `/exams/schemes/${ids.reg!}`)).json();
    expect(
      (
        await call(office, 'PUT', `/exams/schemes/${ids.reg!}`, {
          def: { ...cur.def, type: 'examwise' },
        })
      ).statusCode,
    ).toBe(200);
    const term = (
      await call(
        office,
        'GET',
        `/exams/schemes/${ids.reg!}/register?classSectionId=${section['VI-A']!}&exam=TERM`,
      )
    ).json();
    expect(term.exam).toBe('TERM');
    const asha = term.rows.find((x: { studentId: string }) => x.studentId === student.Asha);
    expect(asha).toMatchObject({ total: 210, max: 240 });
    await call(office, 'PUT', `/exams/schemes/${ids.reg!}`, {
      def: { ...cur.def, type: 'general' },
    });
  });

  it('files: a PDF of every section on A3 upright, an Excel with a sheet per section', async () => {
    const pdf = await call(
      office,
      'GET',
      `/exams/schemes/${ids.reg!}/register?format=pdf&all=true&classId=${cls.VI!}&paper=A3&orientation=portrait`,
    );
    expect(pdf.statusCode).toBe(200);
    expect(
      Buffer.from(pdf.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    const xl = await call(
      office,
      'GET',
      `/exams/schemes/${ids.reg!}/register?format=xlsx&all=true&classId=${cls.VI!}`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xl.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['VI-A', 'VI-B']);
    const ws = wb.worksheets[0]!;
    const texts: string[] = [];
    ws.eachRow((row) => row.eachCell((c) => texts.push(String(c.value))));
    expect(texts).toContain('Mark Register');
    expect(texts).toContain('THIRD LANGUAGE');
  });

  it('the Run reports: summary, analysis, entry status, toppers, teacher-wise, at-risk, failing, compare; their files', async () => {
    const run = (q: string) =>
      call(office, 'GET', `/exams/schemes/${ids.reg!}/register?${q}`).then((r) => {
        expect(r.statusCode).toBe(200);
        return r.json() as {
          report: string;
          reports: Array<{ kind: string }>;
          blocks: Array<{ title: string; sheet: Sheet }>;
        };
      });
    const A = `classSectionId=${section['VI-A']!}`;
    const VI = `classId=${cls.VI!}`;
    const firstCol = (b: { sheet: Sheet }) =>
      Object.fromEntries(b.sheet.body.map((r) => [r.cells[0]!.t, r.cells.map((c) => c.t)]));
    const sum = await run(`${A}&report=summary`);
    expect(sum.reports.map((x) => x.kind)).toContain('compare');
    const fig = firstCol(sum.blocks[0]!);
    // the legacy's Result Summary: Asha and Bhanu pass; Chitra's AB withholds her final
    expect(sum.blocks[0]!.title).toBe('Result Summary — 3 student(s), 2 appeared');
    expect(sum.blocks[0]!.sheet.note).toContain('Fail = subject % below 33%');
    expect(fig['Total students']![1]).toBe('3');
    expect(fig['Passed (no failure, no absence)']!.slice(1)).toEqual(['2', '100.00%']);
    expect(fig['Absent in 1 subject']![1]).toBe('1');
    const absent = sum.blocks.find((b) => b.title === 'Absent in 1 subject — 1')!;
    expect(absent.sheet.body[0]!.cells.map((c) => c.t).slice(1)).toEqual([
      'Chitra Register',
      `${s}-3`,
      'MATHEMATICS (AB)',
      '–',
    ]);
    const ana = firstCol((await run(`${A}&report=analysis`)).blocks[0]!);
    // English: Asha 88, Bhanu 64, Chitra 75
    expect(ana.English!.slice(1, 4)).toEqual(['3', '0', '3']);
    expect(ana.English!.slice(-4)).toEqual(['88 / 100', '64', '75.67', '100.00']);
    const entry = (await run(`${A}&report=entry`)).blocks[0]!;
    // the legacy's entry status: each exam entered of how many, Complete (or "–": no such paper)
    expect(entry.title).toBe('Marks Entry Status — VI-A');
    expect(
      entry.sheet.body.every((r) =>
        r.cells.slice(4).every((c) => c.t === '–' || c.badge?.label === 'Complete'),
      ),
    ).toBe(true);
    expect(entry.sheet.foot!.slice(1).every((c) => c.t.startsWith('100%'))).toBe(true);
    const top = (await run(`${VI}&report=toppers&top=3`)).blocks[0]!;
    expect(top.sheet.body.map((r) => r.cells[1]!.t.split(' ')[0])).toEqual([
      'Asha',
      'Dev',
      'Bhanu',
    ]);
    const teacher = (await run(`${A}&report=teacher`)).blocks[0]!;
    expect(teacher.sheet.body[0]!.cells[0]!.t).toBe('Not assigned');
    const risk = (await run(`${A}&report=risk&margin=10`)).blocks[0]!;
    expect(risk.sheet.body.map((r) => r.cells[0]!.t)).toContain('Watch');
    const failing = (await run(`${VI}&report=failing`)).blocks[0]!;
    expect(failing.sheet.body.map((r) => r.cells[1]!.t)).toEqual(['NIL', 'NIL']);
    const cmp = await run(`${VI}&report=compare`);
    expect(cmp.blocks[0]!.sheet.head[0]!.map((c) => c.t)).toEqual([
      'Subject',
      'VI-A',
      'VI-B',
      'Class',
    ]);
    const pdf = await call(
      office,
      'GET',
      `/exams/schemes/${ids.reg!}/register?${A}&report=summary&format=pdf`,
    );
    expect(
      Buffer.from(pdf.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    const xl = await call(
      office,
      'GET',
      `/exams/schemes/${ids.reg!}/register?${VI}&report=analysis&format=xlsx&all=true`,
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(xl.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['VI-A', 'VI-B']);
    const texts: string[] = [];
    wb.worksheets[0]!.eachRow((row) => row.eachCell((c) => texts.push(String(c.value))));
    expect(texts).toContain('Analysis');
  });

  it('a copy for another class leaves out what it does not have; the bin and restoring with a new name', async () => {
    const copy = await call(office, 'POST', `/exams/schemes/${ids.reg!}/copy`, {
      name: 'VII Register',
      classIds: [cls.VII],
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json().dropped).toEqual(
      expect.arrayContaining(['Sanskrit (from THIRD LANGUAGE)', 'French (from THIRD LANGUAGE)']),
    );
    expect(copy.json().def.subjects.map((x: { key: string }) => x.key)).toEqual(['ENG', 'MAT']);
    ids.copy = copy.json().id;
    expect((await call(office, 'DELETE', `/exams/schemes/${ids.copy!}`)).statusCode).toBe(200);
    const bin = (await call(office, 'GET', '/exams/schemes/deleted')).json().data;
    expect(bin.map((x: { name: string }) => x.name)).toContain('VII Register');
    // a deleted register's name may be used again; restoring it then needs a new name
    const again = await call(office, 'POST', `/exams/schemes/${ids.reg!}/copy`, {
      name: 'VII Register',
      classIds: [cls.VII],
    });
    expect(again.statusCode).toBe(201);
    expect((await call(office, 'POST', `/exams/schemes/${ids.copy!}/restore`, {})).statusCode).toBe(
      409,
    );
    const back = await call(office, 'POST', `/exams/schemes/${ids.copy!}/restore`, {
      name: 'VII Register (old)',
    });
    expect(back.json()).toMatchObject({ name: 'VII Register (old)', status: 'draft' });
  });

  it('locked: a save makes the next version; versions; a version as a new register; unlock', async () => {
    expect((await call(office, 'POST', `/exams/schemes/${ids.reg!}/lock`)).json().status).toBe(
      'locked',
    );
    expect((await call(office, 'DELETE', `/exams/schemes/${ids.reg!}`)).statusCode).toBe(409);
    const saved = await call(office, 'PUT', `/exams/schemes/${ids.reg!}`, {
      name: 'Term Register',
    });
    expect(saved.json()).toMatchObject({ status: 'draft', version: 2 });
    ids.v2 = saved.json().id;
    const versions = (await call(office, 'GET', `/exams/schemes/${ids.reg!}/versions`)).json().data;
    expect(versions.map((x: { version: number; status: string }) => [x.version, x.status])).toEqual(
      [
        [2, 'draft'],
        [1, 'locked'],
      ],
    );
    expect((await call(office, 'POST', `/exams/schemes/${ids.reg!}/unlock`)).statusCode).toBe(409);
    const restored = await call(office, 'POST', `/exams/schemes/${ids.reg!}/restore-version`, {
      name: 'Term Register v1 copy',
    });
    expect(restored.json()).toMatchObject({
      version: 1,
      status: 'draft',
      name: 'Term Register v1 copy',
    });
    expect((await call(office, 'DELETE', `/exams/schemes/${ids.v2!}`)).statusCode).toBe(200);
    expect((await call(office, 'POST', `/exams/schemes/${ids.reg!}/unlock`)).json().status).toBe(
      'draft',
    );
  });

  it('rights per register: given Run, a teacher runs it; Assign passes on only what one holds; the Rights report', async () => {
    const seen = (u: SeededUser) =>
      call(u, 'GET', '/exams/schemes').then((r) =>
        (r.json().data as Array<{ id: string }>).map((x) => x.id),
      );
    expect(await seen(t.t1!)).not.toContain(ids.reg);
    const run = `/exams/schemes/${ids.reg!}/register?classSectionId=${section['VI-B']!}`;
    expect((await call(t.t1!, 'GET', run)).statusCode).toBe(403);
    const give = await call(office, 'PUT', `/exams/schemes/${ids.reg!}/access`, {
      rows: [
        { userId: t.t1!.id, run: true, edit: false, delete: false, assign: false },
        { userId: t.t2!.id, run: true, edit: false, delete: false, assign: true },
      ],
    });
    expect(give.statusCode).toBe(200);
    expect(await seen(t.t1!)).toContain(ids.reg);
    expect((await call(t.t1!, 'GET', run)).statusCode).toBe(200);
    expect(
      (await call(t.t1!, 'PUT', `/exams/schemes/${ids.reg!}`, { name: 'Mine now' })).statusCode,
    ).toBe(403);
    // t2 passes Run on to t3, but not Edit, and not Assign
    const keep = [
      { userId: t.t1!.id, run: true, edit: false, delete: false, assign: false },
      { userId: t.t2!.id, run: true, edit: false, delete: false, assign: true },
    ];
    const by2 = (row: Record<string, unknown>) =>
      call(t.t2!, 'PUT', `/exams/schemes/${ids.reg!}/access`, {
        rows: [
          ...keep,
          { userId: t.t3!.id, run: true, edit: false, delete: false, assign: false, ...row },
        ],
      });
    expect((await by2({ edit: true })).statusCode).toBe(403);
    expect((await by2({ assign: true })).statusCode).toBe(403);
    expect((await by2({})).statusCode).toBe(200);
    expect((await call(t.t3!, 'GET', run)).statusCode).toBe(200);
    const report = (await call(office, 'GET', '/exams/schemes/rights')).json().data;
    expect(report.filter((x: { chainId: string }) => x.chainId === ids.reg).length).toBe(3);
    expect((await call(t.t1!, 'GET', '/exams/schemes/rights')).statusCode).toBe(403);
    const off = await call(office, 'POST', '/exams/schemes/rights/remove', {
      pairs: [{ chainId: ids.reg, userId: t.t3!.id }],
    });
    expect(off.json()).toEqual({ removed: 1 });
    expect((await call(t.t3!, 'GET', run)).statusCode).toBe(403);
  });
});
