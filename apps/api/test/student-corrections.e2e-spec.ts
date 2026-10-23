/**
 * Detail corrections (docs/design/37, part 1): a student's name parts, date of birth, gender and parents'
 * names change only by a request the approval levels decide; the old and new values are kept.
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

describe('student detail corrections (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coord: SeededUser;
  let teacher: SeededUser;
  let studentId: string;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('SCR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coord = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'V', name: 'Class V' },
    });
    const sec = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(admin),
        json: { name: 'A' },
      })
    ).json().id;
    const r = await inject({
      method: 'POST',
      url: '/people/profile/quick-add',
      headers: h(admin),
      json: {
        classSectionId: sec,
        values: {
          admission_no: 'C1',
          first_name: 'Rohan',
          last_name: 'Mehta',
          dob: '10-10-2015',
          gender: 'Male',
          father_name: 'Sunil Mehta',
          sms_mobile: '9812300001',
          category: 'General',
          ews: 'No',
          boarding: 'Day Scholar',
        },
      },
    });
    expect(r.statusCode).toBe(201);
    studentId = r.json().id;
  });
  afterAll(async () => app.close());

  const profile = async () =>
    (
      await inject({
        method: 'GET',
        url: `/people/students/${studentId}/profile`,
        headers: h(admin),
      })
    ).json().values as Record<string, string | null>;

  it('refuses a direct edit of the name, date of birth, gender or a parent’s name; other fields save', async () => {
    const viaProfile = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}/profile`,
      headers: h(admin),
      json: { values: { dob: '11-10-2015' } },
    });
    expect(viaProfile.statusCode).toBe(409);
    expect(viaProfile.json().detail).toMatch(/Correct details/);
    const father = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}/profile`,
      headers: h(admin),
      json: { values: { father_name: 'Anil Mehta' } },
    });
    expect(father.statusCode).toBe(409);
    const viaStudent = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}`,
      headers: h(admin),
      json: { firstName: 'Rohit' },
    });
    expect(viaStudent.statusCode).toBe(409);
    // the same values sent back (the forms send every field) and other fields go through
    const ok = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}/profile`,
      headers: h(admin),
      json: { values: { first_name: 'rohan', father_name: 'SUNIL MEHTA', blood_group: 'B+' } },
    });
    expect(ok.statusCode).toBe(200);
    const okStudent = await inject({
      method: 'PATCH',
      url: `/people/students/${studentId}`,
      headers: h(admin),
      json: { firstName: 'ROHAN', gender: 'male', house: 'Blue' },
    });
    expect(okStudent.statusCode).toBe(200);
    const v = await profile();
    expect(v.first_name).toBe('ROHAN');
    expect(v.blood_group).toBe('B+');
  });

  it('a request waits for the approval levels; the record changes only when approved', async () => {
    const setup = await inject({
      method: 'GET',
      url: '/people/students/corrections/setup',
      headers: h(coord),
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().levels).toEqual([
      expect.objectContaining({ level: 1, name: 'Principal approval' }),
    ]);
    const blocked = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections`,
      headers: h(teacher),
      json: { values: { dob: '2015-11-10' }, reason: 'Birth certificate' },
    });
    expect(blocked.statusCode).toBe(403);
    const other = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections`,
      headers: h(coord),
      json: { values: { blood_group: 'O+' }, reason: 'Wrong' },
    });
    expect(other.statusCode).toBe(400);
    const nothing = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections`,
      headers: h(coord),
      json: { values: { first_name: 'Rohan' }, reason: 'Same' },
    });
    expect(nothing.statusCode).toBe(400);
    const r = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections`,
      headers: h(coord),
      json: {
        values: { dob: '10-11-2015', middle_name: 'Kumar', father_name: 'Anil Mehta' },
        reason: 'As in the birth certificate',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      waitingAt: 'Principal approval',
      mine: true,
    });
    expect(r.json().changes).toEqual(
      expect.arrayContaining([
        { key: 'dob', label: 'Date of Birth', from: '2015-10-10', to: '2015-11-10' },
        { key: 'father_name', label: "Father's Name", from: 'SUNIL MEHTA', to: 'ANIL MEHTA' },
        { key: 'middle_name', label: 'Middle Name', from: null, to: 'KUMAR' },
      ]),
    );
    expect((await profile()).dob).toBe('2015-10-10');
    // one open request at a time
    const second = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections`,
      headers: h(coord),
      json: { values: { gender: 'Female' }, reason: 'Another' },
    });
    expect(second.statusCode).toBe(409);
    // the principal finds it in the approval inbox, with the old and new values
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h(admin) });
    const step = (
      inbox.json().data as Array<{
        id: string;
        instance: { entityType: string; payload: { studentId: string; changes: unknown[] } };
      }>
    ).find((x) => x.instance.entityType === 'student_correction')!;
    expect(step.instance.payload.studentId).toBe(studentId);
    expect(step.instance.payload.changes).toHaveLength(3);
    const ok = await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(admin),
      json: { note: 'Checked the certificate' },
    });
    expect(ok.statusCode).toBe(201);
    const v = await profile();
    expect(v).toMatchObject({ dob: '2015-11-10', middle_name: 'KUMAR', father_name: 'ANIL MEHTA' });
    const list = await inject({
      method: 'GET',
      url: `/people/students/${studentId}/corrections`,
      headers: h(admin),
    });
    expect(list.json().data[0]).toMatchObject({
      status: 'applied',
      note: 'Checked the certificate',
      reason: 'As in the birth certificate',
      waitingAt: null,
    });
  });

  it('a rejected or withdrawn request leaves the record as it was', async () => {
    const ask = (gender: string) =>
      inject({
        method: 'POST',
        url: `/people/students/${studentId}/corrections`,
        headers: h(coord),
        json: { values: { gender }, reason: 'Entered wrong' },
      });
    const r = await ask('Female');
    expect(r.statusCode).toBe(201);
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h(admin) });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'student_correction')!;
    const no = await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/reject`,
      headers: h(admin),
      json: { note: 'The certificate says male' },
    });
    expect(no.statusCode).toBe(201);
    expect((await profile()).gender).toBe('Male');
    const w = await ask('Female');
    expect(w.statusCode).toBe(201);
    const back = await inject({
      method: 'POST',
      url: `/people/students/${studentId}/corrections/${w.json().id}/withdraw`,
      headers: h(coord),
      json: {},
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('withdrawn');
    expect((await profile()).gender).toBe('Male');
    const list = await inject({
      method: 'GET',
      url: `/people/students/${studentId}/corrections`,
      headers: h(admin),
    });
    expect(list.json().data.map((x: { status: string }) => x.status)).toEqual([
      'withdrawn',
      'rejected',
      'applied',
    ]);
  });
});
