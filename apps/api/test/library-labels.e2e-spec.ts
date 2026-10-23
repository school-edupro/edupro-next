/**
 * Library, part 5 (docs/design/36-library.md): barcode and spine labels. The copies of an accession
 * range, a list (in its order; numbers not found named), the copies added between two days, a title's
 * copies; withdrawn copies left out unless asked; barcode, spine or both, each repeated; a used sheet's
 * first labels skipped; sheets that do not fit A4 refused; a count before printing; the PDF; the user's
 * settings kept; the barcode is Code 128 of the accession number.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import bwipjs from 'bwip-js';
import { PDFDocument } from 'pdf-lib';
import { code128Bars } from '../src/modules/library/library-labels';
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

describe('library labels (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  const h = (u?: SeededUser) => headersFor((u ?? admin).sub, school.id);
  const call = (method: 'GET' | 'POST', url: string, json?: unknown, u?: SeededUser) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const labels = (json: Record<string, unknown>, u?: SeededUser) =>
    call('POST', '/library/labels', json, u);
  const s = stamp('LLB');
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call('GET', '/library/books/setup')).json();
    ids.main = setup.libraries[0].id;
    const book = await call('POST', '/library/books', {
      title: 'Malgudi Days',
      people: [{ name: 'R. K. Narayan' }],
      materialTypeId: setup.materialTypes.find((x: { code: string }) => x.code === 'BOOK').id,
      callNo: '823 NAR',
      copies: { libraryId: ids.main, count: 30, accessionedOn: '2026-01-10' },
    });
    expect(book.json().accessionNos.at(-1)).toBe('B00030');
    ids.title = book.json().id;
    const v = (await call('GET', `/library/books/${ids.title}`)).json();
    const b30 = v.copies.find((x: { accessionNo: string }) => x.accessionNo === 'B00030')
      .id as string;
    await call('POST', `/library/copies/${b30}/status`, {
      status: 'withdrawn',
      on: '2026-02-01',
      reason: 'Torn',
    });
  });
  afterAll(async () => app.close());

  it('the barcode is Code 128 of the accession number', () => {
    const { bars, modules } = code128Bars('B00125');
    const raw = bwipjs.raw({ bcid: 'code128', text: 'B00125' }) as Array<{ sbs: number[] }>;
    const width = raw[0]!.sbs.reduce((n, w) => n + w, 0);
    expect(modules).toBe(width + 20);
    expect(bars[0]![0]).toBe(10);
    expect(bars.length).toBe(Math.ceil(raw[0]!.sbs.length / 2));
  });

  it('counts first: a range, both labels, the sheets; withdrawn copies left out unless asked', async () => {
    const both = await labels({
      source: 'range',
      from: 'b00001',
      to: 'B00030',
      kind: 'both',
      dry: true,
    });
    expect(both.json()).toEqual({
      copies: 29,
      labels: 58,
      sheets: 3,
      first: 'B00001',
      last: 'B00029',
      missing: [],
    });
    const all = await labels({
      source: 'range',
      from: 'B00001',
      to: 'B00030',
      includeWithdrawn: true,
      dry: true,
    });
    expect(all.json()).toMatchObject({ copies: 30, labels: 30, sheets: 2 });
    // a used sheet: 20 of its 24 labels gone, so 4 then a new sheet
    const skip = await labels({
      source: 'range',
      from: 'B00001',
      to: 'B00010',
      skip: 20,
      dry: true,
    });
    expect(skip.json()).toMatchObject({ labels: 10, sheets: 2 });
    const twice = await labels({
      source: 'range',
      from: 'B00001',
      to: 'B00010',
      copies: 2,
      preset: 'l7651',
      dry: true,
    });
    expect(twice.json()).toMatchObject({ labels: 20, sheets: 1 });
  });

  it('a list in its order (numbers not found named), copies added between days, a title’s copies', async () => {
    const list = await labels({ source: 'list', list: ['B00005', 'nope1', 'b00002'], dry: true });
    expect(list.json()).toMatchObject({
      copies: 2,
      first: 'B00005',
      last: 'B00002',
      missing: ['NOPE1'],
    });
    const added = await labels({
      source: 'added',
      addedFrom: '2026-01-01',
      addedTo: '2026-01-31',
      dry: true,
    });
    expect(added.json()).toMatchObject({ copies: 29 });
    expect(
      (await labels({ source: 'added', addedFrom: '2026-03-01', dry: true })).json(),
    ).toMatchObject({ copies: 0, labels: 0, sheets: 0 });
    const title = await labels({ source: 'title', titleId: ids.title, kind: 'spine', dry: true });
    expect(title.json()).toMatchObject({ copies: 29, first: 'B00001', last: 'B00029' });
  });

  it('the PDF: A4 pages of labels; the settings kept; what is refused', async () => {
    const r = await labels({
      source: 'range',
      from: 'B00001',
      to: 'B00030',
      kind: 'both',
      top: 'school',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      labels: 58,
      sheets: 3,
      pages: 3,
      filename: 'Library-labels-B00001.pdf',
    });
    const pdf = await PDFDocument.load(Buffer.from(r.json().base64, 'base64'));
    expect(pdf.getPageCount()).toBe(3);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(595);
    const setup = (await call('GET', '/library/labels/setup')).json();
    expect(setup.presets.map((p: { id: string }) => p.id)).toEqual([
      'a4-3x8',
      'a4-4x10',
      'l7651',
      'mr104',
      'a4-2x7',
    ]);
    expect(setup.last).toMatchObject({ kind: 'both', preset: 'a4-3x8', top: 'school', copies: 1 });
    // a sheet of one's own that fits, and ones that do not
    const custom = {
      cols: 3,
      rows: 7,
      width: 63.5,
      height: 38.1,
      top: 15,
      left: 7.2,
      gapX: 2.5,
      gapY: 0,
    };
    expect(
      (
        await labels({ source: 'title', titleId: ids.title, preset: 'custom', custom, dry: true })
      ).json(),
    ).toMatchObject({
      sheets: 2,
    });
    expect(
      (
        await labels({
          source: 'title',
          titleId: ids.title,
          preset: 'custom',
          custom: { ...custom, width: 70 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await labels({
          source: 'title',
          titleId: ids.title,
          preset: 'custom',
          custom: { ...custom, rows: 8 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await labels({ source: 'title', titleId: ids.title, preset: 'custom' })).statusCode,
    ).toBe(400);
    expect((await labels({ source: 'title', titleId: ids.title, skip: 24 })).statusCode).toBe(400);
    expect((await labels({ source: 'range' })).statusCode).toBe(400);
    expect((await labels({ source: 'added', addedFrom: '2026-03-01' })).json().type).toBe(
      'library.no_copies',
    );
    expect((await labels({ source: 'title', titleId: ids.title }, coordinator)).statusCode).toBe(
      403,
    );
  });

  it('MR104: 65 labels on A4, the centred layout with "short name(library)", a printer shift kept, an alignment sheet', async () => {
    const setup = (await call('GET', '/library/labels/setup')).json();
    expect(setup.presets.find((p: { id: string }) => p.id === 'mr104')).toMatchObject({
      cols: 5,
      rows: 13,
      width: 38.1,
      height: 21.2,
    });
    const r = await labels({
      source: 'range',
      from: 'B00001',
      to: 'B00030',
      kind: 'barcode',
      preset: 'mr104',
      layout: 'centred',
      top: 'school_library',
      showTitle: false,
      shiftX: 1.5,
      shiftY: -0.5,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ sheets: 1, pages: 1 });
    expect(r.json().labels).toBeLessThanOrEqual(65);
    const pdf = await PDFDocument.load(Buffer.from(r.json().base64, 'base64'));
    expect(pdf.getPageCount()).toBe(1);
    const last = (await call('GET', '/library/labels/setup')).json().last;
    expect(last).toMatchObject({
      preset: 'mr104',
      layout: 'centred',
      top: 'school_library',
      shiftX: 1.5,
      shiftY: -0.5,
    });
    // the alignment sheet needs no copies
    const a = await labels({ source: 'range', preset: 'mr104', alignment: true, shiftX: 1 });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ labels: 65, pages: 1, filename: 'Label-alignment-sheet.pdf' });
    // a shift beyond 10 mm is refused
    expect(
      (await labels({ source: 'range', from: 'B00001', to: 'B00002', shiftX: 25 })).statusCode,
    ).toBe(400);
  });
});
