/**
 * The chatbot with no outside model (docs/design/91, phase A): EduPro's own matcher picks the approved query the
 * person may run; the answer is a sentence, the records as a card, the screen to open and related questions; it asks
 * "which student?" when a staff question names several; it says no kindly to what is not about the school's records;
 * the conversation keeps what was shown; questions are audited with personal details masked.
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
  conversationId: string;
  answer: string;
  refused: boolean;
  citations: Array<{ query: string; rows: number; params: Record<string, unknown> }>;
  suggestions: Array<{ id: string; question?: string }>;
  card: null | {
    kind: string;
    figures?: Array<{ label: string; value: string }>;
    rows?: unknown[];
  };
  link: null | { label: string; labelHi: string; app: string | null; web: string | null };
  followUps: Array<{ id: string; question: string }>;
  didYouMean: Array<{ id: string; question: string }>;
  provider: string;
}

describe('the chatbot, no outside model (e2e, docs/design/91 phase A)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let parent: SeededUser;
  let s: string;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const ask = async (u: SeededUser, question: string, extra: Record<string, unknown> = {}) => {
    const r = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(u),
      json: { question, ...extra },
    });
    expect(r.statusCode).toBe(201);
    return r.json() as Answer;
  };

  beforeAll(async () => {
    s = stamp('CB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
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
    const student = (first: string, last: string, no: string, mobile?: string) =>
      inject({
        method: 'POST',
        url: '/people/students',
        headers: h(admin),
        json: {
          admissionNo: `${s}-${no}`,
          firstName: first,
          lastName: last,
          guardians: mobile
            ? [
                {
                  guardian: { firstName: 'Priya', lastName: 'Chatbot', mobile },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: sec.json().id, rollNo: Number(no) },
        },
      });
    const asha = await student('Asha', 'Chatbot', '1', '9876500077');
    expect(asha.statusCode).toBe(201);
    expect((await student('Ravi', 'Chatbot', '2')).statusCode).toBe(201);
    expect((await student('Ravi', 'Otherway', '3')).statusCode).toBe(201);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500077' AND school_id = $2`,
        [parent.id, school.id],
      );
      // five school days: Asha present on four, absent on one
      for (let d = 1; d <= 5; d++) {
        const ses = await c.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, source, marked_at)
           VALUES ($1, $2, $3, CURRENT_DATE - $4::int, 'day', 'manual', now()) RETURNING id`,
          [school.id, school.yearId, sec.json().id, d],
        );
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, source) VALUES ($1, $2, $3, $4::attendance_code, 'manual')`,
          [school.id, ses.rows[0]!.id, asha.json().id, d === 2 ? 'A' : 'P'],
        );
      }
    });
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a parent: the record as a card, the screen to open, related questions', async () => {
    const a = await ask(parent, 'Show my attendance record this week', { language: 'en' });
    expect(a.provider).toBe('local');
    expect(a.refused).toBe(false);
    expect(a.citations).toEqual([
      expect.objectContaining({ query: 'child_attendance', rows: 1, params: { days: 7 } }),
    ]);
    expect(a.answer).toBe('Asha Chatbot: present 4 of 5 days (80%), absent 1.');
    expect(a.card).toMatchObject({
      kind: 'figures',
      figures: [
        { label: 'School days', value: '5' },
        { label: 'Present', value: '4' },
        { label: 'Absent', value: '1' },
        expect.objectContaining({ label: 'Absent on' }),
      ],
    });
    expect(a.link).toEqual({
      label: 'Attendance',
      labelHi: 'उपस्थिति',
      app: '/attendance',
      web: '/attendance',
    });
    expect(a.followUps.map((f) => f.id)).toEqual(['child_homework', 'child_dues', 'child_notices']);
    expect(a.followUps[0]!.question).toBe('Homework this week');

    // the conversation keeps what was shown
    const conv = await inject({
      method: 'GET',
      url: `/insights/assistant/conversations/${a.conversationId}`,
      headers: h(parent),
    });
    const said = (conv.json().messages as Array<{ role: string; display: Answer | null }>).find(
      (m) => m.role === 'assistant',
    )!;
    expect(said.display).toMatchObject({ card: { kind: 'figures' }, link: { app: '/attendance' } });
  });

  it('in Hindi and Hinglish', async () => {
    const hi = await ask(parent, 'मेरी उपस्थिति दिखाओ', { language: 'hi' });
    expect(hi.citations[0]!.query).toBe('child_attendance');
    expect(hi.answer).toMatch(/उपस्थित/);
    expect(hi.followUps[0]!.question).toMatch(/[ऀ-ॿ]/);
    const hinglish = await ask(parent, 'kitne din absent tha');
    expect(hinglish.citations[0]!.query).toBe('child_attendance');
    expect(hinglish.answer).toMatch(/din present/);
  });

  it('staff: which student, when the name fits several; then the one named', async () => {
    const two = await ask(admin, 'attendance of Ravi');
    expect(two.answer).toBe('Which student do you mean?');
    expect(two.citations).toEqual([]);
    expect(two.card).toMatchObject({ kind: 'table' });
    expect(JSON.stringify(two.card)).toContain('Ravi Chatbot');
    expect(JSON.stringify(two.card)).toContain('Ravi Otherway');
    const one = await ask(admin, 'attendance of Ravi Otherway');
    expect(one.citations[0]).toMatchObject({ query: 'student_attendance' });
    const none = await ask(admin, 'attendance of Zzyzx');
    expect(none.refused).toBe(true);
    expect(none.answer).toMatch(/Which student\?/);
  });

  it('says no kindly to what is not about school records, with what it can answer', async () => {
    const change = await ask(admin, 'delete all attendance of today');
    expect(change.refused).toBe(true);
    expect(change.citations).toEqual([]);
    expect(change.answer).toMatch(/only read your school records/);
    const unknown = await ask(parent, 'xyzzy plugh');
    expect(unknown.refused).toBe(true);
    expect(unknown.answer).toMatch(/such as:/);
    expect(unknown.suggestions).toHaveLength(3);
    expect(unknown.suggestions[0]!.question).toBeTruthy();
  });

  it('audits every question with personal details masked; nothing goes to an outside model', async () => {
    await ask(parent, 'my number is 9876500077, show attendance');
    const rows = await withMigrator((c) =>
      c.query<{ provider: string; text: string; kind: string }>(
        `SELECT provider, text, kind FROM ai_audit WHERE school_id = $1 ORDER BY id DESC LIMIT 2`,
        [school.id],
      ),
    );
    expect(rows.rows.every((r) => r.provider === 'local')).toBe(true);
    const prompt = rows.rows.find((r) => r.kind === 'prompt')!;
    expect(prompt.text).not.toContain('9876500077');
  });
});
