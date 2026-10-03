/**
 * Sprint 19: scheduled reports, MIS centre and group view, the last approvals on the workflow engine
 * (appointments, gate passes, CCTV requests, employee queries), visitors, consent forms with a fee,
 * certificates, the clinic, and the shadow-run closure of the M3 gate.
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

describe('engagement plus, scheduled reports, MIS and the shadow close (e2e, Sprint 19)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let coordinator: SeededUser;
  let parent: SeededUser;
  let groupAdmin: SeededUser;
  let s: string;
  let sectionId: string;
  let studentId: string;
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);

  beforeAll(async () => {
    s = stamp('S19');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      groupAdmin = await seedUser(c, school, `${s}-group`, 'group_admin');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T19', 'Tara', 'Nineteen', $2)`,
        [school.id, teacher.id],
      );
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'C19', 'Chitra', 'Nineteen', $2)`,
        [school.id, coordinator.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Aanya',
        lastName: 'Nineteen',
        guardians: [
          {
            guardian: { firstName: 'Rohit', lastName: 'Nineteen', mobile: '9876519001' },
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
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876519001' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T19'`,
        [school.id],
      ),
    );
    const ta = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.rows[0]!.id, classSectionId: sectionId, kind: 'class_teacher' },
    });
    expect(ta.statusCode).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  const inboxOf = async (u: SeededUser) =>
    (await inject({ method: 'GET', url: '/workflow/inbox', headers: h(u) })).json().data as Array<{
      id: string;
      instance: { entityType: string; entityId: string; subject: string };
    }>;

  describe('the last approvals on the workflow engine', () => {
    it('installs the four Sprint 19 definitions with the defaults', async () => {
      const r = await inject({
        method: 'POST',
        url: '/workflow/definitions/defaults',
        headers: h(),
      });
      expect(r.statusCode).toBe(201);
      const codes = (r.json().data as Array<{ code: string }>).map((d) => d.code);
      for (const code of ['appointment_request', 'gate_pass', 'cctv_request', 'employee_query'])
        expect(codes).toContain(code);
    });

    // appointments moved to slots and the front desk in 0059: see appointments.e2e-spec.ts

    it('a gate pass raised by the family is numbered once the class teacher issues it', async () => {
      const req = await inject({
        method: 'POST',
        url: '/engagement/mine/gate-passes',
        headers: h(parent),
        json: {
          studentId,
          kind: 'early_leave',
          reason: 'Dentist',
          escortName: 'Rohit Nineteen',
          escortRelation: 'father',
          escortMobile: '9876519001',
        },
      });
      expect(req.statusCode).toBe(201);
      expect(req.json().passNo).toBeNull();
      const item = (await inboxOf(teacher)).find(
        (i) => i.instance.entityType === 'gate_pass' && i.instance.entityId === req.json().id,
      );
      expect(item).toBeDefined();
      await inject({
        method: 'POST',
        url: `/workflow/steps/${item!.id}/approve`,
        headers: h(teacher),
        json: {},
      });
      const list = await inject({
        method: 'GET',
        url: '/engagement/gate-passes?status=approved',
        headers: h(),
      });
      const p = (
        list.json().data as Array<{ id: string; passNo: string | null; status: string }>
      ).find((x) => x.id === req.json().id);
      expect(p?.status).toBe('approved');
      expect(p?.passNo).toMatch(/^GP\/\d{4}\/\d{5}$/);
      // the family cannot raise a pass for a pupil that is not theirs
      const other = await inject({
        method: 'POST',
        url: '/engagement/mine/gate-passes',
        headers: h(parent),
        json: { studentId: '999999999', kind: 'early_leave', reason: 'x' },
      });
      expect([400, 403, 404]).toContain(other.statusCode);
    });

    it('CCTV requests and employee queries go to the school admin and the coordinator', async () => {
      const cctv = await inject({
        method: 'POST',
        url: '/engagement/cctv',
        headers: h(),
        json: {
          camera: 'Gate 2',
          fromAt: '2026-09-28T07:30',
          toAt: '2026-09-28T08:00',
          reason: 'Lost bag enquiry',
        },
      });
      expect(cctv.statusCode).toBe(201);
      const step = (await inboxOf(admin)).find(
        (i) => i.instance.entityType === 'cctv_request' && i.instance.entityId === cctv.json().id,
      );
      expect(step).toBeDefined();
      await inject({
        method: 'POST',
        url: `/workflow/steps/${step!.id}/reject`,
        headers: h(),
        json: { note: 'Outside retention' },
      });
      const list = await inject({ method: 'GET', url: '/engagement/cctv', headers: h() });
      expect(
        (
          list.json().data as Array<{ id: string; status: string; decisionNote: string | null }>
        ).find((x) => x.id === cctv.json().id),
      ).toMatchObject({
        status: 'rejected',
        decisionNote: 'Outside retention',
      });

      const q = await inject({
        method: 'POST',
        url: '/engagement/employee-queries',
        headers: h(teacher),
        json: {
          category: 'leave',
          subject: 'Leave balance',
          detail: 'How many casual leaves remain this year?',
        },
      });
      expect(q.statusCode).toBe(201);
      const qs = (await inboxOf(coordinator)).find(
        (i) => i.instance.entityType === 'employee_query' && i.instance.entityId === q.json().id,
      );
      expect(qs).toBeDefined();
      await inject({
        method: 'POST',
        url: `/workflow/steps/${qs!.id}/approve`,
        headers: h(coordinator),
        json: { note: 'Seven remain.' },
      });
      const mine = await inject({
        method: 'GET',
        url: '/engagement/employee-queries/mine',
        headers: h(teacher),
      });
      expect(
        (mine.json().data as Array<{ id: string; status: string; answer: string | null }>).find(
          (x) => x.id === q.json().id,
        ),
      ).toMatchObject({
        status: 'approved',
        answer: 'Seven remain.',
      });
    });
  });

  describe('visitors, consent forms, certificates and the clinic', () => {
    it('signs a visitor in and out; the id-proof number is never stored', async () => {
      const inn = await inject({
        method: 'POST',
        url: '/engagement/visitors',
        headers: h(),
        json: {
          visitorName: 'Meera Iyer',
          mobile: '9812345678',
          purpose: 'Textbook samples',
          toMeet: 'Coordinator',
          idProofKind: 'Aadhaar',
          badgeNo: 'V-1',
        },
      });
      expect(inn.statusCode).toBe(201);
      expect(JSON.stringify(inn.json())).not.toMatch(/idProofNumber|aadhaarNo/);
      const out = await inject({
        method: 'POST',
        url: `/engagement/visitors/${inn.json().id}/out`,
        headers: h(),
      });
      expect(out.statusCode).toBe(201);
      expect(out.json().ok).toBe(true);
      const again = await inject({
        method: 'POST',
        url: `/engagement/visitors/${inn.json().id}/out`,
        headers: h(),
      });
      expect(again.statusCode).toBe(404);
    });

    it('a consent form with a fee: the family signs, gets a payment intent, pays on the mock gateway', async () => {
      const form = await inject({
        method: 'POST',
        url: '/engagement/consent-forms',
        headers: h(),
        json: {
          code: 'trip',
          title: 'Science City trip',
          fields: [
            { key: 'allow', label: 'I allow', type: 'yesno', required: true },
            {
              key: 'pickup',
              label: 'Pick-up',
              type: 'choice',
              options: ['Bus', 'Gate'],
              required: true,
            },
          ],
          feeAmount: 350,
        },
      });
      expect(form.statusCode).toBe(201);
      const formId = form.json().id as string;
      // a draft form is not visible to families
      const hidden = await inject({
        method: 'GET',
        url: '/engagement/mine/consent-forms',
        headers: h(parent),
      });
      expect((hidden.json().forms as Array<{ id: string }>).some((f) => f.id === formId)).toBe(
        false,
      );
      await inject({
        method: 'PUT',
        url: `/engagement/consent-forms/${formId}/status`,
        headers: h(),
        json: { status: 'open' },
      });
      const open = await inject({
        method: 'GET',
        url: '/engagement/mine/consent-forms',
        headers: h(parent),
      });
      expect((open.json().forms as Array<{ id: string }>).some((f) => f.id === formId)).toBe(true);
      // a required field missing is a 400
      const bad = await inject({
        method: 'POST',
        url: `/engagement/mine/consent-forms/${formId}/responses`,
        headers: h(parent),
        json: { studentId, answers: { allow: true }, signedName: 'Rohit Nineteen' },
      });
      expect(bad.statusCode).toBe(400);
      const resp = await inject({
        method: 'POST',
        url: `/engagement/mine/consent-forms/${formId}/responses`,
        headers: h(parent),
        json: { studentId, answers: { allow: true, pickup: 'Bus' }, signedName: 'Rohit Nineteen' },
      });
      expect(resp.statusCode).toBe(201);
      const intentId = resp.json().paymentIntentId as string;
      expect(intentId).toBeTruthy();
      const checkout = await inject({
        method: 'POST',
        url: `/payments/intents/mine/${intentId}/checkout`,
        headers: h(parent),
      });
      expect(checkout.statusCode).toBe(201);
      expect(checkout.json().intent).toMatchObject({ purpose: 'misc', amount: '350.00' });
      const paid = await inject({
        method: 'POST',
        url: '/payments/payu/mock',
        headers: {},
        json: { txnid: checkout.json().intent.txnId, outcome: 'success' },
      });
      expect(paid.statusCode).toBe(201);
      const responses = await inject({
        method: 'GET',
        url: `/engagement/consent-forms/${formId}/responses`,
        headers: h(),
      });
      expect((responses.json().data as Array<{ paidAt: string | null }>)[0]?.paidAt).toBeTruthy();
      // signing twice for the same pupil is a conflict
      const twice = await inject({
        method: 'POST',
        url: `/engagement/mine/consent-forms/${formId}/responses`,
        headers: h(parent),
        json: { studentId, answers: { allow: true, pickup: 'Bus' }, signedName: 'Rohit Nineteen' },
      });
      expect(twice.statusCode).toBe(409);
    });

    it('issues certificates from a certificate template to a section; each family can queue its own PDF', async () => {
      const tpl = await inject({
        method: 'POST',
        url: '/platform/templates',
        headers: h(),
        json: {
          code: 'merit',
          name: 'Merit certificate',
          kind: 'certificate',
          pageWidth: '297mm',
          pageHeight: '210mm',
          bodyHtml:
            '<h1>{{certificate.title}}</h1><p>{{student.name}} · {{certificate.serialNo}}</p>',
        },
      });
      expect(tpl.statusCode).toBe(201);
      const issue = await inject({
        method: 'POST',
        url: '/engagement/certificates',
        headers: h(),
        json: {
          templateId: tpl.json().id,
          classSectionId: sectionId,
          title: 'Certificate of Merit',
          text: 'for PT1',
        },
      });
      expect(issue.statusCode).toBe(201);
      expect(issue.json()).toMatchObject({ issued: 1 });
      expect(issue.json().exportId).toBeTruthy();
      const mine = await inject({
        method: 'GET',
        url: '/engagement/mine/certificates',
        headers: h(parent),
      });
      const cert = (mine.json().data as Array<{ id: string; serialNo: string; title: string }>)[0]!;
      expect(cert).toMatchObject({ title: 'Certificate of Merit' });
      expect(cert.serialNo).toMatch(/^CERT\/\d{4}\/\d{5}$/);
      const pdf = await inject({
        method: 'POST',
        url: `/engagement/mine/certificates/${cert.id}/pdf`,
        headers: h(parent),
      });
      expect(pdf.statusCode).toBe(201);
      expect(pdf.json().exportId).toBeTruthy();
      // a non-certificate template is refused
      const wrong = await inject({
        method: 'POST',
        url: '/engagement/certificates',
        headers: h(),
        json: { templateId: '999999999', classSectionId: sectionId, title: 'x' },
      });
      expect([400, 404]).toContain(wrong.statusCode);
    });

    it('records a clinic visit the family can read under health', async () => {
      const visit = await inject({
        method: 'POST',
        url: '/engagement/clinic',
        headers: h(),
        json: {
          studentId,
          complaint: 'Headache',
          treatment: 'Rest',
          temperatureC: 37.4,
          notify: false,
        },
      });
      expect(visit.statusCode).toBe(201);
      const health = await inject({
        method: 'GET',
        url: '/engagement/mine/health',
        headers: h(parent),
      });
      expect(health.statusCode).toBe(200);
      const child = (
        health.json().children as Array<{
          student: { id: string };
          visits: Array<{ complaint: string }>;
        }>
      ).find((c) => c.student.id === studentId);
      expect(child?.visits[0]).toMatchObject({ complaint: 'Headache' });
      const out = await inject({
        method: 'POST',
        url: `/engagement/clinic/${visit.json().id}/out`,
        headers: h(),
      });
      expect(out.json().ok).toBe(true);
    });
  });

  describe('scheduled reports, MIS centre and group view', () => {
    it('creates a schedule (cron validated), runs it now, pauses it', async () => {
      const bad = await inject({
        method: 'POST',
        url: '/reports/schedules',
        headers: h(),
        json: { name: 'x', dataset: 'fee_day_book', format: 'xlsx', cron: '0 25 * * *' },
      });
      expect(bad.statusCode).toBe(400);
      const ok = await inject({
        method: 'POST',
        url: '/reports/schedules',
        headers: h(),
        json: {
          name: 'Monday day book',
          dataset: 'fee_day_book',
          format: 'xlsx',
          cron: '0 7 * * 1',
          recipientRoles: ['accountant'],
        },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().nextRunAt).toBeTruthy();
      const run = await inject({
        method: 'POST',
        url: `/reports/schedules/${ok.json().id}/run`,
        headers: h(),
      });
      expect(run.statusCode).toBe(201);
      expect(run.json().exportId).toBeTruthy();
      const paused = await inject({
        method: 'PUT',
        url: `/reports/schedules/${ok.json().id}/status`,
        headers: h(),
        json: { status: 'inactive' },
      });
      expect(paused.json().ok).toBe(true);
      const denied = await inject({ method: 'GET', url: '/reports/schedules', headers: h(parent) });
      expect(denied.statusCode).toBe(403);
    });

    it('maps dashboards to the caller roles; the group view lists this school', async () => {
      const mis = await inject({ method: 'GET', url: '/insights/mis', headers: h() });
      expect(mis.statusCode).toBe(200);
      const codes = (mis.json().data as Array<{ code: string; kpis: unknown[] }>).map(
        (d) => d.code,
      );
      expect(codes).toContain('principal');
      expect(codes).toContain('fees');
      expect(codes).not.toContain('group');
      const g = await inject({ method: 'GET', url: '/insights/group', headers: h(groupAdmin) });
      expect(g.statusCode).toBe(200);
      expect(
        (g.json().data as Array<{ schoolId: string; pupils: number }>).find(
          (r) => r.schoolId === school.id,
        ),
      ).toMatchObject({ pupils: 1 });
      const denied = await inject({ method: 'GET', url: '/insights/group', headers: h(teacher) });
      expect(denied.statusCode).toBe(403);
    });
  });

  describe('shadow-run closure (M3)', () => {
    it('needs a second factor, records the override reason, and is idempotent', async () => {
      const stale = await inject({
        method: 'POST',
        url: '/shadow/close',
        headers: h(admin, ';mfa=false'),
        json: { reason: 'x' },
      });
      expect(stale.statusCode).toBe(403);
      const noReason = await inject({
        method: 'POST',
        url: '/shadow/close',
        headers: h(admin, ';mfa=true'),
        json: {},
      });
      expect(noReason.statusCode).toBe(409);
      const closed = await inject({
        method: 'POST',
        url: '/shadow/close',
        headers: h(admin, ';mfa=true'),
        json: { reason: 'Pilot ended; variances explained in the workbench' },
      });
      expect(closed.statusCode).toBe(201);
      expect(closed.json()).toMatchObject({ overridden: true, zeroRuns: 0 });
      const again = await inject({
        method: 'POST',
        url: '/shadow/close',
        headers: h(admin, ';mfa=true'),
        json: { reason: 'again' },
      });
      expect(again.statusCode).toBe(409);
      const status = await inject({ method: 'GET', url: '/shadow/closure', headers: h() });
      expect(status.json().closure).toMatchObject({ overridden: true });
    });
  });
});
