/**
 * Employee self-service profile (0186, docs/design/33-people-dashboards.md): the employee's own view, the
 * school's policy (levels, proofs, window, approvers), changes at once or for approval, routing to the L1
 * approver, field-by-field decisions, refusal with a reason, withdrawal, and the own-copy PDF.
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

describe('employee self-service profile (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let hod: SeededUser;
  let other: SeededUser;
  let teacherEmp = '';
  let panType = '';
  let fileId = '';
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });

  beforeAll(async () => {
    const s = stamp('ESS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
      hod = await seedUser(c, school, `${s}-hod`, 'subject_teacher');
      other = await seedUser(c, school, `${s}-other`, 'subject_teacher');
      await c.query(`SELECT app.employee_document_types_seed($1)`, [school.id]);
      panType = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM employee_document_types WHERE school_id = $1 AND code = 'pan'`,
          [school.id],
        )
      ).rows[0]!.id;
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, user_id, employee_type, mobile)
         VALUES ($1, 'H1', 'Hema', $2, 'teaching', '9800000011'), ($1, 'O1', 'Om', $3, 'teaching', '9800000012')
         RETURNING id::text`,
        [school.id, hod.id, other.id],
      );
      const t = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, user_id, employee_type, mobile, profile)
         VALUES ($1, 'T1', 'Tara', $2, 'teaching', '9800000010', jsonb_build_object('approver_l1', $3::text))
         RETURNING id::text`,
        [school.id, teacher.id, e.rows[0]!.id],
      );
      teacherEmp = t.rows[0]!.id;
      fileId = (
        await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
           VALUES ($1, 'test', $2, 'application/pdf', 1200, 'pan.pdf', 'ready', $3) RETURNING id::text`,
          [school.id, `${s}/pan.pdf`, teacher.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  it('the employee sees their own profile; office-only fields are never editable; non-staff have none', async () => {
    const r = await call(teacher, 'GET', '/me/employee-profile');
    expect(r.statusCode).toBe(200);
    const fields = (
      r.json().sections as Array<{ fields: Array<{ key: string; level: string }> }>
    ).flatMap((s) => s.fields);
    const level = (k: string) => fields.find((f) => f.key === k)?.level;
    expect(level('mobile')).toBe('edit_approval');
    expect(level('employee_code')).toBe('view');
    expect(level('department')).toBe('view');
    expect(level('acr_hod')).toBeUndefined(); // hidden
    expect(r.json().canEdit).toBe(true);
    expect((await call(admin, 'GET', '/me/employee-profile')).statusCode).toBe(404);
  });

  it('the school sets levels, a proof, and the approver; staff cannot see the policy', async () => {
    expect((await call(teacher, 'GET', '/people/staff-profile/policy')).statusCode).toBe(403);
    const p = (await call(admin, 'GET', '/people/staff-profile/policy')).json();
    const put = await call(admin, 'PUT', '/people/staff-profile/policy', {
      fields: {
        ...p.policy.fields,
        personal_email: 'edit_direct',
        mobile: 'edit_approval',
        pan: 'edit_approval',
      },
      proofs: { pan: panType },
      window: { mode: 'open' },
      approval: {
        default: [{ kind: 'office' }],
        sections: {},
        fields: { mobile: [{ kind: 'l1' }] },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().proofs).toEqual({ pan: panType });
  });

  it('changes: at once, for approval, refused keys, nothing new, already waiting, a proof needed', async () => {
    const office = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { employee_code: 'X9' },
    });
    expect(office.statusCode).toBe(422);
    const r = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { personal_email: 'tara.home@example.test', mobile: '9811111111' },
      reason: 'New number',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ applied: ['personal_email'], pending: ['mobile'] });
    const same = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { personal_email: 'tara.home@example.test' },
    });
    expect(same.statusCode).toBe(400);
    const again = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { mobile: '9822222222' },
    });
    expect(again.statusCode).toBe(409);
    const noProof = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { pan: 'ABCDE1234F' },
    });
    expect(noProof.statusCode).toBe(400);
    const withProof = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { pan: 'ABCDE1234F' },
      proofs: [{ typeId: panType, fileId }],
    });
    expect(withProof.statusCode).toBe(201);
    const mine = (await call(teacher, 'GET', '/me/employee-profile')).json();
    expect(mine.requests.filter((x: { status: string }) => x.status === 'pending')).toHaveLength(2);
    // the employee sees their own PAN in full in their requests
    const panReq = mine.requests.find(
      (x: { fields: Array<{ key: string }> }) => x.fields[0]!.key === 'pan',
    );
    expect(panReq.fields[0].to).toBe('ABCDE1234F');
  });

  it('the L1 approver decides the mobile; the office refuses the PAN with a reason; the record follows', async () => {
    const box = (await call(hod, 'GET', '/people/staff-profile-approvals')).json();
    expect(box.awaitingMe).toBe(1);
    const mobile = box.data[0];
    expect(mobile.fields[0]).toMatchObject({ key: 'mobile', from: '9800000010', to: '9811111111' });
    // another teacher cannot decide it
    expect(
      (
        await call(other, 'POST', `/people/staff-profile-approvals/${mobile.id as string}/decide`, {
          approve: true,
        })
      ).statusCode,
    ).toBe(403);
    const ok = await call(
      hod,
      'POST',
      `/people/staff-profile-approvals/${mobile.id as string}/decide`,
      { approve: true },
    );
    expect(ok.json()).toEqual({ status: 'approved', nextStep: null });
    const all = (await call(admin, 'GET', '/people/staff-profile-approvals?box=all')).json();
    const pan = all.data.find(
      (x: { fields: Array<{ key: string }> }) => x.fields[0]!.key === 'pan',
    );
    // masked for a reviewer without the sensitive-data right
    expect(pan.fields[0].to).toBe('XXXXXX234F');
    expect(pan.proofs[0]).toMatchObject({ fileName: 'pan.pdf' });
    expect(
      (
        await call(admin, 'POST', `/people/staff-profile-approvals/${pan.id as string}/decide`, {
          approve: false,
        })
      ).statusCode,
    ).toBe(400);
    const no = await call(
      admin,
      'POST',
      `/people/staff-profile-approvals/${pan.id as string}/decide`,
      {
        approve: false,
        note: 'The PAN card is not readable',
      },
    );
    expect(no.json().status).toBe('rejected');
    const rec = await withMigrator((c) =>
      c.query<{ mobile: string; email: string | null }>(
        `SELECT mobile, profile->>'personal_email' AS email FROM employees WHERE id = $1`,
        [teacherEmp],
      ),
    );
    expect(rec.rows[0]).toEqual({ mobile: '9811111111', email: 'tara.home@example.test' });
  });

  it('a request is withdrawn; a closed window stops new ones; the own PDF is requested', async () => {
    const r = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { mobile: '9833333333' },
    });
    const id = r.json().requests[0] as string;
    expect(
      (await call(teacher, 'POST', `/me/employee-change-requests/${id}/cancel`)).json(),
    ).toEqual({ status: 'cancelled' });
    expect(
      (await call(teacher, 'POST', `/me/employee-change-requests/${id}/cancel`)).statusCode,
    ).toBe(409);
    const p = (await call(admin, 'GET', '/people/staff-profile/policy')).json().policy;
    await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...p,
      window: { mode: 'closed', message: 'Updates reopen in April' },
    });
    const closed = await call(teacher, 'POST', '/me/employee-profile/changes', {
      changes: { mobile: '9844444444' },
    });
    expect(closed.statusCode).toBe(409);
    expect((await call(teacher, 'GET', '/me/employee-profile')).json()).toMatchObject({
      canEdit: false,
      window: { open: false, message: 'Updates reopen in April' },
    });
    const pdf = await call(teacher, 'POST', '/me/employee-profile/print');
    expect(pdf.statusCode).toBe(201);
    const exp = await withMigrator((c) =>
      c.query<{ params: { employeeId: string; self: boolean } }>(
        'SELECT params FROM exports WHERE id = $1',
        [pdf.json().id],
      ),
    );
    expect(exp.rows[0]!.params).toEqual({ employeeId: teacherEmp, self: true });
    expect((await call(teacher, 'GET', `/me/exports/${pdf.json().id as string}`)).statusCode).toBe(
      200,
    );
    expect((await call(other, 'GET', `/me/exports/${pdf.json().id as string}`)).statusCode).toBe(
      404,
    );
  });

  it('photo (0188): the employee asks for a new photo with approval, HR accepts and the record follows; at once when allowed; only own images', async () => {
    const img = async (name: string) =>
      (
        await withMigrator((c) =>
          c.query<{ id: string }>(
            `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
             VALUES ($1, 'test', $2, 'image/jpeg', 2400, $3, 'ready', $4) RETURNING id::text`,
            [school.id, `${stamp('ESSP')}/${name}`, name, teacher.id],
          ),
        )
      ).rows[0]!.id;
    const photo1 = await img('me.jpg');
    // the window was closed by the case before: open it; the photo goes with approval by the office
    const before = (await call(admin, 'GET', '/people/staff-profile/policy')).json().policy;
    await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...before,
      window: { mode: 'open' },
    });
    const pol = (await call(admin, 'GET', '/people/staff-profile/policy')).json();
    expect(pol.policy.photo).toBe('edit_approval');
    const mine = (await call(teacher, 'GET', '/me/employee-profile')).json();
    expect(mine.photo).toEqual({ fileId: null, level: 'edit_approval', pending: null });
    // only an own image: the PDF proof file is refused
    const pdf = await call(teacher, 'POST', '/me/employee-profile/changes', { photo: fileId });
    expect(pdf.statusCode).toBe(400);
    const ask = await call(teacher, 'POST', '/me/employee-profile/changes', { photo: photo1 });
    expect(ask.statusCode).toBe(201);
    expect(ask.json().pending).toEqual(['photo']);
    expect((await call(teacher, 'GET', '/me/employee-profile')).json().photo.pending).toBe(photo1);
    // the signed address of the one waiting; not a stranger's file
    expect(
      (await call(teacher, 'GET', `/me/employee-profile/photo?file=${photo1}`)).statusCode,
    ).toBe(200);
    expect((await call(other, 'GET', `/me/employee-profile/photo?file=${photo1}`)).statusCode).toBe(
      404,
    );
    // asked twice: refused while waiting
    expect(
      (await call(teacher, 'POST', '/me/employee-profile/changes', { photo: photo1 })).statusCode,
    ).toBe(409);
    const inbox = (await call(admin, 'GET', '/people/staff-profile-approvals?box=mine')).json();
    const req = inbox.data.find((r: { photo: { to: string } | null }) => r.photo?.to === photo1);
    expect(req).toBeTruthy();
    expect(req.fields[0]).toMatchObject({
      key: 'photo',
      label: 'Photo',
      from: null,
      to: 'New photo',
    });
    // the approver sees the new photo through the request
    expect(
      (await call(admin, 'GET', `/people/staff-profile-approvals/${req.id}/proofs/${photo1}`))
        .statusCode,
    ).toBe(200);
    const ok = await call(admin, 'POST', `/people/staff-profile-approvals/${req.id}/decide`, {
      approve: true,
    });
    expect(ok.statusCode).toBe(200);
    const onFile = await withMigrator((c) =>
      c.query<{ photo: string | null; docs: string }>(
        `SELECT e.photo_file_id::text AS photo,
                (SELECT count(*) FROM person_documents d WHERE d.person_id = e.id AND d.person_type = 'employee' AND d.kind = 'photo')::text AS docs
           FROM employees e WHERE e.id = $1`,
        [teacherEmp],
      ),
    );
    expect(onFile.rows[0]).toEqual({ photo: photo1, docs: '1' });
    expect((await call(teacher, 'GET', '/me/employee-profile/photo')).statusCode).toBe(200);
    // at once when the school allows it
    const put = await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...pol.policy,
      fields: { ...pol.policy.fields, photo: 'edit_direct' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().photo).toBe('edit_direct');
    const photo2 = await img('me2.jpg');
    const now = await call(teacher, 'POST', '/me/employee-profile/changes', { photo: photo2 });
    expect(now.statusCode).toBe(201);
    expect(now.json().applied).toEqual(['photo']);
    expect((await call(teacher, 'GET', '/me/employee-profile')).json().photo.fileId).toBe(photo2);
    // shown only: the office changes it
    await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...pol.policy,
      fields: { ...pol.policy.fields, photo: 'view' },
    });
    const no = await call(teacher, 'POST', '/me/employee-profile/changes', { photo: photo1 });
    expect(no.statusCode).toBe(422);
    await call(admin, 'PUT', '/people/staff-profile/policy', pol.policy);
  });

  it('lists (0187): a language at once, education and a document with approval, an experience row changed and a removal refused', async () => {
    const base = (await call(admin, 'GET', '/people/staff-profile/policy')).json().policy;
    const put = await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...base,
      window: { mode: 'open' },
      lists: {
        education: { level: 'edit_approval', proof: panType },
        languages: { level: 'edit_direct' },
        experience: { level: 'edit_approval' },
        documents: { level: 'edit_approval' },
      },
      // education and documents go to the L1 approver; experience to the office; the default stays office
      approval: {
        ...base.approval,
        sections: {
          'list:education': [{ kind: 'l1' }],
          'list:documents': [{ kind: 'l1' }],
          'list:experience': [{ kind: 'office' }],
        },
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().lists.education).toEqual({ level: 'edit_approval', proof: panType });
    const mine0 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    expect(mine0.lists.map((l: { id: string; level: string }) => [l.id, l.level])).toEqual([
      ['education', 'edit_approval'],
      ['languages', 'edit_direct'],
      ['experience', 'edit_approval'],
      ['documents', 'edit_approval'],
    ]);
    expect(mine0.lists[0].proof).toEqual({ typeId: panType, name: expect.any(String) });

    // a language saves at once
    const lang = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [
        {
          kind: 'languages',
          op: 'add',
          data: { language: 'Hindi', canRead: true, canSpeak: true },
        },
      ],
    });
    expect(lang.statusCode).toBe(201);
    expect(lang.json().applied[0]).toMatch(/^list:languages:add:/);
    const mine1 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const langs = mine1.lists.find((l: { id: string }) => l.id === 'languages');
    expect(langs.rows).toHaveLength(1);
    expect(langs.rows[0].summary).toBe('Hindi: read, speak');
    expect(langs.rows[0].values).toMatchObject({
      language: 'Hindi',
      canRead: true,
      canWrite: false,
    });

    // education needs its proof, then waits for the L1 approver
    const edu = {
      qualification: 'B.Ed',
      institution: 'Pune University',
      passingYear: 2010,
      score: '72%',
    };
    const noProof = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [{ kind: 'education', op: 'add', data: edu }],
    });
    expect(noProof.statusCode).toBe(400);
    expect(noProof.json().type).toBe('people.profile.proof_required');
    const eduReq = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [{ kind: 'education', op: 'add', data: edu }],
      proofs: [{ typeId: panType, fileId }],
    });
    expect(eduReq.statusCode).toBe(201);
    expect(eduReq.json().pending[0]).toMatch(/^list:education:add:/);
    const mine2 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const edu2 = mine2.lists.find((l: { id: string }) => l.id === 'education');
    expect(edu2.rows).toHaveLength(0);
    expect(edu2.pendingAdds).toHaveLength(1);
    expect(edu2.pendingAdds[0].summary).toBe('B.Ed, Pune University, 2010, 72%');
    const box = (await call(hod, 'GET', '/people/staff-profile-approvals')).json();
    const waiting = box.data.find((q: { fields: Array<{ key: string }> }) =>
      q.fields.some((f) => f.key.startsWith('list:education:add:')),
    );
    expect(waiting).toBeDefined();
    expect(waiting.fields[0]).toMatchObject({
      label: 'Education · add',
      from: null,
      to: 'B.Ed, Pune University, 2010, 72%',
    });
    const ok = await call(hod, 'POST', `/people/staff-profile-approvals/${waiting.id}/decide`, {
      approve: true,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('approved');
    const mine3 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const edu3 = mine3.lists.find((l: { id: string }) => l.id === 'education');
    expect(edu3.rows).toHaveLength(1);
    expect(edu3.rows[0].values).toMatchObject({ qualification: 'B.Ed', passingYear: 2010 });
    expect(edu3.pendingAdds).toHaveLength(0);
    // the proof became a document on the record
    const docs = await withMigrator((c) =>
      c.query(
        `SELECT 1 FROM employee_documents WHERE employee_id = $1 AND file_id = $2 AND deleted_at IS NULL`,
        [teacherEmp, fileId],
      ),
    );
    expect(docs.rowCount).toBe(1);

    // an experience row on file: the employee changes it (office approves), then asks to remove it (office refuses)
    const expRow = await withMigrator((c) =>
      c.query<{ id: string }>(
        `INSERT INTO employee_experience (school_id, employee_id, organisation, designation, from_on, to_on)
         VALUES ($1, $2, 'Old School', 'PRT', '2015-06-01', '2018-03-31') RETURNING id::text`,
        [school.id, teacherEmp],
      ),
    );
    const rowId = expRow.rows[0]!.id;
    const edit = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [
        {
          kind: 'experience',
          op: 'edit',
          rowId,
          data: {
            organisation: 'Old School',
            designation: 'TGT',
            fromOn: '2015-06-01',
            toOn: '2018-03-31',
          },
        },
      ],
    });
    expect(edit.statusCode).toBe(201);
    const again = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [{ kind: 'experience', op: 'remove', rowId }],
    });
    expect(again.statusCode).toBe(409);
    const mine4 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const exp4 = mine4.lists.find((l: { id: string }) => l.id === 'experience');
    expect(exp4.rows[0].pending).toMatchObject({ op: 'edit' });
    // routed to the office (the list's own approvers), not to the L1 approver
    const hodBox = (await call(hod, 'GET', '/people/staff-profile-approvals')).json();
    expect(
      hodBox.data.some((q: { fields: Array<{ key: string }> }) =>
        q.fields.some((f) => f.key.startsWith('list:experience:')),
      ),
    ).toBe(false);
    const officeBox = (await call(admin, 'GET', '/people/staff-profile-approvals')).json();
    const expReq = officeBox.data.find((q: { fields: Array<{ key: string }> }) =>
      q.fields.some((f) => f.key.startsWith('list:experience:edit:')),
    );
    expect(expReq.fields[0]).toMatchObject({
      label: 'Work experience · change',
      from: 'Old School – PRT, 01-06-2015 to 31-03-2018',
      to: 'Old School – TGT, 01-06-2015 to 31-03-2018',
    });
    expect(
      (
        await call(admin, 'POST', `/people/staff-profile-approvals/${expReq.id}/decide`, {
          approve: true,
        })
      ).json().status,
    ).toBe('approved');
    const mine5 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    expect(
      mine5.lists.find((l: { id: string }) => l.id === 'experience').rows[0].values.designation,
    ).toBe('TGT');
    const removal = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [{ kind: 'experience', op: 'remove', rowId }],
    });
    expect(removal.statusCode).toBe(201);
    const rmReq = (await call(admin, 'GET', '/people/staff-profile-approvals'))
      .json()
      .data.find((q: { fields: Array<{ key: string }> }) =>
        q.fields.some((f) => f.key.startsWith('list:experience:remove:')),
      );
    expect(rmReq.fields[0]).toMatchObject({ label: 'Work experience · remove', to: '(removed)' });
    const refused = await call(
      admin,
      'POST',
      `/people/staff-profile-approvals/${rmReq.id}/decide`,
      {
        approve: false,
        note: 'Keep it; HR holds the relieving letter',
      },
    );
    expect(refused.json().status).toBe('rejected');
    const mine6 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const exp6 = mine6.lists.find((l: { id: string }) => l.id === 'experience');
    expect(exp6.rows).toHaveLength(1);
    expect(exp6.rows[0].pending).toBeNull();

    // a document: the employee's own file, approved by the L1 approver, filed unverified
    const file2 = await withMigrator((c) =>
      c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'test', $2, 'image/jpeg', 2200, 'pan-card.jpg', 'ready', $3) RETURNING id::text`,
        [school.id, `${stamp('ESS2')}/pan-card.jpg`, teacher.id],
      ),
    );
    const docReq = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [
        {
          kind: 'documents',
          op: 'add',
          data: {
            typeId: panType,
            fileId: file2.rows[0]!.id,
            number: 'ABCDE1234F',
            expiresOn: '2032-01-01',
          },
        },
      ],
    });
    expect(docReq.statusCode).toBe(201);
    const docWait = (await call(hod, 'GET', '/people/staff-profile-approvals'))
      .json()
      .data.find((q: { fields: Array<{ key: string }> }) =>
        q.fields.some((f) => f.key.startsWith('list:documents:add:')),
      );
    expect(docWait.fields[0].to).toMatch(/ABCDE1234F/);
    expect(docWait.fields[0].to).not.toMatch(/pan-card/);
    const panId = file2.rows[0]!.id;
    expect(docWait.fields[0].file).toBe(panId);
    // the approver opens the file through the request; the employee through their own files
    expect(
      (await call(admin, 'GET', `/people/staff-profile-approvals/${docWait.id}/proofs/${panId}`))
        .statusCode,
    ).toBe(200);
    expect((await call(teacher, 'GET', `/me/employee-profile/files/${panId}`)).statusCode).toBe(
      200,
    );
    expect((await call(other, 'GET', `/me/employee-profile/files/${panId}`)).statusCode).toBe(404);
    await call(hod, 'POST', `/people/staff-profile-approvals/${docWait.id}/decide`, {
      approve: true,
    });
    const mine7 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    const docs7 = mine7.lists.find((l: { id: string }) => l.id === 'documents');
    const added = docs7.rows.find(
      (r: { values: { fileId: string } }) => r.values.fileId === file2.rows[0]!.id,
    );
    expect(added.values).toMatchObject({
      number: 'ABCDE1234F',
      verified: false,
      fileName: 'pan-card.jpg',
    });

    // a hidden list is neither shown nor changeable
    await call(admin, 'PUT', '/people/staff-profile/policy', {
      ...base,
      window: { mode: 'open' },
      lists: { languages: { level: 'hidden' } },
    });
    const mine8 = (await call(teacher, 'GET', '/me/employee-profile')).json();
    expect(mine8.lists.map((l: { id: string }) => l.id)).toEqual([
      'education',
      'experience',
      'documents',
    ]);
    const hidden = await call(teacher, 'POST', '/me/employee-profile/changes', {
      rows: [{ kind: 'languages', op: 'add', data: { language: 'Marathi' } }],
    });
    expect(hidden.statusCode).toBe(422);
  });
});
