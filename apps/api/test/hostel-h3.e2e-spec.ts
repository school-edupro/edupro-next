/**
 * Hostel module H3 (0149): the approved-visitor list (parent adds, warden approves, office adds directly,
 * parents on record count), visiting hours, hostel visits at the gate (in when listed and in hours, else
 * waiting for the warden), and the mess (meals, weekly menu with a dated change, meal attendance with the
 * away pupils left out, diets with the allergy on record, the family's menu).
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

const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(1200, 7).toString('base64')}`;
const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

describe('hostel module H3 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let warden: SeededUser;
  let other: SeededUser;
  let parent: SeededUser;
  let guard: SeededUser;
  const ids: Record<string, string> = {};
  const today = ist();
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = async (url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();

  beforeAll(async () => {
    const s = stamp('HS3');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      other = await seedUser(c, school, `${s}-other`, 'warden');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      guard = await seedUser(c, school, `${s}-guard`, 'gate_security');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'VII',
      name: 'Class VII',
      displayOrder: 7,
    });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, admin, {
      name: 'A',
    });
    const st = await post('/people/students', admin, {
      admissionNo: 'HS3-1',
      firstName: 'Kabir',
      lastName: 'Boarder',
      gender: 'male',
      dob: '2013-01-01',
      guardians: [
        {
          guardian: { firstName: 'Papa', lastName: 'K', mobile: '9876500081' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    ids.kabir = st.json().id as string;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500081' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query(
        `UPDATE students SET profile = profile || '{"medical_condition": "Peanut allergy"}'::jsonb WHERE id = $1`,
        [ids.kabir],
      );
    });
    for (const [code, user] of [
      ['W1', warden],
      ['W2', other],
    ] as const) {
      const e = await post('/people/employees', admin, {
        employeeCode: code,
        firstName: code,
        lastName: 'Warden',
        employeeType: 'non_teaching',
        designation: 'Warden',
        posting: {},
      });
      ids[code] = e.json().id as string;
      await withMigrator((c) =>
        c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [user.id, ids[code]]),
      );
    }
    const bh = await post('/hostel/hostels', admin, {
      name: 'Boys Hostel',
      code: 'BH',
      gender: 'boys',
    });
    const oh = await post('/hostel/hostels', admin, { name: 'Other Hostel', code: 'OH' });
    ids.bh = bh.json().id as string;
    ids.oh = oh.json().id as string;
    await put(`/hostel/hostels/${ids.bh}/wardens`, admin, {
      wardens: [{ employeeId: ids.W1, isHead: true }],
    });
    await put(`/hostel/hostels/${ids.oh}/wardens`, admin, {
      wardens: [{ employeeId: ids.W2, isHead: true }],
    });
    const t = await post('/hostel/room-types', admin, { name: 'Double', seater: 2 });
    await post('/hostel/rooms', admin, { hostelId: ids.bh, roomNo: '1', roomTypeId: t.json().id });
    const bed = (await get(`/hostel/rooms?hostelId=${ids.bh}`)).data[0].beds[0].id as string;
    const a = await post('/hostel/allotments', admin, {
      studentId: ids.kabir,
      bedId: bed,
      fromDate: today,
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

  it('a parent adds a visitor; only the pupil’s warden approves; the office adds directly', async () => {
    const add = await post('/hostel/mine/visitors', parent, {
      studentId: ids.kabir,
      name: 'Uncle Raj',
      relation: 'Uncle',
      mobile: '9876500082',
      photo: PHOTO,
    });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toMatchObject({ status: 'pending' });
    ids.uncle = add.json().id as string;
    expect(
      (
        await post('/hostel/mine/visitors', parent, {
          studentId: ids.kabir,
          name: 'Again',
          relation: 'Uncle',
          mobile: '9876500082',
        })
      ).statusCode,
    ).toBe(409);
    const mine = await get(`/hostel/mine/visitors?studentId=${ids.kabir}`, parent);
    expect(mine.onRecord[0]).toMatchObject({ relation: 'father', mobile: '9876500081' });
    expect(mine.visitors[0]).toMatchObject({
      name: 'Uncle Raj',
      status: 'pending',
      hasPhoto: true,
    });
    // the other hostel's warden does not see or decide it
    expect((await get('/hostel/visitors?status=pending', other)).data).toEqual([]);
    expect(
      (await post(`/hostel/visitors/${ids.uncle}/decide`, other, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await get('/hostel/visitors?status=pending', warden)).data.map((x: { id: string }) => x.id),
    ).toEqual([ids.uncle]);
    expect(
      (await post(`/hostel/visitors/${ids.uncle}/decide`, warden, { outcome: 'approved' })).json(),
    ).toMatchObject({
      status: 'approved',
    });
    const office = await post('/hostel/visitors', admin, {
      studentId: ids.kabir,
      name: 'Aunt Meera',
      relation: 'Aunt',
      mobile: '9876500083',
    });
    expect(office.json()).toMatchObject({ status: 'approved' });
  });

  it('the gate lets in a listed visitor within hours; others wait for the warden; the parent is told', async () => {
    // no hours set: any time
    const listed = await get(
      `/hostel/visits/check?studentId=${ids.kabir}&mobile=9876500082`,
      guard,
    );
    expect(listed).toMatchObject({
      listed: true,
      inHours: true,
      hours: 'Any time',
      hostel: { name: 'Boys Hostel' },
    });
    const inVisit = await post('/hostel/visits', guard, {
      studentId: ids.kabir,
      visitorName: 'Uncle Raj',
      mobile: '9876500082',
      relation: 'Uncle',
      photo: PHOTO,
    });
    expect(inVisit.json()).toMatchObject({ state: 'inside', listed: true, inHours: true });
    // a stranger waits, and so does a listed visitor outside the hours
    const stranger = await post('/hostel/visits', guard, {
      studentId: ids.kabir,
      visitorName: 'Mr Stranger',
      mobile: '9876500089',
      relation: 'Family friend',
    });
    expect(stranger.json()).toMatchObject({
      state: 'waiting',
      listed: false,
      why: 'not on the approved list',
    });
    const wd = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay();
    await put(`/hostel/hostels/${ids.bh}/visit-hours`, admin, {
      hours: [{ weekday: (wd + 1) % 7, from: '10:00', to: '13:00' }],
    });
    const late = await post('/hostel/visits', guard, {
      studentId: ids.kabir,
      visitorName: 'Papa K',
      mobile: '9876500081',
      relation: 'Father',
    });
    expect(late.json()).toMatchObject({
      state: 'waiting',
      listed: true,
      inHours: false,
      why: 'outside visiting hours',
    });
    const waiting = (await get('/hostel/visits?show=waiting', warden)).data
      .map((x: { id: string }) => x.id)
      .sort();
    expect(waiting).toEqual([stranger.json().id, late.json().id].sort());
    expect((await get('/hostel/visits?show=waiting', other)).data).toEqual([]);
    // one visitor register: the visit is in the school's register, marked for the warden; the gate
    // cannot let in or refuse it there
    const register = await get('/visitors?state=waiting', admin);
    expect(register.data.find((x: { id: string }) => x.id === stranger.json().id)).toMatchObject({
      hostel: 'Boys Hostel',
      wardenDecides: true,
      visitorType: 'Hostel visitor',
    });
    for (const act of ['admit', 'refuse'])
      expect(
        (await post(`/visitors/${stranger.json().id as string}/${act}`, admin, {})).json(),
      ).toMatchObject({ type: expect.stringContaining('visitor.warden_decides') });
    expect(
      (
        await post(`/hostel/visits/${stranger.json().id as string}/decide`, other, {
          outcome: 'allowed',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(`/hostel/visits/${stranger.json().id as string}/decide`, warden, {
          outcome: 'refused',
          note: 'Not known',
        })
      ).json(),
    ).toMatchObject({ state: 'cancelled' });
    expect(
      (
        await post(`/hostel/visits/${late.json().id as string}/decide`, warden, {
          outcome: 'allowed',
        })
      ).json(),
    ).toMatchObject({
      state: 'inside',
    });
    expect(
      (
        await post(`/hostel/visits/${late.json().id as string}/decide`, warden, {
          outcome: 'allowed',
        })
      ).statusCode,
    ).toBe(409);
    const tpl = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_templates WHERE school_id = $1 AND code LIKE 'hostel_visit_%'`,
        [school.id],
      ),
    );
    expect(tpl.rows[0]!.n).toBe(4); // seeded on first use: waiting and parent, SMS and WhatsApp
  });

  it('mess: meals, the weekly menu with a dated change, the family sees the week', async () => {
    const lunch = await post('/hostel/meals', admin, {
      hostelId: ids.bh,
      name: 'Lunch',
      atTime: '13:00',
    });
    const dinner = await post('/hostel/meals', admin, {
      hostelId: ids.bh,
      name: 'Dinner',
      atTime: '20:00',
    });
    ids.lunch = lunch.json().id as string;
    ids.dinner = dinner.json().id as string;
    expect(
      (await post('/hostel/meals', admin, { hostelId: ids.bh, name: 'Lunch', atTime: '13:30' }))
        .statusCode,
    ).toBe(409);
    const entries = Array.from({ length: 7 }, (_, wd) => [
      { mealId: ids.lunch!, weekday: wd, items: `Dal, rice, roti (${String(wd)})` },
      { mealId: ids.dinner!, weekday: wd, items: 'Paneer, roti' },
    ]).flat();
    const week = await put('/hostel/menu', warden, { hostelId: ids.bh, entries });
    expect(week.statusCode).toBe(200);
    expect((await put('/hostel/menu', other, { hostelId: ids.bh, entries })).statusCode).toBe(403);
    const ch = await put('/hostel/menu/change', warden, {
      mealId: ids.lunch,
      onDate: today,
      items: 'Festival thali',
      note: 'Diwali',
    });
    const day = ch.json().days.find((d: { date: string }) => d.date === today);
    expect(day.meals[0]).toMatchObject({
      meal: 'Lunch',
      items: 'Festival thali',
      changed: true,
      note: 'Diwali',
    });
    const fam = await get(`/hostel/mine/menu?studentId=${ids.kabir}`, parent);
    expect(fam.hostel.name).toBe('Boys Hostel');
    expect(fam.week.days).toHaveLength(7);
    expect(fam.week.days.find((d: { date: string }) => d.date === today).meals[0].items).toBe(
      'Festival thali',
    );
    // back to the weekly menu
    const back = await put('/hostel/menu/change', warden, {
      mealId: ids.lunch,
      onDate: today,
      items: '',
    });
    expect(back.json().days.find((d: { date: string }) => d.date === today).meals[0].changed).toBe(
      false,
    );
  });

  it('meal attendance and the kitchen diet list (allergy from the student record)', async () => {
    const roll = await get(`/hostel/meal-roll?mealId=${ids.lunch}&on=${today}`, warden);
    expect(roll.pupils[0]).toMatchObject({
      name: 'Kabir Boarder',
      diet: 'veg',
      allergy: 'Peanut allergy',
      away: false,
    });
    const save = await post('/hostel/meal-roll', warden, {
      mealId: ids.lunch,
      on: today,
      skips: [{ studentId: ids.kabir, reason: 'Fasting' }],
    });
    expect(save.json()).toMatchObject({ served: 0, skipped: 1 });
    expect(
      (await get(`/hostel/meal-roll?mealId=${ids.lunch}&on=${today}`, warden)).pupils[0],
    ).toMatchObject({
      skipped: true,
      reason: 'Fasting',
    });
    const diet = await put(`/hostel/diets/${ids.kabir}`, warden, {
      diet: 'jain',
      noOnionGarlic: true,
      notes: 'No root vegetables',
    });
    expect(diet.statusCode).toBe(200);
    const list = (await get(`/hostel/diets?hostelId=${ids.bh}`, warden)).data;
    expect(list[0]).toMatchObject({ diet: 'jain', noOnionGarlic: true, allergy: 'Peanut allergy' });
    expect(
      (await inject({ method: 'GET', url: `/hostel/diets?hostelId=${ids.bh}`, headers: h(other) }))
        .statusCode,
    ).toBe(403);
  });
});
