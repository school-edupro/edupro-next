/**
 * Hostel reports (17 Oct 2026): allotment register, occupancy, withdrawals and leave as reports with the
 * father, mother, guardian (name, mobile, email) and address; the user's own columns or the school's
 * default; Excel and PDF of the chosen columns. And a hostel withdrawal may record any last day from the
 * stay's start (no notice month for a day before the request).
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

interface Report {
  columns: Array<{ key: string; group?: string }>;
  rows: Array<{ cells: Record<string, string | number | null>; studentId: string | null }>;
  total: number;
  choice: { columns: Array<{ key: string; hidden: boolean; fixed: boolean }>; source: string };
  hidden: string[];
}

describe('hostel reports (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let warden: SeededUser;
  let clerk: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const report = async (id: string, qs = '', u: SeededUser = admin) =>
    inject({ method: 'GET', url: `/hostel/reports/${id}${qs ? `?${qs}` : ''}`, headers: h(u) });

  beforeAll(async () => {
    const s = stamp('HRP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      clerk = await seedUser(c, school, `${s}-clerk`, 'clerk');
      // the hostel withdrawal's first approval level
      await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', {
      code: 'VIII',
      name: 'Class VIII',
      displayOrder: 8,
    });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' });
    const st = await post('/people/students', {
      admissionNo: 'HRP-1',
      firstName: 'Kabir',
      lastName: 'Boarder',
      gender: 'male',
      dob: '2012-02-02',
      admittedOn: '2020-04-05',
      address: { line1: '12 Lake Road', city: 'Pune', pincode: '411001' },
      guardians: [
        {
          guardian: {
            firstName: 'Raj',
            lastName: 'Boarder',
            mobile: '9876500111',
            email: 'raj@example.test',
          },
          relation: 'father',
          isPrimary: true,
        },
        {
          guardian: {
            firstName: 'Rita',
            lastName: 'Boarder',
            mobile: '9876500112',
            email: 'rita@example.test',
          },
          relation: 'mother',
          isPrimary: false,
        },
        {
          guardian: { firstName: 'Om', lastName: 'Uncle', mobile: '9876500113' },
          relation: 'other',
          isPrimary: false,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    ids.kabir = st.json().id as string;
    const boys = await post('/hostel/hostels', { name: 'Boys Hostel', code: 'BH', gender: 'boys' });
    ids.boys = boys.json().id as string;
    const type = await post('/hostel/room-types', { name: 'Double', seater: 2 });
    await post('/hostel/rooms', { hostelId: ids.boys, roomNo: '201', roomTypeId: type.json().id });
    const rooms = (await inject({ method: 'GET', url: '/hostel/rooms', headers: h() })).json()
      .data as Array<{ roomNo: string; beds: Array<{ id: string; label: string }> }>;
    const a = await post('/hostel/allotments', {
      studentId: ids.kabir,
      bedId: rooms.find((r) => r.roomNo === '201')!.beds[0]!.id,
      fromDate: '2026-04-01',
    });
    expect(a.statusCode).toBe(201);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    ).catch(() => undefined);
    if (app) await app.close();
  });

  it('the allotment register and occupancy carry the father, mother, guardian and address', async () => {
    for (const id of ['register', 'occupancy']) {
      const r = (await report(id)).json() as Report;
      expect(r.total).toBe(1);
      const cells = r.rows[0]!.cells;
      expect(cells).toMatchObject({
        pupil: 'Kabir Boarder',
        father_name: 'Raj Boarder',
        father_mobile: '9876500111',
        father_email: 'raj@example.test',
        mother_name: 'Rita Boarder',
        mother_mobile: '9876500112',
        guardian_name: 'Om Uncle',
        guardian_relation: 'Other',
        guardian_mobile: '9876500113',
      });
      expect(String(cells.address)).toContain('12 Lake Road');
      expect(String(cells.address)).toContain('411001');
      expect(r.columns.filter((c) => c.group === 'Father').map((c) => c.key)).toEqual([
        'father_name',
        'father_mobile',
        'father_email',
      ]);
    }
  });

  it('keeps the user’s own columns, the school default by the set-up right, and the reset', async () => {
    const mine = await inject({
      method: 'PUT',
      url: '/hostel/reports/register/columns',
      headers: h(warden),
      json: { hidden: ['father_email', 'mother_email', 'pupil'], scope: 'user' },
    });
    expect(mine.statusCode).toBe(200);
    const w = (await report('register', '', warden)).json() as Report;
    expect(w.choice.source).toBe('user');
    expect(w.columns.map((c) => c.key)).not.toContain('father_email');
    // a fixed column cannot be left out
    expect(w.columns.map((c) => c.key)).toContain('pupil');
    // a warden cannot set the school default
    const school = await inject({
      method: 'PUT',
      url: '/hostel/reports/register/columns',
      headers: h(warden),
      json: { hidden: ['address'], scope: 'school' },
    });
    expect(school.statusCode).toBe(403);
    const byAdmin = await inject({
      method: 'PUT',
      url: '/hostel/reports/register/columns',
      headers: h(),
      json: { hidden: ['address'], scope: 'school' },
    });
    expect(byAdmin.statusCode).toBe(200);
    expect(((await report('register')).json() as Report).columns.map((c) => c.key)).not.toContain(
      'address',
    );
    // the warden keeps their own until they go back to the school's
    await inject({ method: 'DELETE', url: '/hostel/reports/register/columns', headers: h(warden) });
    const back = (await report('register', '', warden)).json() as Report;
    expect(back.choice.source).toBe('school');
    expect(back.columns.map((c) => c.key)).toContain('father_email');
    expect(back.columns.map((c) => c.key)).not.toContain('address');
  });

  it('gives Excel and PDF of each report; refuses one the user may not open', async () => {
    for (const id of ['register', 'occupancy', 'withdrawals', 'leave'])
      for (const format of ['xlsx', 'pdf']) {
        const f = await inject({
          method: 'GET',
          url: `/hostel/reports/${id}/file?format=${format}`,
          headers: h(),
        });
        expect(f.statusCode).toBe(200);
        expect(f.json().filename).toBe(`hostel-${id}.${format}`);
        expect(f.json().base64.length).toBeGreaterThan(100);
      }
    expect((await report('register', '', clerk)).statusCode).toBe(403);
    expect((await report('nothing')).statusCode).toBe(404);
  });

  it('records a pupil who left long ago: any last day from the stay start, no notice month', async () => {
    const before = await post(`/hostel/students/${ids.kabir}/withdrawal`, {
      leavingOn: '2026-03-31',
      reason: 'other',
    });
    expect(before.json().type).toContain('hostel.before_stay');
    const w = await post(`/hostel/students/${ids.kabir}/withdrawal`, {
      requestedOn: '2026-10-16',
      leavingOn: '2026-04-30',
      reason: 'parent_request',
    });
    expect(w.statusCode).toBe(201);
    expect(w.json()).toMatchObject({ noticeShort: false, leavingOn: '2026-04-30' });
    const listed = (await report('withdrawals')).json() as Report;
    expect(listed.rows[0]!.cells).toMatchObject({
      leaving: '30-04-2026',
      father_mobile: '9876500111',
    });
  });
});
