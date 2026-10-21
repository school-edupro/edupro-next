/**
 * Library set-up review (0213, docs/design/36-library.md): names put right in place (the titles' names
 * follow); a duplicate merged into the row kept (an author named twice on a title keeps one line; a
 * subject's sub-subjects joined; periodicals and subscriptions move; the duplicate removed); an
 * accession series and a shelf keep their library once used; periodical kinds as the school's list; a
 * staff rule by employee type; where each drop-down's list is kept; one row by its id.
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

describe('library set-up corrections (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let librarian: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const save = (
    master: string,
    values: Record<string, unknown>,
    id?: string | null,
    u?: SeededUser,
  ) => call('POST', `/masters/${master}/rows`, { ...(id ? { id } : {}), values }, u);
  const rows = async (master: string, q?: string) =>
    (
      await call('GET', `/masters/${master}/rows?size=200${q ? `&q=${encodeURIComponent(q)}` : ''}`)
    ).json().data as Array<Record<string, string | null>>;
  const row = async (master: string, match: (r: Record<string, string | null>) => boolean) =>
    (await rows(master)).find(match)!;
  const merge = (master: string, keep: string, from: string, u?: SeededUser) =>
    call('POST', `/masters/${master}/rows/${keep}/merge`, { from }, u);
  const titleNames = async (id: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<Record<string, string | null>>(
            `SELECT author, publisher, language, category, sub_subject FROM library_titles WHERE id = $1`,
            [id],
          )
        ).rows[0]!,
    );
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const s = stamp('LSC');
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id;
    ids.text = setup.materialTypes.find((x: { code: string }) => x.code === 'TEXT').id;
    expect(
      (await save('library_subjects', { name: 'Fiction', sub_subjects: 'Novel' })).statusCode,
    ).toBe(201);
    expect(
      (await save('library_subjects', { name: 'Ficton', sub_subjects: 'Short stories' }))
        .statusCode,
    ).toBe(201);
    expect((await save('library_languages', { name: 'Englsh' })).statusCode).toBe(201);
    const subjects = (await call('GET', '/library/books/setup')).json();
    const subject = (n: string) =>
      subjects.subjects.find((x: { name: string }) => x.name === n).id as string;
    const language = (n: string) =>
      subjects.languages.find((x: { name: string }) => x.name === n).id as string;
    // three books: the right author and a misspelt one, and a book naming both
    const add = async (title: string, people: string[], extra: Record<string, unknown>) => {
      const r = await call('POST', '/library/books', {
        title,
        people: people.map((name) => ({ name })),
        materialTypeId: ids.book,
        copies: { libraryId: ids.main, count: 1, accessionedOn: '2026-01-10' },
        ...extra,
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    ids.t1 = await add('Malgudi Days', ['R. K. Narayan'], {
      subjectId: subject('Fiction'),
      publisher: 'Penguin India',
      languageId: language('English'),
    });
    ids.t2 = await add('The Guide', ['R.K. Narayan'], {
      subjectId: subject('Ficton'),
      subSubject: 'Short stories',
      publisher: 'Pengiun India',
      languageId: language('Englsh'),
    });
    ids.t3 = await add('Swami and Friends', ['R. K. Narayan', 'R.K. Narayan'], {});
  });
  afterAll(async () => app.close());

  it('a name put right in place: the books follow; a name another row has is refused', async () => {
    const a = await row('library_authors', (r) => r.name === 'R. K. Narayan');
    expect(a.titles).toBe('2');
    expect((await save('library_authors', { name: 'R K Narayan' }, a.id)).statusCode).toBe(201);
    expect((await titleNames(ids.t1!)).author).toBe('R K Narayan');
    expect((await titleNames(ids.t3!)).author).toBe('R K Narayan, R.K. Narayan');
    // the other spelling is another row: renaming onto it (any case) is refused
    const dup = await save('library_authors', { name: 'r.k. narayan' }, a.id);
    expect(dup.statusCode).toBe(400);
    expect(dup.json().detail).toContain('another row already has this Author');
    const p = await row('library_publishers', (r) => r.name === 'Pengiun India');
    expect((await save('library_publishers', { name: 'Penguin Books' }, p.id)).statusCode).toBe(
      201,
    );
    expect((await titleNames(ids.t2!)).publisher).toBe('Penguin Books');
    const l = await row('library_languages', (r) => r.name === 'Englsh');
    expect((await save('library_languages', { name: 'English (UK)' }, l.id)).statusCode).toBe(201);
    expect((await titleNames(ids.t2!)).language).toBe('English (UK)');
    const sub = await row('library_subjects', (r) => r.name === 'Ficton');
    expect(
      (
        await save(
          'library_subjects',
          { name: 'Fiction stories', sub_subjects: 'Short stories' },
          sub.id,
        )
      ).statusCode,
    ).toBe(201);
    expect((await titleNames(ids.t2!)).category).toBe('Fiction stories');
    // the edit form opens one row by its id
    const one = (await call('GET', `/masters/library_authors/rows?id=${a.id}&size=1`)).json();
    expect(one.data).toEqual([expect.objectContaining({ id: a.id, name: 'R K Narayan' })]);
  });

  it('a duplicate merged into the row kept: its books move, one line per title, it is removed', async () => {
    const keep = await row('library_authors', (r) => r.name === 'R K Narayan');
    // the coordinator may not; the row itself, or a name not there, is refused
    expect((await merge('library_authors', keep.id!, 'R.K. Narayan', coordinator)).statusCode).toBe(
      403,
    );
    const self = await merge('library_authors', keep.id!, 'r k narayan');
    expect(self.statusCode).toBe(400);
    expect(self.json().detail).toContain('cannot be merged into itself');
    expect((await merge('library_authors', keep.id!, 'Nobody')).json().detail).toContain(
      'no row named',
    );
    const r = await merge('library_authors', keep.id!, 'r.k. narayan', librarian);
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      kept: 'R K Narayan',
      merged: 'R.K. Narayan',
      moved: 1,
      titles: 2,
    });
    expect((await rows('library_authors')).map((x) => x.name)).toEqual(['R K Narayan']);
    expect((await titleNames(ids.t2!)).author).toBe('R K Narayan');
    expect((await titleNames(ids.t3!)).author).toBe('R K Narayan');
    expect((await row('library_authors', () => true)).titles).toBe('3');
    // a subject: its books and sub-subjects move
    const fiction = await row('library_subjects', (x) => x.name === 'Fiction');
    expect((await merge('library_subjects', fiction.id!, 'Fiction stories')).statusCode).toBe(201);
    expect(await row('library_subjects', (x) => x.name === 'Fiction')).toMatchObject({
      sub_subjects: 'Novel,Short stories',
      titles: '2',
    });
    expect(await titleNames(ids.t2!)).toMatchObject({
      category: 'Fiction',
      sub_subject: 'Short stories',
    });
    // a publisher and a language: books and periodicals move
    expect(
      (
        await save('library_periodicals', {
          name: 'Science Reporter',
          publisher_id: 'Penguin Books',
          language_id: 'English (UK)',
        })
      ).statusCode,
    ).toBe(201);
    const penguin = await row('library_publishers', (x) => x.name === 'Penguin India');
    expect((await merge('library_publishers', penguin.id!, 'Penguin Books')).json()).toMatchObject({
      moved: 2,
    });
    const english = await row('library_languages', (x) => x.name === 'English');
    expect((await merge('library_languages', english.id!, 'English (UK)')).json()).toMatchObject({
      moved: 2,
    });
    expect(await titleNames(ids.t2!)).toMatchObject({
      publisher: 'Penguin India',
      language: 'English',
    });
    expect(await row('library_periodicals', (x) => x.name === 'Science Reporter')).toMatchObject({
      publisher_id: 'Penguin India',
      language_id: 'English',
    });
    // a master without merging refuses
    const main = await row('library_libraries', () => true);
    expect((await merge('library_libraries', main.id!, 'X')).statusCode).toBe(400);
  });

  it('periodicals: kinds are the school’s list; a periodical renamed; subscriptions move on a merge', async () => {
    expect((await rows('library_periodical_kinds')).map((k) => k.name)).toEqual([
      'Magazine',
      'Newspaper',
      'Journal',
      'Bulletin',
    ]);
    expect((await save('library_periodical_kinds', { name: 'Employment news' })).statusCode).toBe(
      201,
    );
    const sr = await row('library_periodicals', (x) => x.name === 'Science Reporter');
    expect(
      (
        await save(
          'library_periodicals',
          { name: 'Science Reporter (CSIR)', kind_id: 'Magazine', frequency: 'Monthly' },
          sr.id,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await save('library_periodicals', {
          name: 'Sci Reporter',
          kind_id: 'Employment news',
          frequency: 'Monthly',
        })
      ).statusCode,
    ).toBe(201);
    expect((await save('library_periodicals', { name: 'Bad', kind_id: 'Comic' })).statusCode).toBe(
      400,
    );
    const kinds = await rows('library_periodical_kinds');
    expect(kinds.find((k) => k.name === 'Magazine')!.periodicals).toBe('1');
    const setup = (await call('GET', '/library/subscriptions/setup')).json();
    const dup = setup.periodicals.find((p: { name: string }) => p.name === 'Sci Reporter');
    expect(dup.kind).toBe('Employment news');
    const sub = await call('POST', '/library/subscriptions', {
      periodicalId: dup.id,
      libraryId: setup.libraries[0].id,
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
      frequency: 'Monthly',
    });
    expect(sub.statusCode).toBe(201);
    const keep = await row('library_periodicals', (x) => x.name === 'Science Reporter (CSIR)');
    expect((await merge('library_periodicals', keep.id!, 'Sci Reporter')).json()).toMatchObject({
      moved: 1,
    });
    const view = (await call('GET', `/library/subscriptions/${sub.json().id as string}`)).json();
    expect(view).toMatchObject({ periodical: 'Science Reporter (CSIR)', kind: 'Magazine' });
  });

  it('an accession series and a shelf keep their library once used; a shelf code can always change', async () => {
    const book = await row('library_accession_series', (x) =>
      (x.material_type_id ?? '').startsWith('BOOK'),
    );
    expect(book.copies).toBe('3');
    const refused = await save(
      'library_accession_series',
      { library_id: 'MAIN', material_type_id: 'MAG', prefix: 'B' },
      book.id,
    );
    expect(refused.statusCode).toBe(400);
    expect(refused.json().detail).toContain('copies are numbered from this series');
    // the textbook series has no copies: it may move to another type
    const text = await row('library_accession_series', (x) =>
      (x.material_type_id ?? '').startsWith('TEXT'),
    );
    expect(text.copies).toBe('0');
    expect(
      (await save('library_libraries', { code: 'JR', name: 'Junior library' })).statusCode,
    ).toBe(201);
    expect(
      (
        await save(
          'library_accession_series',
          { library_id: 'JR', material_type_id: 'TEXT', prefix: 'JT' },
          text.id,
        )
      ).statusCode,
    ).toBe(201);
    expect(await row('library_accession_series', (x) => x.id === text.id)).toMatchObject({
      library_id: 'JR · Junior library',
    });
    // a shelf with a copy on it
    expect((await save('library_shelves', { library_id: 'MAIN', code: 'A3' })).statusCode).toBe(
      201,
    );
    const shelf = await row('library_shelves', (x) => x.code === 'A3');
    const v = (await call('GET', `/library/books/${ids.t1!}`)).json();
    const copy = v.copies[0];
    expect(
      (
        await call('PUT', `/library/copies/${copy.id as string}`, {
          libraryId: ids.main,
          shelfId: shelf.id,
        })
      ).statusCode,
    ).toBe(200);
    expect((await row('library_shelves', (x) => x.id === shelf.id)).copies).toBe('1');
    expect(
      (await save('library_shelves', { library_id: 'MAIN', code: 'A-3' }, shelf.id)).statusCode,
    ).toBe(201);
    const moved = await save('library_shelves', { library_id: 'JR', code: 'A-3' }, shelf.id);
    expect(moved.statusCode).toBe(400);
    expect(moved.json().detail).toContain('copies sit on this shelf');
    expect((await save('library_shelves', { library_id: 'MAIN', code: 'B1' })).statusCode).toBe(
      201,
    );
    const empty = await row('library_shelves', (x) => x.code === 'B1');
    expect(
      (await save('library_shelves', { library_id: 'JR', code: 'B1' }, empty.id)).statusCode,
    ).toBe(201);
  });

  it('a staff rule by employee type: before the staff group; not both on one rule', async () => {
    const both = await save('library_borrow_rules', {
      applies_to: 'Employee',
      employee_type_id: 'teaching_contract',
      staff_group: 'Contract',
      max_books: 1,
      loan_days: 7,
    });
    expect(both.statusCode).toBe(400);
    expect(both.json().detail).toContain('an employee type or a staff group, not both');
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Employee',
          employee_type_id: 'Teaching Contract',
          max_books: 1,
          loan_days: 7,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Employee',
          staff_group: 'Contract',
          max_books: 2,
          loan_days: 15,
        })
      ).statusCode,
    ).toBe(201);
    // a student rule drops an employee type
    expect(
      (
        await save('library_borrow_rules', {
          applies_to: 'Hostel student',
          employee_type_id: 'visiting',
          max_books: 3,
          loan_days: 21,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await rows('library_borrow_rules')).find((r) => r.applies_to === 'Hostel student'),
    ).toMatchObject({ employee_type_id: null });
    const people: Record<string, string> = {};
    await withMigrator(async (c) => {
      for (const [k, code, profile] of [
        ['typed', 'C1', { staff_type: 'Teaching Contract' }],
        ['group', 'C2', { staff_type: 'Non-Teaching Contract' }],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type, profile)
           VALUES ($1, $2, 'Staff', 'contract', $3) RETURNING id::text`,
          [school.id, `${s}-${code}`, JSON.stringify(profile)],
        );
        people[k] = e.rows[0]!.id;
      }
    });
    const v = (await call('GET', `/library/books/${ids.t3!}`)).json();
    await call('POST', `/library/books/${ids.t3!}/copies`, {
      libraryId: ids.main,
      count: 2,
      accessionedOn: '2026-01-11',
    });
    const copies = (await call('GET', `/library/books/${ids.t3!}`)).json().copies as Array<{
      accessionNo: string;
    }>;
    expect(copies.length).toBe(v.copies.length + 2);
    const issue = (n: number, who: string) =>
      call('POST', '/library/loans/issue', {
        accessionNo: copies[n]!.accessionNo,
        borrowerKind: 'employee',
        borrowerId: who,
      });
    const typed = await issue(0, people.typed!);
    expect(typed.statusCode).toBe(201);
    const later = await issue(1, people.typed!);
    expect(later.json()).toMatchObject({ type: 'library.limit' });
    expect(later.json().detail).toContain('Staff · Teaching Contract');
    const group = await issue(1, people.group!);
    expect(group.statusCode).toBe(201);
    expect(typed.json().dueOn).toBe(day(7));
    expect(group.json().dueOn).toBe(day(15));
  });

  it('where each drop-down’s list is kept, and whether the user may open it', async () => {
    const reg = (u: SeededUser) =>
      call('GET', '/masters', undefined, u).then((r) => {
        const j = r.json();
        return (j.data ?? j) as Array<{
          id: string;
          sources: Record<string, unknown>;
          merge: unknown;
        }>;
      });
    const lib = await reg(librarian);
    const periodicals = lib.find((m) => m.id === 'library_periodicals')!;
    expect(periodicals.merge).toMatchObject({ note: expect.stringContaining('subscriptions') });
    expect(periodicals.sources).toMatchObject({
      kind_id: {
        id: 'library_periodical_kinds',
        groupTitle: 'Library setup',
        title: 'Periodical kinds',
        canView: true,
      },
      language_id: { id: 'library_languages', group: 'library', title: 'Languages', canView: true },
    });
    const rules = lib.find((m) => m.id === 'library_borrow_rules')!;
    expect(rules.sources).toMatchObject({
      class_id: { group: 'academics', title: 'Classes' },
      employee_type_id: { group: 'staff', title: 'Employee types' },
    });
    expect(lib.find((m) => m.id === 'library_vendors')!.merge).toBeNull();
    const merging = (await call('GET', '/masters/library_authors/lookups?merge=1')).json();
    expect(merging.__merge.map((o: { value: string }) => o.value)).toEqual(['R K Narayan']);
  });
});
