/**
 * Hostel withdrawal, part 4 (0163): a parent asks in the parent app for the child to leave the hostel; the
 * office declines it or starts the withdrawal from it; the room check-out list makes the damage charge;
 * the clearance certificate is ready once the withdrawal is approved (for the office and the family).
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

const plus = (n: number) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 + n * 86_400_000).toISOString().slice(0, 10);

describe('hostel exit requests, check-out and clearance (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let warden: SeededUser;
  let accountant: SeededUser;
  let parent: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = async (url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();

  beforeAll(async () => {
    const s = stamp('HEX');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', {
      code: 'VII',
      name: 'Class VII',
      displayOrder: 7,
    });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' });
    const st = await post('/people/students', {
      admissionNo: 'HEX-1',
      firstName: 'Neha',
      lastName: 'Boarder',
      gender: 'female',
      dob: '2013-03-03',
      admittedOn: '2020-04-05',
      guardians: [
        {
          guardian: { firstName: 'Mohan', lastName: 'Boarder', mobile: '9876500191' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    ids.neha = st.json().id as string;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500191' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const gh = await post('/hostel/hostels', { name: 'Girls Hostel', code: 'GH', gender: 'girls' });
    ids.gh = gh.json().id as string;
    // the warden of this hostel
    const emp = await post('/people/employees', {
      employeeCode: 'HX01',
      firstName: 'Lata',
      lastName: 'Warden',
      employeeType: 'non_teaching',
      designation: 'Warden',
      mobile: '9000000191',
      posting: {},
    });
    await withMigrator((c) =>
      c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [warden.id, emp.json().id]),
    );
    await put(`/hostel/hostels/${ids.gh}/wardens`, {
      wardens: [{ employeeId: emp.json().id, isHead: true }],
    });
    const type = await post('/hostel/room-types', { name: 'Double', seater: 2 });
    await post('/hostel/rooms', { hostelId: ids.gh, roomNo: 'G7', roomTypeId: type.json().id });
    const bed = (await get(`/hostel/rooms?hostelId=${ids.gh}`)).data[0].beds[0].id as string;
    const a = await post('/hostel/allotments', {
      studentId: ids.neha,
      bedId: bed,
      fromDate: plus(-60),
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

  it('a parent asks; can take it back; the office declines with a note', async () => {
    const ask = {
      studentId: ids.neha,
      leavingOn: plus(20),
      reason: 'parent_request',
      note: 'Moving home',
    };
    expect(
      (await post('/hostel/mine/exit', { ...ask, leavingOn: plus(-1) }, parent)).statusCode,
    ).toBe(400);
    const r1 = await post('/hostel/mine/exit', ask, parent);
    expect(r1.json()).toMatchObject({ status: 'pending' });
    expect((await post('/hostel/mine/exit', ask, parent)).json()).toMatchObject({
      type: expect.stringContaining('hostel.exit_request_open'),
    });
    expect(
      (await post(`/hostel/mine/exit/${r1.json().id as string}/withdraw`, {}, parent)).json(),
    ).toMatchObject({
      status: 'withdrawn',
    });
    const r2 = await post('/hostel/mine/exit', ask, parent);
    const pending = (await get('/hostel/exit-requests', warden)).data;
    expect(pending).toEqual([
      expect.objectContaining({
        id: r2.json().id,
        pupil: 'Neha Boarder',
        hostel: 'Girls Hostel',
        note: 'Moving home',
      }),
    ]);
    // a parent cannot see the office list; the office declines with a note
    expect(
      (await inject({ method: 'GET', url: '/hostel/exit-requests', headers: h(parent) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `/hostel/exit-requests/${r2.json().id as string}/decline`,
          { note: 'Please meet the warden first' },
          warden,
        )
      ).json(),
    ).toMatchObject({ status: 'declined' });
    const mine = await get(`/hostel/mine/exit?studentId=${ids.neha}`, parent);
    expect(mine.requests[0]).toMatchObject({
      status: 'declined',
      declineNote: 'Please meet the warden first',
    });
  });

  it('the office starts the withdrawal from a request; the check-out list makes the damage charge', async () => {
    const r = await post(
      '/hostel/mine/exit',
      { studentId: ids.neha, leavingOn: plus(25), reason: 'parent_request' },
      parent,
    );
    ids.req = r.json().id as string;
    const w = await post(`/hostel/students/${ids.neha}/withdrawal`, {
      leavingOn: plus(25),
      reason: 'parent_request',
      exitRequestId: ids.req,
    });
    expect(w.statusCode).toBe(201);
    ids.w = w.json().id as string;
    expect(
      (await get(`/hostel/mine/exit?studentId=${ids.neha}`, parent)).requests[0],
    ).toMatchObject({
      status: 'started',
      withdrawalId: ids.w,
    });
    // the school's items come with the defaults; a charge each
    const items = (await get('/hostel/checkout-items')).data as Array<{
      id: string;
      name: string;
      charge: number;
    }>;
    expect(items.map((i) => i.name)).toContain('Mattress');
    const priced = items.map((i) => ({
      id: i.id,
      name: i.name,
      charge: i.name === 'Mattress' ? 500 : i.name === 'Room key' ? 100 : 0,
      active: true,
    }));
    expect((await put('/hostel/checkout-items', { items: priced }, warden)).statusCode).toBe(403);
    expect((await put('/hostel/checkout-items', { items: priced })).statusCode).toBe(200);
    const blank = await get(`/hostel/withdrawals/${ids.w}/checkout`, warden);
    expect(blank).toMatchObject({ status: 'requested', total: 0, checkedOutAt: null });
    expect(blank.charges.Mattress).toBe(500);
    const marked = blank.items.map((x: { itemId: string; name: string }) => ({
      itemId: x.itemId,
      name: x.name,
      condition: x.name === 'Mattress' ? 'damaged' : x.name === 'Room key' ? 'missing' : 'ok',
      charge: x.name === 'Mattress' ? 500 : x.name === 'Room key' ? 100 : 0,
      note: x.name === 'Mattress' ? 'Torn' : undefined,
    }));
    const saved = await put(`/hostel/withdrawals/${ids.w}/checkout`, { items: marked }, warden);
    expect(saved.json()).toMatchObject({ total: 600 });
    const row = await get(`/hostel/withdrawals/${ids.w}`);
    expect(row).toMatchObject({ damageCharge: '600.00' });
    expect(row.chargeRemarks).toContain('Mattress damaged (Torn)');
  });

  it('the clearance certificate is ready once approved, for the office and the family', async () => {
    expect((await get(`/hostel/withdrawals/${ids.w}/certificate`)).type).toContain(
      'hostel.withdrawal_not_completed',
    );
    expect(
      (await post(`/hostel/withdrawals/${ids.w}/decide`, { outcome: 'approved' }, accountant))
        .statusCode,
    ).toBe(201);
    const last = await post(`/hostel/withdrawals/${ids.w}/decide`, {
      outcome: 'approved',
      feeChoice: 'carry',
    });
    expect(last.json()).toMatchObject({ status: 'completed' });
    // the check-out cannot change after completion
    expect(
      (
        await put(
          `/hostel/withdrawals/${ids.w}/checkout`,
          { items: [{ name: 'Bed', condition: 'ok', charge: 0 }] },
          warden,
        )
      ).statusCode,
    ).toBe(409);
    const cert = await get(`/hostel/withdrawals/${ids.w}/certificate`);
    expect(cert.filename).toBe(`hostel-clearance-${ids.w}.pdf`);
    expect(
      Buffer.from(cert.base64 as string, 'base64')
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    const fam = await get(`/hostel/mine/withdrawals/${ids.w}/certificate`, parent);
    expect(fam.filename).toBe(`hostel-clearance-${ids.w}.pdf`);
  });
});
