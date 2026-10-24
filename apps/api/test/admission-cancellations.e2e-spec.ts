/**
 * Admitted by mistake (docs/design/37, part 4): cancel the admission with the money refunded or kept,
 * once the approval levels approve; the enrolment ends as "cancelled", logins stop.
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

describe('admission cancellations (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coord: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let sixA: string;
  const pupils: Record<'refund' | 'retain' | 'open' | 'stay', string> = {
    refund: '',
    retain: '',
    open: '',
    stay: '',
  };
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const total = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/demands`, headers: h() })).json()
      .total as { net: string; paid: string };
  const approveAll = async (note = 'Approved') => {
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'admission_cancellation')!;
    return inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(),
      json: { note },
    });
  };
  const facts = (id: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ enrolment: string; student: string; w: string | null }>(
        `SELECT (SELECT status::text FROM enrolments WHERE student_id = $1 ORDER BY id DESC LIMIT 1) AS enrolment,
                (SELECT status::text FROM students WHERE id = $1) AS student,
                (SELECT id::text FROM student_withdrawals WHERE student_id = $1 AND kind = 'admission_cancelled' LIMIT 1) AS w`,
        [id],
      );
      return r.rows[0]!;
    });

  beforeAll(async () => {
    const s = stamp('ACN');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coord = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const cls = (
      await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
      })
    ).json().id as string;
    sixA = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    const tui = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition', sortOrder: 1 },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    await inject({
      method: 'PUT',
      url: '/fees/grids/structure',
      headers: h(),
      json: { classId: cls, rows: [{ headId: tui.json().id, amounts: Array(12).fill(1000) }] },
    });
    for (const [k, adm, paid] of [
      ['refund', 'AC1', 3000],
      ['retain', 'AC2', 2000],
      ['open', 'AC3', 0],
      ['stay', 'AC4', 0],
    ] as const) {
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: `Pupil ${adm}`,
          dob: '2014-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sixA, rollNo: Number(adm.slice(2)) },
        },
      });
      expect(st.statusCode).toBe(201);
      pupils[k] = st.json().id;
      await inject({
        method: 'POST',
        url: `/fees/students/${pupils[k]}/demands/generate`,
        headers: h(),
      });
      if (paid)
        expect(
          (
            await inject({
              method: 'POST',
              url: '/payments/offline',
              headers: h(),
              json: { studentId: pupils[k], amount: paid, mode: 'cash', receivedOn: '2026-04-06' },
            })
          ).statusCode,
        ).toBe(201);
    }
    // one parent signed in for the refund pupil only; the retain pupil's parent also has AC4 here
    const link = (id: string, firstName: string, mobile: string) =>
      inject({
        method: 'POST',
        url: `/people/students/${id}/guardians`,
        headers: h(),
        json: { guardian: { firstName, mobile }, relation: 'father', isPrimary: true },
      });
    const g = await link(pupils.refund, 'Ravi', '9811000011');
    expect(g.statusCode).toBe(201);
    await link(pupils.retain, 'Mohan', '9811000012');
    await link(pupils.stay, 'Mohan', '9811000012');
    await withMigrator((c) =>
      c.query(
        `UPDATE guardians SET user_id = $1 WHERE id = (SELECT sg.guardian_id FROM student_guardians sg WHERE sg.student_id = $2 LIMIT 1)`,
        [parent.id, pupils.refund],
      ),
    );
  });
  afterAll(async () => app.close());

  it('previews the cancellation: fee cancelled, refunds, logins; nothing saved', async () => {
    const no = await inject({
      method: 'POST',
      url: `/people/students/${pupils.refund}/admission-cancellations/preview`,
      headers: h(teacher),
      json: { settlement: 'refund' },
    });
    expect(no.statusCode).toBe(403);
    const p = await inject({
      method: 'POST',
      url: `/people/students/${pupils.refund}/admission-cancellations/preview`,
      headers: h(coord),
      json: { settlement: 'refund' },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      student: { admissionNo: 'AC1', classSection: 'Class VI A' },
      settlement: 'refund',
      fee: {
        before: { charged: 12000, paid: 3000, due: 9000 },
        after: { charged: 3000, paid: 3000, due: 0 },
        cancelled: 9000,
        refunds: 1,
        refundTotal: 3000,
        retained: 0,
      },
      admissionFee: null,
      logins: { student: false, parents: 1 },
    });
    const keep = await inject({
      method: 'POST',
      url: `/people/students/${pupils.retain}/admission-cancellations/preview`,
      headers: h(coord),
      json: { settlement: 'retain' },
    });
    expect(keep.json().fee).toMatchObject({
      after: { charged: 2000, paid: 2000, due: 0 },
      refunds: 0,
      retained: 2000,
    });
    // the parent of AC2 has another child here (AC4): the login stays
    expect(keep.json().logins).toEqual({ student: false, parents: 0 });
    expect(await facts(pupils.refund)).toMatchObject({
      enrolment: 'active',
      student: 'active',
      w: null,
    });
    expect(await total(pupils.refund)).toMatchObject({ net: '12000.00' });
  });

  it('refuses while a withdrawal is in progress', async () => {
    const w = await inject({
      method: 'POST',
      url: `/people/students/${pupils.open}/withdrawal`,
      headers: h(),
      json: { leavingOn: '2026-10-31', reason: 'Moving town' },
    });
    expect(w.statusCode).toBe(201);
    const p = await inject({
      method: 'POST',
      url: `/people/students/${pupils.open}/admission-cancellations/preview`,
      headers: h(),
      json: { settlement: 'refund' },
    });
    expect(p.statusCode).toBe(409);
    expect(p.json().detail).toMatch(/withdrawal/);
  });

  it('cancels when approved: fee settled, enrolment cancelled, logins stopped, no revoke or TC', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${pupils.refund}/admission-cancellations`,
      headers: h(coord),
      json: { settlement: 'refund', reason: 'Admitted by mistake: seat was not available' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      mine: true,
      waitingAt: 'Principal approval',
    });
    expect(await facts(pupils.refund)).toMatchObject({ enrolment: 'active' });
    expect((await approveAll('Refund approved')).statusCode).toBe(201);
    const f = await facts(pupils.refund);
    expect(f).toMatchObject({ enrolment: 'cancelled', student: 'inactive' });
    expect(f.w).toBeTruthy();
    expect(await total(pupils.refund)).toMatchObject({ net: '3000.00', paid: '3000.00' });
    const extra = await withMigrator(async (c) => {
      const rf = await c.query<{ status: string; amount: string; fee_action: string }>(
        `SELECT status::text, amount::text, fee_action FROM fee_refunds WHERE withdrawal_id = $1`,
        [f.w],
      );
      const m = await c.query<{ status: string }>(
        `SELECT status::text FROM user_school_memberships WHERE user_id = $1 AND person_type = 'guardian'`,
        [parent.id],
      );
      return { refunds: rf.rows, login: m.rows[0]?.status };
    });
    expect(extra.refunds).toEqual([
      { status: 'requested', amount: '3000.00', fee_action: 'cancel' },
    ]);
    expect(extra.login).toBe('inactive');
    const list = await inject({
      method: 'GET',
      url: `/people/students/${pupils.refund}/admission-cancellations`,
      headers: h(),
    });
    expect(list.json().data[0]).toMatchObject({
      status: 'applied',
      note: 'Refund approved',
      result: { fee: { refundTotal: 3000 } },
    });
    // left out of the class's strength
    const strength = await inject({
      method: 'GET',
      url: '/people/dashboard/students',
      headers: h(),
    });
    expect(strength.json().strength.total).toBe(3);
    const revoke = await inject({
      method: 'POST',
      url: `/people/withdrawals/${f.w}/revoke`,
      headers: h(),
      json: { reason: 'Undo' },
    });
    expect(revoke.statusCode).toBe(409);
    expect(revoke.json().type).toMatch(/admission_cancelled/);
    const tc = await inject({
      method: 'POST',
      url: `/people/withdrawals/${f.w}/tc`,
      headers: h(),
      json: {},
    });
    expect(tc.statusCode).toBe(409);
    expect(tc.json().type).toMatch(/admission_cancelled/);
    const again = await inject({
      method: 'POST',
      url: `/people/students/${pupils.refund}/admission-cancellations/preview`,
      headers: h(),
      json: { settlement: 'refund' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('keeps the money when the school decides so; a rejected or withdrawn request changes nothing', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${pupils.retain}/admission-cancellations`,
      headers: h(coord),
      json: { settlement: 'retain', reason: 'Wrong admission' },
    });
    const back = await inject({
      method: 'POST',
      url: `/people/students/${pupils.retain}/admission-cancellations/${r.json().id}/withdraw`,
      headers: h(coord),
      json: {},
    });
    expect(back.json().status).toBe('withdrawn');
    await inject({
      method: 'POST',
      url: `/people/students/${pupils.retain}/admission-cancellations`,
      headers: h(coord),
      json: { settlement: 'retain', reason: 'Wrong admission' },
    });
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'admission_cancellation')!;
    await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/reject`,
      headers: h(),
      json: { note: 'Keep the pupil' },
    });
    expect(await facts(pupils.retain)).toMatchObject({ enrolment: 'active', student: 'active' });
    await inject({
      method: 'POST',
      url: `/people/students/${pupils.retain}/admission-cancellations`,
      headers: h(coord),
      json: { settlement: 'retain', reason: 'Wrong admission after all' },
    });
    await approveAll();
    expect(await facts(pupils.retain)).toMatchObject({ enrolment: 'cancelled' });
    expect(await total(pupils.retain)).toMatchObject({ net: '2000.00', paid: '2000.00' });
    const refunds = await withMigrator(
      async (c) =>
        (
          await c.query(
            `SELECT 1 FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id WHERE p.student_id = $1`,
            [pupils.retain],
          )
        ).rowCount,
    );
    expect(refunds).toBe(0);
    const list = await inject({
      method: 'GET',
      url: `/people/students/${pupils.retain}/admission-cancellations`,
      headers: h(),
    });
    expect(list.json().data.map((x: { status: string }) => x.status)).toEqual([
      'applied',
      'rejected',
      'withdrawn',
    ]);
  });
});
