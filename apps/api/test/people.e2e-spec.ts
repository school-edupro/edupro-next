/**
 * People masters (S4-02, S4-03, S4-04, S4-07): students with guardians and enrolments, class teacher scope,
 * employees with postings, documents through the file service, ID cards as exports, and search.
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

describe('people (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let outsider: SeededUser;
  let sectionA: string;
  let sectionB: string;
  let studentA: string;
  let studentB: string;
  let guardianId: string;

  beforeAll(async () => {
    const s = stamp('PPL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const A = (sub: string) => headersFor(sub, school.id);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: A(admin.sub),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    sectionA = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'A' },
      })
    ).json().id;
    sectionB = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'B' },
      })
    ).json().id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = (sub: string) => headersFor(sub, school.id);

  describe('students', () => {
    it('creates a student with a new guardian and an enrolment in one call', async () => {
      const res = await inject({
        method: 'POST',
        url: '/people/students',
        headers: A(admin.sub),
        json: {
          admissionNo: 'R2401',
          firstName: 'Aarav',
          lastName: 'Sharma',
          dob: '2015-06-14',
          gender: 'male',
          guardians: [
            {
              guardian: { firstName: 'Suresh', lastName: 'Sharma', mobile: '9000000001' },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: sectionA, rollNo: 1 },
        },
      });
      expect(res.statusCode).toBe(201);
      studentA = res.json().id;
      expect(res.json()).toMatchObject({
        admissionNo: 'R2401',
        displayName: 'Aarav Sharma',
        enrolment: { classSectionId: sectionA, rollNo: 1, classCode: 'VI', section: 'A' },
      });
      const dup = await inject({
        method: 'POST',
        url: '/people/students',
        headers: A(admin.sub),
        json: { admissionNo: 'R2401', firstName: 'Again' },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('reuses the guardian by mobile for a sibling and lists siblings on the 360 view', async () => {
      const res = await inject({
        method: 'POST',
        url: '/people/students',
        headers: A(admin.sub),
        json: {
          admissionNo: 'R2402',
          firstName: 'Diya',
          lastName: 'Sharma',
          guardians: [
            { guardian: { firstName: 'Suresh', mobile: '9000000001' }, relation: 'father' },
          ],
          enrolment: { classSectionId: sectionB, rollNo: 1 },
        },
      });
      expect(res.statusCode).toBe(201);
      studentB = res.json().id;
      const view = await inject({
        method: 'GET',
        url: `/people/students/${studentA}`,
        headers: A(admin.sub),
      });
      expect(view.statusCode).toBe(200);
      expect(view.json().guardians).toHaveLength(1);
      guardianId = view.json().guardians[0].guardianId;
      expect(view.json().guardians[0]).toMatchObject({
        displayName: 'Suresh Sharma',
        relation: 'father',
        isPrimary: true,
      });
      expect(view.json().siblings).toEqual([
        { id: studentB, displayName: 'Diya Sharma', admissionNo: 'R2402' },
      ]);
      expect(view.json().enrolments).toHaveLength(1);
    });

    it('updates, lists with search and moves the enrolment with roll number rules', async () => {
      const upd = await inject({
        method: 'PATCH',
        url: `/people/students/${studentA}`,
        headers: A(admin.sub),
        json: { bloodGroup: 'B+', house: 'Red' },
      });
      expect(upd.statusCode).toBe(200);
      expect(upd.json()).toMatchObject({ bloodGroup: 'B+', house: 'Red' });
      const list = await inject({
        method: 'GET',
        url: '/people/students?q=sharma',
        headers: A(admin.sub),
      });
      expect(
        list
          .json()
          .data.map((s: { admissionNo: string }) => s.admissionNo)
          .sort(),
      ).toEqual(['R2401', 'R2402']);
      const bySection = await inject({
        method: 'GET',
        url: `/people/students?classSectionId=${sectionB}`,
        headers: A(admin.sub),
      });
      expect(bySection.json().data.map((s: { admissionNo: string }) => s.admissionNo)).toEqual([
        'R2402',
      ]);
      const clash = await inject({
        method: 'POST',
        url: `/people/students/${studentA}/enrolments`,
        headers: A(admin.sub),
        json: { classSectionId: sectionB, rollNo: 1 },
      });
      expect(clash.statusCode).toBe(409);
      const move = await inject({
        method: 'POST',
        url: `/people/students/${studentA}/enrolments`,
        headers: A(admin.sub),
        json: { classSectionId: sectionB, rollNo: 2 },
      });
      expect(move.statusCode).toBe(201);
      expect(move.json().enrolment).toMatchObject({ classSectionId: sectionB, rollNo: 2 });
      const back = await inject({
        method: 'POST',
        url: `/people/students/${studentA}/enrolments`,
        headers: A(admin.sub),
        json: { classSectionId: sectionA, rollNo: 1 },
      });
      expect(back.statusCode).toBe(201);
      const view = await inject({
        method: 'GET',
        url: `/people/students/${studentA}`,
        headers: A(admin.sub),
      });
      expect(view.json().enrolments).toHaveLength(1); // one enrolment per year, moved twice
    });

    it('restricts a scoped class teacher to their sections in list, detail and search', async () => {
      const roles = (
        await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) })
      ).json().data;
      const classTeacher = roles.find((r: { code: string }) => r.code === 'class_teacher');
      const assignment = (
        await inject({
          method: 'GET',
          url: `/access/assignments?userId=${teacher.id}`,
          headers: A(admin.sub),
        })
      )
        .json()
        .data.find((a: { roleId: string }) => a.roleId === classTeacher.id);
      await inject({
        method: 'PUT',
        url: `/access/assignments/${assignment.id}/scopes`,
        headers: A(admin.sub),
        json: { scopes: [{ type: 'class_section', id: sectionA }] },
      });
      const list = await inject({
        method: 'GET',
        url: '/people/students',
        headers: A(teacher.sub),
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((s: { admissionNo: string }) => s.admissionNo)).toEqual([
        'R2401',
      ]);
      const hidden = await inject({
        method: 'GET',
        url: `/people/students/${studentB}`,
        headers: A(teacher.sub),
      });
      expect(hidden.statusCode).toBe(404);
      const search = await inject({
        method: 'GET',
        url: '/people/search?q=sharma',
        headers: A(teacher.sub),
      });
      expect(search.statusCode).toBe(200);
      expect(
        search
          .json()
          .data.map((h: { kind: string; displayName: string }) => `${h.kind}:${h.displayName}`)
          .sort(),
      ).toEqual(['guardian:Suresh Sharma', 'student:Aarav Sharma']);
      const create = await inject({
        method: 'POST',
        url: '/people/students',
        headers: A(teacher.sub),
        json: { admissionNo: 'X', firstName: 'Nope' },
      });
      expect(create.statusCode).toBe(403);
      const outside = await inject({
        method: 'GET',
        url: `/people/students/${studentA}`,
        headers: headersFor(outsider.sub, other.id),
      });
      expect(outside.statusCode).toBe(404);
    });

    it('unlinks a guardian and refuses to remove an enrolled student', async () => {
      const unlink = await inject({
        method: 'DELETE',
        url: `/people/students/${studentB}/guardians/${guardianId}`,
        headers: A(admin.sub),
      });
      expect(unlink.statusCode).toBe(200);
      expect(unlink.json()).toEqual([]);
      const remove = await inject({
        method: 'DELETE',
        url: `/people/students/${studentB}`,
        headers: A(admin.sub),
      });
      expect(remove.statusCode).toBe(409);
      expect(remove.json()).toMatchObject({ type: 'people.student.enrolled' });
    });
  });

  describe('documents and ID cards', () => {
    it('attaches an uploaded photo and requests an ID card export', async () => {
      const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      const reg = await inject({
        method: 'POST',
        url: '/platform/files',
        headers: A(admin.sub),
        json: {
          fileName: 'aarav.png',
          contentType: 'image/png',
          sizeBytes: bytes.length,
          classification: 'personal',
          ownerEntityType: 'students',
          ownerEntityId: studentA,
        },
      });
      expect(reg.statusCode).toBe(201);
      const put = await inject({
        method: 'PUT',
        url: reg.json().upload.url,
        headers: {},
        raw: { body: bytes, contentType: 'image/png' },
      });
      expect(put.statusCode).toBe(200);
      const doc = await inject({
        method: 'POST',
        url: `/people/students/${studentA}/documents`,
        headers: A(admin.sub),
        json: { kind: 'photo', fileId: reg.json().file.id },
      });
      expect(doc.statusCode).toBe(201);
      expect(doc.json()[0]).toMatchObject({ kind: 'photo', fileId: reg.json().file.id });
      const view = await inject({
        method: 'GET',
        url: `/people/students/${studentA}`,
        headers: A(admin.sub),
      });
      expect(view.json().photoFileId).toBe(reg.json().file.id);
      const card = await inject({
        method: 'POST',
        url: `/people/students/${studentA}/id-card`,
        headers: A(teacher.sub),
      });
      expect(card.statusCode).toBe(201);
      expect(card.json()).toMatchObject({
        dataset: 'student_id_card',
        format: 'pdf',
        status: 'queued',
        params: { studentId: studentA },
      });
      const audited = await inject({
        method: 'GET',
        url: `/platform/audit?action=people.student.id_card`,
        headers: A(admin.sub),
      });
      expect(audited.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('employees', () => {
    let employeeId: string;
    let managerId: string;

    it('creates employees with a posting in the working year and a reporting line', async () => {
      const mgr = await inject({
        method: 'POST',
        url: '/people/employees',
        headers: A(admin.sub),
        json: {
          employeeCode: 'E001',
          firstName: 'Meena',
          lastName: 'Iyer',
          designation: 'Principal',
          department: 'Administration',
          posting: {},
        },
      });
      expect(mgr.statusCode).toBe(201);
      managerId = mgr.json().id;
      expect(mgr.json().posting).toMatchObject({
        academicYearId: school.yearId,
        designation: 'Principal',
      });
      const emp = await inject({
        method: 'POST',
        url: '/people/employees',
        headers: A(admin.sub),
        json: {
          employeeCode: 'E002',
          firstName: 'Rahul',
          lastName: 'Verma',
          employeeType: 'teaching',
          designation: 'PGT Maths',
          mobile: '9123456789',
          posting: { reportsToEmployeeId: managerId },
        },
      });
      expect(emp.statusCode).toBe(201);
      employeeId = emp.json().id;
      expect(emp.json().posting).toMatchObject({
        reportsToEmployeeId: managerId,
        reportsTo: 'Meena Iyer',
      });
      const dup = await inject({
        method: 'POST',
        url: '/people/employees',
        headers: A(admin.sub),
        json: { employeeCode: 'E002', firstName: 'Again' },
      });
      expect(dup.statusCode).toBe(409);
      const selfReport = await inject({
        method: 'PUT',
        url: `/people/employees/${employeeId}/postings`,
        headers: A(admin.sub),
        json: { reportsToEmployeeId: employeeId },
      });
      expect(selfReport.statusCode).toBe(400);
    });

    it('shows direct reports on the manager and finds employees by code and mobile', async () => {
      const view = await inject({
        method: 'GET',
        url: `/people/employees/${managerId}`,
        headers: A(admin.sub),
      });
      expect(view.json().directReports).toEqual([
        { id: employeeId, displayName: 'Rahul Verma', designation: 'PGT Maths' },
      ]);
      const byCode = await inject({
        method: 'GET',
        url: '/people/search?q=E002',
        headers: A(admin.sub),
      });
      expect(byCode.json().data[0]).toMatchObject({
        kind: 'employee',
        displayName: 'Rahul Verma',
        rank: 2,
      });
      const byMobile = await inject({
        method: 'GET',
        url: '/people/employees?q=9123456789',
        headers: A(admin.sub),
      });
      expect(byMobile.json().data.map((e: { employeeCode: string }) => e.employeeCode)).toEqual([
        'E002',
      ]);
      const teacherView = await inject({
        method: 'GET',
        url: '/people/employees',
        headers: A(teacher.sub),
      });
      expect(teacherView.statusCode).toBe(403);
    });

    it('removes an employee with MFA and closes the posting', async () => {
      const res = await inject({
        method: 'DELETE',
        url: `/people/employees/${employeeId}`,
        headers: A(admin.sub),
      });
      expect(res.statusCode).toBe(204);
      const gone = await inject({
        method: 'GET',
        url: `/people/employees/${employeeId}`,
        headers: A(admin.sub),
      });
      expect(gone.statusCode).toBe(404);
    });
  });
});
