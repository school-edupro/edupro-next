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

/** 0091: publish time and acknowledgement, class documents, the directory, office orders and the report. */
describe('academic board (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let section: string;
  let otherSection: string;
  let studentId: string;
  let fileId: string;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('AB');
    let teacherEmp = '';
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, email) VALUES ($1, 'T1', 'Tara', 'Teacher', $2, 'tara.t1@example.test') RETURNING id::text`,
        [school.id, teacher.id],
      );
      teacherEmp = e.rows[0]!.id;
      const f = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'test', $2, 'application/pdf', 1200, 'date-sheet.pdf', 'ready', $3) RETURNING id::text`,
        [school.id, `${s}/date-sheet.pdf`, teacher.id],
      );
      fileId = f.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    section = (
      await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' })
    ).json().id;
    otherSection = (
      await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'B' })
    ).json().id;
    const st = await post('/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Ana',
      lastName: 'Reader',
      guardians: [
        {
          guardian: {
            firstName: 'Pari',
            lastName: 'Reader',
            mobile: '9876512399',
            email: 'pari@example.test',
          },
          relation: 'mother',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: section, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET user_id = $1 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $2 LIMIT 1)`,
        [parent.id, studentId],
      ),
    );
    const ta = await post('/academics/teacher-assignments', admin, {
      employeeId: teacherEmp,
      classSectionId: section,
      kind: 'class_teacher',
    });
    expect(ta.statusCode).toBe(201);
  });
  afterAll(async () => app.close());

  it('homework with a later publish time stays from the family until then; the family acknowledges; the teacher sees who did', async () => {
    const later = new Date(Date.now() + 3 * 86400000).toISOString();
    const hidden = await post('/academics/daily-work', teacher, {
      classSectionId: section,
      kind: 'homework',
      title: 'Read chapter 4',
      publishAt: later,
    });
    expect(hidden.statusCode).toBe(201);
    expect(hidden.json()).toMatchObject({ scheduled: true });
    const now = await post('/academics/daily-work', teacher, {
      classSectionId: section,
      kind: 'assignment',
      title: 'Map of India',
      ackRequired: true,
    });
    expect(now.json()).toMatchObject({ scheduled: false, ackRequired: true, ackCount: 0 });
    // a teacher uploads only for the classes they hold
    expect(
      (
        await post('/academics/daily-work', teacher, {
          classSectionId: otherSection,
          kind: 'homework',
          title: 'x',
        })
      ).statusCode,
    ).toBe(403);
    const seen = (await get('/academics/daily-work', parent)).json().data as Array<{
      title: string;
    }>;
    expect(seen.map((x) => x.title)).toEqual(['Map of India']);
    expect((await get('/academics/daily-work', teacher)).json().data).toHaveLength(2);
    // acknowledged for the child; not for somebody else's item or child
    expect(
      (
        await post('/academics/acks', parent, {
          type: 'daily_work',
          id: hidden.json().id,
          studentId,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await post('/academics/acks', parent, { type: 'daily_work', id: now.json().id, studentId }))
        .statusCode,
    ).toBe(200);
    await post('/academics/acks', parent, { type: 'daily_work', id: now.json().id, studentId });
    const mine = (await get('/academics/daily-work', parent)).json().data[0];
    expect(mine).toMatchObject({ ackCount: 1, ackedFor: [studentId] });
    const status = (
      await get(`/academics/acks?type=daily_work&id=${now.json().id}`, teacher)
    ).json();
    expect(status).toMatchObject({ roster: true, acknowledged: 1, total: 1 });
    expect(status.data[0]).toMatchObject({ name: 'Ana Reader', by: 'Pari Reader' });
    expect(
      (await get(`/academics/acks?type=daily_work&id=${now.json().id}`, parent)).statusCode,
    ).toBe(403);
  });

  it('class documents by the teacher, school-wide ones by the office; the directory', async () => {
    const sheet = await post('/academics/documents', teacher, {
      kind: 'date_sheet',
      title: 'Half-yearly date sheet',
      remark: 'Reach by 8.30',
      classSectionIds: [section],
      fileIds: [fileId],
      ackRequired: true,
    });
    expect(sheet.statusCode).toBe(201);
    expect(sheet.json().data[0]).toMatchObject({ kindLabel: 'Date sheet', section: 'VI-A' });
    // not for another class, and not for the whole school
    expect(
      (
        await post('/academics/documents', teacher, {
          kind: 'curriculum',
          title: 'Syllabus',
          classSectionIds: [otherSection],
          fileIds: [fileId],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post('/academics/documents', teacher, {
          kind: 'magazine',
          title: 'Magazine',
          fileIds: [fileId],
        })
      ).statusCode,
    ).toBe(403);
    const adminFile = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
             VALUES ($1, 'test', $2, 'application/pdf', 900, 'magazine.pdf', 'ready', $3) RETURNING id::text`,
            [school.id, `mag-${String(Date.now())}.pdf`, admin.id],
          )
        ).rows[0]!.id,
    );
    const mag = await post('/academics/documents', admin, {
      kind: 'magazine',
      title: 'Vista 2026',
      fileIds: [adminFile],
    });
    expect(mag.json().data[0]).toMatchObject({ section: null, kindLabel: 'School magazine' });
    const docs = (await get('/academics/documents', parent)).json().data as Array<{
      id: string;
      title: string;
    }>;
    expect(docs.map((d) => d.title).sort()).toEqual(['Half-yearly date sheet', 'Vista 2026']);
    expect(
      (await get(`/academics/documents/${sheet.json().data[0].id}/files/${fileId}`, parent))
        .statusCode,
    ).toBe(200);
    await post('/academics/acks', parent, {
      type: 'document',
      id: sheet.json().data[0].id,
      studentId,
    });
    expect(
      (await get(`/academics/acks?type=document&id=${sheet.json().data[0].id}`, teacher)).json(),
    ).toMatchObject({ acknowledged: 1, total: 1 });

    await withMigrator((c) =>
      c.query(
        `INSERT INTO school_directory (school_id, code, heading, name, designation, phone, sort_order, status)
         VALUES ($1, 'OFF1', 'Office', 'Front office', 'Reception', '0120 4000000', 10, 'active'), ($1, 'OLD', 'Office', 'Old desk', NULL, NULL, 20, 'inactive')`,
        [school.id],
      ),
    );
    expect((await get('/academics/directory', parent)).json().data).toEqual([
      expect.objectContaining({ heading: 'Office', name: 'Front office', phone: '0120 4000000' }),
    ]);
  });

  it('a notice to students and an office order to employees: formatted, acknowledged, e-mailed, reported', async () => {
    const notice = await post('/academics/notices', admin, {
      kind: 'notice',
      title: 'Sports day',
      body: '<p>Sports day is on <strong>Friday</strong>.<script>x()</script></p>',
      bodyFormat: 'html',
      audience: 'students',
      targets: [{ type: 'class_section', id: section }],
      ackRequired: true,
      alsoEmail: true,
      publish: true,
    });
    expect(notice.statusCode).toBe(201);
    expect(notice.json()).toMatchObject({ bodyFormat: 'html', emailedCount: 1 });
    expect(notice.json().body).not.toContain('script');
    const order = await post('/academics/notices', admin, {
      kind: 'office_order',
      title: 'Staff meeting on Saturday',
      body: 'All teachers assemble at 9 am.',
      ackRequired: true,
      alsoEmail: true,
      publish: true,
    });
    expect(order.json()).toMatchObject({
      kind: 'office_order',
      audience: 'employees',
      emailedCount: 1,
    });
    // the family sees the notice, not the office order; the employee the other way round
    const family = (await get('/academics/notices', parent)).json().data as Array<{
      title: string;
    }>;
    expect(family.map((n) => n.title)).toEqual(['Sports day']);
    const staff = (await get('/academics/notices?kind=office_order', teacher)).json()
      .data as Array<{ title: string }>;
    expect(staff.map((n) => n.title)).toEqual(['Staff meeting on Saturday']);
    await post('/academics/acks', parent, { type: 'notice', id: notice.json().id, studentId });
    await post('/academics/acks', teacher, { type: 'notice', id: order.json().id });
    expect(
      (await post('/academics/acks', parent, { type: 'notice', id: order.json().id, studentId }))
        .statusCode,
    ).toBe(404);
    expect(
      (await get('/academics/notices?kind=office_order', teacher)).json().data[0],
    ).toMatchObject({ ackedByMe: true });
    const report = (await get('/academics/notices/report', admin)).json().data as Array<
      Record<string, unknown>
    >;
    expect(report.find((r) => r.title === 'Sports day')).toMatchObject({
      students: 1,
      acknowledged: 1,
      emailed: 1,
    });
    expect(report.find((r) => r.kind === 'office_order')).toMatchObject({
      acknowledged: 1,
      emailed: 1,
    });
    expect((await get('/academics/notices/report', teacher)).statusCode).toBe(403);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(`/academics/notices/report?format=${format}`, admin);
      expect(f.statusCode).toBe(200);
      expect(f.headers['content-disposition']).toContain(`.${format}`);
    }
    // the mails went to test addresses: take them off the queue
    const mails = await withMigrator(async (c) =>
      (
        await c.query<{ recipient_address: string }>(
          `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND variables ? 'notice' RETURNING recipient_address`,
          [school.id],
        )
      ).rows.map((x) => x.recipient_address),
    );
    expect(mails.sort()).toEqual(['pari@example.test', 'tara.t1@example.test']);
  });
});
