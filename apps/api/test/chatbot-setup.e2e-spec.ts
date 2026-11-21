/**
 * Assistant set-up (docs/design/91, phase C; 0410): the defaults; the chat's start screen (on, consent, starters,
 * recent questions, today's count); an audience switched off; topics switched off per audience; the daily limit; the
 * school's own starters (checked against the audience's questions); who may change the set-up.
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

type Aud = 'student' | 'parent' | 'teacher' | 'admin';
interface Settings {
  audiences: Record<Aud, boolean>;
  dailyLimit: number;
  topicsOff: Record<Aud, string[]>;
  starters: Record<Aud, string[]>;
  topics: Array<{ key: string; label: string }>;
  catalogue: Record<Aud, Array<{ id: string; department: string; ask: string }>>;
}
interface Start {
  audience: Aud;
  on: boolean;
  consent: string | null;
  dailyLimit: number;
  askedToday: number;
  starters: Array<{ id: string; question: string; questionHi: string }>;
  recent: Array<{ question: string }>;
}

describe('Assistant set-up (e2e, docs/design/91 phase C)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const settings = async () => {
    const r = await inject({
      method: 'GET',
      url: '/insights/assistant/settings',
      headers: h(admin),
    });
    expect(r.statusCode).toBe(200);
    return r.json() as Settings;
  };
  const save = (body: Partial<Settings>, u: SeededUser = admin) =>
    settings().then(async (cur) => {
      const json = {
        audiences: cur.audiences,
        dailyLimit: cur.dailyLimit,
        topicsOff: cur.topicsOff,
        starters: cur.starters,
        ...body,
      };
      return inject({ method: 'PUT', url: '/insights/assistant/settings', headers: h(u), json });
    });
  const start = async (u: SeededUser) => {
    const r = await inject({ method: 'GET', url: '/insights/assistant/start', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Start;
  };
  const ask = (u: SeededUser, question: string) =>
    inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(u),
      json: { question, language: 'en' },
    });

  beforeAll(async () => {
    const s = stamp('CU');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'CU01', 'Setup', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(admin),
      json: { name: 'A' },
    });
    // the teacher holds VI-A (a teacher, not office staff)
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=5', headers: h(admin) })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(admin),
      json: {
        employeeId: emps.find((e) => e.employeeCode === 'CU01')!.id,
        classSectionId: sec.json().id,
        kind: 'class_teacher',
      },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(admin),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Asha',
        lastName: 'Setup',
        guardians: [
          {
            guardian: { firstName: 'Mina', lastName: 'Setup', mobile: '9876500055' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500055' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [pupil.id, st.json().id]);
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('starts with every audience on, 30 a day, no topic off, the standard starters', async () => {
    const s = await settings();
    expect(s.audiences).toEqual({ student: true, parent: true, teacher: true, admin: true });
    expect(s.dailyLimit).toBe(30);
    expect(s.topicsOff).toEqual({ student: [], parent: [], teacher: [], admin: [] });
    expect(s.starters.parent[0]).toBe('child_attendance');
    expect(s.topics.map((t) => t.key)).toContain('fees');
    expect(s.catalogue.student.map((e) => e.id)).toContain('child_library');
    expect(s.catalogue.student.map((e) => e.id)).not.toContain('fee_defaulters');
    expect(s.catalogue.admin.map((e) => e.id)).toContain('today_summary');
    expect(s.catalogue.teacher.map((e) => e.id)).toContain('my_absentees');
  });

  it('the start screen: consent, starters, recent questions, today’s count', async () => {
    // the student's parent has not consented yet
    expect((await start(pupil)).consent).toBe('ask_parent');
    const before = await start(parent);
    expect(before).toMatchObject({
      audience: 'parent',
      on: true,
      consent: 'needed',
      askedToday: 0,
    });
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
    expect((await start(pupil)).consent).toBe('granted');
    const p = await start(parent);
    expect(p.consent).toBe('granted');
    expect(p.starters[0]).toEqual({
      id: 'child_attendance',
      question: 'Show the attendance record',
      questionHi: 'उपस्थिति रिकॉर्ड दिखाओ',
    });
    expect((await ask(parent, 'how much fees is due')).statusCode).toBe(201);
    expect((await ask(parent, 'show the attendance record')).statusCode).toBe(201);
    const after = await start(parent);
    expect(after.askedToday).toBe(2);
    expect(after.recent.map((r) => r.question)).toEqual([
      'show the attendance record',
      'how much fees is due',
    ]);
    // staff and teachers have their own start
    expect((await start(admin)).starters[0]!.id).toBe('today_summary');
    expect((await start(teacher)).audience).toBe('teacher');
  });

  it('an audience switched off cannot ask; the start screen says so', async () => {
    const off = await save({
      audiences: { student: true, parent: false, teacher: true, admin: true },
    });
    expect(off.statusCode).toBe(200);
    const r = await ask(parent, 'how much fees is due');
    expect(r.statusCode).toBe(403);
    expect(r.json().type).toBe('assistant-off');
    expect((await start(parent)).on).toBe(false);
    await save({ audiences: { student: true, parent: true, teacher: true, admin: true } });
    expect((await ask(parent, 'how much fees is due')).statusCode).toBe(201);
  });

  it('a topic switched off for an audience is left out of its answers and starters', async () => {
    await save({ topicsOff: { student: [], parent: ['fees'], teacher: [], admin: [] } });
    const r = await ask(parent, 'how much fees is due');
    expect(r.statusCode).toBe(201);
    expect(r.json().citations.map((c: { query: string }) => c.query)).not.toContain('child_dues');
    const cat = await inject({
      method: 'GET',
      url: '/insights/assistant/catalogue',
      headers: h(parent),
    });
    const allowed = (cat.json().data as Array<{ id: string; allowed: boolean }>).filter(
      (e) => e.allowed,
    );
    expect(allowed.map((e) => e.id)).not.toContain('child_dues');
    expect((await start(parent)).starters.map((x) => x.id)).not.toContain('child_dues');
    await save({ topicsOff: { student: [], parent: [], teacher: [], admin: [] } });
  });

  it('the school’s own starters, checked against the audience’s questions', async () => {
    const ok = await save({
      starters: {
        student: [],
        parent: ['child_bus', 'child_dues'],
        teacher: [],
        admin: [],
      },
    });
    expect(ok.statusCode).toBe(200);
    expect((await start(parent)).starters.map((x) => x.id)).toEqual(['child_bus', 'child_dues']);
    // empty: the standard ones
    expect((await start(pupil)).starters[0]!.id).toBe('child_attendance');
    const bad = await save({
      starters: { student: [], parent: ['fee_defaulters'], teacher: [], admin: [] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toContain('fee_defaulters is not a question for parents.');
  });

  it('the daily limit', async () => {
    await save({ dailyLimit: 4 });
    // two asked in the start test, one after switching the audience back on, one with fees off: the fifth is refused
    const r = await ask(parent, 'show the attendance record');
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ type: 'ai.daily_limit', limit: 4 });
    await save({ dailyLimit: 30 });
    expect((await ask(parent, 'show the attendance record')).statusCode).toBe(201);
  });

  it('only the office may change the set-up', async () => {
    expect(
      (await inject({ method: 'GET', url: '/insights/assistant/settings', headers: h(teacher) }))
        .statusCode,
    ).toBe(403);
    expect((await save({ dailyLimit: 99 }, parent)).statusCode).toBe(403);
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'insights.assistant.settings_saved'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBeGreaterThan(0);
  });
});
