/**
 * The chatbot for students and staff (docs/design/91, phase B): a student asks about themselves only, once a parent
 * gave the AI assistant consent, and hears "you"; a student never reaches another student, nor the staff queries; a
 * staff member asks about their own records (the self scope) — never another's; an admin asks how the school is today;
 * a parent's new questions (bus, exams, report cards, certificates, receipts) stay with their own children.
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

interface Answer {
  answer: string;
  refused: boolean;
  citations: Array<{ query: string; rows: number }>;
  card: null | { kind: string; figures?: Array<{ label: string; value: string }> };
  link: null | { app: string | null; web: string | null };
}

describe('the chatbot for students and staff (e2e, docs/design/91 phase B)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  let otherPupil: SeededUser;
  let teacher: SeededUser;
  let otherTeacher: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const ask = (u: SeededUser, question: string, language = 'en') =>
    inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(u),
      json: { question, language },
    });
  const answer = async (u: SeededUser, question: string, language = 'en') => {
    const r = await ask(u, question, language);
    expect(r.statusCode).toBe(201);
    return r.json() as Answer;
  };

  beforeAll(async () => {
    const s = stamp('CS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
      otherPupil = await seedUser(c, school, `${s}-pupil2`, 'student', 'student');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      otherTeacher = await seedUser(c, school, `${s}-teacher2`, 'subject_teacher');
      for (const [u, code] of [
        [teacher, 'CS01'],
        [otherTeacher, 'CS02'],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Chat', $2, $3) RETURNING id::text`,
          [school.id, code, u.id],
        );
        ids[code] = e.rows[0]!.id;
      }
      // this month: the teacher present twice (late once); the other teacher absent once
      await c.query(
        `INSERT INTO staff_attendance_days (school_id, employee_id, day, day_type, late_minutes, source)
         VALUES ($1, $2, date_trunc('month', CURRENT_DATE)::date, 'P', 0, 'manual'),
                ($1, $2, date_trunc('month', CURRENT_DATE)::date + 1, 'P', 12, 'manual'),
                ($1, $3, date_trunc('month', CURRENT_DATE)::date, 'A', 0, 'manual')`,
        [school.id, ids.CS01, ids.CS02],
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
    const student = async (first: string, no: string, mobile?: string) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(admin),
        json: {
          admissionNo: `${s}-${no}`,
          firstName: first,
          lastName: 'Scope',
          guardians: mobile
            ? [
                {
                  guardian: { firstName: 'Mina', lastName: 'Scope', mobile },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: sec.json().id, rollNo: Number(no) },
        },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    // every chip of every role is asked: the school's daily limit (docs/design/91) raised
    await inject({
      method: 'PUT',
      url: '/insights/assistant/settings',
      headers: h(admin),
      json: {
        audiences: { student: true, parent: true, teacher: true, admin: true },
        dailyLimit: 500,
        topicsOff: { student: [], parent: [], teacher: [], admin: [] },
        starters: { student: [], parent: [], teacher: [], admin: [] },
      },
    });
    ids.asha = await student('Asha', '1', '9876500066');
    ids.bhanu = await student('Bhanu', '2');
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500066' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [pupil.id, ids.asha]);
      await c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [otherPupil.id, ids.bhanu]);
      // Asha absent one day, Bhanu absent three
      for (let d = 1; d <= 3; d++) {
        const ses = await c.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_at)
           VALUES ($1, $2, $3, CURRENT_DATE - $4::int, 'day', 'manual', now()) RETURNING id`,
          [school.id, school.yearId, sec.json().id, d],
        );
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, source)
           VALUES ($1, $2, $3, $4::attendance_code, 'manual'), ($1, $2, $5, 'A', 'manual')`,
          [school.id, ses.rows[0]!.id, ids.asha, d === 1 ? 'A' : 'P', ids.bhanu],
        );
      }
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a student needs a parent’s AI consent, then asks about themself and hears “you”', async () => {
    const before = await ask(pupil, 'show my attendance record');
    expect(before.statusCode).toBe(403);
    expect(before.json()).toMatchObject({ type: 'consent-required', whose: 'parent' });
    // the student's own consent does not count; the parent's does
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
    const a = await answer(pupil, 'show my attendance record');
    expect(a.citations[0]).toMatchObject({ query: 'child_attendance', rows: 1 });
    expect(a.answer).toBe('You were present 2 of 3 days (66.7%), absent 1.');
    const hi = await answer(pupil, 'मेरी उपस्थिति दिखाओ', 'hi');
    expect(hi.answer).toMatch(/^आप 3 में से 2 दिन उपस्थित रहे/);
    // the student's catalogue: their own entries only
    const cat = await inject({
      method: 'GET',
      url: '/insights/assistant/catalogue',
      headers: h(pupil),
    });
    const allowed = (cat.json().data as Array<{ id: string; allowed: boolean }>)
      .filter((e) => e.allowed)
      .map((e) => e.id);
    expect(allowed).toContain('child_library');
    expect(allowed).not.toContain('fee_defaulters');
    expect(allowed).not.toContain('student_attendance');
  });

  it('a student never reaches another student or the staff queries', async () => {
    // another pupil without a parent's consent is refused
    expect((await ask(otherPupil, 'show my attendance')).statusCode).toBe(403);
    for (const q of [
      'attendance of Bhanu Scope',
      'fee defaulters of class VI',
      'who is absent today',
      'show me the ledger of student 1',
    ]) {
      const a = await answer(pupil, q);
      for (const c of a.citations)
        expect(c.query.startsWith('child_') || c.query === 'my_children').toBe(true);
      expect(JSON.stringify(a)).not.toContain('Bhanu');
    }
  });

  it('a student’s other questions: library, bus, exams, report cards, receipts', async () => {
    for (const [q, id] of [
      ['which library books are out', 'child_library'],
      ['which bus and when', 'child_bus'],
      ['when is the next exam', 'child_date_sheet'],
      ['show my report card', 'child_results'],
      ['fee receipts', 'child_receipts'],
      ["today's classes", 'child_timetable_today'],
      ['my certificates', 'child_certificates'],
    ] as const) {
      const a = await answer(pupil, q);
      expect(a.citations[0]?.query).toBe(id);
      expect(a.refused).toBe(false);
      expect(a.answer.length).toBeGreaterThan(5);
      expect(a.link?.app).toBeTruthy();
    }
  });

  it('staff ask about their own records only', async () => {
    const mine = await answer(teacher, 'my own attendance this month');
    expect(mine.citations[0]).toMatchObject({ query: 'my_own_attendance', rows: 2 });
    expect(mine.answer).toMatch(/present 2, absent 0, on leave 0, late on 1 day/);
    expect(mine.link).toMatchObject({ app: '/my-attendance' });
    const other = await answer(otherTeacher, 'my own attendance this month');
    expect(other.citations[0]).toMatchObject({ query: 'my_own_attendance', rows: 1 });
    expect(other.answer).toMatch(/absent 1/);
    for (const [q, id] of [
      ['how many leaves do I have left', 'my_leave_balance'],
      ['where are my leave requests', 'my_leave_requests'],
      ['my classes today', 'my_timetable_today'],
    ] as const)
      expect((await answer(teacher, q)).citations[0]?.query).toBe(id);
    // an admin without an employee record has no own records
    const cat = await inject({
      method: 'GET',
      url: '/insights/assistant/catalogue',
      headers: h(admin),
    });
    expect((cat.json().data as Array<{ id: string }>).map((e) => e.id)).not.toContain(
      'my_own_attendance',
    );
  });

  it('the principal or admin asks how the school is today', async () => {
    const a = await answer(admin, 'how is the school today');
    expect(a.citations[0]).toMatchObject({ query: 'today_summary' });
    expect(a.card).toMatchObject({ kind: 'figures' });
    expect(a.answer).toMatch(/^Today: /);
  });

  it('every chip question finds its own query, in English and Hindi, for every role', async () => {
    const misses: string[] = [];
    for (const [who, u] of [
      ['student', pupil],
      ['parent', parent],
      ['teacher', teacher],
      ['admin', admin],
    ] as const) {
      const cat = await inject({
        method: 'GET',
        url: '/insights/assistant/catalogue',
        headers: h(u),
      });
      const mine = (
        cat.json().data as Array<{
          id: string;
          allowed: boolean;
          ask: string;
          askHi: string;
          params: Array<{ name: string; required?: boolean }>;
        }>
      ).filter((e) => e.allowed);
      expect(mine.length).toBeGreaterThan(3);
      for (const e of mine)
        for (const [q, lang] of [
          [e.ask, 'en'],
          [e.askHi, 'hi'],
        ] as const) {
          const a = await answer(u, q, lang);
          const needsWho = e.params.some((p) => p.required);
          const ok = a.citations[0]?.query === e.id || (needsWho && a.citations.length === 0);
          if (!ok)
            misses.push(`${who}/${lang} "${q}" (${e.id}) -> ${a.citations[0]?.query ?? 'none'}`);
        }
    }
    expect(misses).toEqual([]);
  }, 120_000);

  it('a parent’s new questions stay with their own child', async () => {
    const a = await answer(parent, 'was my child absent this week');
    expect(a.answer).toBe('Asha Scope: present 2 of 3 days (66.7%), absent 1.');
    expect(JSON.stringify(a)).not.toContain('Bhanu');
    for (const [q, id] of [
      ['which bus and when', 'child_bus'],
      ['when is the next exam', 'child_date_sheet'],
      ['fee receipts', 'child_receipts'],
    ] as const)
      expect((await answer(parent, q)).citations[0]?.query).toBe(id);
  });
});
