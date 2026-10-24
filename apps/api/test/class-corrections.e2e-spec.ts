/**
 * Wrong class (docs/design/37, part 2): the enrolment moves to the right class from a date once the
 * approval levels approve; fee lines are made again at the new class's rates, money paid is set against
 * the new dues and what is left stays as advance.
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

describe('class corrections (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coord: SeededUser;
  let teacher: SeededUser;
  let sixA: string;
  let sevenA: string;
  let sevenB: string;
  const students: Record<'part' | 'full' | 'late', string> = { part: '', full: '', late: '' };
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  const total = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/demands`, headers: h() })).json()
      .total as { net: string; paid: string };
  const sectionOf = async (id: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ s: string; roll: number }>(
        `SELECT class_section_id::text AS s, roll_no AS roll FROM enrolments WHERE student_id = $1 AND status = 'active'`,
        [id],
      );
      return r.rows[0]!;
    });
  const approveAll = async (note = 'Checked') => {
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'class_correction')!;
    return inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(),
      json: { note },
    });
  };

  beforeAll(async () => {
    const s = stamp('CCR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coord = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = async (code: string, order: number) =>
      (
        await inject({
          method: 'POST',
          url: '/academics/classes',
          headers: h(),
          json: { code, name: `Class ${code}`, displayOrder: order },
        })
      ).json().id as string;
    const sec = async (classId: string, name: string) =>
      (
        await inject({
          method: 'POST',
          url: `/academics/classes/${classId}/sections`,
          headers: h(),
          json: { name },
        })
      ).json().id as string;
    const six = await cls('VI', 6);
    const seven = await cls('VII', 7);
    sixA = await sec(six, 'A');
    sevenA = await sec(seven, 'A');
    sevenB = await sec(seven, 'B');
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
    for (const [classId, amount] of [
      [six, 1000],
      [seven, 1500],
    ] as const)
      await inject({
        method: 'PUT',
        url: '/fees/grids/structure',
        headers: h(),
        json: { classId, rows: [{ headId: tui.json().id, amounts: Array(12).fill(amount) }] },
      });
    // three pupils admitted to VII by mistake: one paid a quarter, one the whole year, one nothing
    for (const [k, adm, paid] of [
      ['part', 'CC1', 4500],
      ['full', 'CC2', 18000],
      ['late', 'CC3', 0],
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
          enrolment: { classSectionId: sevenA, rollNo: Number(adm.slice(2)) },
        },
      });
      expect(st.statusCode).toBe(201);
      students[k] = st.json().id;
      await inject({
        method: 'POST',
        url: `/fees/students/${students[k]}/demands/generate`,
        headers: h(),
      });
      if (paid) {
        const p = await inject({
          method: 'POST',
          url: '/payments/offline',
          headers: h(),
          json: { studentId: students[k], amount: paid, mode: 'cash', receivedOn: '2026-04-06' },
        });
        expect(p.statusCode).toBe(201);
      }
    }
  });
  afterAll(async () => app.close());

  it('previews the move: new roll number, the fee lines made again, money paid set against them; nothing saved', async () => {
    const setup = await inject({
      method: 'GET',
      url: '/people/students/class-corrections/setup',
      headers: h(coord),
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json().sections.map((x: { label: string }) => x.label)).toEqual([
      'Class VI A',
      'Class VII A',
      'Class VII B',
    ]);
    const p = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections/preview`,
      headers: h(coord),
      json: { toSectionId: sixA },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      from: { label: 'Class VII A' },
      to: { label: 'Class VI A' },
      rollNo: 1,
      fee: {
        before: { charged: 18000, paid: 4500, due: 13500 },
        after: { charged: 12000, paid: 4500, due: 7500 },
        freed: 4500,
        setAgainst: 4500,
        advance: 0,
        kept: [],
      },
    });
    expect(p.json().fee.lines).toHaveLength(12);
    expect(p.json().fee.lines[0]).toMatchObject({ head: 'Tuition', before: 1500, after: 1000 });
    // the preview changed nothing
    expect((await sectionOf(students.part)).s).toBe(sevenA);
    expect(await total(students.part)).toMatchObject({ net: '18000.00', paid: '4500.00' });
  });

  it('refuses a section of the same class, a date outside the year and those without the right', async () => {
    const same = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections/preview`,
      headers: h(),
      json: { toSectionId: sevenB },
    });
    expect(same.statusCode).toBe(409);
    expect(same.json().detail).toMatch(/Roll numbers and sections/);
    const outside = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections/preview`,
      headers: h(),
      json: { toSectionId: sixA, effectiveFrom: '2030-01-01' },
    });
    expect(outside.statusCode).toBe(400);
    const no = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections`,
      headers: h(teacher),
      json: { toSectionId: sixA, reason: 'Wrong class' },
    });
    expect(no.statusCode).toBe(403);
  });

  it('moves the pupil when approved: the enrolment, the fee lines and the payment follow', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections`,
      headers: h(coord),
      json: { toSectionId: sixA, reason: 'Admitted to VII by mistake; the form says VI' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      from: 'Class VII A',
      to: 'Class VI A',
      mine: true,
      waitingAt: 'Principal approval',
    });
    const again = await inject({
      method: 'POST',
      url: `/people/students/${students.part}/class-corrections`,
      headers: h(coord),
      json: { toSectionId: sixA, reason: 'Twice' },
    });
    expect(again.statusCode).toBe(409);
    // still in VII until it is approved
    expect((await sectionOf(students.part)).s).toBe(sevenA);
    expect((await approveAll()).statusCode).toBe(201);
    expect(await sectionOf(students.part)).toEqual({ s: sixA, roll: 1 });
    expect(await total(students.part)).toMatchObject({ net: '12000.00', paid: '4500.00' });
    const list = await inject({
      method: 'GET',
      url: `/people/students/${students.part}/class-corrections`,
      headers: h(),
    });
    expect(list.json().data[0]).toMatchObject({
      status: 'applied',
      note: 'Checked',
      result: { fee: { after: { due: 7500 }, advance: 0 } },
    });
  });

  it('money paid beyond the new class’s fee stays as advance on the receipt', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${students.full}/class-corrections`,
      headers: h(),
      json: { toSectionId: sixA, reason: 'Wrong class' },
    });
    expect(r.json().preview.fee).toMatchObject({
      after: { charged: 12000, paid: 12000, due: 0 },
      freed: 18000,
      setAgainst: 12000,
      advance: 6000,
    });
    await approveAll();
    expect(await total(students.full)).toMatchObject({ net: '12000.00', paid: '12000.00' });
    expect((await sectionOf(students.full)).roll).toBe(2);
    // the advance is on the receipt: allocated less than received
    const left = await withMigrator(async (c) => {
      const x = await c.query<{ left: string }>(
        `SELECT (p.amount - COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0))::text AS left
           FROM fee_payments p WHERE p.student_id = $1`,
        [students.full],
      );
      return x.rows[0]!.left;
    });
    expect(Number(left)).toBe(6000);
  });

  it('from a later date: the months before keep the old class’s fee', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${students.late}/class-corrections/preview`,
      headers: h(),
      json: { toSectionId: sixA, effectiveFrom: '2026-10-01' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().fee.after).toMatchObject({ charged: 6 * 1500 + 6 * 1000 });
    expect(r.json().fee.lines).toHaveLength(6);
  });

  it('a withdrawn or rejected request leaves the pupil where they are', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${students.late}/class-corrections`,
      headers: h(coord),
      json: { toSectionId: sixA, reason: 'Wrong class' },
    });
    const back = await inject({
      method: 'POST',
      url: `/people/students/${students.late}/class-corrections/${r.json().id}/withdraw`,
      headers: h(coord),
      json: {},
    });
    expect(back.statusCode).toBe(200);
    expect(back.json().status).toBe('withdrawn');
    await inject({
      method: 'POST',
      url: `/people/students/${students.late}/class-corrections`,
      headers: h(coord),
      json: { toSectionId: sixA, reason: 'Wrong class' },
    });
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'class_correction')!;
    await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/reject`,
      headers: h(),
      json: { note: 'VII is right' },
    });
    expect((await sectionOf(students.late)).s).toBe(sevenA);
    expect(await total(students.late)).toMatchObject({ net: '18000.00' });
    const list = await inject({
      method: 'GET',
      url: `/people/students/${students.late}/class-corrections`,
      headers: h(),
    });
    expect(list.json().data.map((x: { status: string }) => x.status)).toEqual([
      'rejected',
      'withdrawn',
    ]);
  });

  it('an approval that cannot be done now (the year closed meanwhile) leaves the record and says why', async () => {
    const r = await inject({
      method: 'POST',
      url: `/people/students/${students.late}/class-corrections`,
      headers: h(coord),
      json: { toSectionId: sixA, reason: 'Wrong class' },
    });
    expect(r.statusCode).toBe(201);
    const close = (status: string) =>
      withMigrator((c) =>
        c.query(
          `UPDATE academic_years SET status = $2 WHERE id = (SELECT academic_year_id FROM enrolments WHERE student_id = $1 LIMIT 1)`,
          [students.late, status],
        ),
      );
    await close('closed');
    try {
      expect((await approveAll()).statusCode).toBe(201);
    } finally {
      await close('active');
    }
    expect((await sectionOf(students.late)).s).toBe(sevenA);
    const list = await inject({
      method: 'GET',
      url: `/people/students/${students.late}/class-corrections`,
      headers: h(),
    });
    expect(list.json().data[0]).toMatchObject({ status: 'rejected' });
    expect(list.json().data[0].applyError).toMatch(/^Not applied/);
  });
});
