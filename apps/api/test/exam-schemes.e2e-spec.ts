/**
 * Mark schemes and registers (docs/design/65, part 3): a scheme from the ready-made DPS Noida VI-VIII
 * formula (PT 15 + SE 5 + term 80) with its exams mapped, tried on a section as a draft, locked as the
 * class's term 1 result and worked out into term results (codes, compartment, competition ranks);
 * another result scheme for the same class and term is refused; a new version replaces the old one;
 * the register by roll and as a merit list, in Excel and PDF.
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

describe('mark schemes and registers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let classId: string;
  const section: Record<string, string> = {};
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const exam: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const s = stamp('MS');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const map = () => ({
    MT1: exam.MT1,
    MT2: exam.MT2,
    SE1: exam.SE1,
    SE2: exam.SE2,
    TERM: exam.T1,
  });

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
      ] as const
    ).entries())
      student[first] = (
        await call(admin, 'POST', '/people/students', {
          admissionNo: `${s}-${String(i + 1)}`,
          firstName: first,
          lastName: 'Scheme',
          guardians: [],
          enrolment: { classSectionId: section[sec], rollNo: i + 1 },
        })
      ).json().id;
    const scales = (await call(admin, 'POST', '/exams/grade-scales/presets')).json().data as Array<{
      id: string;
      code: string;
    }>;
    ids.cbse = scales.find((x) => x.code === 'CBSE_8POINT')!.id;
    const type = (await call(admin, 'POST', '/exams/types', { code: 'UT', name: 'Tests' })).json()
      .id;
    for (const [code, max] of [
      ['MT1', 20],
      ['MT2', 20],
      ['SE1', 5],
      ['SE2', 5],
      ['T1', 80],
    ] as const) {
      const e = await call(admin, 'POST', '/exams', {
        examTypeId: type,
        code,
        name: code,
        classes: [{ classId, gradeScaleId: ids.cbse }],
      });
      exam[code] = e.json().id;
      await call(admin, 'PUT', `/exams/${exam[code]!}/subjects`, {
        classId,
        subjects: [
          { subjectId: subject.ENG, maxMarks: max },
          { subjectId: subject.MAT, maxMarks: max },
        ],
      });
    }
    // marks: [MT1, MT2, SE1, SE2, T1] per subject
    const marks: Record<string, Record<string, Array<number | string>>> = {
      Asha: { ENG: [18, 16, 4, 5, 62], MAT: [20, 20, 5, 5, 80] },
      Bhanu: { ENG: ['ML', 10, 5, 5, 40], MAT: [10, 10, 3, 3, 10] },
      Chitra: { ENG: [20, 20, 5, 5, 70], MAT: [20, 20, 5, 5, 79] },
      Dev: { ENG: [16, 16, 4, 4, 60], MAT: [16, 16, 4, 4, 60] },
    };
    for (const [i, code] of ['MT1', 'MT2', 'SE1', 'SE2', 'T1'].entries())
      for (const sub of ['ENG', 'MAT'])
        for (const sec of ['A', 'B']) {
          const rows = Object.entries(marks)
            .filter(([name]) => (name === 'Dev' ? 'B' : 'A') === sec)
            .map(([name, m]) => {
              const v = m[sub]![i]!;
              return typeof v === 'number'
                ? { studentId: student[name], marks: v }
                : { studentId: student[name], code: v };
            });
          const r = await call(clerk, 'PUT', `/exams/${exam[code]!}/marks`, {
            classSectionId: section[sec],
            subjectId: subject[sub],
            rows,
          });
          expect(r.statusCode).toBe(200);
        }
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it('offers the ready-made schemes; one needs every exam mapped', async () => {
    const p = (await call(admin, 'GET', '/exams/schemes/presets')).json().data as Array<{
      code: string;
      examKeys: Array<{ key: string }>;
    }>;
    expect(p.map((x) => x.code)).toEqual(['DPS_VI_VIII', 'DPS_IX', 'DPS_X', 'DPS_XI', 'DPS_XII']);
    const short = await call(admin, 'POST', '/exams/schemes', {
      name: 'Term 1 result',
      purpose: 'result',
      termCode: 't1',
      classIds: [classId],
      preset: 'DPS_VI_VIII',
      examMap: { MT1: exam.MT1 },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().detail).toContain('Choose the exam for MT2');
    const ok = await call(admin, 'POST', '/exams/schemes', {
      name: 'Term 1 result',
      purpose: 'result',
      termCode: 't1',
      classIds: [classId],
      preset: 'DPS_VI_VIII',
      examMap: map(),
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'draft', version: 1, termCode: 'T1', problems: [] });
    expect(ok.json().exams.find((x: { key: string }) => x.key === 'TERM')).toMatchObject({
      code: 'T1',
    });
    ids.v1 = ok.json().id;
  });

  it('a draft is tried on a section: the columns, totals, codes and ranks', async () => {
    const r = await call(
      admin,
      'GET',
      `/exams/schemes/${ids.v1!}/register?classSectionId=${section.A}`,
    );
    expect(r.statusCode).toBe(200);
    const reg = r.json();
    expect(reg.columns.map((x: { label: string }) => x.label)).toEqual([
      'Periodic test (15)',
      'Subject enrichment (5)',
      'Term exam (80)',
      'Marks obtained (100)',
    ]);
    const by = Object.fromEntries(
      (reg.rows as Array<{ name: string }>).map((x) => [x.name, x as unknown]),
    ) as Record<
      string,
      {
        total: number;
        result: string;
        rankInSection: number;
        subjects: Array<{ code: string; total: number; values: Record<string, { v: number }> }>;
      }
    >;
    expect(by['Asha Scheme']!.subjects.find((x) => x.code === 'ENG')!.total).toBe(79);
    expect(by['Asha Scheme']).toMatchObject({ total: 179, result: 'pass', rankInSection: 2 });
    // ML in MT1: the PT is MT2's half of 15; 7.5 + 5 + 40 = 52.5, half up
    const bEng = by['Bhanu Scheme']!.subjects.find((x) => x.code === 'ENG')!;
    expect(bEng.values.PT!.v).toBe(7.5);
    expect(bEng.total).toBe(53);
    expect(by['Bhanu Scheme']).toMatchObject({ result: 'compartment', rankInSection: 3 });
    expect(by['Chitra Scheme']).toMatchObject({ total: 189, rankInSection: 1 });
    // a draft makes no term results
    expect((await call(admin, 'POST', `/exams/schemes/${ids.v1!}/compute`)).statusCode).toBe(409);
  });

  it('locks as the class term 1 result and keeps every student’s term result', async () => {
    const lock = await call(admin, 'POST', `/exams/schemes/${ids.v1!}/lock`);
    expect(lock.json()).toMatchObject({ status: 'locked' });
    expect(
      (await call(admin, 'PUT', `/exams/schemes/${ids.v1!}`, { name: 'Changed' })).statusCode,
    ).toBe(409);
    const done = await call(admin, 'POST', `/exams/schemes/${ids.v1!}/compute`);
    expect(done.statusCode).toBe(201);
    expect(done.json()).toMatchObject({ results: 4, counts: { pass: 3, compartment: 1 } });
    const tr = await withMigrator(
      async (c) =>
        (
          await c.query<{
            student_id: string;
            total: string;
            rank_in_class: number;
            rank_in_section: number;
            result: string;
          }>(
            `SELECT student_id::text, total::text, rank_in_class, rank_in_section, result FROM term_results WHERE scheme_id = $1`,
            [ids.v1],
          )
        ).rows,
    );
    const of = (name: string) => tr.find((x) => x.student_id === student[name])!;
    expect(of('Chitra')).toMatchObject({ total: '189.00', rank_in_class: 1 });
    expect(of('Dev')).toMatchObject({ total: '152.00', rank_in_class: 3, rank_in_section: 1 });
    expect(of('Bhanu')).toMatchObject({ result: 'compartment', rank_in_class: 4 });
  });

  it('refuses a second result scheme for the class and term; a new version replaces the first', async () => {
    const other = await call(admin, 'POST', '/exams/schemes', {
      name: 'Another term 1',
      purpose: 'result',
      termCode: 'T1',
      classIds: [classId],
      preset: 'DPS_VI_VIII',
      examMap: map(),
    });
    const clash = await call(admin, 'POST', `/exams/schemes/${other.json().id as string}/lock`);
    expect(clash.statusCode).toBe(409);
    expect(clash.json().detail).toContain('already has "Term 1 result"');
    const v2 = await call(admin, 'POST', `/exams/schemes/${ids.v1!}/new-version`);
    expect(v2.json()).toMatchObject({ status: 'draft', version: 2, previousId: ids.v1 });
    ids.v2 = v2.json().id;
    // the pass mark raised to 40: Bhanu's English (53) still passes, his Maths (21) fails
    const def = v2.json().def;
    const up = await call(admin, 'PUT', `/exams/schemes/${ids.v2!}`, {
      def: { ...def, result: { ...def.result, passPct: 40, compartmentUpTo: 0 } },
    });
    expect(up.statusCode).toBe(200);
    expect((await call(admin, 'POST', `/exams/schemes/${ids.v2!}/lock`)).json().status).toBe(
      'locked',
    );
    expect((await call(admin, 'GET', `/exams/schemes/${ids.v1!}`)).json()).toMatchObject({
      status: 'superseded',
      results: 0,
    });
    const done = (await call(admin, 'POST', `/exams/schemes/${ids.v2!}/compute`)).json();
    expect(done.counts).toEqual({ pass: 3, fail: 1 });
  });

  it('the register by roll and as a merit list, in Excel and PDF; a free register needs no term', async () => {
    const merit = (
      await call(admin, 'GET', `/exams/schemes/${ids.v2!}/register?classId=${classId}&view=merit`)
    ).json();
    expect(
      merit.rows.map((x: { name: string; rankInClass: number }) => [x.name, x.rankInClass]),
    ).toEqual([
      ['Chitra Scheme', 1],
      ['Asha Scheme', 2],
      ['Dev Scheme', 3],
      ['Bhanu Scheme', 4],
    ]);
    for (const [format, magic] of [
      ['xlsx', 'PK'],
      ['pdf', '%PDF'],
    ] as const) {
      const f = await call(
        admin,
        'GET',
        `/exams/schemes/${ids.v2!}/register?classSectionId=${section.A}&format=${format}`,
      );
      expect(f.statusCode).toBe(200);
      expect(
        Buffer.from(f.json().base64 as string, 'base64')
          .subarray(0, magic.length)
          .toString(),
      ).toBe(magic);
    }
    const free = await call(admin, 'POST', '/exams/schemes', {
      name: 'Best of the Monday tests',
      purpose: 'register',
      classIds: [classId],
      def: {
        exams: [
          { key: 'MT1', examId: exam.MT1 },
          { key: 'MT2', examId: exam.MT2 },
        ],
        columns: [
          { key: 'MT1', label: 'MT1', kind: 'raw', exam: 'MT1' },
          { key: 'MT2', label: 'MT2', kind: 'raw', exam: 'MT2' },
          {
            key: 'BEST',
            label: 'Best (20)',
            kind: 'average',
            of: ['MT1', 'MT2'],
            best: 1,
            scale: 20,
            total: true,
          },
        ],
        result: { passPct: 33, compartmentUpTo: 0, rankBy: 'pct' },
      },
    });
    expect(free.statusCode).toBe(201);
    const reg = (
      await call(
        clerk,
        'GET',
        `/exams/schemes/${free.json().id as string}/register?classSectionId=${section.A}`,
      )
    ).json();
    const asha = reg.rows.find((x: { name: string }) => x.name === 'Asha Scheme');
    expect(asha.subjects.find((x: { code: string }) => x.code === 'ENG').total).toBe(18);
    // the clerk reads registers but does not build schemes
    expect(
      (
        await call(clerk, 'POST', '/exams/schemes', {
          name: 'x',
          purpose: 'register',
          classIds: [classId],
          preset: 'DPS_VI_VIII',
          examMap: map(),
        })
      ).statusCode,
    ).toBe(403);
  });

  // ---- part 4: the DPS Noida cards ------------------------------------------------------------------
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('installs the DPS Noida cards; signatures by role with images, the seal', async () => {
    const t = await call(admin, 'POST', '/exams/report-cards/templates/dps');
    expect(t.statusCode).toBe(201);
    const dps = (t.json().data as Array<{ id: string; code: string; band: string }>).filter((x) =>
      x.code.startsWith('dps_'),
    );
    expect(dps.map((x) => x.code)).toEqual(
      expect.arrayContaining([
        'dps_i_ii',
        'dps_iii_v',
        'dps_vi_viii',
        'dps_ix',
        'dps_x',
        'dps_xi',
        'dps_xii',
      ]),
    );
    ids.dpsMiddle = dps.find((x) => x.code === 'dps_vi_viii')!.id;
    const url = '/exams/report-cards/signatures';
    expect(
      (
        await call(admin, 'POST', url, {
          role: 'principal',
          label: 'Principal',
          image: {
            contentType: 'image/png',
            base64: Buffer.from('not a png at all').toString('base64'),
          },
        })
      ).statusCode,
    ).toBe(400);
    const p = await call(admin, 'POST', url, {
      role: 'principal',
      label: 'Principal',
      personName: 'R. Kapoor',
      image: { contentType: 'image/png', base64: PNG },
    });
    expect(p.statusCode).toBe(201);
    await call(admin, 'POST', url, {
      role: 'seal',
      label: 'School seal',
      image: { contentType: 'image/png', base64: PNG },
    });
    // the class's own coordinator before a general one
    await call(admin, 'POST', url, { role: 'coordinator', label: 'Coordinator' });
    await call(admin, 'POST', url, {
      role: 'coordinator',
      label: 'Coordinator (Middle wing)',
      classIds: [classId],
    });
    const list = (await call(admin, 'GET', url)).json().data as Array<{
      id: string;
      role: string;
      hasImage: boolean;
    }>;
    expect(
      list
        .filter((x) => x.hasImage)
        .map((x) => x.role)
        .sort(),
    ).toEqual(['principal', 'seal']);
    const img = await call(
      admin,
      'GET',
      `${url}/${list.find((x) => x.role === 'principal')!.id}/image`,
    );
    expect(img.json()).toMatchObject({ contentType: 'image/png', base64: PNG });
    expect((await call(clerk, 'POST', url, { role: 'seal', label: 'Mine' })).statusCode).toBe(403);
  });

  it('the class teacher writes what the student took part in and the class promoted to', async () => {
    const r = await call(clerk, 'PUT', `/exams/${exam.T1!}/remarks`, {
      classSectionId: section.A,
      rows: [
        {
          studentId: student.Asha,
          remark: 'Works steadily and helps others.',
          participation: 'Inter-house debate',
          promotedTo: 'Class VII',
        },
      ],
    });
    expect(r.statusCode).toBe(200);
    const reg = (
      await call(clerk, 'GET', `/exams/${exam.T1!}/register?classSectionId=${section.A}`)
    ).json();
    expect(reg.rows.find((x: { name: string }) => x.name === 'Asha Scheme')).toMatchObject({
      participation: 'Inter-house debate',
      promotedTo: 'Class VII',
    });
  });

  it('a release takes a template per class; the card shows the term result, signatures and promotion', async () => {
    expect(
      (
        await call(admin, 'POST', '/exams/report-cards/releases', {
          termCode: 'T1X',
          name: 'Wrong key',
          examIds: [exam.T1],
          templates: { 'class-6': ids.dpsMiddle },
        })
      ).statusCode,
    ).toBe(400);
    const rel = await call(admin, 'POST', '/exams/report-cards/releases', {
      termCode: 'T1',
      name: 'Term 1',
      examIds: [exam.MT1, exam.MT2, exam.SE1, exam.SE2, exam.T1],
      templates: { [`class_${classId}`]: ids.dpsMiddle },
    });
    expect(rel.statusCode).toBe(201);
    ids.release = rel.json().id;
    const pv = await call(
      admin,
      'POST',
      `/exams/report-cards/templates/${ids.dpsMiddle!}/preview`,
      {
        releaseId: ids.release,
        studentId: student.Asha,
      },
    );
    expect(pv.statusCode).toBe(201);
    const html = pv.json().html as string;
    expect(html).toContain('Term 1 result');
    expect(html).toContain('Periodic test (15)');
    // English 79 and Maths 100 of the scheme's term result
    expect(html).toContain('<td class="num">79</td>');
    expect(html).toContain('179 / 200');
    expect(html).toContain('Promoted to');
    expect(html).toContain('Class VII');
    expect(html).toContain(`data:image/png;base64,${PNG}`);
    expect(html).toContain('R. Kapoor');
    expect(html).toContain('Coordinator (Middle wing)');
    expect(html).toContain(
      'Periodic test (15) + Subject enrichment (5) + Term exam (80) = Marks obtained (100)',
    );
    // the batch finds the class's template
    const batch = await call(admin, 'POST', `/exams/report-cards/releases/${ids.release!}/render`, {
      classSectionId: section.A,
    });
    expect(batch.statusCode).toBe(201);
  });
});
