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
});
