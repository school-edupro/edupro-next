/**
 * Hostel module H2 (0148): roll-call sessions and rolls (away on leave marked by the system, absences
 * alerted once), and hostel leave on the gate pass — home leave (warden approves, warden hands over, gate
 * out and back in, late minutes) and outing (straight to the gate, same day, by the latest time), the
 * hostel's leave lists and the overdue tick.
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
const ist = (d = new Date()) =>
  new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('hostel module H2 (e2e)', () => {
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
  const get = async (url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();

  beforeAll(async () => {
    const s = stamp('HS2');
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
      code: 'VIII',
      name: 'Class VIII',
      displayOrder: 8,
    });
    const sec = await post(`/academics/classes/${cls.json().id as string}/sections`, admin, {
      name: 'A',
    });
    let roll = 1;
    for (const [key, mobile] of [
      ['ravi', '9876500071'],
      ['amit', '9876500072'],
      ['day', '9876500073'],
    ] as const) {
      const r = await post('/people/students', admin, {
        admissionNo: `HS2-${key}`,
        firstName: key,
        lastName: 'Boarder',
        gender: 'male',
        dob: '2012-01-01',
        guardians: [
          {
            guardian: { firstName: 'Papa', lastName: key, mobile },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: roll++ },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id as string;
    }
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
        mobile: code === 'W1' ? '9000000011' : '9000000012',
        posting: {},
      });
      ids[code] = e.json().id as string;
      await withMigrator((c) =>
        c.query(`UPDATE employees SET user_id = $1 WHERE id = $2`, [user.id, ids[code]]),
      );
    }
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500071' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    // two hostels: ravi and amit in the boys hostel (warden W1); W2 runs the other one
    const bh = await post('/hostel/hostels', admin, {
      name: 'Boys Hostel',
      code: 'BH',
      gender: 'boys',
    });
    const oh = await post('/hostel/hostels', admin, {
      name: 'Other Hostel',
      code: 'OH',
      gender: 'boys',
    });
    ids.bh = bh.json().id as string;
    ids.oh = oh.json().id as string;
    for (const [hid, emp] of [
      [ids.bh, ids.W1],
      [ids.oh, ids.W2],
    ])
      await inject({
        method: 'PUT',
        url: `/hostel/hostels/${hid}/wardens`,
        headers: h(admin),
        json: { wardens: [{ employeeId: emp, isHead: true }] },
      });
    const t = await post('/hostel/room-types', admin, { name: 'Double', seater: 2 });
    const room = await post('/hostel/rooms', admin, {
      hostelId: ids.bh,
      roomNo: '11',
      roomTypeId: t.json().id,
    });
    const beds = (await get(`/hostel/rooms?hostelId=${ids.bh}`)).data[0].beds as Array<{
      id: string;
    }>;
    expect(room.statusCode).toBe(201);
    for (const [i, key] of (['ravi', 'amit'] as const).entries()) {
      const a = await post('/hostel/allotments', admin, {
        studentId: ids[key],
        bedId: beds[i]!.id,
        fromDate: plusDays(today, -30),
      });
      expect(a.statusCode).toBe(201);
    }
  });
  afterAll(async () => {
    // nothing is sent here (no template is ready), but drop anything queued for these test mobiles
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    ).catch(() => undefined);
    if (app) await app.close();
  });

  it('settings and sessions are the office’s; a warden takes the roll of their own hostel only', async () => {
    const set = await inject({
      method: 'PUT',
      url: '/hostel/settings',
      headers: h(admin),
      json: {
        lateGraceMinutes: 15,
        escalateAfterHours: 3,
        outingReturnBy: '20:00',
        alertParentAbsent: true,
      },
    });
    expect(set.json()).toMatchObject({ lateGraceMinutes: 15, outingReturnBy: '20:00' });
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/hostel/settings',
          headers: h(warden),
          json: set.json(),
        })
      ).statusCode,
    ).toBe(403);
    const night = await post('/hostel/sessions', admin, {
      hostelId: ids.bh,
      name: 'Night',
      atTime: '21:30',
    });
    expect(night.statusCode).toBe(201);
    ids.night = night.json().id as string;
    expect(
      (await post('/hostel/sessions', admin, { hostelId: ids.bh, name: 'Night', atTime: '22:00' }))
        .statusCode,
    ).toBe(409);
    const roll = await get(`/hostel/rollcall?sessionId=${ids.night}&on=${today}`, warden);
    expect(roll.pupils.map((p: { name: string }) => p.name).sort()).toEqual([
      'amit Boarder',
      'ravi Boarder',
    ]);
    expect(roll.pupils.every((p: { status: string }) => p.status === 'present')).toBe(true);
    // W2 is not a warden of the boys hostel
    expect(
      (
        await inject({
          method: 'GET',
          url: `/hostel/rollcall?sessionId=${ids.night}&on=${today}`,
          headers: h(other),
        })
      ).statusCode,
    ).toBe(403);
    const saved = await post('/hostel/rollcall', warden, {
      sessionId: ids.night,
      on: today,
      marks: [
        { studentId: ids.ravi, status: 'present' },
        { studentId: ids.amit, status: 'absent', note: 'Not in room' },
      ],
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ counts: { present: 1, absent: 1 }, alerted: 1 });
    // saved again: the absence is not alerted twice
    const again = await post('/hostel/rollcall', warden, {
      sessionId: ids.night,
      on: today,
      marks: [
        { studentId: ids.ravi, status: 'present' },
        { studentId: ids.amit, status: 'absent', note: 'Not in room' },
      ],
    });
    expect(again.json()).toMatchObject({ alerted: 0 });
    // a day scholar cannot be put in the roll; no roll for tomorrow
    expect(
      (
        await post('/hostel/rollcall', warden, {
          sessionId: ids.night,
          on: today,
          marks: [{ studentId: ids.day, status: 'present' }],
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/hostel/rollcall', warden, {
          sessionId: ids.night,
          on: plusDays(today, 1),
          marks: [{ studentId: ids.ravi, status: 'present' }],
        })
      ).statusCode,
    ).toBe(422);
    const report = await get(`/hostel/rollcall/report?from=${today}&to=${today}`, warden);
    expect(report.data[0]).toMatchObject({ session: 'Night', present: 1, absent: 1 });
  });

  it('the month register: a column per session each day, the marks, totals; Excel and PDF', async () => {
    const morning = await post('/hostel/sessions', admin, {
      hostelId: ids.bh,
      name: 'Morning',
      atTime: '06:30',
    });
    expect(morning.statusCode).toBe(201);
    await post('/hostel/rollcall', warden, {
      sessionId: morning.json().id,
      on: today,
      marks: [
        { studentId: ids.ravi, status: 'present' },
        { studentId: ids.amit, status: 'sick' },
      ],
    });
    const month = today.slice(0, 7);
    type Reg = {
      hostel: { name: string };
      days: string[];
      sessions: Array<{ name: string; short: string }>;
      columns: Array<{ day: string; taken: boolean; present: number }>;
      rows: Array<{
        name: string;
        cells: string[];
        present: number;
        absent: number;
        sick: number;
        percent: number | null;
      }>;
    };
    const reg = (await get(`/hostel/rollcall/register?month=${month}`, warden)) as Reg;
    expect(reg.hostel.name).toBe('Boys Hostel');
    expect(reg.days[reg.days.length - 1]).toBe(today);
    // in the order of the day: Morning, then Night
    expect(reg.sessions.map((x) => x.short)).toEqual(['M', 'N']);
    expect(reg.columns).toHaveLength(reg.days.length * 2);
    const at = reg.days.length * 2 - 2;
    const ravi = reg.rows.find((r) => r.name === 'ravi Boarder')!;
    const amit = reg.rows.find((r) => r.name === 'amit Boarder')!;
    expect(ravi.cells.slice(at)).toEqual(['P', 'P']);
    expect(amit.cells.slice(at)).toEqual(['S', 'A']);
    expect(ravi).toMatchObject({ present: 2, percent: 100 });
    expect(amit).toMatchObject({ present: 0, absent: 1, sick: 1, percent: 0 });
    expect(reg.columns.slice(at).map((x) => [x.taken, x.present])).toEqual([
      [true, 1],
      [true, 1],
    ]);
    // the day scholar is not on it; a day before the bed shows blank, a day without a roll '-'
    expect(reg.rows).toHaveLength(2);
    if (reg.days.length > 1) expect(ravi.cells[0]).toMatch(/^(-|)$/);
    // the other hostel's warden cannot open this hostel's register
    expect(
      (
        await inject({
          method: 'GET',
          url: `/hostel/rollcall/register?month=${month}&hostelId=${ids.bh}`,
          headers: h(other),
        })
      ).statusCode,
    ).toBe(403);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(`/hostel/rollcall/register/file?month=${month}&format=${format}`, warden);
      expect(f.filename).toBe(`hostel-roll-register-${month}.${format}`);
      expect(f.base64.length).toBeGreaterThan(100);
    }
  });

  it('home leave: only for boarders; the warden approves, hands over, the gate lets out and back in', async () => {
    const day = await post('/gate-passes/mine', parent, {
      studentId: ids.ravi,
      kind: 'hostel_home',
      reason: 'Sister’s wedding',
      escortKind: 'father',
    });
    expect(day.statusCode).toBe(400); // no return day
    const req = await post('/gate-passes/mine', parent, {
      studentId: ids.ravi,
      kind: 'hostel_home',
      onDate: today,
      atTime: '00:05',
      returnOn: plusDays(today, 2),
      returnAt: '17:00',
      reason: 'Sister’s wedding',
      escortKind: 'father',
    });
    expect(req.statusCode).toBe(201);
    ids.home = req.json().id as string;
    expect(req.json()).toMatchObject({ state: 'pending', kind: 'hostel_home' });
    // waiting with the boys hostel's warden only
    const inbox = await get('/gate-passes/inbox', warden);
    expect(JSON.stringify(inbox)).toContain(ids.home);
    expect(JSON.stringify(await get('/gate-passes/inbox', other))).not.toContain(
      `"id":"${ids.home}"`,
    );
    expect(
      (await get('/hostel/leaves?show=pending', warden)).data.map((x: { id: string }) => x.id),
    ).toContain(ids.home);
    const ok = await post(`/gate-passes/${ids.home}/decide`, warden, { outcome: 'approved' });
    expect(ok.json()).toMatchObject({
      state: 'approved',
      stage: 'Approved: the warden hands over',
    });
    // the gate sees it as approved but waiting for the warden's hand-over, not among those to let out
    const board = await get('/gate-passes/gate/board', guard);
    expect(board.waiting.map((x: { id: string }) => x.id)).toContain(ids.home);
    expect(board.ready.map((x: { id: string }) => x.id)).not.toContain(ids.home);
    // the gate waits for the warden's hand-over; the other hostel's warden cannot hand over
    expect((await post(`/gate-passes/${ids.home}/out`, guard)).json()).toMatchObject({
      type: expect.stringContaining('gate_pass.not_handed_over'),
    });
    expect(
      (await post(`/gate-passes/${ids.home}/handover`, other, { photo: PHOTO })).statusCode,
    ).toBe(403);
    expect(
      (await get('/hostel/leaves?show=handover', warden)).data.map((x: { id: string }) => x.id),
    ).toEqual([ids.home]);
    const hand = await post(`/gate-passes/${ids.home}/handover`, warden, { photo: PHOTO });
    expect(hand.json()).toMatchObject({ ok: true, pass: { state: 'handed_over' } });
    const out = await post(`/gate-passes/${ids.home}/out`, guard, { gate: 'Main gate' });
    expect(out.json()).toMatchObject({ state: 'out', stage: 'Out on leave: to come back' });
    // a visitor for him now waits for the warden: the pupil is away
    const chk = await get(`/hostel/visits/check?studentId=${ids.ravi}`, guard);
    expect(chk.away).toBe(true);
    const visit = await post('/hostel/visits', guard, {
      studentId: ids.ravi,
      visitorName: 'Papa ravi',
      mobile: '9876500071',
      relation: 'Father',
    });
    expect(visit.json()).toMatchObject({
      state: 'waiting',
      why: 'the pupil is away on hostel leave',
    });
    // the roll marks him on leave by itself, whatever the warden ticks
    const roll = await post('/hostel/rollcall', warden, {
      sessionId: ids.night,
      on: today,
      marks: [
        { studentId: ids.ravi, status: 'absent' },
        { studentId: ids.amit, status: 'present' },
      ],
    });
    expect(roll.json().counts).toMatchObject({ on_leave: 1, present: 1 });
    expect((await get('/hostel/leaves?show=out', warden)).data[0]).toMatchObject({
      id: ids.home,
      overdue: false,
      hostel: 'Boys Hostel',
    });
    const today2 = await get('/hostel/today', warden);
    // Night and the register test's Morning, both taken today
    expect(today2).toMatchObject({ boarders: 2, away: 1, overdue: 0, sessions: 2, rollsTaken: 2 });
  });

  it('late back: the tick flags it once and escalates past the hours; back in records the late minutes', async () => {
    // due back 4 hours ago
    await withMigrator((c) =>
      c.query(`UPDATE gate_passes SET return_by = now() - interval '4 hours' WHERE id = $1`, [
        ids.home,
      ]),
    );
    expect(
      (await get('/hostel/leaves?show=overdue', warden)).data.map((x: { id: string }) => x.id),
    ).toEqual([ids.home]);
    const tick = async () =>
      withMigrator(async (c) => {
        await c.query('BEGIN');
        await c.query(
          `SELECT set_config('app.school_id', $1, true), set_config('app.allowed_school_ids', $2, true)`,
          [school.id, `{${school.id}}`],
        );
        const r = await c.query<{ n: number }>('SELECT app.hostel_leave_tick() AS n');
        await c.query('COMMIT');
        return r.rows[0]!.n;
      });
    expect(await tick()).toBe(2); // flagged and (past 3 hours) escalated
    expect(await tick()).toBe(0); // once only
    const row = await withMigrator((c) =>
      c.query<{ overdue: boolean; escalated: boolean }>(
        `SELECT overdue_at IS NOT NULL AS overdue, escalated_at IS NOT NULL AS escalated FROM gate_passes WHERE id = $1`,
        [ids.home],
      ),
    );
    expect(row.rows[0]).toEqual({ overdue: true, escalated: true });
    const back = await post(`/gate-passes/${ids.home}/in`, guard, { items: [] });
    expect(back.json()).toMatchObject({ state: 'returned', stage: 'Back in the hostel' });
    const late = await withMigrator((c) =>
      c.query<{ late_minutes: number }>(`SELECT late_minutes FROM gate_passes WHERE id = $1`, [
        ids.home,
      ]),
    );
    expect(late.rows[0]!.late_minutes).toBeGreaterThanOrEqual(239);
  });

  it('outing: same day, by the latest time, no hand-over, straight to the gate and back', async () => {
    const tooLate = await post('/gate-passes/mine', parent, {
      studentId: ids.ravi,
      kind: 'hostel_outing',
      onDate: today,
      atTime: '00:10',
      returnAt: '21:00',
      reason: 'Market',
    });
    expect(tooLate.json()).toMatchObject({
      type: expect.stringContaining('gate_pass.outing_too_late'),
    });
    const nextDay = await post('/gate-passes/mine', parent, {
      studentId: ids.ravi,
      kind: 'hostel_outing',
      onDate: today,
      returnOn: plusDays(today, 1),
      reason: 'Market',
    });
    expect(nextDay.json()).toMatchObject({
      type: expect.stringContaining('gate_pass.outing_same_day'),
    });
    const req = await post('/gate-passes/mine', parent, {
      studentId: ids.ravi,
      kind: 'hostel_outing',
      onDate: today,
      atTime: '00:10',
      reason: 'Market',
    });
    expect(req.statusCode).toBe(201);
    expect(req.json().returnBy).toContain(today.slice(0, 7)); // back today by the school's latest time
    await post(`/gate-passes/${req.json().id as string}/decide`, warden, { outcome: 'approved' });
    const out = await post(`/gate-passes/${req.json().id as string}/out`, guard);
    expect(out.json()).toMatchObject({ state: 'out' });
    const back = await post(`/gate-passes/${req.json().id as string}/in`, guard, { items: [] });
    expect(back.json()).toMatchObject({ state: 'returned' });
  });

  it('hostel leave follows its own levels: warden by default, then as the school sets them', async () => {
    type Setup = {
      settings: Record<string, unknown>;
      levels: Array<{ audience: string; kind: string; label: string }>;
    };
    const setup = (await get('/gate-passes/setup')) as Setup;
    // the first read gives each of home leave and outings one level: any warden of the pupil's hostel
    for (const a of ['hostel_home', 'hostel_outing'])
      expect(setup.levels.filter((l) => l.audience === a)).toEqual([
        expect.objectContaining({ kind: 'hostel_warden', label: 'Warden' }),
      ]);
    const put = (json: unknown) =>
      inject({ method: 'PUT', url: '/gate-passes/setup', headers: h(admin), json });
    const base = { ...setup.settings };
    const keep = setup.levels.filter((l) => !l.audience.startsWith('hostel_'));
    // a warden level belongs to hostel leave only
    expect(
      (
        await put({
          ...base,
          levels: [...keep, { audience: 'student', label: 'Warden', kind: 'hostel_warden' }],
        })
      ).statusCode,
    ).toBe(400);
    // home leave: the warden, then the school admin; outings left out of the form stay as they were
    const saved = await put({
      ...base,
      hostelHomeMode: 'sequence',
      levels: [
        ...keep,
        { audience: 'hostel_home', label: 'Warden', kind: 'hostel_warden' },
        {
          audience: 'hostel_home',
          label: 'Head of school',
          kind: 'role',
          roleCode: 'school_admin',
        },
      ],
    });
    expect(saved.statusCode).toBe(200);
    const after = saved.json() as Setup;
    expect(after.levels.filter((l) => l.audience === 'hostel_home').map((l) => l.kind)).toEqual([
      'hostel_warden',
      'role',
    ]);
    expect(after.levels.filter((l) => l.audience === 'hostel_outing')).toHaveLength(1);
    // an empty home leave set is refused
    expect(
      (
        await put({
          ...base,
          levels: [
            ...keep,
            { audience: 'hostel_home', label: 'Warden', kind: 'hostel_warden', active: false },
          ],
        })
      ).statusCode,
    ).toBe(400);
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500072' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const req = await post('/gate-passes/mine', parent, {
      studentId: ids.amit,
      kind: 'hostel_home',
      onDate: plusDays(today, 5),
      atTime: '10:00',
      returnOn: plusDays(today, 7),
      returnAt: '17:00',
      reason: 'Family function',
      escortKind: 'father',
    });
    expect(req.statusCode).toBe(201);
    const id = req.json().id as string;
    // the other hostel's warden holds no level; the admin waits for the warden
    expect(JSON.stringify(await get('/gate-passes/inbox', other))).not.toContain(`"id":"${id}"`);
    expect(JSON.stringify(await get('/gate-passes/inbox', admin))).not.toContain(`"id":"${id}"`);
    const first = await post(`/gate-passes/${id}/decide`, warden, { outcome: 'approved' });
    expect(first.json()).toMatchObject({ state: 'pending' });
    const second = await post(`/gate-passes/${id}/decide`, admin, { outcome: 'approved' });
    expect(second.json()).toMatchObject({ state: 'approved' });
    // an outing still needs the warden alone
    const outing = await post('/gate-passes/mine', parent, {
      studentId: ids.amit,
      kind: 'hostel_outing',
      onDate: plusDays(today, 1),
      atTime: '10:00',
      reason: 'Market',
    });
    expect(outing.statusCode).toBe(201);
    const o = await post(`/gate-passes/${outing.json().id as string}/decide`, warden, {
      outcome: 'approved',
    });
    expect(o.json()).toMatchObject({ state: 'approved' });
  });

  it('a day scholar cannot ask for hostel leave', async () => {
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500073' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const r = await post('/gate-passes/mine', parent, {
      studentId: ids.day,
      kind: 'hostel_outing',
      onDate: today,
      reason: 'Market',
    });
    expect(r.json()).toMatchObject({ type: expect.stringContaining('gate_pass.not_hosteller') });
  });
});
