/**
 * Transport v2 (0077): the charge by the school's rule, a family's request through the transport
 * in-charge and the fee department, the office's request straight to the fee department, the periods
 * (history) they leave, the fees of exactly those months, a withdrawal from a month, and the reports.
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

describe('transport desk (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let incharge: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  let studentId: string;
  let months: string[] = [];
  const route: Record<string, string> = {};
  const stop: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  /** The transport fee raised per month (YYYY-MM → net). */
  const transportFees = () =>
    withMigrator(async (c) => {
      const r = await c.query<{ m: string; net: number }>(
        `SELECT to_char(make_date(fp.year, fp.month, 1), 'YYYY-MM') AS m, d.net::float AS net
           FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id JOIN fee_heads fh ON fh.id = d.head_id
          WHERE d.student_id = $1 AND fh.kind = 'transport' AND d.status <> 'cancelled' ORDER BY fp.sequence`,
        [studentId],
      );
      return Object.fromEntries(r.rows.map((x) => [x.m, x.net]));
    });

  beforeAll(async () => {
    s = stamp('TD');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      incharge = await seedUser(c, school, `${s}-incharge`, 'transport_incharge');
      accountant = await seedUser(c, school, `${s}-accounts`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    const sec = await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' });
    const tui = await post('/fees/heads', admin, { code: 'TUI', name: 'Tuition', sortOrder: 1 });
    await post('/fees/heads', admin, {
      code: 'TRN',
      name: 'Transport',
      kind: 'transport',
      sortOrder: 9,
    });
    const periods = await post('/fees/periods/generate', admin, {
      dueDay: 10,
      monthsPerInstalment: 1,
    });
    expect(periods.statusCode).toBe(201);
    const structure = await put(`/fees/structures/${cls.json().id}`, admin, {
      feeGroup: 'general',
      entries: [{ headId: tui.json().id, amount: 1000, frequency: 'monthly' }],
    });
    expect(structure.statusCode).toBe(200);
    const slab: Record<string, string> = {};
    for (const [code, amount] of [
      ['S1', 1000],
      ['S2', 1500],
    ] as const) {
      const r = await post('/fees/slabs', admin, {
        code,
        name: `Slab ${code}`,
        monthlyAmount: amount,
      });
      expect(r.statusCode).toBe(201);
      slab[code] = r.json().id;
    }
    for (const [code, name, stops] of [
      [
        'R1',
        'Kothrud',
        [
          { name: 'Karve Nagar', pickupTime: '07:20', dropTime: '14:40', slabId: slab.S1 },
          { name: 'Warje', pickupTime: '07:05', dropTime: '14:55', slabId: slab.S2 },
        ],
      ],
      [
        'R2',
        'Baner',
        [{ name: 'Baner Road', pickupTime: '07:10', dropTime: '14:50', slabId: slab.S2 }],
      ],
    ] as const) {
      const r = await post('/transport/routes', admin, { code, name });
      expect(r.statusCode).toBe(201);
      route[code] = r.json().id;
      const st = await put(`/transport/routes/${route[code]}/stops`, admin, { stops });
      expect(st.statusCode).toBe(200);
      for (const x of st.json().data as Array<{ id: string; name: string }>) stop[x.name] = x.id;
    }
    const st = await post('/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Aanya',
      lastName: 'Rider',
      guardians: [
        {
          guardian: { firstName: 'Rohit', lastName: 'Rider', mobile: '9876519771' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876519771' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    expect((await post(`/fees/students/${studentId}/demands/generate`, admin)).statusCode).toBe(
      201,
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('the set-up starts with the two approval chains; the rule is the school’s', async () => {
    expect((await get('/transport/desk/setup', incharge)).statusCode).toBe(403);
    const setup = (await get('/transport/desk/setup')).json();
    expect(
      setup.levels.map((l: { source: string; label: string }) => `${l.source}:${l.label}`),
    ).toEqual(['parent:Transport in-charge', 'parent:Fee department', 'office:Fee department']);
    const body = {
      oneWayPercent: 60,
      twoStopRule: 'higher',
      parentCanApply: true,
      notifyEmail: false,
      levels: setup.levels,
    };
    const none = await put('/transport/desk/setup', admin, {
      ...body,
      levels: setup.levels.filter((l: { source: string }) => l.source === 'parent'),
    });
    expect(none.statusCode).toBe(400);
    const saved = await put('/transport/desk/setup', admin, body);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({ oneWayPercent: 60, twoStopRule: 'higher' });
    expect(saved.json().templates.length).toBeGreaterThanOrEqual(6);
  });

  it('quotes the monthly charge: full slab both ways, a share one way, the higher slab for two stoppages', async () => {
    const q = async (qs: string) => (await get(`/transport/requests/quote?${qs}`, parent)).json();
    expect(await q(`service=both&pickStopId=${stop['Karve Nagar']}`)).toMatchObject({
      amount: 1000,
      slab: 'Slab S1',
    });
    expect((await q(`service=pick&pickStopId=${stop['Karve Nagar']}`)).amount).toBe(600);
    expect((await q(`service=drop&dropStopId=${stop.Warje}`)).amount).toBe(900);
    expect(
      await q(`service=both&pickStopId=${stop['Karve Nagar']}&dropStopId=${stop['Baner Road']}`),
    ).toMatchObject({ amount: 1500, slab: 'Slab S2' });
    const options = (
      await get(`/transport/requests/mine/options?studentId=${studentId}`, parent)
    ).json();
    months = options.months;
    expect(months).toHaveLength(12);
    expect(options.routes[0].stops[0]).toMatchObject({
      name: 'Karve Nagar',
      slab: 'Slab S1',
      amount: 1000,
    });
    expect(options.riding).toBe(false);
  });

  let joinId: string;
  it('a family asks; the transport in-charge and then the fee department approve; the fees follow', async () => {
    const leave = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'leave',
      fromMonth: months[3],
    });
    expect(leave.statusCode).toBe(409);
    const bad = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      fromMonth: months[1],
    });
    expect(bad.statusCode).toBe(400);
    const join = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      service: 'both',
      pickRouteId: route.R1,
      pickStopId: stop['Karve Nagar'],
      fromMonth: months[1],
      note: 'From next month',
    });
    expect(join.statusCode).toBe(201);
    joinId = join.json().id;
    expect(join.json()).toMatchObject({
      status: 'pending',
      source: 'parent',
      monthlyAmount: 1000,
      fromMonth: months[1],
      toMonth: months[11],
      dropStop: 'Karve Nagar',
      levels: 2,
      waitingOn: 'Transport in-charge',
    });
    expect(join.json().number).toMatch(/^TR-\d{4}-\d{4,}$/);
    const twice = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      service: 'pick',
      pickRouteId: route.R1,
      pickStopId: stop.Warje,
      fromMonth: months[1],
    });
    expect(twice.statusCode).toBe(409);
    // only the level that waits may act
    expect(
      (await post(`/transport/requests/${joinId}/decide`, accountant, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect((await get(`/transport/requests/${joinId}`, teacher)).statusCode).toBe(404);
    expect(
      (await post(`/transport/requests/${joinId}/decide`, incharge, { outcome: 'rejected' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await get('/transport/requests/inbox', incharge))
        .json()
        .data.map((r: { id: string }) => r.id),
    ).toEqual([joinId]);
    expect((await get('/transport/requests/inbox', accountant)).json().data).toHaveLength(0);
    const first = await post(`/transport/requests/${joinId}/decide`, incharge, {
      outcome: 'approved',
      note: 'Seat free',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      status: 'pending',
      waitingOn: 'Fee department',
      approvedLevels: 1,
    });
    expect(await transportFees()).toEqual({});
    const last = await post(`/transport/requests/${joinId}/decide`, accountant, {
      outcome: 'approved',
    });
    expect(last.statusCode).toBe(200);
    expect(last.json()).toMatchObject({ status: 'approved', canDecide: false });
    expect(last.json().feeNote).toMatch(/^Fees updated/);
    expect(last.json().periods).toHaveLength(1);
    const fees = await transportFees();
    expect(Object.keys(fees)).toEqual(months.slice(1));
    expect(new Set(Object.values(fees))).toEqual(new Set([1000]));
  });

  it('the transport office asks for a change: it goes to the fee department only', async () => {
    expect(
      (
        await post('/transport/requests', teacher, {
          studentId,
          kind: 'leave',
          fromMonth: months[3],
        })
      ).statusCode,
    ).toBe(403);
    const found = (await get(`/transport/requests/students?q=${s}-1`, incharge)).json().data;
    expect(found[0]).toMatchObject({ id: studentId, name: 'Aanya Rider' });
    // one of the coming months is already paid at the old amount
    await withMigrator((c) =>
      c.query(
        `UPDATE fee_demands d SET paid = d.net, status = 'paid' FROM fee_periods fp, fee_heads fh
          WHERE fp.id = d.period_id AND fh.id = d.head_id AND fh.kind = 'transport' AND d.student_id = $1
            AND to_char(make_date(fp.year, fp.month, 1), 'YYYY-MM') = $2`,
        [studentId, months[4]],
      ),
    );
    const change = await post('/transport/requests', incharge, {
      studentId,
      kind: 'change',
      service: 'pick',
      pickRouteId: route.R1,
      pickStopId: stop.Warje,
      fromMonth: months[3],
    });
    expect(change.statusCode).toBe(201);
    expect(change.json()).toMatchObject({
      source: 'office',
      monthlyAmount: 900,
      levels: 1,
      waitingOn: 'Fee department',
      dropStop: null,
    });
    const ok = await post(`/transport/requests/${change.json().id}/decide`, accountant, {
      outcome: 'approved',
    });
    expect(ok.json().status).toBe('approved');
    const periods = ok.json().periods as Array<{
      fromMonth: string;
      toMonth: string;
      status: string;
      monthlyAmount: number;
    }>;
    expect(periods.map((p) => [p.fromMonth, p.toMonth, p.status, p.monthlyAmount])).toEqual([
      [months[3], months[11], 'active', 900],
      [months[1], months[2], 'ended', 1000],
    ]);
    const fees = await transportFees();
    expect(fees[months[2]!]).toBe(1000);
    expect(fees[months[3]!]).toBe(900);
    // the paid month keeps what was paid, and the request says so
    expect(fees[months[4]!]).toBe(1000);
    expect(ok.json().feeNote).toMatch(/except .* already paid/);
    expect(Object.keys(fees)).toHaveLength(11);
  });

  it('a withdrawal from a month keeps the bus and the fee until the month before', async () => {
    const leave = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'leave',
      fromMonth: months[6],
      note: 'Moving house',
    });
    expect(leave.statusCode).toBe(201);
    expect(leave.json().what).toMatch(/^Stop the bus from/);
    await post(`/transport/requests/${leave.json().id}/decide`, incharge, { outcome: 'approved' });
    const done = await post(`/transport/requests/${leave.json().id}/decide`, accountant, {
      outcome: 'approved',
    });
    expect(done.json().status).toBe('approved');
    expect(Object.keys(await transportFees())).toEqual(months.slice(1, 6));
    const mine = (await get('/transport/requests/mine', parent)).json();
    const child = mine.children[0];
    expect(child.periods.map((p: { toMonth: string }) => p.toMonth)).toEqual([
      months[5],
      months[2],
    ]);
    expect(child.requests).toHaveLength(3);
    const options = (
      await get(`/transport/requests/mine/options?studentId=${studentId}`, parent)
    ).json();
    const inPeriod = options.thisMonth >= months[1]! && options.thisMonth <= months[5]!;
    // the bus mapping (and so the live tracking) runs exactly while a period covers this month
    const riders = (await get(`/transport/routes/${route.R1}/students`)).json().data as Array<{
      studentId: string;
    }>;
    expect(riders.some((r) => r.studentId === studentId)).toBe(inPeriod);
    expect(child.current !== null).toBe(inPeriod);
  });

  it('a rejection needs a reason and changes nothing; the family can cancel its own request', async () => {
    const again = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      service: 'both',
      pickRouteId: route.R2,
      pickStopId: stop['Baner Road'],
      fromMonth: months[8],
      toMonth: months[9],
    });
    expect(again.statusCode).toBe(201);
    const no = await post(`/transport/requests/${again.json().id}/decide`, incharge, {
      outcome: 'rejected',
      note: 'No seat on this route',
    });
    expect(no.json()).toMatchObject({ status: 'rejected', decisionNote: 'No seat on this route' });
    expect(Object.keys(await transportFees())).toEqual(months.slice(1, 6));
    const other = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      service: 'drop',
      dropRouteId: route.R2,
      dropStopId: stop['Baner Road'],
      fromMonth: months[8],
    });
    expect(other.statusCode).toBe(201);
    expect(other.json().monthlyAmount).toBe(900);
    const cancel = await post(`/transport/requests/mine/${other.json().id}/cancel`, parent);
    expect(cancel.statusCode).toBe(200);
    expect((await get(`/transport/requests/${other.json().id}`)).json().status).toBe('cancelled');
  });

  it('lists, the history, the Excel files and the dashboard', async () => {
    expect((await get('/transport/requests', teacher)).statusCode).toBe(403);
    const list = (await get('/transport/requests?tab=all', accountant)).json();
    expect(list.page.total).toBe(5);
    expect(list.counts).toMatchObject({ pending: 0, approved: 3, rejected: 1 });
    expect(
      (await get(`/transport/requests?tab=approved&kind=leave&q=${s}-1`)).json().data,
    ).toHaveLength(1);
    const xlsx = await get('/transport/requests/export.xlsx?tab=all');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const history = (
      await get(`/transport/desk/history?when=all&studentId=${studentId}`, incharge)
    ).json();
    expect(history.page.total).toBe(2);
    expect(history.data[0]).toMatchObject({
      admissionNo: `${s}-1`,
      serviceLabel: 'Pick only',
      pickStop: 'Warje',
      monthlyAmount: 900,
      source: 'office',
    });
    expect(history.data[0].approvedBy).toBeTruthy();
    expect(history.data[0].endedBy).toMatch(/^TR-/);
    expect((await get(`/transport/desk/history?month=${months[2]}`)).json().data).toHaveLength(1);
    expect((await get(`/transport/desk/history?month=${months[7]}`)).json().data).toHaveLength(0);
    expect((await get('/transport/desk/history/export.xlsx?when=all')).statusCode).toBe(200);
    const dash = await get('/transport/desk/dashboard', incharge);
    expect(dash.statusCode).toBe(200);
    expect(dash.json().kpis).toMatchObject({ routes: 2, pending: 0 });
    expect(dash.json().months).toHaveLength(6);
    expect(dash.json().days).toHaveLength(30);
  });
});
