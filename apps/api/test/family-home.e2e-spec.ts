/**
 * Parent app home: classmates' birthdays over the next seven days (own section only, first name and
 * initial, no year), scoped to the family's own children.
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

/** The IST calendar day `days` from today, moved back `years` (a date of birth). */
const istDay = (days: number, years = 0) => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

describe('parent app home: upcoming birthdays (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    s = stamp('FH');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'V', name: 'Class V', displayOrder: 5 },
    });
    const section = async (name: string) =>
      (
        await inject({
          method: 'POST',
          url: `/academics/classes/${cls.json().id}/sections`,
          headers: h(),
          json: { name },
        })
      ).json().id as string;
    const a = await section('A');
    const b = await section('B');
    const add = async (key: string, first: string, last: string, dob: string, sec: string) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: last,
          dob,
          enrolment: { classSectionId: sec, rollNo: Object.keys(ids).length + 1 },
        },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id;
    };
    await add('child', 'Kavya', 'Home', istDay(0, 10), a);
    await add('mate', 'Ishaan', 'Bose', istDay(3, 10), a);
    await add('later', 'Meher', 'Late', istDay(20, 10), a);
    await add('other', 'Zoya', 'Elsewhere', istDay(1, 10), b);
    await withMigrator((c) =>
      c
        .query(
          `INSERT INTO guardians (school_id, first_name, last_name, mobile, user_id) VALUES ($1, 'Ravi', 'Home', '9876500777', $2) RETURNING id`,
          [school.id, parent.id],
        )
        .then((g) =>
          c.query(
            `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'father', true)`,
            [school.id, ids.child, g.rows[0]!.id],
          ),
        ),
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists the next seven days' birthdays in the child's own section, initials only", async () => {
    const r = await inject({
      method: 'GET',
      url: `/engagement/mine/birthdays/${ids.child}`,
      headers: h(parent),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([
      { name: 'Kavya H.', day: istDay(0), self: true },
      { name: 'Ishaan B.', day: istDay(3), self: false },
    ]);
  });

  it('refuses a child outside the family and staff callers', async () => {
    const other = await inject({
      method: 'GET',
      url: `/engagement/mine/birthdays/${ids.other}`,
      headers: h(parent),
    });
    expect(other.statusCode).toBe(404);
    const staff = await inject({
      method: 'GET',
      url: `/engagement/mine/birthdays/${ids.child}`,
      headers: h(teacher),
    });
    expect(staff.statusCode).toBe(403);
  });
});
