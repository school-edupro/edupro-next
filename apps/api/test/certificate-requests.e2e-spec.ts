/**
 * Certificate management, phase C (docs/design/87): requests from the parent, student and staff apps — what each may
 * ask for; the approval levels of the type through the workflow engine (the office in one step; the office then the
 * principal for the TC); the fee raised on the student, paid or waived before the issue; reject, withdraw; issuing
 * against the request; the requester's certificates and their PDF.
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

interface Req {
  id: string;
  status: string;
  stage: string;
  waitingWith: string | null;
  fee: number | null;
  certificateIds: string[];
  decisionNote: string | null;
}

describe('certificate requests (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  let teacher: SeededUser;
  let principal: SeededUser;
  let principalEmp: string;
  let teacherEmp: string;
  let sectionId: string;
  const kids: Record<string, string> = {};

  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, json: unknown, u: SeededUser) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('CRQ');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, undefined, 'student');
      teacher = await seedUser(c, school, `${s}-teacher`);
      principal = await seedUser(c, school, `${s}-principal`);
      for (const [u, code, first, desig] of [
        [teacher, 'T01', 'Tara', 'PGT Physics'],
        [principal, 'P01', 'Prem', 'Principal'],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, designation, joined_on)
           VALUES ($1, $2, $3, 'Test', $4, $5, '2020-06-01') RETURNING id::text`,
          [school.id, code, first, u.id, desig],
        );
        if (code === 'T01') teacherEmp = e.rows[0]!.id;
        else principalEmp = e.rows[0]!.id;
      }
    });
    app = await createApp();
    inject = injector(app);
    const k = await post(
      '/academics/classes',
      { code: 'VII', name: 'Class VII', displayOrder: 7 },
      admin,
    );
    const sec = await post(`/academics/classes/${k.json().id}/sections`, { name: 'A' }, admin);
    sectionId = sec.json().id as string;
    let roll = 1;
    for (const [key, first, withParent] of [
      ['anu', 'Anu', true],
      ['ben', 'Ben', false],
      ['cia', 'Cia', false],
    ] as const) {
      const r = await post(
        '/people/students',
        {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Test',
          dob: '2014-02-02',
          gender: 'female',
          guardians: withParent
            ? [
                {
                  guardian: {
                    firstName: 'Pia',
                    lastName: 'Parent',
                    mobile: `98763${String(60000 + roll)}`,
                  },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: sec.json().id, rollNo: roll++ },
        },
        admin,
      );
      if (r.statusCode !== 201) throw new Error(`student ${key}: ${r.statusCode} ${r.body}`);
      kids[key] = r.json().id as string;
    }
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND first_name = 'Pia'`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [pupil.id, kids.ben]);
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('shows each asker what they may ask for: parents, a student, staff', async () => {
    const p = await get('/certificate-requests/mine', parent);
    expect(p.statusCode).toBe(200);
    expect(p.json().students.map((x: { name: string }) => x.name)).toEqual(['Anu Test']);
    const pt = (p.json().types as Array<{ code: string }>).map((t) => t.code);
    expect(pt).toEqual(expect.arrayContaining(['TC', 'BONAFIDE', 'CHARACTER']));
    expect(pt).not.toContain('SERVICE');
    // who decides, in words, for the app's list (16 Nov 2026)
    const types = p.json().types as Array<{ code: string; decidedBy: string[] }>;
    expect(types.every((t) => t.decidedBy.length > 0)).toBe(true);
    expect(types.find((t) => t.code === 'BONAFIDE')?.decidedBy).toEqual(['the office']);
    const st = (await get('/certificate-requests/mine', pupil)).json();
    expect(st.students).toEqual([expect.objectContaining({ name: 'Ben Test', self: true })]);
    expect((st.types as Array<{ code: string }>).map((t) => t.code)).not.toContain('TC');
    const staff = (await get('/certificate-requests/mine', teacher)).json();
    expect(staff.employee).toMatchObject({ code: 'T01' });
    expect((staff.types as Array<{ code: string }>).map((t) => t.code)).toEqual([
      'EXPERIENCE',
      'SERVICE',
      'STAFF_VISA',
    ]);
  });

  it('a parent asks for a bonafide; the office approves it in one step and issues it against the request', async () => {
    // the parent's phone (the mobile app), where the app messages go
    expect(
      (
        await post(
          '/comms/push/devices',
          { token: 'cert-test-phone-token', app: 'mobile', platform: 'android' },
          parent,
        )
      ).statusCode,
    ).toBeLessThan(300);
    const r = await post(
      '/certificate-requests/mine',
      { typeCode: 'BONAFIDE', studentId: kids.anu, purpose: 'Passport application', copies: 2 },
      parent,
    );
    expect(r.statusCode).toBe(201);
    const req = r.json() as Req;
    expect(req).toMatchObject({ status: 'submitted', stage: 'waiting', fee: null });
    expect(req.waitingWith).toMatch(/^Certificate office/);
    const again = await post(
      '/certificate-requests/mine',
      { typeCode: 'BONAFIDE', studentId: kids.anu, purpose: 'Bank' },
      parent,
    );
    expect(again.statusCode).toBe(409);
    const notMine = await post(
      '/certificate-requests/mine',
      { typeCode: 'BONAFIDE', studentId: kids.cia, purpose: 'Bank' },
      parent,
    );
    expect(notMine.statusCode).toBe(404);
    const tooMany = await post(
      '/certificate-requests/mine',
      { typeCode: 'DOB', studentId: kids.anu, purpose: 'Bank', copies: 5 },
      parent,
    );
    expect(tooMany.statusCode).toBe(400);
    // the queue: waiting, and with the office
    const q = await get('/certificate-requests?status=open', office);
    expect(q.json().figures).toMatchObject({ waiting: 1, mine: 1 });
    expect(q.json().rows[0]).toMatchObject({
      id: req.id,
      person: 'Anu Test',
      channel: 'parent',
      copies: 2,
    });
    // its paper before issue reads PENDING while the request waits (17 Nov 2026)
    const markOf = async (requestId: string, typeCode = 'BONAFIDE') =>
      (
        await post(
          '/certificates/preview',
          { typeCode, studentId: kids.anu, purpose: 'Passport application', requestId },
          office,
        )
      ).json() as { mark: string; html: string };
    const waiting = await markOf(req.id);
    expect(waiting.mark).toBe('PENDING');
    expect(waiting.html).toContain('data-mark="PENDING"');
    // the parent cannot decide; the office can
    expect(
      (await post(`/certificate-requests/${req.id}/decide`, { decision: 'approve' }, parent))
        .statusCode,
    ).toBe(409);
    const ok = await post(
      `/certificate-requests/${req.id}/decide`,
      { decision: 'approve' },
      office,
    );
    expect(ok.json()).toMatchObject({ status: 'approved', stage: 'ready' });
    expect((await markOf(req.id)).mark).toBe('PENDING');
    // issued against the request
    const issued = await post(
      '/certificates/issue',
      {
        typeCode: 'BONAFIDE',
        studentId: kids.anu,
        purpose: 'Passport application',
        requestId: req.id,
      },
      office,
    );
    expect(issued.statusCode).toBe(201);
    const mine = (await get('/certificate-requests/mine', parent)).json();
    expect(mine.requests[0]).toMatchObject({ id: req.id, status: 'issued', stage: 'issued' });
    expect(mine.requests[0].certificateIds).toEqual([issued.json().id]);
    expect(mine.certificates[0]).toMatchObject({
      number: 'BON/2026-27/00001',
      person: 'Anu Test',
      purpose: 'Passport application',
      revision: 1,
      award: false,
      achievementId: null,
    });
    // the parent is told in the app: approved, then ready
    // (to the phone, opening the certificates page)
    const told = await withMigrator((c) =>
      c.query<{ code: string; channel: string; to: string; link: string }>(
        `SELECT t.code, m.channel::text AS channel, m.recipient_address AS "to", m.variables->>'link' AS link
           FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND m.recipient_user_id = $2 ORDER BY m.id`,
        [school.id, parent.id],
      ),
    );
    expect(told.rows).toEqual([
      {
        code: 'certificate_request_approved',
        channel: 'push',
        to: 'cert-test-phone-token',
        link: '/certificates',
      },
      {
        code: 'certificate_request_ready',
        channel: 'push',
        to: 'cert-test-phone-token',
        link: '/certificates',
      },
    ]);
    // the parent's own PDF of it
    const pdf = await post(
      `/certificate-requests/mine/certificates/${issued.json().id as string}/pdf`,
      {},
      parent,
    );
    expect(pdf.statusCode).toBe(201);
    const ex = await get(
      `/certificate-requests/mine/exports/${pdf.json().exportId as string}`,
      parent,
    );
    expect(ex.statusCode).toBe(200);
    expect(ex.json().export.dataset).toBe('certificate_doc');
    // the PDF the office made is the one kept for good: the parent gets that same file, not a new one each time
    const kept = await withMigrator((c) =>
      c.query<{ export_id: string | null }>(
        `SELECT export_id::text FROM certificates WHERE id = $1`,
        [issued.json().id],
      ),
    );
    expect(kept.rows[0]!.export_id).toBe(pdf.json().exportId);
    const twiceOpened = await post(
      `/certificate-requests/mine/certificates/${issued.json().id as string}/pdf`,
      {},
      parent,
    );
    expect(twiceOpened.json().exportId).toBe(pdf.json().exportId);
    // not someone else's
    expect(
      (
        await post(
          `/certificate-requests/mine/certificates/${issued.json().id as string}/pdf`,
          {},
          pupil,
        )
      ).statusCode,
    ).toBe(404);
    // a request answered once is closed
    const twice = await post(
      '/certificates/issue',
      { typeCode: 'BONAFIDE', studentId: kids.anu, requestId: req.id },
      office,
    );
    expect(twice.statusCode).toBe(409);
  });

  it('lists an achievement certificate once, marked, and never hands a parent the class batch PDF', async () => {
    const tpl = await withMigrator((c) =>
      c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables)
         VALUES ($1, 'ach_app', 'Achievement', 'certificate', '297mm', '210mm', '<p>{{student.name}}</p>', '', '[]'::jsonb)
         RETURNING id::text`,
        [school.id],
      ),
    );
    const r = await post(
      '/engagement/certificates',
      { templateId: tpl.rows[0]!.id, classSectionId: sectionId, title: 'Best attendance' },
      admin,
    );
    expect(r.statusCode).toBe(201);
    const batchPdf = r.json().exportId as string;
    const mine = (await get('/certificate-requests/mine', parent)).json();
    const awards = (
      mine.certificates as Array<{ id: string; award: boolean; achievementId: string | null }>
    ).filter((x) => x.award);
    // the parent's child only, once (the earlier list's record is the same one)
    expect(awards).toEqual([
      expect.objectContaining({
        typeName: 'Achievement certificate',
        person: 'Anu Test',
        awardText: 'Best attendance',
        achievementId: expect.stringMatching(/^\d+$/),
      }),
    ]);
    // the batch's file prints the whole class: not for a parent
    expect((await get(`/certificate-requests/mine/exports/${batchPdf}`, parent)).statusCode).toBe(
      404,
    );
    const pdf = await post(
      `/certificate-requests/mine/certificates/${awards[0]!.id}/pdf`,
      {},
      parent,
    );
    expect(pdf.statusCode).toBe(201);
    expect(pdf.json()).toMatchObject({ ready: false });
    expect(pdf.json().exportId).not.toBe(batchPdf);
    const ex = await get(
      `/certificate-requests/mine/exports/${pdf.json().exportId as string}`,
      parent,
    );
    expect(ex.statusCode).toBe(200);
    expect(ex.json().export).toMatchObject({ dataset: 'certificate' });
    const made = await withMigrator((c) =>
      c.query<{ params: { certificateId: string } }>(`SELECT params FROM exports WHERE id = $1`, [
        pdf.json().exportId,
      ]),
    );
    expect(made.rows[0]!.params).toEqual({ certificateId: awards[0]!.achievementId });
    // the student of the class without a parent here: not the parent's
    const other = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM certificates WHERE school_id = $1 AND student_id = $2 AND legacy_ref LIKE 'achievement:%'`,
        [school.id, kids.cia],
      ),
    );
    expect(
      (await post(`/certificate-requests/mine/certificates/${other.rows[0]!.id}/pdf`, {}, parent))
        .statusCode,
    ).toBe(404);
  });

  it('runs the TC through the office and then the principal', async () => {
    const set = await inject({
      method: 'PUT',
      url: '/certificates/setup/settings',
      headers: h(admin),
      json: {
        signatoryEmployeeId: principalEmp,
        signatoryTitle: 'Principal',
        printSignature: true,
        printPreparer: true,
      },
    });
    expect(set.statusCode).toBe(200);
    const r = await post(
      '/certificate-requests/mine',
      { typeCode: 'TC', studentId: kids.anu, purpose: 'Moving to another city' },
      parent,
    );
    expect(r.statusCode).toBe(201);
    const id = (r.json() as Req).id;
    // the checks as they stood are kept for the approvers
    const d = await get(`/certificate-requests/${id}`, office);
    expect(d.json().checks.find((x: { key: string }) => x.key === 'state')).toMatchObject({
      ok: false,
    });
    expect(d.json().levels.map((l: { name: string }) => l.name)).toEqual([
      'Certificate office',
      'Principal',
    ]);
    await post(`/certificate-requests/${id}/decide`, { decision: 'approve' }, office);
    const mid = (await get(`/certificate-requests/${id}`, office)).json();
    expect(mid).toMatchObject({ status: 'submitted' });
    expect(mid.waitingWith).toMatch(/^Principal \(.*-principal\)$/);
    expect(
      (await post(`/certificate-requests/${id}/decide`, { decision: 'approve' }, office))
        .statusCode,
    ).toBe(409);
    // the principal sees it although not in the certificate office
    expect((await get(`/certificate-requests/${id}`, principal)).statusCode).toBe(200);
    const done = await post(
      `/certificate-requests/${id}/decide`,
      { decision: 'approve', note: 'Seen' },
      principal,
    );
    expect(done.json()).toMatchObject({ status: 'approved', stage: 'ready' });
    // the issue still checks: on the rolls, no withdrawal — the principal's reason
    const stopped = await post(
      '/certificates/issue',
      { typeCode: 'TC', studentId: kids.anu, requestId: id, fields: { reason: 'Moving' } },
      admin,
    );
    expect(stopped.statusCode).toBe(409);
    const tc = await post(
      '/certificates/issue',
      {
        typeCode: 'TC',
        studentId: kids.anu,
        requestId: id,
        fields: { reason: 'Moving' },
        overrideReason: 'Approved on request; withdrawal to follow',
      },
      admin,
    );
    expect(tc.statusCode).toBe(201);
    expect((await get(`/certificate-requests/${id}`, office)).json().status).toBe('issued');
  });

  it('charges the fee set on the type: issued once it is paid, or the office waives it', async () => {
    const t = (await get('/certificates/setup/types/DOB', admin)).json();
    const bad = await inject({
      method: 'PUT',
      url: '/certificates/setup/types/DOB/requests',
      headers: h(admin),
      json: { ...t.request, open: { parent: true, student: true, staff: true } },
    });
    expect(bad.statusCode).toBe(400);
    const noLevels = await inject({
      method: 'PUT',
      url: '/certificates/setup/types/DOB/requests',
      headers: h(admin),
      json: { ...t.request, levels: [] },
    });
    expect(noLevels.statusCode).toBe(400);
    const fee = await inject({
      method: 'PUT',
      url: '/certificates/setup/types/DOB/requests',
      headers: h(admin),
      json: { ...t.request, fee: 50, purposes: ['School admission', 'Passport'] },
    });
    expect(fee.statusCode).toBe(200);
    expect(fee.json().request).toMatchObject({
      fee: 50,
      purposes: ['School admission', 'Passport'],
    });
    const wrong = await post(
      '/certificate-requests/mine',
      { typeCode: 'DOB', studentId: kids.ben, purpose: 'Bank' },
      pupil,
    );
    expect(wrong.statusCode).toBe(400);
    const r = await post(
      '/certificate-requests/mine',
      { typeCode: 'DOB', studentId: kids.ben, purpose: 'Passport', copies: 2 },
      pupil,
    );
    expect(r.json()).toMatchObject({ fee: 100 });
    const id = (r.json() as Req).id;
    const ok = await post(`/certificate-requests/${id}/decide`, { decision: 'approve' }, office);
    expect(ok.json()).toMatchObject({ status: 'approved', stage: 'fee', feePaid: false });
    const line = await withMigrator((c) =>
      c.query<{ amount: string; status: string; misc_fee_id: string }>(
        `SELECT l.amount::text, l.status, l.misc_fee_id::text FROM misc_fee_students l
           JOIN certificate_requests r ON r.misc_fee_id = l.misc_fee_id WHERE r.id = $1`,
        [id],
      ),
    );
    expect(line.rows[0]).toMatchObject({ amount: '100.00', status: 'open' });
    const early = await post(
      '/certificates/issue',
      { typeCode: 'DOB', studentId: kids.ben, requestId: id },
      office,
    );
    expect(early.statusCode).toBe(409);
    expect(early.json().detail).toMatch(/fee of the request is not paid/);
    // paid at the counter
    await withMigrator((c) =>
      c.query(
        `UPDATE misc_fee_students SET paid = amount, status = 'paid', paid_at = now() WHERE misc_fee_id = $1`,
        [line.rows[0]!.misc_fee_id],
      ),
    );
    expect((await get(`/certificate-requests/${id}`, office)).json()).toMatchObject({
      stage: 'ready',
      feePaid: true,
    });
    expect(
      (
        await post(
          '/certificates/issue',
          { typeCode: 'DOB', studentId: kids.ben, requestId: id },
          office,
        )
      ).statusCode,
    ).toBe(201);

    // another, the fee waived by the office
    const w = await post(
      '/certificate-requests/mine',
      { typeCode: 'DOB', studentId: kids.ben, purpose: 'School admission' },
      pupil,
    );
    const wid = (w.json() as Req).id;
    await post(`/certificate-requests/${wid}/decide`, { decision: 'approve' }, office);
    const waived = await post(
      `/certificate-requests/${wid}/waive-fee`,
      { reason: 'Sibling of staff' },
      office,
    );
    expect(waived.json()).toMatchObject({ stage: 'ready', feeWaived: 'Sibling of staff' });
    const cancelled = await withMigrator((c) =>
      c.query<{ status: string }>(
        `SELECT l.status FROM misc_fee_students l JOIN certificate_requests r ON r.misc_fee_id = l.misc_fee_id WHERE r.id = $1`,
        [wid],
      ),
    );
    expect(cancelled.rows[0]!.status).toBe('cancelled');
  });

  it('rejects with a reason, withdraws, and keeps closed types closed', async () => {
    const s = await post(
      '/certificate-requests/mine',
      { typeCode: 'SERVICE', purpose: 'Home loan' },
      teacher,
    );
    expect(s.statusCode).toBe(201);
    const sid = (s.json() as Req).id;
    expect(
      (await post(`/certificate-requests/${sid}/decide`, { decision: 'reject' }, office))
        .statusCode,
    ).toBe(400);
    const rej = await post(
      `/certificate-requests/${sid}/decide`,
      { decision: 'reject', note: 'Ask HR for the salary certificate instead' },
      office,
    );
    expect(rej.json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Ask HR for the salary certificate instead',
    });
    const c = await post(
      '/certificate-requests/mine',
      { typeCode: 'CHARACTER', studentId: kids.anu, purpose: 'Scholarship' },
      parent,
    );
    const cid = (c.json() as Req).id;
    const wd = await post(`/certificate-requests/mine/${cid}/withdraw`, {}, parent);
    expect(wd.json()).toMatchObject({ status: 'withdrawn' });
    expect((await post(`/certificate-requests/mine/${cid}/withdraw`, {}, parent)).statusCode).toBe(
      409,
    );
    const inst = await withMigrator((x) =>
      x.query<{ status: string }>(
        `SELECT i.status::text FROM workflow_instances i JOIN certificate_requests r ON r.workflow_instance_id = i.id WHERE r.id = $1`,
        [cid],
      ),
    );
    expect(inst.rows[0]!.status).toBe('cancelled');
    // the paper of a rejected or withdrawn request reads REJECTED (17 Nov 2026)
    for (const id of [sid, cid]) {
      const pv = await post(
        '/certificates/preview',
        { typeCode: 'CHARACTER', studentId: kids.anu, purpose: 'Scholarship', requestId: id },
        office,
      );
      expect(pv.json().mark).toBe('REJECTED');
      expect(pv.json().html).toContain('data-mark="REJECTED"');
    }
    // a student cannot ask for the TC; staff cannot ask for a student type
    expect(
      (
        await post(
          '/certificate-requests/mine',
          { typeCode: 'TC', studentId: kids.ben, purpose: 'Leaving' },
          pupil,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await post('/certificate-requests/mine', { typeCode: 'BONAFIDE', purpose: 'Bank' }, teacher))
        .statusCode,
    ).toBe(404);
    // the queue filters: issued, rejected, withdrawn
    for (const [status, n] of [
      ['issued', 3],
      ['rejected', 1],
      ['withdrawn', 1],
    ] as const)
      expect((await get(`/certificate-requests?status=${status}`, office)).json().total).toBe(n);
    // the employee's own record of the decision
    expect(teacherEmp).toMatch(/^\d+$/);
  });
});
