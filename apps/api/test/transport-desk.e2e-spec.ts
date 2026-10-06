/**
 * Transport v2 (0077): the charge by the school's rule, a family's request through the transport
 * in-charge and the fee department, the office's request straight to the fee department, the periods
 * (history) they leave, the fees of exactly those months, a withdrawal from a month, and the reports.
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
  let sectionId: string;
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
    sectionId = sec.json().id;
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
      enrolment: { classSectionId: sectionId, rollNo: 1 },
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

  it('a route can have its own in-charge: its requests wait on that person', async () => {
    // the class teacher is an employee the school names in-charge of route R2
    const employeeId = await withMigrator(async (c) => {
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, mobile)
         VALUES ($1, 'TI1', 'Tara', 'Incharge', $2, '9876511111') RETURNING id::text`,
        [school.id, teacher.id],
      );
      return e.rows[0]!.id;
    });
    const setup = (await get('/transport/desk/setup')).json();
    expect(setup.levels[0]).toMatchObject({ label: 'Transport in-charge', kind: 'route_incharge' });
    const saved = await put('/transport/desk/setup', admin, {
      ...setup.settings,
      levels: setup.levels,
      incharges: [{ routeId: route.R2, employeeId }],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().incharges).toEqual([
      expect.objectContaining({ routeId: route.R2, name: 'Tara Incharge', login: true }),
    ]);
    const ask = await post('/transport/requests/mine', parent, {
      studentId,
      kind: 'join',
      service: 'both',
      pickRouteId: route.R2,
      pickStopId: stop['Baner Road'],
      fromMonth: months[8],
    });
    expect(ask.statusCode).toBe(201);
    // route R2 has its own in-charge: the role holder is not asked, the named person is
    expect((await get('/transport/requests/inbox', incharge)).json().data).toHaveLength(0);
    expect((await get('/transport/requests/inbox', teacher)).json().data).toHaveLength(1);
    expect(
      (await post(`/transport/requests/${ask.json().id}/decide`, incharge, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    const first = await post(`/transport/requests/${ask.json().id}/decide`, teacher, {
      outcome: 'approved',
    });
    expect(first.json()).toMatchObject({ status: 'pending', waitingOn: 'Fee department' });
    await post(`/transport/requests/${ask.json().id}/decide`, accountant, { outcome: 'approved' });
  });

  it('an office request whose level is the transport in-charge is approved automatically', async () => {
    const setup = (await get('/transport/desk/setup')).json();
    const body = (levels: unknown[]) => ({
      ...setup.settings,
      levels,
      incharges: setup.incharges.map((i: { routeId: string | null; employeeId: string }) => ({
        routeId: i.routeId,
        employeeId: i.employeeId,
      })),
    });
    const changed = await put(
      '/transport/desk/setup',
      admin,
      body(
        setup.levels.map((l: { source: string }) =>
          l.source === 'office'
            ? { ...l, kind: 'route_incharge', roleCode: null, designation: null, employeeId: null }
            : l,
        ),
      ),
    );
    expect(changed.statusCode).toBe(200);
    const made = await post('/transport/requests', incharge, {
      studentId,
      kind: 'change',
      service: 'both',
      pickRouteId: route.R1,
      pickStopId: stop.Warje,
      fromMonth: months[10],
    });
    expect(made.statusCode).toBe(201);
    // nobody is asked: the transport office made it, and the only level is the transport in-charge
    expect(made.json()).toMatchObject({ source: 'office', status: 'approved', waitingOn: null });
    expect(made.json().approvals[0]).toMatchObject({
      status: 'approved',
      note: 'Made by the transport office: approved automatically',
    });
    expect((await transportFees())[months[10]!]).toBe(made.json().monthlyAmount);
    expect((await put('/transport/desk/setup', admin, body(setup.levels))).statusCode).toBe(200);
  });

  it('many pupils from one Excel sheet become requests; the fee department approves them in one go', async () => {
    const extra: string[] = [];
    for (const n of [2, 3]) {
      const r = await post('/people/students', admin, {
        admissionNo: `${s}-${String(n)}`,
        firstName: `Pupil${String(n)}`,
        lastName: 'Rider',
        enrolment: { classSectionId: sectionId, rollNo: n },
      });
      expect(r.statusCode).toBe(201);
      extra.push(r.json().id);
    }
    expect((await get('/transport/requests/template.xlsx', teacher)).statusCode).toBe(403);
    const tpl = await get('/transport/requests/template.xlsx', incharge);
    expect(tpl.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getCell('C2').dataValidation?.type).toBe('list');
    const offered: string[] = [];
    wb.getWorksheet('Lists')!
      .getColumn(2)
      .eachCell((cell, n) => {
        if (n > 1 && cell.value) offered.push(String(cell.value));
      });
    expect(offered).toEqual(expect.arrayContaining(['R1 · Karve Nagar', 'R2 · Baner Road']));
    ws.getRow(2).values = [
      `${s}-2`,
      'Pick and drop',
      'R1 · Karve Nagar',
      null,
      months[2],
      null,
      'New',
    ];
    ws.getRow(3).values = [`${s}-3`, 'Drop only', null, 'R2 · Baner Road', months[2], months[6]];
    ws.getRow(4).values = ['NOBODY-9', 'Pick only', 'R1 · Karve Nagar', null, months[2]];
    ws.getRow(5).values = [`${s}-2`, 'Pick only', 'R1 · Warje', null, months[2]]; // already waiting
    const up = await post('/transport/requests/import', incharge, {
      fileName: 'start.xlsx',
      fileBase64: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64'),
    });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ created: 2, errors: [{ row: 4 }, { row: 5 }] });
    const inbox = (await get('/transport/requests/inbox', accountant)).json().data as Array<{
      id: string;
      source: string;
      monthlyAmount: number;
    }>;
    expect(inbox).toHaveLength(2);
    expect(inbox.map((r) => [r.source, r.monthlyAmount]).sort()).toEqual([
      ['office', 1000],
      ['office', 900],
    ]);
    const all = await post('/transport/requests/decide-many', accountant, {
      ids: [...inbox.map((r) => r.id), '999999999'],
      outcome: 'approved',
    });
    expect(all.json()).toMatchObject({ done: 2, failed: [{ id: '999999999' }] });
    expect((await get('/transport/requests/inbox', accountant)).json().data).toHaveLength(0);
    expect(
      (await get(`/transport/desk/history?when=all&studentId=${extra[0]!}`)).json().page.total,
    ).toBe(1);
  });

  it('papers that run out, and a replacement bus the parents can track', async () => {
    const save = (master: string, values: Record<string, unknown>) =>
      post(`/masters/${master}/rows`, admin, { values });
    const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const gone = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    for (const v of [
      {
        reg_no: 'MH12AA1111',
        name: 'Regular',
        capacity: 40,
        insurance_expiry: soon,
        puc_expiry: gone,
        gps_device_id: 'G1',
      },
      {
        reg_no: 'MH12BB2222',
        name: 'Spare',
        capacity: 40,
        insurance_expiry: '2031-01-01',
        gps_device_id: 'G2',
      },
    ])
      expect((await save('transport_vehicles', v)).statusCode).toBe(201);
    for (const d of [
      {
        code: 'D1',
        name: 'Ramesh Pawar',
        role: 'driver',
        mobile: '9876500001',
        licence_expiry: soon,
      },
      { code: 'D2', name: 'Sanjay More', role: 'driver', mobile: '9876500002' },
    ])
      expect((await save('transport_drivers', d)).statusCode).toBe(201);
    expect(
      (
        await save('transport_route_vehicles', {
          route_id: 'R1',
          vehicle_id: 'MH12AA1111',
          shift: 'both',
          driver_id: 'D1',
        })
      ).statusCode,
    ).toBe(201);
    // the papers page: what runs out in 30 days, what is over, what was never recorded
    const papers = (await get('/transport/desk/papers?state=soon', incharge)).json();
    expect(
      papers.data.map((p: { name: string; kind: string }) => `${p.name}:${p.kind}`).sort(),
    ).toEqual(['MH12AA1111:insurance', 'Ramesh Pawar:licence']);
    expect(papers.data[0].daysLeft).toBe(10);
    expect(papers.counts).toMatchObject({ expired: 1, soon: 2 });
    expect((await get('/transport/desk/papers?state=expired')).json().data[0]).toMatchObject({
      name: 'MH12AA1111',
      kind: 'puc',
      daysLeft: -5,
    });
    expect((await get('/transport/desk/papers/export.xlsx?state=all')).statusCode).toBe(200);

    // the child rides R1 (mapped directly here, so the test does not depend on today's month)
    const on = await put(`/transport/routes/${route.R1}/students`, admin, {
      assignments: [{ studentId, stopId: stop['Karve Nagar'] }],
    });
    expect(on.statusCode).toBe(200);
    const before = (await get('/transport/gps/mine', parent)).json().children[0];
    expect(before).toMatchObject({ vehicle: { regNo: 'MH12AA1111' }, replacement: null });

    const options = (await get('/transport/replacements/options', incharge)).json();
    const vehicle = (regNo: string) =>
      (options.vehicles as Array<{ id: string; regNo: string; routes: string }>).find(
        (v) => v.regNo === regNo,
      )!;
    expect(vehicle('MH12AA1111').routes).toBe('R1');
    const d2 = (options.crew as Array<{ id: string; name: string }>).find(
      (p) => p.name === 'Sanjay More',
    )!.id;
    const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    const till = new Date(Date.now() + 5.5 * 3600000 + 3 * 86400000).toISOString().slice(0, 10);
    expect((await post('/transport/replacements', accountant, {})).statusCode).toBe(403);
    const body = {
      vehicleId: vehicle('MH12AA1111').id,
      replacementVehicleId: vehicle('MH12BB2222').id,
      driverId: d2,
      fromDate: today,
      toDate: till,
      reason: 'Clutch repair',
    };
    expect(
      (
        await post('/transport/replacements', incharge, {
          ...body,
          replacementVehicleId: body.vehicleId,
        })
      ).statusCode,
    ).toBe(400);
    const rep = await post('/transport/replacements', incharge, body);
    expect(rep.statusCode).toBe(201);
    expect(rep.json()).toMatchObject({
      vehicle: 'MH12AA1111',
      replacement: 'MH12BB2222',
      routes: 'R1',
      phase: 'running',
      driver: 'Sanjay More',
    });
    expect(rep.json().number).toMatch(/^RB-\d{4}-\d{4,}$/);
    expect((await post('/transport/replacements', incharge, body)).statusCode).toBe(409);
    // for these days the parent's live bus is the replacement, and the portal says so
    const during = (await get('/transport/gps/mine', parent)).json().children[0];
    expect(during).toMatchObject({
      vehicle: { regNo: 'MH12BB2222' },
      replacement: {
        regular: 'MH12AA1111',
        until: till,
        driver: 'Sanjay More',
        driverMobile: '9876500002',
      },
    });
    expect((await get('/transport/replacements?tab=now', incharge)).json()).toMatchObject({
      counts: { now: 1 },
      data: [{ id: rep.json().id }],
    });
    // the regular bus is back early
    const end = await post(`/transport/replacements/${rep.json().id}/end`, incharge, {
      note: 'Repaired',
    });
    expect(end.statusCode).toBe(200);
    expect(end.json().backNotifiedAt).toBeTruthy();
    expect((await get('/transport/gps/mine', parent)).json().children[0]).toMatchObject({
      vehicle: { regNo: 'MH12AA1111' },
      replacement: null,
    });
    expect((await get('/transport/replacements?tab=now')).json().data).toHaveLength(0);
  });
});
