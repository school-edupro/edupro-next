/**
 * Hostel module H3 (0149): the approved-visitor list (parent adds, warden approves, office adds directly,
 * parents on record count), visiting hours, hostel visits at the gate (in when listed and in hours, else
 * waiting for the warden), and the mess (meals, weekly menu with a dated change, meal attendance with the
 * away pupils left out, diets with the allergy on record, the family's menu). The mess rebuilt (0161):
 * school meals ticked per hostel, the rotating menu with copy, clone and export, the school's diet types and
 * allergies, the diet list (filters, pages, upload, export), the meal register, the head count, feedback.
 */
import ExcelJS from 'exceljs';
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

  // ---- the mess rebuilt (0161) -----------------------------------------------------------------------------
  const del = (url: string, u: SeededUser) => inject({ method: 'DELETE', url, headers: h(u) });
  const addDays = (d: string, n: number) => {
    const x = new Date(`${d}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const monday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    return addDays(today, -((d.getUTCDay() + 6) % 7));
  })();
  type MessMeal = {
    id: string;
    name: string;
    hostels: Array<{ hostelId: string; atTime: string; mealId: string; used: boolean }>;
  };

  it('school meals: one meal for many hostels (own time), office only; delete only when never served', async () => {
    const list = (await get('/hostel/mess/meals')) as { meals: MessMeal[] };
    const lunch = list.meals.find((m) => m.name === 'Lunch')!;
    expect(lunch.hostels.map((x) => x.hostelId)).toEqual([ids.bh]);
    ids.lunchDef = lunch.id;
    const both = await put(`/hostel/mess/meals/${lunch.id}`, admin, {
      name: 'Lunch',
      atTime: '13:00',
      hostels: [{ hostelId: ids.bh }, { hostelId: ids.oh, atTime: '13:30' }],
    });
    expect(both.statusCode).toBe(200);
    const after = ((await get('/hostel/mess/meals')) as { meals: MessMeal[] }).meals.find(
      (m) => m.id === lunch.id,
    )!;
    expect(after.hostels.find((x) => x.hostelId === ids.oh)).toMatchObject({ atTime: '13:30' });
    expect(after.hostels.find((x) => x.hostelId === ids.bh)).toMatchObject({ used: true });
    // the old per-hostel meal list still shows it (staff app)
    expect(
      (await get(`/hostel/meals?hostelId=${ids.oh}`)).data.map((m: { name: string }) => m.name),
    ).toEqual(['Lunch']);
    const snacks = await post('/hostel/mess/meals', admin, {
      name: 'Snacks',
      atTime: '17:00',
      hostels: [{ hostelId: ids.oh }],
    });
    expect(snacks.statusCode).toBe(201);
    expect(
      (await post('/hostel/mess/meals', admin, { name: 'snacks', atTime: '17:00', hostels: [] }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post('/hostel/mess/meals', warden, { name: 'Tea', atTime: '06:00', hostels: [] }))
        .statusCode,
    ).toBe(403);
    expect((await del(`/hostel/mess/meals/${snacks.json().id as string}`, admin)).statusCode).toBe(
      200,
    );
    expect((await del(`/hostel/mess/meals/${lunch.id}`, admin)).json()).toMatchObject({
      type: expect.stringContaining('hostel.meal_used'),
    });
  });

  it('the menu: a 2-week cycle, copy a day and a week, clone to another hostel, Excel and PDF', async () => {
    const cy = await put('/hostel/menu/cycle', warden, {
      hostelId: ids.bh,
      weeks: 2,
      start: monday,
    });
    expect(cy.json()).toMatchObject({ cycleWeeks: 2, thisWeek: 1 });
    expect(
      (
        await put('/hostel/menu/cycle', warden, {
          hostelId: ids.bh,
          weeks: 2,
          start: addDays(monday, 1),
        })
      ).statusCode,
    ).toBe(400);
    const w2 = await put('/hostel/menu', warden, {
      hostelId: ids.bh,
      cycleWeek: 2,
      entries: [{ mealId: ids.lunch, weekday: 1, items: 'Week 2 Monday lunch' }],
    });
    expect(w2.json().days[0]).toMatchObject({ day: 'Monday' });
    expect(w2.json().days[0].items[0]).toBe('Week 2 Monday lunch');
    // next week is week 2 of the cycle; this week still shows week 1
    const next = await get(`/hostel/menu?hostelId=${ids.bh}&weekOf=${addDays(monday, 7)}`, warden);
    expect(next).toMatchObject({ cycleWeek: 2, cycleWeeks: 2 });
    expect(next.days[0].meals.find((m: { meal: string }) => m.meal === 'Lunch').items).toBe(
      'Week 2 Monday lunch',
    );
    expect((await get(`/hostel/menu?hostelId=${ids.bh}&weekOf=${monday}`, warden)).cycleWeek).toBe(
      1,
    );
    // Monday of week 2 to Wednesday of week 2
    const day = await post('/hostel/menu/copy', warden, {
      hostelId: ids.bh,
      fromWeek: 2,
      fromWeekday: 1,
      to: [{ week: 2, weekday: 3 }],
    });
    expect(day.json().copied).toBeGreaterThan(0);
    const t2 = await get(`/hostel/menu/template?hostelId=${ids.bh}&week=2`, warden);
    expect(t2.days.find((d: { weekday: number }) => d.weekday === 3).items[0]).toBe(
      'Week 2 Monday lunch',
    );
    // a day cannot go to a whole week; a week 3 does not exist in a 2-week cycle
    expect(
      (
        await post('/hostel/menu/copy', warden, {
          hostelId: ids.bh,
          fromWeek: 1,
          fromWeekday: 1,
          to: [{ week: 2 }],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post('/hostel/menu/copy', warden, {
          hostelId: ids.bh,
          fromWeek: 1,
          to: [{ week: 3 }],
        })
      ).statusCode,
    ).toBe(400);
    // the whole of week 1 to week 2
    await post('/hostel/menu/copy', warden, { hostelId: ids.bh, fromWeek: 1, to: [{ week: 2 }] });
    expect(
      (await get(`/hostel/menu/template?hostelId=${ids.bh}&week=2`, warden)).days[0].items[0],
    ).toBe('Dal, rice, roti (1)');
    // clone to the other hostel: Lunch is served there, Dinner is not
    expect(
      (
        await post('/hostel/menu/clone', warden, {
          fromHostelId: ids.bh,
          toHostelIds: [ids.oh],
          mode: 'replace',
        })
      ).statusCode,
    ).toBe(403);
    const cl = await post('/hostel/menu/clone', admin, {
      fromHostelId: ids.bh,
      toHostelIds: [ids.oh],
      mode: 'replace',
    });
    expect(cl.json().copied).toBe(14);
    expect(cl.json().missing).toEqual(['Other Hostel: Dinner']);
    const oh = await get(`/hostel/menu/template?hostelId=${ids.oh}&week=1`);
    expect(oh).toMatchObject({ cycleWeeks: 2 });
    expect(oh.days[0].items[0]).toBe('Dal, rice, roti (1)');
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(
        `/hostel/menu/file?hostelId=${ids.bh}&weekOf=${today}&format=${format}`,
        warden,
      );
      expect(f.filename).toBe(`mess-menu-${monday}.${format}`);
      expect(f.base64.length).toBeGreaterThan(100);
    }
  });

  it('diet types and allergies of the school; the diet list filtered, paged, uploaded, cleared, exported', async () => {
    type Lists = {
      types: Array<{ id: string; code: string; name: string; isDefault: boolean; active: boolean }>;
      allergies: Array<{ id: string; name: string; active: boolean }>;
    };
    const lists = (await get('/hostel/mess/diet-types', warden)) as Lists;
    expect(lists.types.map((t) => t.code)).toEqual([
      'veg',
      'non_veg',
      'eggetarian',
      'jain',
      'vegan',
    ]);
    expect(lists.types.find((t) => t.isDefault)!.code).toBe('veg');
    expect(lists.allergies.length).toBe(8);
    const keep = (codes: string[]) => lists.types.filter((t) => codes.includes(t.code));
    // kabir is jain (the earlier case): jain cannot go; vegan can
    expect(
      (
        await put('/hostel/mess/diet-types', admin, {
          types: keep(['veg', 'non_veg', 'eggetarian']),
          allergies: lists.allergies,
        })
      ).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.diet_used') });
    const saved = await put('/hostel/mess/diet-types', admin, {
      types: [
        ...keep(['veg', 'non_veg', 'eggetarian', 'jain']),
        { code: 'sattvic', name: 'Sattvic', active: true, isDefault: false },
      ],
      allergies: [...lists.allergies, { name: 'Mustard', active: true }],
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as Lists).types.map((t) => t.code)).toContain('sattvic');
    expect((await put('/hostel/mess/diet-types', warden, saved.json())).statusCode).toBe(403);
    const d = await put(`/hostel/diets/${ids.kabir}`, warden, {
      diet: 'sattvic',
      noOnionGarlic: true,
      allergies: ['mustard', 'Peanuts'],
    });
    expect(d.json()).toMatchObject({ diet: 'sattvic', allergies: ['Mustard', 'Peanuts'] });
    expect(
      (await put(`/hostel/diets/${ids.kabir}`, warden, { diet: 'keto' })).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.diet_unknown') });
    expect(
      (
        await put(`/hostel/diets/${ids.kabir}`, warden, { diet: 'veg', allergies: ['Pollen'] })
      ).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.allergy_unknown') });
    const byDiet = await get('/hostel/diets?diet=sattvic', warden);
    expect(byDiet).toMatchObject({ total: 1, page: 1 });
    expect(byDiet.data[0]).toMatchObject({
      name: 'Kabir Boarder',
      dietName: 'Sattvic',
      hostel: 'Boys Hostel',
    });
    expect(byDiet.counts).toEqual([{ diet: 'sattvic', name: 'Sattvic', n: 1 }]);
    expect((await get('/hostel/diets?allergy=Mustard', warden)).total).toBe(1);
    expect((await get('/hostel/diets?allergy=_record', warden)).total).toBe(1);
    expect((await get('/hostel/diets?set=unset', warden)).total).toBe(0);
    expect((await get('/hostel/diets?q=nobody', warden)).total).toBe(0);
    // the other hostel's warden sees no boarder of this hostel
    expect((await get('/hostel/diets', other)).total).toBe(0);
    // upload: the format comes with the boarders; a wrong row saves nothing
    const tpl = await get(`/hostel/diets/template?hostelId=${ids.bh}`, warden);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(tpl.base64 as string, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(2).getCell(3).value).toBe('Sattvic');
    ws.getRow(2).getCell(3).value = 'Non-vegetarian';
    ws.getRow(2).getCell(5).value = 'Gluten';
    ['NOPE-1', 'Ghost', 'Vegetarian', 'No'].forEach((v, i) => {
      ws.getRow(3).getCell(i + 1).value = v;
    });
    const bad = await post('/hostel/diets/upload', warden, {
      fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    });
    expect(bad.json()).toMatchObject({
      saved: 0,
      errors: [{ row: 3, message: 'No pupil with admission no. NOPE-1' }],
    });
    [1, 2, 3, 4].forEach((i) => {
      ws.getRow(3).getCell(i).value = null;
    });
    const good = await post('/hostel/diets/upload', warden, {
      fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    });
    expect(good.json()).toMatchObject({ saved: 1, errors: [] });
    expect((await get('/hostel/diets', warden)).data[0]).toMatchObject({
      diet: 'non_veg',
      allergies: ['Gluten'],
    });
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(`/hostel/diets/file?format=${format}`, warden);
      expect(f.filename).toBe(`hostel-diet-list.${format}`);
    }
    expect((await del(`/hostel/diets/${ids.kabir}`, warden)).statusCode).toBe(200);
    expect((await get('/hostel/diets', warden)).data[0]).toMatchObject({ diet: 'veg', set: false });
    expect((await del(`/hostel/diets/${ids.kabir}`, warden)).statusCode).toBe(404);
  });

  it('the meal register, the kitchen head count, and the family rates a meal', async () => {
    const month = today.slice(0, 7);
    const reg = await get(`/hostel/meal-register?month=${month}&hostelId=${ids.bh}`, warden);
    expect(reg.meals.map((m: { short: string }) => m.short)).toEqual(['L', 'D']);
    const kabir = reg.rows[0];
    const at = (reg.days.length - 1) * 2;
    // lunch today was marked with Kabir skipping; dinner not marked
    expect(kabir.cells.slice(at)).toEqual(['X', '-']);
    expect(kabir).toMatchObject({ skipped: 1, had: 0 });
    expect(
      (
        await inject({
          method: 'GET',
          url: `/hostel/meal-register?month=${month}&hostelId=${ids.bh}`,
          headers: h(other),
        })
      ).statusCode,
    ).toBe(403);
    for (const format of ['xlsx', 'pdf'])
      expect(
        (await get(`/hostel/meal-register/file?month=${month}&format=${format}`, warden)).filename,
      ).toBe(`hostel-meal-register-${month}.${format}`);
    const hc = await get(`/hostel/headcount?on=${today}`, warden);
    const lunch = hc.rows.find((r: { meal: string }) => r.meal === 'Lunch');
    expect(lunch).toMatchObject({
      hostel: 'Boys Hostel',
      boarders: 1,
      away: 0,
      toCook: 1,
      onRecord: 1,
    });
    expect(lunch.byDiet.find((x: { diet: string }) => x.diet === 'veg').n).toBe(1);
    expect(lunch.marked).toMatchObject({ had: 0, skipped: 1 });
    expect((await get(`/hostel/headcount/file?on=${today}&format=pdf`, warden)).filename).toBe(
      `kitchen-head-count-${today}.pdf`,
    );
    // feedback on a meal already served today (an early tea at 00:01)
    const tea = await post('/hostel/mess/meals', admin, {
      name: 'Early tea',
      atTime: '00:01',
      hostels: [{ hostelId: ids.bh }],
    });
    const teaMeal = ((await get('/hostel/mess/meals')) as { meals: MessMeal[] }).meals.find(
      (m) => m.id === tea.json().id,
    )!.hostels[0]!.mealId;
    const mine = await get(`/hostel/mine/feedback?studentId=${ids.kabir}`, parent);
    expect(mine.data.map((x: { mealId: string }) => x.mealId)).toContain(teaMeal);
    const rate = await post('/hostel/mine/feedback', parent, {
      studentId: ids.kabir,
      mealId: teaMeal,
      onDate: today,
      rating: 4,
      comment: 'Tea was cold',
    });
    expect(rate.statusCode).toBe(201);
    await post('/hostel/mine/feedback', parent, {
      studentId: ids.kabir,
      mealId: teaMeal,
      onDate: today,
      rating: 2,
      comment: 'Tea was cold again',
    });
    expect(
      (
        await post('/hostel/mine/feedback', parent, {
          studentId: ids.kabir,
          mealId: teaMeal,
          onDate: addDays(today, 1),
          rating: 5,
        })
      ).json(),
    ).toMatchObject({ type: expect.stringContaining('hostel.feedback_window') });
    const fb = await get(`/hostel/feedback?hostelId=${ids.bh}`, warden);
    expect(fb.meals).toEqual([
      expect.objectContaining({
        meal: 'Early tea',
        ratings: 1,
        average: 2,
        spread: [0, 1, 0, 0, 0],
      }),
    ]);
    expect(fb.comments[0]).toMatchObject({ pupil: 'Kabir Boarder', comment: 'Tea was cold again' });
    expect((await get('/hostel/feedback', other)).meals).toEqual([]);
  });

  it('the visit register and the approved visitors as Excel and PDF; a warden of another hostel only theirs', async () => {
    for (const [path, name] of [
      ['/hostel/visits/file', 'hostel-visit-register'],
      ['/hostel/visitors/file', 'hostel-approved-visitors'],
    ] as const)
      for (const format of ['xlsx', 'pdf']) {
        const f = await get(`${path}?format=${format}&hostelId=${ids.bh}`, warden);
        expect(f.filename).toBe(`${name}.${format}`);
        expect(f.base64.length).toBeGreaterThan(100);
      }
    // the visits of today are in the register (the gate case registered some)
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      Buffer.from(
        (await get(`/hostel/visits/file?format=xlsx&from=${today}`, warden)).base64 as string,
        'base64',
      ) as unknown as ArrayBuffer,
    );
    const text = JSON.stringify(wb.worksheets[0]!.getSheetValues());
    expect(text).toContain('Uncle Raj');
    expect(text).toContain('Kabir Boarder');
    const list = new ExcelJS.Workbook();
    await list.xlsx.load(
      Buffer.from(
        (await get(`/hostel/visitors/file?format=xlsx`, warden)).base64 as string,
        'base64',
      ) as unknown as ArrayBuffer,
    );
    const rows = JSON.stringify(list.worksheets[0]!.getSheetValues());
    expect(rows).toContain('On the school record');
    expect(rows).toContain('Aunt Meera');
    expect(
      (
        await inject({
          method: 'GET',
          url: `/hostel/visits/file?hostelId=${ids.bh}`,
          headers: h(other),
        })
      ).statusCode,
    ).toBe(403);
  });
});
