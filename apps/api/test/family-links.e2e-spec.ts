/**
 * Link families (0426): a student's Sibling section names a sibling who hangs off other father / mother records, so
 * the parent's login sees one child. The student 360 says so; the preview shows both children's records with what to
 * keep (the one with a login); Link families moves the other child's link to the kept record (or leaves a relation
 * apart); the parent's login then sees both; Undo puts the old links back as they were; the rights and the school
 * boundary.
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

interface Guardian {
  guardianId: string;
  relation: string;
  isPrimary: boolean;
}
interface Family {
  sibling: { id: string; admissionNo: string } | null;
  sharedAny: boolean;
  sharedAll: boolean;
  lastBatch: { batchId: string; siblingAdmissionNo: string } | null;
}
interface Preview {
  student: { id: string };
  sibling: { id: string; admissionNo: string };
  relations: Array<{
    relation: string;
    state: string;
    suggested: string;
    here: { guardianId: string; hasLogin: boolean } | null;
    sibling: { guardianId: string; hasLogin: boolean } | null;
  }>;
}

describe('family links (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let otherAdmin: SeededUser;
  let teacher: SeededUser;
  let s: string;
  let sectionId: string;
  let first: string;
  let second: string;
  let fatherLogin: string;
  const h = (u: SeededUser = admin, sc: SeededSchool = school) => headersFor(u.sub, sc.id);
  const mobile = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  const quick = async (n: number, values: Record<string, string>) => {
    const r = await inject({
      method: 'POST',
      url: '/people/profile/quick-add',
      headers: h(),
      json: {
        classSectionId: sectionId,
        values: {
          admission_no: `${s}${String(n)}`,
          first_name: `kid${String(n)}`,
          dob: '15-06-2014',
          gender: 'female',
          sms_mobile: mobile(),
          category: 'general',
          ews: 'no',
          boarding: 'day scholar',
          ...values,
        },
      },
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const guardians = async (id: string) =>
    (await inject({ method: 'GET', url: `/people/students/${id}`, headers: h() })).json()
      .guardians as Guardian[];
  const family = async (id: string) =>
    (await inject({ method: 'GET', url: `/people/students/${id}`, headers: h() })).json()
      .family as Family;
  const preview = (id: string, u: SeededUser = admin, sc: SeededSchool = school) =>
    inject({ method: 'GET', url: `/people/students/${id}/family-link`, headers: h(u, sc) });
  const link = (id: string, json: object, u: SeededUser = admin, sc: SeededSchool = school) =>
    inject({ method: 'POST', url: `/people/students/${id}/family-link`, headers: h(u, sc), json });
  const undo = (id: string, batchId: string) =>
    inject({
      method: 'POST',
      url: `/people/students/${id}/family-link/undo`,
      headers: h(),
      json: { batchId },
    });
  const kidsOf = async (sub: string) => {
    const r = await inject({
      method: 'GET',
      url: '/engagement/family',
      headers: headersFor(sub, school.id, { 'x-acting-as': 'family' }),
    });
    return r.statusCode === 200
      ? (r.json().children as Array<{ id: string }>).map((c) => c.id).sort()
      : [];
  };

  beforeAll(async () => {
    s = stamp('FL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      otherAdmin = await seedUser(c, other, `${s}-admin-b`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'IV', name: 'Class IV' },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id as string}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    // two children with their own father records (made-up families); only the first has a mother
    first = await quick(1, { father_name: 'one father', mother_name: 'one mother' });
    second = await quick(2, { father_name: 'two father' });
    // the first child's father has a login of his own
    const father = (await guardians(first)).find((g) => g.relation === 'father')!.guardianId;
    const made = await inject({
      method: 'POST',
      url: '/access/portal-as/login',
      headers: h(),
      json: { personType: 'guardian', id: father },
    });
    expect(made.statusCode).toBe(201);
    fatherLogin = (
      await withMigrator((c) =>
        c.query<{ sub: string }>(
          'SELECT u.oneauth_sub AS sub FROM guardians g JOIN users u ON u.id = g.user_id WHERE g.id = $1',
          [father],
        ),
      )
    ).rows[0]!.sub;
  });
  afterAll(async () => {
    await app.close();
  });

  it('the Sibling section names the sibling; the records are not shared, so the father sees one child', async () => {
    expect((await family(first)).sibling).toBeNull();
    const saved = await inject({
      method: 'PATCH',
      url: `/people/students/${first}/profile`,
      headers: h(),
      json: { values: { sibling_in_school: 'Yes', sibling_admission_no: `${s}2` } },
    });
    expect(saved.statusCode).toBe(200);
    expect(await family(first)).toMatchObject({
      sibling: { id: second, admissionNo: `${s}2` },
      sharedAny: false,
      sharedAll: false,
      lastBatch: null,
    });
    expect(await kidsOf(fatherLogin)).toEqual([first]);
  });

  it('the preview: each record, keep the one with a login; the mother is only on one side', async () => {
    const r = await preview(first);
    expect(r.statusCode).toBe(200);
    const p = r.json() as Preview;
    expect(p.sibling).toMatchObject({ id: second });
    const father = p.relations.find((x) => x.relation === 'father')!;
    expect(father).toMatchObject({
      state: 'different',
      suggested: 'here',
      here: { hasLogin: true },
      sibling: { hasLogin: false },
    });
    expect(p.relations.find((x) => x.relation === 'mother')).toMatchObject({
      state: 'only_here',
      suggested: 'here',
      sibling: null,
    });
  });

  it('Link families: the sibling moves onto the kept records, the father sees both; Undo puts it back', async () => {
    const before = await guardians(second);
    const ownFather = before.find((g) => g.relation === 'father')!;
    const r = await link(first, { siblingId: second, keep: { father: 'here', mother: 'here' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().moved).toBe(2);
    const batchId = r.json().batchId as string;
    const mine = await guardians(first);
    const after = await guardians(second);
    for (const rel of ['father', 'mother'])
      expect(after.find((g) => g.relation === rel)!.guardianId).toBe(
        mine.find((g) => g.relation === rel)!.guardianId,
      );
    // the moved father link keeps its flags; the sibling's own father record is no longer linked to it
    expect(after.find((g) => g.relation === 'father')!.isPrimary).toBe(ownFather.isPrimary);
    expect(after.some((g) => g.guardianId === ownFather.guardianId)).toBe(false);
    expect((await kidsOf(fatherLogin)).sort()).toEqual([first, second].sort());
    expect(await family(first)).toMatchObject({
      sharedAny: true,
      sharedAll: true,
      lastBatch: { batchId, siblingAdmissionNo: `${s}2` },
    });
    // the sibling sees the same batch (Undo from either page)
    expect((await family(second)).lastBatch).toMatchObject({ batchId });
    // nothing left to link
    const again = await link(first, {
      siblingId: second,
      keep: { father: 'here', mother: 'here' },
    });
    expect(again.json()).toMatchObject({ moved: 0, batchId: null });
    // Undo from the sibling's page
    const back = await undo(second, batchId);
    expect(back.statusCode).toBe(200);
    expect(back.json().undone).toBe(2);
    const restored = await guardians(second);
    expect(restored.map((g) => `${g.relation}:${g.guardianId}:${String(g.isPrimary)}`)).toEqual(
      before.map((g) => `${g.relation}:${g.guardianId}:${String(g.isPrimary)}`),
    );
    expect(await kidsOf(fatherLogin)).toEqual([first]);
    expect((await family(first)).lastBatch).toBeNull();
    expect((await undo(first, batchId)).statusCode).toBe(404);
    const audit = await withMigrator((c) =>
      c.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE school_id = $1 AND action LIKE 'people.family.%' ORDER BY id`,
        [school.id],
      ),
    );
    expect(audit.rows.map((x) => x.action)).toEqual([
      'people.family.link',
      'people.family.link_undo',
    ]);
  });

  it('a relation left apart is not touched; keeping the sibling side moves this child', async () => {
    const r = await link(first, { siblingId: second, keep: { father: 'apart', mother: 'here' } });
    expect(r.json().moved).toBe(1);
    const after = await guardians(second);
    expect(after.find((g) => g.relation === 'father')!.guardianId).not.toBe(
      (await guardians(first)).find((g) => g.relation === 'father')!.guardianId,
    );
    expect(await family(first)).toMatchObject({ sharedAny: true, sharedAll: false });
    await undo(first, r.json().batchId as string);
    // keep the sibling's father: the first child moves onto it (and its father's login no longer sees it)
    const moved = await link(first, {
      siblingId: second,
      keep: { father: 'sibling', mother: 'apart' },
    });
    expect(moved.json().moved).toBe(1);
    expect(await kidsOf(fatherLogin)).toEqual([]);
    await undo(first, moved.json().batchId as string);
    expect(await kidsOf(fatherLogin)).toEqual([first]);
    // a side with no record cannot be kept
    const bad = await link(first, { siblingId: second, keep: { mother: 'sibling' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().type).toBe('family.no_record');
  });

  it('the rights and the school boundary; no sibling, the same student', async () => {
    expect((await preview(first, teacher)).statusCode).toBe(403);
    expect(
      (await link(first, { siblingId: second, keep: { father: 'here' } }, teacher)).statusCode,
    ).toBe(403);
    expect((await preview(first, otherAdmin, other)).statusCode).toBe(404);
    expect(
      (await link(first, { siblingId: second, keep: { father: 'here' } }, otherAdmin, other))
        .statusCode,
    ).toBe(404);
    const none = await preview(second);
    expect(none.statusCode).toBe(404);
    expect(none.json().type).toBe('family.no_sibling');
    expect((await link(first, { siblingId: first, keep: { father: 'here' } })).statusCode).toBe(
      400,
    );
    expect((await undo(first, '00000000-0000-4000-8000-000000000000')).json().type).toBe(
      'family.no_link',
    );
  });
});
