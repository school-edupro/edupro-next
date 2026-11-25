/**
 * A staff member who is also a parent here sees their child with the staff login (0423): the father's, mother's or
 * guardian's section marked "School staff: Yes" with an employee code joins the record to that staff member's login
 * when the office saves it (no login of its own), so /me/profiles lists Staff and Parent of the child and the family
 * view opens; a record with a login of its own waits for Use staff login (move), and that login then stops seeing the
 * child; Undo puts the login back; School staff set to No puts it back too; a staff member who gets a login later is
 * joined by itself; the list (to do, joined); the rights and the school boundary.
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

interface Link {
  state: string;
  code: string | null;
  employee: { id: string; code: string; name: string } | null;
  canUndo: boolean;
}
interface Guardian {
  guardianId: string;
  relation: string;
  staff: Link | null;
}
interface Profile {
  id: string;
  kind: string;
  studentId: string | null;
  actingAs: string | null;
}

describe('staff parents (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let otherAdmin: SeededUser;
  let teacher: SeededUser;
  let staffOne: SeededUser;
  let s: string;
  let sectionId: string;
  let first: string;
  let second: string;
  const h = (
    u: SeededUser = admin,
    sc: SeededSchool = school,
    extra: Record<string, string> = {},
  ) => headersFor(u.sub, sc.id, extra);

  const quick = async (admissionNo: string, father: string, mother: string, mobile: string) => {
    const r = await inject({
      method: 'POST',
      url: '/people/profile/quick-add',
      headers: h(),
      json: {
        classSectionId: sectionId,
        values: {
          admission_no: admissionNo,
          first_name: 'test',
          last_name: 'child',
          dob: '15-06-2014',
          gender: 'female',
          father_name: father,
          mother_name: mother,
          sms_mobile: mobile,
          category: 'general',
          ews: 'no',
          boarding: 'day scholar',
        },
      },
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const patch = async (id: string, values: Record<string, unknown>) => {
    const r = await inject({
      method: 'PATCH',
      url: `/people/students/${id}/profile`,
      headers: h(),
      json: { values },
    });
    expect(r.statusCode).toBe(200);
  };
  const guardians = async (id: string) => {
    const r = await inject({ method: 'GET', url: `/people/students/${id}`, headers: h() });
    expect(r.statusCode).toBe(200);
    return r.json().guardians as Guardian[];
  };
  const parentOf = async (id: string, relation: string) =>
    (await guardians(id)).find((g) => g.relation === relation)!;
  // as the app asks on opening: no school chosen yet
  const profiles = async (sub: string) => {
    const r = await inject({
      method: 'GET',
      url: '/me/profiles',
      headers: { authorization: `Bearer dev:${sub}` },
    });
    expect(r.statusCode).toBe(200);
    return r.json().data as Profile[];
  };
  const kidsOf = async (sub: string) => {
    const r = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: headersFor(sub, school.id, { 'x-acting-as': 'family' }),
    });
    return r.statusCode === 200
      ? (r.json().children as Array<{ id: string }>).map((c) => c.id)
      : [];
  };
  const join = (
    guardianId: string,
    move = false,
    u: SeededUser = admin,
    sc: SeededSchool = school,
  ) =>
    inject({
      method: 'POST',
      url: `/people/staff-parents/${guardianId}/join`,
      headers: h(u, sc),
      json: { move },
    });
  const undo = (guardianId: string, u: SeededUser = admin) =>
    inject({
      method: 'POST',
      url: `/people/staff-parents/${guardianId}/undo`,
      headers: h(u),
      json: {},
    });
  const list = async (query = '') => {
    const r = await inject({ method: 'GET', url: `/people/staff-parents${query}`, headers: h() });
    expect(r.statusCode).toBe(200);
    return r.json() as {
      data: Array<Link & { guardianId: string; studentId: string; relation: string }>;
      counts: { todo: number; joined: number; byState: Record<string, number> };
      page: { total: number };
    };
  };

  beforeAll(async () => {
    s = stamp('SPR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      otherAdmin = await seedUser(c, other, `${s}-admin-b`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      staffOne = await seedUser(c, school, `${s}-staff1`, 'subject_teacher');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id)
         VALUES ($1, $2, 'Sam', 'Staff', $3), ($1, $4, 'Rita', 'Staff', NULL)`,
        [school.id, `${s}E1`, staffOne.id, `${s}E2`],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI' },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    // made-up mobiles, new each run (a parent login made by the school reuses a login with the same mobile)
    const mobile = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    first = await quick(`${s}1`, 'sam staff', 'rita staff', mobile());
    second = await quick(`${s}2`, 'sam staff', 'other mother', mobile());
  });
  afterAll(async () => {
    await app.close();
  });

  it('a father marked School staff with the code joins the staff login on save: Staff and Parent in one login', async () => {
    expect((await parentOf(first, 'father')).staff).toBeNull();
    expect((await profiles(staffOne.sub)).map((p) => p.kind)).toEqual(['staff']);
    await patch(first, {
      father_school_staff: 'Yes',
      father_staff_employee_id: ` ${s.toLowerCase()}e1 `,
    });
    const father = await parentOf(first, 'father');
    expect(father.staff).toMatchObject({
      state: 'joined',
      canUndo: true,
      employee: { code: `${s}E1`, name: expect.any(String) as string },
    });
    const mine = await profiles(staffOne.sub);
    expect(mine).toContainEqual(expect.objectContaining({ kind: 'staff' }));
    expect(mine).toContainEqual(
      expect.objectContaining({ kind: 'parent', studentId: first, actingAs: 'family' }),
    );
    expect(await kidsOf(staffOne.sub)).toEqual([first]);
    // a website session with no school chosen yet: two memberships in one school still mean that school
    const me = await inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer dev:${staffOne.sub}`, 'x-acting-as': 'family' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().school).toMatchObject({ id: school.id });
    expect(me.json().permissions).toEqual(expect.arrayContaining(['engagement.family.view']));
    const family = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: { authorization: `Bearer dev:${staffOne.sub}`, 'x-acting-as': 'family' },
    });
    expect((family.json().children as Array<{ id: string }>).map((c) => c.id)).toEqual([first]);
    // saved again unchanged: still one join, nothing new
    await patch(first, { father_school_staff: 'Yes', father_staff_employee_id: `${s}E1` });
    expect((await parentOf(first, 'father')).staff?.state).toBe('joined');
    const audit = await withMigrator((c) =>
      c.query(
        `SELECT action FROM audit_logs WHERE school_id = $1 AND entity_type = 'guardians' AND entity_id = $2
            AND action LIKE 'people.guardian.staff_%' ORDER BY id`,
        [school.id, father.guardianId],
      ),
    );
    expect(audit.rows.map((x: { action: string }) => x.action)).toEqual([
      'people.guardian.staff_join',
    ]);
  });

  it('My children on the staff website: a one-time link opens the family website signed in (0424)', async () => {
    // as the staff website asks: its session, no school chosen
    const web = (sub: string) => ({ authorization: `Bearer dev:${sub}` });
    const issued = await inject({
      method: 'POST',
      url: '/auth/web-hop',
      headers: web(staffOne.sub),
      json: { to: '/' },
    });
    expect(issued.statusCode).toBe(200);
    const url = new URL(issued.json().url as string);
    expect(url.pathname).toBe('/api/auth/hop');
    const code = url.searchParams.get('code')!;
    const redeemed = await inject({
      method: 'POST',
      url: '/auth/web-hop/redeem',
      headers: {},
      json: { code },
    });
    expect(redeemed.statusCode).toBe(200);
    expect(redeemed.json()).toMatchObject({ schoolId: school.id, to: '/' });
    const token = redeemed.json().accessToken as string;
    expect(token.startsWith('otp.')).toBe(true);
    // the family website's session reads the family view
    const family = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: {
        authorization: `Bearer ${token}`,
        'x-school-id': school.id,
        'x-acting-as': 'family',
      },
    });
    expect((family.json().children as Array<{ id: string }>).map((c) => c.id)).toEqual([first]);
    // once only
    const again = await inject({
      method: 'POST',
      url: '/auth/web-hop/redeem',
      headers: {},
      json: { code },
    });
    expect(again.statusCode).toBe(401);
    expect(again.json().type).toBe('auth.hop_invalid');
    // not a parent here: no link; a page that is not the family website's own: refused
    const notParent = await inject({
      method: 'POST',
      url: '/auth/web-hop',
      headers: web(teacher.sub),
      json: { to: '/' },
    });
    expect(notParent.statusCode).toBe(403);
    expect(notParent.json().type).toBe('auth.hop_not_family');
    expect(
      (
        await inject({
          method: 'POST',
          url: '/auth/web-hop',
          headers: web(staffOne.sub),
          json: { to: '//elsewhere.example/x' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('the mother’s section the same: a staff member with no login yet is joined when they get one', async () => {
    await patch(first, { mother_school_staff: 'Yes', mother_staff_employee_id: `${s}E2` });
    const mother = await parentOf(first, 'mother');
    expect(mother.staff).toMatchObject({ state: 'staff_no_login', canUndo: false });
    const todo = await list();
    expect(todo.data).toContainEqual(
      expect.objectContaining({
        guardianId: mother.guardianId,
        state: 'staff_no_login',
        relation: 'mother',
      }),
    );
    expect(todo.counts).toMatchObject({ todo: 1, joined: 1 });
    expect((await join(mother.guardianId)).json().type).toBe('staff_parent.staff_no_login');
    // the staff member gets a login: the record naming them joins by itself
    const staffTwo = await withMigrator(async (c) => {
      const u = await seedUser(c, school, `${s}-staff2`, 'subject_teacher');
      await c.query(
        'UPDATE employees SET user_id = $2 WHERE school_id = $1 AND employee_code = $3',
        [school.id, u.id, `${s}E2`],
      );
      return u;
    });
    expect((await parentOf(first, 'mother')).staff).toMatchObject({
      state: 'joined',
      canUndo: true,
    });
    expect(await profiles(staffTwo.sub)).toContainEqual(
      expect.objectContaining({ kind: 'parent', studentId: first }),
    );
    expect((await list()).counts).toMatchObject({ todo: 0, joined: 2 });
    expect((await list('?state=joined')).data.map((x) => x.relation).sort()).toEqual([
      'father',
      'mother',
    ]);
  });

  it('a record with a login of its own waits for Use staff login; that login then stops seeing the child; Undo puts it back', async () => {
    // the second child's father record (its own record) has a login of its own, made by the school
    const fatherId = (await parentOf(second, 'father')).guardianId;
    const made = await inject({
      method: 'POST',
      url: '/access/portal-as/login',
      headers: h(),
      json: { personType: 'guardian', id: fatherId },
    });
    expect(made.statusCode).toBe(201);
    const ownSub = (
      await withMigrator((c) =>
        c.query<{ oneauth_sub: string }>(
          'SELECT u.oneauth_sub FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.id = $1',
          [fatherId],
        ),
      )
    ).rows[0]!.oneauth_sub;
    expect(await kidsOf(ownSub)).toEqual([second]);
    await patch(second, { father_school_staff: 'Yes', father_staff_employee_id: `${s}E1` });
    expect((await parentOf(second, 'father')).staff).toMatchObject({ state: 'separate_login' });
    expect((await profiles(staffOne.sub)).some((p) => p.studentId === second)).toBe(false);
    const plain = await join(fatherId);
    expect(plain.statusCode).toBe(409);
    expect(plain.json().type).toBe('staff_parent.separate_login');
    // others cannot: no right, or another school
    expect((await join(fatherId, true, teacher)).statusCode).toBe(403);
    expect((await join(fatherId, true, otherAdmin, other)).statusCode).toBe(404);
    const moved = await join(fatherId, true);
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({
      result: 'joined',
      link: { state: 'joined', canUndo: true },
    });
    expect((await kidsOf(staffOne.sub)).sort()).toEqual([first, second].sort());
    expect(await kidsOf(ownSub)).toEqual([]);
    expect((await profiles(ownSub)).some((p) => p.studentId === second)).toBe(false);
    // Undo: the record's own login comes back, the staff login keeps only the first child
    expect((await undo(fatherId, teacher)).statusCode).toBe(403);
    const back = await undo(fatherId);
    expect(back.statusCode).toBe(200);
    expect(back.json().link).toMatchObject({ state: 'separate_login', canUndo: false });
    expect(await kidsOf(ownSub)).toEqual([second]);
    expect(await kidsOf(staffOne.sub)).toEqual([first]);
    expect((await undo(fatherId)).json().type).toBe('staff_parent.not_joined');
    const audit = await withMigrator((c) =>
      c.query(
        `SELECT action FROM audit_logs WHERE school_id = $1 AND entity_type = 'guardians' AND entity_id = $2
            AND action LIKE 'people.guardian.staff_%' ORDER BY id`,
        [school.id, fatherId],
      ),
    );
    expect(audit.rows.map((x: { action: string }) => x.action)).toEqual([
      'people.guardian.staff_join',
      'people.guardian.staff_undo',
    ]);
  });

  it('School staff set to No, or a code no staff member has, puts the join back', async () => {
    await patch(first, { father_staff_employee_id: `${s}NOPE` });
    expect((await parentOf(first, 'father')).staff).toMatchObject({
      state: 'no_employee',
      canUndo: false,
    });
    expect((await profiles(staffOne.sub)).map((p) => p.kind)).toEqual(['staff']);
    expect(await kidsOf(staffOne.sub)).toEqual([]);
    await patch(first, { father_staff_employee_id: `${s}E1` });
    expect((await parentOf(first, 'father')).staff?.state).toBe('joined');
    await patch(first, { father_school_staff: 'No' });
    expect((await parentOf(first, 'father')).staff).toBeNull();
    expect((await profiles(staffOne.sub)).map((p) => p.kind)).toEqual(['staff']);
    // the parent role the join gave is taken back with the last record
    const roles = await withMigrator((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = $1 AND ur.user_id = $2 AND r.code = 'parent' AND ur.revoked_at IS NULL`,
        [school.id, staffOne.id],
      ),
    );
    expect(roles.rows[0].n).toBe(0);
    // the mother's join is untouched
    expect((await parentOf(first, 'mother')).staff?.state).toBe('joined');
  });

  it('an Excel update of the mother’s section joins the same way', async () => {
    const third = await quick(
      `${s}3`,
      'some father',
      'sam staff',
      `7${String(Date.now()).slice(-9)}`,
    );
    const v = await inject({
      method: 'POST',
      url: '/people/profile/bulk/validate',
      headers: h(),
      json: {
        mode: 'update',
        fileName: 't.csv',
        csv: [
          'Admission No,Mother is School Staff,Mother Staff Employee ID',
          `${s}3,Yes,${s}E1`,
        ].join('\n'),
      },
    });
    expect(v.statusCode).toBe(201);
    expect(v.json()).toMatchObject({ readyRows: 1, rejectedRows: 0 });
    const commit = await inject({
      method: 'POST',
      url: `/people/profile/bulk/${v.json().id as string}/commit`,
      headers: h(),
    });
    expect(commit.json()).toMatchObject({ applied: 1, failed: 0 });
    expect((await parentOf(third, 'mother')).staff).toMatchObject({
      state: 'joined',
      canUndo: true,
    });
    expect(await kidsOf(staffOne.sub)).toEqual([third]);
  });

  it('the list: search, another school sees nothing, and a teacher without the right cannot read it', async () => {
    const found = await list(`?state=all&q=${encodeURIComponent(`${s}2`)}`);
    expect(found.data.map((x) => x.studentId)).toEqual([second]);
    const theirs = await inject({
      method: 'GET',
      url: '/people/staff-parents?state=all',
      headers: h(otherAdmin, other),
    });
    expect(theirs.statusCode).toBe(200);
    expect(theirs.json().data).toEqual([]);
    expect(
      (await inject({ method: 'GET', url: '/people/staff-parents', headers: h(teacher) }))
        .statusCode,
    ).toBe(403);
  });
});
