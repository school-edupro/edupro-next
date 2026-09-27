/**
 * Sprint 7 end to end: homework with files and scopes, notices with targeting, calendar, templates and
 * documents, transfer certificates, two-step withdrawal, promotions, gallery; file upload security.
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

describe('daily academics and student lifecycle (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let outsider: SeededUser;
  let classId: string;
  let sectionA: string;
  let sectionB: string;
  let employeeId: string;
  let studentA: string; // child of the parent, in VI-A
  let studentB: string; // in VI-B
  let studentC: string; // in VI-A, promoted later
  let planYear: string;
  let planSection: string;
  let readyFileId: string;

  const upload = async (h: Record<string, string>, name: string, type: string, bytes: Buffer) => {
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: h,
      json: { fileName: name, contentType: type, sizeBytes: bytes.length },
    });
    if (reg.statusCode !== 201)
      return { statusCode: reg.statusCode, body: reg.json(), fileId: null };
    const { file, upload: target } = reg.json() as {
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    };
    const put = await inject({
      method: 'PUT',
      url: target.url,
      headers: { ...(target.headers ?? {}) },
      raw: { body: bytes, contentType: type },
    });
    return { statusCode: put.statusCode, body: put.json(), fileId: file.id };
  };

  beforeAll(async () => {
    const s = stamp('S7');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T07', 'Tara', 'Teacher', $2) RETURNING id::text`,
        [school.id, teacher.id],
      );
      employeeId = e.rows[0]!.id;
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
        [school.id],
      );
      planYear = y.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const h = headersFor(admin.sub, school.id);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    for (const name of ['A', 'B']) {
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${classId}/sections`,
        headers: h,
        json: { name },
      });
      if (name === 'A') sectionA = sec.json().id;
      else sectionB = sec.json().id;
    }
    // next-year class VII-A for promotions (planned year, not the working one)
    const vii = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VII', name: 'Class VII', displayOrder: 7 },
    });
    await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
        [school.id, planYear, vii.json().id],
      );
      planSection = r.rows[0]!.id;
    });
    const mkStudent = async (
      adm: string,
      first: string,
      section: string,
      withParent: boolean,
      rollNo = 1,
    ) => {
      const res = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h,
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Test',
          dob: '2015-01-01',
          gender: 'male',
          guardians: withParent
            ? [
                {
                  guardian: { firstName: 'Pari', lastName: 'Parent', mobile: '9876500001' },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: section, rollNo },
        },
      });
      if (res.statusCode !== 201) throw new Error(`student ${adm}: ${res.statusCode} ${res.body}`);
      return res.json().id as string;
    };
    studentA = await mkStudent('S7A1', 'Aarav', sectionA, true);
    studentB = await mkStudent('S7B1', 'Bela', sectionB, false);
    studentC = await mkStudent('S7A2', 'Chirag', sectionA, false, 2);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500001' AND school_id = $2`,
        [parent.id, school.id],
      );
    });
    // the teacher becomes class teacher of VI-A through an assignment (Sprint 6 sync grants the role and scope)
    const ta = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId, classSectionId: sectionA, kind: 'class_teacher' },
    });
    expect(ta.statusCode).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- files: security ---------------------------------------------------------------------------
  it('file uploads refuse unknown content types and stay inside the tenant', async () => {
    const h = headersFor(admin.sub, school.id);
    const bad = await upload(h, 'evil.html', 'text/html', Buffer.from('<script>alert(1)</script>'));
    expect(bad.statusCode).toBe(400);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const ok = await upload(h, 'photo.png', 'image/png', png);
    expect(ok.statusCode).toBe(200);
    readyFileId = ok.fileId!;
    const foreign = await inject({
      method: 'GET',
      url: `/platform/files/${readyFileId}`,
      headers: headersFor(outsider.sub, other.id),
    });
    expect(foreign.statusCode).toBe(404);
  });

  // ---- daily work ------------------------------------------------------------------------------
  it('a class teacher posts homework for their section only; a pending upload cannot be attached', async () => {
    const th = headersFor(teacher.sub, school.id);
    const pending = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: headersFor(admin.sub, school.id),
      json: { fileName: 'draft.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    });
    const notReady = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: th,
      json: {
        classSectionId: sectionA,
        kind: 'homework',
        title: 'x',
        fileIds: [pending.json().file.id],
      },
    });
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json()).toMatchObject({ type: 'file.not_ready' });

    const ok = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: th,
      json: {
        classSectionId: sectionA,
        kind: 'homework',
        title: 'Fractions worksheet',
        body: 'Q1 to Q10',
        dueOn: '2099-01-01',
        fileIds: [readyFileId],
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ section: 'VI-A', postedBy: 'Tara Teacher' });
    expect(ok.json().files).toHaveLength(1);

    const denied = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: th,
      json: { classSectionId: sectionB, kind: 'classwork', title: 'Not mine' },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ type: 'scope-denied' });

    const foreign = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: headersFor(outsider.sub, other.id),
      json: { classSectionId: sectionA, kind: 'homework', title: 'x' },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('a parent reads their child’s section only; the admin sees everything', async () => {
    const h = headersFor(admin.sub, school.id);
    const inB = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: h,
      json: {
        classSectionId: sectionB,
        kind: 'assignment',
        title: 'Project B',
        dueOn: '2099-02-01',
      },
    });
    expect(inB.statusCode).toBe(201);
    const ph = headersFor(parent.sub, school.id);
    const viewer = await inject({
      method: 'GET',
      url: '/academics/daily-work/viewer',
      headers: ph,
    });
    expect(viewer.json()).toMatchObject({ kind: 'family' });
    expect(viewer.json().students.map((s: { name: string }) => s.name)).toEqual(['Aarav Test']);
    const mine = await inject({ method: 'GET', url: '/academics/daily-work', headers: ph });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.map((w: { title: string }) => w.title)).toEqual([
      'Fractions worksheet',
    ]);
    const otherSection = await inject({
      method: 'GET',
      url: `/academics/daily-work?classSectionId=${sectionB}`,
      headers: ph,
    });
    expect(otherSection.statusCode).toBe(403);
    const all = await inject({ method: 'GET', url: '/academics/daily-work', headers: h });
    expect(all.json().page.total).toBe(2);
    const post = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: ph,
      json: { classSectionId: sectionA, kind: 'homework', title: 'nope' },
    });
    expect(post.statusCode).toBe(403);
  });

  // ---- notices ---------------------------------------------------------------------------------
  it('notices reach the audience and targets they were published to', async () => {
    const h = headersFor(admin.sub, school.id);
    const ph = headersFor(parent.sub, school.id);
    const th = headersFor(teacher.sub, school.id);
    const draft = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: { title: 'Draft only', body: 'not yet' },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().publishedAt).toBeNull();
    const everyone = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: { title: 'School reopens', body: 'Monday', publish: true, isPinned: true },
    });
    const forB = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: {
        title: 'VI-B trip',
        body: 'bus at 8',
        publish: true,
        targets: [{ type: 'class_section', id: sectionB }],
      },
    });
    const forA = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: {
        title: 'VI-A PTM',
        body: 'Saturday',
        publish: true,
        targets: [{ type: 'class_section', id: sectionA }],
      },
    });
    const staff = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: {
        kind: 'circular',
        title: 'Staff meeting',
        body: '3 pm',
        audience: 'employees',
        publish: true,
      },
    });
    expect([everyone.statusCode, forB.statusCode, forA.statusCode, staff.statusCode]).toEqual([
      201, 201, 201, 201,
    ]);

    const parentSees = await inject({ method: 'GET', url: '/academics/notices', headers: ph });
    expect(parentSees.json().data.map((n: { title: string }) => n.title)).toEqual([
      'School reopens',
      'VI-A PTM',
    ]);
    const teacherSees = await inject({ method: 'GET', url: '/academics/notices', headers: th });
    expect(
      teacherSees
        .json()
        .data.map((n: { title: string }) => n.title)
        .sort(),
    ).toEqual(['School reopens', 'Staff meeting', 'VI-A PTM'].sort());
    const hidden = await inject({
      method: 'GET',
      url: `/academics/notices/${forB.json().id}`,
      headers: ph,
    });
    expect(hidden.statusCode).toBe(404);
    const adminSees = await inject({
      method: 'GET',
      url: '/academics/notices?status=all',
      headers: h,
    });
    expect(adminSees.json().page.total).toBe(5);

    const unpublish = await inject({
      method: 'POST',
      url: `/academics/notices/${forA.json().id}/unpublish`,
      headers: h,
    });
    expect(unpublish.statusCode).toBe(201);
    const after = await inject({ method: 'GET', url: '/academics/notices', headers: ph });
    expect(after.json().data.map((n: { title: string }) => n.title)).toEqual(['School reopens']);
  });

  // ---- calendar --------------------------------------------------------------------------------
  it('holidays cannot overlap; families see student events only', async () => {
    const h = headersFor(admin.sub, school.id);
    const diwali = await inject({
      method: 'POST',
      url: '/academics/calendar/holidays',
      headers: h,
      json: {
        name: 'Diwali break',
        kind: 'vacation',
        startsOn: '2026-11-07',
        endsOn: '2026-11-12',
      },
    });
    expect(diwali.statusCode).toBe(201);
    const overlap = await inject({
      method: 'POST',
      url: '/academics/calendar/holidays',
      headers: h,
      json: { name: 'Bhai Dooj', startsOn: '2026-11-11' },
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json()).toMatchObject({ type: 'holiday.overlap' });
    const bad = await inject({
      method: 'POST',
      url: '/academics/calendar/holidays',
      headers: h,
      json: { name: 'x', startsOn: '2026-12-02', endsOn: '2026-12-01' },
    });
    expect(bad.statusCode).toBe(400);
    await inject({
      method: 'POST',
      url: '/academics/calendar/events',
      headers: h,
      json: { title: 'Sports day', kind: 'activity', startsOn: '2026-12-15' },
    });
    await inject({
      method: 'POST',
      url: '/academics/calendar/events',
      headers: h,
      json: {
        title: 'Staff training',
        kind: 'meeting',
        startsOn: '2026-12-16',
        audience: 'employees',
      },
    });
    const parentCal = await inject({
      method: 'GET',
      url: '/academics/calendar?from=2026-11-01&to=2026-12-31',
      headers: headersFor(parent.sub, school.id),
    });
    expect(parentCal.statusCode).toBe(200);
    expect(parentCal.json().holidays.map((x: { name: string }) => x.name)).toEqual([
      'Diwali break',
    ]);
    expect(parentCal.json().events.map((x: { title: string }) => x.title)).toEqual(['Sports day']);
    const adminCal = await inject({ method: 'GET', url: '/academics/calendar', headers: h });
    expect(adminCal.json().events).toHaveLength(2);
  });

  // ---- templates and documents -----------------------------------------------------------------
  it('installs default templates, previews them and queues a document export', async () => {
    const h = headersFor(admin.sub, school.id);
    const installed = await inject({
      method: 'POST',
      url: '/platform/templates/defaults',
      headers: h,
    });
    expect(installed.statusCode).toBe(201);
    expect(
      installed
        .json()
        .data.map((t: { code: string }) => t.code)
        .sort(),
    ).toEqual(['bonafide_default', 'letter_default', 'tc_default']);
    const bonafide = installed.json().data.find((t: { kind: string }) => t.kind === 'bonafide');
    const preview = await inject({
      method: 'POST',
      url: `/platform/templates/${bonafide.id}/preview`,
      headers: h,
      json: {},
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json().html).toContain('Bonafide certificate');
    expect(preview.json().html).toContain('Aarav Sharma');
    const real = await inject({
      method: 'POST',
      url: `/platform/templates/${bonafide.id}/preview`,
      headers: h,
      json: { entityId: studentA },
    });
    expect(real.json().html).toContain('Aarav Test');
    expect(real.json().html).toContain('Class VI-A');
    // placeholders are escaped: a hostile guardian name cannot inject markup
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET first_name = '<img src=x onerror=alert(1)>' WHERE mobile = '9876500001' AND school_id = $1`,
        [school.id],
      ),
    );
    const escaped = await inject({
      method: 'POST',
      url: `/platform/templates/${bonafide.id}/preview`,
      headers: h,
      json: { entityId: studentA },
    });
    expect(escaped.json().html).not.toContain('<img src=x');
    expect(escaped.json().html).toContain('&lt;img src=x');
    const queued = await inject({
      method: 'POST',
      url: `/platform/templates/${bonafide.id}/render`,
      headers: h,
      json: { entity: 'student', entityId: studentA },
    });
    expect(queued.statusCode).toBe(201);
    expect(queued.json()).toMatchObject({ dataset: 'document', format: 'pdf', status: 'queued' });
    const teacherRender = await inject({
      method: 'POST',
      url: `/platform/templates/${bonafide.id}/render`,
      headers: headersFor(teacher.sub, school.id),
      json: { entity: 'student', entityId: studentA },
    });
    expect(teacherRender.statusCode).toBe(403);
  });

  // ---- transfer certificate --------------------------------------------------------------------
  it('issues a numbered transfer certificate that ends the enrolment and queues the PDF', async () => {
    const h = headersFor(admin.sub, school.id);
    const tc = await inject({
      method: 'POST',
      url: `/people/students/${studentB}/tc`,
      headers: h,
      json: { reason: 'Family relocated', promotionStatus: 'Promoted to VII', remarks: 'Dues nil' },
    });
    expect(tc.statusCode).toBe(201);
    expect(tc.json()).toMatchObject({
      tcNo: 'TC/2026-27/0001',
      status: 'issued',
      lastClass: 'VI-B',
    });
    expect(tc.json().exportId).toMatch(/^\d+$/);
    const student = await inject({
      method: 'GET',
      url: `/people/students/${studentB}`,
      headers: h,
    });
    expect(student.json().status).toBe('inactive');
    expect(student.json().enrolments[0].status).toBe('transferred');
    const history = await inject({
      method: 'GET',
      url: `/people/students/${studentB}/status-history`,
      headers: h,
    });
    expect(history.json().data[0]).toMatchObject({
      toStatus: 'inactive',
      reason: 'transfer certificate TC/2026-27/0001',
    });
    const again = await inject({
      method: 'POST',
      url: `/people/students/${studentB}/tc`,
      headers: h,
      json: { reason: 'again' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ type: 'tc.already_issued' });
    const cancel = await inject({
      method: 'POST',
      url: `/people/tc/${tc.json().id}/cancel`,
      headers: h,
      json: { reason: 'issued in error' },
    });
    expect(cancel.json().status).toBe('cancelled');
    const list = await inject({ method: 'GET', url: '/people/tc', headers: h });
    expect(list.json().page.total).toBe(1);
    const exportRow = await inject({
      method: 'GET',
      url: `/reports/exports/${tc.json().exportId}`,
      headers: h,
    });
    expect(exportRow.statusCode).toBe(200);
    expect(exportRow.json().export.dataset).toBe('document');
  });

  // ---- withdrawal in two steps -----------------------------------------------------------------
  it('a withdrawal completes only after every department has cleared', async () => {
    const h = headersFor(admin.sub, school.id);
    const req = await inject({
      method: 'POST',
      url: `/people/students/${studentA}/withdrawal`,
      headers: h,
      json: { leavingOn: '2026-12-31', reason: 'Moving abroad' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json().clearances.map((x: { department: string }) => x.department)).toEqual([
      'fees',
      'library',
      'transport',
      'academics',
    ]);
    const id = req.json().id;
    const dup = await inject({
      method: 'POST',
      url: `/people/students/${studentA}/withdrawal`,
      headers: h,
      json: { leavingOn: '2026-12-31', reason: 'again' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ type: 'withdrawal.open_exists' });
    const early = await inject({
      method: 'POST',
      url: `/people/withdrawals/${id}/complete`,
      headers: h,
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ type: 'withdrawal.clearance_pending' });
    for (const dept of ['fees', 'library', 'transport']) {
      const r = await inject({
        method: 'PUT',
        url: `/people/withdrawals/${id}/clearances/${dept}`,
        headers: h,
        json: { status: 'cleared', remarks: 'ok' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('requested');
    }
    const hold = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${id}/clearances/academics`,
      headers: h,
      json: { status: 'hold', remarks: 'report card pending' },
    });
    expect(hold.json().status).toBe('requested');
    const stillEarly = await inject({
      method: 'POST',
      url: `/people/withdrawals/${id}/complete`,
      headers: h,
    });
    expect(stillEarly.statusCode).toBe(409);
    const last = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${id}/clearances/academics`,
      headers: h,
      json: { status: 'cleared' },
    });
    expect(last.json().status).toBe('cleared');
    const done = await inject({
      method: 'POST',
      url: `/people/withdrawals/${id}/complete`,
      headers: h,
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().status).toBe('completed');
    const student = await inject({
      method: 'GET',
      url: `/people/students/${studentA}`,
      headers: h,
    });
    expect(student.json().status).toBe('inactive');
    expect(student.json().leftOn).toBe('2026-12-31');
    expect(student.json().enrolments[0].status).toBe('withdrawn');
    const open = await inject({
      method: 'GET',
      url: '/people/withdrawals?status=open',
      headers: h,
    });
    expect(open.json().page.total).toBe(0);
  });

  // ---- promotions ------------------------------------------------------------------------------
  it('records and applies promotion decisions into the next year', async () => {
    const h = headersFor(admin.sub, school.id);
    const sections = await inject({
      method: 'GET',
      url: `/people/promotions/sections?yearId=${planYear}`,
      headers: h,
    });
    expect(sections.json().data.map((s: { label: string }) => s.label)).toEqual(['VII-A']);
    const missing = await inject({
      method: 'PUT',
      url: '/people/promotions',
      headers: h,
      json: { toYearId: planYear, decisions: [{ studentId: studentC, decision: 'promote' }] },
    });
    expect(missing.statusCode).toBe(400);
    const wrongYear = await inject({
      method: 'PUT',
      url: '/people/promotions',
      headers: h,
      json: {
        toYearId: planYear,
        decisions: [{ studentId: studentC, decision: 'promote', toClassSectionId: sectionB }],
      },
    });
    expect(wrongYear.statusCode).toBe(409);
    expect(wrongYear.json()).toMatchObject({ type: 'promotion.section_not_in_year' });
    const set = await inject({
      method: 'PUT',
      url: '/people/promotions',
      headers: h,
      json: {
        toYearId: planYear,
        decisions: [{ studentId: studentC, decision: 'promote', toClassSectionId: planSection }],
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ saved: 1 });
    const list = await inject({
      method: 'GET',
      url: `/people/promotions?classId=${classId}&toYearId=${planYear}`,
      headers: h,
    });
    const row = list.json().data.find((x: { studentId: string }) => x.studentId === studentC);
    expect(row).toMatchObject({ decision: 'promote', toSection: 'VII-A', appliedAt: null });
    const applied = await inject({
      method: 'POST',
      url: '/people/promotions/apply',
      headers: h,
      json: { toYearId: planYear },
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json()).toEqual({ applied: 1, skipped: 0 });
    const student = await inject({
      method: 'GET',
      url: `/people/students/${studentC}`,
      headers: h,
    });
    const enrolments = student.json().enrolments as Array<{
      academicYear: string;
      status: string;
      section: string;
    }>;
    expect(enrolments.map((e) => `${e.academicYear}:${e.section}:${e.status}`).sort()).toEqual([
      '2026-27:A:promoted',
      '2027-28:A:active',
    ]);
    const again = await inject({
      method: 'POST',
      url: '/people/promotions/apply',
      headers: h,
      json: { toYearId: planYear },
    });
    expect(again.json()).toEqual({ applied: 0, skipped: 1 });
  });

  // ---- gallery ---------------------------------------------------------------------------------
  it('albums follow their audience', async () => {
    const h = headersFor(admin.sub, school.id);
    const album = await inject({
      method: 'POST',
      url: '/academics/gallery/albums',
      headers: h,
      json: { title: 'Annual day', eventOn: '2026-12-20', fileIds: [readyFileId] },
    });
    expect(album.statusCode).toBe(201);
    expect(album.json()).toMatchObject({ itemCount: 1, coverFileId: readyFileId });
    const staffOnly = await inject({
      method: 'POST',
      url: '/academics/gallery/albums',
      headers: h,
      json: { title: 'Staff picnic', audience: 'employees' },
    });
    expect(staffOnly.statusCode).toBe(201);
    const parentSees = await inject({
      method: 'GET',
      url: '/academics/gallery/albums',
      headers: headersFor(parent.sub, school.id),
    });
    expect(parentSees.json().data.map((a: { title: string }) => a.title)).toEqual(['Annual day']);
    const hidden = await inject({
      method: 'GET',
      url: `/academics/gallery/albums/${staffOnly.json().id}`,
      headers: headersFor(parent.sub, school.id),
    });
    expect(hidden.statusCode).toBe(404);
  });
});
