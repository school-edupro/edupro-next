/**
 * Correcting an accession number (0214, docs/design/36-library.md, part 2): one copy or a range, a
 * preview first with what stands in the way; the old number retired (no series, typed number or other
 * copy takes it) yet still naming the copy at the desk, in a stock check and in a search; a copy may go
 * back to a number it had; the change in the copy's history; only the library manager corrects.
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

describe('library accession corrections (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let librarian: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? librarian).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const preview = (body: Record<string, unknown>) =>
    call('POST', '/library/accession/preview', body);
  const apply = (body: Record<string, unknown>, u?: SeededUser) =>
    call('POST', '/library/accession/apply', { reason: 'Typed wrong at accessioning', ...body }, u);
  const s = stamp('LAC');
  const ids: Record<string, string> = {};
  const copyOf = async (titleId: string, acc: string) =>
    (
      (await call('GET', `/library/books/${titleId}`)).json().copies as Array<{
        id: string;
        accessionNo: string;
        former: string[];
      }>
    ).find((x) => x.accessionNo === acc)!;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      librarian = await seedUser(c, school, `${s}-lib`, 'librarian');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      ids.employee = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, employee_type)
           VALUES ($1, $2, 'Meena', 'teaching') RETURNING id::text`,
          [school.id, `${s}-E1`],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.library = setup.libraries[0].id;
    ids.book = setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id;
    const add = async (title: string, count: number) => {
      const r = await call('POST', '/library/books', {
        title,
        people: [{ name: 'R. K. Narayan' }],
        materialTypeId: ids.book,
        copies: { libraryId: ids.library, count, accessionedOn: '2026-01-10' },
      });
      expect(r.statusCode).toBe(201);
      return r.json() as { id: string; accessionNos: string[] };
    };
    ids.malgudi = (await add('Malgudi Days', 5)).id; // B00001–B00005
    ids.guide = (await add('The Guide', 3)).id; // B00006–B00008
  });
  afterAll(async () => app.close());

  it('one copy: previewed, changed with a reason; the old number names it at the desk and in a search', async () => {
    const p = await preview({ from: 'b00002', start: 'B00102' });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({
      copies: 1,
      problems: 0,
      rows: [{ old: 'B00002', new: 'B00102', title: 'Malgudi Days', problem: null }],
    });
    expect((await apply({ from: 'B00002', start: 'B00102' }, coordinator)).statusCode).toBe(403);
    expect(
      (await call('POST', '/library/accession/apply', { from: 'B00002', start: 'B00102' }))
        .statusCode,
    ).toBe(400);
    const r = await apply({ from: 'B00002', start: 'B00102' });
    expect(r.json()).toEqual({ changed: 1, numbers: ['B00102'] });
    expect((await copyOf(ids.malgudi!, 'B00102')).former).toEqual(['B00002']);
    const events = (await call('GET', `/library/books/${ids.malgudi}`)).json().events;
    expect(events[0]).toMatchObject({
      accessionNo: 'B00102',
      what: 'renumbered',
      reason: 'From B00002 to B00102: Typed wrong at accessioning',
    });
    // the old label at the desk
    const issued = await call('POST', '/library/loans/issue', {
      accessionNo: 'B00002',
      borrowerKind: 'employee',
      borrowerId: ids.employee,
    });
    expect(issued.statusCode).toBe(201);
    expect(issued.json().accessionNo).toBe('B00102');
    expect(
      (await call('POST', '/library/loans/return', { accessionNo: 'B00102' })).statusCode,
    ).toBe(201);
    // the register finds it by the old number and shows it
    const g = await call('POST', '/library/register/copies', {
      search: 'B00002',
      columns: [{ key: 'former_nos' }],
    });
    expect(g.json().rows).toEqual([
      expect.objectContaining({ accession_no: 'B00102', former_nos: 'B00002' }),
    ]);
    // an old number is not a copy's any more
    const gone = await preview({ from: 'B00002', start: 'B00302' });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().detail).toContain('was changed to B00102');
  });

  it('a retired number: not typed, not given by the series, not taken by another copy; its own copy may go back', async () => {
    const typed = await call('POST', `/library/books/${ids.guide}/copies`, {
      libraryId: ids.library,
      accessionNos: ['B00002'],
    });
    expect(typed.statusCode).toBe(409);
    expect(typed.json().detail).toContain('retired');
    // the series back at 1: it passes the copies' numbers and the retired one
    await withMigrator((c) =>
      c.query(`UPDATE library_accession_series SET next_no = 1 WHERE school_id = $1`, [school.id]),
    );
    const more = await call('POST', `/library/books/${ids.guide}/copies`, {
      libraryId: ids.library,
      count: 2,
    });
    expect(more.json().accessionNos).toEqual(['B00009', 'B00010']);
    const taken = await preview({ from: 'B00001', start: 'B00002' });
    expect(taken.json().rows[0].problem).toBe('B00002 was used before and is retired');
    // the copy itself goes back to its number; then the other one is retired
    expect(
      (await apply({ from: 'B00102', start: 'B00002', reason: 'Changed by mistake' })).statusCode,
    ).toBe(200);
    expect((await copyOf(ids.malgudi!, 'B00002')).former).toEqual(['B00102']);
    expect((await preview({ from: 'B00001', start: 'B00102' })).json().rows[0].problem).toBe(
      'B00102 was used before and is retired',
    );
  });

  it('a range moved in one go, in order; one that would collide is refused whole', async () => {
    const p = await preview({ from: 'B00006', to: 'B00008', start: 'B00206' });
    expect(p.json().rows.map((r: { old: string; new: string }) => `${r.old}>${r.new}`)).toEqual([
      'B00006>B00206',
      'B00007>B00207',
      'B00008>B00208',
    ]);
    expect((await apply({ from: 'B00006', to: 'B00008', start: 'B00206' })).json().changed).toBe(3);
    const clash = await preview({ from: 'B00003', to: 'B00005', start: 'B00004' });
    expect(clash.json().rows.map((r: { problem: string }) => r.problem)).toEqual([
      "B00004 is another copy's number in this correction: an old number is not given out again",
      "B00005 is another copy's number in this correction: an old number is not given out again",
      'B00006 was used before and is retired',
    ]);
    const refused = await apply({ from: 'B00003', to: 'B00005', start: 'B00004' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().detail).toContain('Nothing was changed');
    expect((await copyOf(ids.malgudi!, 'B00003')).former).toEqual([]);
    expect((await preview({ from: 'B00003', to: 'C00005', start: 'B00403' })).statusCode).toBe(400);
    expect((await preview({ from: 'B00005', to: 'B00003', start: 'B00403' })).statusCode).toBe(400);
    expect((await preview({ from: 'B00500', to: 'B00510', start: 'B00600' })).statusCode).toBe(400);
    expect((await preview({ from: 'X1', start: 'X2' })).statusCode).toBe(404);
  });

  it('a stock check takes the old labels; the latest corrections are listed', async () => {
    const chk = await call('POST', '/library/stock/cycles', { name: 'Term check' });
    const scan = await call('POST', `/library/stock/cycles/${chk.json().id as string}/verify`, {
      accessionNos: ['B00006', 'ZZZ1'],
    });
    expect(scan.json()).toMatchObject({
      verified: [expect.objectContaining({ no: 'B00006', accessionNo: 'B00206' })],
      unknown: [expect.objectContaining({ no: 'ZZZ1' })],
    });
    const list = (await call('GET', '/library/accession/changes')).json();
    expect(list.slice(0, 3).map((x: { old: string; now: string }) => `${x.old}>${x.now}`)).toEqual([
      'B00008>B00208',
      'B00007>B00207',
      'B00006>B00206',
    ]);
    expect(list).toHaveLength(5);
  });
});
