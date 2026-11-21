/**
 * The MobiAI chat window's start (docs/design/92, phase A; 0411): the name and the subtitle per audience (the
 * school's or the standard one, in English and Hindi), the person's first name for the greeting, the topic bar (the
 * topics the person may ask, each with its main question) and the Quick Update (one-line answers of the audience's
 * quick queries, with the person's rights; none before a parent's consent or with the audience switched off).
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
interface Start {
  audience: Aud;
  on: boolean;
  consent: string | null;
  name: string;
  subtitle: string;
  subtitleHi: string;
  firstName: string | null;
  topics: Array<{ key: string; label: string; id: string; question: string; questionHi: string }>;
  quick: Array<{ id: string; topic: string; text: string; textHi: string; question: string }>;
}
interface Settings {
  audiences: Record<Aud, boolean>;
  dailyLimit: number;
  topicsOff: Record<Aud, string[]>;
  starters: Record<Aud, string[]>;
  name: string;
  subtitles: Record<Aud, string>;
  defaults: { name: string; subtitles: Record<Aud, { en: string; hi: string }> };
}

describe('MobiAI chat window: the start (e2e, docs/design/92 phase A)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const start = async (u: SeededUser) => {
    const r = await inject({ method: 'GET', url: '/insights/assistant/start', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Start;
  };
  const settings = async () =>
    (
      await inject({ method: 'GET', url: '/insights/assistant/settings', headers: h(admin) })
    ).json() as Settings;
  const save = async (body: Partial<Settings>) => {
    const cur = await settings();
    return inject({
      method: 'PUT',
      url: '/insights/assistant/settings',
      headers: h(admin),
      json: {
        audiences: cur.audiences,
        dailyLimit: cur.dailyLimit,
        topicsOff: cur.topicsOff,
        starters: cur.starters,
        ...body,
      },
    });
  };

  beforeAll(async () => {
    const s = stamp('CW');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'CW01', 'Window', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
      await c.query(`UPDATE users SET display_name = 'Mina Window' WHERE id = $1`, [parent.id]);
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
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=5', headers: h(admin) })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(admin),
      json: {
        employeeId: emps.find((e) => e.employeeCode === 'CW01')!.id,
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
        lastName: 'Window',
        guardians: [
          {
            guardian: { firstName: 'Mina', lastName: 'Window', mobile: '9876500066' },
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
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500066' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [pupil.id, st.json().id]);
      // three school days: present on two, absent on one
      for (let d = 1; d <= 3; d++) {
        const ses = await c.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_at)
           VALUES ($1, $2, $3, CURRENT_DATE - $4::int, 'day', 'manual', now()) RETURNING id`,
          [school.id, school.yearId, sec.json().id, d],
        );
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, source) VALUES ($1, $2, $3, $4::attendance_code, 'manual')`,
          [school.id, ses.rows[0]!.id, st.json().id, d === 2 ? 'A' : 'P'],
        );
      }
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a parent before the consent: the name, subtitle, topics — no Quick Update yet', async () => {
    const p = await start(parent);
    expect(p).toMatchObject({
      audience: 'parent',
      consent: 'needed',
      name: 'MobiAI',
      subtitle: 'Your smart parent assistant',
      subtitleHi: 'आपका स्मार्ट अभिभावक सहायक',
      firstName: 'Mina',
    });
    expect(p.topics.map((t) => t.key)).toEqual(
      expect.arrayContaining(['attendance', 'academics', 'fees', 'transport']),
    );
    expect(p.topics.find((t) => t.key === 'attendance')).toMatchObject({
      id: 'child_attendance',
      question: 'Show the attendance record',
    });
    // no staff topics for a family
    expect(p.topics.map((t) => t.key)).not.toContain('hr');
    expect(p.quick).toEqual([]);
  });

  it('the Quick Update per audience, with the person’s rights', async () => {
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
    const p = await start(parent);
    expect(p.quick.map((q) => q.id)).toEqual(['child_attendance', 'child_dues', 'child_homework']);
    const att = p.quick[0]!;
    expect(att.text).toMatch(/Asha Window: present 2 of 3 days/);
    expect(att.textHi).toMatch(/उपस्थित/);
    expect(att).toMatchObject({ topic: 'attendance', question: 'Show the attendance record' });

    // the student: their own (with the parent's consent)
    const st = await start(pupil);
    expect(st).toMatchObject({ audience: 'student', subtitle: 'Your smart study assistant' });
    expect(st.quick.map((q) => q.id)).toEqual([
      'child_attendance',
      'child_timetable_today',
      'child_homework',
    ]);
    expect(st.quick[0]!.text).toMatch(/^You were present 2 of 3 days|present 2 of 3/);
    expect(st.topics.map((t) => t.key)).not.toContain('hr');

    const t = await start(teacher);
    expect(t).toMatchObject({ audience: 'teacher', subtitle: 'Your smart teaching assistant' });
    expect(t.quick.map((q) => q.id)).toEqual([
      'my_absentees',
      'my_timetable_today',
      'my_leave_balance',
    ]);

    const a = await start(admin);
    expect(a).toMatchObject({ audience: 'admin', subtitle: 'Your smart admin assistant' });
    expect(a.quick.map((q) => q.id)).toEqual(['today_summary', 'open_queries']);
    expect(a.topics.map((x) => x.key)).toEqual(
      expect.arrayContaining(['attendance', 'fees', 'admissions', 'hr']),
    );
    // the Quick Update is not a question: today's count stays
    expect(((await start(parent)) as unknown as { askedToday: number }).askedToday).toBe(0);
  });

  it('the school names it and writes its subtitles; left out, they stay', async () => {
    const cur = await settings();
    expect(cur.name).toBe('MobiAI');
    expect(cur.defaults.subtitles.parent.en).toBe('Your smart parent assistant');
    const ok = await save({
      name: 'Vidya',
      subtitles: { student: '', parent: 'Ask me about your child', teacher: '', admin: '' },
    });
    expect(ok.statusCode).toBe(200);
    const p = await start(parent);
    expect(p).toMatchObject({
      name: 'Vidya',
      subtitle: 'Ask me about your child',
      subtitleHi: 'Ask me about your child',
    });
    // empty: the standard one
    expect((await start(pupil)).subtitle).toBe('Your smart study assistant');
    // a save without them (the set-up's other sections) keeps them
    expect((await save({ dailyLimit: 40 })).statusCode).toBe(200);
    expect((await start(parent)).name).toBe('Vidya');
    expect((await settings()).subtitles.parent).toBe('Ask me about your child');
    // a name is needed and short
    expect((await save({ name: '  ' })).statusCode).toBe(400);
    expect((await save({ name: 'x'.repeat(41) })).statusCode).toBe(400);
  });

  it('a topic switched off leaves the topic bar and the Quick Update; the school’s starter leads its topic', async () => {
    await save({
      topicsOff: { student: [], parent: ['fees'], teacher: [], admin: [] },
      starters: { student: [], parent: ['child_bus', 'child_notices'], teacher: [], admin: [] },
    });
    const p = await start(parent);
    expect(p.topics.map((t) => t.key)).not.toContain('fees');
    expect(p.quick.map((q) => q.id)).toEqual(['child_attendance', 'child_homework']);
    expect(p.topics.find((t) => t.key === 'transport')!.id).toBe('child_bus');
    await save({
      topicsOff: { student: [], parent: [], teacher: [], admin: [] },
      starters: { student: [], parent: [], teacher: [], admin: [] },
    });
  });

  it('an audience switched off: no Quick Update', async () => {
    await save({ audiences: { student: true, parent: false, teacher: true, admin: true } });
    const p = await start(parent);
    expect(p.on).toBe(false);
    expect(p.quick).toEqual([]);
    await save({ audiences: { student: true, parent: true, teacher: true, admin: true } });
  });
});
