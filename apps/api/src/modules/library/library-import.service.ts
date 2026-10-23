import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { readFile, type Cell } from '../masters/masters.service';
import { IsbnSchema } from './library-books.dto';

/** What a column of the file holds. */
type Field =
  | 'accession'
  | 'library'
  | 'title'
  | 'subtitle'
  | 'authors'
  | 'author2'
  | 'editors'
  | 'material'
  | 'category'
  | 'subject'
  | 'subSubject'
  | 'callNo'
  | 'keywords'
  | 'class'
  | 'publisher'
  | 'place'
  | 'year'
  | 'edition'
  | 'volume'
  | 'pages'
  | 'isbn'
  | 'language'
  | 'price'
  | 'borrowable'
  | 'reference'
  | 'acquisition'
  | 'donated'
  | 'vendor'
  | 'donor'
  | 'billNo'
  | 'billDate'
  | 'poNo'
  | 'accessionedOn'
  | 'shelf'
  | 'rack'
  | 'location'
  | 'barcode'
  | 'status'
  | 'status1'
  | 'remarks'
  | 'notes';

/**
 * The column names each field is known by: ours (the template) and the legacy library's (its import
 * template and its book-list export), compared without case, spaces, signs or a bracketed note.
 */
const ALIASES: Record<Field, string[]> = {
  accession: ['accessionno', 'accessionnumber', 'accno', 'bookcode', 'bookid'],
  library: ['library', 'libraryname', 'librarycode'],
  title: ['title', 'bookname', 'booktitle'],
  subtitle: ['subtitle'],
  authors: ['authors', 'author', 'author1'],
  author2: ['author2'],
  editors: ['editors', 'editor'],
  material: ['materialtype', 'material', 'booktype'],
  category: ['category'],
  subject: ['subject'],
  subSubject: ['subsubject', 'subjectsubcategory', 'subcategory'],
  callNo: ['callnumber', 'callno'],
  keywords: ['keywords', 'keyword'],
  class: ['forclass', 'class'],
  publisher: ['publisher'],
  place: ['placeofpublication', 'publisherplace', 'place'],
  year: ['year', 'publicationyear'],
  edition: ['edition', 'editionno'],
  volume: ['volume'],
  pages: ['pages'],
  isbn: ['isbn', 'isbnno'],
  language: ['language', 'langugage'],
  price: ['price'],
  borrowable: ['isborrowable', 'borrowable'],
  reference: ['referenceonly'],
  acquisition: ['purchaseordonation', 'procurementtype', 'acquisition'],
  donated: ['donatedbook'],
  vendor: ['vendor', 'vendorsource'],
  donor: ['donatedby', 'sourcename', 'donor', 'source'],
  billNo: ['billno'],
  billDate: ['billdate'],
  poNo: ['purchaseorderno', 'pono'],
  accessionedOn: ['dateofaccession', 'accessiondate', 'purchasingdate', 'accessionedon'],
  shelf: ['shelf', 'shelfrack'],
  rack: ['rack', 'shelfrow'],
  location: ['location', 'cellnolocation'],
  barcode: ['barcode'],
  status: ['status'],
  status1: ['status1'],
  remarks: ['remarks'],
  notes: ['notes'],
};
/** Columns of the legacy files that carry nothing to keep. */
const IGNORED = new Set([
  'sno',
  'srno',
  'classno',
  'bookno',
  'sourcecode',
  'copyset',
  'quantity',
  'verifystatus',
  'verifyby',
  'verifydate',
  'action',
]);
const norm = (s: string) =>
  s
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
const BATCH = 300;
const LIMIT_ROWS = 50_000;

/** Our template's columns, in order (the legacy layout is read as it is). */
const TEMPLATE: Array<{ header: string; width: number; options?: string[]; required?: boolean }> = [
  { header: 'Accession no.', width: 14, required: true },
  { header: 'Library', width: 14 },
  { header: 'Title', width: 36, required: true },
  { header: 'Subtitle', width: 24 },
  { header: 'Authors', width: 28 },
  { header: 'Editors', width: 20 },
  { header: 'Material type', width: 14 },
  { header: 'Subject', width: 16 },
  { header: 'Sub-subject', width: 16 },
  { header: 'Call number', width: 14 },
  { header: 'Keywords', width: 20 },
  { header: 'For class', width: 10 },
  { header: 'Publisher', width: 22 },
  { header: 'Place of publication', width: 16 },
  { header: 'Year', width: 8 },
  { header: 'Edition', width: 10 },
  { header: 'Volume', width: 8 },
  { header: 'Pages', width: 8 },
  { header: 'ISBN', width: 16 },
  { header: 'Language', width: 12 },
  { header: 'Price', width: 10 },
  { header: 'Reference only', width: 10, options: ['Yes', 'No'] },
  { header: 'Purchase or donation', width: 14, options: ['Purchase', 'Donation'] },
  { header: 'Vendor', width: 18 },
  { header: 'Donated by', width: 18 },
  { header: 'Bill no.', width: 12 },
  { header: 'Bill date', width: 12 },
  { header: 'Purchase order no.', width: 14 },
  { header: 'Date of accession', width: 14 },
  { header: 'Shelf', width: 10 },
  { header: 'Rack', width: 8 },
  { header: 'Barcode', width: 14 },
  { header: 'Status', width: 12, options: ['On the shelf', 'Withdrawn', 'Lost', 'Damaged'] },
  { header: 'Remarks', width: 24 },
  { header: 'Notes', width: 24 },
];

/** Two filled rows for the template's Example sheet (two copies of one title, a donated reference book). */
const EXAMPLE_1: Record<string, string | number> = {
  'Accession no.': '10001',
  Title: 'Malgudi Days',
  Authors: 'R. K. Narayan',
  'Material type': 'Book',
  Subject: 'Literature',
  'Call number': '823 NAR',
  Keywords: 'short stories, india',
  'For class': 'VI',
  Publisher: 'Indian Thought Publications',
  'Place of publication': 'Chennai',
  Year: 2016,
  Edition: '2nd',
  Pages: 256,
  ISBN: '9788185986173',
  Language: 'English',
  Price: 250,
  'Reference only': 'No',
  'Purchase or donation': 'Purchase',
  Vendor: 'City Book House',
  'Bill no.': 'CBH/245',
  'Bill date': '01-06-2026',
  'Date of accession': '05-06-2026',
  Shelf: 'S1',
  Rack: 'R2',
};
const EXAMPLE_2: Record<string, string | number> = {
  'Accession no.': '10002',
  Title: 'Oxford Student Atlas for India',
  'Material type': 'Reference',
  Subject: 'Geography',
  Publisher: 'Oxford University Press',
  Year: 2023,
  Language: 'English',
  'Reference only': 'Yes',
  'Purchase or donation': 'Donation',
  'Donated by': 'Parents’ association',
  'Date of accession': '10-06-2026',
  Remarks: 'Kept in the reading room',
};

interface TitleData {
  title: string;
  subtitle?: string;
  people: Array<{ name: string; role: 'Author' | 'Editor' }>;
  materialTypeId: string;
  material: string;
  subject?: string;
  subSubject?: string;
  callNo?: string;
  keywords: string[];
  classId?: string;
  publisher?: string;
  place?: string;
  year?: number;
  edition?: string;
  volume?: string;
  pages?: number;
  isbn?: string;
  language?: string;
  price?: number;
  isReference?: boolean;
  notes?: string;
}
interface CopyData {
  libraryId: string;
  library: string;
  shelf?: string;
  rack?: string;
  barcode?: string;
  acquisition?: 'Purchase' | 'Donation';
  vendor?: string;
  donor?: string;
  billNo?: string;
  billDate?: string;
  poNo?: string;
  price?: number;
  accessionedOn?: string;
  remarks?: string;
  status: 'available' | 'withdrawn' | 'lost' | 'damaged';
  statusReason?: string;
}
interface RowData {
  title: TitleData;
  copy: CopyData;
  /** the fields the row gave (an update changes only these) */
  given: Field[];
  existingTitleId?: string;
  existingCopyId?: string;
  changes?: string[];
}

/** A day from what a sheet holds: an Excel date, 2024-06-01, 01-06-2024, 01/06/2024, 1.6.2024. */
function dayOf(v: Cell): string | null {
  if (v === null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // an Excel serial day
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (/^0000-00-00/.test(s)) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number;
  let mo: number;
  let d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d)
    return null;
  return date.toISOString().slice(0, 10);
}
const text = (v: Cell) =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).replace(/\s+/g, ' ').trim();
/** A placeholder some old sheets carry for "nothing". */
const blank = (s: string) => !s || /^(-+|na|n\/a|nil|null|none|0)$/i.test(s);
const key = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const textKey = (t: TitleData) =>
  `t:${key(t.title)}|${key(t.people[0]?.name)}|${key(t.edition)}|${key(t.volume)}`;
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Books from Excel or CSV (docs/design/36-library.md, part 4): our layout or the legacy library's (one
 * row per copy: BookCode, BookName, Author, Publisher, ...). A file is checked first: each row's copy and
 * title, matched to the set-up (library, material type) and to the books already there (the same
 * accession number is an update of that copy, changing only the cells given; the same ISBN, or title,
 * author, edition and volume, adds a copy to that title); new authors, publishers, subjects, languages,
 * vendors and shelves are counted for the masters. The import then runs in batches, each row on its own.
 */
@Injectable()
export class LibraryImportService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Our template: the columns, drop-downs for the lists, and how to fill it. */
  async template(ctx: RequestContext) {
    // every list the import understands, from Library setup (and the classes for "For class")
    const lists = await this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `SELECT app.library_seed(app.current_school_id()) WHERE app.my_libraries() IS NULL`,
      );
      const col = async (sql: string) => (await c.query<{ v: string }>(sql)).rows.map((x) => x.v);
      return {
        Library: await col(
          `SELECT code AS v FROM library_libraries WHERE status = 'active' ORDER BY code`,
        ),
        'Material type': await col(
          `SELECT name AS v FROM library_material_types WHERE status = 'active' ORDER BY name`,
        ),
        Subject: await col(
          `SELECT name::text AS v FROM library_subjects WHERE status = 'active' ORDER BY name`,
        ),
        'Sub-subject': await col(
          `SELECT DISTINCT unnest(sub_subjects) AS v FROM library_subjects WHERE status = 'active' ORDER BY 1`,
        ),
        Language: await col(
          `SELECT name::text AS v FROM library_languages WHERE status = 'active' ORDER BY name`,
        ),
        Publisher: await col(
          `SELECT name::text AS v FROM library_publishers WHERE status = 'active' ORDER BY name`,
        ),
        Vendor: await col(
          `SELECT name AS v FROM library_vendors WHERE status = 'active' ORDER BY name`,
        ),
        Shelf: await col(
          `SELECT DISTINCT code AS v FROM library_shelves WHERE status = 'active' ORDER BY 1`,
        ),
        Rack: await col(
          `SELECT DISTINCT unnest(racks) AS v FROM library_shelves WHERE status = 'active' ORDER BY 1`,
        ),
        'For class': await col(
          `SELECT DISTINCT k.code AS v FROM classes k WHERE k.deleted_at IS NULL ORDER BY 1`,
        ),
      } as Record<string, string[]>;
    });
    const NOTES: Record<string, string> = {
      'Accession no.':
        'The copy’s number, unique in the school. An existing number updates that copy.',
      Library: 'The library code from Library setup. Empty: the default library.',
      Title: 'The book’s title. Copies of one title repeat the title details on each row.',
      Authors: 'Several separated by ";" e.g. R. K. Narayan; R. K. Laxman',
      Editors: 'Several separated by ";"',
      'Material type': 'Empty: Book.',
      Keywords: 'Separated by ","',
      'For class': 'The class code the book suits, e.g. VI.',
      Year: 'Four digits, e.g. 2024.',
      ISBN: '10 or 13 digits; hyphens allowed.',
      Price: 'A number, e.g. 350.',
      'Bill date': 'dd-mm-yyyy or yyyy-mm-dd.',
      'Date of accession': 'dd-mm-yyyy or yyyy-mm-dd. Empty: today.',
      Barcode: 'Only if the label barcode differs from the accession number.',
      Status: 'Empty: on the shelf.',
    };
    const FORMAT: Record<string, 'text' | 'date' | 'number'> = {
      'Accession no.': 'text',
      ISBN: 'text',
      Barcode: 'text',
      'Bill no.': 'text',
      'Purchase order no.': 'text',
      'Bill date': 'date',
      'Date of accession': 'date',
      Price: 'number',
    };
    const bytes = await templateSheet({
      sheet: 'Books',
      columns: TEMPLATE.map((t) => {
        const list = lists[t.header];
        return {
          ...t,
          ...(list?.length
            ? { options: list, allowNew: t.header !== 'Library' && t.header !== 'For class' }
            : {}),
          ...(NOTES[t.header] ? { note: NOTES[t.header] } : {}),
          ...(FORMAT[t.header] ? { format: FORMAT[t.header] } : {}),
        };
      }),
      examples: [
        TEMPLATE.map((t) =>
          t.header === 'Library' ? (lists.Library?.[0] ?? null) : (EXAMPLE_1[t.header] ?? null),
        ),
        TEMPLATE.map((t) =>
          t.header === 'Library' ? (lists.Library?.[0] ?? null) : (EXAMPLE_2[t.header] ?? null),
        ),
      ],
      guide: [
        'One row per copy: its accession number, the library it is in, and its title.',
        'Copies of one title: repeat the title details on each row (the same ISBN, or the same title, first author, edition and volume, make one title).',
        'An accession number already in the library updates that copy: only the cells you fill are changed.',
        'Authors: several separated by ";" (e.g. R. K. Narayan; R. K. Laxman). Editors the same way.',
        'Names not yet in Library setup (authors, publishers, subjects, languages, vendors, shelves and racks) are added there.',
        'Material type: the code or name from Library setup (Book, Textbook, Reference …); empty: Book.',
        'Dates: 2024-06-01 or 01-06-2024. Price: a number. Year: four digits.',
        'Status: On the shelf (empty), Withdrawn, Lost or Damaged.',
        'The legacy library’s book file (BookCode, BookName, Author, …) can be uploaded as it is.',
      ],
    });
    return {
      filename: 'Library-books-template.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT id::text, file_name, layout, status, total, summary, created_by_name, created_at, finished_at
           FROM library_imports ORDER BY created_at DESC LIMIT 20`,
      );
      return {
        data: r.rows.map((x) => ({
          id: String(x.id),
          fileName: String(x.file_name),
          layout: String(x.layout),
          status: String(x.status),
          total: Number(x.total),
          summary: x.summary,
          by: x.created_by_name as string | null,
          createdAt: (x.created_at as Date).toISOString(),
          finishedAt: x.finished_at ? (x.finished_at as Date).toISOString() : null,
        })),
      };
    });
  }

  // ---- checking a file -----------------------------------------------------------------------------

  async check(ctx: RequestContext, fileName: string, body: unknown, contentType: string) {
    if (!Buffer.isBuffer(body) || !body.length)
      throw new DomainError('validation-failed', 'Send the file as the request body', {
        status: 400,
      });
    if (body.length > 15 * 1024 * 1024)
      throw new DomainError('validation-failed', 'File larger than 15 MB: split it', {
        status: 400,
      });
    const csv = /\.csv$/i.test(fileName) || contentType.startsWith('text/csv');
    const file = await readFile(
      csv ? { csv: body.toString('utf8') } : { contentBase64: body.toString('base64') },
      {
        maxBytes: 15 * 1024 * 1024,
        isHeader: (cells) =>
          cells.some((x) => ALIASES.accession.includes(norm(x))) &&
          cells.some((x) => ALIASES.title.includes(norm(x))),
      },
    );
    // which column is which
    const at: Partial<Record<Field, number>> = {};
    const ignored: string[] = [];
    file.header.forEach((h, i) => {
      const n = norm(h);
      if (!n) return;
      const f = (Object.keys(ALIASES) as Field[]).find((k) => ALIASES[k].includes(n));
      if (f && at[f] === undefined) at[f] = i;
      else if (!IGNORED.has(n)) ignored.push(h);
    });
    if (at.accession === undefined || at.title === undefined)
      throw new DomainError(
        'validation-failed',
        'The file needs an accession number column (Accession no. or BookCode) and a title column (Title or BookName)',
        { status: 400 },
      );
    if (file.rows.length > LIMIT_ROWS)
      throw new DomainError(
        'validation-failed',
        `More than ${String(LIMIT_ROWS)} rows: split the file`,
        {
          status: 400,
        },
      );
    const layout = file.header.some((h) => ['bookcode', 'bookname'].includes(norm(h)))
      ? 'legacy'
      : 'edupro';
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `SELECT app.library_seed(app.current_school_id()) WHERE app.my_libraries() IS NULL`,
      );
      const lists = await this.lists(c);
      const cell = (r: Cell[], f: Field) => (at[f] === undefined ? '' : text(r[at[f]!] ?? null));
      const raw = (r: Cell[], f: Field): Cell => (at[f] === undefined ? null : (r[at[f]!] ?? null));
      const rows: Array<{
        line: number;
        accession: string;
        data: RowData;
        errors: string[];
        warnings: string[];
      }> = [];
      for (const [i, r] of file.rows.entries()) {
        const line = file.rowNumbers[i]!;
        const errors: string[] = [];
        const warnings: string[] = [];
        const given: Field[] = [];
        const val = (f: Field) => {
          const v = cell(r, f);
          if (blank(v)) return undefined;
          given.push(f);
          return v;
        };
        const accession = (cell(r, 'accession') || '').replace(/\s+/g, '').toUpperCase();
        if (!accession) errors.push('No accession number');
        else if (!/^[A-Z0-9/-]{1,30}$/.test(accession))
          errors.push(`Accession number “${accession}”: letters and digits only (/ or - allowed)`);
        const titleText = val('title');
        if (!titleText) errors.push('No title');
        // the library: its code or name; none given: the only library, or the Main library
        const libText = val('library');
        let lib = libText
          ? lists.libraries.find((l) => [key(l.code), key(l.name)].includes(key(libText)))
          : lists.libraries.length === 1
            ? lists.libraries[0]
            : lists.libraries.find((l) => l.code === 'MAIN');
        if (!lib) {
          errors.push(
            libText ? `Library “${libText}” is not in Library setup` : 'No library given',
          );
          lib = undefined;
        }
        // the material type: BOOK / Text / TEXTBOOK of the legacy, or a code or name of ours
        const matText = val('material');
        const matKey = key(matText);
        const mat = !matText
          ? lists.materials.find((m) => m.code === 'BOOK')
          : lists.materials.find(
              (m) =>
                [key(m.code), key(m.name)].includes(matKey) ||
                (['book', 'books'].includes(matKey) && m.code === 'BOOK') ||
                (['text', 'textbook', 'textbooks'].includes(matKey) && m.code === 'TEXT'),
            );
        if (!mat) errors.push(`Material type “${matText ?? ''}” is not in Library setup`);
        const num = (f: Field, min: number, max: number, int = true) => {
          const s = val(f);
          if (s === undefined) return undefined;
          // "Rs.199", "₹ 1,250.00", "INR 300": the currency and the thousands commas go
          const cleaned = s
            .replace(/^\s*(rs\.?|inr|₹)\s*/i, '')
            .replace(/,/g, '')
            .trim();
          const n = Number(cleaned);
          if (
            !/^\d+(\.\d+)?$/.test(cleaned) ||
            n < min ||
            n > max ||
            (int && !Number.isInteger(n))
          ) {
            warnings.push(
              `${f === 'year' ? 'Year' : f === 'pages' ? 'Pages' : 'Price'} “${s}” left out`,
            );
            return undefined;
          }
          return n;
        };
        const date = (f: Field, label: string) => {
          const v = raw(r, f);
          if (v === null || blank(text(v))) return undefined;
          given.push(f);
          const d = dayOf(v);
          if (!d || d > today()) {
            warnings.push(`${label} “${text(v)}” left out`);
            return undefined;
          }
          return d;
        };
        let isbn = val('isbn');
        if (isbn) {
          const ok = IsbnSchema.safeParse(isbn);
          if (ok.success) isbn = ok.data;
          else {
            warnings.push(`ISBN “${isbn}” is not a valid ISBN: left out`);
            isbn = undefined;
          }
        }
        const people: TitleData['people'] = [
          ...(val('authors') ?? '').split(';'),
          ...(val('author2') ?? '').split(';'),
        ]
          .map((x) => x.trim())
          .filter((x) => x.length >= 2)
          .map((name) => ({ name, role: 'Author' }));
        for (const name of (val('editors') ?? '')
          .split(';')
          .map((x) => x.trim())
          .filter((x) => x.length >= 2))
          people.push({ name, role: 'Editor' });
        const yes = (s?: string) => (s ? /^(y|yes|true|1)$/i.test(s) : undefined);
        const no = (s?: string) => (s ? /^(n|no|false|0)$/i.test(s) : undefined);
        const borrowable = val('borrowable');
        const refCell = val('reference');
        const category = val('category');
        const keywords = [
          ...(val('keywords') ?? '').split(/[;,]/),
          ...(category && !/^reference$/i.test(category) ? [category] : []),
        ]
          .map((x) => x.trim())
          .filter(Boolean);
        const classText = val('class');
        const cls = classText
          ? lists.classes.find((x) => [key(x.code), key(x.name)].includes(key(classText)))
          : undefined;
        if (classText && !cls) warnings.push(`Class “${classText}” not found: left out`);
        // purchase or donation: said so, or a donation tick, or a vendor or bill
        const acqText = val('acquisition');
        const donated = val('donated');
        const vendor = val('vendor');
        const billNo = val('billNo');
        const acquisition: CopyData['acquisition'] =
          (acqText && /don|gift/i.test(acqText)) || yes(donated)
            ? 'Donation'
            : (acqText && /pur|buy/i.test(acqText)) || vendor || billNo
              ? 'Purchase'
              : undefined;
        // the status: ours, or the legacy pair (Active / Discard / LAP / Sold; Issued / Returned)
        const st = `${val('status') ?? ''} ${val('status1') ?? ''}`.toLowerCase();
        let status: CopyData['status'] = 'available';
        let statusReason: string | undefined;
        if (/withdraw|discard|write ?off/.test(st)) status = 'withdrawn';
        else if (/sold/.test(st)) {
          status = 'withdrawn';
          statusReason = 'Sold (the old library)';
        } else if (/\blap\b|lost/.test(st)) status = 'lost';
        else if (/damage/.test(st)) status = 'damaged';
        if (/issued/.test(st))
          warnings.push('On loan in the old library: comes in on the shelf; issue it again');
        if (status !== 'available' && !statusReason) statusReason = 'Imported';
        const location = val('location');
        const remarks = [val('remarks'), location ? `Location: ${location}` : undefined]
          .filter(Boolean)
          .join(' · ');
        const price = num('price', 0, 10_000_000, false);
        const data: RowData = {
          title: {
            title: titleText ?? '',
            ...(val('subtitle') ? { subtitle: cell(r, 'subtitle') } : {}),
            people,
            materialTypeId: mat?.id ?? '',
            material: mat?.name ?? '',
            ...(val('subject') ? { subject: cell(r, 'subject') } : {}),
            ...(val('subSubject') ? { subSubject: cell(r, 'subSubject') } : {}),
            ...(val('callNo') ? { callNo: cell(r, 'callNo') } : {}),
            keywords,
            ...(cls ? { classId: cls.id } : {}),
            ...(val('publisher') ? { publisher: cell(r, 'publisher') } : {}),
            ...(val('place') ? { place: cell(r, 'place') } : {}),
            ...((): Partial<TitleData> => {
              const y = num('year', 1500, new Date().getFullYear() + 1);
              return y ? { year: y } : {};
            })(),
            ...(val('edition') ? { edition: cell(r, 'edition') } : {}),
            ...(val('volume') ? { volume: cell(r, 'volume') } : {}),
            ...((): Partial<TitleData> => {
              const p = num('pages', 1, 20000);
              return p ? { pages: p } : {};
            })(),
            ...(isbn ? { isbn } : {}),
            ...(val('language') ? { language: cell(r, 'language') } : {}),
            ...(price !== undefined ? { price } : {}),
            ...(no(borrowable) || yes(refCell) || /^reference$/i.test(category ?? '')
              ? { isReference: true }
              : {}),
            ...(val('notes') ? { notes: cell(r, 'notes') } : {}),
          },
          copy: {
            libraryId: lib?.id ?? '',
            library: lib?.name ?? '',
            ...(val('shelf') ? { shelf: cell(r, 'shelf').toUpperCase().slice(0, 20) } : {}),
            ...(val('rack') ? { rack: cell(r, 'rack').slice(0, 20) } : {}),
            ...(val('barcode') ? { barcode: cell(r, 'barcode').replace(/\s+/g, '') } : {}),
            ...(acquisition ? { acquisition } : {}),
            ...(vendor && acquisition === 'Purchase' ? { vendor } : {}),
            ...(val('donor') && acquisition === 'Donation' ? { donor: cell(r, 'donor') } : {}),
            ...(billNo && acquisition === 'Purchase' ? { billNo } : {}),
            ...((): Partial<CopyData> => {
              const d = date('billDate', 'Bill date');
              return d && acquisition === 'Purchase' ? { billDate: d } : {};
            })(),
            ...(val('poNo') && acquisition === 'Purchase' ? { poNo: cell(r, 'poNo') } : {}),
            ...(price !== undefined ? { price } : {}),
            ...((): Partial<CopyData> => {
              const d = date('accessionedOn', 'Date of accession');
              return d ? { accessionedOn: d } : {};
            })(),
            ...(remarks ? { remarks: remarks.slice(0, 300) } : {}),
            status,
            ...(statusReason ? { statusReason } : {}),
          },
          given: [...new Set(given)],
        };
        if (data.copy.barcode && !/^[A-Za-z0-9/-]{1,40}$/.test(data.copy.barcode))
          errors.push(`Barcode “${data.copy.barcode}”: letters and digits only`);
        rows.push({ line, accession, data, errors, warnings });
      }
      // the same accession number twice in the file: the later rows are refused
      const seen = new Map<string, number>();
      const barcodes = new Map<string, string>();
      for (const row of rows) {
        if (!row.accession) continue;
        const first = seen.get(row.accession);
        if (first !== undefined) row.errors.push(`Accession number also on row ${String(first)}`);
        else seen.set(row.accession, row.line);
        const b = row.data.copy.barcode;
        if (b) {
          const other = barcodes.get(b);
          if (other && other !== row.accession) row.errors.push(`Barcode also on ${other}`);
          else barcodes.set(b, row.accession);
        }
      }
      // the copies and titles already there
      const accs = [...seen.keys()];
      const existing = new Map(
        (
          await c.query<Record<string, unknown> & { accession_no: string }>(
            `SELECT x.id::text AS copy_id, x.accession_no, x.title_id::text, t.title, t.subtitle, t.author, t.publisher,
                    t.publication_place, t.year, t.edition, t.volume, t.pages, t.isbn, t.call_no, t.sub_subject, t.notes,
                    s.name::text AS subject, t.language, t.price::text AS title_price, x.library_id::text, sh.code AS shelf,
                    x.rack, x.barcode, x.acquisition, v.name AS vendor, x.donor, x.bill_no, x.bill_date::text, x.po_no,
                    x.price::text AS copy_price, x.accessioned_on::text, x.remarks, x.status::text
               FROM library_copies x JOIN library_titles t ON t.id = x.title_id
               LEFT JOIN library_subjects s ON s.id = t.subject_id
               LEFT JOIN library_shelves sh ON sh.id = x.shelf_id
               LEFT JOIN library_vendors v ON v.id = x.vendor_id
              WHERE x.accession_no = ANY($1::text[])`,
            [accs],
          )
        ).rows.map((x) => [x.accession_no, x]),
      );
      // numbers a copy had before (retired): not given to a new copy
      const retired = new Map(
        (
          await c.query<{ n: string; now_no: string }>(
            `SELECT upper(h.old_no) AS n, x.accession_no AS now_no FROM library_accession_changes h
               JOIN library_copies x ON x.id = h.copy_id
              WHERE upper(h.old_no) = ANY($1::text[]) AND upper(x.accession_no) <> upper(h.old_no)`,
            [accs.map((a) => a.toUpperCase())],
          )
        ).rows.map((x) => [x.n, x.now_no]),
      );
      const takenBarcodes = new Map(
        (
          await c.query<{ barcode: string; accession_no: string }>(
            `SELECT barcode, accession_no FROM library_copies WHERE barcode = ANY($1::text[])`,
            [[...barcodes.keys()]],
          )
        ).rows.map((x) => [x.barcode, x.accession_no]),
      );
      const titles = (
        await c.query<{
          id: string;
          title: string;
          author: string | null;
          edition: string | null;
          volume: string | null;
          isbn: string | null;
        }>(
          `SELECT t.id::text, t.title, (SELECT a.name::text FROM library_title_authors ta JOIN library_authors a ON a.id = ta.author_id
                                         WHERE ta.title_id = t.id ORDER BY ta.position LIMIT 1) AS author,
                  t.edition, t.volume, regexp_replace(COALESCE(t.isbn, ''), '[^0-9X]', '', 'g') AS isbn
             FROM library_titles t WHERE t.status = 'active'`,
        )
      ).rows;
      const titleBy = new Map<string, string>();
      for (const t of titles) {
        titleBy.set(
          `t:${key(t.title)}|${key(t.author ?? '')}|${key(t.edition ?? '')}|${key(t.volume ?? '')}`,
          t.id,
        );
        if (t.isbn) titleBy.set(`isbn:${t.isbn}`, t.id);
      }
      // a title of the file: by its ISBN, or by title, first author, edition and volume (a row without
      // the ISBN joins the title an earlier row gave one)
      const keysInFile = new Map<string, string>();
      const out: Array<{
        line: number;
        kind: string;
        accession: string;
        title: string;
        data: RowData;
        errors: string[];
        warnings: string[];
        key: string | null;
      }> = [];
      for (const row of rows) {
        const was = existing.get(row.accession);
        const gone = was ? undefined : retired.get(row.accession.toUpperCase());
        if (gone)
          row.errors.push(
            `Accession number ${row.accession} was used before and is retired: that copy is now ${gone}`,
          );
        const b = row.data.copy.barcode;
        if (b && takenBarcodes.has(b) && takenBarcodes.get(b) !== row.accession)
          row.errors.push(`Barcode already on copy ${takenBarcodes.get(b)!}`);
        let kind: string;
        let tk: string | null = null;
        if (row.errors.length) kind = 'error';
        else if (was) {
          row.data.existingCopyId = String(was.copy_id);
          row.data.existingTitleId = String(was.title_id);
          const changes = this.changes(row.data, was);
          row.data.changes = changes;
          kind = changes.length ? 'update' : 'unchanged';
        } else {
          const t = row.data.title;
          const tx = textKey(t);
          const ik = t.isbn ? `isbn:${t.isbn}` : null;
          const there = (ik ? titleBy.get(ik) : undefined) ?? titleBy.get(tx);
          tk = (ik ? keysInFile.get(ik) : undefined) ?? keysInFile.get(tx) ?? ik ?? tx;
          if (there) {
            row.data.existingTitleId = there;
            kind = 'new_copy';
          } else if (keysInFile.has(tx) || (ik && keysInFile.has(ik))) kind = 'new_copy';
          else kind = 'new_title';
          keysInFile.set(tx, tk);
          if (ik) keysInFile.set(ik, tk);
        }
        out.push({
          line: row.line,
          kind,
          accession: row.accession,
          title: row.data.title.title,
          data: row.data,
          errors: row.errors,
          warnings: row.warnings,
          key: tk,
        });
      }
      const summary = this.summarise(out, lists);
      const imp = await c.query<{ id: string }>(
        `INSERT INTO library_imports (school_id, file_name, layout, total, summary, ignored_columns, created_by, created_by_name)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, app.current_user_id(), $6) RETURNING id::text`,
        [
          fileName.slice(0, 200),
          layout,
          out.length,
          JSON.stringify(summary),
          ignored,
          ctx.user.displayName,
        ],
      );
      const id = imp.rows[0]!.id;
      for (let i = 0; i < out.length; i += 500) {
        const part = out.slice(i, i + 500);
        await c.query(
          `INSERT INTO library_import_rows (school_id, import_id, line, kind, accession_no, title, data, errors, warnings, title_key, state)
           SELECT app.current_school_id(), $1, r.line, r.kind, r.acc, r.title, r.data, r.errors, r.warnings, r.tk,
                  CASE WHEN r.kind IN ('error', 'unchanged') THEN 'skipped' ELSE 'pending' END
             FROM jsonb_to_recordset($2::jsonb) AS r(line int, kind text, acc text, title text, data jsonb, errors text[], warnings text[], tk text)`,
          [
            id,
            JSON.stringify(
              part.map((p) => ({
                line: p.line,
                kind: p.kind,
                acc: p.accession || null,
                title: p.title || null,
                data: p.data,
                errors: p.errors,
                warnings: p.warnings,
                tk: p.key,
              })),
            ),
          ],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'library.import.check',
        entityType: 'library_imports',
        entityId: id,
        after: { fileName, layout, ...summary },
      });
      return { id };
    });
  }

  private async lists(c: PoolClient) {
    const q = async <T extends Record<string, unknown>>(sql: string) =>
      (await c.query<T>(sql)).rows;
    return {
      libraries: await q<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_libraries WHERE status = 'active' ORDER BY id`,
      ),
      materials: await q<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM library_material_types WHERE status = 'active'`,
      ),
      classes: await q<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM classes WHERE deleted_at IS NULL`,
      ),
      authors: new Set(
        (await q<{ n: string }>(`SELECT lower(name::text) AS n FROM library_authors`)).map(
          (x) => x.n,
        ),
      ),
      publishers: new Set(
        (await q<{ n: string }>(`SELECT lower(name::text) AS n FROM library_publishers`)).map(
          (x) => x.n,
        ),
      ),
      subjects: new Set(
        (await q<{ n: string }>(`SELECT lower(name::text) AS n FROM library_subjects`)).map(
          (x) => x.n,
        ),
      ),
      languages: new Set(
        (
          await q<{ n: string; c: string | null }>(
            `SELECT lower(name::text) AS n, lower(code) AS c FROM library_languages`,
          )
        ).flatMap((x) => [x.n, ...(x.c ? [x.c] : [])]),
      ),
      vendors: new Set(
        (
          await q<{ n: string; c: string }>(
            `SELECT lower(name) AS n, lower(code) AS c FROM library_vendors`,
          )
        ).flatMap((x) => [x.n, x.c]),
      ),
      shelves: new Set(
        (
          await q<{ k: string }>(
            `SELECT library_id::text || '|' || upper(code) AS k FROM library_shelves`,
          )
        ).map((x) => x.k),
      ),
    };
  }

  /** The cells of a row that differ from the copy and title already there (only the cells given). */
  private changes(d: RowData, was: Record<string, unknown>) {
    const out: string[] = [];
    const same = (a: unknown, b: unknown) =>
      String(a ?? '')
        .trim()
        .toLowerCase() ===
      String(b ?? '')
        .trim()
        .toLowerCase();
    const num = (a: unknown, b: unknown) => Number(a ?? NaN) === Number(b ?? NaN);
    const g = (f: Field) => d.given.includes(f);
    const t = d.title;
    const x = d.copy;
    if (g('title') && !same(t.title, was.title)) out.push('Title');
    if (g('subtitle') && !same(t.subtitle, was.subtitle)) out.push('Subtitle');
    if (
      (g('authors') || g('author2')) &&
      !same(
        t.people
          .filter((p) => p.role === 'Author')
          .map((p) => p.name)
          .join(', '),
        was.author,
      )
    )
      out.push('Authors');
    if (g('publisher') && !same(t.publisher, was.publisher)) out.push('Publisher');
    if (g('place') && !same(t.place, was.publication_place)) out.push('Place of publication');
    if (g('year') && t.year !== undefined && !num(t.year, was.year)) out.push('Year');
    if (g('edition') && !same(t.edition, was.edition)) out.push('Edition');
    if (g('volume') && !same(t.volume, was.volume)) out.push('Volume');
    if (g('pages') && t.pages !== undefined && !num(t.pages, was.pages)) out.push('Pages');
    if (g('isbn') && t.isbn && !same(t.isbn, String(was.isbn ?? '').replace(/[^0-9X]/gi, '')))
      out.push('ISBN');
    if (g('callNo') && !same(t.callNo, was.call_no)) out.push('Call number');
    if (g('subject') && !same(t.subject, was.subject)) out.push('Subject');
    if (g('subSubject') && !same(t.subSubject, was.sub_subject)) out.push('Sub-subject');
    if (g('language') && !same(t.language, was.language)) out.push('Language');
    if (g('library') && x.libraryId !== String(was.library_id)) out.push('Library');
    if (g('shelf') && !same(x.shelf, was.shelf)) out.push('Shelf');
    if (g('rack') && !same(x.rack, was.rack)) out.push('Rack');
    if (g('barcode') && !same(x.barcode, was.barcode)) out.push('Barcode');
    if (g('vendor') && x.vendor && !same(x.vendor, was.vendor)) out.push('Vendor');
    if (g('donor') && x.donor && !same(x.donor, was.donor)) out.push('Donated by');
    if (g('billNo') && x.billNo && !same(x.billNo, was.bill_no)) out.push('Bill no.');
    if (g('billDate') && x.billDate && !same(x.billDate, was.bill_date)) out.push('Bill date');
    if (g('price') && x.price !== undefined && !num(x.price, was.copy_price ?? was.title_price))
      out.push('Price');
    if (g('accessionedOn') && x.accessionedOn && !same(x.accessionedOn, was.accessioned_on))
      out.push('Date of accession');
    if (g('remarks') && x.remarks && !same(x.remarks, was.remarks)) out.push('Remarks');
    if (
      (g('status') || g('status1')) &&
      x.status !== was.status &&
      was.status !== 'issued' &&
      was.status !== 'sold'
    )
      out.push('Status');
    return out;
  }

  private summarise(
    rows: Array<{ kind: string; data: RowData; warnings: string[]; errors: string[] }>,
    lists: Awaited<ReturnType<LibraryImportService['lists']>>,
  ) {
    const count = (k: string) => rows.filter((r) => r.kind === k).length;
    const ok = rows.filter((r) => r.kind !== 'error');
    const fresh = (names: Array<string | undefined>, have: Set<string>) =>
      new Set(
        names
          .filter((n): n is string => Boolean(n))
          .map((n) => n.toLowerCase())
          .filter((n) => !have.has(n)),
      ).size;
    return {
      rows: rows.length,
      newTitles: count('new_title'),
      newCopies: count('new_title') + count('new_copy'),
      updates: count('update'),
      unchanged: count('unchanged'),
      errors: count('error'),
      warnings: rows.filter((r) => r.warnings.length).length,
      masters: {
        authors: fresh(
          ok.flatMap((r) => r.data.title.people.map((p) => p.name)),
          lists.authors,
        ),
        publishers: fresh(
          ok.map((r) => r.data.title.publisher),
          lists.publishers,
        ),
        subjects: fresh(
          ok.map((r) => r.data.title.subject),
          lists.subjects,
        ),
        languages: fresh(
          ok.map((r) => r.data.title.language),
          lists.languages,
        ),
        vendors: fresh(
          ok.map((r) => r.data.copy.vendor),
          lists.vendors,
        ),
        shelves: fresh(
          ok.map((r) =>
            r.data.copy.shelf ? `${r.data.copy.libraryId}|${r.data.copy.shelf}` : undefined,
          ),
          new Set([...lists.shelves].map((x) => x.toLowerCase())),
        ),
      },
    };
  }

  /** An upload with its rows (by kind, a page at a time). */
  async view(ctx: RequestContext, id: string, kind?: string, page = 1) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Import not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = (
        await c.query<Record<string, unknown>>(
          `SELECT id::text, file_name, layout, status, total, summary, ignored_columns, created_by_name, created_at, finished_at
             FROM library_imports WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!imp) throw new DomainError('not-found', 'Import not found', { status: 404 });
      const states = await c.query<{ state: string; n: number }>(
        `SELECT state, count(*)::int AS n FROM library_import_rows WHERE import_id = $1 GROUP BY state`,
        [id],
      );
      const kinds = ['new_title', 'new_copy', 'update', 'unchanged', 'error', 'failed', 'warnings'];
      const k = kind && kinds.includes(kind) ? kind : null;
      const where =
        k === 'failed'
          ? `AND state = 'failed'`
          : k === 'warnings'
            ? `AND cardinality(warnings) > 0`
            : k
              ? `AND kind = $4`
              : '';
      const size = 50;
      const rows = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- one of the fixed conditions above; values are bound
        `SELECT line, kind, accession_no, title, errors, warnings, state, result, data->'changes' AS changes,
                data->'copy'->>'library' AS library, count(*) OVER () AS total
           FROM library_import_rows WHERE import_id = $1 ${where}
          ORDER BY line LIMIT $2 OFFSET $3`,
        k && !['failed', 'warnings'].includes(k)
          ? [id, size, (page - 1) * size, k]
          : [id, size, (page - 1) * size],
      );
      const by = Object.fromEntries(states.rows.map((x) => [x.state, x.n]));
      return {
        id: String(imp.id),
        fileName: String(imp.file_name),
        layout: String(imp.layout),
        status: String(imp.status),
        total: Number(imp.total),
        summary: imp.summary,
        ignoredColumns: imp.ignored_columns as string[],
        by: imp.created_by_name as string | null,
        createdAt: (imp.created_at as Date).toISOString(),
        finishedAt: imp.finished_at ? (imp.finished_at as Date).toISOString() : null,
        progress: {
          pending: by.pending ?? 0,
          done: by.done ?? 0,
          failed: by.failed ?? 0,
          skipped: by.skipped ?? 0,
        },
        rows: rows.rows.map((r) => ({
          line: Number(r.line),
          kind: String(r.kind),
          accessionNo: r.accession_no as string | null,
          title: r.title as string | null,
          library: r.library as string | null,
          errors: r.errors as string[],
          warnings: r.warnings as string[],
          changes: (r.changes as string[] | null) ?? [],
          state: String(r.state),
          result: r.result as string | null,
        })),
        page: { number: page, size, total: Number(rows.rows[0]?.total ?? 0) },
      };
    });
  }

  async discard(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE library_imports SET status = 'discarded', finished_at = now() WHERE id = $1 AND status = 'checked'`,
        [id],
      );
      if (!r.rowCount)
        throw new DomainError(
          'library.import_started',
          'Only a checked file that has not started can be discarded',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE library_import_rows SET state = 'skipped' WHERE import_id = $1 AND state = 'pending'`,
        [id],
      );
      return { status: 'discarded' };
    });
  }

  // ---- importing ---------------------------------------------------------------------------------------

  /** The next batch of rows, each on its own (a failed row keeps the reason); then the series move on. */
  async run(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Import not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = (
        await c.query<{ status: string; file_name: string }>(
          `SELECT status, file_name FROM library_imports WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!imp) throw new DomainError('not-found', 'Import not found', { status: 404 });
      if (!['checked', 'importing'].includes(imp.status))
        throw new DomainError('library.import_closed', `This import is ${imp.status}`, {
          status: 409,
        });
      if (imp.status === 'checked')
        await c.query(`UPDATE library_imports SET status = 'importing' WHERE id = $1`, [id]);
      const rows = await c.query<{
        id: string;
        kind: string;
        accession_no: string;
        data: RowData;
        title_key: string | null;
      }>(
        `SELECT id::text, kind, accession_no, data, title_key FROM library_import_rows
          WHERE import_id = $1 AND state = 'pending' ORDER BY line LIMIT $2`,
        [id, BATCH],
      );
      const cache = new Map<string, string>();
      for (const r of rows.rows) {
        await c.query('SAVEPOINT import_row');
        try {
          const titleId = await this.apply(c, ctx, id, imp.file_name, r, cache);
          await c.query('RELEASE SAVEPOINT import_row');
          await c.query(
            `UPDATE library_import_rows SET state = 'done', title_id = $2 WHERE id = $1`,
            [r.id, titleId],
          );
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT import_row');
          const e = error as { code?: string; message?: string; detail?: string };
          const why =
            e.code === '23505'
              ? 'The accession number or barcode is already used'
              : error instanceof DomainError
                ? error.message
                : (e.message ?? 'Not imported').slice(0, 300);
          await c.query(
            `UPDATE library_import_rows SET state = 'failed', result = $2 WHERE id = $1`,
            [r.id, why],
          );
        }
      }
      const left = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM library_import_rows WHERE import_id = $1 AND state = 'pending'`,
        [id],
      );
      const pending = left.rows[0]!.n;
      let moved: Array<{ prefix: string; next: string }> = [];
      if (!pending) {
        // the series continue after the numbers that came in
        moved = (
          await c.query<{ prefix: string; next: string }>(
            `UPDATE library_accession_series s
                SET next_no = m.top + 1, updated_at = now()
               FROM (SELECT s2.id, max(substring(x.accession_no FROM length(s2.prefix) + 1)::bigint) AS top
                       FROM library_accession_series s2
                       JOIN library_copies x ON x.school_id = s2.school_id
                        AND x.accession_no ~ ('^' || s2.prefix || '[0-9]{1,15}$')
                      GROUP BY s2.id) m
              WHERE m.id = s.id AND m.top + 1 > s.next_no
              RETURNING s.prefix, s.prefix || lpad((m.top + 1)::text, s.digits, '0') AS next`,
          )
        ).rows;
        const counts = await c.query<{ state: string; n: number }>(
          `SELECT state, count(*)::int AS n FROM library_import_rows WHERE import_id = $1 GROUP BY state`,
          [id],
        );
        const by = Object.fromEntries(counts.rows.map((x) => [x.state, x.n]));
        await c.query(
          `UPDATE library_imports SET status = 'done', finished_at = now(),
                  summary = summary || jsonb_build_object('done', $2::int, 'failed', $3::int, 'series', $4::jsonb)
            WHERE id = $1`,
          [id, by.done ?? 0, by.failed ?? 0, JSON.stringify(moved)],
        );
        await this.audit.stage(ctx, c, {
          action: 'library.import',
          entityType: 'library_imports',
          entityId: id,
          after: { done: by.done ?? 0, failed: by.failed ?? 0, series: moved },
        });
      }
      const done = await c.query<{ state: string; n: number }>(
        `SELECT state, count(*)::int AS n FROM library_import_rows WHERE import_id = $1 GROUP BY state`,
        [id],
      );
      const by = Object.fromEntries(done.rows.map((x) => [x.state, x.n]));
      return {
        status: pending ? 'importing' : 'done',
        pending,
        done: by.done ?? 0,
        failed: by.failed ?? 0,
        series: moved,
      };
    });
  }

  /** A master row by name (a new name is added), cached for the batch. */
  private async named(c: PoolClient, cache: Map<string, string>, table: string, name: string) {
    const k = `${table}|${name.toLowerCase()}`;
    const hit = cache.get(k);
    if (hit) return hit;
    const r = await c.query<{ id: string }>(
      // eslint-disable-next-line no-restricted-syntax -- one of the fixed master tables below
      `INSERT INTO ${table} (school_id, name) VALUES (app.current_school_id(), $1)
       ON CONFLICT (school_id, name) DO UPDATE SET name = ${table}.name RETURNING id::text`,
      [name.slice(0, 120)],
    );
    cache.set(k, r.rows[0]!.id);
    return r.rows[0]!.id;
  }

  private async language(c: PoolClient, cache: Map<string, string>, name: string) {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM library_languages WHERE name = $1::citext OR lower(code) = lower($1) LIMIT 1`,
      [name],
    );
    return r.rows[0]?.id ?? this.named(c, cache, 'library_languages', name);
  }

  private async vendor(c: PoolClient, cache: Map<string, string>, name: string) {
    const k = `vendor|${name.toLowerCase()}`;
    if (cache.has(k)) return cache.get(k)!;
    const had = await c.query<{ id: string }>(
      `SELECT id::text FROM library_vendors WHERE lower(name) = lower($1) OR lower(code) = lower($1) LIMIT 1`,
      [name],
    );
    let id = had.rows[0]?.id;
    if (!id) {
      const base = (name.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'VENDOR').slice(0, 16);
      for (let n = 0; !id && n < 50; n += 1) {
        const code = n ? `${base}${String(n + 1)}` : base;
        const r = await c.query<{ id: string }>(
          `INSERT INTO library_vendors (school_id, code, name) VALUES (app.current_school_id(), $1, $2)
           ON CONFLICT DO NOTHING RETURNING id::text`,
          [code, name.slice(0, 120)],
        );
        id = r.rows[0]?.id;
      }
    }
    cache.set(k, id!);
    return id!;
  }

  private async shelf(c: PoolClient, libraryId: string, code: string, rack?: string) {
    const r = await c.query<{ id: string }>(
      `INSERT INTO library_shelves (school_id, library_id, code, racks)
       VALUES (app.current_school_id(), $1, $2, CASE WHEN $3::text IS NULL THEN '{}'::text[] ELSE ARRAY[$3::text] END)
       ON CONFLICT (school_id, library_id, code) DO UPDATE
         SET racks = CASE WHEN $3::text IS NULL OR $3::text = ANY(library_shelves.racks) THEN library_shelves.racks
                          ELSE library_shelves.racks || $3::text END
       RETURNING id::text`,
      [libraryId, code, rack ?? null],
    );
    return r.rows[0]!.id;
  }

  /** One row: a copy of a title (made, found or the one the copy has), or a copy's cells updated. */
  private async apply(
    c: PoolClient,
    ctx: RequestContext,
    importId: string,
    fileName: string,
    r: { kind: string; accession_no: string; data: RowData; title_key: string | null },
    cache: Map<string, string>,
  ) {
    const d = r.data;
    const t = d.title;
    const x = d.copy;
    const g = (f: Field) => d.given.includes(f);
    const subjectId = t.subject ? await this.named(c, cache, 'library_subjects', t.subject) : null;
    if (subjectId && t.subSubject)
      await c.query(
        `UPDATE library_subjects SET sub_subjects = sub_subjects || $2::text
          WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM unnest(sub_subjects) u WHERE lower(u) = lower($2))`,
        [subjectId, t.subSubject],
      );
    const publisherId = t.publisher
      ? await this.named(c, cache, 'library_publishers', t.publisher)
      : null;
    const languageId = t.language ? await this.language(c, cache, t.language) : null;
    const people = async (titleId: string) => {
      await c.query(`DELETE FROM library_title_authors WHERE title_id = $1`, [titleId]);
      for (const [i, p] of t.people.entries()) {
        const a = await this.named(c, cache, 'library_authors', p.name);
        await c.query(
          `INSERT INTO library_title_authors (school_id, title_id, author_id, role, position)
           VALUES (app.current_school_id(), $1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [titleId, a, p.role, i + 1],
        );
      }
    };
    const names = (titleId: string) =>
      c.query(
        `UPDATE library_titles t SET
            author = (SELECT string_agg(a.name::text, ', ' ORDER BY ta.position) FROM library_title_authors ta
                        JOIN library_authors a ON a.id = ta.author_id WHERE ta.title_id = t.id AND ta.role = 'Author'),
            publisher = (SELECT name::text FROM library_publishers WHERE id = t.publisher_id),
            language = (SELECT name::text FROM library_languages WHERE id = t.language_id),
            category = (SELECT name::text FROM library_subjects WHERE id = t.subject_id)
          WHERE t.id = $1`,
        [titleId],
      );
    const shelfId = x.shelf ? await this.shelf(c, x.libraryId, x.shelf, x.rack) : null;
    const vendorId = x.vendor ? await this.vendor(c, cache, x.vendor) : null;

    if (r.kind === 'update') {
      const titleId = d.existingTitleId!;
      const set: string[] = [];
      const vals: unknown[] = [titleId];
      const put = (col: string, v: unknown) => {
        vals.push(v);
        set.push(`${col} = $${String(vals.length)}`);
      };
      if (g('title')) put('title', t.title);
      if (g('subtitle')) put('subtitle', t.subtitle ?? null);
      if (g('publisher')) put('publisher_id', publisherId);
      if (g('place')) put('publication_place', t.place ?? null);
      if (t.year !== undefined) put('year', t.year);
      if (g('edition')) put('edition', t.edition ?? null);
      if (g('volume')) put('volume', t.volume ?? null);
      if (t.pages !== undefined) put('pages', t.pages);
      if (t.isbn) put('isbn', t.isbn);
      if (g('callNo')) put('call_no', t.callNo ?? null);
      if (g('subject')) put('subject_id', subjectId);
      if (g('subSubject')) put('sub_subject', t.subSubject ?? null);
      if (g('language')) put('language_id', languageId);
      if (g('material')) put('material_type_id', t.materialTypeId);
      if (t.classId) put('class_id', t.classId);
      if (t.notes) put('notes', t.notes);
      if (t.keywords.length) put('keywords', t.keywords);
      if (t.isReference) put('is_reference', true);
      if (set.length)
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- fixed column names chosen above; values are bound
          `UPDATE library_titles SET ${set.join(', ')}, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          vals,
        );
      if (t.people.length && (g('authors') || g('author2') || g('editors'))) await people(titleId);
      await names(titleId);
      const cset: string[] = [];
      const cvals: unknown[] = [d.existingCopyId];
      const cput = (col: string, v: unknown) => {
        cvals.push(v);
        cset.push(`${col} = $${String(cvals.length)}`);
      };
      if (g('library')) cput('library_id', x.libraryId);
      if (g('shelf')) cput('shelf_id', shelfId);
      if (g('rack')) cput('rack', x.rack ?? null);
      if (g('barcode')) cput('barcode', x.barcode ?? null);
      if (x.acquisition) cput('acquisition', x.acquisition);
      if (vendorId) cput('vendor_id', vendorId);
      if (x.donor) cput('donor', x.donor);
      if (x.billNo) cput('bill_no', x.billNo);
      if (x.billDate) cput('bill_date', x.billDate);
      if (x.poNo) cput('po_no', x.poNo);
      if (x.price !== undefined) cput('price', x.price);
      if (x.accessionedOn) cput('accessioned_on', x.accessionedOn);
      if (x.remarks) cput('remarks', x.remarks);
      const cur = await c.query<{ status: string }>(
        `SELECT status::text FROM library_copies WHERE id = $1`,
        [d.existingCopyId],
      );
      const statusChange =
        (g('status') || g('status1')) &&
        cur.rows[0] &&
        !['issued', 'sold'].includes(cur.rows[0].status) &&
        cur.rows[0].status !== x.status;
      if (statusChange) {
        cput('status', x.status);
        cput('status_on', today());
        cput('status_reason', x.status === 'available' ? null : (x.statusReason ?? 'Imported'));
      }
      if (cset.length)
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- fixed column names chosen above; values are bound
          `UPDATE library_copies SET ${cset.join(', ')}, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          cvals,
        );
      await c.query(
        `INSERT INTO library_copy_events (school_id, copy_id, what, from_status, to_status, reason, by_user, by_name)
         VALUES (app.current_school_id(), $1, 'edited', $2, $3, $4, app.current_user_id(), $5)`,
        [
          d.existingCopyId,
          statusChange ? cur.rows[0]!.status : null,
          statusChange ? x.status : null,
          `Updated from ${fileName}: ${(d.changes ?? []).join(', ')}`.slice(0, 300),
          ctx.user.displayName,
        ],
      );
      return titleId;
    }

    // a new copy: of the title found before, made by an earlier row of this file, or made now
    let titleId = d.existingTitleId ?? null;
    if (!titleId && r.title_key) {
      const k = cache.get(`title|${r.title_key}`);
      titleId =
        k ??
        (
          await c.query<{ id: string }>(
            `SELECT title_id::text AS id FROM library_import_rows
              WHERE import_id = $1 AND title_key = $2 AND title_id IS NOT NULL LIMIT 1`,
            [importId, r.title_key],
          )
        ).rows[0]?.id ??
        null;
    }
    if (!titleId) {
      const ins = await c.query<{ id: string }>(
        `INSERT INTO library_titles (school_id, title, subtitle, material_type_id, subject_id, sub_subject, call_no, keywords,
                                     class_id, publisher_id, publication_place, year, edition, volume, pages, isbn, language_id,
                                     price, is_reference, notes, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                 app.current_user_id(), app.current_user_id())
         RETURNING id::text`,
        [
          t.title.slice(0, 250),
          t.subtitle ?? null,
          t.materialTypeId,
          subjectId,
          t.subSubject ?? null,
          t.callNo ?? null,
          t.keywords,
          t.classId ?? null,
          publisherId,
          t.place ?? null,
          t.year ?? null,
          t.edition ?? null,
          t.volume ?? null,
          t.pages ?? null,
          t.isbn ?? null,
          languageId,
          t.price ?? null,
          t.isReference ?? false,
          t.notes ?? null,
        ],
      );
      titleId = ins.rows[0]!.id;
      await people(titleId);
      await names(titleId);
    }
    if (r.title_key) cache.set(`title|${r.title_key}`, titleId);
    const copy = await c.query<{ id: string }>(
      `INSERT INTO library_copies (school_id, title_id, accession_no, accessioned_on, library_id, shelf_id, rack, barcode,
                                   acquisition, source, vendor_id, donor, bill_no, bill_date, po_no, price, remarks, status,
                                   status_on, status_reason, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, lower($8), $9, $10, $11,
               $12, $13, $14, $15, $16::library_copy_status, CASE WHEN $16 = 'available' THEN NULL ELSE CURRENT_DATE END, $17,
               app.current_user_id(), app.current_user_id())
       RETURNING id::text`,
      [
        titleId,
        r.accession_no,
        x.accessionedOn ?? null,
        x.libraryId,
        shelfId,
        x.rack ?? null,
        x.barcode ?? null,
        x.acquisition ?? null,
        vendorId,
        x.donor ?? null,
        x.billNo ?? null,
        x.billDate ?? null,
        x.poNo ?? null,
        x.price ?? null,
        x.remarks ?? null,
        x.status,
        x.status === 'available' ? null : (x.statusReason ?? 'Imported'),
      ],
    );
    await c.query(
      `INSERT INTO library_copy_events (school_id, copy_id, what, to_status, on_date, reason, by_user, by_name)
       VALUES (app.current_school_id(), $1, 'accessioned', $2, COALESCE($3::date, CURRENT_DATE), $4, app.current_user_id(), $5)`,
      [
        copy.rows[0]!.id,
        x.status,
        x.accessionedOn ?? null,
        `Imported from ${fileName}`.slice(0, 300),
        ctx.user.displayName,
      ],
    );
    return titleId;
  }

  /** The rows that were refused or failed, with why, to correct and upload again. */
  async problems(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Import not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const imp = (
        await c.query<{ file_name: string }>(
          `SELECT file_name FROM library_imports WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!imp) throw new DomainError('not-found', 'Import not found', { status: 404 });
      const rows = await c.query<{
        line: number;
        accession_no: string | null;
        title: string | null;
        why: string;
      }>(
        `SELECT line, accession_no, title,
                CASE WHEN state = 'failed' THEN result ELSE array_to_string(errors, '; ') END AS why
           FROM library_import_rows WHERE import_id = $1 AND (kind = 'error' OR state = 'failed') ORDER BY line`,
        [id],
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Not imported');
      ws.columns = [
        { header: 'Row of the file', width: 10 },
        { header: 'Accession no.', width: 16 },
        { header: 'Title', width: 40 },
        { header: 'Why', width: 80 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of rows.rows) ws.addRow([r.line, r.accession_no, r.title, r.why]);
      const bytes = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      return {
        filename: `Not-imported-${imp.file_name
          .replace(/\.[a-z]+$/i, '')
          .replace(/[^A-Za-z0-9_-]+/g, '-')
          .slice(0, 60)}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }
}
