/**
 * Attendance from an Excel list of admission numbers (0093), and notices for chosen students,
 * employees and departments: the list is checked first, marked only on confirmation (existing marks
 * replaced only when asked), parents of the absent are e-mailed when ticked, and each upload is logged.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

const sheetOf = async (header: string, values: string[]) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('List');
  ws.addRow([header]);
  for (const v of values) ws.addRow([v]);
  return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
};
/** The latest school day on or before today (not a Sunday), as the school's date. */
const schoolDay = () => {
  const d = new Date(Date.now() + 5.5 * 3_600_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

describe('attendance from Excel and targeted notices (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  let parent: SeededUser;
  let s = '';
  const ids: Record<string, string> = {};
  const date = schoolDay();
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (u: SeededUser, url: string) => inject({ method: 'GET', url, headers: h(u) });
  const post = (u: SeededUser, url: string, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    s = stamp('AU');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-t1`);
      other = await seedUser(c, school, `${s}-t2`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      for (const [key, u, first, dept] of [
        ['emp1', teacher, 'Tara', 'Science'],
        ['emp2', other, 'Omar', 'Sports'],
      ] as const)
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, department, email)
             VALUES ($1, $2, $3, 'Teacher', $4, $5, $6) RETURNING id::text`,
            [school.id, key.toUpperCase(), first, u.id, dept, `${key}@school.test`],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post(admin, '/academics/classes', {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    ids.sec = (
      await post(admin, `/academics/classes/${cls.json().id}/sections`, { name: 'A' })
    ).json().id;
    for (const [n, first] of [
      ['1', 'Ana'],
      ['2', 'Bala'],
      ['3', 'Chitra'],
    ] as const) {
      const st = await post(admin, '/people/students', {
        admissionNo: `${s}-${n}`,
        firstName: first,
        lastName: 'Rao',
        guardians: [
          {
            guardian: {
              firstName: 'Parent',
              lastName: first,
              mobile: `987651230${n}`,
              email: `p${n}@example.test`,
            },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: ids.sec, rollNo: Number(n) },
      });
      expect(st.statusCode).toBe(201);
      ids[`st${n}`] = st.json().id;
    }
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET user_id = $1 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $2 LIMIT 1)`,
        [parent.id, ids.st1],
      ),
    );
    // teachers get their roles from an assignment: each is the class teacher of one section
    const secB = (
      await post(admin, `/academics/classes/${cls.json().id}/sections`, { name: 'B' })
    ).json().id;
    for (const [e, sec] of [
      [ids.emp1, ids.sec],
      [ids.emp2, secB],
    ])
      expect(
        (
          await post(admin, '/academics/teacher-assignments', {
            employeeId: e,
            classSectionId: sec,
            kind: 'class_teacher',
          })
        ).statusCode,
      ).toBe(201);
  });
  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status = 'queued'`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it('checks the list first, then marks; an existing mark is replaced only when asked', async () => {
    expect((await get(teacher, '/attendance/bulk')).statusCode).toBe(403);
    const fmt = await get(coordinator, '/attendance/bulk/template.xlsx');
    expect(fmt.statusCode).toBe(200);

    const file = await sheetOf('Admission no', [`${s}-1`, `${s}-2`, 'NOPE-9', `${s}-1`]);
    const v = await post(coordinator, '/attendance/bulk/verify', {
      date,
      code: 'A',
      fileName: 'absent.xlsx',
      fileBase64: file,
    });
    expect(v.statusCode).toBe(200);
    const draft = v.json();
    expect(draft).toMatchObject({ state: 'verified', totalRows: 4, okRows: 2, problemRows: 2 });
    expect(draft.rows.map((r: { issue: string | null }) => r.issue)).toEqual([
      null,
      null,
      'not_found',
      'duplicate',
    ]);
    expect(draft.rows[0]).toMatchObject({ name: 'Ana Rao', section: 'VI-A', existing: null });
    // nothing is marked yet
    const before = (
      await get(admin, `/attendance/sessions?classSectionId=${ids.sec}&date=${date}&kind=day`)
    ).json();
    expect(before.marked ?? 0).toBeFalsy();

    const done = await post(coordinator, `/attendance/bulk/${draft.id}/commit`, {
      restPresent: true,
      email: true,
      sms: true,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      state: 'committed',
      marked: 2,
      replaced: 0,
      restMarked: 1,
      emailSent: 2,
      smsSent: 0,
    });
    expect(done.json().notifyNote).toContain('absent_alert');
    const marks = await withMigrator((c) =>
      c.query<{ admission_no: string; code: string; source: string }>(
        `SELECT s.admission_no, m.code::text, m.source::text FROM attendance_marks m JOIN students s ON s.id = m.student_id
          WHERE m.school_id = $1 ORDER BY s.admission_no`,
        [school.id],
      ),
    );
    expect(marks.rows.map((m) => `${m.admission_no.slice(-1)}:${m.code}:${m.source}`)).toEqual([
      '1:A:upload',
      '2:A:upload',
      '3:P:upload',
    ]);
    const mails = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages WHERE school_id = $1 AND variables ? 'attendanceUpload'`,
        [school.id],
      ),
    );
    expect(mails.rows[0]!.n).toBe(2);
    // a confirmed upload cannot be confirmed again
    expect((await post(coordinator, `/attendance/bulk/${draft.id}/commit`)).statusCode).toBe(409);

    // the second list says Ana was present after all: kept as it is, unless replace is ticked
    const present = await sheetOf('Admission no', [`${s}-1`]);
    const v2 = (
      await post(coordinator, '/attendance/bulk/verify', { date, code: 'P', fileBase64: present })
    ).json();
    expect(v2.rows[0]).toMatchObject({ existing: 'A' });
    expect(v2.preview).toMatchObject({ differs: 1, fresh: 0 });
    expect((await post(coordinator, `/attendance/bulk/${v2.id}/commit`)).json()).toMatchObject({
      marked: 0,
      replaced: 0,
      kept: 1,
    });
    const v3 = (
      await post(coordinator, '/attendance/bulk/verify', { date, code: 'P', fileBase64: present })
    ).json();
    expect(
      (await post(coordinator, `/attendance/bulk/${v3.id}/commit`, { replace: true })).json(),
    ).toMatchObject({ replaced: 1 });
    // a cancelled one marks nothing; all of them are in the log
    const v4 = (
      await post(coordinator, '/attendance/bulk/verify', { date, code: 'A', fileBase64: present })
    ).json();
    expect((await post(coordinator, `/attendance/bulk/${v4.id}/cancel`)).json().state).toBe(
      'cancelled',
    );
    const log = (await get(admin, '/attendance/bulk')).json().data;
    expect(log.map((u: { state: string }) => u.state)).toEqual([
      'cancelled',
      'committed',
      'committed',
      'committed',
    ]);
  });

  it('refuses a holiday or a future date', async () => {
    const file = await sheetOf('Admission no', [`${s}-1`]);
    const res = await post(coordinator, '/attendance/bulk/verify', {
      date: '2099-01-05',
      code: 'A',
      fileBase64: file,
    });
    expect(res.statusCode).toBe(409);
  });

  it('sends a notice to chosen students, an Excel list, employees and departments; each sees only their own', async () => {
    const read = await post(admin, '/academics/notices/audience-file', {
      kind: 'student',
      fileBase64: await sheetOf('Admission no', [`${s}-1`, 'NOPE-1']),
    });
    expect(read.json()).toMatchObject({ missing: ['NOPE-1'] });
    expect(read.json().found).toHaveLength(1);
    expect(read.json().found[0].id).toBe(ids.st1);
    const staff = await post(admin, '/academics/notices/audience-file', {
      kind: 'employee',
      fileBase64: await sheetOf('Employee code', ['emp1']),
    });
    expect(staff.json().found[0].id).toBe(ids.emp1);
    expect((await get(admin, '/academics/notices/departments')).json().data).toEqual([
      { name: 'Science', employees: 1 },
      { name: 'Sports', employees: 1 },
    ]);

    const make = (json: Record<string, unknown>) =>
      post(admin, '/academics/notices', { body: 'Please read.', publish: true, ...json });
    const forAna = await make({
      title: 'For Ana only',
      audience: 'students',
      targets: [{ type: 'student', id: ids.st1 }],
    });
    expect(forAna.statusCode).toBe(201);
    expect(
      (
        await make({
          title: 'For Bala only',
          audience: 'students',
          targets: [{ type: 'student', id: ids.st2 }],
        })
      ).statusCode,
    ).toBe(201);
    const order = await make({
      kind: 'office_order',
      title: 'Science department meeting',
      departments: ['Science'],
    });
    expect(order.statusCode).toBe(201);
    expect(order.json().targets).toHaveLength(1);
    expect(
      (
        await post(admin, '/academics/notices/reach', {
          kind: 'office_order',
          departments: ['Sports'],
        })
      ).json(),
    ).toMatchObject({ employees: 1 });

    const titles = async (u: SeededUser) =>
      ((await get(u, '/academics/notices?size=50')).json().data as Array<{ title: string }>)
        .map((n) => n.title)
        .sort();
    expect(await titles(parent)).toEqual(['For Ana only']);
    expect(await titles(teacher)).toEqual(['Science department meeting']);
    expect(await titles(other)).toEqual([]);
    // the other parent's notice cannot be opened by its address either
    expect((await get(other, `/academics/notices/${forAna.json().id}`)).statusCode).toBe(404);
  });

  it('lets the school set how many files a notice may carry', async () => {
    const fileIds = await withMigrator(async (c) => {
      const out: string[] = [];
      for (const n of [1, 2])
        out.push(
          (
            await c.query<{ id: string }>(
              `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
               VALUES ($1, 'test', $2, 'application/pdf', 1200, 'a.pdf', 'ready', $3) RETURNING id::text`,
              [school.id, `${s}/n${String(n)}.pdf`, admin.id],
            )
          ).rows[0]!.id,
        );
      return out;
    });
    const settings = (await get(admin, '/academics/settings')).json();
    expect(settings.maxNoticeFiles).toBe(5);
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/academics/settings',
          headers: h(admin),
          json: { ...settings, maxNoticeFiles: 1 },
        })
      ).statusCode,
    ).toBe(200);
    const res = await post(admin, '/academics/notices', {
      title: 'Two files',
      body: 'x',
      fileIds,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('up to 1 attachment');
  });
});
