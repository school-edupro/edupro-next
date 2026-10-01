/**
 * Portal profile and profile approvals (2026-10-01): the school's field policy for parents and
 * students (hidden, view, edit with approval, edit direct), full ID numbers for the family, proof
 * documents, the update window, approval routes (class teacher, role, named employee, office; one or
 * two levels), partial approval, administrator override, bulk decisions, stale checks and isolation.
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

describe('portal profile and approvals (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let teacher: SeededUser;
  let accounts: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  let stranger: SeededUser;
  let sectionId: string;
  let first: string;
  let second: string;
  let accountantRoleId: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_LOCAL_DIR = '.data/uploads-test';
    const s = stamp('PP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      accounts = await seedUser(c, school, `${s}-accounts`, 'accountant');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
      stranger = await seedUser(c, school, `${s}-stranger`, 'parent', 'guardian');
      accountantRoleId = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM roles WHERE school_id IS NULL AND code = 'accountant'`,
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI' },
    });
    sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    const quick = (values: Record<string, unknown>) =>
      inject({
        method: 'POST',
        url: '/people/profile/quick-add',
        headers: h(),
        json: { classSectionId: sectionId, values },
      });
    const base = {
      gender: 'Female',
      sms_mobile: '9812345678',
      category: 'General',
      ews: 'No',
      boarding: 'Day Scholar',
    };
    first = (
      await quick({
        ...base,
        admission_no: 'PP1001',
        first_name: 'riya',
        last_name: 'verma',
        dob: '15-06-2014',
        father_name: 'amit verma',
        mother_name: 'neha verma',
      })
    ).json().id;
    second = (
      await quick({
        ...base,
        admission_no: 'PP1002',
        first_name: 'kabir',
        last_name: 'verma',
        dob: '10-01-2017',
        father_name: 'amit verma',
      })
    ).json().id;
    const father = (
      await inject({ method: 'GET', url: `/people/students/${first}/profile`, headers: h() })
    ).json().guardianIds.father as string;
    await inject({
      method: 'POST',
      url: `/people/students/${second}/guardians`,
      headers: h(),
      json: { guardianId: father, relation: 'father' },
    });
    await inject({
      method: 'PATCH',
      url: `/people/students/${first}/profile`,
      headers: h(),
      json: { values: { aadhaar_no: '1234 5678 9012', father_pan_no: 'abcde1234f' } },
    });
    await withMigrator(async (c) => {
      await c.query('UPDATE guardians SET user_id = $1 WHERE id = $2', [parent.id, father]);
      await c.query('UPDATE students SET user_id = $1 WHERE id = $2', [pupil.id, first]);
      // the class teacher of VI-A
      const emp = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, gender, employee_type, designation, user_id)
         VALUES ($1, 'PPT1', 'Tara', 'Teacher', 'female', 'teaching', 'TGT', $2) RETURNING id::text`,
        [school.id, teacher.id],
      );
      await c.query(
        `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, kind) VALUES ($1, $2, $3, $4, 'class_teacher')`,
        [school.id, school.yearId, emp.rows[0]!.id, sectionId],
      );
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, gender, employee_type, designation, user_id)
         VALUES ($1, 'PPA1', 'Ravi', 'Accounts', 'male', 'non_teaching', 'Accountant', $2)`,
        [school.id, accounts.id],
      );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  const profile = (u: SeededUser, id = first) =>
    inject({ method: 'GET', url: `/engagement/mine/profile/${id}`, headers: h(u) });
  const submit = (u: SeededUser, changes: Record<string, string>, extra: object = {}, id = first) =>
    inject({
      method: 'POST',
      url: `/engagement/mine/profile/${id}/changes`,
      headers: h(u),
      json: { changes, ...extra },
    });
  const getPolicy = async () =>
    (await inject({ method: 'GET', url: '/people/portal-profile/policy', headers: h() })).json();
  const savePolicy = (body: Record<string, unknown>, u: SeededUser = admin) =>
    inject({ method: 'PUT', url: '/people/portal-profile/policy', headers: h(u), json: body });
  const inbox = (u: SeededUser, qs = 'box=mine') =>
    inject({ method: 'GET', url: `/engagement/profile-approvals?${qs}`, headers: h(u) });
  const decide = (u: SeededUser, id: string, body: Record<string, unknown>) =>
    inject({
      method: 'POST',
      url: `/engagement/profile-approvals/${id}/decide`,
      headers: h(u),
      json: body,
    });
  const values = async (id = first) =>
    (await inject({ method: 'GET', url: `/people/students/${id}/profile`, headers: h() })).json()
      .values;
  const upload = async (u: SeededUser) => {
    const bytes = Buffer.from('%PDF-1.4\n% proof\n'.repeat(20));
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: h(u),
      json: {
        fileName: 'proof.pdf',
        contentType: 'application/pdf',
        sizeBytes: bytes.length,
        classification: 'personal',
      },
    });
    expect(reg.statusCode).toBe(201);
    await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: {},
      raw: { body: bytes, contentType: 'application/pdf' },
    });
    return reg.json().file.id as string;
  };

  it('starts from sensible defaults: parents see ID numbers, students do not, office fields stay read-only', async () => {
    const p = await getPolicy();
    expect(p.saved).toBe(false);
    expect(p.policy.fields.parent).toMatchObject({
      blood_group: 'edit_approval',
      aadhaar_no: 'view',
      admission_no: 'view',
      remarks: 'hidden',
    });
    expect(p.policy.fields.student).toMatchObject({ aadhaar_no: 'hidden', blood_group: 'view' });
    expect(p.policy.proofs).toMatchObject({ dob: 'birth_certificate' });
    const denied = await inject({
      method: 'GET',
      url: '/people/portal-profile/policy',
      headers: h(teacher),
    });
    expect(denied.statusCode).toBe(403);

    const mine = await profile(parent);
    expect(mine.statusCode).toBe(200);
    const body = mine.json();
    expect(body).toMatchObject({ audience: 'parent', admissionNo: 'PP1001', canEdit: true });
    const all = body.sections.flatMap((s: { fields: Array<{ key: string }> }) => s.fields);
    const aadhaar = all.find((f: { key: string }) => f.key === 'aadhaar_no');
    expect(aadhaar).toMatchObject({ value: '123456789012', level: 'view' });
    expect(all.some((f: { key: string }) => f.key === 'remarks')).toBe(false);
    expect(body.sections.some((s: { id: string }) => s.id === 'documents')).toBe(false);

    const own = (await profile(pupil)).json();
    expect(own.audience).toBe('student');
    expect(own.canEdit).toBe(false);
    const ownKeys = own.sections.flatMap((s: { fields: Array<{ key: string }> }) =>
      s.fields.map((f) => f.key),
    );
    expect(ownKeys).not.toContain('aadhaar_no');
    expect(ownKeys).not.toContain('bank_account_no');
  });

  it('keeps other families out', async () => {
    expect((await profile(stranger)).statusCode).toBe(404);
    expect((await submit(stranger, { blood_group: 'A+' })).statusCode).toBe(404);
    const photo = await inject({
      method: 'GET',
      url: `/engagement/mine/profile/${first}/photo/student`,
      headers: h(stranger),
    });
    expect(photo.statusCode).toBe(404);
  });

  it('refuses fields the school has not opened, and asks for proof where needed', async () => {
    const closed = await submit(parent, { first_name: 'Rhea' });
    expect(closed.statusCode).toBe(422);
    const studentTry = await submit(pupil, { blood_group: 'A+' });
    expect(studentTry.statusCode).toBe(422);
    const noProof = await submit(parent, {
      residential_address_line_1: 'C-4, Sector 62',
      residential_city: 'Noida',
    });
    expect(noProof.statusCode).toBe(400);
    expect(noProof.json().type).toBe('engagement.profile.proof_required');
    expect(noProof.json().errors.residential_city).toMatch(/residence proof/);
    // a file someone else uploaded cannot be passed off as proof
    const foreign = await upload(stranger);
    const stolen = await submit(
      parent,
      { residential_address_line_1: 'C-4, Sector 62' },
      { proofs: [{ kind: 'address_proof', fileId: foreign }] },
    );
    expect(stolen.statusCode).toBe(404);
  });

  it('routes by section and field, two levels for the address, and applies only after the last level', async () => {
    const p = await getPolicy();
    const saved = await savePolicy({
      fields: {
        parent: { ...p.policy.fields.parent, alternate_mobile: 'edit_direct' },
        student: p.policy.fields.student,
      },
      proofs: p.policy.proofs,
      window: { mode: 'open' },
      approval: {
        default: [{ kind: 'office' }],
        sections: { address: [{ kind: 'class_teacher' }, { kind: 'office' }] },
        fields: { father_annual_income: [{ kind: 'role', roleId: accountantRoleId }] },
      },
    });
    expect(saved.statusCode).toBe(200);

    const proof = await upload(parent);
    const r = await submit(
      parent,
      {
        residential_address_line_1: 'C-4, Sector 62',
        residential_city: 'Noida',
        blood_group: 'B+',
        father_annual_income: '10-25 Lakh',
        alternate_mobile: '9811111111',
      },
      { reason: 'moved house', proofs: [{ kind: 'address_proof', fileId: proof }] },
    );
    expect(r.statusCode).toBe(201);
    // the direct field is on file now; three routes make three requests
    expect(r.json().applied).toEqual(['alternate_mobile']);
    expect(r.json().requests).toHaveLength(4);
    expect((await values()).alternate_mobile).toBe('9811111111');
    expect((await values()).blood_group).toBeNull();

    // the same field cannot be asked twice while it waits
    const again = await submit(parent, { blood_group: 'O+' });
    expect(again.statusCode).toBe(409);

    // the class teacher sees only the address request
    const t = (await inbox(teacher)).json();
    expect(t.data).toHaveLength(1);
    const address = t.data[0];
    expect(address.items.map((i: { key: string }) => i.key).sort()).toEqual([
      'residential_address_line_1',
      'residential_city',
    ]);
    expect(address).toMatchObject({ level: 1, levels: 2, waitingFor: 'Class teacher' });
    expect(address.proofs[0]).toMatchObject({ kind: 'address_proof' });
    // the accountant role sees the income request, the coordinator (office) the blood group
    const a = (await inbox(accounts)).json();
    expect(a.data.map((x: { items: Array<{ key: string }> }) => x.items[0]!.key)).toEqual([
      'father_annual_income',
    ]);
    const o = (await inbox(coordinator)).json();
    expect(o.data.map((x: { items: Array<{ key: string }> }) => x.items[0]!.key)).toEqual([
      'blood_group',
    ]);
    // not your turn
    const early = await decide(coordinator, address.id, { approve: true });
    expect(early.statusCode).toBe(403);

    // level 1: the class teacher accepts the address line and refuses the city
    const l1 = await decide(teacher, address.id, {
      fields: { residential_address_line_1: true, residential_city: false },
      note: 'City is Greater Noida per the proof',
    });
    expect(l1.statusCode).toBe(201);
    expect(l1.json()).toMatchObject({ status: 'pending', level: 2, waitingFor: 'School office' });
    expect((await values()).residential_address_line_1).toBeNull();
    expect((await inbox(teacher)).json().data).toHaveLength(0);

    // level 2: the office accepts what is left; it applies and the proof joins the documents
    const l2 = await decide(coordinator, address.id, { approve: true });
    expect(l2.json()).toMatchObject({ status: 'partially_approved' });
    const v = await values();
    expect(v.residential_address_line_1).toBe('C-4, Sector 62');
    expect(v.residential_city).not.toBe('Noida');
    expect(v.residence_proof_submitted).toBe('Yes');
    const docs = (
      await inject({ method: 'GET', url: `/people/students/${first}`, headers: h() })
    ).json().documents as Array<{ kind: string }>;
    expect(docs.some((d) => d.kind === 'address_proof')).toBe(true);

    // the family sees each field's outcome and the history
    const mine = (
      await inject({
        method: 'GET',
        url: `/engagement/mine/profile/${first}/requests`,
        headers: h(parent),
      })
    ).json().data as Array<{
      id: string;
      items: Array<{ key: string; status: string; note: string | null }>;
      history: Array<{ decision: string }>;
    }>;
    const done = mine.find((x) => x.id === address.id)!;
    expect(done.items.find((i) => i.key === 'residential_city')).toMatchObject({
      status: 'rejected',
      note: 'City is Greater Noida per the proof',
    });
    expect(done.history.map((x) => x.decision)).toEqual(['partial', 'approved']);
    // the pending blood group shows on the profile
    const shown = (await profile(parent)).json();
    const blood = shown.sections
      .flatMap((s: { fields: Array<{ key: string; pending: unknown }> }) => s.fields)
      .find((f: { key: string }) => f.key === 'blood_group');
    expect(blood.pending).toMatchObject({ to: 'B+' });
  });

  it('administrators override any level; a refusal needs a reason; bulk decisions stand alone', async () => {
    const all = (await inbox(admin, 'box=all')).json();
    expect(all.canOverride).toBe(true);
    const income = all.data.find(
      (x: { items: Array<{ key: string }> }) => x.items[0]!.key === 'father_annual_income',
    );
    const noReason = await decide(admin, income.id, { approve: false });
    expect(noReason.statusCode).toBe(400);
    const blood = all.data.find(
      (x: { items: Array<{ key: string }> }) => x.items[0]!.key === 'blood_group',
    );
    // the office changes the blood group itself meanwhile: the old request is now stale
    await inject({
      method: 'PATCH',
      url: `/people/students/${first}/profile`,
      headers: h(),
      json: { values: { blood_group: 'AB+' } },
    });
    const bulk = await inject({
      method: 'POST',
      url: '/engagement/profile-approvals/bulk',
      headers: h(),
      json: { ids: [income.id, blood.id], approve: true },
    });
    expect(bulk.statusCode).toBe(201);
    expect(bulk.json()).toMatchObject({ done: 1, failed: 1 });
    const failed = bulk.json().results.find((x: { id: string }) => x.id === blood.id) as {
      error: string;
    };
    expect(failed.error).toMatch(/Changed in the office/);
    expect((await values()).father_annual_income).toBe('10-25 Lakh');
    // the teacher may not list everything
    expect((await inbox(teacher, 'box=all')).statusCode).toBe(403);
  });

  it('parents withdraw a waiting request; sensitive numbers stay encrypted and masked for approvers', async () => {
    const p = await getPolicy();
    await savePolicy({
      fields: {
        parent: { ...p.policy.fields.parent, aadhaar_no: 'edit_approval' },
        student: p.policy.fields.student,
      },
      proofs: {},
      window: { mode: 'open' },
      approval: p.policy.approval,
    });
    const r = await submit(parent, { aadhaar_no: '2345 6789 0123' });
    expect(r.statusCode).toBe(201);
    const id = r.json().requests[0] as string;
    const stored = await withMigrator((c) =>
      c.query<{ changes: Record<string, { to: string; enc: boolean }> }>(
        'SELECT changes FROM profile_change_requests WHERE id = $1',
        [id],
      ),
    );
    expect(stored.rows[0]!.changes.aadhaar_no!.to).toMatch(/^v1:/);
    const seen = (await inbox(coordinator)).json().data.find((x: { id: string }) => x.id === id);
    expect(seen.items[0].to).toBe('XXXX-XXXX-0123');
    const cancel = await inject({
      method: 'POST',
      url: `/engagement/mine/change-requests/${id}/cancel`,
      headers: h(parent),
    });
    expect(cancel.json().status).toBe('cancelled');
    const twice = await decide(coordinator, id, { approve: true });
    expect(twice.statusCode).toBe(409);
  });

  it('closes editing outside the update period but keeps the profile and PDF available', async () => {
    const p = await getPolicy();
    const bad = await savePolicy({ ...p.policy, window: { mode: 'period', from: '2026-05-01' } });
    expect(bad.statusCode).toBe(400);
    await savePolicy({
      ...p.policy,
      window: {
        mode: 'period',
        from: '2020-04-01',
        to: '2020-05-31',
        message: 'Profile updates were open in April and May.',
      },
    });
    const shown = (await profile(parent)).json();
    expect(shown.window).toMatchObject({ open: false });
    expect(shown.canEdit).toBe(false);
    const r = await submit(parent, { medical_condition: 'Asthma' });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toMatch(/April and May/);
    const print = await inject({
      method: 'POST',
      url: `/engagement/mine/profile/${first}/print`,
      headers: h(parent),
    });
    expect(print.statusCode).toBe(201);
    expect(print.json()).toMatchObject({ dataset: 'student_profile', format: 'pdf' });
    expect(print.json().params).toMatchObject({ studentId: first, audience: 'parent' });
    const status = await inject({
      method: 'GET',
      url: `/engagement/mine/exports/${print.json().id}`,
      headers: h(parent),
    });
    expect(status.statusCode).toBe(200);
    const other = await inject({
      method: 'GET',
      url: `/engagement/mine/exports/${print.json().id}`,
      headers: h(stranger),
    });
    expect(other.statusCode).toBe(404);
  });
});
