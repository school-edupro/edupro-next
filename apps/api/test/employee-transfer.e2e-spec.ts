/**
 * Staff transfers (0182, docs/design/30-employee-master.md): a campus move inside the school, and a
 * transfer to another school of the group that the target accepts — copied there with the target's code,
 * rows, documents (by type code), subjects and the same login; the source record closes on the date.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

describe('staff transfers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let alpha: SeededSchool;
  let beta: SeededSchool;
  let outsider: SeededSchool;
  let adminA: SeededUser;
  let adminB: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const as = (u: SeededUser, s: SeededSchool) => headersFor(u.sub, s.id);
  const post = (url: string, json: unknown, u: SeededUser, s: SeededSchool) =>
    inject({ method: 'POST', url, headers: as(u, s), json });
  const get = (url: string, u: SeededUser, s: SeededSchool) =>
    inject({ method: 'GET', url, headers: as(u, s) });

  beforeAll(async () => {
    const s = stamp('ST');
    await withMigrator(async (c) => {
      alpha = await seedSchool(c, `${s}A`);
      beta = await seedSchool(c, `${s}B`);
      outsider = await seedSchool(c, `${s}X`);
      const g = await c.query<{ id: string }>(
        `INSERT INTO school_groups (code, name) VALUES ($1, $1) RETURNING id::text`,
        [`${s}G`],
      );
      await c.query(`UPDATE schools SET group_id = $1 WHERE id IN ($2, $3)`, [
        g.rows[0]!.id,
        alpha.id,
        beta.id,
      ]);
      adminA = await seedUser(c, alpha, `${s}-adminA`, 'school_admin');
      adminB = await seedUser(c, beta, `${s}-adminB`, 'school_admin');
      teacher = await seedUser(c, alpha, `${s}-teacher`);
      for (const sc of [alpha, beta]) {
        await c.query(
          `SELECT app.staff_masters_seed($1), app.staff_profile_lists_seed($1), app.employee_document_types_seed($1)`,
          [sc.id],
        );
        await c.query(
          `INSERT INTO campuses (school_id, code, name) VALUES ($1, 'EAST', 'East Wing')`,
          [sc.id],
        );
        await c.query(
          `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'MAT', 'Mathematics')`,
          [sc.id],
        );
      }
      ids.mainA = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM campuses WHERE school_id = $1 AND code = 'MAIN'`,
          [alpha.id],
        )
      ).rows[0]!.id;
      ids.eastA = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM campuses WHERE school_id = $1 AND code = 'EAST'`,
          [alpha.id],
        )
      ).rows[0]!.id;
      ids.eastB = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM campuses WHERE school_id = $1 AND code = 'EAST'`,
          [beta.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    // an Alpha teacher with a login, education, a document and a subject
    const o = await post(
      '/people/staff/onboard',
      {
        values: {
          employee_code: 'AL0100',
          first_name: 'Neha',
          gender: 'Female',
          mobile: '9822200001',
          email: 'neha@alpha.test',
          staff_type: 'Teaching Regular',
          department: 'Teaching Senior',
          designation: 'PGT',
          joined_on: '2020-04-01',
        },
      },
      adminA,
      alpha,
    );
    expect(o.json()).toMatchObject({ login: { made: true } });
    ids.neha = o.json().id;
    await inject({
      method: 'PUT',
      url: `/people/staff/${ids.neha}/profile`,
      headers: as(adminA, alpha),
      json: { changes: { aadhaar: '222233334444', blood_group: 'A+' } },
    });
    await post(
      `/people/staff/${ids.neha}/rows/education`,
      { qualification: 'M.Sc.', passingYear: 2015 },
      adminA,
      alpha,
    );
    const subj = (await get('/people/staff/catalogue', adminA, alpha)).json().subjects[0].id;
    await inject({
      method: 'PUT',
      url: `/people/staff/${ids.neha}/subjects`,
      headers: as(adminA, alpha),
      json: { subjectIds: [subj] },
    });
    const bytes = Buffer.from('%PDF-1.4\n% transfer\n');
    const slot = await post(
      '/platform/files',
      { fileName: 'pan.pdf', contentType: 'application/pdf', sizeBytes: bytes.length },
      adminA,
      alpha,
    );
    await inject({
      method: 'PUT',
      url: slot.json().upload.url,
      headers: {},
      raw: { body: bytes, contentType: 'application/pdf' },
    } as never);
    const docs = (await get(`/people/staff/${ids.neha}/profile`, adminA, alpha)).json().documents
      .types;
    const pan = docs.find((t: { code: string }) => t.code === 'pan').typeId;
    await post(
      `/people/staff/${ids.neha}/documents`,
      { typeId: pan, fileId: slot.json().file.id },
      adminA,
      alpha,
    );
  });
  afterAll(async () => app.close());

  it('a campus move: the posting moves, a transfer row and a remark; the same campus refused; only with the right', async () => {
    const r = await post(
      `/people/staff/${ids.neha}/campus-move`,
      { campusId: ids.eastA, onDate: '2026-10-01', orderNo: 'O/12', designation: 'TGT' },
      adminA,
      alpha,
    );
    expect(r.json()).toMatchObject({ ok: true });
    const p = (await get(`/people/staff/${ids.neha}/profile`, adminA, alpha)).json();
    expect(p.values.designation).toBe('TGT');
    expect(p.rows.transfers[0]).toMatchObject({ toPlace: 'East Wing', orderNo: 'O/12' });
    expect(p.rows.remarks.map((x: { remark: string }) => x.remark).join(' | ')).toContain(
      'Moved to East Wing',
    );
    const again = await post(
      `/people/staff/${ids.neha}/campus-move`,
      { campusId: ids.eastA, onDate: '2026-10-02' },
      adminA,
      alpha,
    );
    expect(again.json().detail).toContain('Already at East Wing');
    expect(
      (
        await post(
          `/people/staff/${ids.neha}/campus-move`,
          { campusId: ids.mainA, onDate: '2026-10-02' },
          teacher,
          alpha,
        )
      ).statusCode,
    ).toBe(403);
  });

  it('to another school of the group: only group schools; one waiting at a time; the target sees it incoming', async () => {
    const targets = (await get('/people/staff-transfers/targets', adminA, alpha)).json().data;
    expect(targets.map((x: { id: string }) => x.id)).toEqual([beta.id]);
    const bad = await post(
      `/people/staff/${ids.neha}/transfer`,
      { toSchoolId: outsider.id, onDate: '2026-10-10' },
      adminA,
      alpha,
    );
    expect(bad.json().detail).toContain('another school of the group');
    const r = await post(
      `/people/staff/${ids.neha}/transfer`,
      { toSchoolId: beta.id, onDate: '2026-10-10', orderNo: 'T/7' },
      adminA,
      alpha,
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      direction: 'outgoing',
      status: 'requested',
      toSchool: expect.any(String),
    });
    expect(r.json().carries).toMatchObject({ documents: 1, education: 1, login: true });
    ids.t = r.json().id;
    const twice = await post(
      `/people/staff/${ids.neha}/transfer`,
      { toSchoolId: beta.id, onDate: '2026-10-11' },
      adminA,
      alpha,
    );
    expect(twice.statusCode).toBe(409);
    const inB = (await get('/people/staff-transfers?box=incoming', adminB, beta)).json().data;
    expect(inB).toEqual([
      expect.objectContaining({
        id: ids.t,
        direction: 'incoming',
        employee: expect.objectContaining({ code: 'AL0100' }),
      }),
    ]);
    // Alpha cannot accept its own outgoing transfer
    expect(
      (
        await post(
          `/people/staff-transfers/${ids.t}/accept`,
          { department: 'Accounts', designation: 'PGT', staffType: 'Teaching Regular' },
          adminA,
          alpha,
        )
      ).statusCode,
    ).toBe(404);
  });

  it('the target accepts: a Beta employee with Beta code, the rows, documents, subject and the same login; Alpha closes on the date', async () => {
    const bad = await post(
      `/people/staff-transfers/${ids.t}/accept`,
      { department: 'Nowhere', designation: 'PGT', staffType: 'Teaching Regular' },
      adminB,
      beta,
    );
    expect(bad.json().detail).toContain('Department');
    const r = await post(
      `/people/staff-transfers/${ids.t}/accept`,
      {
        code: 'BE0001',
        department: 'Teaching Senior',
        designation: 'PGT',
        staffType: 'Teaching Regular',
        campusId: ids.eastB,
      },
      adminB,
      beta,
    );
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: 'accepted', docsLeft: [] });
    const newId = r.json().toEmployeeId as string;
    const p = (await get(`/people/staff/${newId}/profile`, adminB, beta)).json();
    expect(p.values).toMatchObject({
      employee_code: 'BE0001',
      first_name: 'NEHA',
      blood_group: 'A+',
      joined_on: '2020-04-01',
      designation: 'PGT',
    });
    expect(p.hasLogin).toBe(true);
    expect(p.rows.education).toEqual([expect.objectContaining({ qualification: 'M.Sc.' })]);
    expect(p.rows.transfers.map((x: { toPlace: string }) => x.toPlace)).toContain('East Wing');
    expect(p.rows.transfers[0].remarks).toContain('Transferred in (was AL0100)');
    expect(p.subjects.map((x: { name: string }) => x.name)).toEqual(['Mathematics']);
    expect(p.documents.types.find((t: { code: string }) => t.code === 'pan').done).toBe(true);
    // the file was copied into Beta (its own file row)
    const doc = p.documents.types.find((t: { code: string }) => t.code === 'pan').files[0];
    expect(
      (await get(`/people/staff/${newId}/documents/${doc.id}/file`, adminB, beta)).statusCode,
    ).toBe(200);
    await withMigrator(async (c) => {
      const src = await c.query(`SELECT status::text, left_on::text FROM employees WHERE id = $1`, [
        ids.neha,
      ]);
      expect(src.rows[0]).toEqual({ status: 'inactive', left_on: '2026-10-10' });
      const tr = await c.query<{ to_place: string }>(
        `SELECT to_place FROM employee_transfers WHERE employee_id = $1 ORDER BY id DESC LIMIT 1`,
        [ids.neha],
      );
      expect(tr.rows[0]!.to_place).toBe(beta.code);
      const m = await c.query<{ school_id: string; status: string }>(
        `SELECT m.school_id::text, m.status::text FROM user_school_memberships m JOIN employees e ON e.user_id = m.user_id
          WHERE e.id = $1 AND m.person_type = 'employee' ORDER BY m.school_id`,
        [ids.neha],
      );
      expect(m.rows).toEqual(
        expect.arrayContaining([
          { school_id: alpha.id, status: 'inactive' },
          { school_id: beta.id, status: 'active' },
        ]),
      );
    });
    // decided once
    expect(
      (await post(`/people/staff-transfers/${ids.t}/reject`, { reason: 'too late' }, adminB, beta))
        .statusCode,
    ).toBe(409);
  });

  it('reject by the target, cancel by the source only', async () => {
    const o = await post(
      '/people/staff/onboard',
      {
        values: {
          first_name: 'Ravi',
          gender: 'Male',
          mobile: '9822200002',
          staff_type: 'Non-Teaching Regular',
          department: 'Accounts',
          designation: 'Accountant',
          joined_on: '2021-01-01',
        },
        createLogin: false,
      },
      adminA,
      alpha,
    );
    const t1 = (
      await post(
        `/people/staff/${o.json().id}/transfer`,
        { toSchoolId: beta.id, onDate: '2026-11-01' },
        adminA,
        alpha,
      )
    ).json().id;
    expect(
      (await post(`/people/staff-transfers/${t1}/reject`, { reason: 'no post' }, adminA, alpha))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(`/people/staff-transfers/${t1}/reject`, { reason: 'no post here' }, adminB, beta)
      ).json(),
    ).toMatchObject({ status: 'rejected' });
    const t2 = (
      await post(
        `/people/staff/${o.json().id}/transfer`,
        { toSchoolId: beta.id, onDate: '2026-11-01' },
        adminA,
        alpha,
      )
    ).json().id;
    expect(
      (await post(`/people/staff-transfers/${t2}/cancel`, { reason: 'changed' }, adminB, beta))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `/people/staff-transfers/${t2}/cancel`,
          { reason: 'changed our mind' },
          adminA,
          alpha,
        )
      ).json(),
    ).toMatchObject({ status: 'cancelled' });
  });
});
