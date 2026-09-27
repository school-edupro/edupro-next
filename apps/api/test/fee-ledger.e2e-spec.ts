/**
 * Sprint 12: fee ledger foundation (late fee rule, overrides, visibility, receipt numbers and sequences,
 * regeneration diff, receipt PDF), transport fleet (vehicles, drivers, stops) and insights marts v1 with
 * the principal dashboard.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DEFAULT_PURPOSES } from '../src/modules/comms/consents.service';
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

interface Instalment {
  dueOn: string;
  net: string;
  paid: string;
  balance: string;
  visible: boolean;
  visibleFrom: string;
  status: string;
  lateFee: { amount: string; mode: string; days: number; overridden: boolean; periodId: string };
}
interface Ledger {
  instalments: Instalment[];
  totals: { net: string; paid: string; balance: string; lateFee: string; payable: string };
  payments: Array<{ id: string; receiptNo: string | null; amount: string; unallocated: string }>;
  overrides: Array<{ id: string }>;
  lastRun: {
    diff: { added: unknown[]; removed: unknown[]; changed: unknown[]; kept: number } | null;
  };
}

describe('fee ledger, fleet and insights (e2e, Sprint 12)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let classId: string;
  let sectionId: string;
  const heads: Record<string, string> = {};
  const periods: Array<{ id: string; sequence: number; dueOn: string }> = [];
  const students = {} as Record<'ontime' | 'late' | 'partial' | 'regen' | 'slab', string>;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledgerOf = async (id: string, asOf: string) =>
    (
      await inject({ method: 'GET', url: `/fees/students/${id}/ledger?asOf=${asOf}`, headers: h() })
    ).json() as Ledger;
  const setSetting = async (key: string, value: unknown) => {
    const r = await inject({
      method: 'PUT',
      url: `/platform/settings/${key}`,
      headers: h(),
      json: { value },
    });
    expect([200, 201]).toContain(r.statusCode);
  };

  beforeAll(async () => {
    const s = stamp('F12');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    for (const [code, name, kind, i] of [
      ['TUI', 'Tuition fee', 'regular', 1],
      ['DEV', 'Development fee', 'regular', 2],
      ['TRN', 'Transport fee', 'transport', 3],
      ['OPB', 'Opening balance', 'opening_balance', 4],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name, kind, sortOrder: i },
      });
      expect(r.statusCode).toBe(201);
      heads[code] = r.json().id;
    }
    const p = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    for (const x of p.json().data as Array<{ id: string; sequence: number; dueOn: string }>)
      periods.push({ id: x.id, sequence: x.sequence, dueOn: x.dueOn });
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: heads.TUI, amount: 2000, frequency: 'monthly' },
          { headId: heads.DEV, amount: 1200, frequency: 'quarterly' },
        ],
      },
    });
    expect(st.statusCode).toBe(200);
    await setSetting('fees.late_fee_mode', 'daywise');
    await setSetting('fees.late_fee_per_day', '10.00');
    let roll = 1;
    for (const id of ['ontime', 'late', 'partial', 'regen', 'slab'] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `F12-${id}`,
          firstName: id,
          lastName: 'Ledger',
          dob: '2015-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      students[id] = r.json().id;
      roll += 1;
      const g = await inject({
        method: 'POST',
        url: `/fees/students/${students[id]}/demands/generate`,
        headers: h(),
      });
      expect(g.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('numbers receipts from the row-locked sequence; the sequence is editable only before the first receipt', async () => {
    const seqBefore = (
      await inject({ method: 'GET', url: '/fees/receipt-sequences', headers: h() })
    ).json().data as Array<{
      ledger: string;
      configured: boolean;
      prefix: string;
      issued: number;
      financialYearId: string;
    }>;
    const schoolSeq = seqBefore.find((x) => x.ledger === 'school')!;
    expect(schoolSeq).toMatchObject({ configured: false, issued: 0, prefix: 'TF/FY2026-27/' });
    // hostel: custom prefix before any receipt
    const set = await inject({
      method: 'PUT',
      url: '/fees/receipt-sequences',
      headers: h(),
      json: {
        ledger: 'hostel',
        financialYearId: schoolSeq.financialYearId,
        prefix: 'HST-',
        width: 4,
        startAt: 100,
      },
    });
    expect(set.statusCode).toBe(200);
    // two counter payments (accountant) in the same year get consecutive school receipt numbers
    const p1 = await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: h(accountant),
      json: { studentId: students.ontime, amount: 7200, mode: 'cash', receivedOn: '2026-04-05' },
    });
    expect(p1.statusCode).toBe(201);
    expect(p1.json().receiptNo).toBe('TF/FY2026-27/000001');
    const p2 = await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: h(accountant),
      json: {
        studentId: students.late,
        amount: 7200,
        mode: 'upi',
        reference: 'UPI-1',
        receivedOn: '2026-05-10',
      },
    });
    expect(p2.json().receiptNo).toBe('TF/FY2026-27/000002');
    const seqAfter = (
      await inject({ method: 'GET', url: '/fees/receipt-sequences', headers: h() })
    ).json().data as Array<{
      ledger: string;
      configured: boolean;
      prefix: string;
      issued: number;
      nextNo: number;
    }>;
    expect(seqAfter.find((x) => x.ledger === 'school')).toMatchObject({
      configured: true,
      issued: 2,
      nextNo: 3,
    });
    expect(seqAfter.find((x) => x.ledger === 'hostel')).toMatchObject({
      prefix: 'HST-',
      width: 4,
      nextNo: 100,
    });
    const locked = await inject({
      method: 'PUT',
      url: '/fees/receipt-sequences',
      headers: h(),
      json: {
        ledger: 'school',
        financialYearId: schoolSeq.financialYearId,
        prefix: 'X/',
        width: 6,
        startAt: 1,
      },
    });
    expect(locked.statusCode).toBe(409);
    // a date outside every financial year is refused at the counter
    const outside = await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: h(accountant),
      json: { studentId: students.ontime, amount: 10, mode: 'cash', receivedOn: '2031-01-01' },
    });
    expect(outside.statusCode).toBe(409);
    expect(outside.json().type).toBe('fees.no_financial_year');
  });

  it('groups the demand by due date and applies the day-wise late fee, on-time settlement and overrides', async () => {
    // quarterly demand: 3 x 2000 + 1200 = 7200 per instalment, due 10 Apr / 10 Jul / 10 Oct / 10 Jan
    const asOf = '2026-10-15';
    const ontime = await ledgerOf(students.ontime, asOf);
    expect(ontime.instalments.map((x) => x.dueOn)).toEqual([
      '2026-04-10',
      '2026-07-10',
      '2026-10-10',
      '2027-01-10',
    ]);
    expect(ontime.instalments[0]).toMatchObject({
      net: '7200.00',
      paid: '7200.00',
      balance: '0.00',
      status: 'paid',
    });
    expect(ontime.instalments[0]!.lateFee).toMatchObject({ amount: '0.00', mode: 'none' });
    // July: 97 days overdue at 10 per day; October: 5 days; January: not yet due
    expect(ontime.instalments[1]!.lateFee).toMatchObject({
      amount: '970.00',
      mode: 'daywise',
      days: 97,
    });
    expect(ontime.instalments[2]!.lateFee).toMatchObject({ amount: '50.00', days: 5 });
    expect(ontime.instalments[3]).toMatchObject({ status: 'upcoming', visible: false });
    expect(ontime.instalments[3]!.lateFee.amount).toBe('0.00');
    expect(ontime.totals).toMatchObject({
      net: '28800.00',
      paid: '7200.00',
      balance: '21600.00',
      lateFee: '1020.00',
      payable: '22620.00',
    });
    expect(ontime.payments[0]).toMatchObject({
      receiptNo: 'TF/FY2026-27/000001',
      unallocated: '0.00',
    });

    // paid 30 days late: the late fee stops at the settlement date
    const late = await ledgerOf(students.late, asOf);
    expect(late.instalments[0]).toMatchObject({ status: 'paid' });
    expect(late.instalments[0]!.lateFee).toMatchObject({
      amount: '300.00',
      days: 30,
      mode: 'daywise',
    });

    // partial before the due date: the balance keeps accruing until as-of
    await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: h(accountant),
      json: { studentId: students.partial, amount: 1000, mode: 'cash', receivedOn: '2026-04-01' },
    });
    const partial = await ledgerOf(students.partial, asOf);
    expect(partial.instalments[0]).toMatchObject({
      paid: '1000.00',
      balance: '6200.00',
      status: 'overdue',
    });
    expect(partial.instalments[0]!.lateFee).toMatchObject({ days: 188, amount: '1880.00' });

    // override: waive July for the on-time student, then revoke
    const julyPeriod = ontime.instalments[1]!.lateFee.periodId;
    const forbidden = await inject({
      method: 'PUT',
      url: `/fees/students/${students.ontime}/late-fee`,
      headers: h(teacher),
      json: { periodId: julyPeriod, amount: 0, reason: 'nope' },
    });
    expect(forbidden.statusCode).toBe(403);
    const waive = await inject({
      method: 'PUT',
      url: `/fees/students/${students.ontime}/late-fee`,
      headers: h(accountant),
      json: { periodId: julyPeriod, amount: 0, reason: 'Hospitalised in July; principal approved' },
    });
    expect(waive.statusCode).toBe(200);
    const waived = await ledgerOf(students.ontime, asOf);
    expect(waived.instalments[1]!.lateFee).toMatchObject({
      amount: '0.00',
      mode: 'override',
      overridden: true,
    });
    expect(waived.totals.lateFee).toBe('50.00');
    expect(waived.overrides).toHaveLength(1);
    const fixed = await inject({
      method: 'PUT',
      url: `/fees/students/${students.ontime}/late-fee`,
      headers: h(accountant),
      json: { periodId: julyPeriod, amount: 250, reason: 'Flat late fee agreed' },
    });
    expect(fixed.json().replaced).toBe(waived.overrides[0]!.id);
    expect((await ledgerOf(students.ontime, asOf)).instalments[1]!.lateFee.amount).toBe('250.00');
    const revoke = await inject({
      method: 'DELETE',
      url: `/fees/students/${students.ontime}/late-fee/${fixed.json().id}`,
      headers: h(accountant),
    });
    expect(revoke.statusCode).toBe(200);
    expect((await ledgerOf(students.ontime, asOf)).instalments[1]!.lateFee).toMatchObject({
      amount: '970.00',
      overridden: false,
    });
    // the ledger needs its own permission
    const denied = await inject({
      method: 'GET',
      url: `/fees/students/${students.ontime}/ledger`,
      headers: h(teacher),
    });
    expect(denied.statusCode).toBe(403);
  });

  it('slab mode reads the anchor period slabs; visibility follows the period or the school setting', async () => {
    const anchor = periods.find((p) => p.sequence === 4)!; // July
    const set = await inject({
      method: 'PUT',
      url: `/fees/periods/${anchor.id}/late-fee`,
      headers: h(),
      json: {
        lateFeeAmount: 100,
        slabs: [
          { on: '2026-07-25', amount: 250 },
          { on: '2026-08-24', amount: 500 },
        ],
        visibleFrom: '2026-06-01',
      },
    });
    expect(set.statusCode).toBe(200);
    const listed = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json()
      .data as Array<{
      sequence: number;
      slabs: Array<{ on: string; amount: string }>;
      visibleFrom: string | null;
      lateFeeAmount: string;
    }>;
    expect(listed.find((p) => p.sequence === 4)).toMatchObject({
      lateFeeAmount: '100.00',
      visibleFrom: '2026-06-01',
      slabs: [
        { on: '2026-07-25', amount: '250.00' },
        { on: '2026-08-24', amount: '500.00' },
      ],
    });
    await setSetting('fees.late_fee_mode', 'slab');
    const l1 = await ledgerOf(students.slab, '2026-07-20');
    expect(l1.instalments[1]!.lateFee).toMatchObject({ mode: 'slab', amount: '100.00' });
    const l2 = await ledgerOf(students.slab, '2026-08-01');
    expect(l2.instalments[1]!.lateFee.amount).toBe('250.00');
    const l3 = await ledgerOf(students.slab, '2026-10-15');
    expect(l3.instalments[1]!.lateFee.amount).toBe('500.00');
    // visibility: July shows from 1 June (period), October from 10 September (30 days before, the setting default)
    const june = await ledgerOf(students.slab, '2026-06-02');
    expect(june.instalments[1]).toMatchObject({
      visibleFrom: '2026-06-01',
      visible: true,
      status: 'due',
    });
    expect(june.instalments[2]).toMatchObject({
      visibleFrom: '2026-09-10',
      visible: false,
      status: 'upcoming',
    });
    await setSetting('fees.instalment_visible_days_before', 60);
    expect((await ledgerOf(students.slab, '2026-08-15')).instalments[2]).toMatchObject({
      visibleFrom: '2026-08-11',
      visible: true,
    });
    await setSetting('fees.late_fee_mode', 'daywise');
  });

  it('regeneration returns a diff and keeps paid rows', async () => {
    await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: h(accountant),
      json: { studentId: students.regen, amount: 2000, mode: 'cash', receivedOn: '2026-04-05' },
    });
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [{ headId: heads.TUI, amount: 2500, frequency: 'monthly' }],
      }, // DEV dropped, TUI raised
    });
    expect(st.statusCode).toBe(200);
    const r = await inject({
      method: 'POST',
      url: `/fees/students/${students.regen}/demands/regenerate`,
      headers: h(),
    });
    expect(r.statusCode).toBe(201);
    const diff = r.json().diff as {
      added: unknown[];
      removed: unknown[];
      changed: Array<{ head: string; before: { net: string }; after: { net: string } }>;
      kept: number;
      totalBefore: string;
      totalAfter: string;
    };
    expect(diff.removed).toHaveLength(4); // the four quarterly DEV rows
    expect(diff.changed).toHaveLength(11); // eleven unpaid TUI rows 2000 → 2500
    expect(diff.kept).toBe(1); // the paid April tuition row keeps its amount
    expect(diff.changed[0]).toMatchObject({
      head: 'TUI',
      before: { net: '2000.00' },
      after: { net: '2500.00' },
    });
    expect(diff.totalBefore).toBe('28800.00');
    expect(diff.totalAfter).toBe('29500.00');
    const ledger = await ledgerOf(students.regen, '2026-10-15');
    expect(ledger.lastRun!.diff!.changed).toHaveLength(11);
    expect(ledger.totals.net).toBe('29500.00');
    // restore the structure for the other tests
    await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: heads.TUI, amount: 2000, frequency: 'monthly' },
          { headId: heads.DEV, amount: 1200, frequency: 'quarterly' },
        ],
      },
    });
  });

  it('queues the receipt PDF from the default fee receipt template', async () => {
    const ledger = await ledgerOf(students.ontime, '2026-10-15');
    const paymentId = ledger.payments[0]!.id;
    const none = await inject({
      method: 'POST',
      url: `/fees/payments/${paymentId}/receipt`,
      headers: h(accountant),
    });
    expect(none.statusCode).toBe(409);
    const installed = await inject({
      method: 'POST',
      url: '/platform/templates/defaults',
      headers: h(),
    });
    expect([200, 201]).toContain(installed.statusCode);
    expect(
      (installed.json().data as Array<{ kind: string }>).some((t) => t.kind === 'fee_receipt'),
    ).toBe(true);
    const queued = await inject({
      method: 'POST',
      url: `/fees/payments/${paymentId}/receipt`,
      headers: h(accountant),
    });
    expect(queued.statusCode).toBe(201);
    expect(queued.json()).toMatchObject({ receiptNo: 'TF/FY2026-27/000001' });
    const exp = await inject({
      method: 'GET',
      url: `/reports/exports/${queued.json().exportId}`,
      headers: h(accountant),
    });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().export).toMatchObject({ dataset: 'document', format: 'pdf' });
  });

  it('fleet: vehicles, drivers, ordered stops with geo and stop-aware assignments', async () => {
    const v = await inject({
      method: 'POST',
      url: '/transport/vehicles',
      headers: h(),
      json: {
        regNo: 'MH12 AB 1234',
        make: 'Tata Starbus',
        capacity: 42,
        insuranceExpiry: '2027-03-31',
        fitnessExpiry: '2026-11-30',
      },
    });
    expect(v.statusCode).toBe(201);
    expect(v.json()).toMatchObject({ regNo: 'MH12AB1234', nextExpiry: '2026-11-30', routes: [] });
    const dup = await inject({
      method: 'POST',
      url: '/transport/vehicles',
      headers: h(),
      json: { regNo: 'mh12ab1234' },
    });
    expect(dup.statusCode).toBe(409);
    const d = await inject({
      method: 'POST',
      url: '/transport/drivers',
      headers: h(),
      json: {
        name: 'Ramesh Pawar',
        mobile: '9876500011',
        licenceNo: 'MH1220200012345',
        licenceExpiry: '2028-01-31',
      },
    });
    expect(d.statusCode).toBe(201);
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: 'R1', name: 'Kothrud' },
    });
    expect(route.statusCode).toBe(201);
    const routeId = route.json().id;
    const linked = await inject({
      method: 'PATCH',
      url: `/transport/routes/${routeId}`,
      headers: h(),
      json: {
        vehicleId: v.json().id,
        driverId: d.json().id,
        conductorName: 'Suresh',
        conductorMobile: '9876500022',
      },
    });
    expect(linked.json()).toMatchObject({
      vehicleRegNo: 'MH12AB1234',
      vehicleNo: 'MH12AB1234',
      driverName: 'Ramesh Pawar',
      driverMobile: '9876500011',
      conductorName: 'Suresh',
    });
    const stops = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/stops`,
      headers: h(),
      json: {
        stops: [
          {
            name: 'Karve Nagar chowk',
            lat: 18.4894,
            lng: 73.8163,
            pickupTime: '07:10',
            dropTime: '14:05',
          },
          {
            name: 'Kothrud depot',
            lat: 18.5074,
            lng: 73.8077,
            pickupTime: '07:18',
            dropTime: '14:12',
          },
        ],
      },
    });
    expect(stops.statusCode).toBe(200);
    const list = stops.json().data as Array<{
      id: string;
      sequence: number;
      name: string;
      lat: string;
      pickupTime: string;
    }>;
    expect(list.map((s) => [s.sequence, s.name])).toEqual([
      [1, 'Karve Nagar chowk'],
      [2, 'Kothrud depot'],
    ]);
    expect(list[0]).toMatchObject({ lat: '18.489400', pickupTime: '07:10' });
    // assign with a stop: the stop's name and times fill the assignment
    const assign = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/students`,
      headers: h(),
      json: { assignments: [{ studentId: students.ontime, stopId: list[1]!.id }] },
    });
    expect(assign.statusCode).toBe(200);
    expect(assign.json().data[0]).toMatchObject({
      stopId: list[1]!.id,
      stopName: 'Kothrud depot',
      pickupTime: '07:18',
      dropTime: '14:12',
    });
    // reorder keeps ids and riders; a dropped stop clears its riders' stop
    const reordered = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/stops`,
      headers: h(),
      json: {
        stops: [
          { id: list[1]!.id, name: 'Kothrud depot', pickupTime: '07:05' },
          { name: 'Paud phata' },
        ],
      },
    });
    const after = reordered.json().data as Array<{
      id: string;
      sequence: number;
      name: string;
      students: number;
    }>;
    expect(after.map((s) => [s.sequence, s.name, s.students])).toEqual([
      [1, 'Kothrud depot', 1],
      [2, 'Paud phata', 0],
    ]);
    expect(after[0]!.id).toBe(list[1]!.id);
    const foreign = await inject({
      method: 'PUT',
      url: `/transport/routes/${routeId}/students`,
      headers: h(),
      json: { assignments: [{ studentId: students.late, stopId: list[0]!.id }] },
    });
    expect(foreign.statusCode).toBe(404);
    const routes = (await inject({ method: 'GET', url: '/transport/routes', headers: h() })).json()
      .data as Array<{ code: string; stops: number; students: number }>;
    expect(routes.find((r) => r.code === 'R1')).toMatchObject({ stops: 2, students: 1 });
    const vehicles = (
      await inject({ method: 'GET', url: '/transport/vehicles', headers: h() })
    ).json().data as Array<{ routes: string[] }>;
    expect(vehicles[0]!.routes).toEqual(['R1']);
    const noAccess = await inject({
      method: 'GET',
      url: '/transport/drivers',
      headers: h(teacher),
    });
    expect(noAccess.statusCode).toBe(403);
  });

  it('insights: the marts refresh and the principal dashboard agrees with the ledger to the rupee', async () => {
    const forbidden = await inject({
      method: 'GET',
      url: '/insights/principal',
      headers: h(teacher),
    });
    expect(forbidden.statusCode).toBe(403);
    const refresh = await inject({ method: 'POST', url: '/insights/marts/refresh', headers: h() });
    expect(refresh.statusCode).toBe(201);
    const marts = refresh.json().data as Array<{ mart: string; rows: number }>;
    expect(marts.map((m) => m.mart).sort()).toEqual([
      'admissions_funnel',
      'attendance_daily',
      'comms_delivery_daily',
      'fee_collection_daily',
      'fee_dues',
    ]);
    expect(marts.find((m) => m.mart === 'fee_dues')!.rows).toBe(20); // 5 students x 4 due dates
    const dash = await inject({
      method: 'GET',
      url: '/insights/principal?date=2026-10-15',
      headers: h(),
    });
    expect(dash.statusCode).toBe(200);
    const d = dash.json();
    // due till 15 Oct: three instalments per student; the regen student's rows changed to 2500 x 3 = 7500 per instalment
    const ledgers = await Promise.all(
      Object.values(students).map((id) => ledgerOf(id, '2026-10-15')),
    );
    const dueTillDate = ledgers.reduce(
      (s, l) =>
        s +
        l.instalments.filter((x) => x.dueOn <= '2026-10-15').reduce((a, x) => a + Number(x.net), 0),
      0,
    );
    const collected = ledgers.reduce(
      (s, l) =>
        s +
        l.instalments
          .filter((x) => x.dueOn <= '2026-10-15')
          .reduce((a, x) => a + Number(x.paid), 0),
      0,
    );
    expect(d.fees.dueTillDate).toBe(dueTillDate.toFixed(2));
    expect(d.fees.collectedTillDate).toBe(collected.toFixed(2));
    expect(d.fees.balance).toBe((dueTillDate - collected).toFixed(2));
    expect(d.fees.byMode30d).toEqual([]); // every receipt is older than 30 days before 15 Oct
    expect(d.fees.defaulters.length).toBeGreaterThan(0);
    expect(d.fees.ageing.map((a: { bucket: string }) => a.bucket)).toEqual([
      'current',
      '1-30',
      '31-60',
      '61-90',
      '90+',
    ]);
    // attendance rows exist for working days and today only, so ask for today
    const today = (
      await inject({ method: 'GET', url: '/insights/principal', headers: h() })
    ).json();
    expect(today.attendance.sections).toBe(1); // the section exists, unmarked
    expect(today.attendance.unmarked).toEqual(['VI-A']);
    expect(d.alerts.some((a: { code: string }) => a.code === 'fees.overdue_90')).toBe(true);
    expect(d.marts.every((m: { stale: boolean }) => !m.stale)).toBe(true);
    const status = await inject({ method: 'GET', url: '/insights/marts', headers: h() });
    expect(status.json().data).toHaveLength(5);
  });

  it('adds the AI assistant consent purpose to the catalogue', () => {
    expect(DEFAULT_PURPOSES.map((p) => p.code)).toContain('ai.assistant');
  });
});
