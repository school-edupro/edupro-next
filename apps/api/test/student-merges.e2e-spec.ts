/**
 * Merge duplicates (docs/design/37, part 3): the same child admitted twice; once approved every record
 * of the duplicate moves to the record kept, clashes keep the kept record's, the duplicate is closed
 * and its admission number retired but still finding the pupil.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MERGE_RULES } from '../src/modules/people/merge-rules';
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

describe('student merges (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coord: SeededUser;
  let teacher: SeededUser;
  let keep: string;
  let dup: string;
  let third: string;
  let secA: string;
  let secB: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const total = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/demands`, headers: h() })).json()
      .total as { net: string; paid: string };

  beforeAll(async () => {
    const s = stamp('SMG');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coord = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
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
    const sec = async (name: string) =>
      (
        await inject({
          method: 'POST',
          url: `/academics/classes/${cls}/sections`,
          headers: h(),
          json: { name },
        })
      ).json().id as string;
    secA = await sec('A');
    secB = await sec('B');
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
    // the same child admitted twice (A and B), and another pupil
    const add = async (adm: string, section: string, paid: number) => {
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: 'Riya',
          lastName: 'Sharma',
          dob: '2014-05-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: section, rollNo: Number(adm.slice(-1)) },
        },
      });
      expect(st.statusCode).toBe(201);
      const id = st.json().id as string;
      await inject({ method: 'POST', url: `/fees/students/${id}/demands/generate`, headers: h() });
      if (paid)
        expect(
          (
            await inject({
              method: 'POST',
              url: '/payments/offline',
              headers: h(),
              json: { studentId: id, amount: paid, mode: 'cash', receivedOn: '2026-04-06' },
            })
          ).statusCode,
        ).toBe(201);
      return id;
    };
    keep = await add('SM1', secA, 3000);
    dup = await add('SM2', secB, 2000);
    third = await add('SM3', secA, 0);
    // the father on both (one parent record, the same mobile); a mother only on the duplicate
    const link = (id: string, relation: string, firstName: string, mobile: string) =>
      inject({
        method: 'POST',
        url: `/people/students/${id}/guardians`,
        headers: h(),
        json: {
          guardian: { firstName, lastName: 'Sharma', mobile },
          relation,
          isPrimary: relation === 'father',
        },
      });
    expect((await link(keep, 'father', 'Anil', '9811000001')).statusCode).toBe(201);
    expect((await link(dup, 'father', 'Anil', '9811000001')).statusCode).toBe(201);
    expect((await link(dup, 'mother', 'Sunita', '9811000002')).statusCode).toBe(201);
    // attendance: both marked on 1 Jul (in their own sections), the duplicate also on 2 Jul
    await withMigrator(async (c) => {
      const y = await c.query<{ id: string }>(
        `SELECT academic_year_id::text AS id FROM class_sections WHERE id = $1`,
        [secA],
      );
      const session = async (section: string, on: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date) VALUES ($1, $2, $3, $4) RETURNING id::text`,
            [school.id, y.rows[0]!.id, section, on],
          )
        ).rows[0]!.id;
      const mark = (sid: string, student: string, code: string) =>
        c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code) VALUES ($1, $2, $3, $4::attendance_code)`,
          [school.id, sid, student, code],
        );
      await mark(await session(secA, '2026-07-01'), keep, 'P');
      const b1 = await session(secB, '2026-07-01');
      await mark(b1, dup, 'A');
      await mark(await session(secB, '2026-07-02'), dup, 'P');
    });
  });
  afterAll(async () => app.close());

  it('has a rule for every table that points at a student', async () => {
    const fks = await withMigrator(async (c) => {
      const r = await c.query<{ t: string; col: string }>(
        `SELECT cl.relname AS t, a.attname AS col
           FROM pg_constraint con JOIN pg_class cl ON cl.oid = con.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace
           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
          WHERE con.contype = 'f' AND con.confrelid = 'public.students'::regclass AND n.nspname = 'public'`,
      );
      return r.rows.map((x) => `${x.t}.${x.col}`);
    });
    const covered = new Set(MERGE_RULES.map((r) => `${r.table}.${r.col}`));
    expect(fks.filter((k) => !covered.has(k))).toEqual([]);
  });

  it('previews the merge: what moves, what clashes, the fee after; nothing saved', async () => {
    const no = await inject({
      method: 'POST',
      url: '/people/student-merges/preview',
      headers: h(teacher),
      json: { keepId: keep, duplicateId: dup },
    });
    expect(no.statusCode).toBe(403);
    const p = await inject({
      method: 'POST',
      url: '/people/student-merges/preview',
      headers: h(coord),
      json: { keepId: keep, duplicateId: dup },
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().blockers).toEqual([]);
    const o = p.json().outcome;
    expect(o.keep).toMatchObject({ admissionNo: 'SM1', classSection: 'Class VI A', due: 9000 });
    expect(o.duplicate).toMatchObject({ admissionNo: 'SM2', due: 10000, father: 'Anil Sharma' });
    expect(o.fee).toMatchObject({
      receipts: 1,
      freed: 2000,
      setAgainst: 2000,
      advance: 0,
      dueAfter: 7000,
    });
    const clash = (area: string) =>
      (o.clashes as Array<{ area: string; count: number }>)
        .filter((x) => x.area === area)
        .reduce((s, x) => s + x.count, 0);
    expect(clash('fees')).toBe(12);
    expect(clash('class')).toBe(1);
    expect(clash('attendance')).toBe(1);
    expect(clash('guardians')).toBe(1);
    const moved = (area: string) =>
      (o.moved as Array<{ area: string; count: number }>).find((x) => x.area === area)?.count ?? 0;
    expect(moved('attendance')).toBe(1);
    expect(moved('guardians')).toBe(1);
    // nothing changed
    expect(await total(dup)).toMatchObject({ net: '12000.00', paid: '2000.00' });
    expect(
      (await inject({ method: 'GET', url: `/people/students/${dup}`, headers: h() })).statusCode,
    ).toBe(200);
  });

  it('refuses while the duplicate has a request waiting, and the same record twice', async () => {
    const corr = await inject({
      method: 'POST',
      url: `/people/students/${third}/corrections`,
      headers: h(coord),
      json: { values: { dob: '02-05-2014' }, reason: 'Certificate' },
    });
    expect(corr.statusCode).toBe(201);
    const p = await inject({
      method: 'POST',
      url: '/people/student-merges/preview',
      headers: h(),
      json: { keepId: keep, duplicateId: third },
    });
    expect(p.json().blockers).toEqual([
      'The duplicate has a detail correction waiting for approval',
    ]);
    const r = await inject({
      method: 'POST',
      url: '/people/student-merges',
      headers: h(),
      json: { keepId: keep, duplicateId: third, reason: 'Same child' },
    });
    expect(r.statusCode).toBe(409);
    await inject({
      method: 'POST',
      url: `/people/students/${third}/corrections/${corr.json().id}/withdraw`,
      headers: h(coord),
      json: {},
    });
    const self = await inject({
      method: 'POST',
      url: '/people/student-merges/preview',
      headers: h(),
      json: { keepId: keep, duplicateId: keep },
    });
    expect(self.json().blockers).toEqual(['Choose two different records']);
  });

  it('merges when approved: records moved, the duplicate closed, its number retired and still found', async () => {
    const r = await inject({
      method: 'POST',
      url: '/people/student-merges',
      headers: h(coord),
      json: { keepId: keep, duplicateId: dup, reason: 'Admitted twice by two desks' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      status: 'pending',
      mine: true,
      waitingAt: 'Principal approval',
    });
    // the duplicate is not in another merge meanwhile
    const again = await inject({
      method: 'POST',
      url: '/people/student-merges',
      headers: h(coord),
      json: { keepId: third, duplicateId: dup, reason: 'Twice' },
    });
    expect(again.statusCode).toBe(409);
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'student_merge')!;
    expect(
      (
        await inject({
          method: 'POST',
          url: `/workflow/steps/${step.id}/approve`,
          headers: h(),
          json: { note: 'Same child, same parents' },
        })
      ).statusCode,
    ).toBe(201);

    expect(await total(keep)).toMatchObject({ net: '12000.00', paid: '5000.00' });
    expect(
      (await inject({ method: 'GET', url: `/people/students/${dup}`, headers: h() })).statusCode,
    ).toBe(404);
    const m = await inject({ method: 'GET', url: `/people/students/${dup}/merges`, headers: h() });
    expect(m.json().mergedInto).toMatchObject({ id: keep, admissionNo: 'SM1' });
    expect(m.json().data[0]).toMatchObject({
      status: 'applied',
      note: 'Same child, same parents',
      result: { fee: { dueAfter: 7000 } },
    });
    // the old number finds the kept pupil and is never given again
    const found = await inject({ method: 'GET', url: '/people/students?q=SM2', headers: h() });
    expect(found.json().data.map((x: { id: string }) => x.id)).toEqual([keep]);
    const reuse = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: { admissionNo: 'SM2', firstName: 'New', dob: '2014-01-01' },
    });
    expect(reuse.statusCode).toBe(409);
    const facts = await withMigrator(async (c) => {
      const g = await c.query<{ relation: string; primary: boolean }>(
        `SELECT relation, is_primary AS primary FROM student_guardians WHERE student_id = $1 ORDER BY relation`,
        [keep],
      );
      const a = await c.query<{ on_date: string; code: string }>(
        `SELECT s.on_date::text, m.code::text FROM attendance_marks m JOIN attendance_sessions s ON s.id = m.session_id
          WHERE m.student_id = $1 ORDER BY 1`,
        [keep],
      );
      const e = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM enrolments WHERE student_id = ANY($1::bigint[])`,
        [[keep, dup]],
      );
      return { g: g.rows, a: a.rows, e: e.rows[0]!.n };
    });
    expect(facts.g).toEqual([
      { relation: 'father', primary: true },
      { relation: 'mother', primary: false },
    ]);
    // the kept record's mark of 1 July stays; 2 July comes over
    expect(facts.a).toEqual([
      { on_date: '2026-07-01', code: 'P' },
      { on_date: '2026-07-02', code: 'P' },
    ]);
    expect(facts.e).toBe(1);
    // a merged record cannot be merged again
    const twice = await inject({
      method: 'POST',
      url: '/people/student-merges/preview',
      headers: h(),
      json: { keepId: third, duplicateId: dup },
    });
    expect(twice.json().blockers[0]).toMatch(/already merged/);
  });

  it('a rejected or withdrawn merge leaves both records', async () => {
    const r = await inject({
      method: 'POST',
      url: '/people/student-merges',
      headers: h(coord),
      json: { keepId: keep, duplicateId: third, reason: 'Looks the same' },
    });
    expect(r.statusCode).toBe(201);
    const back = await inject({
      method: 'POST',
      url: `/people/student-merges/${r.json().id}/withdraw`,
      headers: h(coord),
      json: {},
    });
    expect(back.json().status).toBe('withdrawn');
    await inject({
      method: 'POST',
      url: '/people/student-merges',
      headers: h(coord),
      json: { keepId: keep, duplicateId: third, reason: 'Looks the same' },
    });
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    const step = (
      inbox.json().data as Array<{ id: string; instance: { entityType: string } }>
    ).find((x) => x.instance.entityType === 'student_merge')!;
    await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/reject`,
      headers: h(),
      json: { note: 'Twins, not the same child' },
    });
    expect(
      (await inject({ method: 'GET', url: `/people/students/${third}`, headers: h() })).statusCode,
    ).toBe(200);
    const list = await inject({
      method: 'GET',
      url: `/people/students/${third}/merges`,
      headers: h(),
    });
    expect(list.json().data.map((x: { status: string }) => x.status)).toEqual([
      'rejected',
      'withdrawn',
    ]);
  });
});
