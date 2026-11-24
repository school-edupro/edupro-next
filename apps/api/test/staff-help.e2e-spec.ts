/**
 * Help for staff kept by the school (0422), beside the families' Help (0406): a school starts with the standard staff
 * headings and questions (once), apart from the families'; the office adds, changes, hides, orders and deletes them
 * by the same routes; a staff member reads only the shown ones and not those about a screen their rights do not open;
 * a staff question's heading and screen are the staff's; "Was this helpful?" works the same; Restore; the rights and
 * the school boundary.
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
  app: string;
  headings: Array<{ id: string; title: string; titleHi: string | null; standard: boolean }>;
  questions: Question[];
  pages: Array<{ href: string; label: string }>;
  standardMissing: number;
}
interface Help {
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

describe('staff help (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let otherAdmin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  const h = (u: SeededUser, sc: SeededSchool = school) => headersFor(u.sub, sc.id);

  const setup = async (u: SeededUser = admin, sc: SeededSchool = school) => {
    const r = await inject({ method: 'GET', url: '/helpdesk/staff-help', headers: h(u, sc) });
    expect(r.statusCode).toBe(200);
    return r.json() as Setup;
  };
  const read = async (u: SeededUser = teacher) => {
    const r = await inject({ method: 'GET', url: '/engagement/staff-help', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Help;
  };
  const questionsOf = (x: Help) => x.groups.flatMap((g) => g.questions.map((q) => q.question));
  const byText = (s: Setup, text: string) => s.questions.find((q) => q.question === text)!;
  const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, u = admin) =>
    inject({ method, url, headers: h(u), ...(payload ? { json: payload } : {}) });

  beforeAll(async () => {
    const s = stamp('SH');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      otherAdmin = await seedUser(c, other, `${s}-admin-b`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('a school starts with the standard staff headings and questions, once, apart from the families’', async () => {
    const first = await setup();
    expect(first.app).toBe('staff');
    expect(first.headings.map((x) => x.title)).toEqual([
      'My classes and attendance',
      'Marks and exams',
      'Families and queries',
      'Using the app and the website',
    ]);
    expect(first.headings.every((x) => x.standard && x.titleHi)).toBe(true);
    expect(first.questions).toHaveLength(9);
    expect(first.standardMissing).toBe(0);
    expect(byText(first, 'Marks entry is locked.')).toMatchObject({
      audience: 'both',
      page: '/marks',
      hidden: false,
      standard: true,
    });
    // the screens a question may be about: the staff menu without Home and Help, plain paths only
    expect(first.pages).toContainEqual({ href: '/marks', label: expect.any(String) as string });
    expect(first.pages.map((p) => p.href)).not.toContain('/help');
    expect(first.pages.every((p) => /^\/[a-z][a-z-]{1,39}$/.test(p.href))).toBe(true);
    expect((await setup()).questions).toHaveLength(9);
    // the families' Help is its own list
    const fam = await inject({ method: 'GET', url: '/helpdesk/family-help', headers: h(admin) });
    const famQ = (fam.json() as Setup).questions.map((q) => q.question);
    expect(famQ).not.toContain('Marks entry is locked.');
    expect(famQ).toHaveLength(10);
  });

  it('a teacher reads the staff questions under headings, in both languages', async () => {
    const x = await read();
    expect(x.audience).toBe('staff');
    expect(x.groups[0]).toMatchObject({
      title: 'My classes and attendance',
      titleHi: 'मेरी कक्षाएँ और उपस्थिति',
    });
    expect(questionsOf(x)).toContain('How do I change the language?');
    const marks = x.groups.flatMap((g) => g.questions).find((q) => q.page === '/marks');
    expect(marks).toMatchObject({ pageLabel: expect.any(String) as string, myVote: null });
    // the families' Help is not the staff's
    expect(questionsOf(x)).not.toContain('How do I apply for leave?');
  });

  it('the office adds a staff heading and question; hidden, it is gone; a screen the teacher cannot open is left out', async () => {
    const hd = await send('POST', '/helpdesk/staff-help/headings', {
      title: 'Hostel duty',
      titleHi: 'छात्रावास ड्यूटी',
    });
    expect(hd.statusCode).toBe(201);
    const headingId = (hd.json() as { id: string }).id;
    const q = await send('POST', '/helpdesk/staff-help/questions', {
      headingId,
      question: 'Who marks the night roll call?',
      answer: 'The warden on duty marks it on Hostel.',
      page: '/hostel',
      audience: 'parent', // a staff question is for every staff member
    });
    expect(q.statusCode).toBe(201);
    const qid = (q.json() as { id: string }).id;
    const s = await setup();
    expect(byText(s, 'Who marks the night roll call?')).toMatchObject({
      headingId,
      audience: 'both',
      page: '/hostel',
    });
    // a subject teacher has no hostel rights: the question about Hostel is left out for them
    expect(questionsOf(await read())).not.toContain('Who marks the night roll call?');
    // about no screen, they see it
    const put = await send('PUT', `/helpdesk/family-help/questions/${qid}`, {
      headingId,
      question: 'Who marks the night roll call?',
      answer: 'The warden on duty marks it on Hostel.',
      page: null,
    });
    expect(put.statusCode).toBe(200);
    expect(questionsOf(await read())).toContain('Who marks the night roll call?');
    // hidden: gone
    await send('PUT', `/helpdesk/family-help/questions/${qid}`, {
      headingId,
      question: 'Who marks the night roll call?',
      answer: 'The warden on duty marks it on Hostel.',
      hidden: true,
    });
    expect(questionsOf(await read())).not.toContain('Who marks the night roll call?');
    // not in the families' Help
    const fam = await inject({ method: 'GET', url: '/helpdesk/family-help', headers: h(admin) });
    expect((fam.json() as Setup).headings.map((x) => x.title)).not.toContain('Hostel duty');
  });

  it('a staff question’s heading and screen are the staff’s', async () => {
    const famHeading = (
      (
        await inject({ method: 'GET', url: '/helpdesk/family-help', headers: h(admin) })
      ).json() as Setup
    ).headings[0]!.id;
    const wrongHeading = await send('POST', '/helpdesk/staff-help/questions', {
      headingId: famHeading,
      question: 'A question here?',
      answer: 'An answer here.',
    });
    expect(wrongHeading.statusCode).toBe(400);
    // a family screen is not a staff screen
    const wrongPage = await send('POST', '/helpdesk/staff-help/questions', {
      question: 'A question here?',
      answer: 'An answer here.',
      page: '/fees',
    });
    expect(wrongPage.statusCode).toBe(400);
    // and a staff screen is not a family one
    const famWrong = await send('POST', '/helpdesk/family-help/questions', {
      question: 'A question here?',
      answer: 'An answer here.',
      page: '/marks',
    });
    expect(famWrong.statusCode).toBe(400);
  });

  it('orders within the staff Help; “Was this helpful?” for staff', async () => {
    const s = await setup();
    const second = s.headings[1]!;
    const up = await send('POST', `/helpdesk/family-help/headings/${second.id}/move`, {
      direction: 'up',
    });
    expect(up.statusCode).toBe(200);
    expect((await setup()).headings[0]!.id).toBe(second.id);
    const q = byText(s, 'Marks entry is locked.');
    const v = await send('POST', `/engagement/help/${q.id}/vote`, { helpful: false }, teacher);
    expect(v.statusCode).toBe(200);
    expect(byText(await setup(), 'Marks entry is locked.')).toMatchObject({ yes: 0, no: 1 });
    const mine = (await read()).groups.flatMap((g) => g.questions).find((x) => x.id === q.id);
    expect(mine?.myVote).toBe(false);
  });

  it('Restore puts back a deleted standard staff question', async () => {
    const q = byText(await setup(), 'Homework posted by mistake.');
    expect((await send('DELETE', `/helpdesk/family-help/questions/${q.id}`)).statusCode).toBe(200);
    expect((await setup()).standardMissing).toBe(1);
    const r = await send('POST', '/helpdesk/staff-help/restore', {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ headings: 0, questions: 1 });
    expect(byText(await setup(), 'Homework posted by mistake.')).toBeTruthy();
  });

  it('only the helpdesk set-up right edits; each school keeps its own', async () => {
    for (const [method, url] of [
      ['GET', '/helpdesk/staff-help'],
      ['POST', '/helpdesk/staff-help/headings'],
      ['POST', '/helpdesk/staff-help/questions'],
      ['POST', '/helpdesk/staff-help/restore'],
    ] as const) {
      const r = await inject({
        method,
        url,
        headers: h(teacher),
        ...(method === 'POST' ? { json: { title: 'X', question: 'Abc?', answer: 'Abc.' } } : {}),
      });
      expect(r.statusCode).toBe(403);
    }
    const mine = await setup();
    const theirs = await setup(otherAdmin, other);
    expect(theirs.headings.map((x) => x.title)).not.toContain('Hostel duty');
    expect(theirs.questions.map((q) => q.id)).not.toContain(mine.questions[0]!.id);
    // another school's admin cannot touch this school's question
    const cross = await inject({
      method: 'DELETE',
      url: `/helpdesk/family-help/questions/${mine.questions[0]!.id}`,
      headers: h(otherAdmin, other),
    });
    expect(cross.statusCode).toBe(404);
    // the staff's Help is for staff: a parent reads the families' Help
    const p = await inject({ method: 'GET', url: '/engagement/staff-help', headers: h(parent) });
    expect(p.statusCode).toBe(403);
  });
});
