/**
 * Hostel withdrawal (0153, 0158, docs/design/27-hostel-withdrawal.md): the Hostel Clerk (or a warden of the
 * pupil's hostel, or the office) starts it with the damages and mess dues; it goes through its own
 * approval levels set on Fee setup -> Approval levels ("who may start" too); the last approver chooses
 * carry-forward or refund; the last approval vacates the bed, keeps one more month on a short notice,
 * settles the paid months after and raises the charges as misc fees; not approved keeps the bed; with the
 * levels switched off the office completes it; a hosteller's school withdrawal gets the hostel's steps.
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

interface HW {
  id: string;
  status: string;
  noticeShort: boolean;
  feeChoice: string;
  feeUntil: string | null;
  feeNote: string | null;
  decidedNote: string | null;
  waitingWith: string | null;
  canComplete?: boolean;
  approval: {
    instanceId: string;
    status: string;
    steps: Array<{ level: number; name: string; status: string }>;
  } | null;
  myStep: { id: string; lastLevel: boolean } | null;
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
  let hostelClerk: SeededUser;
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
  const decide = (id: string, body: Record<string, unknown>, u: SeededUser) =>
    post(`/hostel/withdrawals/${id}/decide`, body, u);
  const flow = async () =>
    (await get<Array<{ id: string; code: string; status: string; creatorRoles: string[] }>>(
      '/workflow/definitions',
    )) as unknown;
  const hwFlow = async () => {
    const r = (await flow()) as
      | Array<{ id: string; code: string; status: string; creatorRoles: string[] }>
      | { data: Array<{ id: string; code: string; status: string; creatorRoles: string[] }> };
    return (Array.isArray(r) ? r : r.data).find((d) => d.code === 'hostel_withdrawal')!;
  };
  const patchFlow = (id: string, body: Record<string, unknown>) =>
    inject({ method: 'PATCH', url: `/workflow/definitions/${id}`, headers: h(), json: body });

  beforeAll(async () => {
    const s = stamp('HWD');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      clerk = await seedUser(c, school, `${s}-clerk`, 'clerk');
      hostelClerk = await seedUser(c, school, `${s}-hclerk`, 'hostel_clerk');
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
      ['again', 'male'],
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
      ['again', bed('101', 'C')],
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

  it('makes the Hostel Clerk role and the approval levels with who may start; the steps stay for leaving the school', async () => {
    const role = await withMigrator((c) =>
      c.query<{ code: string }>(
        `SELECT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
          WHERE r.school_id IS NULL AND r.code = 'hostel_clerk' ORDER BY 1`,
      ),
    );
    expect(role.rows.map((x) => x.code)).toEqual(
      expect.arrayContaining([
        'hostel.allot.manage',
        'hostel.room.view',
        'hostel.setup.manage',
        'hostel.withdrawal.manage',
        'hostel.withdrawal.view',
      ]),
    );
    expect((await get<{ active: boolean }>('/hostel/withdrawal-approval')).active).toBe(true);
    const f = await hwFlow();
    expect(f.status).toBe('active');
    expect(f.creatorRoles).toEqual(expect.arrayContaining(['hostel_clerk', 'warden']));
    const s = await get<{
      departments: Array<{ code: string; active: boolean }>;
      noticeDays: number;
    }>('/hostel/withdrawal-settings');
    expect(s.noticeDays).toBe(30);
    expect(s.departments.filter((d) => d.active).map((d) => d.code)).toEqual([
      'hostel_warden',
      'hostel_mess',
    ]);
    expect((await get<{ status?: number }>('/hostel/withdrawals', clerk)).status).toBe(403);
  });

  it('starts only for a boarder; the clerk, a warden of the hostel or the office; who may start is on the approval levels', async () => {
    const none = await post(`/hostel/students/${ids.dayscholar}/withdrawal`, {
      leavingOn: '2026-10-31',
      reason: 'parent_request',
    });
    expect(none.json().type).toContain('hostel.not_allotted');
    // the boys' warden cannot start one for a girl; Accounts cannot start one
    expect(
      (
        await post(
          `/hostel/students/${ids.leaver}/withdrawal`,
          { leavingOn: '2026-10-31', reason: 'parent_request' },
          warden,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `/hostel/students/${ids.carry}/withdrawal`,
          { leavingOn: '2026-10-31', reason: 'parent_request' },
          accountant,
        )
      ).statusCode,
    ).toBe(403);
    // take the warden off "who may start": refused by the approval levels
    const f = await hwFlow();
    await patchFlow(f.id, { creatorRoles: f.creatorRoles.filter((r) => r !== 'warden') });
    const off = await post(
      `/hostel/students/${ids.carry}/withdrawal`,
      { leavingOn: '2026-10-31', reason: 'parent_request' },
      warden,
    );
    expect(off.statusCode).toBe(403);
    expect(off.json().type).toContain('workflow.creator_not_allowed');
    await patchFlow(f.id, { creatorRoles: f.creatorRoles });
    // the Hostel Clerk starts it with the damages and mess dues; asked today for the month end: short notice
    const w = await post(
      `/hostel/students/${ids.carry}/withdrawal`,
      {
        requestedOn: '2026-10-16',
        leavingOn: '2026-10-31',
        reason: 'parent_request',
        damageCharge: 750,
        messCharge: 200,
        chargeRemarks: 'Broken chair; October mess',
      },
      hostelClerk,
    );
    expect(w.statusCode).toBe(201);
    const row = w.json() as HW;
    ids.hwCarry = row.id;
    expect(row).toMatchObject({ status: 'requested', noticeShort: true, waitingWith: 'Accounts' });
    expect(row.approval!.steps.map((x) => x.name)).toEqual(['Accounts', 'Principal approval']);
    const again = await post(`/hostel/students/${ids.carry}/withdrawal`, {
      leavingOn: '2026-11-30',
      reason: 'other',
    });
    expect(again.json().type).toContain('withdrawal.open_exists');
  });

  it('goes level by level; only the level’s approver decides; the last one picks carry or refund', async () => {
    const id = ids.hwCarry!;
    expect((await decide(id, { outcome: 'approved' }, warden)).statusCode).toBe(403);
    // the principal is level 2: not yet theirs
    expect((await decide(id, { outcome: 'approved' }, admin)).statusCode).toBe(403);
    const mine = await get<{ data: HW[] }>('/hostel/withdrawals?mine=true', accountant);
    expect(mine.data.map((x) => x.id)).toEqual([id]);
    const l1 = await decide(id, { outcome: 'approved', note: 'Dues seen' }, accountant);
    expect(l1.statusCode).toBe(201);
    expect(l1.json()).toMatchObject({ status: 'requested', waitingWith: 'Principal approval' });
    const view = await get<HW>(`/hostel/withdrawals/${id}`);
    expect(view.myStep).toMatchObject({ lastLevel: true });
    const l2 = await decide(id, { outcome: 'approved', feeChoice: 'carry' }, admin);
    expect(l2.statusCode).toBe(201);
    const done = l2.json() as HW;
    expect(done).toMatchObject({ status: 'completed', feeUntil: '2026-11-01', feeChoice: 'carry' });
    expect(done.feeNote).toContain('Dec 2026');
    expect(done.feeNote).toContain('damages Rs. 750');
    expect(done.feeNote).toContain('mess dues Rs. 200');
  });

  it('the last approval gave up the bed, kept November, and raised the damages and mess dues', async () => {
    const stay = await withMigrator((c) =>
      c.query<{ to_date: string; end_reason: string }>(
        `SELECT to_date::text, end_reason FROM hostel_allotments WHERE student_id = $1`,
        [ids.carry],
      ),
    );
    expect(stay.rows[0]).toEqual({ to_date: '2026-10-31', end_reason: 'vacate' });
    const l = await ledger(ids.carry!);
    expect(l.fee.hostelTo).toBe('2026-11-01');
    expect(
      l.instalments
        .filter((i) => i.ledger === 'hostel' && Number(i.net) > 0)
        .map((i) => i.dueOn.slice(0, 7)),
    ).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    const misc = await withMigrator((c) =>
      c.query<{ amount: string; title: string }>(
        `SELECT l.amount::text, f.title FROM misc_fee_students l JOIN misc_fees f ON f.id = l.misc_fee_id
          WHERE l.student_id = $1 ORDER BY l.amount`,
        [ids.carry],
      ),
    );
    expect(misc.rows.map((x) => x.amount)).toEqual(['200.00', '750.00']);
  });

  it('a long notice and a refund chosen at the last level', async () => {
    const w = await post(`/hostel/students/${ids.refund}/withdrawal`, {
      requestedOn: '2026-09-01',
      leavingOn: '2026-10-31',
      reason: 'health',
    });
    const id = (w.json() as HW).id;
    expect((w.json() as HW).noticeShort).toBe(false);
    await decide(id, { outcome: 'approved' }, accountant);
    const done = (
      await decide(id, { outcome: 'approved', feeChoice: 'refund' }, admin)
    ).json() as HW;
    expect(done).toMatchObject({
      status: 'completed',
      feeUntil: '2026-10-01',
      feeChoice: 'refund',
    });
    const refunds = await withMigrator((c) =>
      c.query<{ amount: string; status: string }>(
        `SELECT amount::text, status::text FROM fee_refunds WHERE hostel_withdrawal_id = $1`,
        [id],
      ),
    );
    expect(refunds.rows).toEqual([{ amount: '6000.00', status: 'requested' }]);
  });

  it('not approved keeps the bed; with the levels switched off the office completes it', async () => {
    const w = await post(`/hostel/students/${ids.again}/withdrawal`, {
      leavingOn: '2026-11-30',
      reason: 'discipline',
    });
    const id = (w.json() as HW).id;
    expect((await decide(id, { outcome: 'rejected' }, accountant)).statusCode).toBe(400);
    const no = await decide(
      id,
      { outcome: 'rejected', note: 'Parents to meet the principal' },
      accountant,
    );
    expect(no.json()).toMatchObject({
      status: 'rejected',
      decidedNote: 'Parents to meet the principal',
    });
    const bed = await withMigrator((c) =>
      c.query(`SELECT 1 FROM hostel_allotments WHERE student_id = $1 AND to_date IS NULL`, [
        ids.again,
      ]),
    );
    expect(bed.rowCount).toBe(1);
    // the school switches the levels off: the office completes it directly
    const f = await hwFlow();
    await patchFlow(f.id, { status: 'inactive' });
    const w2 = await post(`/hostel/students/${ids.again}/withdrawal`, {
      leavingOn: '2026-11-30',
      reason: 'discipline',
    });
    const row = w2.json() as HW;
    expect(row.approval).toBeNull();
    expect(row.canComplete).toBe(true);
    const done = await post(`/hostel/withdrawals/${row.id}/complete`, { feeChoice: 'carry' });
    expect(done.json()).toMatchObject({ status: 'completed', feeUntil: '2026-11-01' });
    await patchFlow(f.id, { status: 'active' });
  });

  it('cancel closes the approval and keeps the bed; the register lists them, as Excel too', async () => {
    const w = await post(`/hostel/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-12-31',
      reason: 'other',
    });
    const id = (w.json() as HW).id;
    expect(
      (await post(`/hostel/withdrawals/${id}/cancel`, { reason: 'Changed mind' }, warden))
        .statusCode,
    ).toBe(403);
    const c = (
      await post(`/hostel/withdrawals/${id}/cancel`, { reason: 'Changed mind' })
    ).json() as HW;
    expect(c.status).toBe('cancelled');
    expect(c.approval!.status).toBe('cancelled');
    const all = await get<{ data: HW[] }>('/hostel/withdrawals?status=all');
    expect(all.data.length).toBe(5);
    const boys = await get<{ data: HW[] }>('/hostel/withdrawals?status=all', warden);
    expect(boys.data.length).toBe(4);
    const f = await get<{ filename: string; base64: string }>(
      '/hostel/withdrawals/file?status=all&format=xlsx',
    );
    expect(f.filename).toBe('hostel-withdrawal-register.xlsx');
  });

  it('a hosteller leaving the school gets the hostel steps and gives up the bed on completion', async () => {
    const w = await post(`/people/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-11-15',
      reason: 'Family moving to another city',
    });
    expect(w.statusCode).toBe(201);
    const row = w.json() as { id: string; clearances: Array<{ department: string }> };
    expect(row.clearances.map((x) => x.department)).toEqual(
      expect.arrayContaining(['hostel_warden', 'hostel_mess']),
    );
    expect(row.clearances.map((x) => x.department)).not.toContain('hostel_fees');
    const hw = await post(`/hostel/students/${ids.leaver}/withdrawal`, {
      leavingOn: '2026-11-15',
      reason: 'other',
    });
    expect(hw.json().type).toContain('hostel.leaving_school');
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
    expect((await post(`/people/withdrawals/${row.id}/complete`, {})).statusCode).toBe(201);
    const stay = await withMigrator((c) =>
      c.query<{ to_date: string; end_reason: string }>(
        `SELECT to_date::text, end_reason FROM hostel_allotments WHERE student_id = $1`,
        [ids.leaver],
      ),
    );
    expect(stay.rows[0]).toEqual({ to_date: '2026-11-15', end_reason: 'withdrawn' });
  });
});
