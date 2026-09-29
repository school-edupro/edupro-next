/**
 * Sprint 20: compatibility parity contracts (the legacy shapes the current apps read), DPDP tooling
 * (data-principal requests, erasure guards, breach log, retention) and the app-version gate.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

type Shape = { envelope: string[]; item: string[] };

describe('compat parity, DPDP tooling and the release gate (e2e, Sprint 20)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  let sectionId: string;
  let studentId: string;
  let admissionNo: string;
  const shapes = JSON.parse(
    readFileSync(join(__dirname, 'fixtures/compat/legacy-shapes.json'), 'utf8'),
  ) as Record<string, Shape>;
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);

  beforeAll(async () => {
    s = stamp('S20');
    admissionNo = `${s}-1`;
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, dob, joined_on, mobile) VALUES ($1, 'T20', 'Tara', 'Twenty', $2, '1990-01-15', '2020-06-01', '9876520001')`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VII', name: 'Class VII', displayOrder: 7 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'B' },
    });
    sectionId = sec.json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo,
        firstName: 'Kabir',
        lastName: 'Twenty',
        guardians: [
          {
            guardian: { firstName: 'Neha', lastName: 'Twenty', mobile: '9876520002' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionId, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876520002' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T20'`,
        [school.id],
      ),
    );
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.rows[0]!.id, classSectionId: sectionId, kind: 'class_teacher' },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  /** Asserts the legacy envelope keys and, when items exist, the per-item keys. */
  const contract = async (
    name: string,
    path: string,
    who: SeededUser,
    pick: (body: Record<string, unknown>) => unknown[] | undefined,
  ) => {
    const res = await inject({ method: 'GET', url: `/compat/v1/${path}`, headers: h(who) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    for (const key of shapes[name]!.envelope) expect(body).toHaveProperty(key);
    const items = pick(body) ?? [];
    for (const item of items)
      for (const key of shapes[name]!.item) expect(item).toHaveProperty(key);
    return { body, items };
  };
  const itemsOf = (b: Record<string, unknown>) => b.items as unknown[];

  describe('compatibility parity (design note 17 section 1)', () => {
    it('answers the family read endpoints in the recorded legacy shapes', async () => {
      const fee = await contract(
        'GetFee',
        `student/GetFee?sadmission=${admissionNo}`,
        parent,
        itemsOf,
      );
      expect(Array.isArray(fee.body.items)).toBe(true);
      await contract('GetTransport', 'student/GetTransport', parent, itemsOf);
      await contract('GetLibraryTrasaction', 'student/GetLibraryTrasaction', parent, itemsOf);
      await contract('GetHealthrecord', 'student/GetHealthrecord', parent, itemsOf);
      await contract('GetClinicExamination', 'student/GetClinicExamination', parent, itemsOf);
      await contract('GetDatesheet', 'student/GetDatesheet', parent, itemsOf);
      await contract('GetStudentDateSheet', 'student/GetStudentDateSheet', parent, itemsOf);
      await contract('GetReportCard', 'student/GetReportCard', parent, itemsOf);
      await contract('GetAcademicCalander', 'student/GetAcademicCalander', parent, itemsOf);
      await contract('GetSchoolnews', 'student/GetSchoolnews', parent, itemsOf);
      await contract('get_app_banner_news', 'student/get_app_banner_news', parent, itemsOf);
      await contract('GetAlbum', 'student/GetAlbum', parent, itemsOf);
      // a stranger's admission number never leaks another family's data
      const other = await inject({
        method: 'GET',
        url: '/compat/v1/student/GetFee?sadmission=NOT-MINE',
        headers: h(parent),
      });
      expect(other.json()).toEqual({ items: [] });
    });

    it('gate passes: the family raises, the class teacher issues, both read the legacy shape', async () => {
      const raised = await inject({
        method: 'POST',
        url: '/compat/v1/SubmitGatePass',
        headers: h(parent),
        json: {
          gt_admission_id: admissionNo,
          gt_type: 'Early Leave',
          gt_reason: 'Doctor visit',
          gt_accompanied: 'Neha Twenty',
          gt_accompanied_mobile: '9876520002',
        },
      });
      expect(raised.json()).toMatchObject({ status: true });
      const mine = await contract(
        'GetGatePass',
        'GetGatePass',
        parent,
        (b) => b.gatepass_data as unknown[],
      );
      expect(mine.items.length).toBe(1);
      expect((mine.items[0] as { status: string }).status).toBe('Pending');
      // the teacher (class teacher of the section) cannot issue: issuing needs engagement.gate_pass.issue
      const denied = await inject({
        method: 'POST',
        url: '/compat/v1/UpdateGetPassStatus',
        headers: h(teacher),
        json: { slip_no: raised.json().slip_no, gate_pass_status: 'Approved' },
      });
      expect(denied.json()).toMatchObject({ status: false });
      const issued = await inject({
        method: 'POST',
        url: '/compat/v1/UpdateGetPassStatus',
        headers: h(admin),
        json: { slip_no: raised.json().slip_no, gate_pass_status: 'Approved' },
      });
      expect(issued.json()).toMatchObject({ status: true });
      const queue = await contract(
        'GetGatePass',
        'GetGatePass?status=approved',
        admin,
        (b) => b.gatepass_data as unknown[],
      );
      expect((queue.items[0] as { pass_no: string }).pass_no).toMatch(/^GP\/\d{4}\/\d{5}$/);
    });

    it('leave applications land as leave queries and list back in the legacy shape', async () => {
      const applied = await inject({
        method: 'POST',
        url: '/compat/v1/student/student_apply_Leave',
        headers: h(parent),
        json: {
          student_id: admissionNo,
          leave_type: 'sick',
          from_date: '05/10/2026',
          to_date: '06/10/2026',
          leave_reason: 'Fever',
        },
      });
      expect(applied.json()).toMatchObject({ status: true });
      for (const key of shapes.student_apply_Leave!.item)
        expect(applied.json().data).toHaveProperty(key);
      expect(applied.json().data.no_of_days).toBe('2');
      const list = await contract(
        'student_leave_list',
        'student/student_leave_list',
        parent,
        (b) => b.data as unknown[],
      );
      expect(list.items.length).toBe(1);
      // the teacher sees it as a parent query of the section
      const pq = await contract(
        'GetParentQuery',
        'teacher/GetParentQuery',
        teacher,
        (b) => b.info as unknown[],
      );
      expect(pq.items.length).toBe(1);
    });

    it('teacher endpoints: profile, classes, mark sheet refusal, assignments, visitors, leave stub', async () => {
      const me = await contract('GetUserDetail', 'teacher/GetUserDetail', teacher, itemsOf);
      expect(me.items[0]).toMatchObject({ EmpId: 'T20', Name: 'Tara Twenty', DOB: '15-01-1990' });
      const cs = await contract(
        'get_class_subject',
        'teacher/get_class_subject',
        teacher,
        () => [],
      );
      expect(cs.body.info_class_tecaher).toEqual([{ class: 'VII-B' }]);
      const sheet = await inject({
        method: 'GET',
        url: '/compat/v1/teacher/show_student_for_mark_entry?class=VII-B&exam_type=NOPE&subject_code=ENG',
        headers: h(teacher),
      });
      expect(sheet.json()).toMatchObject({ status: false, EntryLockStatus: '1' });
      await contract(
        'GetAssignment',
        'teacher/GetAssignment?class=VII-B',
        teacher,
        (b) => b.info_student as unknown[],
      );
      // visitors need engagement.visitor.manage: the teacher is refused, the admin logs one
      const refused = await inject({
        method: 'POST',
        url: '/compat/v1/teacher/SubmitVisitorEntry',
        headers: h(teacher),
        json: { name: 'Meera Iyer', reason: 'Samples', id_no: '1234-5678-9012' },
      });
      expect(refused.json()).toMatchObject({ status: false });
      const logged = await inject({
        method: 'POST',
        url: '/compat/v1/teacher/SubmitVisitorEntry',
        headers: h(admin),
        json: {
          name: 'Meera Iyer',
          mobile: '9812345678',
          reason: 'Samples',
          whom_to_meet: 'Coordinator',
          select_id: 'Aadhaar',
          id_no: '1234-5678-9012',
        },
      });
      expect(logged.json()).toMatchObject({ status: true, name: 'Meera Iyer' });
      const stored = await withMigrator((c) =>
        c.query<{ id_proof_kind: string | null }>(
          `SELECT id_proof_kind FROM visitor_log WHERE school_id = $1 AND visitor_name = 'Meera Iyer'`,
          [school.id],
        ),
      );
      expect(stored.rows[0]).toEqual({ id_proof_kind: 'Aadhaar' }); // the number is never stored
      const visitors = await contract(
        'GetVistorEntry',
        'teacher/GetVistorEntry',
        admin,
        (b) => b.info as unknown[],
      );
      expect(visitors.items.length).toBe(1);
      const leave = await inject({
        method: 'GET',
        url: '/compat/v1/teacher/GetLeaveHistory',
        headers: h(teacher),
      });
      expect(leave.json()).toMatchObject({ status: false });
    });

    it('app_version is public and applies the forced-update floor of the school', async () => {
      await inject({
        method: 'PUT',
        url: '/platform/settings/compat.app_force_below',
        headers: h(),
        json: { value: '2.0.0' },
      });
      await inject({
        method: 'PUT',
        url: '/platform/settings/compat.app_version_android',
        headers: h(),
        json: { value: '2.1.0' },
      });
      const old = await inject({
        method: 'GET',
        url: `/compat/v1/app_version?platform=android&versioncode=1.9.0&school_id=${school.id}`,
        headers: {},
      });
      expect(old.statusCode).toBe(200);
      for (const key of shapes.app_version!.envelope) expect(old.json()).toHaveProperty(key);
      expect(old.json()).toMatchObject({ forceupdate: '1', versionupdate: '1', version: '2.1.0' });
      const current = await inject({
        method: 'GET',
        url: `/compat/v1/app_version?platform=android&versioncode=2.1.0&school_id=${school.id}`,
        headers: {},
      });
      expect(current.json()).toMatchObject({ forceupdate: '0', versionupdate: '0' });
    });
  });

  describe('DPDP tooling (design note 17 section 2)', () => {
    let requestId: string;

    it('a family raises an access request once; the office works it and the report is queued', async () => {
      const r = await inject({
        method: 'POST',
        url: '/privacy/requests/mine',
        headers: h(parent),
        json: { kind: 'access', studentId, detail: 'What do you hold about my son?' },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({
        kind: 'access',
        principalKind: 'student',
        status: 'received',
      });
      requestId = r.json().id;
      expect(new Date(r.json().dueOn).getTime()).toBeGreaterThan(Date.now() + 25 * 864e5);
      const dup = await inject({
        method: 'POST',
        url: '/privacy/requests/mine',
        headers: h(parent),
        json: { kind: 'access', studentId, detail: 'again' },
      });
      expect(dup.statusCode).toBe(409);
      const stranger = await inject({
        method: 'POST',
        url: '/privacy/requests/mine',
        headers: h(parent),
        json: { kind: 'access', studentId: '999999999', detail: 'not mine' },
      });
      expect(stranger.statusCode).toBe(404);
      const queue = await inject({ method: 'GET', url: '/privacy/requests', headers: h() });
      expect((queue.json().data as Array<{ id: string }>).some((x) => x.id === requestId)).toBe(
        true,
      );
      const denied = await inject({ method: 'GET', url: '/privacy/requests', headers: h(teacher) });
      expect(denied.statusCode).toBe(403);
      await inject({
        method: 'PUT',
        url: `/privacy/requests/${requestId}/status`,
        headers: h(),
        json: { status: 'in_progress' },
      });
      const done = await inject({
        method: 'PUT',
        url: `/privacy/requests/${requestId}/status`,
        headers: h(),
        json: { status: 'completed', outcome: 'Report generated' },
      });
      expect(done.statusCode).toBe(200);
      expect(done.json()).toMatchObject({ status: 'completed', exportStatus: 'queued' });
      expect(done.json().exportId).toBeTruthy();
      const again = await inject({
        method: 'PUT',
        url: `/privacy/requests/${requestId}/status`,
        headers: h(),
        json: { status: 'refused' },
      });
      expect(again.statusCode).toBe(409);
      const mine = await inject({
        method: 'GET',
        url: `/privacy/requests/mine/${requestId}/export`,
        headers: h(parent),
      });
      expect(mine.statusCode).toBe(200);
      expect(mine.json().export).toMatchObject({ dataset: 'dsr_access', format: 'pdf' });
    });

    it('erasure needs a second factor, refuses an active pupil, and anonymises a withdrawn one', async () => {
      const office = await inject({
        method: 'POST',
        url: '/privacy/requests',
        headers: h(),
        json: {
          kind: 'erasure',
          principalKind: 'student',
          principalId: studentId,
          channel: 'letter',
          detail: 'Mother asks in writing',
        },
      });
      expect(office.statusCode).toBe(201);
      const id = office.json().id as string;
      const stale = await inject({
        method: 'POST',
        url: `/privacy/requests/${id}/erase`,
        headers: h(admin, ';mfa=false'),
        json: { reason: 'Requested in writing' },
      });
      expect(stale.statusCode).toBe(403);
      const active = await inject({
        method: 'POST',
        url: `/privacy/requests/${id}/erase`,
        headers: h(admin, ';mfa=true'),
        json: { reason: 'Requested in writing' },
      });
      expect(active.statusCode).toBe(409);
      expect(active.json().type).toBe('principal-active');
      await withMigrator((c) =>
        c.query(
          `UPDATE enrolments SET status = 'withdrawn', ended_on = CURRENT_DATE WHERE student_id = $1`,
          [studentId],
        ),
      );
      const erased = await inject({
        method: 'POST',
        url: `/privacy/requests/${id}/erase`,
        headers: h(admin, ';mfa=true'),
        json: { reason: 'Requested in writing' },
      });
      expect(erased.statusCode).toBe(201);
      expect(erased.json()).toMatchObject({ status: 'completed' });
      expect(erased.json().touched).toMatchObject({ students: 1, guardians: 1 });
      const row = await withMigrator((c) =>
        c.query<{ display_name: string; dob: string | null; g: string; mobile: string | null }>(
          `SELECT s.display_name, s.dob::text, g.display_name AS g, g.mobile FROM students s JOIN student_guardians sg ON sg.student_id = s.id JOIN guardians g ON g.id = sg.guardian_id WHERE s.id = $1`,
          [studentId],
        ),
      );
      expect(row.rows[0]!.display_name).toMatch(/^Erased Pupil/);
      expect(row.rows[0]!.dob).toBeNull();
      expect(row.rows[0]!.g).toMatch(/^Erased Guardian/);
      expect(row.rows[0]!.mobile).toBeNull();
      // the ledger and audit stay: the audit row names the request and the reason
      const audit = await withMigrator((c) =>
        c.query(`SELECT 1 FROM audit_logs WHERE school_id = $1 AND action = 'privacy.dsr.erase'`, [
          school.id,
        ]),
      );
      expect(audit.rowCount).toBe(1);
    });

    it('records a breach, tracks the Board notice clock, lists retention runs', async () => {
      const b = await inject({
        method: 'POST',
        url: '/privacy/breaches',
        headers: h(),
        json: {
          title: 'Laptop lost',
          detectedAt: '2026-09-28T09:00',
          description: 'A staff laptop with a cached defaulters export was reported lost.',
          dataClasses: ['names', 'fees'],
          principalsAffected: 42,
        },
      });
      expect(b.statusCode).toBe(201);
      expect(b.json()).toMatchObject({ status: 'open', principalsAffected: 42 });
      expect(b.json().hoursToBoardNotice).toBeGreaterThan(0);
      const upd = await inject({
        method: 'PUT',
        url: `/privacy/breaches/${b.json().id}`,
        headers: h(),
        json: {
          status: 'notified',
          actions: 'Remote wipe confirmed; Board intimated',
          boardNotified: true,
          principalsNotified: true,
        },
      });
      expect(upd.json()).toMatchObject({ status: 'notified' });
      expect(upd.json().boardNotifiedAt).toBeTruthy();
      expect(upd.json().principalsNotifiedAt).toBeTruthy();
      const denied = await inject({ method: 'GET', url: '/privacy/breaches', headers: h(teacher) });
      expect(denied.statusCode).toBe(403);
      const retention = await inject({ method: 'GET', url: '/privacy/retention', headers: h() });
      expect(retention.statusCode).toBe(200);
      expect(Array.isArray(retention.json().data)).toBe(true);
    });
  });
});
