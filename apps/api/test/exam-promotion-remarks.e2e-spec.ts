/**
 * Promotion proposals from term results and remark categories (docs/design/65, part 7). A locked
 * result scheme proposes promote / review (compartment, absent, incomplete) / retain / passed out with
 * next year's section and the card's "Promoted to"; the coordinator sends them to People → Promotions
 * and the cards. Remark categories (a subject's, the class's, list-only, some classes only): the class
 * teacher writes any category, the subject teacher only their subject's; the remarks lock closes it;
 * the card prints them.
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

interface Proposal {
  studentId: string;
  name: string;
  result: string;
  proposal: string;
  reason: string;
  proposedSectionId: string | null;
  proposedCard: string | null;
  decision: { decision: string; toSection: string | null; applied: boolean } | null;
  promotedTo: string | null;
}

describe('promotion proposals and remark categories (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let classTeacher: SeededUser;
  let englishTeacher: SeededUser;
  let examId: string;
  let schemeId: string;
  let nextYearId: string;
  const klass: Record<string, string> = {};
  const section: Record<string, string> = {};
  const next: Record<string, string> = {};
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const cat: Record<string, string> = {};
  const s = stamp('PR');
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
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
      classTeacher = await seedUser(c, school, `${s}-ct`);
      englishTeacher = await seedUser(c, school, `${s}-et`);
      for (const [code, u] of [
        ['PRCT', classTeacher],
        ['PRET', englishTeacher],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Teacher', $2, $3)`,
          [school.id, code, u.id],
        );
    });
    app = await createApp();
    inject = injector(app);
    for (const [code, order] of [
      ['VI', 6],
      ['VII', 7],
    ] as const)
      klass[code] = (
        await call(admin, 'POST', '/academics/classes', {
          code,
          name: `Class ${code}`,
          displayOrder: order,
        })
      ).json().id;
    section.A = (
      await call(admin, 'POST', `/academics/classes/${klass.VI!}/sections`, { name: 'A' })
    ).json().id;
    for (const [code, name] of [
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
    ])
      subject[code!] = (
        await call(admin, 'POST', '/academics/subjects', { code, name, kind: 'scholastic' })
      ).json().id;
    for (const [i, first] of ['Asha', 'Bhanu', 'Chitra', 'Dev'].entries())
      student[first] = (
        await call(admin, 'POST', '/people/students', {
          admissionNo: `${s}-${String(i + 1)}`,
          firstName: first,
          lastName: 'Promo',
          guardians: [],
          enrolment: { classSectionId: section.A, rollNo: i + 1 },
        })
      ).json().id;
    // next year with VI-A and VII-A
    await withMigrator(async (c) => {
      nextYearId = (
        await c.query<{ id: string }>(
          `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
           VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const k of ['VI', 'VII'])
        next[k] = (
          await c.query<{ id: string }>(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
            [school.id, nextYearId, klass[k]],
          )
        ).rows[0]!.id;
    });
    const emp = (await call(admin, 'GET', '/people/employees?size=20')).json().data as Array<{
      id: string;
      employeeCode: string;
    }>;
    const id = (code: string) => emp.find((e) => e.employeeCode === code)!.id;
    for (const [code, kind, subjectId] of [
      ['PRCT', 'class_teacher', undefined],
      ['PRET', 'subject_teacher', subject.ENG],
    ] as const)
      expect(
        (
          await call(admin, 'POST', '/academics/teacher-assignments', {
            employeeId: id(code),
            classSectionId: section.A,
            kind,
            subjectId,
          })
        ).statusCode,
      ).toBe(201);
    const type = (await call(admin, 'POST', '/exams/types', { code: 'TRM', name: 'Term' })).json()
      .id;
    examId = (
      await call(admin, 'POST', '/exams', {
        examTypeId: type,
        code: 'T2',
        name: 'Term 2',
        classes: [{ classId: klass.VI }],
      })
    ).json().id;
    await call(admin, 'PUT', `/exams/${examId}/subjects`, {
      classId: klass.VI,
      subjects: [
        { subjectId: subject.ENG, maxMarks: 100, passMarks: 33 },
        { subjectId: subject.MAT, maxMarks: 100, passMarks: 33 },
      ],
    });
    const marks: Record<string, Record<string, number | null>> = {
      Asha: { ENG: 80, MAT: 90 },
      Bhanu: { ENG: 20, MAT: 70 },
      Chitra: { ENG: 10, MAT: 20 },
      Dev: { ENG: 50, MAT: null },
    };
    for (const sub of ['ENG', 'MAT'])
      expect(
        (
          await call(classTeacher, 'PUT', `/exams/${examId}/marks`, {
            classSectionId: section.A,
            subjectId: subject[sub],
            rows: Object.entries(marks)
              .filter(([, m]) => m[sub] !== null)
              .map(([n, m]) => ({ studentId: student[n], marks: m[sub] })),
          })
        ).statusCode,
      ).toBe(200);
    schemeId = (
      await call(admin, 'POST', '/exams/schemes', {
        name: 'Final result',
        purpose: 'result',
        termCode: 'T2',
        classIds: [klass.VI],
        def: {
          exams: [{ key: 'T2', examId }],
          columns: [{ key: 'T2', label: 'Term (100)', kind: 'raw', exam: 'T2', total: true }],
          result: {
            passPct: 33,
            compartmentUpTo: 1,
            rankBy: 'pct',
            divisions: [{ name: 'First', minPct: 60 }],
          },
        },
      })
    ).json().id;
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  const proposals = async (u = admin) => {
    const r = await call(u, 'GET', `/exams/schemes/${schemeId}/promotion`);
    expect(r.statusCode).toBe(200);
    return r.json() as {
      toYear: { id: string; code: string } | null;
      rows: Proposal[];
      totals: Record<string, number>;
    };
  };
  const of = (rows: Proposal[], first: string) => rows.find((x) => x.name === `${first} Promo`)!;

  it('proposes from the term results: promote, review the compartment and the incomplete, retain', async () => {
    const draft = await call(admin, 'GET', `/exams/schemes/${schemeId}/promotion`);
    expect(draft.json().type).toBe('exams.scheme_not_locked');
    expect((await call(admin, 'POST', `/exams/schemes/${schemeId}/lock`)).statusCode).toBe(201);
    expect((await call(admin, 'POST', `/exams/schemes/${schemeId}/compute`)).statusCode).toBe(201);
    const p = await proposals();
    expect(p.toYear).toEqual({ id: nextYearId, code: '2027-28' });
    expect(p.totals).toEqual({ promote: 1, review: 2, retain: 1, graduate: 0 });
    expect(of(p.rows, 'Asha')).toMatchObject({
      result: 'pass',
      proposal: 'promote',
      reason: 'Passed · First',
      proposedSectionId: next.VII,
      proposedCard: 'Class VII',
    });
    expect(of(p.rows, 'Bhanu')).toMatchObject({
      result: 'compartment',
      proposal: 'review',
      proposedSectionId: null,
      proposedCard: 'Class VII, subject to compartment',
    });
    expect(of(p.rows, 'Bhanu').reason).toContain('Compartment in');
    expect(of(p.rows, 'Chitra')).toMatchObject({
      result: 'fail',
      proposal: 'retain',
      proposedSectionId: next.VI,
      proposedCard: 'Retained in Class VI',
    });
    expect(of(p.rows, 'Dev')).toMatchObject({ proposal: 'review', reason: 'Marks incomplete' });
  });

  it('sends the decisions to People → Promotions and fills the cards', async () => {
    const p = await proposals();
    const rows = p.rows.map((x) => ({
      studentId: x.studentId,
      decision: x.proposal,
      toClassSectionId: x.proposedSectionId,
      promotedTo: x.proposedCard,
    }));
    // the class teacher reads the proposals but does not decide promotion
    expect((await proposals(classTeacher)).rows).toHaveLength(4);
    expect(
      (
        await call(classTeacher, 'POST', `/exams/schemes/${schemeId}/promotion`, {
          toYearId: nextYearId,
          rows,
        })
      ).statusCode,
    ).toBe(403);
    const missing = await call(admin, 'POST', `/exams/schemes/${schemeId}/promotion`, {
      toYearId: nextYearId,
      rows: [{ studentId: student.Asha, decision: 'promote', toClassSectionId: null }],
    });
    expect(missing.json().type).toBe('promotion.section_required');
    const sent = await call(admin, 'POST', `/exams/schemes/${schemeId}/promotion`, {
      toYearId: nextYearId,
      rows,
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ decisions: 2, cards: 3 });
    const after = await proposals();
    expect(of(after.rows, 'Asha')).toMatchObject({
      decision: { decision: 'promote', toSection: 'VII-A', applied: false },
      promotedTo: 'Class VII',
    });
    expect(of(after.rows, 'Bhanu')).toMatchObject({
      decision: null,
      promotedTo: 'Class VII, subject to compartment',
    });
    expect(of(after.rows, 'Dev').promotedTo).toBeNull();
    const people = (
      await call(admin, 'GET', `/people/promotions?classId=${klass.VI!}&toYearId=${nextYearId}`)
    ).json();
    const list = (Array.isArray(people) ? people : people.data) as Array<{
      studentId: string;
      decision: string | null;
      toSection: string | null;
    }>;
    expect(list.find((x) => x.studentId === student.Chitra)).toMatchObject({
      decision: 'retain',
      toSection: 'VI-A',
    });
    // a card's text cleared: the remark row that only held it goes
    await call(admin, 'POST', `/exams/schemes/${schemeId}/promotion`, {
      rows: [{ studentId: student.Bhanu, decision: 'review', promotedTo: null }],
    });
    expect(of((await proposals()).rows, 'Bhanu').promotedTo).toBeNull();
  });

  it('keeps remark categories: a subject’s, list-only, for some classes; offered from the bank', async () => {
    for (const body of [
      { code: 'ENG', name: 'English', subjectId: subject.ENG, sortOrder: 1 },
      { code: 'GEN', name: 'General', freeText: false, sortOrder: 2 },
      { code: 'SEN', name: 'Senior note', classIds: [klass.VII], sortOrder: 3 },
    ])
      expect((await call(admin, 'PUT', '/exams/remark-categories', body)).statusCode).toBe(200);
    const list = (await call(admin, 'GET', '/exams/remark-categories')).json().data as Array<{
      id: string;
      code: string;
      subjectName: string | null;
    }>;
    for (const k of list) cat[k.code] = k.id;
    expect(list.find((k) => k.code === 'ENG')!.subjectName).toBe('English');
    expect(
      (
        await call(admin, 'PUT', '/exams/remark-bank', {
          entries: [
            { code: 'GEN1', text: 'A helpful classmate.', categoryCode: 'GEN' },
            { code: 'ENG1', text: 'Reads with expression.', categoryCode: 'eng' },
            { code: 'GOOD', text: 'Good work this term.' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const bank = (await call(admin, 'GET', '/exams/remark-bank')).json().data as Array<{
      code: string;
      categoryCode: string | null;
    }>;
    expect(bank.find((b) => b.code === 'ENG1')!.categoryCode).toBe('ENG');
    // the general remark's list (the exam register) keeps the remarks without a category
    const reg = (
      await call(classTeacher, 'GET', `/exams/${examId}/register?classSectionId=${section.A!}`)
    ).json();
    expect(reg.remarkBank.map((b: { code: string }) => b.code)).toEqual(['GOOD']);
  });

  it('lets the class teacher write any category and the subject teacher only theirs', async () => {
    const sheet = (u: SeededUser) =>
      call(u, 'GET', `/exams/${examId}/remark-items?classSectionId=${section.A!}`);
    const ct = (await sheet(classTeacher)).json();
    expect(ct.categories.map((k: { code: string }) => k.code)).toEqual(['ENG', 'GEN']);
    expect(ct.categories.map((k: { may: boolean }) => k.may)).toEqual([true, true]);
    expect(ct.categories[1].bank).toEqual([{ code: 'GEN1', text: 'A helpful classmate.' }]);
    const et = (await sheet(englishTeacher)).json();
    expect(et.categories.map((k: { may: boolean }) => k.may)).toEqual([true, false]);
    const put = (u: SeededUser, rows: unknown[]) =>
      call(u, 'PUT', `/exams/${examId}/remark-items`, { classSectionId: section.A, rows });
    const eng = await put(englishTeacher, [
      { studentId: student.Asha, categoryId: cat.ENG, text: 'Reads with expression.' },
    ]);
    expect(eng.statusCode).toBe(200);
    expect(eng.json().changed).toBe(1);
    const notHers = await put(englishTeacher, [
      { studentId: student.Asha, categoryId: cat.GEN, bankCode: 'GEN1', text: null },
    ]);
    expect(notHers.statusCode).toBe(403);
    expect(notHers.json().type).toBe('exams.not_assigned');
    const free = await put(classTeacher, [
      { studentId: student.Asha, categoryId: cat.GEN, text: 'Something else' },
    ]);
    expect(free.json().type).toBe('exams.remark_list_only');
    expect(
      (
        await put(classTeacher, [
          { studentId: student.Asha, categoryId: cat.GEN, bankCode: 'GEN1', text: null },
          { studentId: student.Bhanu, categoryId: cat.GEN, bankCode: 'GEN1', text: null },
        ])
      ).json().changed,
    ).toBe(2);
    expect(
      (
        await put(classTeacher, [{ studentId: student.Asha, categoryId: cat.SEN, text: 'x' }])
      ).json().type,
    ).toBe('exams.remark_category_not_for_class');
    // emptied: removed
    expect(
      (
        await put(classTeacher, [{ studentId: student.Bhanu, categoryId: cat.GEN, text: null }])
      ).json().changed,
    ).toBe(1);
    const rows = (await sheet(classTeacher)).json().rows as Array<{
      studentId: string;
      items: Record<string, { text: string; bankCode: string | null }>;
    }>;
    expect(rows.find((r) => r.studentId === student.Asha)!.items[cat.GEN!]).toEqual({
      text: 'A helpful classmate.',
      bankCode: 'GEN1',
    });
    expect(rows.find((r) => r.studentId === student.Bhanu)!.items).toEqual({});
  });

  it('closes remarks with the lock and prints them, and the promotion, on the card', async () => {
    expect(
      (
        await call(admin, 'PUT', `/exams/${examId}/class-locks`, {
          classId: klass.VI,
          remarks: true,
        })
      ).statusCode,
    ).toBe(200);
    const locked = await call(classTeacher, 'PUT', `/exams/${examId}/remark-items`, {
      classSectionId: section.A,
      rows: [{ studentId: student.Dev, categoryId: cat.GEN, bankCode: 'GEN1', text: null }],
    });
    expect(locked.json().type).toBe('exams.entry_locked');
    const tpl = (await call(admin, 'POST', '/exams/report-cards/templates/dps')).json()
      .data as Array<{
      id: string;
      code: string;
    }>;
    const middle = tpl.find((t) => t.code === 'dps_vi_viii')!.id;
    const rel = (
      await call(admin, 'POST', '/exams/report-cards/releases', {
        termCode: 'T2',
        name: 'Final',
        examIds: [examId],
      })
    ).json().id;
    const card = async (who: string) =>
      (
        await call(admin, 'POST', `/exams/report-cards/templates/${middle}/preview`, {
          releaseId: rel,
          studentId: student[who],
        })
      ).json().html as string;
    const asha = await card('Asha');
    expect(asha).toContain('<strong>English:</strong> Reads with expression.');
    expect(asha).toContain('<strong>General:</strong> A helpful classmate.');
    expect(asha).toContain('<div class="k">Promoted to</div><div class="v">Class VII</div>');
    expect(await card('Chitra')).toContain(
      '<div class="k">Promotion</div><div class="v">Retained in Class VI</div>',
    );
  });
});
