/**
 * The family app's layout kept by the school (0407, docs/design/90): a school starts with the app as it was; the
 * office saves a draft (checked), families get it only once published; discard goes back; a person gets only what they
 * can open (a tab they cannot open gives its place to the next shortcut); a person's own Home shortcuts and reset; the
 * rights, the audit trail and the school boundary.
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

interface Group {
  key: string;
  label: string | null;
  labelHi: string | null;
  items: string[];
  hidden?: boolean;
}
interface Layout {
  tabs: string[];
  shortcuts: string[];
  cards: string[];
  academics: string[];
  menu?: Group[];
  hidden?: string[];
  academicsLabel?: string | null;
  academicsLabelHi?: string | null;
}
interface Mine {
  audience: string;
  tabs: Array<{ href: string; label: string; icon: string; labelHi?: string | null }>;
  academicsLabel: string;
  academicsLabelHi: string | null;
  shortcuts: Array<{ href: string; label: string; icon: string }>;
  ownShortcuts: boolean;
  cards: Array<{ key: string; label: string; labelHi: string; href: string }>;
  academics: Array<{ href: string; label: string }>;
  screens: Array<{ href: string }>;
  menu: Array<{
    key: string;
    label: string;
    labelHi: string | null;
    items: Array<{ href: string }>;
  }>;
  hidden: string[];
}
interface Setup {
  layouts: Record<
    'student' | 'parent',
    {
      draft: Layout;
      published: Layout;
      everPublished: boolean;
      publishedAt: string | null;
      publishedBy: string | null;
      changed: boolean;
    }
  >;
  catalogue: {
    screens: Record<'student' | 'parent', Array<{ href: string; label: string; icon: string }>>;
    cards: Array<{ key: string }>;
  };
}

const STUDENT_START: Layout = {
  tabs: ['/homework', '/timetable', '/results'],
  shortcuts: [
    '/attendance',
    '/homework',
    '/timetable',
    '/fees',
    '/calendar',
    '/date-sheet',
    '/notices',
    '/messages',
  ],
  cards: ['attendance_today', 'classes_today', 'homework_due', 'next_exam', 'notices'],
  academics: ['/attendance', '/homework', '/timetable', '/date-sheet', '/results', '/calendar'],
};

describe('family app layout (e2e)', () => {
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
  const hrefs = (xs: Array<{ href: string }>) => xs.map((x) => x.href);

  const setup = async (u: SeededUser = admin, sc: SeededSchool = school) => {
    const r = await inject({
      method: 'GET',
      url: '/platform/family-app-layout',
      headers: h(u, sc),
    });
    expect(r.statusCode).toBe(200);
    return r.json() as Setup;
  };
  const mine = async (u: SeededUser, kind: 'student' | 'parent') => {
    const r = await inject({ method: 'GET', url: `/me/app-layout?kind=${kind}`, headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Mine;
  };
  const save = (audience: string, json: Layout, u: SeededUser = admin) =>
    inject({
      method: 'PUT',
      url: `/platform/family-app-layout/${audience}`,
      headers: h(u),
      json,
    });
  const act = (audience: string, what: 'publish' | 'discard', u: SeededUser = admin) =>
    inject({
      method: 'POST',
      url: `/platform/family-app-layout/${audience}/${what}`,
      headers: h(u),
    });

  beforeAll(async () => {
    const s = stamp('FL');
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

  it('a school starts with the app as it was', async () => {
    const s = await setup();
    expect(s.layouts.student).toMatchObject({
      draft: STUDENT_START,
      published: STUDENT_START,
      everPublished: false,
      publishedAt: null,
      changed: false,
    });
    expect(s.layouts.parent.draft.tabs).toEqual(['academics', '/fees', '/messages']);
    // a student's layout cannot name the parents' screens; Home is never one
    expect(hrefs(s.catalogue.screens.student)).not.toContain('/queries');
    expect(hrefs(s.catalogue.screens.parent)).toContain('/queries');
    expect(hrefs(s.catalogue.screens.parent)).not.toContain('/');
    expect(s.catalogue.screens.student).toContainEqual({
      href: '/library',
      label: 'Library',
      icon: 'book',
    });
    expect(s.catalogue.cards).toHaveLength(8);

    const st = await mine(student, 'student');
    expect(hrefs(st.tabs)).toEqual(['/', '/homework', '/timetable', '/results', 'more']);
    expect(hrefs(st.shortcuts)).toEqual(STUDENT_START.shortcuts);
    expect(st.ownShortcuts).toBe(false);
    expect((st as Mine & { published: boolean }).published).toBe(false);
    expect(st.cards.map((c) => c.key)).toEqual(STUDENT_START.cards);
    expect(st.cards[0]).toMatchObject({ label: 'Attendance today', labelHi: 'आज की उपस्थिति' });
    expect(hrefs(st.screens)).not.toContain('/queries');
    // since 0409 (docs/design/91) a student may ask the assistant too
    expect(hrefs(st.screens)).toContain('/assistant');

    const pa = await mine(parent, 'parent');
    expect(hrefs(pa.tabs)).toEqual(['/', 'academics', '/fees', '/messages', 'more']);
    expect(pa.tabs[1]).toMatchObject({ label: 'Academics' });
    expect(hrefs(pa.shortcuts)).toContain('/queries');
    expect(hrefs(pa.academics)).toEqual(STUDENT_START.academics);
  });

  it('checks a layout before saving it', async () => {
    const bad = async (patch: Partial<Layout>, audience = 'student') => {
      const r = await save(audience, { ...STUDENT_START, ...patch });
      return r.statusCode === 400 ? (r.json().errors as string[]) : r.statusCode;
    };
    expect(await bad({ tabs: ['/homework', '/results'] })).toContain(
      'Choose three tabs between Home and More.',
    );
    expect(await bad({ shortcuts: ['/homework', '/results', '/library'] })).toContain(
      'Choose 4 to 12 Home shortcuts.',
    );
    expect(await bad({ cards: ['notices', 'weather'] })).toContain('weather is not a Home card.');
    expect(await bad({ cards: [] })).toContain('Choose at least one Home card.');
    expect(await bad({ tabs: ['/queries', '/homework', '/results'] })).toContain(
      '/queries cannot be a tab here.',
    );
    expect(
      await bad({ tabs: ['academics', '/homework', '/results'], academics: ['/homework'] }),
    ).toContain('With an Academics tab, its list needs at least two screens.');
    expect(await bad({ shortcuts: ['/', '/homework', '/results', '/library'] })).toContain(
      '/ cannot be a shortcut here.',
    );
    // the parents' screens are fine for parents
    expect(await bad({ tabs: ['/queries', '/homework', '/results'] }, 'parent')).toBe(200);
    expect((await save('staff', STUDENT_START)).statusCode).toBe(404);
  });

  it('a draft reaches families only when published; a tab they cannot open gives its place', async () => {
    const draft: Layout = {
      tabs: ['academics', '/assistant', '/results'],
      shortcuts: [
        '/attendance',
        '/library',
        '/assistant',
        '/health',
        '/certificates',
        '/transport',
        '/help',
        '/calendar',
      ],
      cards: ['notices', 'coming_up', 'library', 'homework_due'],
      academics: ['/timetable', '/homework', '/date-sheet'],
    };
    expect((await save('student', draft)).statusCode).toBe(200);
    const s = await setup();
    expect(s.layouts.student).toMatchObject({ draft, changed: true, everPublished: false });
    // not published: the student still has the app as it was
    expect(hrefs((await mine(student, 'student')).tabs)).toEqual([
      '/',
      '/homework',
      '/timetable',
      '/results',
      'more',
    ]);

    expect((await act('student', 'publish')).statusCode).toBe(200);
    const after = await setup();
    expect(after.layouts.student).toMatchObject({
      published: draft,
      everPublished: true,
      changed: false,
    });
    expect(after.layouts.student.publishedAt).toBeTruthy();

    const st = await mine(student, 'student');
    expect((st as Mine & { published: boolean }).published).toBe(true);
    // since 0409 the Assistant is a student's too (a hidden tab giving its place: the hidden-screens test)
    expect(hrefs(st.tabs)).toEqual(['/', 'academics', '/assistant', '/results', 'more']);
    expect(hrefs(st.shortcuts)).toEqual([
      '/attendance',
      '/library',
      '/assistant',
      '/health',
      '/certificates',
      '/transport',
      '/help',
      '/calendar',
    ]);
    expect(st.cards.map((c) => c.key)).toEqual(['notices', 'coming_up', 'library', 'homework_due']);
    expect(hrefs(st.academics)).toEqual(['/timetable', '/homework', '/date-sheet']);
    // the parents' layout is apart
    expect(hrefs((await mine(parent, 'parent')).tabs)).toEqual([
      '/',
      'academics',
      '/fees',
      '/messages',
      'more',
    ]);
    // a parent reading the students' layout gets their own rights on it (the Assistant is theirs)
    expect(hrefs((await mine(parent, 'student')).tabs)).toContain('/assistant');

    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'platform.family_layout.published'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBe(1);
  });

  it('discarding a draft goes back to what families have', async () => {
    const live = (await setup()).layouts.student.published;
    expect((await save('student', { ...live, cards: ['notices'] })).statusCode).toBe(200);
    expect((await setup()).layouts.student.changed).toBe(true);
    expect((await act('student', 'discard')).statusCode).toBe(200);
    const s = await setup();
    expect(s.layouts.student).toMatchObject({ draft: live, changed: false });
  });

  it('the Academics tab keeps the name the school gives it (docs/design/94, part 3)', async () => {
    const live = (await setup()).layouts.parent.published;
    const layout = { ...live, tabs: ['academics', '/fees', '/messages'] };
    const bad = await save('parent', { ...layout, academicsLabel: 'A name far too long here' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toContain("The Academics tab's name takes 1 to 20 letters.");
    expect(
      (await save('parent', { ...layout, academicsLabel: 'Studies', academicsLabelHi: 'पढ़ाई' }))
        .statusCode,
    ).toBe(200);
    // not before it is published
    expect((await mine(parent, 'parent')).academicsLabel).toBe('Academics');
    expect((await act('parent', 'publish')).statusCode).toBe(200);
    const pa = await mine(parent, 'parent');
    expect(pa).toMatchObject({ academicsLabel: 'Studies', academicsLabelHi: 'पढ़ाई' });
    expect(pa.tabs.find((x) => x.href === 'academics')).toMatchObject({
      label: 'Studies',
      labelHi: 'पढ़ाई',
    });
    // emptied: the standard name again
    expect(
      (await save('parent', { ...layout, academicsLabel: '', academicsLabelHi: null })).statusCode,
    ).toBe(200);
    expect((await act('parent', 'publish')).statusCode).toBe(200);
    expect(await mine(parent, 'parent')).toMatchObject({
      academicsLabel: 'Academics',
      academicsLabelHi: null,
    });
  });

  it('a person keeps their own Home shortcuts, and can go back to the school’s', async () => {
    const put = (shortcuts: string[], u: SeededUser = student, kind = 'student') =>
      inject({
        method: 'PUT',
        url: `/me/app-layout/shortcuts?kind=${kind}`,
        headers: h(u),
        json: { shortcuts },
      });
    const ok = await put(['/library', '/health', '/certificates', '/help', '/notices']);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ownShortcuts: true });
    expect(hrefs((ok.json() as Mine).shortcuts)).toEqual([
      '/library',
      '/health',
      '/certificates',
      '/help',
      '/notices',
    ]);
    // the school's next layout leaves them as they are
    const live = (await setup()).layouts.student.published;
    await save('student', { ...live, shortcuts: [...live.shortcuts].reverse() });
    await act('student', 'publish');
    expect(hrefs((await mine(student, 'student')).shortcuts)[0]).toBe('/library');
    // only screens the person can open, 4 to 12, once each
    expect((await put(['/library', '/health', '/help', '/queries'])).statusCode).toBe(400);
    expect((await put(['/library', '/health', '/help', '/nowhere'])).statusCode).toBe(400);
    expect((await put(['/library', '/health', '/help'])).statusCode).toBe(400);
    expect((await put(['/library', '/health', '/help', '/help'])).statusCode).toBe(400);
    // a parent's own are apart
    expect(
      (await put(['/queries', '/fees', '/appointments', '/consents'], parent, 'parent')).statusCode,
    ).toBe(200);
    expect((await mine(student, 'student')).ownShortcuts).toBe(true);

    const reset = await inject({
      method: 'DELETE',
      url: '/me/app-layout/shortcuts?kind=student',
      headers: h(student),
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ ownShortcuts: false });
    expect(hrefs((reset.json() as Mine).shortcuts)).toEqual([...live.shortcuts].reverse());
    expect((await mine(parent, 'parent')).ownShortcuts).toBe(true);
  });

  it('the side menu: groups in the school’s order, renamed, screens moved; the website and More follow once published', async () => {
    const start = (await setup()).layouts.parent.published;
    expect(start.menu!.map((g) => g.key)).toEqual(['child', 'school', 'fees', 'help']);
    expect(start.menu![0]).toMatchObject({ label: null, labelHi: null });
    expect(start.menu![0]!.items[0]).toBe('/profile');
    const bad = async (menu: Group[], audience = 'parent') => {
      const r = await save(audience, { ...start, menu });
      return r.statusCode === 400 ? (r.json().errors as string[]) : r.statusCode;
    };
    const without = (h: string) =>
      start.menu!.map((g) => ({ ...g, items: g.items.filter((x) => x !== h) }));
    expect(await bad(without('/library'))).toContain('/library is not in any menu group.');
    expect(
      await bad(
        start.menu!.map((g) => (g.key === 'fees' ? { ...g, items: [...g.items, '/library'] } : g)),
      ),
    ).toContain('A screen is in the menu twice.');
    expect(
      await bad([...start.menu!, { key: 'extra', label: null, labelHi: null, items: [] }]),
    ).toContain('extra is not a menu group.');
    expect(await bad(start.menu!.filter((g) => g.key !== 'fees'))).toContain(
      'The menu group fees is missing.',
    );
    expect(
      await bad(start.menu!.map((g) => (g.key === 'school' ? { ...g, label: 'x'.repeat(41) } : g))),
    ).toContain("A menu group's name takes 1 to 40 letters.");
    // a student's menu has no parents' screens
    const studentMenu = (await setup()).layouts.student.published.menu!;
    expect(
      await bad(
        studentMenu.map((g) => (g.key === 'help' ? { ...g, items: [...g.items, '/queries'] } : g)),
        'student',
      ),
    ).toContain('/queries cannot be in the menu here.');

    // Help desk first; School renamed (English and Hindi); Library moved under My child
    const byKey = Object.fromEntries(start.menu!.map((g) => [g.key, g]));
    const menu: Group[] = [
      byKey.help!,
      { ...byKey.child!, items: [...byKey.child!.items, '/library'] },
      {
        ...byKey.school!,
        label: 'Campus life',
        labelHi: 'परिसर',
        items: byKey.school!.items.filter((x) => x !== '/library'),
      },
      byKey.fees!,
    ];
    expect((await save('parent', { ...start, menu })).statusCode).toBe(200);
    // not published: the menu call is as built
    const before = await inject({ method: 'GET', url: '/me/menu?kind=parent', headers: h(parent) });
    expect(before.json().groups.map((g: { id: string }) => g.id)).toEqual([
      'home',
      'child',
      'school',
      'fees',
      'help',
    ]);
    expect((await act('parent', 'publish')).statusCode).toBe(200);

    const pa = await mine(parent, 'parent');
    expect(pa.menu.map((g) => g.key)).toEqual(['help', 'child', 'school', 'fees']);
    expect(pa.menu[1]).toMatchObject({ label: 'My child', labelHi: null });
    expect(pa.menu[2]).toMatchObject({ label: 'Campus life', labelHi: 'परिसर' });
    expect(hrefs(pa.menu[1]!.items).at(-1)).toBe('/library');
    expect(hrefs(pa.menu[2]!.items)).not.toContain('/library');
    // the app's More (the menu call) follows
    const more = await inject({ method: 'GET', url: '/me/menu?kind=parent', headers: h(parent) });
    const groups = more.json().groups as Array<{
      id: string;
      label: string;
      labelHi: string | null;
      items: Array<{ href: string }>;
    }>;
    expect(groups.map((g) => g.id)).toEqual(['home', 'help', 'child', 'school', 'fees']);
    expect(groups[3]).toMatchObject({ label: 'Campus life', labelHi: 'परिसर' });
    expect(hrefs(groups[2]!.items)).toContain('/library');
    // the students' menu is apart (its standard names)
    const st = await mine(student, 'student');
    expect(st.menu[0]).toMatchObject({ key: 'child', label: 'My school day' });

    // a layout kept before the menu could be arranged: the menu as built
    await withMigrator((c) =>
      c.query(
        `UPDATE family_app_layouts SET published = published - 'menu', draft = draft - 'menu' WHERE school_id = $1 AND audience = 'student'`,
        [school.id],
      ),
    );
    const old = await mine(student, 'student');
    expect(old.menu.map((g) => g.key)).toEqual(['child', 'school', 'fees', 'help']);
    expect((await setup()).layouts.student.draft.menu!.map((g) => g.key)).toEqual([
      'child',
      'school',
      'fees',
      'help',
    ]);
    expect((await setup()).layouts.student.changed).toBe(false);
  });

  it('hidden screens and groups are left out everywhere for families', async () => {
    const base = (await setup()).layouts.parent.published;
    const bad = async (patch: Partial<Layout>, audience = 'parent') => {
      const r = await save(audience, { ...base, ...patch });
      return r.statusCode === 400 ? (r.json().errors as string[]) : r.statusCode;
    };
    expect(await bad({ hidden: ['/nowhere'] })).toContain('/nowhere cannot be hidden here.');
    expect(await bad({ hidden: ['/hostel', '/hostel'] })).toContain('A screen is hidden twice.');
    const studentBase = (await setup()).layouts.student.published;
    expect(
      (await save('student', { ...studentBase, hidden: ['/queries'] })).json().errors,
    ).toContain('/queries cannot be hidden here.');

    // Hostel hidden (it is a tab and a shortcut) and the whole Help desk group hidden
    const layout: Layout = {
      ...base,
      tabs: ['/hostel', '/fees', '/messages'],
      shortcuts: ['/attendance', '/hostel', '/queries', '/library'],
      cards: ['notices', 'library'],
      menu: base.menu!.map((g) => (g.key === 'help' ? { ...g, hidden: true } : g)),
      hidden: ['/hostel'],
    };
    expect((await save('parent', layout)).statusCode).toBe(200);
    expect((await setup()).layouts.parent.draft).toMatchObject({ hidden: ['/hostel'] });
    expect((await act('parent', 'publish')).statusCode).toBe(200);

    const pa = await mine(parent, 'parent');
    expect(pa.hidden).toEqual(
      expect.arrayContaining([
        '/hostel',
        '/queries',
        '/appointments',
        '/gate-passes',
        '/consents',
        '/assistant',
        '/help',
      ]),
    );
    expect(hrefs(pa.screens)).not.toContain('/hostel');
    expect(hrefs(pa.screens)).not.toContain('/appointments');
    // the hidden tab gives its place to the first shortcut not yet a tab
    expect(hrefs(pa.tabs)).toEqual(['/', '/fees', '/messages', '/attendance', 'more']);
    // this parent's own shortcuts (an earlier test) lose the hidden screens
    expect(pa.ownShortcuts).toBe(true);
    expect(hrefs(pa.shortcuts)).toEqual(['/fees']);
    const school = await inject({
      method: 'DELETE',
      url: '/me/app-layout/shortcuts?kind=parent',
      headers: h(parent),
    });
    expect(hrefs((school.json() as Mine).shortcuts)).toEqual(['/attendance', '/library']);
    expect(pa.menu.map((g) => g.key)).not.toContain('help');
    expect(pa.menu.flatMap((g) => hrefs(g.items))).not.toContain('/hostel');
    // the app's More
    const more = await inject({ method: 'GET', url: '/me/menu?kind=parent', headers: h(parent) });
    const groups = more.json().groups as Array<{ id: string; items: Array<{ href: string }> }>;
    expect(groups.map((g) => g.id)).not.toContain('help');
    expect(groups.flatMap((g) => hrefs(g.items))).not.toContain('/hostel');
    // a person cannot pin a hidden screen
    const pin = await inject({
      method: 'PUT',
      url: '/me/app-layout/shortcuts?kind=parent',
      headers: h(parent),
      json: { shortcuts: ['/attendance', '/library', '/fees', '/hostel'] },
    });
    expect(pin.statusCode).toBe(400);
    expect(pin.json().errors).toContain('/hostel is not a screen you can open.');
    // Help leaves out the questions about hidden screens
    const help = await inject({
      method: 'GET',
      url: '/engagement/help?for=parent',
      headers: h(parent),
    });
    const questions = (
      help.json().groups as Array<{ questions: Array<{ question: string }> }>
    ).flatMap((g) => g.questions.map((q) => q.question));
    expect(questions).not.toContain('How do I ask to meet a teacher?');
    expect(questions).toContain('Where is the report card?');
    // the students are apart: nothing hidden for them
    expect((await mine(student, 'student')).hidden).toEqual([]);
  });

  it('only the settings rights arrange it; each school keeps its own', async () => {
    expect(
      (await inject({ method: 'GET', url: '/platform/family-app-layout', headers: h(teacher) }))
        .statusCode,
    ).toBe(403);
    expect((await save('student', STUDENT_START, parent)).statusCode).toBe(403);
    expect((await act('student', 'publish', teacher)).statusCode).toBe(403);
    const b = await setup(otherAdmin, other);
    expect(b.layouts.student).toMatchObject({ draft: STUDENT_START, everPublished: false });
  });
});
