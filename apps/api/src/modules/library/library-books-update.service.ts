import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readFile, type Cell } from '../masters/masters.service';
import {
  CopyEditSchema,
  IsbnSchema,
  TitleSchema,
  type CopyEditDto,
  type TitleDto,
} from './library-books.dto';
import { LibraryBooksService } from './library-books.service';

const MASTER = 'library_books_update';
const MAX_ROWS = 5000;
const CLEAR = 'CLEAR';
type Level = 'title' | 'copy';
type Kind = 'text' | 'int' | 'number' | 'date' | 'list' | 'yesno' | 'people' | 'keywords' | 'isbn';
type ListName = 'library' | 'shelf' | 'material' | 'subject' | 'language' | 'vendor' | 'class';

/** A field the update file may change: on the copy or on its title; how it is typed and kept. */
interface UField {
  key: string;
  label: string;
  section: 'book' | 'publication' | 'copy' | 'source';
  level: Level;
  kind: Kind;
  /** the DTO key it writes */
  to: string;
  list?: ListName;
  /** may be emptied with CLEAR */
  clear: boolean;
  max?: number;
}
const f = (
  key: string,
  label: string,
  section: UField['section'],
  level: Level,
  kind: Kind,
  to: string,
  more: Partial<UField> = {},
): UField => ({ key, label, section, level, kind, to, clear: true, ...more });

/** The fields, in the order of the book form (accession no. and status keep their own screens). */
export const UPDATE_FIELDS: UField[] = [
  f('title', 'Title', 'book', 'title', 'text', 'title', { clear: false, max: 250 }),
  f('subtitle', 'Subtitle', 'book', 'title', 'text', 'subtitle', { max: 250 }),
  f('authors', 'Authors', 'book', 'title', 'people', 'people'),
  f('material', 'Material type', 'book', 'title', 'list', 'materialTypeId', {
    list: 'material',
    clear: false,
  }),
  f('subject', 'Subject', 'book', 'title', 'list', 'subjectId', { list: 'subject' }),
  f('sub_subject', 'Sub-subject', 'book', 'title', 'text', 'subSubject', { max: 80 }),
  f('call_no', 'Call number', 'book', 'title', 'text', 'callNo', { max: 40 }),
  f('for_class', 'For class', 'book', 'title', 'list', 'classId', { list: 'class' }),
  f('keywords', 'Keywords', 'book', 'title', 'keywords', 'keywords'),
  f('reference_only', 'Reference only', 'book', 'title', 'yesno', 'isReference', { clear: false }),
  f('title_notes', 'Notes', 'book', 'title', 'text', 'notes', { max: 1000 }),
  f('publisher', 'Publisher', 'publication', 'title', 'text', 'publisher', { max: 120 }),
  f('place', 'Place of publication', 'publication', 'title', 'text', 'publicationPlace', {
    max: 80,
  }),
  f('year', 'Year', 'publication', 'title', 'int', 'year'),
  f('edition', 'Edition', 'publication', 'title', 'text', 'edition', { max: 40 }),
  f('volume', 'Volume', 'publication', 'title', 'text', 'volume', { max: 40 }),
  f('pages', 'Pages', 'publication', 'title', 'int', 'pages'),
  f('isbn', 'ISBN', 'publication', 'title', 'isbn', 'isbn'),
  f('language', 'Language', 'publication', 'title', 'list', 'languageId', { list: 'language' }),
  f('printed_price', 'Price as printed (₹)', 'publication', 'title', 'number', 'price'),
  f('library', 'Library', 'copy', 'copy', 'list', 'libraryId', { list: 'library', clear: false }),
  f('shelf', 'Shelf', 'copy', 'copy', 'list', 'shelfId', { list: 'shelf' }),
  f('rack', 'Rack', 'copy', 'copy', 'text', 'rack', { max: 20 }),
  f('barcode', 'Barcode', 'copy', 'copy', 'text', 'barcode', { max: 40 }),
  f('remarks', 'Remarks', 'copy', 'copy', 'text', 'remarks', { max: 300 }),
  f('accessioned_on', 'Date of accession', 'source', 'copy', 'date', 'accessionedOn', {
    clear: false,
  }),
  f('acquisition', 'Purchase or donation', 'source', 'copy', 'text', 'acquisition'),
  f('vendor', 'Vendor', 'source', 'copy', 'list', 'vendorId', { list: 'vendor' }),
  f('donor', 'Donated by', 'source', 'copy', 'text', 'donor', { max: 120 }),
  f('bill_no', 'Bill no.', 'source', 'copy', 'text', 'billNo', { max: 40 }),
  f('bill_date', 'Bill date', 'source', 'copy', 'date', 'billDate'),
  f('po_no', 'Purchase order no.', 'source', 'copy', 'text', 'poNo', { max: 40 }),
  f('copy_price', 'Copy price (₹)', 'source', 'copy', 'number', 'price'),
];
const BY_KEY = new Map(UPDATE_FIELDS.map((x) => [x.key, x]));
const SECTIONS = [
  { id: 'book', title: 'The book' },
  { id: 'publication', title: 'Publication' },
  { id: 'copy', title: 'The copy' },
  { id: 'source', title: 'How it came' },
];

type Lists = Record<
  ListName,
  Array<{ id: string; name: string; code: string | null; library?: string }>
>;
type Value = string | number | boolean | string[] | Array<{ name: string; role: string }> | null;
type Problem = { row: number; accessionNo?: string; column: string; message: string };
type Change = { field: string; label: string; level: Level; from: string; to: string };
type PayloadRow = {
  row: number;
  accessionNo: string;
  copyId: string;
  titleId: string;
  title: string;
  copy: Record<string, Value>;
  titled: Record<string, Value>;
  changes: Change[];
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const cellText = (c: Cell): string => {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  if (typeof c === 'boolean') return c ? 'Yes' : 'No';
  return String(c).trim();
};
const dmy = (v: string) => `${v.slice(8, 10)}-${v.slice(5, 7)}-${v.slice(0, 4)}`;
/** A typed day: DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD. */
const dayOf = (t: string): string | null => {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return t;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]!}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
};
const money = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));

/**
 * Books updated from Excel by accession number (docs/design/36-library.md, "Library round 3", part 2), as
 * the employees' bulk upload: a template filled with the copies chosen and the columns ticked; a blank
 * cell is no change, CLEAR empties a field; the file is checked row by row with the book form's own rules
 * (each row tried and undone), old against new, then applied. A title field reaches every copy of that
 * title; two rows may not give one title two values.
 */
@Injectable()
export class LibraryBooksUpdateService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly books: LibraryBooksService,
  ) {}

  fields() {
    return {
      sections: SECTIONS,
      fields: UPDATE_FIELDS.map((x) => ({
        key: x.key,
        label: x.label,
        section: x.section,
        level: x.level,
      })),
    };
  }

  private async lists(c: PoolClient): Promise<Lists> {
    const q = async (sql: string) =>
      (await c.query<{ id: string; name: string; code: string | null; library?: string }>(sql))
        .rows;
    return {
      library: await q(
        `SELECT id::text, name, code FROM library_libraries WHERE status = 'active' ORDER BY name`,
      ),
      shelf: await q(
        `SELECT s.id::text, s.code AS name, s.code, s.library_id::text AS library FROM library_shelves s
          WHERE s.status = 'active' ORDER BY s.code`,
      ),
      material: await q(
        `SELECT id::text, name, code FROM library_material_types WHERE status = 'active' ORDER BY sort_order, name`,
      ),
      subject: await q(
        `SELECT id::text, name::text AS name, NULL AS code FROM library_subjects WHERE status = 'active' ORDER BY name`,
      ),
      language: await q(
        `SELECT id::text, name::text AS name, code FROM library_languages WHERE status = 'active' ORDER BY name`,
      ),
      vendor: await q(
        `SELECT id::text, name, code FROM library_vendors WHERE status = 'active' ORDER BY name`,
      ),
      class: await q(
        `SELECT id::text, name, code FROM classes WHERE deleted_at IS NULL ORDER BY display_order, code`,
      ),
    };
  }

  /** A copy as the update sees it: its form values and title's, and the words each field shows. */
  private async current(c: PoolClient, copyId: string) {
    const r = await c.query<Record<string, unknown>>(
      `SELECT x.id::text AS copy_id, x.status::text AS status, x.title_id::text, x.library_id::text, l.name AS library,
              x.shelf_id::text, sh.code AS shelf, x.rack, x.barcode, x.remarks, x.accessioned_on::text, x.acquisition,
              x.vendor_id::text, v.name AS vendor, x.donor, x.bill_no, x.bill_date::text, x.po_no, x.price::text AS copy_price,
              t.title, t.subtitle, t.material_type_id::text, m.name AS material, t.subject_id::text, s.name::text AS subject,
              t.sub_subject, t.call_no, t.keywords, t.class_id::text, cl.name AS class, t.publisher, t.publication_place,
              t.year, t.edition, t.volume, t.pages, t.isbn, t.language_id::text, la.name::text AS language,
              t.price::text AS printed_price, t.is_reference, t.notes,
              (SELECT count(*) FROM library_copies z WHERE z.title_id = t.id AND z.status <> 'sold')::int AS copies,
              (SELECT jsonb_agg(jsonb_build_object('name', a.name::text, 'role', ta.role) ORDER BY ta.position, ta.id)
                 FROM library_title_authors ta JOIN library_authors a ON a.id = ta.author_id WHERE ta.title_id = t.id) AS people
         FROM library_copies x JOIN library_titles t ON t.id = x.title_id
         JOIN library_libraries l ON l.id = x.library_id
         LEFT JOIN library_shelves sh ON sh.id = x.shelf_id LEFT JOIN library_vendors v ON v.id = x.vendor_id
         LEFT JOIN library_material_types m ON m.id = t.material_type_id LEFT JOIN library_subjects s ON s.id = t.subject_id
         LEFT JOIN classes cl ON cl.id = t.class_id LEFT JOIN library_languages la ON la.id = t.language_id
        WHERE x.id = $1`,
      [copyId],
    );
    const x = r.rows[0]!;
    const people = (x.people as Array<{ name: string; role: string }> | null) ?? [];
    const opt = <T>(v: T | null | undefined) =>
      v === null || v === undefined || v === '' ? undefined : v;
    const title: TitleDto = {
      title: String(x.title),
      subtitle: opt(x.subtitle as string | null),
      people: people.map((p) => ({
        name: p.name,
        role: p.role as TitleDto['people'][number]['role'],
      })),
      materialTypeId: String(x.material_type_id ?? ''),
      subjectId: opt(x.subject_id as string | null),
      subSubject: opt(x.sub_subject as string | null),
      callNo: opt(x.call_no as string | null),
      keywords: (x.keywords as string[] | null) ?? [],
      classId: opt(x.class_id as string | null),
      publisher: opt(x.publisher as string | null),
      publicationPlace: opt(x.publication_place as string | null),
      year: opt(x.year as number | null),
      edition: opt(x.edition as string | null),
      volume: opt(x.volume as string | null),
      pages: opt(x.pages as number | null),
      isbn: opt(x.isbn as string | null),
      languageId: opt(x.language_id as string | null),
      price: x.printed_price === null ? undefined : Number(x.printed_price),
      isReference: Boolean(x.is_reference),
      notes: opt(x.notes as string | null),
    };
    const copy: CopyEditDto = {
      libraryId: String(x.library_id),
      accessionedOn: opt(x.accessioned_on as string | null),
      shelfId: opt(x.shelf_id as string | null),
      rack: opt(x.rack as string | null),
      barcode: opt(x.barcode as string | null),
      acquisition: opt(x.acquisition as 'Purchase' | 'Donation' | null),
      vendorId: opt(x.vendor_id as string | null),
      donor: opt(x.donor as string | null),
      billNo: opt(x.bill_no as string | null),
      billDate: opt(x.bill_date as string | null),
      poNo: opt(x.po_no as string | null),
      price: x.copy_price === null ? undefined : Number(x.copy_price),
      remarks: opt(x.remarks as string | null),
    };
    // the words each field shows (for the template and old → new)
    const words: Record<string, string> = {
      title: title.title,
      subtitle: title.subtitle ?? '',
      authors: people
        .filter((p) => p.role === 'Author')
        .map((p) => p.name)
        .join('; '),
      material: String(x.material ?? ''),
      subject: String(x.subject ?? ''),
      sub_subject: title.subSubject ?? '',
      call_no: title.callNo ?? '',
      for_class: String(x.class ?? ''),
      keywords: title.keywords.join(', '),
      reference_only: title.isReference ? 'Yes' : 'No',
      title_notes: title.notes ?? '',
      publisher: title.publisher ?? '',
      place: title.publicationPlace ?? '',
      year: title.year === undefined ? '' : String(title.year),
      edition: title.edition ?? '',
      volume: title.volume ?? '',
      pages: title.pages === undefined ? '' : String(title.pages),
      isbn: title.isbn ?? '',
      language: String(x.language ?? ''),
      printed_price: money(x.printed_price),
      library: String(x.library),
      shelf: String(x.shelf ?? ''),
      rack: copy.rack ?? '',
      barcode: copy.barcode ?? '',
      remarks: copy.remarks ?? '',
      accessioned_on: copy.accessionedOn ? dmy(copy.accessionedOn) : '',
      acquisition: copy.acquisition ?? '',
      vendor: String(x.vendor ?? ''),
      donor: copy.donor ?? '',
      bill_no: copy.billNo ?? '',
      bill_date: copy.billDate ? dmy(copy.billDate) : '',
      po_no: copy.poNo ?? '',
      copy_price: money(x.copy_price),
    };
    return {
      copyId,
      titleId: String(x.title_id),
      status: String(x.status),
      copies: Number(x.copies),
      title,
      copy,
      words,
    };
  }

  /** A typed cell for a field: the value it writes and the words it shows, or what is wrong. */
  private parse(
    fld: UField,
    t: string,
    lists: Lists,
    ctx: { libraryId: string; people: TitleDto['people'] },
  ): { value: Value; words: string } | { error: string } {
    if (t.toUpperCase() === CLEAR) {
      if (!fld.clear) return { error: 'cannot be emptied' };
      return { value: fld.kind === 'keywords' ? [] : null, words: '' };
    }
    if (fld.max && t.length > fld.max) return { error: `at most ${String(fld.max)} characters` };
    switch (fld.kind) {
      case 'text':
        if (fld.key === 'acquisition') {
          const v = ['purchase', 'donation'].find((x) => x === norm(t));
          return v
            ? {
                value: v === 'purchase' ? 'Purchase' : 'Donation',
                words: v === 'purchase' ? 'Purchase' : 'Donation',
              }
            : { error: 'Purchase or Donation' };
        }
        if (fld.key === 'barcode' && !/^[A-Za-z0-9/-]+$/.test(t))
          return { error: 'letters and digits (/ or - allowed)' };
        return { value: t, words: t };
      case 'int': {
        const n = Number(t);
        return Number.isInteger(n) ? { value: n, words: String(n) } : { error: 'a whole number' };
      }
      case 'number': {
        const n = Number(t.replace(/[₹,\s]/g, ''));
        return Number.isFinite(n) && n >= 0
          ? { value: n, words: String(n) }
          : { error: 'a number' };
      }
      case 'date': {
        const d = dayOf(t);
        return d ? { value: d, words: dmy(d) } : { error: 'a date as DD-MM-YYYY' };
      }
      case 'yesno':
        if (/^(yes|y|true|1)$/i.test(t)) return { value: true, words: 'Yes' };
        if (/^(no|n|false|0)$/i.test(t)) return { value: false, words: 'No' };
        return { error: 'Yes or No' };
      case 'isbn': {
        const p = IsbnSchema.safeParse(t);
        return p.success ? { value: p.data, words: p.data } : { error: 'not a valid ISBN' };
      }
      case 'keywords': {
        const list = t
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean);
        return { value: list, words: list.join(', ') };
      }
      case 'people': {
        const names = t
          .split(';')
          .map((x) => x.trim())
          .filter(Boolean);
        if (names.some((n) => n.length < 2 || n.length > 120))
          return { error: 'names of 2 to 120 letters, separated by ;' };
        // the authors replaced; editors, translators and illustrators kept after them
        const others = ctx.people.filter((p) => p.role !== 'Author');
        return {
          value: [...names.map((name) => ({ name, role: 'Author' })), ...others],
          words: names.join('; '),
        };
      }
      case 'list': {
        const n = norm(t);
        const pool =
          fld.list === 'shelf'
            ? lists.shelf.filter((x) => x.library === ctx.libraryId)
            : lists[fld.list!];
        const hit = pool.find((x) => norm(x.name) === n || (x.code && norm(x.code) === n));
        if (!hit)
          return {
            error:
              fld.list === 'shelf'
                ? `no shelf "${t}" in this copy's library`
                : `"${t}" is not in Library setup`,
          };
        return { value: hit.id, words: hit.name };
      }
    }
  }

  // ---- the template ------------------------------------------------------------------------------
  async template(
    ctx: RequestContext,
    q: { fields?: string; libraryId?: string; shelfId?: string; materialTypeId?: string },
  ) {
    const keys = (q.fields ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    const unknown = keys.filter((k) => !BY_KEY.has(k));
    if (unknown.length)
      throw new DomainError('validation-failed', `Unknown field(s): ${unknown.join(', ')}`, {
        status: 400,
      });
    for (const k of ['libraryId', 'shelfId', 'materialTypeId'] as const)
      if (q[k] && !/^\d{1,18}$/.test(q[k]!))
        throw new DomainError('validation-failed', `${k}: an id`, { status: 400 });
    const cols = keys.length ? UPDATE_FIELDS.filter((x) => keys.includes(x.key)) : UPDATE_FIELDS;
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await this.lists(c);
      const ids = await c.query<{ id: string; accession_no: string; title: string }>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed row cap; values are bound
        `SELECT x.id::text, x.accession_no, t.title FROM library_copies x JOIN library_titles t ON t.id = x.title_id
          WHERE x.status <> 'sold' AND t.status = 'active'
            AND ($1::bigint IS NULL OR x.library_id = $1) AND ($2::bigint IS NULL OR x.shelf_id = $2)
            AND ($3::bigint IS NULL OR t.material_type_id = $3)
          ORDER BY regexp_replace(x.accession_no, '[0-9]+$', ''), NULLIF(substring(x.accession_no FROM '[0-9]+$'), '')::numeric,
                   x.accession_no
          LIMIT ${String(MAX_ROWS)}`,
        [q.libraryId ?? null, q.shelfId ?? null, q.materialTypeId ?? null],
      );
      const wb = new ExcelJS.Workbook();
      wb.creator = 'EduPro';
      const info = wb.addWorksheet('Instructions');
      [
        'Update books by accession number',
        '',
        '1. Accession No. finds the copy. Do not change it (to correct a number use Library → Correct accession nos.).',
        '2. Only the columns in the file are touched. A blank cell means "no change".',
        `3. Type ${CLEAR} in a cell to empty that field on purpose (not Title, Material type, Library, Reference only, Date of accession).`,
        '4. The book fields (title, authors, publisher …) belong to the title: a change there reaches every copy of that title.',
        '5. Authors: names separated by ; (editors, translators and illustrators stay as they are).',
        '6. Dates as DD-MM-YYYY. Use the drop-downs for the list columns (names as in Library setup).',
        '7. Status (lost, withdrawn …) keeps its own screen: the book page and Lost and damaged books.',
        `8. Up to ${String(MAX_ROWS)} rows a file. Upload on Library → Import books → Update existing books; check, then apply.`,
      ].forEach((l, i) => {
        info.getCell(i + 1, 1).value = l;
      });
      info.getCell(1, 1).font = { bold: true, size: 14 };
      info.getColumn(1).width = 120;
      const listSheet = wb.addWorksheet('Lists', { state: 'hidden' });
      const listRef = new Map<string, string>();
      const options: Record<string, string[]> = {
        library: lists.library.map((x) => x.name),
        shelf: [...new Set(lists.shelf.map((x) => x.name))],
        material: lists.material.map((x) => x.name),
        subject: lists.subject.map((x) => x.name),
        language: lists.language.map((x) => x.name),
        vendor: lists.vendor.map((x) => x.name),
        class: lists.class.map((x) => x.name),
        acquisition: ['Purchase', 'Donation'],
        yesno: ['Yes', 'No'],
      };
      Object.entries(options).forEach(([code, opts], i) => {
        listSheet.getCell(1, i + 1).value = code;
        opts.forEach((o, j) => {
          listSheet.getCell(j + 2, i + 1).value = o;
        });
        const letter = listSheet.getColumn(i + 1).letter;
        listRef.set(code, `Lists!$${letter}$2:$${letter}$${String(Math.max(opts.length + 1, 2))}`);
      });
      const ws = wb.addWorksheet('Books', { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] });
      const header = [
        { label: 'Accession No.', list: undefined as string | undefined, key: '' },
        ...(cols.some((x) => x.key === 'title')
          ? []
          : [{ label: 'Title (not changed)', list: undefined, key: '' }]),
        ...cols.map((x) => ({
          label: x.label,
          key: x.key,
          list:
            x.kind === 'list'
              ? x.list
              : x.kind === 'yesno'
                ? 'yesno'
                : x.key === 'acquisition'
                  ? 'acquisition'
                  : undefined,
        })),
      ];
      header.forEach((h, i) => {
        const cell = ws.getCell(1, i + 1);
        cell.value = h.label;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A4A' } };
        cell.alignment = { wrapText: true, vertical: 'middle' };
        const fld = BY_KEY.get(h.key);
        if (fld?.level === 'title') cell.note = 'Belongs to the title: changes every copy of it.';
        ws.getColumn(i + 1).width = Math.min(Math.max(h.label.length + 4, 14), 40);
        ws.getColumn(i + 1).numFmt = '@';
        if (h.list && listRef.has(h.list))
          for (let r = 2; r <= Math.max(ids.rows.length + 1, 200); r += 1)
            ws.getCell(r, i + 1).dataValidation = {
              type: 'list',
              allowBlank: true,
              formulae: [listRef.get(h.list)!],
              showErrorMessage: false,
            };
      });
      ws.getRow(1).height = 32;
      const titleCol = cols.some((x) => x.key === 'title') ? 0 : 1;
      let r = 2;
      for (const x of ids.rows) {
        const cur = await this.current(c, x.id);
        ws.getCell(r, 1).value = x.accession_no;
        if (titleCol) ws.getCell(r, 2).value = x.title;
        cols.forEach((fld, i) => {
          const v = cur.words[fld.key];
          if (v) ws.getCell(r, i + 2 + titleCol).value = v;
        });
        r += 1;
      }
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `library-books-update-${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
        rows: ids.rows.length,
      };
    });
  }

  // ---- the check ---------------------------------------------------------------------------------
  /** The file read, each row matched and checked (tried with the book form's rules and undone); kept for apply. */
  async check(ctx: RequestContext, fileName: string, body: unknown, contentType: string) {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Send the file as the request body', {
        status: 400,
      });
    if (body.length > 8 * 1024 * 1024)
      throw new DomainError('validation-failed', 'File larger than 8 MB: split it', {
        status: 400,
      });
    const csv = /\.csv$/i.test(fileName) || contentType.startsWith('text/csv');
    const file = await readFile(
      csv ? { csv: body.toString('utf8') } : { contentBase64: body.toString('base64') },
      {
        sheets: ['Books'],
        maxBytes: 8 * 1024 * 1024,
        isHeader: (cells) =>
          cells.some((h) => ['accession no', 'accession number'].includes(norm(h))),
      },
    );
    if (!file.rows.length)
      throw new DomainError('validation-failed', 'The file has no data rows', { status: 400 });
    if (file.rows.length > MAX_ROWS)
      throw new DomainError('validation-failed', `At most ${String(MAX_ROWS)} rows a file`, {
        status: 400,
      });
    const byLabel = new Map<string, string>();
    for (const x of UPDATE_FIELDS) {
      byLabel.set(norm(x.label), x.key);
      byLabel.set(norm(x.key), x.key);
    }
    byLabel.set('accession no', '__acc');
    byLabel.set('accession number', '__acc');
    byLabel.set('title not changed', '__skip');
    const colKey = file.header.map((h) => byLabel.get(norm(h.replace(/\*/g, ''))) ?? null);
    if (!colKey.includes('__acc'))
      throw new DomainError('validation-failed', 'The file needs an "Accession No." column', {
        status: 400,
      });
    const problems: Problem[] = file.header
      .filter((h, i) => h.trim() && colKey[i] === null && !/^s\.?\s*no\.?$/i.test(h.trim()))
      .map((h) => ({ row: 1, column: h, message: 'Column not recognised; ignored' }));

    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lists = await this.lists(c);
      const payload: PayloadRow[] = [];
      const seen = new Map<string, number>();
      // a title's fields as the first row gave them, to refuse another row giving another value
      const titleSet = new Map<string, Map<string, { row: number; words: string }>>();
      const titleCopies = new Map<string, { copies: number; rows: number; name: string }>();
      let unchanged = 0;
      let counted = 0;
      for (let i = 0; i < file.rows.length; i += 1) {
        const rowNo = file.rowNumbers[i] ?? i + 2;
        const cells = file.rows[i]!;
        let acc = '';
        const typed: Array<[UField, string]> = [];
        colKey.forEach((k, ci) => {
          if (!k || k === '__skip') return;
          const t = cellText(cells[ci] ?? null);
          if (k === '__acc') acc = t.replace(/\s+/g, '').toUpperCase();
          else if (t !== '') typed.push([BY_KEY.get(k)!, t]);
        });
        if (!acc && !typed.length) continue;
        counted += 1;
        const bad: Problem[] = [];
        const say = (column: string, message: string) =>
          bad.push({ row: rowNo, accessionNo: acc || undefined, column, message });
        if (!acc) say('Accession No.', 'is required');
        const copyId = acc
          ? (
              await c.query<{ id: string | null }>(
                `SELECT app.library_copy_by_number($1)::text AS id`,
                [acc],
              )
            ).rows[0]!.id
          : null;
        if (acc && !copyId) say('Accession No.', 'no copy with this number');
        if (copyId && seen.has(copyId))
          say('Accession No.', `the same copy as row ${String(seen.get(copyId))}`);
        if (bad.length) {
          problems.push(...bad);
          continue;
        }
        seen.set(copyId!, rowNo);
        const cur = await this.current(c, copyId!);
        if (cur.status === 'sold') {
          problems.push({
            row: rowNo,
            accessionNo: acc,
            column: 'Accession No.',
            message: 'the copy is sold',
          });
          continue;
        }
        const title: TitleDto = { ...cur.title, people: [...cur.title.people] };
        const copy: CopyEditDto = { ...cur.copy };
        const changes: Change[] = [];
        const titled: Record<string, Value> = {};
        const copied: Record<string, Value> = {};
        // the library first: the shelf is looked for in the copy's (new) library
        const ordered = [...typed].sort(
          (a, b) => Number(b[0].key === 'library') - Number(a[0].key === 'library'),
        );
        for (const [fld, t] of ordered) {
          const p = this.parse(fld, t, lists, {
            libraryId: copy.libraryId,
            people: cur.title.people,
          });
          if ('error' in p) {
            say(fld.label, p.error);
            continue;
          }
          const from = cur.words[fld.key] ?? '';
          if (p.words === from) continue;
          // the form's values with the change (an emptied field is left out, as the form does)
          const target = (fld.level === 'title' ? title : copy) as unknown as Record<
            string,
            unknown
          >;
          if (p.value === null) delete target[fld.to];
          else target[fld.to] = p.value;
          (fld.level === 'title' ? titled : copied)[fld.to] = p.value;
          changes.push({ field: fld.key, label: fld.label, level: fld.level, from, to: p.words });
        }
        // a copy moved to another library leaves its shelf and rack unless the file gives them
        if ('libraryId' in copied && !('shelfId' in copied) && copy.shelfId) {
          delete copy.shelfId;
          delete copy.rack;
          copied.shelfId = null;
          copied.rack = null;
          changes.push({
            field: 'shelf',
            label: 'Shelf',
            level: 'copy',
            from: cur.words.shelf ?? '',
            to: '',
          });
        }
        // one title, one value a field, whichever row gives it
        for (const ch of changes.filter((x) => x.level === 'title')) {
          const m = titleSet.get(cur.titleId) ?? new Map<string, { row: number; words: string }>();
          const was = m.get(ch.field);
          if (was && was.words !== ch.to)
            say(ch.label, `row ${String(was.row)} gives this title "${was.words}"`);
          else m.set(ch.field, { row: rowNo, words: ch.to });
          titleSet.set(cur.titleId, m);
        }
        if (!bad.length && changes.length) {
          const pt = TitleSchema.safeParse(title);
          const pc = CopyEditSchema.safeParse(copy);
          for (const e of [
            ...(pt.success ? [] : pt.error.issues),
            ...(pc.success ? [] : pc.error.issues),
          ])
            say(
              BY_KEY.get(UPDATE_FIELDS.find((x) => x.to === String(e.path[0]))?.key ?? '')?.label ??
                String(e.path[0]),
              e.message,
            );
        }
        if (!bad.length && changes.length) {
          // tried with the book form's own rules, then undone
          await c.query('SAVEPOINT library_update_row');
          try {
            if (Object.keys(titled).length) await this.books.saveTitle(c, ctx, title, cur.titleId);
            if (Object.keys(copied).length) await this.books.editCopyIn(c, ctx, copyId!, copy);
          } catch (e) {
            if (!(e instanceof DomainError)) throw e;
            say('Row', e.message);
          } finally {
            await c.query('ROLLBACK TO SAVEPOINT library_update_row');
          }
        }
        if (bad.length) {
          problems.push(...bad);
          continue;
        }
        if (!changes.length) {
          unchanged += 1;
          continue;
        }
        if (Object.keys(titled).length) {
          const t = titleCopies.get(cur.titleId) ?? {
            copies: cur.copies,
            rows: 0,
            name: cur.title.title,
          };
          t.rows += 1;
          titleCopies.set(cur.titleId, t);
        }
        payload.push({
          row: rowNo,
          accessionNo: acc,
          copyId: copyId!,
          titleId: cur.titleId,
          title: cur.title.title,
          copy: copied,
          titled,
          changes,
        });
      }
      // a title changed from fewer rows than it has copies: say the other copies change too
      for (const [, t] of titleCopies)
        if (t.copies > t.rows)
          problems.push({
            row: 0,
            column: 'Title',
            message: `"${t.name}": the book fields change all ${String(t.copies)} copies of the title`,
          });
      const rejected = new Set(problems.filter((p) => p.row > 1).map((p) => p.row)).size;
      const imp = await c.query<{ id: string }>(
        `INSERT INTO master_imports (school_id, master, file_name, status, total_rows, ok_rows, rejected_rows, report, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, 'validated', $3, $4, $5, $6::jsonb, $7::jsonb, app.current_user_id(), $8)
         RETURNING id::text`,
        [
          MASTER,
          fileName.slice(0, 200),
          counted,
          payload.length,
          rejected,
          JSON.stringify(problems),
          JSON.stringify(payload),
          ctx.requestId,
        ],
      );
      await c.query(
        `UPDATE master_imports SET updated_rows = 0, inserted_rows = $2 WHERE id = $1`,
        [imp.rows[0]!.id, unchanged],
      );
      return this.summaryIn(c, imp.rows[0]!.id);
    });
  }

  private async summaryIn(c: PoolClient, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Upload not found', { status: 404 });
    const r = await c.query<{
      id: string;
      file_name: string | null;
      status: string;
      total_rows: number;
      ok_rows: number;
      rejected_rows: number;
      inserted_rows: number;
      updated_rows: number;
      report: Problem[];
      payload: PayloadRow[];
      created_at: string;
      committed_at: string | null;
    }>(
      `SELECT id::text, file_name, status::text, total_rows, ok_rows, rejected_rows, inserted_rows, updated_rows, report,
              payload, created_at::text, committed_at::text
         FROM master_imports WHERE id = $1 AND master = $2`,
      [id, MASTER],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    return {
      id: x.id,
      fileName: x.file_name,
      status: x.status as 'validated' | 'committed',
      totalRows: x.total_rows,
      readyRows: x.ok_rows,
      // the check keeps the unchanged count where the add-on columns are free
      unchangedRows: x.inserted_rows,
      rejectedRows: x.rejected_rows,
      applied: x.updated_rows,
      problems: x.report.slice(0, 500),
      changes: x.payload.slice(0, 500).map((p) => ({
        row: p.row,
        accessionNo: p.accessionNo,
        title: p.title,
        changes: p.changes,
      })),
      createdAt: x.created_at,
      committedAt: x.committed_at,
    };
  }

  async summary(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.summaryIn(c, id));
  }

  /** The checked rows applied: each title once (with what it has now), then each copy; all or nothing. */
  async apply(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.summaryIn(c, id);
      if (s.status !== 'validated')
        throw new DomainError('conflict', 'This upload was applied already', { status: 409 });
      if (!s.readyRows)
        throw new DomainError('validation-failed', 'Nothing to apply in this upload', {
          status: 400,
        });
      await c.query(`SELECT 1 FROM master_imports WHERE id = $1 FOR UPDATE`, [id]);
      const rows = (
        await c.query<{ payload: PayloadRow[] }>(
          `SELECT payload FROM master_imports WHERE id = $1`,
          [id],
        )
      ).rows[0]!.payload;
      const titlesDone = new Set<string>();
      let applied = 0;
      for (const p of rows) {
        try {
          const cur = await this.current(c, p.copyId);
          if (Object.keys(p.titled).length && !titlesDone.has(p.titleId)) {
            // every row's changes to this title, over what the title has now
            const title: Record<string, unknown> = { ...cur.title };
            for (const q of rows.filter((y) => y.titleId === p.titleId))
              for (const [k, v] of Object.entries(q.titled)) {
                if (v === null) delete title[k];
                else title[k] = v;
              }
            await this.books.saveTitle(c, ctx, TitleSchema.parse(title), p.titleId);
            titlesDone.add(p.titleId);
          }
          if (Object.keys(p.copy).length) {
            const copy: Record<string, unknown> = { ...cur.copy };
            for (const [k, v] of Object.entries(p.copy)) {
              if (v === null) delete copy[k];
              else copy[k] = v;
            }
            await this.books.editCopyIn(c, ctx, p.copyId, CopyEditSchema.parse(copy));
          }
          applied += 1;
        } catch (e) {
          if (e instanceof DomainError)
            throw new DomainError(
              e.type,
              `Row ${String(p.row)} (${p.accessionNo}): ${e.message} — nothing was applied`,
              {
                status: e.status,
              },
            );
          throw e;
        }
      }
      await c.query(
        `UPDATE master_imports SET status = 'committed', committed_at = now(), updated_rows = $2 WHERE id = $1`,
        [id, applied],
      );
      await this.audit.stage(ctx, c, {
        action: 'library.books.update_file',
        entityType: 'master_imports',
        entityId: id,
        after: { applied, fileName: s.fileName },
      });
      return this.summaryIn(c, id);
    });
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT m.id::text, m.file_name, m.status::text, m.total_rows, m.ok_rows, m.rejected_rows, m.updated_rows,
                m.created_at::text, u.display_name AS by
           FROM master_imports m LEFT JOIN users u ON u.id = m.requested_by
          WHERE m.master = $1 ORDER BY m.created_at DESC LIMIT 20`,
        [MASTER],
      );
      return r.rows.map((x) => ({
        id: String(x.id),
        fileName: x.file_name as string | null,
        status: String(x.status),
        totalRows: Number(x.total_rows),
        readyRows: Number(x.ok_rows),
        rejectedRows: Number(x.rejected_rows),
        applied: Number(x.updated_rows),
        at: String(x.created_at),
        by: x.by as string | null,
      }));
    });
  }
}
