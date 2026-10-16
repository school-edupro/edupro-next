/**
 * Hostel withdrawal (0153, docs/design/27-hostel-withdrawal.md): a pupil leaves the hostel and stays in
 * school through the hostel's steps (warden with a damage charge, mess, automatic hostel fee check,
 * Accounts choosing carry-forward or refund); completion vacates the bed, keeps one more month on a short
 * notice and settles the paid months after; a warden works only for their hostel; a hosteller's school
 * withdrawal gets the hostel steps and gives up the bed.
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

interface Clearance {
  department: string;
  step: number;
  status: string;
  canAct?: boolean;
  charge: string;
  chargeMiscFeeId: string | null;
  settles: boolean;
  check: { due: number } | null;
}
interface HW {
  id: string;
  status: string;
  currentStep: number | null;
  noticeShort: boolean;
  feeChoice: string;
  feeUntil: string | null;
  feeNote: string | null;
  canComplete?: boolean;
  clearances: Clearance[];
}
interface Instalment {
  ledger: string;
  net: string;
  paid: string;
  balance: string;
  dueOn: string;
}

describe('hostel withdrawal (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let warden: SeededUser;
  let accountant: SeededUser;
  let clerk: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = async <T>(url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json() as T;
  const ledger = (id: string) =>
    get<{ fee: { hosteller: boolean; hostelTo: string | null }; instalments: Instalment[] }>(
      `/fees/students/${id}/ledger`,
    );
  const clear = (id: string, dep: string, body: Record<string, unknown>, u: SeededUser = admin) =>
    post(`/hostel/withdrawals/${id}/clearances/${dep}`, { status: 'cleared', ...body }, u);

  beforeAll(async () => {
    const s = stamp('HWD');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      clerk = await seedUser(c, school, `${s}-clerk`, 'clerk');
    });
    app = await createApp();
    inject = injector(app);
    const tui = await post('/fees/heads', { code: 'TUI', name: 'Tuition', sortOrder: 1 });
    const hos = await post('/fees/heads', {
      code: 'HOS',
      name: 'Boarding',
      ledger: 'hostel',
      sortOrder: 2,
    });
    await post('/fees/periods/generate', { dueDay: 10, monthsPerInstalment: 1 });
    const cls = await post('/academics/classes', { code: 'IX', name: 'Class IX', displayOrder: 9 });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' });
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id as string}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: tui.json().id, amount: 1000, frequency: 'monthly' },
          { headId: hos.json().id, amount: 3000, frequency: 'monthly' },
        ],
      },
    });
    expect(st.statusCode).toBe(200);
    let roll = 1;
    for (const [key, gender] of [
      ['carry', 'male'],
      ['refund', 'male'],
      ['leaver', 'female'],
      ['dayscholar', 'male'],
    ] as const) {
      const r = await post('/people/students', {
        admissionNo: `HWD-${key}`,
        firstName: key,
        lastName: 'Pupil',
        gender,
        dob: '2011-01-01',
        admittedOn: '2019-04-05',
        enrolment: { classSectionId: sec.json().id, rollNo: roll++ },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id as string;
      await post(`/fees/students/${ids[key]}/demands/generate`, {});
    }
    const emp = await post('/people/employees', {
      employeeCode: 'HW01',
      firstName: 'Ravi',
      lastName: 'Warden',
      employeeType: 'non_teaching',
      designation: 'Warden',
      mobile: '9000000101',
      posting: {},
    });
    expect(emp.statusCode).toBe(201);
    await withMigrator((c) =>
      c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [warden.id, emp.json().id]),
    );
    const boys = await post('/hostel/hostels', { name: 'Boys Hostel', code: 'BH', gender: 'boys' });
    const girls = await post('/hostel/hostels', {
      name: 'Girls Hostel',
      code: 'GH',
      gender: 'girls',
    });
    ids.boys = boys.json().id as string;
    ids.girls = girls.json().id as string;
    const type = await post('/hostel/room-types', { name: 'Triple', seater: 3 });
    await post('/hostel/rooms', { hostelId: ids.boys, roomNo: '101', roomTypeId: type.json().id });
    await post('/hostel/rooms', { hostelId: ids.girls, roomNo: 'G1', roomTypeId: type.json().id });
    await inject({
      method: 'PUT',
      url: `/hostel/hostels/${ids.boys}/wardens`,
      headers: h(),
      json: { wardens: [{ employeeId: emp.json().id, isHead: true }] },
    });
    const rooms = (
      await get<{ data: Array<{ roomNo: string; beds: Array<{ id: string; label: string }> }> }>(
        '/hostel/rooms',
      )
    ).data;
    const bed = (room: string, label: string) =>
      rooms.find((r) => r.roomNo === room)!.beds.find((b) => b.label === label)!.id;
    for (const [key, b] of [
      ['carry', bed('101', 'A')],
      ['refund', bed('101', 'B')],
      ['leaver', bed('G1', 'A')],
    ] as const) {
      const a = await post('/hostel/allotments', {
        studentId: ids[key],
        bedId: b,
        fromDate: '2026-06-15',
      });
      expect(a.statusCode).toBe(201);
    }
    // carry and refund have paid the hostel fee June to December (7 x 3000)
    for (const key of ['carry', 'refund'])
      expect(
        (
          await post(
            '/payments/receipts',
            {
              studentId: ids[key],
              amount: 21000,
              mode: 'cash',
              receivedOn: '2026-06-20',
              ledger: 'hostel',
            },
            accountant,
          )
        ).statusCode,
      ).toBe(201);
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

  it('has its own steps and notice settings, kept apart from the school withdrawal', async () => {
    const s = await get<{
      departments: Array<{
        code: string;
        step: number;
        chargeKind: string | null;
        inSchoolExit: boolean;
        autoCheck: string;
      }>;
      noticeDays: number;
      noticeCharge: boolean;
    }>('/hostel/withdrawal-settings');
    expect(s.noticeDays).toBe(30);
    expect(s.noticeCharge).toBe(true);
    expect(s.departments.map((d) => `${String(d.step)}:${d.code}`)).toEqual([
      '1:hostel_warden',
      '1:hostel_mess',
      '1:hostel_fees',
      '2:hostel_accounts',
    ]);
    expect(s.departments.find((d) => d.code === 'hostel_warden')).toMatchObject({
      chargeKind: 'damage',
      inSchoolExit: true,
    });
    const school = await get<{ departments: Array<{ code: string }> }>(
      '/people/withdrawal-departments',
    );
    expect(school.departments.map((d) => d.code)).not.toContain('hostel_warden');
    // a hostel step cannot use the school's fee check
    const bad = await inject({
      method: 'PUT',
      url: '/hostel/withdrawal-settings/departments',
      headers: h(),
      json: {
        departments: [
          {
            code: 'x_fees',
            name: 'Fees',
            step: 1,
            approvers: [{ kind: 'office' }],
            autoCheck: 'fees',
          },
        ],
      },
    });
    expect(bad.statusCode).toBe(400);
    expect((await get<{ status?: number }>('/hostel/withdrawal-settings', warden)).status).toBe(
      403,
    );
    expect((await get<{ status?: number }>('/hostel/withdrawals', clerk)).status).toBe(403);
  });

  it('starts only for a pupil holding a bed, once, and a warden only in their hostel', async () => {
    const none = await post(`/hostel/students/${ids.dayscholar}/withdrawal`, {
      leavingOn: '2026-10-31',
      reason: 'parent_request',
    });
    expect(none.statusCode).toBe(409);
    expect(none.json().type).toContain('hostel.not_allotted');
    // the warden of the boys hostel cannot start one for a girl
    const other = await post(
      `/hostel/students/${ids.leaver}/withdrawal`,
      { leavingOn: '2026-10-31', reason: 'parent_request' },
      warden,
    );
    expect(other.statusCode).toBe(403);
    expect(
      (
        await post(
          `/hostel/students/${ids.carry}/withdrawal`,
          { leavingOn: '2026-10-31', reason: 'parent_request' },
          accountant,
        )
      ).statusCode,
    ).toBe(403);
    // asked today for the end of the month: short notice (fewer than 30 days)
    const w = await post(
      `/hostel/students/${ids.carry}/withdrawal`,
      {
        requestedOn: '2026-10-16',
        leavingOn: '2026-10-31',
        reason: 'parent_request',
        remarks: 'Moving near school',
      },
      warden,
    );
    expect(w.statusCode).toBe(201);
    const row = w.json() as HW;
    ids.hwCarry = row.id;
    expect(row).toMatchObject({
      status: 'requested',
      currentStep: 1,
      noticeShort: true,
      feeChoice: 'carry',
    });
    // hostel fee is paid to the leaving date: the automatic check cleared it
    expect(row.clearances.find((x) => x.department === 'hostel_fees')).toMatchObject({
      status: 'cleared',
      check: { due: 0 },
    });
    const again = await post(`/hostel/students/${ids.carry}/withdrawal`, {
      leavingOn: '2026-11-30',
      reason: 'other',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().type).toContain('withdrawal.open_exists');
  });

  it('clears in steps: the warden raises damages as a misc fee; Accounts acts at step 2 only', async () => {
    const id = ids.hwCarry!;
    // Accounts is step 2: not yet
    const early = await clear(id, 'hostel_accounts', {}, accountant);
    expect(early.statusCode).toBe(409);
    expect(early.json().type).toContain('withdrawal.not_this_step');
    // the warden cannot clear the mess (office only)
    expect((await clear(id, 'hostel_mess', {}, warden)).statusCode).toBe(403);
    // a department that raises no charge refuses one
    expect((await clear(id, 'hostel_fees', { charge: 100 })).statusCode).toBe(400);
    const wd = await clear(id, 'hostel_warden', { charge: 750, remarks: 'Broken chair' }, warden);
    expect(wd.statusCode).toBe(201);
    const x = (wd.json() as HW).clearances.find((c) => c.department === 'hostel_warden')!;
    expect(x).toMatchObject({ status: 'cleared', charge: '750.00' });
    expect(x.chargeMiscFeeId).toBeTruthy();
    const misc = await withMigrator((c) =>
      c.query<{ amount: string; title: string; status: string }>(
        `SELECT l.amount::text, f.title, f.status FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id
          WHERE l.student_id = $1`,
        [ids.carry],
      ),
    );
    expect(misc.rows).toEqual([
      expect.objectContaining({
        amount: '750.00',
        status: 'announced',
        title: expect.stringContaining('Hostel damages'),
      }),
    ]);
    // the mess is bypassed with a reason; step 1 is then done
    const by = await post(`/hostel/withdrawals/${id}/clearances/hostel_mess/bypass`, {
      reason: 'No mess dues on record',
    });
    expect((by.json() as HW).currentStep).toBe(2);
    // carry/refund is chosen only at the settlement step
    const wrong = await post(`/hostel/withdrawals/${id}/clearances/hostel_warden`, {
      status: 'cleared',
      feeChoice: 'refund',
    });
    expect([400, 409]).toContain(wrong.statusCode);
    expect((await post(`/hostel/withdrawals/${id}/complete`, {})).statusCode).toBe(409);
    const acc = await clear(id, 'hostel_accounts', { feeChoice: 'carry' }, accountant);
    expect(acc.json()).toMatchObject({ status: 'cleared', feeChoice: 'carry' });
  });

  it('completes: the bed is given up, one more month for the short notice, December carried forward', async () => {
    const done = await post(`/hostel/withdrawals/${ids.hwCarry!}/complete`, {}, warden);
    expect(done.statusCode).toBe(201);
    const w = done.json() as HW;
    expect(w).toMatchObject({ status: 'completed', feeUntil: '2026-11-01' });
    expect(w.feeNote).toContain('Nov 2026');
    expect(w.feeNote).toContain('Dec 2026');
    const stay = await withMigrator((c) =>
      c.query<{ to_date: string; end_reason: string }>(
        `SELECT to_date::text, end_reason FROM hostel_allotments WHERE student_id = $1`,
        [ids.carry],
      ),
    );
    expect(stay.rows[0]).toEqual({ to_date: '2026-10-31', end_reason: 'vacate' });
    const l = await ledger(ids.carry!);
    expect(l.fee.hostelTo).toBe('2026-11-01');
    const hostel = l.instalments.filter((i) => i.ledger === 'hostel' && Number(i.net) > 0);
    // June to November charged; December no longer
    expect(hostel.map((i) => i.dueOn.slice(0, 7))).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
    ]);
    // December's 3000 comes off the hostel bill; a hostel receipt pays hostel fee only, so with no
    // hostel fee left it stays as advance on the receipt (refundable from Fees -> Refunds)
    expect(w.feeNote).toContain('Rs. 3,000 kept as advance on the receipt');
    // the bed is free again
    const again = await post(`/hostel/students/${ids.carry}/withdrawal`, {
      leavingOn: '2026-12-31',
      reason: 'other',
    });
    expect(again.json().type).toContain('hostel.not_allotted');
  });

  it('a long notice and a refund: the fee stops with the leaving month, Nov–Dec sent for refund', async () => {
    const w = await post(`/hostel/students/${ids.refund}/withdrawal`, {
      requestedOn: '2026-09-01',
      leavingOn: '2026-10-31',
      reason: 'health',
    });
    const id = (w.json() as HW).id;
    expect((w.json() as HW).noticeShort).toBe(false);
    await clear(id, 'hostel_warden', {});
    await clear(id, 'hostel_mess', {});
    await clear(id, 'hostel_accounts', { feeChoice: 'refund' }, accountant);
    const done = (await post(`/hostel/withdrawals/${id}/complete`, {})).json() as HW;
    expect(done).toMatchObject({
      status: 'completed',
      feeUntil: '2026-10-01',
      feeChoice: 'refund',
    });
    expect(done.feeNote).toContain('refund');
    const refunds = await withMigrator((c) =>
      c.query<{ amount: string; status: string }>(
        `SELECT amount::text, status::text FROM fee_refunds WHERE hostel_withdrawal_id = $1`,
        [id],
      ),
    );
    expect(refunds.rows).toEqual([{ amount: '6000.00', status: 'requested' }]);
  });

  it('cancel keeps the bed; the register lists by status, as Excel too', async () => {
    const other = await post(`/hostel/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-12-31',
      reason: 'discipline',
    });
    const id = (other.json() as HW).id;
    expect(
      (await post(`/hostel/withdrawals/${id}/cancel`, { reason: 'Parent changed mind' }, warden))
        .statusCode,
    ).toBe(403);
    const c = await post(`/hostel/withdrawals/${id}/cancel`, { reason: 'Parent changed mind' });
    expect((c.json() as HW).status).toBe('cancelled');
    const list = await get<{ data: HW[] }>('/hostel/withdrawals?status=all');
    expect(list.data.length).toBe(3);
    const mine = await get<{ data: HW[] }>('/hostel/withdrawals?status=all', warden);
    // the warden of the boys hostel sees the boys only
    expect(mine.data.length).toBe(2);
    const f = await get<{ filename: string; base64: string }>(
      '/hostel/withdrawals/file?status=all&format=xlsx',
    );
    expect(f.filename).toBe('hostel-withdrawal-register.xlsx');
    expect(f.base64.length).toBeGreaterThan(100);
  });

  it('a hosteller leaving the school gets the hostel steps and gives up the bed on completion', async () => {
    const w = await post(`/people/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-11-15',
      reason: 'Family moving to another city',
    });
    expect(w.statusCode).toBe(201);
    const row = w.json() as {
      id: string;
      clearances: Array<{ department: string; status: string }>;
    };
    expect(row.clearances.map((x) => x.department)).toEqual(
      expect.arrayContaining(['hostel_warden', 'hostel_mess']),
    );
    // the hostel office opens no separate hostel withdrawal now
    const hw = await post(`/hostel/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-11-15',
      reason: 'other',
    });
    expect(hw.json().type).toContain('hostel.leaving_school');
    // every department clears step by step (the warden with a damage charge)
    for (let round = 0; round < 6; round += 1) {
      const cur = await get<{
        status: string;
        clearances: Array<{ department: string; status: string; canAct?: boolean }>;
      }>(`/people/withdrawals/${row.id}`);
      if (cur.status === 'cleared') break;
      for (const x of cur.clearances.filter((y) => y.canAct && y.status !== 'cleared')) {
        const r = await inject({
          method: 'PUT',
          url: `/people/withdrawals/${row.id}/clearances/${x.department}`,
          headers: h(),
          json: {
            status: 'cleared',
            dues: 0,
            ...(x.department === 'hostel_warden' ? { charge: 400 } : {}),
          },
        });
        expect(r.statusCode).toBe(200);
      }
    }
    const done = await post(`/people/withdrawals/${row.id}/complete`, {});
    expect(done.statusCode).toBe(201);
    const stay = await withMigrator((c) =>
      c.query<{ to_date: string; end_reason: string }>(
        `SELECT to_date::text, end_reason FROM hostel_allotments WHERE student_id = $1`,
        [ids.leaver],
      ),
    );
    expect(stay.rows[0]).toEqual({ to_date: '2026-11-15', end_reason: 'withdrawn' });
    const charge = await withMigrator((c) =>
      c.query<{ amount: string }>(
        `SELECT l.amount::text FROM misc_fee_students l WHERE l.student_id = $1`,
        [ids.leaver],
      ),
    );
    expect(charge.rows).toEqual([{ amount: '400.00' }]);
  });
});
