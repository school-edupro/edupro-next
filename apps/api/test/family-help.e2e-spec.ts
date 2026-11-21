/**
 * The families' Help kept by the school (0406): a school starts with the standard headings and questions; the
 * office adds, changes, hides, orders and deletes them (a heading's questions move to "Other questions"); a parent
 * and a student each read only what is for them and the screens they can open; "Was this helpful?" counts since the
 * answer last changed; Restore puts back deleted standard questions; the rights and the school boundary.
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

interface Question {
  id: string;
  headingId: string | null;
  question: string;
  audience: string;
  page: string | null;
  hidden: boolean;
  standard: boolean;
  yes: number;
  no: number;
}
interface Setup {
  headings: Array<{ id: string; title: string; titleHi: string | null; standard: boolean }>;
  questions: Question[];
  pages: Array<{ href: string; label: string }>;
  standardMissing: number;
}
interface Family {
  audience: string;
  groups: Array<{
    id: string | null;
    title: string;
    titleHi: string | null;
    questions: Array<{
      id: string;
      question: string;
      page: string | null;
      pageLabel: string | null;
      myVote: boolean | null;
    }>;
  }>;
}

describe('family help (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let otherAdmin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let student: SeededUser;
  const h = (u: SeededUser, sc: SeededSchool = school) => headersFor(u.sub, sc.id);
  const ids: Record<string, string> = {};

  const setup = async (u: SeededUser = admin, sc: SeededSchool = school) => {
    const r = await inject({ method: 'GET', url: '/helpdesk/family-help', headers: h(u, sc) });
    expect(r.statusCode).toBe(200);
    return r.json() as Setup;
  };
  const family = async (u: SeededUser, as?: 'parent' | 'student') => {
    const r = await inject({
      method: 'GET',
      url: `/engagement/help${as ? `?for=${as}` : ''}`,
      headers: h(u),
    });
    expect(r.statusCode).toBe(200);
    return r.json() as Family;
  };
  const questionsOf = (f: Family) => f.groups.flatMap((g) => g.questions.map((q) => q.question));
  const byText = (s: Setup, text: string) => s.questions.find((q) => q.question === text)!;

  beforeAll(async () => {
    const s = stamp('FH');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      otherAdmin = await seedUser(c, other, `${s}-admin-b`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      student = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a school starts with the standard headings and questions, once', async () => {
    const first = await setup();
    expect(first.headings.map((x) => x.title)).toEqual([
      'Using the app and the website',
      'Attendance and leave',
      'Fees',
      'Results',
      'Meeting the school',
      'Profile and your data',
    ]);
    expect(first.headings.every((x) => x.standard && x.titleHi)).toBe(true);
    expect(first.questions).toHaveLength(10);
    expect(first.standardMissing).toBe(0);
    expect(byText(first, 'How do I apply for leave?')).toMatchObject({
      audience: 'both',
      page: '/attendance',
      hidden: false,
      standard: true,
      yes: 0,
      no: 0,
    });
    // the screens a question may be about: the family menu without Home and Help
    expect(first.pages).toContainEqual({ href: '/attendance', label: 'Attendance' });
    expect(first.pages.map((p) => p.href)).not.toContain('/help');
    expect(first.pages.map((p) => p.href)).not.toContain('/');
    const again = await setup();
    expect(again.questions).toHaveLength(10);
    expect(again.headings).toHaveLength(6);
  });

  it('a parent reads the parents’ questions under headings; a student the students’', async () => {
    const p = await family(parent);
    expect(p.audience).toBe('parent');
    expect(p.groups[0]).toMatchObject({
      title: 'Using the app and the website',
      titleHi: 'ऐप और वेबसाइट का उपयोग',
    });
    expect(questionsOf(p)).toHaveLength(10);
    const leave = p.groups.flatMap((g) => g.questions).find((q) => q.page === '/attendance')!;
    expect(leave).toMatchObject({ pageLabel: 'Attendance', myVote: null });

    const s = await family(student);
    expect(s.audience).toBe('student');
    expect(questionsOf(s)).not.toContain('How do I switch between my children?');
    expect(questionsOf(s)).not.toContain('How do I ask to meet a teacher?');
    expect(questionsOf(s)).not.toContain('I paid online but the receipt is not showing.');
    expect(questionsOf(s)).toContain('Where is the report card?');
    expect(s.groups.map((g) => g.title)).not.toContain('Meeting the school');
    // the app says which it is
    expect((await family(parent, 'student')).audience).toBe('student');
  });

  it('the office adds a heading and a question; families see it; hidden, it is gone', async () => {
    const hd = await inject({
      method: 'POST',
      url: '/helpdesk/family-help/headings',
      headers: h(admin),
      json: { title: 'School bus', titleHi: 'स्कूल बस' },
    });
    expect(hd.statusCode).toBe(201);
    ids.bus = hd.json().id;
    const q = await inject({
      method: 'POST',
      url: '/helpdesk/family-help/questions',
      headers: h(admin),
      json: {
        headingId: ids.bus,
        question: 'When does the bus leave?',
        questionHi: '',
        answer: 'At 7:10 from the first stop.',
        audience: 'both',
        page: '/transport',
      },
    });
    expect(q.statusCode).toBe(201);
    ids.busQ = q.json().id;
    const s = await setup();
    expect(s.headings.at(-1)).toMatchObject({ title: 'School bus', standard: false });
    expect(s.questions.find((x) => x.id === ids.busQ)).toMatchObject({
      headingId: ids.bus,
      page: '/transport',
      standard: false,
    });
    const bus = (await family(student)).groups.find((g) => g.title === 'School bus')!;
    expect(bus.questions).toEqual([
      expect.objectContaining({ question: 'When does the bus leave?', pageLabel: 'School bus' }),
    ]);
    // empty Hindi is none (the English shows)
    expect(
      (await setup()).questions.find((x) => x.id === ids.busQ) as unknown as {
        questionHi: unknown;
      },
    ).toMatchObject({ questionHi: null });

    const hide = await inject({
      method: 'PUT',
      url: `/helpdesk/family-help/questions/${ids.busQ}`,
      headers: h(admin),
      json: {
        headingId: ids.bus,
        question: 'When does the bus leave?',
        answer: 'At 7:10 from the first stop.',
        audience: 'both',
        page: '/transport',
        hidden: true,
      },
    });
    expect(hide.statusCode).toBe(200);
    expect(hide.json()).toMatchObject({ countsRestarted: false });
    expect(questionsOf(await family(parent))).not.toContain('When does the bus leave?');
    expect((await family(parent)).groups.map((g) => g.title)).not.toContain('School bus');
  });

  it('a question about a screen the person cannot open is left out', async () => {
    const q = await inject({
      method: 'POST',
      url: '/helpdesk/family-help/questions',
      headers: h(admin),
      json: {
        headingId: null,
        question: 'Can I ask the assistant in Hindi?',
        answer: 'Yes, or in Hinglish.',
        audience: 'both',
        page: '/assistant',
      },
    });
    expect(q.statusCode).toBe(201);
    ids.ai = q.json().id;
    const p = await family(parent);
    // no heading: "Other questions", last
    expect(p.groups.at(-1)).toMatchObject({ id: null, title: 'Other questions' });
    expect(questionsOf(p)).toContain('Can I ask the assistant in Hindi?');
    // a student has no assistant
    expect(questionsOf(await family(student))).not.toContain('Can I ask the assistant in Hindi?');
  });

  it('the office orders headings and questions', async () => {
    const before = await setup();
    const order = before.headings.map((x) => x.id);
    const up = await inject({
      method: 'POST',
      url: `/helpdesk/family-help/headings/${order[1]}/move`,
      headers: h(admin),
      json: { direction: 'up' },
    });
    expect(up.statusCode).toBe(200);
    expect((await setup()).headings.map((x) => x.id).slice(0, 2)).toEqual([order[1], order[0]]);
    // the first cannot go up
    await inject({
      method: 'POST',
      url: `/helpdesk/family-help/headings/${order[1]}/move`,
      headers: h(admin),
      json: { direction: 'up' },
    });
    expect((await setup()).headings[0]!.id).toBe(order[1]);

    const app1 = before.questions.filter((x) => x.headingId === order[0]).map((x) => x.id);
    await inject({
      method: 'POST',
      url: `/helpdesk/family-help/questions/${app1[0]}/move`,
      headers: h(admin),
      json: { direction: 'down' },
    });
    const after = (await setup()).questions
      .filter((x) => x.headingId === order[0])
      .map((x) => x.id);
    expect(after.slice(0, 2)).toEqual([app1[1], app1[0]]);
  });

  it('“Was this helpful?” once per person, counted since the answer last changed', async () => {
    const s = await setup();
    const card = byText(s, 'Where is the report card?');
    const vote = (u: SeededUser, helpful: boolean, id = card.id) =>
      inject({
        method: 'POST',
        url: `/engagement/help/${id}/vote`,
        headers: h(u),
        json: { helpful },
      });
    expect((await vote(parent, true)).json()).toEqual({ ok: true, helpful: true });
    expect((await vote(student, true)).statusCode).toBe(200);
    expect(byText(await setup(), 'Where is the report card?')).toMatchObject({ yes: 2, no: 0 });
    // a second answer replaces the first
    await vote(parent, false);
    expect(byText(await setup(), 'Where is the report card?')).toMatchObject({ yes: 1, no: 1 });
    const mine = (await family(parent)).groups
      .flatMap((g) => g.questions)
      .find((q) => q.id === card.id)!;
    expect(mine.myVote).toBe(false);
    // a hidden question takes no votes
    expect((await vote(parent, true, ids.busQ!)).statusCode).toBe(404);

    // a new answer starts the counts again; the same answer does not
    const body = {
      headingId: card.headingId,
      question: card.question,
      answer: 'Results → the term → Report card (PDF).',
      audience: 'both',
      page: '/results',
    };
    const changed = await inject({
      method: 'PUT',
      url: `/helpdesk/family-help/questions/${card.id}`,
      headers: h(admin),
      json: body,
    });
    expect(changed.json()).toMatchObject({ ok: true, countsRestarted: true });
    expect(byText(await setup(), 'Where is the report card?')).toMatchObject({ yes: 0, no: 0 });
    await vote(student, true);
    const same = await inject({
      method: 'PUT',
      url: `/helpdesk/family-help/questions/${card.id}`,
      headers: h(admin),
      json: { ...body, audience: 'parent' },
    });
    expect(same.json()).toMatchObject({ countsRestarted: false });
    expect(byText(await setup(), 'Where is the report card?')).toMatchObject({
      yes: 1,
      audience: 'parent',
    });
  });

  it('a deleted heading leaves its questions under “Other questions”', async () => {
    const s = await setup();
    const fees = s.headings.find((x) => x.title === 'Fees')!;
    const del = await inject({
      method: 'DELETE',
      url: `/helpdesk/family-help/headings/${fees.id}`,
      headers: h(admin),
    });
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true, questionsMoved: 1 });
    const after = await setup();
    expect(after.headings.map((x) => x.title)).not.toContain('Fees');
    expect(byText(after, 'I paid online but the receipt is not showing.').headingId).toBeNull();
    const other = (await family(parent)).groups.at(-1)!;
    expect(other.title).toBe('Other questions');
    expect(other.questions.map((q) => q.question)).toEqual([
      'Can I ask the assistant in Hindi?',
      'I paid online but the receipt is not showing.',
    ]);
    // a question cannot go under a deleted heading
    const lost = await inject({
      method: 'POST',
      url: '/helpdesk/family-help/questions',
      headers: h(admin),
      json: {
        headingId: fees.id,
        question: 'Fee due date?',
        answer: 'The 10th.',
        audience: 'both',
      },
    });
    expect(lost.statusCode).toBe(404);
    expect(after.standardMissing).toBe(1);
  });

  it('Restore puts back the deleted standard heading and questions', async () => {
    const s = await setup();
    const del = await inject({
      method: 'DELETE',
      url: `/helpdesk/family-help/questions/${byText(s, 'How do I change the language?').id}`,
      headers: h(admin),
    });
    expect(del.statusCode).toBe(200);
    expect((await setup()).standardMissing).toBe(2);
    const r = await inject({
      method: 'POST',
      url: '/helpdesk/family-help/restore',
      headers: h(admin),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ headings: 1, questions: 1 });
    const after = await setup();
    expect(after.standardMissing).toBe(0);
    expect(after.headings.at(-1)!.title).toBe('Fees');
    expect(byText(after, 'How do I change the language?').standard).toBe(true);
    // the receipt question stayed where the office left it; nothing twice
    expect(after.questions.filter((q) => q.question.startsWith('I paid online'))).toHaveLength(1);
    expect(
      (
        await inject({ method: 'POST', url: '/helpdesk/family-help/restore', headers: h(admin) })
      ).json(),
    ).toEqual({
      headings: 0,
      questions: 0,
    });
  });

  it('checks what is written', async () => {
    const bad = async (json: Record<string, unknown>) =>
      (
        await inject({
          method: 'POST',
          url: '/helpdesk/family-help/questions',
          headers: h(admin),
          json: {
            question: 'A fine question?',
            answer: 'A fine answer.',
            audience: 'both',
            ...json,
          },
        })
      ).statusCode;
    expect(await bad({ page: '/nowhere' })).toBe(400);
    expect(await bad({ page: '/help' })).toBe(400);
    expect(await bad({ question: 'Hi' })).toBe(400);
    expect(await bad({ answer: '' })).toBe(400);
    expect(await bad({ audience: 'staff' })).toBe(400);
    expect(
      (
        await inject({
          method: 'POST',
          url: '/helpdesk/family-help/headings',
          headers: h(admin),
          json: { title: '  ' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('only the helpdesk set-up right edits; each school keeps its own', async () => {
    expect(
      (await inject({ method: 'GET', url: '/helpdesk/family-help', headers: h(teacher) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await inject({
          method: 'POST',
          url: '/helpdesk/family-help/headings',
          headers: h(parent),
          json: { title: 'Mine' },
        })
      ).statusCode,
    ).toBe(403);
    const b = await setup(otherAdmin, other);
    expect(b.questions).toHaveLength(10);
    expect(b.headings.map((x) => x.title)).not.toContain('School bus');
    expect(
      (
        await inject({
          method: 'PUT',
          url: `/helpdesk/family-help/headings/${ids.bus}`,
          headers: h(otherAdmin, other),
          json: { title: 'Taken' },
        })
      ).statusCode,
    ).toBe(404);
  });
});
