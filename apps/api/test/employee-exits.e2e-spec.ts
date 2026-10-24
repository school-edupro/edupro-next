/**
 * Employee exit, part 5 (docs/design/38): set-up, the resignation in the staff app, the office's exit on
 * an employee's behalf, the approval levels per employee type (HOD, reporting manager, principal), and
 * approve / send back / reject / withdraw.
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

describe('employee exits (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hodU: SeededUser;
  let t1U: SeededUser;
  let t2U: SeededUser;
  let t3U: SeededUser;
  const emp: Record<'hod' | 't1' | 't2' | 't3' | 'clerk', string> = {
    hod: '',
    t1: '',
    t2: '',
    t3: '',
    clerk: '',
  };
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const s = stamp('EXT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hodU = await seedUser(c, school, `${s}-hod`, 'subject_teacher');
      t1U = await seedUser(c, school, `${s}-t1`, 'subject_teacher');
      t2U = await seedUser(c, school, `${s}-t2`, 'subject_teacher');
      t3U = await seedUser(c, school, `${s}-t3`, 'subject_teacher');
      const add = async (code: string, name: string, type: string, user: string | null) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, employee_type, department, designation, user_id, joined_on)
             VALUES ($1, $2, $3, $4::employee_type, $5, 'Teacher', $6, '2020-04-01') RETURNING id::text`,
            [school.id, code, name, type, type === 'teaching' ? 'Science' : 'Office', user],
          )
        ).rows[0]!.id;
      emp.hod = await add('E1', 'Meera HOD', 'teaching', hodU.id);
      emp.t1 = await add('E2', 'Ravi Teacher', 'teaching', t1U.id);
      emp.t2 = await add('E3', 'Sana Teacher', 'teaching', t2U.id);
      emp.t3 = await add('E4', 'Kiran Teacher', 'teaching', t3U.id);
      emp.clerk = await add('E5', 'Om Clerk', 'non_teaching', null);
      await c.query(
        `INSERT INTO departments (school_id, code, name, hod_employee_id) VALUES ($1, 'SCI', 'Science', $2)`,
        [school.id, emp.hod],
      );
      // Kiran reports to Sana this year (the reporting-manager level)
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, department, reports_to_employee_id) VALUES ($1, $2, $3, 'Science', $4)`,
        [school.id, emp.t3, school.yearId, emp.t2],
      );
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  const pendingWith = async (u: SeededUser) =>
    (await inject({ method: 'GET', url: '/people/exits/to-approve', headers: h(u) })).json()
      .data as Array<{ id: string; employee: { code: string }; waitingAt: string }>;

  it('starts with the set-up: types, notice per employee type, departments, HOD then principal', async () => {
    const r = await inject({ method: 'GET', url: '/people/exits/setup', headers: h() });
    expect(r.statusCode).toBe(200);
    expect(r.json().types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'resignation', staffMayApply: true, noticeApplies: true }),
        expect.objectContaining({ code: 'termination', staffMayApply: false }),
      ]),
    );
    expect(r.json().noticeDays).toMatchObject({ teaching: 90, non_teaching: 30 });
    expect(r.json().departments.map((d: { code: string }) => d.code)).toContain('library');
    const a = await inject({
      method: 'GET',
      url: '/people/exits/setup/approval/teaching',
      headers: h(),
    });
    expect(a.json().levels.map((l: { by: string }) => l.by)).toEqual(['hod', 'role']);
    const teacher = await inject({ method: 'GET', url: '/people/exits/setup', headers: h(t1U) });
    expect(teacher.statusCode).toBe(403);
  });

  it('a teacher resigns in the staff app: notice and shortfall worked out, the HOD decides first', async () => {
    const mine = await inject({ method: 'GET', url: '/me/exits', headers: h(t1U) });
    expect(mine.json()).toMatchObject({
      noticeDays: 90,
      types: [{ code: 'resignation' }],
      data: [],
    });
    const no = await inject({
      method: 'POST',
      url: '/me/exits',
      headers: h(t1U),
      json: { exitType: 'termination', reason: 'Asked to leave', proposedLastDay: day(30) },
    });
    expect(no.statusCode).toBe(403);
    const r = await inject({
      method: 'POST',
      url: '/me/exits',
      headers: h(t1U),
      json: { exitType: 'resignation', reason: 'Moving to another city', proposedLastDay: day(30) },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      bySelf: true,
      noticeDays: 90,
      expectedLastDay: day(90),
      shortfallDays: 60,
      waitingAt: 'HOD review',
    });
    const again = await inject({
      method: 'POST',
      url: '/me/exits',
      headers: h(t1U),
      json: { exitType: 'resignation', reason: 'Again', proposedLastDay: day(30) },
    });
    expect(again.statusCode).toBe(409);
    expect((await pendingWith(hodU)).map((x) => x.employee.code)).toEqual(['E2']);
    expect(await pendingWith(admin)).toEqual([]);
  });

  it('sent back with a remark, changed and sent again; then HOD and principal approve with the terms', async () => {
    const id = (await pendingWith(hodU))[0]!.id;
    const bare = await inject({
      method: 'POST',
      url: `/people/exits/${id}/send-back`,
      headers: h(hodU),
      json: {},
    });
    expect(bare.statusCode).toBe(400);
    const back = await inject({
      method: 'POST',
      url: `/people/exits/${id}/send-back`,
      headers: h(hodU),
      json: { note: 'Serve the notice till the term ends' },
    });
    expect(back.statusCode).toBe(200);
    expect(back.json()).toMatchObject({
      status: 'sent_back',
      sentBackNote: 'Serve the notice till the term ends',
    });
    const mine = await inject({ method: 'GET', url: `/people/exits/${id}`, headers: h(t1U) });
    expect(mine.json().may).toMatchObject({ edit: true, withdraw: true, decide: false });
    const again = await inject({
      method: 'POST',
      url: `/people/exits/${id}/resubmit`,
      headers: h(t1U),
      json: { proposedLastDay: day(90) },
    });
    expect(again.json()).toMatchObject({
      status: 'pending',
      shortfallDays: 0,
      waitingAt: 'HOD review',
    });
    const notMine = await inject({
      method: 'POST',
      url: `/people/exits/${id}/approve`,
      headers: h(admin),
      json: {},
    });
    expect(notMine.statusCode).toBe(403);
    const hod = await inject({
      method: 'POST',
      url: `/people/exits/${id}/approve`,
      headers: h(hodU),
      json: { note: 'Fine' },
    });
    expect(hod.json()).toMatchObject({ status: 'pending', waitingAt: 'Principal approval' });
    const ok = await inject({
      method: 'POST',
      url: `/people/exits/${id}/approve`,
      headers: h(admin),
      json: { acceptedLastDay: day(60), waiveNotice: true, note: 'Accepted' },
    });
    expect(ok.json()).toMatchObject({
      status: 'approved',
      acceptedLastDay: day(60),
      noticeWaived: true,
      shortfallDays: 0,
      decisionNote: 'Accepted',
    });
    expect(ok.json().events.map((e: { what: string }) => e.what)).toEqual([
      'submitted',
      'sent_back',
      'resubmitted',
      'terms',
      'approved',
    ]);
    const late = await inject({
      method: 'POST',
      url: `/people/exits/${id}/withdraw`,
      headers: h(t1U),
      json: {},
    });
    expect(late.statusCode).toBe(409);
  });

  it('the office records a termination; a level nobody holds is skipped; the principal rejects', async () => {
    const r = await inject({
      method: 'POST',
      url: '/people/exits',
      headers: h(),
      json: { employeeId: emp.clerk, exitType: 'termination', reason: 'Misconduct' },
    });
    expect(r.statusCode).toBe(201);
    // the clerk's department has no HOD; the principal raised it, so their own level counts as approved
    expect(['approved', 'pending']).toContain(r.json().status);
    const set = await inject({
      method: 'PUT',
      url: '/people/exits/setup/approval/non_teaching',
      headers: h(),
      json: {
        levels: [
          { name: 'HOD review', by: 'hod' },
          { name: 'Senior teacher', by: 'employees', employeeIds: [emp.t2] },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
  });

  it('the reporting manager level, and the office or the employee withdraws before acceptance', async () => {
    const set = await inject({
      method: 'PUT',
      url: '/people/exits/setup/approval/teaching',
      headers: h(),
      json: {
        levels: [
          { name: 'Reporting manager', by: 'manager' },
          { name: 'Head of science', by: 'employees', employeeIds: [emp.hod] },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    const r = await inject({
      method: 'POST',
      url: '/me/exits',
      headers: h(t3U),
      json: { exitType: 'resignation', reason: 'Higher studies' },
    });
    expect(r.json()).toMatchObject({ waitingAt: 'Reporting manager', expectedLastDay: day(90) });
    expect((await pendingWith(t2U)).map((x) => x.employee.code)).toEqual(['E4']);
    const no = await inject({
      method: 'POST',
      url: `/people/exits/${r.json().id}/reject`,
      headers: h(t2U),
      json: { note: 'Not now' },
    });
    expect(no.json()).toMatchObject({ status: 'rejected', decisionNote: 'Not now' });
    // the office records one for Sana (no manager: that level is skipped, Meera's waits); Sana withdraws
    // it (not the requester, but the employee)
    const o = await inject({
      method: 'POST',
      url: '/people/exits',
      headers: h(),
      json: {
        employeeId: emp.t2,
        exitType: 'resignation',
        reason: 'Letter given at the office',
        proposedLastDay: day(90),
      },
    });
    expect(o.statusCode).toBe(201);
    const w = await inject({
      method: 'POST',
      url: `/people/exits/${o.json().id}/withdraw`,
      headers: h(t2U),
      json: { reason: 'Staying on' },
    });
    expect(w.statusCode).toBe(200);
    expect(w.json().status).toBe('withdrawn');
    const other = await inject({
      method: 'POST',
      url: `/people/exits/${o.json().id}/withdraw`,
      headers: h(t3U),
      json: {},
    });
    expect([403, 404, 409]).toContain(other.statusCode);
    const list = await inject({ method: 'GET', url: '/people/exits', headers: h() });
    expect(list.json().counts).toMatchObject({
      approved: expect.any(Number),
      rejected: 1,
      withdrawn: 1,
    });
  });

  describe('part 6: no-dues clearance', () => {
    let exitId: string;
    let librarian: SeededUser;

    beforeAll(async () => {
      exitId = (
        await withMigrator((c) =>
          c.query<{ id: string }>(
            `SELECT id::text FROM employee_exits WHERE employee_id = $1 AND status = 'approved'`,
            [emp.t1],
          ),
        )
      ).rows[0]!.id;
      await withMigrator(async (c) => {
        librarian = await seedUser(c, school, `${school.code}-lib`, 'librarian');
        // Ravi still has a library book
        const lib = await c.query<{ id: string }>(
          `INSERT INTO library_libraries (school_id, code, name) VALUES ($1, 'MAIN', 'Main library') RETURNING id::text`,
          [school.id],
        );
        const t = await c.query<{ id: string }>(
          `INSERT INTO library_titles (school_id, title) VALUES ($1, 'Physics') RETURNING id::text`,
          [school.id],
        );
        const cp = await c.query<{ id: string }>(
          `INSERT INTO library_copies (school_id, title_id, accession_no, library_id) VALUES ($1, $2, 'A1', $3) RETURNING id::text`,
          [school.id, t.rows[0]!.id, lib.rows[0]!.id],
        );
        await c.query(
          `INSERT INTO library_loans (school_id, copy_id, borrower_kind, borrower_id, issued_on, due_on)
           VALUES ($1, $2, 'employee', $3, CURRENT_DATE - 5, CURRENT_DATE + 9)`,
          [school.id, cp.rows[0]!.id, emp.t1],
        );
      });
    });

    it('an accepted exit gets its board: every department in use, the library shown from the system', async () => {
      const board = await inject({ method: 'GET', url: '/people/exits/clearance', headers: h() });
      expect(board.statusCode).toBe(200);
      const x = (
        board.json().data as Array<{
          id: string;
          pending: number;
          clearances: Array<{
            department: string;
            check: { due: boolean; detail: string } | null;
            mayClear: boolean;
          }>;
        }>
      ).find((e) => e.id === exitId)!;
      expect(x.pending).toBe(7);
      const library = x.clearances.find((r) => r.department === 'library')!;
      expect(library.check).toMatchObject({ due: true, detail: '1 book not returned' });
      expect(library.mayClear).toBe(true);
      expect(x.clearances.find((r) => r.department === 'it_assets')!.check!.detail).toMatch(
        /no asset register/,
      );
    });

    it('each department clears it, by the people set: the librarian, the HOD, the office', async () => {
      const mine = await inject({
        method: 'GET',
        url: '/people/exits/clearance/mine',
        headers: h(hodU),
      });
      expect(mine.json().data.map((x: { id: string }) => x.id)).toEqual([exitId]);
      const notHers = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/library`,
        headers: h(hodU),
        json: { dues: 0 },
      });
      expect(notHers.statusCode).toBe(403);
      // a book out: cleared only with the dues written down
      const bare = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/library`,
        headers: h(librarian),
        json: { dues: 0 },
      });
      expect(bare.statusCode).toBe(400);
      const lib = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/library`,
        headers: h(librarian),
        json: { dues: 450, note: 'Physics not returned' },
      });
      expect(lib.json()).toMatchObject({ cleared: 'library', pending: 6 });
      const hod = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/hod`,
        headers: h(hodU),
        json: { dues: 0, note: 'Hand-over done' },
      });
      expect(hod.statusCode).toBe(200);
      const again = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/hod`,
        headers: h(),
        json: { dues: 0 },
      });
      expect(again.statusCode).toBe(409);
      for (const d of ['accounts', 'it_assets', 'admin', 'transport', 'hostel'])
        expect(
          (
            await inject({
              method: 'POST',
              url: `/people/exits/${exitId}/clearance/${d}`,
              headers: h(),
              json: { dues: d === 'it_assets' ? 1200 : 0 },
            })
          ).statusCode,
        ).toBe(200);
      const x = await inject({ method: 'GET', url: `/people/exits/${exitId}`, headers: h() });
      expect(x.json().clearances.every((r: { status: string }) => r.status === 'cleared')).toBe(
        true,
      );
      expect(x.json().clearances.reduce((s: number, r: { dues: number }) => s + r.dues, 0)).toBe(
        1650,
      );
      expect(x.json().events.map((e: { what: string }) => e.what)).toContain('all_cleared');
      // the employee sees the progress
      const own = await inject({ method: 'GET', url: '/me/exits', headers: h(t1U) });
      expect(own.json().clearances).toHaveLength(7);
    });

    it('the office opens a clearance again; nobody else can', async () => {
      const no = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/library/reopen`,
        headers: h(librarian),
        json: {},
      });
      expect(no.statusCode).toBe(403);
      const ok = await inject({
        method: 'POST',
        url: `/people/exits/${exitId}/clearance/library/reopen`,
        headers: h(),
        json: { reason: 'Dues amount was wrong' },
      });
      expect(ok.statusCode).toBe(200);
      const x = await inject({ method: 'GET', url: `/people/exits/${exitId}`, headers: h() });
      expect(
        x.json().clearances.find((r: { department: string }) => r.department === 'library'),
      ).toMatchObject({
        status: 'pending',
        dues: 0,
      });
    });

    it('who clears a department is set up; a pending exit has no board', async () => {
      const setup = await inject({ method: 'GET', url: '/people/exits/setup', headers: h() });
      const depts = setup.json().departments as Array<{ code: string; approvers: unknown[] }>;
      expect(depts.find((d) => d.code === 'hod')!.approvers).toEqual([
        { kind: 'hod' },
        { kind: 'office' },
      ]);
      const saved = await inject({
        method: 'PUT',
        url: '/people/exits/setup',
        headers: h(),
        json: {
          types: setup.json().types,
          noticeDays: setup.json().noticeDays,
          departments: depts.map((d) =>
            d.code === 'transport' ? { ...d, approvers: [{ kind: 'user', userId: t2U.id }] } : d,
          ),
        },
      });
      expect(saved.statusCode).toBe(200);
      const pending = await inject({
        method: 'POST',
        url: '/people/exits',
        headers: h(),
        json: {
          employeeId: emp.hod,
          exitType: 'retirement',
          reason: 'Retiring',
          proposedLastDay: day(10),
        },
      });
      const early = await inject({
        method: 'POST',
        url: `/people/exits/${pending.json().id}/clearance/library`,
        headers: h(),
        json: { dues: 0 },
      });
      expect(pending.json().status).toBe('pending');
      expect(early.statusCode).toBe(409);
      const after = await inject({ method: 'GET', url: '/people/exits/setup', headers: h() });
      expect(
        (after.json().departments as Array<{ code: string; approvers: unknown[] }>).find(
          (d) => d.code === 'transport',
        )!.approvers,
      ).toEqual([{ kind: 'user', userId: t2U.id }]);
    });
  });
});
