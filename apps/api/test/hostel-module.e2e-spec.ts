/**
 * Hostel module H1 (0146): set-up, beds, wardens, allotment with history, and the hostel fee following the
 * bed held each month (room type -> hostel fee group; a transfer re-prices from its month; vacate stops it).
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

interface Instalment {
  ledger: string;
  net: string;
  sequences: number[];
}

describe('hostel module (e2e)', () => {
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
  const hostelRows = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h() })).json() as {
      fee: { hosteller: boolean; hostelFrom: string | null; hostelTo: string | null };
      instalments: Instalment[];
    };
  const bed = async (room: string, label: string) => {
    const rooms = (await inject({ method: 'GET', url: '/hostel/rooms', headers: h() })).json()
      .data as Array<{
      roomNo: string;
      beds: Array<{ id: string; label: string }>;
    }>;
    return rooms.find((r) => r.roomNo === room)!.beds.find((b) => b.label === label)!.id;
  };

  beforeAll(async () => {
    const s = stamp('HSM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      warden = await seedUser(c, school, `${s}-warden`, 'warden');
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
    const cls = await post('/academics/classes', { code: 'X', name: 'Class X', displayOrder: 10 });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' });
    // the school fee group carries the ordinary boarding fee; "ac_two" is the AC room type's hostel group
    for (const [feeGroup, entries] of [
      [
        'general',
        [
          { headId: tui.json().id, amount: 1000, frequency: 'monthly' },
          { headId: hos.json().id, amount: 3000, frequency: 'monthly' },
        ],
      ],
      ['ac_two', [{ headId: hos.json().id, amount: 5000, frequency: 'monthly' }]],
    ] as const) {
      const r = await inject({
        method: 'PUT',
        url: `/fees/structures/${cls.json().id as string}`,
        headers: h(),
        json: { feeGroup, entries },
      });
      expect(r.statusCode).toBe(200);
    }
    let roll = 1;
    for (const [key, gender] of [
      ['boy', 'male'],
      ['boy2', 'male'],
      ['girl', 'female'],
    ] as const) {
      const r = await post('/people/students', {
        admissionNo: `HSM-${key}`,
        firstName: key,
        lastName: 'Boarder',
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
      employeeCode: 'W001',
      firstName: 'Ravi',
      lastName: 'Warden',
      employeeType: 'non_teaching',
      designation: 'Warden',
      mobile: '9000000001',
      posting: {},
    });
    expect(emp.statusCode).toBe(201);
    ids.employee = emp.json().id as string;
    await withMigrator((c) =>
      c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [warden.id, ids.employee]),
    );
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('sets up hostels, blocks, room types and rooms with their beds; only the office may', async () => {
    const boys = await post('/hostel/hostels', { name: 'Boys Hostel', code: 'bh', gender: 'boys' });
    expect(boys.statusCode).toBe(201);
    ids.boys = boys.json().id as string;
    const girls = await post('/hostel/hostels', {
      name: 'Girls Hostel',
      code: 'GH',
      gender: 'girls',
    });
    ids.girls = girls.json().id as string;
    expect((await post('/hostel/hostels', { name: 'Again', code: 'BH' })).statusCode).toBe(409);
    const block = await post('/hostel/blocks', { hostelId: ids.boys, name: 'A', floors: 3 });
    expect(block.statusCode).toBe(201);
    const nonAc = await post('/hostel/room-types', { name: 'Non-AC triple', seater: 3 });
    const ac = await post('/hostel/room-types', {
      name: 'AC double',
      seater: 2,
      ac: true,
      feeGroup: 'ac_two',
    });
    expect(ac.statusCode).toBe(201);
    const r101 = await post('/hostel/rooms', {
      hostelId: ids.boys,
      blockId: block.json().id,
      floor: 1,
      roomNo: '101',
      roomTypeId: nonAc.json().id,
    });
    expect(r101.json()).toMatchObject({ beds: 3 });
    await post('/hostel/rooms', {
      hostelId: ids.boys,
      blockId: block.json().id,
      floor: 2,
      roomNo: '201',
      roomTypeId: ac.json().id,
    });
    const g1 = await post('/hostel/rooms', {
      hostelId: ids.girls,
      roomNo: 'G1',
      roomTypeId: nonAc.json().id,
    });
    expect(g1.statusCode).toBe(201);
    // a floor the block does not have
    expect(
      (
        await post('/hostel/rooms', {
          hostelId: ids.boys,
          blockId: block.json().id,
          floor: 5,
          roomNo: '501',
          roomTypeId: nonAc.json().id,
        })
      ).statusCode,
    ).toBe(422);
    // a clerk cannot set up, and cannot see the hostel either
    expect((await post('/hostel/hostels', { name: 'X', code: 'X' }, clerk)).statusCode).toBe(403);
    const wardens = await inject({
      method: 'PUT',
      url: `/hostel/hostels/${ids.boys}/wardens`,
      headers: h(),
      json: { wardens: [{ employeeId: ids.employee, isHead: true }] },
    });
    expect(wardens.statusCode).toBe(200);
  });

  it('allots a bed: the pupil becomes a hosteller from that month at the room type fee group', async () => {
    expect(
      (await hostelRows(ids.boy!)).instalments.filter((i) => i.ledger === 'hostel'),
    ).toHaveLength(0);
    const a = await post('/hostel/allotments', {
      studentId: ids.boy,
      bedId: await bed('101', 'A'),
      fromDate: '2026-06-15',
    });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ fee: { synced: true } });
    expect(a.json().place).toContain('Room 101 · Bed A');
    const l = await hostelRows(ids.boy!);
    expect(l.fee).toMatchObject({ hosteller: true, hostelFrom: '2026-06-01', hostelTo: null });
    const rows = l.instalments.filter((i) => i.ledger === 'hostel');
    expect(rows.flatMap((i) => i.sequences)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows.every((i) => Number(i.net) === 3000)).toBe(true);
  });

  it('refuses a held bed, a second bed, and a boy in the girls hostel', async () => {
    const held = await post('/hostel/allotments', {
      studentId: ids.boy2,
      bedId: await bed('101', 'A'),
      fromDate: '2026-07-01',
    });
    expect(held.statusCode).toBe(409);
    expect(held.json().detail).toContain('boy Boarder');
    const twice = await post('/hostel/allotments', {
      studentId: ids.boy,
      bedId: await bed('101', 'B'),
      fromDate: '2026-07-01',
    });
    expect(twice.statusCode).toBe(409);
    const wrong = await post('/hostel/allotments', {
      studentId: ids.boy2,
      bedId: await bed('G1', 'A'),
      fromDate: '2026-07-01',
    });
    expect(wrong.statusCode).toBe(422);
  });

  it('transfer to an AC room re-prices the hostel fee from the transfer month only', async () => {
    const t = await post(`/hostel/students/${ids.boy}/transfer`, {
      bedId: await bed('201', 'A'),
      onDate: '2026-09-10',
    });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toMatchObject({ fee: { synced: true }, paidMonths: [] });
    const rows = (await hostelRows(ids.boy!)).instalments.filter((i) => i.ledger === 'hostel');
    const bySeq = Object.fromEntries(rows.map((i) => [i.sequences[0], Number(i.net)]));
    expect(bySeq[3]).toBe(3000); // June, July, August: the non-AC bed
    expect(bySeq[5]).toBe(3000);
    expect(bySeq[6]).toBe(5000); // September onwards: the AC double
    expect(bySeq[12]).toBe(5000);
    // the old bed is free again from the transfer day; the history keeps both stays
    const s = (
      await inject({ method: 'GET', url: `/hostel/students/${ids.boy}`, headers: h() })
    ).json();
    expect(s.history).toHaveLength(2);
    expect(s.history[1]).toMatchObject({ toDate: '2026-09-09', endReason: 'transfer' });
    expect(s.current).toMatchObject({ roomNo: '201', bed: 'A', feeGroup: 'ac_two' });
    expect(s.wardens[0]).toMatchObject({ name: 'Ravi Warden', isHead: true });
  });

  it('vacate stops the hostel fee after the month of leaving', async () => {
    const v = await post(`/hostel/students/${ids.boy}/vacate`, {
      onDate: '2026-12-05',
      remarks: 'Day scholar now',
    });
    expect(v.statusCode).toBe(201);
    const l = await hostelRows(ids.boy!);
    expect(l.fee).toMatchObject({
      hosteller: true,
      hostelFrom: '2026-06-01',
      hostelTo: '2026-12-01',
    });
    const seqs = l.instalments.filter((i) => i.ledger === 'hostel').flatMap((i) => i.sequences);
    expect(Math.max(...seqs)).toBe(9);
  });

  it('board, register and the hostellers with no bed; a warden sees only their hostel', async () => {
    // a hosteller by fee profile with no bed (before go-live)
    await withMigrator((c) =>
      c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, hosteller)
         SELECT s.school_id, s.id, e.academic_year_id, true FROM students s JOIN enrolments e ON e.student_id = s.id
          WHERE s.id = $1
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET hosteller = true`,
        [ids.girl],
      ),
    );
    const none = (await inject({ method: 'GET', url: '/hostel/no-bed', headers: h() })).json().data;
    expect(none.map((x: { studentId: string }) => x.studentId)).toEqual([ids.girl]);
    const boy2 = await post('/hostel/allotments', {
      studentId: ids.boy2,
      bedId: await bed('101', 'A'),
      fromDate: '2026-10-01',
    });
    expect(boy2.statusCode).toBe(201);
    const board = (
      await inject({
        method: 'GET',
        url: `/hostel/board?hostelId=${ids.boys}&on=2026-10-15`,
        headers: h(),
      })
    ).json();
    expect(board.totals).toMatchObject({ rooms: 2, beds: 5, taken: 2, free: 3 });
    const reg = (
      await inject({ method: 'GET', url: '/hostel/register?open=open', headers: h() })
    ).json().data;
    expect(reg).toHaveLength(2);
    // the warden: the boys hostel only, and no allotment
    const seen = (
      await inject({ method: 'GET', url: '/hostel/hostels', headers: h(warden) })
    ).json().data;
    expect(seen.map((x: { id: string }) => x.id)).toEqual([ids.boys]);
    const wBoard = (
      await inject({ method: 'GET', url: '/hostel/board?on=2026-10-15', headers: h(warden) })
    ).json();
    expect(new Set(wBoard.rooms.map((r: { hostelId: string }) => r.hostelId))).toEqual(
      new Set([ids.boys]),
    );
    expect(
      (
        await post(
          '/hostel/allotments',
          { studentId: ids.girl, bedId: await bed('G1', 'A'), fromDate: '2026-10-01' },
          warden,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await inject({ method: 'GET', url: '/hostel/hostels', headers: h(clerk) })).statusCode,
    ).toBe(403);
  });

  it('a held bed cannot be blocked, a used bed cannot be deleted, an occupied room cannot close', async () => {
    const bedId = await bed('101', 'A');
    const blocked = await inject({
      method: 'PUT',
      url: `/hostel/beds/${bedId}`,
      headers: h(),
      json: { label: 'A', status: 'blocked' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(
      (await inject({ method: 'DELETE', url: `/hostel/beds/${bedId}`, headers: h() })).statusCode,
    ).toBe(409);
    const rooms = (await inject({ method: 'GET', url: '/hostel/rooms', headers: h() })).json()
      .data as Array<{
      id: string;
      roomNo: string;
    }>;
    const closing = await inject({
      method: 'PATCH',
      url: `/hostel/rooms/${rooms.find((r) => r.roomNo === '101')!.id}`,
      headers: h(),
      json: { status: 'closed' },
    });
    expect(closing.statusCode).toBe(409);
  });

  it('go-live sheet: check keeps nothing, apply makes block, room, beds and allots; bad rows by line', async () => {
    const st = await post('/people/students', {
      admissionNo: 'HSM-xl',
      firstName: 'xl',
      lastName: 'Boarder',
      gender: 'male',
      dob: '2011-01-01',
      admittedOn: '2019-04-05',
    });
    expect(st.statusCode).toBe(201);
    const tpl = await inject({ method: 'GET', url: '/hostel/import/template', headers: h() });
    expect(tpl.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(tpl.json().base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const sheetRows = [
      ['BH', 'B', 3, '301', 'Non-AC triple', 'A', 'HSM-xl', '2026-11-01'],
      ['BH', 'B', 3, '301', 'Non-AC triple', 'B', '', ''],
      ['BH', 'B', 3, '301', 'AC double', 'C', '', ''], // another type for the same room
      ['ZZ', '', 0, '1', 'Non-AC triple', 'A', '', ''], // no such hostel
      ['BH', 'B', 3, '302', 'Non-AC triple', 'A', 'NOPE', ''], // no such pupil
    ];
    // rows 2 to 6 (the template's drop-downs reach row 501, so addRow would write below them)
    sheetRows.forEach((r, i) => {
      ws.getRow(i + 2).values = r;
    });
    const file = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
    const check = await post('/hostel/import', { fileBase64: file, apply: false });
    expect(check.statusCode).toBe(201);
    expect(check.json()).toMatchObject({ apply: false, rows: 5, rooms: 1, beds: 2, allotted: 1 });
    expect(check.json().errors.map((e: { row: number }) => e.row)).toEqual([4, 5, 6]);
    const before = (await inject({ method: 'GET', url: '/hostel/rooms', headers: h() })).json()
      .data;
    expect(before.some((r: { roomNo: string }) => r.roomNo === '301')).toBe(false);
    const apply = await post('/hostel/import', { fileBase64: file, apply: true });
    expect(apply.json()).toMatchObject({ apply: true, rooms: 1, beds: 2, allotted: 1 });
    const s = (
      await inject({
        method: 'GET',
        url: `/hostel/students/${st.json().id as string}`,
        headers: h(),
      })
    ).json();
    expect(s.current).toMatchObject({
      roomNo: '301',
      bed: 'A',
      block: 'B',
      fromDate: '2026-11-01',
    });
    const hostels = (await inject({ method: 'GET', url: '/hostel/hostels', headers: h() })).json()
      .data;
    const blockB = hostels
      .find((x: { id: string }) => x.id === ids.boys)
      .blocks.find((b: { name: string }) => b.name === 'B');
    expect(blockB.floors).toBe(4);
  });
});
