/**
 * Sprint 18: board result import (both CBSE file shapes, pupil matching), report-card modes for the
 * secondary band, library sale / digital / stock verification, results analytics, and the archive
 * function of the partitioning review.
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

describe('all bands and boards, library completion, partitioning (e2e, Sprint 18)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let s: string;
  let classId: string;
  let sectionId: string;
  let studentId: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    s = stamp('S18');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'X', name: 'Class X', displayOrder: 10 },
    });
    classId = cls.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-X1`,
        firstName: 'Isha',
        lastName: 'Eighteen',
        guardians: [
          {
            guardian: { firstName: 'Ravi', lastName: 'Eighteen', mobile: '9876518002' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionId, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876518002' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it('imports a CBSE result file: matches by board roll number, else by name; the compact shape too; analysis and export', async () => {
    await withMigrator((c) =>
      c.query(`UPDATE enrolments SET board_roll_no = '26101777' WHERE student_id = $1`, [
        studentId,
      ]),
    );
    const v = await inject({
      method: 'POST',
      url: '/exams/board-results/imports/validate',
      headers: h(),
      json: {
        classLabel: 'X',
        fileName: 'cbse.csv',
        csv: 'ROLL NO,NAME,SUB CODE,SUB NAME,THEORY,PRACTICAL,TOTAL,GRADE,RESULT\n26101777,ISHA EIGHTEEN,041,MATHEMATICS,72,20,92,A1,PASS\n26101777,ISHA EIGHTEEN,184,ENGLISH,68,18,86,A2,PASS\n26101999,NOBODY HERE,041,MATHEMATICS,30,10,40,D,PASS\n',
      },
    });
    expect(v.statusCode).toBe(201);
    expect(v.json()).toMatchObject({ status: 'validated', okRows: 3, unmatchedRows: 1 });
    const c1 = await inject({
      method: 'POST',
      url: `/exams/board-results/imports/${v.json().id}/commit`,
      headers: h(),
    });
    expect(c1.json().status).toBe('committed');
    const compact = await inject({
      method: 'POST',
      url: '/exams/board-results/imports/validate',
      headers: h(),
      json: {
        classLabel: 'X',
        csv: 'ROLL NO,NAME,SUB1,MRK1,GRD1,SUB2,MRK2,GRD2,RESULT\n26101777,ISHA EIGHTEEN,086 SCIENCE,81,A2,087 SOCIAL SCIENCE,77,B1,PASS\n',
      },
    });
    expect(compact.json()).toMatchObject({ status: 'validated', okRows: 2, unmatchedRows: 0 });
    await inject({
      method: 'POST',
      url: `/exams/board-results/imports/${compact.json().id}/commit`,
      headers: h(),
    });
    const list = await inject({
      method: 'GET',
      url: '/exams/board-results?classLabel=X',
      headers: h(),
    });
    expect(list.json().page.total).toBe(5);
    const mine = list
      .json()
      .data.filter((r: { student_id: string | null }) => r.student_id === studentId);
    expect(mine).toHaveLength(4);
    const maths = list
      .json()
      .analysis.find((a: { subject_code: string }) => a.subject_code === '041');
    expect(maths).toMatchObject({ candidates: 2, unlinked: 1 });
    const bad = await inject({
      method: 'POST',
      url: '/exams/board-results/imports/validate',
      headers: h(),
      json: { classLabel: 'X', csv: 'NAME,MARKS\nx,1\n' },
    });
    expect(bad.statusCode).toBe(400);
    const exp = await inject({
      method: 'POST',
      url: '/reports/exports',
      headers: h(),
      json: { dataset: 'board_results', format: 'xlsx', params: { classLabel: 'X' } },
    });
    expect(exp.statusCode).toBe(201);
  });

  it('renders the secondary band with component columns scaled from the exams', async () => {
    const type = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(),
      json: { code: 'ANN', name: 'Annual' },
    });
    const scale = await inject({
      method: 'PUT',
      url: '/exams/grade-scales',
      headers: h(),
      json: {
        code: 'CBSE8',
        name: 'CBSE',
        bands: [
          { minPct: 91, maxPct: 100, grade: 'A1' },
          { minPct: 81, maxPct: 90.99, grade: 'A2' },
          { minPct: 0, maxPct: 80.99, grade: 'B' },
        ],
      },
    });
    const sub = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h(),
      json: { code: 'MAT', name: 'Mathematics' },
    });
    const mk = async (code: string) => {
      const e = await inject({
        method: 'POST',
        url: '/exams',
        headers: h(),
        json: {
          examTypeId: type.json().id,
          code,
          name: code,
          classes: [{ classId, gradeScaleId: scale.json().id }],
        },
      });
      await inject({
        method: 'PUT',
        url: `/exams/${e.json().id}/subjects`,
        headers: h(),
        json: {
          classId,
          subjects: [
            { subjectId: sub.json().id, maxMarks: code === 'ANNUAL' ? 80 : 40, passMarks: 13 },
          ],
        },
      });
      return e.json().id as string;
    };
    const pt1 = await mk('PT1');
    const annual = await mk('ANNUAL');
    await withMigrator((c) =>
      c.query(
        `INSERT INTO mark_entries (school_id, exam_subject_id, student_id, marks)
         SELECT $1, es.id, $2, CASE WHEN es.exam_id = $3 THEN 32 ELSE 64 END FROM exam_subjects es WHERE es.exam_id IN ($3, $4)`,
        [school.id, studentId, pt1, annual],
      ),
    );
    for (const id of [pt1, annual])
      await inject({ method: 'POST', url: `/exams/${id}/results/compute`, headers: h() });
    const defaults = await inject({
      method: 'POST',
      url: '/exams/report-cards/templates/defaults',
      headers: h(),
    });
    const secondary = defaults.json().data.find((t: { band: string }) => t.band === 'secondary');
    const rel = await inject({
      method: 'POST',
      url: '/exams/report-cards/releases',
      headers: h(),
      json: { termCode: 'FINAL', name: 'Final', examIds: [pt1, annual] },
    });
    const html = (
      await inject({
        method: 'POST',
        url: `/exams/report-cards/templates/${secondary.id}/preview`,
        headers: h(),
        json: { releaseId: rel.json().id, studentId },
      })
    ).json().html as string;
    expect(html).toContain('Periodic test (10)');
    expect(html).toContain('Annual exam (80)');
    // PT1 32/40 → 8 of 10; annual 64/80 → 64 of 80; total 72 / 90 → 80.0% → grade B
    expect(html).toMatch(/>8<\/td>/);
    expect(html).toMatch(/>64<\/td>/);
    expect(html).toContain('72.0 / 90');
    const hpc = (
      await inject({
        method: 'POST',
        url: `/exams/report-cards/templates/${defaults.json().data.find((t: { band: string }) => t.band === 'primary').id}/preview`,
        headers: h(),
        json: { band: 'primary' },
      })
    ).json().html as string;
    expect(hpc).toContain('What it means');
  });

  it('library: sale of a withdrawn copy, digital items by audience, and a stock check that finds and misses', async () => {
    const title = await inject({
      method: 'POST',
      url: '/masters/library_titles/rows',
      headers: h(),
      json: { values: { code: 'T18', title: 'Wonder', author: 'R. J. Palacio' } },
    });
    const acc = await inject({
      method: 'POST',
      url: '/library/copies',
      headers: h(),
      json: { titleId: title.json().id, accessionNos: [`${s}-1`, `${s}-2`, `${s}-3`] },
    });
    expect(acc.json().created).toBe(3);
    const copyId = (
      await inject({
        method: 'GET',
        url: `/library/titles/${title.json().id}/copies`,
        headers: h(),
      })
    )
      .json()
      .data.find((c: { accessionNo: string }) => c.accessionNo === `${s}-3`).id;
    const notYet = await inject({
      method: 'POST',
      url: '/library/sales',
      headers: h(),
      json: { accessionNo: `${s}-3`, buyerKind: 'other', buyerName: 'Book drive', price: 50 },
    });
    expect(notYet.statusCode).toBe(201); // available copies may be sold when not reference
    await inject({
      method: 'PUT',
      url: `/library/copies/${copyId}/status`,
      headers: h(),
      json: { status: 'withdrawn' },
    }).then((r) => expect(r.statusCode).toBe(409)); // already sold
    const sales = await inject({ method: 'GET', url: '/library/sales', headers: h() });
    expect(sales.json().data[0]).toMatchObject({ accessionNo: `${s}-3`, price: '50.00' });
    // digital library: staff see everything, families only everyone/students
    await inject({
      method: 'POST',
      url: '/masters/library_digital_items/rows',
      headers: h(),
      json: {
        values: {
          code: 'D1',
          title: 'NCERT Maths X',
          kind: 'link',
          url: 'https://ncert.nic.in',
          audience: 'students',
        },
      },
    });
    await inject({
      method: 'POST',
      url: '/masters/library_digital_items/rows',
      headers: h(),
      json: {
        values: {
          code: 'D2',
          title: 'Staff handbook',
          kind: 'link',
          url: 'https://example.org/handbook',
          audience: 'employees',
        },
      },
    });
    expect(
      (await inject({ method: 'GET', url: '/library/digital', headers: h() })).json().data,
    ).toHaveLength(2);
    expect(
      (await inject({ method: 'GET', url: '/library/mine/digital', headers: h(parent) }))
        .json()
        .data.map((d: { code: string }) => d.code),
    ).toEqual(['D1']);
    // stock check
    const chk = await inject({
      method: 'POST',
      url: '/library/stock-checks',
      headers: h(),
      json: { name: 'Autumn' },
    });
    expect(chk.json()).toMatchObject({ status: 'open', expected: 2 });
    const again = await inject({
      method: 'POST',
      url: '/library/stock-checks',
      headers: h(),
      json: { name: 'Twice' },
    });
    expect(again.statusCode).toBe(409);
    const scan = await inject({
      method: 'POST',
      url: `/library/stock-checks/${chk.json().id}/scan`,
      headers: h(),
      json: { accessionNos: [`${s}-1`, 'nope'] },
    });
    expect(scan.json()).toMatchObject({ found: 1, marked: 1, unknown: ['nope'] });
    const closed = await inject({
      method: 'POST',
      url: `/library/stock-checks/${chk.json().id}/close`,
      headers: h(),
      json: { markMissingLost: true },
    });
    expect(closed.json()).toMatchObject({ status: 'closed', found: 1, missing: 1 });
    const copies = (
      await inject({
        method: 'GET',
        url: `/library/titles/${title.json().id}/copies`,
        headers: h(),
      })
    ).json().data;
    expect(copies.find((c: { accessionNo: string }) => c.accessionNo === `${s}-2`).status).toBe(
      'lost',
    );
    expect(
      copies.find((c: { accessionNo: string }) => c.accessionNo === `${s}-1`).lastVerifiedOn,
    ).not.toBeNull();
  });

  it('results analytics reads the mart; the archive function moves only old closed years', async () => {
    await withMigrator(async (c) => {
      await c.query(
        `SELECT set_config('app.school_id', $1, false), set_config('app.user_id', $2, false)`,
        [school.id, admin.id],
      );
      await c.query('SELECT app.refresh_exam_results_mart()');
    });
    const r = await inject({ method: 'GET', url: '/insights/results', headers: h() });
    expect(r.statusCode).toBe(200);
    expect(r.json().exams.length).toBeGreaterThanOrEqual(2);
    const byClass = r
      .json()
      .byClass.find(
        (x: { examCode: string; section: string | null }) =>
          x.examCode === 'ANNUAL' && x.section === null,
      );
    expect(byClass).toMatchObject({ pupils: 1, complete: 1, pass: 1 });
    expect(r.json().weakestSubjects[0].subject).toBe('Mathematics');
    const moved = await withMigrator(async (c) => {
      await c.query(
        `SELECT set_config('app.school_id', $1, false), set_config('app.user_id', $2, false)`,
        [school.id, admin.id],
      );
      return (await c.query<{ n: number }>('SELECT app.archive_closed_years() AS n')).rows[0]!.n;
    });
    expect(Number(moved)).toBe(0); // one open year, nothing old enough to archive
  });
});
