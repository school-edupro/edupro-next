/**
 * People procedures (Sprint 4): enrolment rules, sibling view, search ranking and tenant isolation.
 */
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appDb, createFixture, ctxFor, MIGRATOR_URL, type Fixture } from './helpers';

let fixture: Fixture;
const db = appDb();
let sectionA: string;
let sectionB: string;
let plannedYear: string;
let plannedSection: string;

beforeAll(async () => {
  fixture = await createFixture('PPL');
  const c = new Client({ connectionString: MIGRATOR_URL });
  await c.connect();
  try {
    const cls = await c.query<{ id: string }>(
      `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
      [fixture.schoolA],
    );
    const secA = await c.query<{ id: string }>(
      `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
      [fixture.schoolA, fixture.yearA, cls.rows[0]!.id],
    );
    sectionA = secA.rows[0]!.id;
    const secB = await c.query<{ id: string }>(
      `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'B') RETURNING id::text`,
      [fixture.schoolA, fixture.yearA, cls.rows[0]!.id],
    );
    sectionB = secB.rows[0]!.id;
    const py = await c.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status, locks)
       VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned', '{"academics": true}'::jsonb) RETURNING id::text`,
      [fixture.schoolA],
    );
    plannedYear = py.rows[0]!.id;
    const ps = await c.query<{ id: string }>(
      `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
      [fixture.schoolA, plannedYear, cls.rows[0]!.id],
    );
    plannedSection = ps.rows[0]!.id;
  } finally {
    await c.end();
  }
});

afterAll(async () => {
  await db.close();
});

async function addStudent(admissionNo: string, first: string, last: string): Promise<string> {
  return db.withTenant(ctxFor(fixture, 'A'), async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES (app.current_school_id(), $1, $2, $3) RETURNING id::text`,
      [admissionNo, first, last],
    );
    return r.rows[0]!.id;
  });
}

describe('app.enrol_student', () => {
  it('creates one enrolment per year, moves sections on re-enrolment and enforces unique roll numbers', async () => {
    const s1 = await addStudent('R1001', 'Aarav', 'Sharma');
    const s2 = await addStudent('R1002', 'Diya', 'Patel');
    const ctx = { ...ctxFor(fixture, 'A'), academicYearId: fixture.yearA };
    const e1 = await db.withTenant(
      ctx,
      async (c) =>
        (
          await c.query<{ id: string }>('SELECT app.enrol_student($1, $2, $3, $4)::text AS id', [
            s1,
            fixture.yearA,
            sectionA,
            1,
          ])
        ).rows[0]!.id,
    );
    // Same student, same year: the enrolment row is updated, not duplicated.
    const e1b = await db.withTenant(
      ctx,
      async (c) =>
        (
          await c.query<{ id: string }>('SELECT app.enrol_student($1, $2, $3, $4)::text AS id', [
            s1,
            fixture.yearA,
            sectionB,
            5,
          ])
        ).rows[0]!.id,
    );
    expect(e1b).toBe(e1);
    const rows = await db.withTenant(
      ctx,
      async (c) =>
        (
          await c.query(
            'SELECT class_section_id::text AS section, roll_no FROM enrolments WHERE student_id = $1',
            [s1],
          )
        ).rows,
    );
    expect(rows).toEqual([{ section: sectionB, roll_no: 5 }]);
    // Roll number 5 is now taken in section B.
    await expect(
      db.withTenant(ctx, (c) =>
        c.query('SELECT app.enrol_student($1, $2, $3, $4)', [s2, fixture.yearA, sectionB, 5]),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('refuses a section from another year and a locked academics stage', async () => {
    const s = await addStudent('R1003', 'Kavya', 'Nair');
    const ctx = { ...ctxFor(fixture, 'A'), academicYearId: fixture.yearA };
    await expect(
      db.withTenant(ctx, (c) =>
        c.query('SELECT app.enrol_student($1, $2, $3)', [s, fixture.yearA, plannedSection]),
      ),
    ).rejects.toMatchObject({ message: 'enrolment.section_year_mismatch' });
    await expect(
      db.withTenant(ctx, (c) =>
        c.query('SELECT app.enrol_student($1, $2, $3)', [s, plannedYear, plannedSection]),
      ),
    ).rejects.toMatchObject({ message: expect.stringMatching(/year/) });
  });
});

describe('guardians, siblings and search', () => {
  it('links two students through one guardian and lists them as siblings', async () => {
    const s1 = await addStudent('R2001', 'Ishaan', 'Verma');
    const s2 = await addStudent('R2002', 'Anaya', 'Verma');
    const ctx = ctxFor(fixture, 'A');
    const siblings = await db.withTenant(ctx, async (c) => {
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile) VALUES (app.current_school_id(), 'Rakesh', 'Verma', '9000000011') RETURNING id::text`,
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES (app.current_school_id(), $1, $2, 'father', true)`,
        [s1, g.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation) VALUES (app.current_school_id(), $1, $2, 'father')`,
        [s2, g.rows[0]!.id],
      );
      return (
        await c.query<{ sibling_id: string }>(
          'SELECT sibling_id::text FROM student_siblings WHERE student_id = $1',
          [s1],
        )
      ).rows;
    });
    expect(siblings).toEqual([{ sibling_id: s2 }]);
  });

  it('ranks exact numbers first, finds names by prefix and typo, and never crosses schools', async () => {
    const ctx = { ...ctxFor(fixture, 'A'), academicYearId: fixture.yearA };
    await db.withTenant(ctx, async (c) => {
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, mobile) VALUES (app.current_school_id(), 'E100', 'Meena', 'Iyer', 'PGT Maths', '9123456789')`,
      );
    });
    const search = (q: string) =>
      db.withTenant(
        ctx,
        async (c) =>
          (
            await c.query<{ kind: string; display_name: string; subtitle: string; rank: number }>(
              'SELECT kind, display_name, subtitle, rank FROM app.search_people($1, 10)',
              [q],
            )
          ).rows,
      );
    const byNumber = await search('R2001');
    expect(byNumber[0]).toMatchObject({ kind: 'student', display_name: 'Ishaan Verma', rank: 2 });
    const byMobile = await search('9123456789');
    expect(byMobile[0]).toMatchObject({ kind: 'employee', display_name: 'Meena Iyer', rank: 2 });
    const byPrefix = await search('verm');
    expect(byPrefix.map((r) => r.display_name)).toEqual(
      expect.arrayContaining(['Ishaan Verma', 'Anaya Verma', 'Rakesh Verma']),
    );
    const typo = await search('Ishan Vrma');
    expect(typo.some((r) => r.display_name === 'Ishaan Verma')).toBe(true);
    const otherSchool = await db.withTenant(
      ctxFor(fixture, 'B'),
      async (c) => (await c.query('SELECT * FROM app.search_people($1, 10)', ['Verma'])).rows,
    );
    expect(otherSchool).toHaveLength(0);
  });

  it('answers a search within 200 ms on a few thousand rows', async () => {
    const ctx = { ...ctxFor(fixture, 'A'), academicYearId: fixture.yearA };
    await db.withTenant(ctx, async (c) => {
      await c.query(
        `INSERT INTO students (school_id, admission_no, first_name, last_name)
         SELECT app.current_school_id(), 'B' || g, 'Student' || g, (ARRAY['Sharma','Patel','Verma','Nair','Gupta','Iyer','Singh','Khan'])[1 + (g % 8)]
           FROM generate_series(1, 3000) AS g`,
      );
    });
    const started = Date.now();
    const rows = await db.withTenant(
      ctx,
      async (c) =>
        (await c.query('SELECT * FROM app.search_people($1, 20)', ['student2 patel'])).rows,
    );
    const elapsed = Date.now() - started;
    expect(rows.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });
});
